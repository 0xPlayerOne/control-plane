variable "project_name" {
  description = "Stable infrastructure namespace."
  type        = string
  default     = "control-plane"
}

variable "environment" {
  description = "Isolated deployment environment."
  type        = string

  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "environment must be development, staging, or production."
  }
}

variable "aws_region" {
  description = "AWS region used to scope regional service principals."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR for the environment VPC."
  type        = string
}

variable "public_subnet_cidrs" {
  description = "Two or more public subnet CIDRs used only for managed egress."
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_cidrs) >= 2
    error_message = "At least two public subnet CIDRs are required."
  }
}

variable "private_subnet_cidrs" {
  description = "Two or more private subnet CIDRs for services and data stores."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_cidrs) == length(var.public_subnet_cidrs)
    error_message = "Private and public subnet counts must match."
  }
}

variable "services" {
  description = "Deployable service names requiring repositories and secret namespaces."
  type        = set(string)
}

variable "secret_names_by_service" {
  description = "Secret environment variable names. Values are populated outside Terraform."
  type        = map(set(string))
}

variable "database_instance_class" {
  description = "RDS instance class."
  type        = string
}

variable "database_engine_version" {
  description = "Exact PostgreSQL engine version approved by compatibility certification."
  type        = string
  default     = "18.3"

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+$", var.database_engine_version))
    error_message = "database_engine_version must pin an exact major.minor version."
  }
}

variable "database_multi_az" {
  description = "Whether RDS maintains a synchronous standby."
  type        = bool
}

variable "database_deletion_protection" {
  description = "Whether RDS deletion protection is enabled."
  type        = bool
}

variable "database_backup_retention_days" {
  description = "Automated PostgreSQL backup and point-in-time recovery window."
  type        = number

  validation {
    condition     = var.database_backup_retention_days >= 1 && var.database_backup_retention_days <= 35
    error_message = "database_backup_retention_days must be between 1 and 35."
  }
}

variable "cache_node_type" {
  description = "ElastiCache node type."
  type        = string
}

variable "cache_engine_version" {
  description = "Exact Valkey engine version approved by compatibility certification."
  type        = string
  default     = "8.0"

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+$", var.cache_engine_version))
    error_message = "cache_engine_version must pin an exact major.minor version."
  }
}

variable "cache_nodes" {
  description = "Number of cache nodes."
  type        = number

  validation {
    condition     = var.cache_nodes >= 1
    error_message = "cache_nodes must be at least one."
  }
}
