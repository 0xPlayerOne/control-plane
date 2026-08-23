output "database_migration_task_definition_arn" {
  description = "Task definition to run explicitly before a compatible service rollout."
  value       = module.database_migration.task_definition_arn
}

output "ecs_cluster_arn" {
  description = "Cluster on which services and explicit migration tasks run."
  value       = module.platform.ecs_cluster_arn
}

output "private_subnet_ids" {
  description = "Private subnets used by one-off operational tasks."
  value       = module.platform.private_subnet_ids
}

output "service_security_group_id" {
  description = "Security group used by services and one-off operational tasks."
  value       = module.platform.service_security_group_id
}

output "image_repository_urls" {
  description = "Authoritative immutable image repositories."
  value       = module.platform.image_repository_urls
}

output "service_task_definition_arns" {
  description = "Task definitions for the five long-running deployment targets."
  value       = { for name, service in module.services : name => service.task_definition_arn }
}

output "service_secret_arns" {
  description = "Secret shells whose values must be populated out of band."
  value       = module.platform.secret_arns_by_service
  sensitive   = true
}
