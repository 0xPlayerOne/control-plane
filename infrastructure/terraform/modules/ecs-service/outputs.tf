output "service_arn" {
  value = var.create_service ? aws_ecs_service.this[0].id : null
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.this.arn
}
