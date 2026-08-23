variable "name" {
  description = "Deployment target name."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.name))
    error_message = "name must contain only lowercase letters, digits, and hyphens."
  }
}

variable "environment" {
  description = "Deployment environment."
  type        = string
}

variable "cluster_arn" {
  description = "ECS cluster ARN."
  type        = string
}

variable "image_reference" {
  description = "Immutable OCI image reference."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image_reference))
    error_message = "image_reference must be pinned by sha256 digest."
  }
}

variable "cpu" {
  description = "Fargate task CPU units."
  type        = number
}

variable "memory" {
  description = "Fargate task memory in MiB."
  type        = number
}

variable "desired_count" {
  description = "Desired service replica count."
  type        = number
  default     = 0
}

variable "create_service" {
  description = "Create a long-running ECS service when true."
  type        = bool
  default     = true
}

variable "command" {
  description = "Optional container command override."
  type        = list(string)
  default     = null
  nullable    = true
}

variable "container_port" {
  description = "Optional container port for gateway targets."
  type        = number
  default     = null
  nullable    = true
}

variable "health_check_command" {
  description = "Optional ECS container health command."
  type        = list(string)
  default     = null
  nullable    = true
}

variable "environment_variables" {
  description = "Non-secret container environment."
  type        = map(string)
  default     = {}
}

variable "secret_arns" {
  description = "Environment variable names mapped to Secrets Manager ARNs."
  type        = map(string)
  default     = {}
}

variable "kms_key_arn" {
  description = "KMS key used by task dependencies."
  type        = string
}

variable "object_store_bucket_arn" {
  description = "Object store bucket ARN available to the task."
  type        = string
}

variable "log_group_name" {
  description = "Shared CloudWatch log group."
  type        = string
}

variable "aws_region" {
  description = "AWS region for log configuration."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets for Fargate tasks."
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group for Fargate tasks."
  type        = string
}
