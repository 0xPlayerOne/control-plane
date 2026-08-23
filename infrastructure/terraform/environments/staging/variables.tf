variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "image_references" {
  description = "Digest-pinned deployment images."
  type        = map(string)
}

variable "migration_image_reference" {
  description = "Digest-pinned database migration image."
  type        = string
}

variable "desired_counts" {
  description = "Replica counts; enable targets only after their lifecycle is implemented."
  type        = map(number)
  default = {
    control-api     = 1
    workflow-worker = 0
    runtime-worker  = 0
    runtime-gateway = 0
    tool-gateway    = 0
  }
}

variable "service_version" {
  type = string
}

variable "commit_sha" {
  type = string
}
