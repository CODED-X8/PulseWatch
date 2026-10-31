import json
import os
import boto3

SFN_ARN = os.environ.get("STATE_MACHINE_ARN", "")
sfn_client = boto3.client("stepfunctions")

def lambda_handler(event, context):
    print(f"Received DynamoDB Stream event with {len(event.get('Records', []))} records")
    for record in event.get("Records", []):
        if record.get("eventName") != "INSERT":
            continue
        
        new_image = record.get("dynamodb", {}).get("NewImage", {})
        status = new_image.get("status", {}).get("S", "")
        source = new_image.get("source", {}).get("S", "")

        # Only trigger outage workflow when a scheduled probe marks target DOWN
        if status == "down" and source == "scheduled":
            monitor_id = new_image.get("monitor_id", {}).get("S", "")
            ts = int(new_image.get("ts", {}).get("N", "0"))
            error = new_image.get("error", {}).get("S", "Synthetic probe failed")
            url = new_image.get("url", {}).get("S", "")
            user_id = new_image.get("user_id", {}).get("S", "b946825c-fd81-4cb0-ae40-2a99d66c6c44")
            monitor_name = new_image.get("monitor_name", {}).get("S", "Monitored Service")

            # Generate unique execution name (max 80 chars)
            exec_name = f"inc-{monitor_id[:16]}-{ts}"
            print(f"Triggering Step Functions workflow for monitor {monitor_id} at {ts}")

            try:
                sfn_client.start_execution(
                    stateMachineArn=SFN_ARN,
                    name=exec_name,
                    input=json.dumps({
                        "monitorId": monitor_id,
                        "userId": user_id,
                        "monitorName": monitor_name,
                        "url": url,
                        "error": error,
                        "startedAt": ts
                    })
                )
            except sfn_client.exceptions.ExecutionAlreadyExists:
                print(f"Execution {exec_name} already exists, skipping duplicate trigger.")
            except Exception as e:
                print(f"Failed to start Step Functions execution: {e}")
                raise e

    return {"statusCode": 200, "body": "OK"}
