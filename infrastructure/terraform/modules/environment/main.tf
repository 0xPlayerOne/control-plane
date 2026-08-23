locals {
  service_names = toset([
    "control-api",
    "workflow-worker",
    "runtime-worker",
    "runtime-gateway",
    "tool-gateway",
  ])

  service_configuration = {
    control-api = {
      cpu            = 512
      memory         = 1024
      container_port = 3000
      health_check   = ["CMD-SHELL", "bun -e 'await fetch(\"http://127.0.0.1:3000/health\").then(r=>{if(!r.ok)process.exit(1)})'"]
    }
    workflow-worker = {
      cpu            = 512
      memory         = 1024
      container_port = null
      health_check   = null
    }
    runtime-worker = {
      cpu            = 1024
      memory         = 2048
      container_port = null
      health_check   = null
    }
    runtime-gateway = {
      cpu            = 512
      memory         = 1024
      container_port = null
      health_check   = null
    }
    tool-gateway = {
      cpu            = 512
      memory         = 1024
      container_port = null
      health_check   = null
    }
  }

  secret_names_by_service = {
    control-api      = ["DATABASE_URL", "SERVICE_CREDENTIALS"]
    workflow-worker  = ["DATABASE_URL", "SERVICE_CREDENTIALS"]
    runtime-worker   = ["DATABASE_URL", "SERVICE_CREDENTIALS"]
    runtime-gateway  = ["SERVICE_CREDENTIALS"]
    tool-gateway     = ["SERVICE_CREDENTIALS"]
    database-migrate = ["DATABASE_MIGRATION_URL"]
  }
}

module "platform" {
  source = "../aws-platform"

  aws_region                   = var.aws_region
  environment                  = var.environment
  vpc_cidr                     = var.vpc_cidr
  public_subnet_cidrs          = var.public_subnet_cidrs
  private_subnet_cidrs         = var.private_subnet_cidrs
  services                     = local.service_names
  secret_names_by_service      = local.secret_names_by_service
  database_instance_class      = var.database_instance_class
  database_multi_az            = var.database_multi_az
  database_deletion_protection = var.database_deletion_protection
  cache_node_type              = var.cache_node_type
  cache_nodes                  = var.cache_nodes
}

module "services" {
  for_each = local.service_configuration
  source   = "../ecs-service"

  name                 = each.key
  environment          = var.environment
  cluster_arn          = module.platform.ecs_cluster_arn
  image_reference      = var.image_references[each.key]
  cpu                  = each.value.cpu
  memory               = each.value.memory
  desired_count        = var.desired_counts[each.key]
  container_port       = each.value.container_port
  health_check_command = each.value.health_check

  environment_variables = {
    APP_ENV             = var.environment
    COMMIT_SHA          = var.commit_sha
    SERVICE_VERSION     = var.service_version
    CACHE_ENDPOINT      = module.platform.cache_endpoint
    DATABASE_HOST       = module.platform.database_address
    OBJECT_STORE_BUCKET = module.platform.object_store_bucket
  }
  secret_arns             = module.platform.secret_arns_by_service[each.key]
  kms_key_arn             = module.platform.kms_key_arn
  object_store_bucket_arn = module.platform.object_store_bucket_arn
  log_group_name          = module.platform.log_group_name
  aws_region              = var.aws_region
  private_subnet_ids      = module.platform.private_subnet_ids
  security_group_id       = module.platform.service_security_group_id
}

module "database_migration" {
  source = "../ecs-service"

  name                    = "database-migrate"
  environment             = var.environment
  cluster_arn             = module.platform.ecs_cluster_arn
  image_reference         = var.migration_image_reference
  cpu                     = 512
  memory                  = 1024
  create_service          = false
  environment_variables   = { APP_ENV = var.environment }
  secret_arns             = module.platform.secret_arns_by_service["database-migrate"]
  kms_key_arn             = module.platform.kms_key_arn
  object_store_bucket_arn = module.platform.object_store_bucket_arn
  log_group_name          = module.platform.log_group_name
  aws_region              = var.aws_region
  private_subnet_ids      = module.platform.private_subnet_ids
  security_group_id       = module.platform.service_security_group_id
}
