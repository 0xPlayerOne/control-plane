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

variable "database_multi_az" {
  description = "Whether RDS maintains a synchronous standby."
  type        = bool
}

variable "database_deletion_protection" {
  description = "Whether RDS deletion protection is enabled."
  type        = bool
}

variable "cache_node_type" {
  description = "ElastiCache node type."
  type        = string
}

variable "cache_nodes" {
  description = "Number of cache nodes."
  type        = number

  validation {
    condition     = var.cache_nodes >= 1
    error_message = "cache_nodes must be at least one."
  }
}
