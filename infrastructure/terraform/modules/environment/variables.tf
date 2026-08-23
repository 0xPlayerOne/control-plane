variable "environment" {
  description = "Isolated deployment environment."
  type        = string

  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "environment must be development, staging, or production."
  }
}

variable "aws_region" {
  description = "AWS region for this environment."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR for the environment VPC."
  type        = string
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDRs used for managed egress."
  type        = list(string)
}

variable "private_subnet_cidrs" {
  description = "Private subnet CIDRs used for services and data stores."
  type        = list(string)
}

variable "image_references" {
  description = "Digest-pinned OCI images for every long-running deployment target."
  type        = map(string)

  validation {
    condition = alltrue([
      for service in ["control-api", "workflow-worker", "runtime-worker", "runtime-gateway", "tool-gateway"] :
      contains(keys(var.image_references), service) && can(regex("@sha256:[0-9a-f]{64}$", var.image_references[service]))
    ])
    error_message = "image_references must contain a sha256-pinned image for every deployment target."
  }
}

variable "migration_image_reference" {
  description = "Digest-pinned database migration image."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.migration_image_reference))
    error_message = "migration_image_reference must be pinned by sha256 digest."
  }
}

variable "desired_counts" {
  description = "Replica count for each long-running deployment target."
  type        = map(number)

  validation {
    condition = alltrue([
      for service in ["control-api", "workflow-worker", "runtime-worker", "runtime-gateway", "tool-gateway"] :
      contains(keys(var.desired_counts), service) && var.desired_counts[service] >= 0
    ])
    error_message = "desired_counts must contain a non-negative count for every deployment target."
  }
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
}

variable "service_version" {
  description = "Release version exposed to service health and telemetry."
  type        = string
}

variable "commit_sha" {
  description = "Source revision exposed to service health and telemetry."
  type        = string
}
