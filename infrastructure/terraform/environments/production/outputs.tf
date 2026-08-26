output "database_migration_task_definition_arn" {
  value = module.environment.database_migration_task_definition_arn
}

output "ecs_cluster_arn" {
  value = module.environment.ecs_cluster_arn
}

output "private_subnet_ids" {
  value = module.environment.private_subnet_ids
}

output "service_security_group_id" {
  value = module.environment.service_security_group_id
}

output "database_client_security_group_id" {
  value = module.environment.database_client_security_group_id
}

output "operations_alarm_topic_arn" {
  value = module.environment.operations_alarm_topic_arn
}

output "service_task_definition_arns" {
  value = module.environment.service_task_definition_arns
}
