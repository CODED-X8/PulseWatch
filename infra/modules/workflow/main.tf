variable "aws_region" { type = string }
variable "account_id" { type = string }
variable "environment" { type = string }
variable "checks_stream_arn" { type = string }
variable "incidents_table_name" { type = string }
variable "check_queue_url" { type = string }
variable "check_queue_arn" { type = string }
variable "alerts_topic_arn" { type = string }
variable "kms_key_arn" { type = string }
variable "recheck_wait_seconds" {
  type        = number
  default     = 5
  description = "Wait time in seconds before executing outage recheck probe"
}
variable "recheck_count" {
  type        = number
  default     = 1
  description = "Number of re-check attempts by the worker fleet before confirming outage"
}
variable "recovery_poll_seconds" {
  type        = number
  default     = 15
  description = "Polling interval in seconds between recovery checks"
}

# -------------------------------------------------------------
# 1. Lambda: DynamoDB Stream Filter to trigger Step Functions
# -------------------------------------------------------------

data "archive_file" "lambda_zip" {
  type        = "zip"
  source_file = "${path.module}/lambda/filter.py"
  output_path = "${path.module}/lambda/filter.zip"
}

resource "aws_iam_role" "lambda_stream_role" {
  name = "pulsewatch-stream-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_stream_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_stream_policy" {
  name = "pulsewatch-stream-filter-policy"
  role = aws_iam_role.lambda_stream_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DynamoDBStreamRead"
        Effect = "Allow"
        Action = [
          "dynamodb:GetRecords",
          "dynamodb:GetShardIterator",
          "dynamodb:DescribeStream",
          "dynamodb:ListStreams"
        ]
        Resource = var.checks_stream_arn
      },
      {
        Sid    = "StepFunctionsExecution"
        Effect = "Allow"
        Action = [
          "states:StartExecution"
        ]
        Resource = aws_sfn_state_machine.incident_workflow.arn
      },
      {
        Sid    = "KMSDecryptAccess"
        Effect = "Allow"
        Action = [
          "kms:Decrypt"
        ]
        Resource = var.kms_key_arn
      }
    ]
  })
}

resource "aws_lambda_function" "stream_filter" {
  function_name    = "pulsewatch-stream-filter"
  role             = aws_iam_role.lambda_stream_role.arn
  handler          = "filter.lambda_handler"
  runtime          = "python3.12"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  timeout          = 30
  memory_size      = 128

  environment {
    variables = {
      STATE_MACHINE_ARN = aws_sfn_state_machine.incident_workflow.arn
    }
  }

  tags = { Name = "pulsewatch-stream-filter" }
}

resource "aws_lambda_event_source_mapping" "dynamodb_stream" {
  event_source_arn                   = var.checks_stream_arn
  function_name                      = aws_lambda_function.stream_filter.arn
  starting_position                  = "LATEST"
  batch_size                         = 5
  maximum_batching_window_in_seconds = 2
}

# -------------------------------------------------------------
# 2. Step Functions: Outage Re-verification by the Worker Fleet
# -------------------------------------------------------------

resource "aws_iam_role" "sfn_role" {
  name = "pulsewatch-sfn-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "states.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "sfn_policy" {
  name = "pulsewatch-sfn-execution-policy"
  role = aws_iam_role.sfn_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DynamoDBIncidentsAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:GetItem",
          "dynamodb:DeleteItem"
        ]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.account_id}:table/${var.incidents_table_name}*"
      },
      {
        Sid    = "SQSSendRecheckTask"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage"
        ]
        Resource = var.check_queue_arn
      },
      {
        Sid    = "SNSPublishAlert"
        Effect = "Allow"
        Action = [
          "sns:Publish"
        ]
        Resource = var.alerts_topic_arn
      },
      {
        Sid    = "KMSCryptographicAccess"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey*"
        ]
        Resource = var.kms_key_arn
      }
    ]
  })
}

resource "aws_sfn_state_machine" "incident_workflow" {
  name     = "pulsewatch-incident-workflow"
  role_arn = aws_iam_role.sfn_role.arn

  definition = jsonencode({
    Comment = "PulseWatch Simplified Alert Workflow: 1 SQS Re-check, Instant Outage Confirmation, and Polling Recovery"
    StartAt = "MarkSuspected"
    States = {
      MarkSuspected = {
        Type     = "Task"
        Resource = "arn:aws:states:::dynamodb:updateItem"
        Parameters = {
          TableName = var.incidents_table_name
          Key = {
            "monitor_id" = { "S.$" = "$.monitorId" }
            "item_id"    = { "S"   = "STATE" }
          }
          UpdateExpression          = "SET #st = :susp, startedAt = :ts, monitorUrl = :url, monitorName = :name, userId = :uid, initialError = :err"
          ConditionExpression       = "attribute_not_exists(#st) OR #st = :up"
          ExpressionAttributeNames  = { "#st" = "state" }
          ExpressionAttributeValues = {
            ":susp" = { "S" = "SUSPECTED" }
            ":up"   = { "S" = "UP" }
            ":ts"   = { "S.$" = "States.Format('{}', $.startedAt)" }
            ":url"  = { "S.$" = "$.url" }
            ":name" = { "S.$" = "$.monitorName" }
            ":uid"  = { "S.$" = "$.userId" }
            ":err"  = { "S.$" = "$.error" }
          }
        }
        ResultPath = "$.suspectResult"
        Catch = [
          {
            ErrorEquals = ["DynamoDB.ConditionalCheckFailedException"]
            Next        = "AlreadyHandlingOutage"
          }
        ]
        Next = "WaitBeforeRecheck"
      }

      AlreadyHandlingOutage = {
        Type = "Succeed"
      }

      WaitBeforeRecheck = {
        Type    = "Wait"
        Seconds = var.recheck_wait_seconds
        Next    = "ExecuteRecheck"
      }

      ExecuteRecheck = {
        Type           = "Task"
        Resource       = "arn:aws:states:::sqs:sendMessage.waitForTaskToken"
        TimeoutSeconds = 45
        Parameters = {
          QueueUrl = var.check_queue_url
          MessageBody = {
            "type"           = "recheck"
            "monitorId.$"    = "$.monitorId"
            "url.$"          = "$.url"
            "expectedStatus" = 200
            "timeoutSec"     = 5
            "taskToken.$"    = "$$.Task.Token"
          }
        }
        ResultPath = "$.recheck"
        Retry = [
          {
            ErrorEquals     = ["SQS.AmazonSQSException", "States.Timeout"]
            IntervalSeconds = 2
            MaxAttempts     = 2
            BackoffRate     = 2.0
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            ResultPath  = "$.recheckError"
            Next        = "ConfirmDownState"
          }
        ]
        Next = "EvaluateRecheck"
      }

      EvaluateRecheck = {
        Type = "Choice"
        Choices = [
          {
            Variable      = "$.recheck.ok"
            BooleanEquals = true
            Next          = "ResolveTransient"
          }
        ]
        Default = "ConfirmDownState"
      }

      ResolveTransient = {
        Type     = "Task"
        Resource = "arn:aws:states:::dynamodb:updateItem"
        Parameters = {
          TableName = var.incidents_table_name
          Key = {
            "monitor_id" = { "S.$" = "$.monitorId" }
            "item_id"    = { "S"   = "STATE" }
          }
          UpdateExpression          = "SET #st = :up"
          ExpressionAttributeNames  = { "#st" = "state" }
          ExpressionAttributeValues = { ":up" = { "S" = "UP" } }
        }
        ResultPath = "$.resolveTransientResult"
        Next       = "TransientResolved"
      }

      TransientResolved = {
        Type = "Succeed"
      }

      ConfirmDownState = {
        Type     = "Task"
        Resource = "arn:aws:states:::dynamodb:updateItem"
        Parameters = {
          TableName = var.incidents_table_name
          Key = {
            "monitor_id" = { "S.$" = "$.monitorId" }
            "item_id"    = { "S"   = "STATE" }
          }
          UpdateExpression          = "SET #st = :down, confirmedAt = :ts"
          ExpressionAttributeNames  = { "#st" = "state" }
          ExpressionAttributeValues = {
            ":down" = { "S" = "DOWN" }
            ":ts"   = { "S.$" = "States.Format('{}', $.startedAt)" }
          }
        }
        ResultPath = "$.confirmDownResult"
        Next       = "RecordIncidentForUI"
      }

      RecordIncidentForUI = {
        Type     = "Task"
        Resource = "arn:aws:states:::dynamodb:putItem"
        Parameters = {
          TableName = var.incidents_table_name
          Item = {
            "monitor_id"  = { "S.$" = "$.monitorId" }
            "item_id"     = { "S.$" = "States.Format('INC#{}', $.startedAt)" }
            "incidentId"  = { "S.$" = "States.Format('inc-{}', $.startedAt)" }
            "user_id"     = { "S.$" = "$.userId" }
            "monitorName" = { "S.$" = "$.monitorName" }
            "startedAt"   = { "S.$" = "States.Format('{}', $.startedAt)" }
            "state"       = { "S"   = "CONFIRMED" }
            "rootCause"   = { "S.$" = "$.error" }
          }
        }
        ResultPath = "$.recordIncidentResult"
        Next       = "SendDownAlert"
      }

      SendDownAlert = {
        Type     = "Task"
        Resource = "arn:aws:states:::sns:publish"
        Parameters = {
          TopicArn    = var.alerts_topic_arn
          "Subject.$" = "States.Format('[CRITICAL] PulseWatch Outage Alert: {}', $.monitorName)"
          "Message.$" = "States.Format('CRITICAL ALERT: PulseWatch has confirmed an outage for {}.\n\nMonitor Details:\n- Name: {}\n- URL: {}\n- Incident ID: inc-{}\n- Started At (Unix): {}\n\nFailure Breakdown:\n- Scheduled Probe 1: {}\n- Fleet Re-check 2: Failed / Non-200\n\nThe service has been marked DOWN and recovery polling is active.', $.monitorName, $.monitorName, $.url, $.startedAt, $.startedAt, $.error)"
        }
        ResultPath = "$.snsDownResult"
        Next       = "InitRecovery"
      }

      InitRecovery = {
        Type = "Pass"
        Parameters = {
          "monitorId.$"   = "$.monitorId"
          "userId.$"      = "$.userId"
          "monitorName.$" = "$.monitorName"
          "url.$"         = "$.url"
          "error.$"       = "$.error"
          "startedAt.$"   = "$.startedAt"
          "recoveryCount" = 0
        }
        Next = "WaitRecovery"
      }

      WaitRecovery = {
        Type    = "Wait"
        Seconds = var.recovery_poll_seconds
        Next    = "RecoveryCheck"
      }

      RecoveryCheck = {
        Type           = "Task"
        Resource       = "arn:aws:states:::sqs:sendMessage.waitForTaskToken"
        TimeoutSeconds = 45
        Parameters = {
          QueueUrl = var.check_queue_url
          MessageBody = {
            "type"           = "recheck"
            "monitorId.$"    = "$.monitorId"
            "url.$"          = "$.url"
            "expectedStatus" = 200
            "timeoutSec"     = 5
            "taskToken.$"    = "$$.Task.Token"
          }
        }
        ResultPath = "$.recoveryCheck"
        Retry = [
          {
            ErrorEquals     = ["SQS.AmazonSQSException", "States.Timeout"]
            IntervalSeconds = 2
            MaxAttempts     = 2
            BackoffRate     = 2.0
          }
        ]
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            Next        = "IncrementRecovery"
          }
        ]
        Next = "EvaluateRecovery"
      }

      EvaluateRecovery = {
        Type = "Choice"
        Choices = [
          {
            Variable      = "$.recoveryCheck.ok"
            BooleanEquals = true
            Next          = "MarkResolved"
          }
        ]
        Default = "IncrementRecovery"
      }

      IncrementRecovery = {
        Type = "Pass"
        Parameters = {
          "monitorId.$"     = "$.monitorId"
          "userId.$"        = "$.userId"
          "monitorName.$"   = "$.monitorName"
          "url.$"           = "$.url"
          "error.$"         = "$.error"
          "startedAt.$"     = "$.startedAt"
          "recoveryCount.$" = "States.MathAdd($.recoveryCount, 1)"
        }
        Next = "CheckRecoveryCap"
      }

      CheckRecoveryCap = {
        Type = "Choice"
        Choices = [
          {
            Variable                 = "$.recoveryCount"
            NumericGreaterThanEquals = 300
            Next                     = "MaxRecoveryExceeded"
          },
          {
            Variable      = "$.recoveryCount"
            NumericEquals = 60
            Next          = "SendStillDownReminder"
          },
          {
            Variable      = "$.recoveryCount"
            NumericEquals = 120
            Next          = "SendStillDownReminder"
          },
          {
            Variable      = "$.recoveryCount"
            NumericEquals = 180
            Next          = "SendStillDownReminder"
          },
          {
            Variable      = "$.recoveryCount"
            NumericEquals = 240
            Next          = "SendStillDownReminder"
          }
        ]
        Default = "WaitRecovery"
      }

      SendStillDownReminder = {
        Type     = "Task"
        Resource = "arn:aws:states:::sns:publish"
        Parameters = {
          TopicArn    = var.alerts_topic_arn
          "Subject.$" = "States.Format('[REMINDER] PulseWatch Outage Ongoing: {}', $.monitorName)"
          "Message.$" = "States.Format('OUTAGE REMINDER: Target {} ({}) is STILL DOWN after {} automated recovery probe cycles. Polling continues.', $.monitorName, $.url, $.recoveryCount)"
        }
        ResultPath = "$.reminderResult"
        Next       = "WaitRecovery"
      }

      MaxRecoveryExceeded = {
        Type     = "Task"
        Resource = "arn:aws:states:::sns:publish"
        Parameters = {
          TopicArn    = var.alerts_topic_arn
          "Subject.$" = "States.Format('[ESCALATION] PulseWatch Outage Polling Cap Exceeded: {}', $.monitorName)"
          "Message.$" = "States.Format('ESCALATION: Target {} ({}) has been DOWN for 300 cycles (~1.25 hours at 15s intervals). Automated polling halted. Manual engineer intervention required.', $.monitorName, $.url)"
        }
        ResultPath = "$.escalationResult"
        Next       = "OutageHalted"
      }

      OutageHalted = {
        Type = "Succeed"
      }

      MarkResolved = {
        Type     = "Task"
        Resource = "arn:aws:states:::dynamodb:updateItem"
        Parameters = {
          TableName = var.incidents_table_name
          Key = {
            "monitor_id" = { "S.$" = "$.monitorId" }
            "item_id"    = { "S"   = "STATE" }
          }
          UpdateExpression          = "SET #st = :up, resolvedAt = :ts"
          ExpressionAttributeNames  = { "#st" = "state" }
          ExpressionAttributeValues = {
            ":up" = { "S" = "UP" }
            ":ts" = { "S.$" = "$$.State.EnteredTime" }
          }
        }
        ResultPath = "$.resolveResult"
        Next       = "UpdateIncidentRecordResolved"
      }

      UpdateIncidentRecordResolved = {
        Type     = "Task"
        Resource = "arn:aws:states:::dynamodb:updateItem"
        Parameters = {
          TableName = var.incidents_table_name
          Key = {
            "monitor_id" = { "S.$" = "$.monitorId" }
            "item_id"    = { "S.$" = "States.Format('INC#{}', $.startedAt)" }
          }
          UpdateExpression          = "SET #st = :res, resolvedAt = :ts"
          ExpressionAttributeNames  = { "#st" = "state" }
          ExpressionAttributeValues = {
            ":res" = { "S" = "RESOLVED" }
            ":ts"  = { "S.$" = "$$.State.EnteredTime" }
          }
        }
        ResultPath = "$.updateIncidentResult"
        Next       = "SendRecoveryAlert"
      }

      SendRecoveryAlert = {
        Type     = "Task"
        Resource = "arn:aws:states:::sns:publish"
        Parameters = {
          TopicArn    = var.alerts_topic_arn
          "Subject.$" = "States.Format('[RESOLVED] PulseWatch Recovery Alert: {}', $.monitorName)"
          "Message.$" = "States.Format('OUTAGE RESOLVED: Target {} ({}) has recovered and is returning HTTP 200.\n\nIncident Summary:\n- Monitor Name: {}\n- URL: {}\n- Incident ID: inc-{}\n- Status: RESOLVED\n- Recovery Check Cycles: {}\n- Polling Interval: 15s per cycle', $.monitorName, $.url, $.monitorName, $.url, $.startedAt, $.recoveryCount)"
        }
        ResultPath = "$.snsRecoveryResult"
        Next       = "OutageResolved"
      }

      OutageResolved = {
        Type = "Succeed"
      }
    }
  })

  tags = { Name = "pulsewatch-incident-workflow" }
}

output "state_machine_arn" { value = aws_sfn_state_machine.incident_workflow.arn }
output "lambda_stream_filter_arn" { value = aws_lambda_function.stream_filter.arn }
