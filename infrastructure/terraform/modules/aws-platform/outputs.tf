output "cache_endpoint" {
  value = aws_elasticache_replication_group.cache.primary_endpoint_address
}

output "database_address" {
  value = aws_db_instance.postgres.address
}

output "database_master_secret_arn" {
  value     = aws_db_instance.postgres.master_user_secret[0].secret_arn
  sensitive = true
}

output "ecs_cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "image_repository_urls" {
  value = { for name, repository in aws_ecr_repository.services : name => repository.repository_url }
}

output "kms_key_arn" {
  value = aws_kms_key.platform.arn
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.services.name
}

output "operations_alarm_topic_arn" {
  value = aws_sns_topic.operations.arn
}

output "object_store_bucket" {
  value = aws_s3_bucket.object_store.id
}

output "object_store_bucket_arn" {
  value = aws_s3_bucket.object_store.arn
}

output "private_subnet_ids" {
  value = values(aws_subnet.private)[*].id
}

output "secret_arns_by_service" {
  value = {
    for service in keys(var.secret_names_by_service) : service => {
      for key, binding in local.secrets : binding.name => aws_secretsmanager_secret.service[key].arn
      if binding.service == service
    }
  }
}

output "service_security_group_id" {
  value = aws_security_group.services.id
}

output "database_client_security_group_id" {
  value = aws_security_group.database_clients.id
}

output "cache_client_security_group_id" {
  value = aws_security_group.cache_clients.id
}
