data "aws_iam_policy_document" "task_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      identifiers = ["ecs-tasks.amazonaws.com"]
      type        = "Service"
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "control-plane-${var.environment}-${var.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.task_assume_role.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "secret_access" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = values(var.secret_arns)
  }

  statement {
    actions   = ["kms:Decrypt"]
    resources = [var.kms_key_arn]
  }
}

resource "aws_iam_role_policy" "secret_access" {
  count = length(var.secret_arns) > 0 ? 1 : 0

  name   = "secret-access"
  policy = data.aws_iam_policy_document.secret_access.json
  role   = aws_iam_role.execution.id
}

resource "aws_iam_role" "task" {
  name               = "control-plane-${var.environment}-${var.name}-task"
  assume_role_policy = data.aws_iam_policy_document.task_assume_role.json
}

data "aws_iam_policy_document" "task_access" {
  dynamic "statement" {
    for_each = length(var.object_store_actions) > 0 ? [1] : []

    content {
      actions   = var.object_store_actions
      resources = [var.object_store_bucket_arn, "${var.object_store_bucket_arn}/*"]
    }
  }

  dynamic "statement" {
    for_each = length(var.object_store_actions) > 0 ? [1] : []

    content {
      actions   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"]
      resources = [var.kms_key_arn]
    }
  }
}

resource "aws_iam_role_policy" "task_access" {
  count = length(var.object_store_actions) > 0 ? 1 : 0

  name   = "platform-data-access"
  policy = data.aws_iam_policy_document.task_access.json
  role   = aws_iam_role.task.id
}

locals {
  container = merge(
    {
      environment = [
        for name, value in var.environment_variables : { name = name, value = value }
      ]
      essential = true
      image     = var.image_reference
      linuxParameters = {
        capabilities       = { drop = ["ALL"] }
        initProcessEnabled = true
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = var.log_group_name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = var.name
        }
      }
      name = var.name
      portMappings = var.container_port == null ? [] : [{
        containerPort = var.container_port
        hostPort      = var.container_port
        protocol      = "tcp"
      }]
      readonlyRootFilesystem = true
      secrets = [
        for name, value_from in var.secret_arns : { name = name, valueFrom = value_from }
      ]
    },
    var.command == null ? {} : { command = var.command },
    var.health_check_command == null ? {} : {
      healthCheck = {
        command     = var.health_check_command
        interval    = 30
        retries     = 3
        startPeriod = 20
        timeout     = 5
      }
    },
  )
}

resource "aws_ecs_task_definition" "this" {
  family                   = "control-plane-${var.environment}-${var.name}"
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions    = jsonencode([local.container])

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }
}

resource "aws_ecs_service" "this" {
  count = var.create_service ? 1 : 0

  name            = var.name
  cluster         = var.cluster_arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"
  task_definition = aws_ecs_task_definition.this.arn

  deployment_minimum_healthy_percent = var.environment == "production" ? 100 : 50
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    assign_public_ip = false
    security_groups  = var.security_group_ids
    subnets          = var.private_subnet_ids
  }

  enable_execute_command = false
  propagate_tags         = "SERVICE"
}

resource "aws_appautoscaling_target" "this" {
  count = var.create_service && var.maximum_capacity > 0 ? 1 : 0

  max_capacity       = var.maximum_capacity
  min_capacity       = var.minimum_capacity
  resource_id        = "service/${element(reverse(split("/", var.cluster_arn)), 0)}/${aws_ecs_service.this[0].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  count = length(aws_appautoscaling_target.this)

  name               = "${var.name}-cpu-target"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.this[0].resource_id
  scalable_dimension = aws_appautoscaling_target.this[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.this[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    target_value       = var.autoscaling_cpu_target
  }
}

resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  count = var.create_service ? 1 : 0

  alarm_name          = "control-plane-${var.environment}-${var.name}-cpu-high"
  alarm_description   = "${var.name} sustained CPU pressure"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 60
  statistic           = "Average"
  threshold           = 85
  treat_missing_data  = "breaching"
  alarm_actions       = [var.alarm_topic_arn]
  ok_actions          = [var.alarm_topic_arn]

  dimensions = {
    ClusterName = element(reverse(split("/", var.cluster_arn)), 0)
    ServiceName = aws_ecs_service.this[0].name
  }
}
