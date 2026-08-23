data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  availability_zones = slice(
    data.aws_availability_zones.available.names,
    0,
    length(var.private_subnet_cidrs),
  )
  secret_bindings = flatten([
    for service, names in var.secret_names_by_service : [
      for name in names : {
        key     = "${service}/${name}"
        service = service
        name    = name
      }
    ]
  ])
  secrets = { for binding in local.secret_bindings : binding.key => binding }
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = local.name_prefix }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = local.name_prefix }
}

resource "aws_subnet" "public" {
  for_each = { for index, cidr in var.public_subnet_cidrs : tostring(index) => cidr }

  availability_zone       = local.availability_zones[tonumber(each.key)]
  cidr_block              = each.value
  map_public_ip_on_launch = false
  vpc_id                  = aws_vpc.this.id

  tags = { Name = "${local.name_prefix}-public-${each.key}" }
}

resource "aws_subnet" "private" {
  for_each = { for index, cidr in var.private_subnet_cidrs : tostring(index) => cidr }

  availability_zone = local.availability_zones[tonumber(each.key)]
  cidr_block        = each.value
  vpc_id            = aws_vpc.this.id

  tags = { Name = "${local.name_prefix}-private-${each.key}" }
}

resource "aws_eip" "nat" {
  domain = "vpc"

  depends_on = [aws_internet_gateway.this]
  tags       = { Name = "${local.name_prefix}-nat" }
}

resource "aws_nat_gateway" "this" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public["0"].id

  tags = { Name = local.name_prefix }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = { Name = "${local.name_prefix}-public" }
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  route_table_id = aws_route_table.public.id
  subnet_id      = each.value.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this.id
  }

  tags = { Name = "${local.name_prefix}-private" }
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  route_table_id = aws_route_table.private.id
  subnet_id      = each.value.id
}

resource "aws_security_group" "services" {
  name        = "${local.name_prefix}-services"
  description = "Private Control Plane service tasks"
  vpc_id      = aws_vpc.this.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "database" {
  name        = "${local.name_prefix}-database"
  description = "PostgreSQL access from Control Plane services"
  vpc_id      = aws_vpc.this.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.services.id]
  }
}

resource "aws_security_group" "cache" {
  name        = "${local.name_prefix}-cache"
  description = "Cache access from Control Plane services"
  vpc_id      = aws_vpc.this.id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.services.id]
  }
}

resource "aws_kms_key" "platform" {
  description             = "${local.name_prefix} application data"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "platform" {
  name          = "alias/${local.name_prefix}"
  target_key_id = aws_kms_key.platform.key_id
}

resource "aws_s3_bucket" "object_store" {
  bucket_prefix = "${local.name_prefix}-objects-"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "object_store" {
  bucket = aws_s3_bucket.object_store.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "object_store" {
  bucket = aws_s3_bucket.object_store.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.platform.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "object_store" {
  bucket = aws_s3_bucket.object_store.id

  versioning_configuration { status = "Enabled" }
}

resource "aws_db_subnet_group" "postgres" {
  name       = local.name_prefix
  subnet_ids = values(aws_subnet.private)[*].id
}

resource "aws_db_instance" "postgres" {
  identifier = local.name_prefix

  allocated_storage                   = 20
  backup_retention_period             = var.environment == "production" ? 14 : 3
  db_name                             = "control_plane"
  db_subnet_group_name                = aws_db_subnet_group.postgres.name
  deletion_protection                 = var.database_deletion_protection
  engine                              = "postgres"
  instance_class                      = var.database_instance_class
  kms_key_id                          = aws_kms_key.platform.arn
  manage_master_user_password         = true
  master_user_secret_kms_key_id       = aws_kms_key.platform.arn
  max_allocated_storage               = 100
  multi_az                            = var.database_multi_az
  performance_insights_enabled        = true
  performance_insights_kms_key_id     = aws_kms_key.platform.arn
  publicly_accessible                 = false
  final_snapshot_identifier           = var.environment == "production" ? "${local.name_prefix}-final" : null
  skip_final_snapshot                 = var.environment != "production"
  storage_encrypted                   = true
  username                            = "control_plane_admin"
  vpc_security_group_ids              = [aws_security_group.database.id]
  iam_database_authentication_enabled = true
}

resource "aws_elasticache_subnet_group" "cache" {
  name       = local.name_prefix
  subnet_ids = values(aws_subnet.private)[*].id
}

resource "aws_elasticache_replication_group" "cache" {
  replication_group_id = local.name_prefix
  description          = "${local.name_prefix} replaceable cache"

  at_rest_encryption_enabled = true
  automatic_failover_enabled = var.cache_nodes > 1
  engine                     = "valkey"
  kms_key_id                 = aws_kms_key.platform.arn
  node_type                  = var.cache_node_type
  num_cache_clusters         = var.cache_nodes
  port                       = 6379
  security_group_ids         = [aws_security_group.cache.id]
  subnet_group_name          = aws_elasticache_subnet_group.cache.name
  transit_encryption_enabled = true
}

resource "aws_ecs_cluster" "this" {
  name = local.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "services" {
  name              = "/${var.project_name}/${var.environment}/services"
  kms_key_id        = aws_kms_key.platform.arn
  retention_in_days = var.environment == "production" ? 90 : 14
}

resource "aws_ecr_repository" "services" {
  for_each = var.services

  name                 = "${var.project_name}/${var.environment}/${each.value}"
  image_tag_mutability = "IMMUTABLE"

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.platform.arn
  }

  image_scanning_configuration { scan_on_push = true }
}

resource "aws_secretsmanager_secret" "service" {
  for_each = local.secrets

  name       = "/${var.project_name}/${var.environment}/${each.value.service}/${each.value.name}"
  kms_key_id = aws_kms_key.platform.arn
}
