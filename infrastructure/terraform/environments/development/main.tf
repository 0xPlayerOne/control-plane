provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = "development"
      ManagedBy   = "terraform"
      Project     = "control-plane"
    }
  }
}

module "environment" {
  source = "../../modules/environment"

  environment                    = "development"
  aws_region                     = var.aws_region
  vpc_cidr                       = "10.20.0.0/16"
  public_subnet_cidrs            = ["10.20.0.0/24", "10.20.1.0/24"]
  private_subnet_cidrs           = ["10.20.10.0/24", "10.20.11.0/24"]
  image_references               = var.image_references
  migration_image_reference      = var.migration_image_reference
  desired_counts                 = var.desired_counts
  database_instance_class        = "db.t4g.micro"
  database_multi_az              = false
  database_deletion_protection   = false
  database_backup_retention_days = 3
  cache_node_type                = "cache.t4g.micro"
  cache_nodes                    = 1
  service_version                = var.service_version
  commit_sha                     = var.commit_sha
}
