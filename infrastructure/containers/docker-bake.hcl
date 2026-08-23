variable "REGISTRY" {
  default = "control-plane"
}

variable "TAG" {
  default = "local"
}

group "default" {
  targets = [
    "control-api",
    "workflow-worker",
    "runtime-worker",
    "runtime-gateway",
    "tool-gateway",
  ]
}

target "_service" {
  context    = "."
  dockerfile = "infrastructure/containers/Dockerfile"
  target     = "runtime"
}

target "control-api" {
  inherits = ["_service"]
  args = {
    APP_NAME = "control-api"
  }
  tags = ["${REGISTRY}/control-api:${TAG}"]
}

target "workflow-worker" {
  inherits = ["_service"]
  args = {
    APP_NAME = "workflow-worker"
  }
  tags = ["${REGISTRY}/workflow-worker:${TAG}"]
}

target "runtime-worker" {
  inherits = ["_service"]
  args = {
    APP_NAME = "runtime-worker"
  }
  tags = ["${REGISTRY}/runtime-worker:${TAG}"]
}

target "runtime-gateway" {
  inherits = ["_service"]
  args = {
    APP_NAME = "runtime-gateway"
  }
  tags = ["${REGISTRY}/runtime-gateway:${TAG}"]
}

target "tool-gateway" {
  inherits = ["_service"]
  args = {
    APP_NAME = "tool-gateway"
  }
  tags = ["${REGISTRY}/tool-gateway:${TAG}"]
}

target "database-migrate" {
  inherits = ["_service"]
  target   = "migration"
  args = {
    APP_NAME = "control-api"
  }
  tags = ["${REGISTRY}/database-migrate:${TAG}"]
}
