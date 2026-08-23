provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = "staging"
      ManagedBy   = "terraform"
      Project     = "control-plane"
    }
  }
}

module "environment" {
  source = "../../modules/environment"

  environment                  = "staging"
  aws_region                   = var.aws_region
  vpc_cidr                     = "10.30.0.0/16"
  public_subnet_cidrs          = ["10.30.0.0/24", "10.30.1.0/24"]
  private_subnet_cidrs         = ["10.30.10.0/24", "10.30.11.0/24"]
  image_references             = var.image_references
  migration_image_reference    = var.migration_image_reference
  desired_counts               = var.desired_counts
  database_instance_class      = "db.t4g.small"
  database_multi_az            = false
  database_deletion_protection = true
  cache_node_type              = "cache.t4g.small"
  cache_nodes                  = 1
  service_version              = var.service_version
  commit_sha                   = var.commit_sha
}
