provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = "production"
      ManagedBy   = "terraform"
      Project     = "control-plane"
    }
  }
}

module "environment" {
  source = "../../modules/environment"

  environment                  = "production"
  aws_region                   = var.aws_region
  vpc_cidr                     = "10.40.0.0/16"
  public_subnet_cidrs          = ["10.40.0.0/24", "10.40.1.0/24"]
  private_subnet_cidrs         = ["10.40.10.0/24", "10.40.11.0/24"]
  image_references             = var.image_references
  migration_image_reference    = var.migration_image_reference
  desired_counts               = var.desired_counts
  database_instance_class      = "db.t4g.medium"
  database_multi_az            = true
  database_deletion_protection = true
  cache_node_type              = "cache.t4g.small"
  cache_nodes                  = 2
  service_version              = var.service_version
  commit_sha                   = var.commit_sha
}
