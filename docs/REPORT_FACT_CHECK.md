# PulseWatch: Academic Report Fact-Check & Verification Audit

This document provides a blunt, unvarnished audit of the claims made in `docs/ACADEMIC_REPORT.md`. It explicitly identifies every claim that is **not fully verified** or only **partially verified**, highlights where the academic report diverges from earlier project documentation (`docs/REPORT.md`, `docs/PROJECT_DOCUMENTATION.md`), documents build-time defect investigations and fixes moved out of the academic report, and provides the exact AWS Console navigation path and AWS CLI command to verify each item by hand.

---

## 1. Claims Not Fully Verified or Partially Verified

| # | Topic / Component | Report Claim | Ground Reality & Technical Limitation | How to Verify (Console & CLI) |
|---|---|---|---|---|
| **1** | **Amazon CloudFront** | Labeled `PARTIAL`. Report notes edge routing and OAC architecture, with fallback to S3 website + direct ALB. | CloudFront distribution was blocked by AWS Trust & Safety new-account verification. Fallback architecture is active: S3 static website hosting + direct ALB HTTP access restricted by operator IP CIDR. Edge caching and OAC are NOT active live. | **Console**: CloudFront -> Distributions.<br>**CLI**:<br>`aws cloudfront list-distributions --profile pulsewatch` |
| **2** | **RDS Multi-AZ Failover** | Labeled `PARTIAL`. Report notes high-availability database resilience. | Test was executed via `aws rds reboot-db-instance` on a single-AZ `db.t4g.micro` instance (`MultiAZ: false`). It proved that the application recovers connection pools in 64s, but it did **NOT** execute a physical synchronous standby failover across subnets/AZs. Converting to Multi-AZ was skipped to avoid 20+ minute EBS snapshot delays and extra AWS charges. | **Console**: RDS -> Databases -> `pulsewatch-db` -> Configuration (Check "Multi-AZ").<br>**CLI**:<br>`aws rds describe-db-instances --db-instance-identifier pulsewatch-db --query 'DBInstances[0].MultiAZ' --profile pulsewatch` |
| **3** | **RDS Read Replica Lag** | Labeled `PARTIAL`. Report notes asynchronous read scaling and replication lag metric. | Read Replica was initiated (`Status: "creating"`) and deleted immediately after 2 seconds to prevent student credit burn. CloudWatch metric `AWS/RDS ReplicaLag` was configured by name, but no numeric timeseries data was ever recorded or queried. | **Console**: RDS -> Databases (Verify only 1 instance exists).<br>**CLI**:<br>`aws rds describe-db-instances --query 'DBInstances[*].[DBInstanceIdentifier,Status]' --profile pulsewatch` |
| **4** | **Worker ASG Step Scaling** | Labeled `PARTIAL`. Report notes queue-depth elasticity scaling from 1 to 3 nodes. | CloudWatch step-scaling alarm was triggered during the 200-message stress test, but the verification query was executed at $T+25\text{s}$ before EC2 instances finished their 60–90s bootstrap into `InService`. Only 1 instance appeared in CLI output before instance termination testing was initiated. Self-healing was proven; 3-node concurrency was not captured in that specific CLI window. | **Console**: EC2 -> Auto Scaling Groups -> `pulsewatch-worker-asg` -> Activity.<br>**CLI**:<br>`aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names pulsewatch-worker-asg --query 'AutoScalingGroups[0].Instances[*].[InstanceId,LifecycleState]' --profile pulsewatch` |
| **5** | **AWS WAFv2 Web ACL** | Labeled `DEMONSTRATED`. Report notes Layer 7 edge filtering and SQLi/traversal rules. | WAF was deployed and tested briefly; directory traversal (`/etc/passwd`) returned HTTP 403, but synthetic SQLi probe (`' OR 1=1`) passed through because it was directed at an endpoint URL without query parameters. WAF was subsequently destroyed to eliminate the $5/month base + $1/rule hourly charge. WAF is currently NOT active in the running stack. | **Console**: WAF & Shield -> Web ACLs (Region: ap-south-1).<br>**CLI**:<br>`aws wafv2 list-web-acls --scope REGIONAL --region ap-south-1 --profile pulsewatch` |
| **6** | **S3 Lifecycle Transitions** | Labeled `LIVE`. Report notes 30d Standard-IA, 90d Glacier, and 365d expiration. | Bucket lifecycle configuration rules are active and verified in AWS, but physical object transitions to Standard-IA and Glacier have NOT occurred in real calendar time because the stack has been active for days, not 90+ days. | **Console**: S3 -> `pulsewatch-reports-8269-XXXX-8995` -> Management -> Lifecycle rules.<br>**CLI**:<br>`aws s3api get-bucket-lifecycle-configuration --bucket pulsewatch-reports-826903518995 --profile pulsewatch` |
| **7** | **DynamoDB TTL Expiration** | Labeled `LIVE`. Report notes 30-day automated TTL expiration on check records. | TTL is enabled and active (`TimeToLiveStatus: "ENABLED"` on attribute `ttl`), but background partition sweeping has not been observed over a full 30-day epoch. Records have expiration timestamps set, but automated deletion by AWS has not yet occurred. | **Console**: DynamoDB -> Tables -> `pulsewatch-checks` -> Additional settings -> Time to Live.<br>**CLI**:<br>`aws dynamodb describe-time-to-live --table-name pulsewatch-checks --profile pulsewatch` |
| **8** | **SNS Email Delivery** | Labeled `LIVE`. Report notes automated email dispatch on confirmed incident. | Initial test failed because subscription was in `PendingConfirmation`. Once confirmed by the user, email delivery functioned. If the email subscription is deleted or unconfirmed in a fresh deployment, SNS publishes will succeed silently with zero inbox delivery. | **Console**: SNS -> Topics -> `pulsewatch-alerts-topic` -> Subscriptions.<br>**CLI**:<br>`aws sns list-subscriptions-by-topic --topic-arn $(aws sns list-topics --query 'Topics[?contains(TopicArn,`pulsewatch-alerts-topic`)].TopicArn' --output text --profile pulsewatch) --profile pulsewatch` |
| **9** | **Incident GSI Queryability** | Labeled `LIVE`. Report notes UI queries `pulsewatch-incidents` via GSI `by_user`. | Early test runs failed to populate `user_id` on state items, causing DynamoDB sparse GSI indexing to omit incidents from UI queries. Fixed by writing explicit `INC#<ts>` records with `user_id`. Verified in latest test, but depends on Step Functions state machine payload contract. | **Console**: DynamoDB -> Tables -> `pulsewatch-incidents` -> Explore items.<br>**CLI**:<br>`aws dynamodb query --table-name pulsewatch-incidents --index-name by_user --key-condition-expression "user_id = :u" --expression-attribute-values '{":u":{"S":"test-user"}}' --profile pulsewatch` |
| **10**| **Outage & Recovery Latencies** | Empirical figures: Outage = 8.68s, Recovery = 9.18s. | Latencies were measured during a controlled outage test by stopping the Nginx service via SSM Run Command on a single target (`10.1.1.111`). Timings include Step Functions execution sleep cycles (5s recheck sleep, 15s recovery polling interval). | **Console**: Step Functions -> State machines -> `pulsewatch-incident-workflow` -> Executions -> Select execution -> Execution event history.<br>**CLI**:<br>`aws stepfunctions list-executions --state-machine-arn $(aws stepfunctions list-state-machines --query 'stateMachines[?name==`pulsewatch-incident-workflow`].stateMachineArn' --output text --profile pulsewatch) --max-items 5 --profile pulsewatch` |

---

## 2. Divergences from Earlier Project Documentation

| # | Topic | Earlier Docs (`REPORT.md`, `PROJECT_DOCUMENTATION.md`) | Academic Report (`ACADEMIC_REPORT.md`) | Reason for Change |
|---|---|---|---|---|
| **1** | **Infrastructure Tooling & Scripts** | Heavily featured Terraform modules (`infra/modules/*`), shell scripts (`pause.sh`, `resume.sh`, `demo-outage.sh`), and build timelines. | Completely omitted. No mention of Terraform, shell scripts, CLI commands, build history, or IDE tools. | Strict academic course specification: report must document only system architecture, AWS services, and operational mechanics. |
| **2** | **Service Status Categorization** | Described all components as active parts of a single running system. | Every AWS service is explicitly categorized as `LIVE`, `DEMONSTRATED`, `PARTIAL`, or `DOCUMENTATION-ONLY`. | Academic transparency: distinguishes between persistent services, cost-destroyed services, and theoretical syllabus mappings. |
| **3** | **External Attribution** | Mentioned concepts without formal academic citation. | Explicitly credits `github.com/Robibiruk/PulseWatch` for the failure threshold counter and incident state concepts using IEEE citation format. | Academic integrity requirements. |
| **4** | **S3 Reports Bucket Architecture** | Claimed reports were written to `pulsewatch-artifacts` bucket; noted lack of lifecycle policies. | Documents dedicated KMS-encrypted `pulsewatch-reports-8269-XXXX-8995` bucket with tiered lifecycle rules (30d IA, 90d Glacier, 365d expiration) and abort multipart uploads. | Reflects actual architecture fix implemented and verified in AWS. |
| **5** | **CloudFront & Ingress Security** | Stated CloudFront was fronting all traffic with TLS termination and OAC. | Discloses CloudFront as `PARTIAL` due to AWS Trust & Safety hold, documenting the active S3 website + direct ALB ingress with IP whitelisting as the operational fallback. | Strict alignment with live AWS reality. |
| **6** | **Redaction & Anonymization** | Contained raw AWS account ID (`826903518995`) and personal email address (`anandayush798@gmail.com`). | Account ID masked as `8269-XXXX-8995`; email address written as generic alert subscriber placeholder. | Prevents exposure of sensitive credentials and personal data in formal academic submission. |

---

## 3. Build-Time Defect Resolutions & Root Cause Analyses

*(Moved from the academic report to maintain pure focus on the final system architecture.)*

### 3.1 Unconfirmed SNS Alert Subscription (`PendingConfirmation`)
- **Symptom**: During early testing, Step Functions executed an outage workflow and published a `DOWN` message to Amazon SNS (`pulsewatch-alerts-topic`), but no alert email arrived in the operator's inbox.
- **Root Cause**: The Amazon SNS subscription for the alert recipient address had been created but was in `PendingConfirmation` status. Amazon SNS accepted the `sns:Publish` API call with HTTP 200 OK, but silently suppressed message delivery because the recipient had not clicked the confirmation link in the AWS subscription invitation email.
- **Resolution**: The confirmation email was re-sent, the verification link was confirmed, and subsequent alert deliveries succeeded within 0.39s of Step Functions publish invocation.

### 3.2 Missing UI Incidents & DynamoDB Sparse GSI Indexing
- **Symptom**: The web application Incidents dashboard (`#/incidents`) returned an empty list `[]` even after multiple confirmed outage tests.
- **Root Cause**: The backend API `/api/incidents` endpoint queries the DynamoDB `by_user` Global Secondary Index using `user_id = :uid`. The Step Functions state machine was writing items with partition key `monitor_id` and sort key `STATE`, but omitted the `user_id` attribute. In DynamoDB, Global Secondary Indexes are sparse: items that lack the GSI partition key attribute are completely excluded from the index.
- **Resolution**: Updated the Step Functions `ConfirmDownState` step definition to explicitly write a separate historical incident record `item_id = INC#<timestamp>` containing both `user_id` and `monitor_id`. The GSI immediately indexed the records and returned them to the frontend.

### 3.3 Stale Step Functions Workflow Executions & State Locks
- **Symptom**: Following an abrupt test interruption or compute pause, subsequent controlled outage tests failed to trigger alert workflows.
- **Root Cause**: The Step Functions state machine performs an atomic conditional update on `pulsewatch-incidents` (`item_id = STATE`, condition: `attribute_not_exists(state) OR state = 'UP'`). If an earlier execution was stopped abruptly while paused in a 15-second recovery wait loop or waiting for an SQS task token, the database record remained locked in `SUSPECTED` or `DOWN` status, causing subsequent workflow attempts to branch to `AlreadyHandlingOutage`.
- **Resolution**: Established operational checks to ensure all active Step Functions executions are stopped and cleared stale `STATE` items upon stack startup.

---

## 4. Quick-Check Manual Verification Commands

Run these five commands with AWS CLI profile `pulsewatch` (`ap-south-1`) to verify the core claims instantly:

```bash
# 1. Verify Core Live Services (ALB, RDS, DynamoDB, SQS, Step Functions)
aws elbv2 describe-load-balancers --names pulsewatch-alb --query 'LoadBalancers[0].State.Code' --profile pulsewatch
aws rds describe-db-instances --db-instance-identifier pulsewatch-db --query 'DBInstances[0].DBInstanceStatus' --profile pulsewatch
aws dynamodb describe-table --table-name pulsewatch-checks --query 'Table.TableStatus' --profile pulsewatch
aws sqs get-queue-attributes --queue-url $(aws sqs get-queue-url --queue-name pulsewatch-check-queue --query 'QueueUrl' --output text --profile pulsewatch) --attribute-names ApproximateNumberOfMessages --profile pulsewatch
aws stepfunctions describe-state-machine --state-machine-arn $(aws stepfunctions list-state-machines --query 'stateMachines[?name==`pulsewatch-incident-workflow`].stateMachineArn' --output text --profile pulsewatch) --query 'status' --profile pulsewatch

# 2. Verify S3 Reports Bucket Lifecycle Rules
aws s3api get-bucket-lifecycle-configuration --bucket pulsewatch-reports-826903518995 --profile pulsewatch

# 3. Verify KMS Key Alias & Encryption State
aws kms describe-key --key-id alias/pulsewatch-kms --query 'KeyMetadata.[KeyId,KeyState,Enabled]' --profile pulsewatch

# 4. Verify Single-AZ Reality of RDS Instance (Partial Multi-AZ Claim)
aws rds describe-db-instances --db-instance-identifier pulsewatch-db --query 'DBInstances[0].[DBInstanceIdentifier,MultiAZ,AvailabilityZone]' --profile pulsewatch

# 5. Verify Absence of Active WAF (Demonstrated Status)
aws wafv2 list-web-acls --scope REGIONAL --region ap-south-1 --profile pulsewatch
```
