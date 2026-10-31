# PulseWatch Production AWS Architecture & Implementation Plan

## 1. System Architecture Overview

PulseWatch is a distributed, high-precision website and API uptime monitoring platform architected on Amazon Web Services (AWS) in region **ap-south-1** (Mumbai). It provides resilient synthetic endpoint checks, multi-AZ outage verification using AWS Step Functions, and high-performance serverless edge delivery via Amazon CloudFront and Amazon S3.

### 1.1 Architecture Diagram

```
                              [ User Browser ]
                                     |
                                     v
                      +-----------------------------+
                      |      Amazon CloudFront      |
                      |   (Edge TLS, Default Cert)  |
                      +--------------+--------------+
                                     |
              +----------------------+----------------------+
              | Path: /*                                    | Path: /api/*
              v                                             v
  +-----------------------+                    +-------------------------+
  |   Private S3 Bucket   |                    |   ALB (Public Subnets)  |
  |  (SPA Static Assets)  |                    |  - CloudFront Prefix SG |
  |  - Origin Access Ctrl |                    |  - Secret Header Check  |
  +-----------------------+                    +------------+------------+
                                                            |
                                                            v
                                               +-------------------------+
                                               |     EC2 API ASG (1-2)   |
                                               |  FastAPI + Scheduler    |
                                               |  - SSM Session Manager  |
                                               |  - S3 Endpoint Access   |
                                               +------+------------+-----+
                                                      |            |
                     +--------------------------------+            |
                     | Enqueue probe jobs                          | Claim monitors
                     v                                             v
          +---------------------+                      +----------------------+
          |   Amazon SQS + DLQ  |                      | Amazon RDS PostgreSQL|
          |  (Check Job Buffer) |                      | (Private Subnets)    |
          +----------+----------+                      | Single-AZ db.t4g/t3  |
                     |                                 +----------------------+
                     v
          +---------------------+
          |  Worker ASG (1-3)   |
          |  Pings Targets      |
          |  - Step Scaling     |
          |  - SSRF Allowlist   |
          +----------+----------+
                     |
         +-----------+-----------+
         | Write check results   | Ping victim over Peered VPC
         v                       v
+------------------+    +-----------------------+
| Amazon DynamoDB  |    |     Victim VPC        |
| - checks (TTL)   |    | (Nginx + Self-hosted  |
| - incidents      |    |  Postgres on EC2)     |
+--------+---------+    +-----------------------+
         |
         | DynamoDB Streams (INSERT down)
         v
+------------------+
| Python Lambda    | (Outside VPC, ~15 lines)
+--------+---------+
         |
         | StartExecution
         v
+-----------------------------------------------------------+
|                   AWS Step Functions                      |
| 1. Mark STATE item = SUSPECTED (Conditional UpdateItem)   |
| 2. Wait 20s -> Re-check 1 (SQS waitForTaskToken)          |
| 3. If fail -> Wait 30s -> Re-check 2                      |
| 4. If fail -> Set STATE=DOWN, write INC#, SNS Alert       |
| 5. Recovery loop -> Re-check every 60s (cap 300)          |
| 6. When ok -> STATE=RESOLVED, SNS Recovery Alert          |
+-----------------------------+-----------------------------+
                              |
                              v
                   +---------------------+
                   |   Amazon SNS Topic  |
                   | (Email Alert ONLY)  |
                   +---------------------+
```

---

## 2. Component Design & Operational Mechanics

### 2.1 Networking & Security Perimeter
- **Main VPC (10.0.0.0/16)**:
  - 2 Public Subnets (10.0.1.0/24, 10.0.2.0/24) spanning `ap-south-1a` and `ap-south-1b`. Host the ALB, API ASG, and Worker ASG.
  - 2 Private Subnets (10.0.11.0/24, 10.0.12.0/24) without internet gateways. Exclusively host the RDS PostgreSQL database.
  - **S3 Gateway VPC Endpoint**: Eliminates data egress costs for S3 artifact retrieval and CloudTrail logging.
  - **No NAT Gateway by default**: Keeps daily spend near zero. EC2 instances in public subnets possess public IPs with strictly locked security groups (zero inbound except ALB/CloudFront; egress allowed for HTTP/HTTPS pings and AWS API calls).
- **Victim VPC (10.1.0.0/16)**:
  - Small standalone VPC with 1 public subnet (10.1.1.0/24).
  - Hosts a single `t3.micro`/`t4g.micro` EC2 running Nginx and PostgreSQL (simulating an on-premises enterprise service).
  - **VPC Peering Connection**: Interconnects Main VPC and Victim VPC with reciprocal routing tables.
  - Victim private IP (`10.1.1.X`) is registered in SSM Parameter `/pulsewatch/allowed_private_hosts` to demonstrate safe SSRF allowlisting.
- **ALB Security**:
  - Restricts ingress using AWS CloudFront origin-facing Managed Prefix List (`pl-XXXX`).
  - Listener rule strictly enforces an HTTP header match: `X-PulseWatch-Origin-Verify: <SSM Secret>`. Direct public browser hits are rejected with 403 Forbidden.
- **Instance Security**:
  - Zero SSH keys or open port 22. Access is managed exclusively through AWS Systems Manager (SSM) Session Manager.
  - IMDSv2 strictly required (`http_tokens = "required"`).
  - EBS root volumes encrypted with customer-managed KMS key.

### 2.2 Application Design: API & Distributed Scheduler
- **Technology**: Python 3.12 + FastAPI + Uvicorn (~350 lines), running on Amazon Linux 2023.
- **Stateless EC2 Auto Scaling**: Min 1, Max 2 across 2 AZs. Code deployed via S3 artifact zip pulled by instance user-data.
- **Database Layer**:
  - **RDS PostgreSQL** (tables `users` and `monitors`).
  - **Zero-Collision Scheduler**: Inside API service, runs every 15s using atomic row claiming:
    ```sql
    UPDATE monitors
    SET next_check_at = now() + (interval_min * interval '1 minute')
    WHERE id IN (
        SELECT id FROM monitors
        WHERE paused = false AND next_check_at <= now()
        ORDER BY next_check_at
        LIMIT 50
        FOR UPDATE SKIP LOCKED
    )
    RETURNING id, name, url, expected_status, timeout_sec;
    ```
    Even with multiple API instances running simultaneously across availability zones, `FOR UPDATE SKIP LOCKED` guarantees that no probe job is ever dispatched twice.
- **DynamoDB Telemetry & State Engine**:
  - Table `checks`: Partition Key `monitor_id` (S), Sort Key `ts` (N, epoch ms). Attributes: `status`, `http_code`, `latency_ms`, `error`, `source` ("scheduled" | "recheck" | "loadtest"), `ttl` (30 days).
  - Table `incidents`: Partition Key `monitor_id` (S), Sort Key (S). Stores `"STATE"` (`SUSPECTED` | `DOWN`) and historical `"INC#<ISO>"` records. GSI `by_user` enables fast retrieval for user dashboards.
  - **Fault Resilience**: If DynamoDB is temporarily unreachable, the API falls back gracefully, providing monitor configurations from RDS and returning `"History unavailable"` as defined in the contract.

### 2.3 Distributed Workers & SSRF Engine
- **Technology**: Python long-poll daemon (~120 lines), ASG min 1, max 3 (`WORKER_MAX = 3`).
- **SQS Job Processing**:
  - Reads `pulsewatch-check-queue` (with DLQ after 3 failures).
  - If `type == "check"`: Performs HTTP probe, writes to DynamoDB with condition `attribute_not_exists(ts)`, deletes SQS message.
  - If `type == "recheck"`: Performs probe and calls Step Functions `states:SendTaskSuccess` with token and execution result.
- **SSRF Validation**:
  - Resolves target IP addresses. Blocks loopback (`127.0.0.0/8`), private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and AWS metadata (`169.254.169.254`) unless the host matches the SSM allowlist.
- **Scaling Policies**:
  - Target tracking & Step scaling on `ApproximateNumberOfMessagesVisible`: scales from 1 to 3 instances when queue backlog builds up, and scales back down when drained.

### 2.4 Outage Re-verification by the Worker Fleet: Step Functions State Machine
- When a synthetic probe fails, DynamoDB Streams invokes a lightweight Lambda (outside VPC, ~15 lines) that triggers Step Functions:
  1. **MarkSuspected**: Sets `STATE = SUSPECTED` in DynamoDB using conditional check (`attribute_not_exists(monitor_id) OR state = :none`). Duplicate executions are safely caught and terminated.
  2. **WaitBeforeRecheck (20s)**: Mitigates momentary transient blips.
  3. **Recheck1**: Enqueues task token check to SQS; worker probes target from its AZ.
  4. If healthy: Clears `SUSPECTED` and terminates as `TransientBlip` (zero alert spam).
  5. If failing: Waits 30s and executes **Recheck2**.
  6. **ConfirmDown**: Writes `CONFIRMED` incident item, updates `STATE = DOWN`, and publishes critical email alert via Amazon SNS.
  7. **RecoveryLoop**: Probes every 60s (capped at 300 cycles / 5 hours). When target recovers: updates `STATE = RESOLVED`, records `resolvedAt`, and dispatches "RECOVERED" email alert.

---

## 3. Terraform Module Structure

```
infra/
├── main.tf                 # Provider setup, default_tags (Project=PulseWatch), backend config
├── variables.tf            # Global flags (enable_nat, enable_multiaz, enable_waf, etc.)
├── outputs.tf              # CloudFront URL, ALB DNS, S3 buckets, SSM parameter names
├── terraform.tfvars.example# Example input variables
└── modules/
    ├── network/            # Main VPC, subnets, IGW, S3 endpoint, route tables, security groups
    ├── victim/             # Victim VPC, subnets, peering, route tables, victim EC2 (Nginx + PG)
    ├── security/           # Customer-managed KMS key, IAM roles, instance profiles, least-privilege policies
    ├── data/               # RDS PostgreSQL (single-AZ micro), DynamoDB tables (checks + incidents + streams)
    ├── messaging/          # SQS queue + DLQ, SNS topic with email subscription
    ├── compute/            # Launch templates, API ASG, Worker ASG, ALB, listener rules, scaling policies
    ├── edge/               # S3 static site bucket, CloudFront distribution with OAC, origin header
    ├── workflow/           # DynamoDB Stream Event Source Mapping, Lambda function, Step Functions state machine
    ├── governance/         # CloudWatch Log Groups (7d retention), Dashboard, Alarms, CloudTrail, Config, Budgets
    └── extras/             # Toggle-able demo resources: WAF, Multi-AZ failover, Read Replica, NAT Gateway, DMS
```

---

## 4. IAM Least-Privilege Policies Summary

| Role / Entity | Allowed Actions | Resources / Scope |
| :--- | :--- | :--- |
| **EC2 API Role** | `rds-db:connect`, `sqs:SendMessage`, `dynamodb:GetItem`, `dynamodb:Query`, `dynamodb:Scan`, `ssm:GetParameter*`, `kms:Decrypt`, `s3:GetObject` (artifacts), `s3:PutObject` (reports) | Restricted to `pulsewatch-*` tables, queues, parameters, and buckets |
| **EC2 Worker Role** | `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes`, `dynamodb:PutItem`, `states:SendTaskSuccess`, `states:SendTaskFailure`, `ssm:GetParameter*`, `kms:Decrypt` | Restricted to `pulsewatch-check-queue`, `checks` table, and Step Functions executions |
| **Lambda Stream Trigger** | `states:StartExecution`, `dynamodb:GetRecords`, `dynamodb:GetShardIterator`, `dynamodb:DescribeStream`, `dynamodb:ListStreams` | Limited to `pulsewatch-checks` stream and Step Functions state machine |
| **Step Functions Role** | `dynamodb:UpdateItem`, `dynamodb:PutItem`, `dynamodb:DeleteItem`, `sqs:SendMessage`, `sns:Publish` | Restricted to `incidents` table, check queue, and alert topic |
| **IAM Group `developers`** | Read-write on `pulsewatch-*` resources, Session Manager access to API and Worker instances | No deletion of KMS keys, CloudTrail, or Billing Budgets |
| **IAM Group `read-only`** | `ec2:Describe*`, `cloudwatch:Get*`, `dynamodb:DescribeTable`, `s3:ListBucket` | Inspection only; cannot modify or restart resources |

---

## 5. Cost Estimates: "Always-On" vs "Demo-Only"

*All prices estimated based on AWS ap-south-1 (Mumbai) on-demand rates (USD).*

### 5.1 Baseline "Always-On" Architecture (Run during development and evaluation)

| Component | Sizing / Configuration | Estimated Hourly Cost | Estimated Monthly Cost | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **EC2 API ASG** | 1 x `t4g.nano` (or `t3.nano`) | ~$0.0052 / hr | ~$3.75 / mo | Baseline 1 instance; scales to 2 on demand |
| **EC2 Worker ASG** | 1 x `t4g.nano` (or `t3.nano`) | ~$0.0052 / hr | ~$3.75 / mo | Baseline 1 instance; scales to 3 on load |
| **Victim EC2** | 1 x `t3.micro` | ~$0.0104 / hr | ~$7.50 / mo | Can be paused when not testing |
| **Application Load Balancer** | 1 ALB (ap-south-1) | ~$0.0225 / hr + LCU | ~$16.50 / mo | Single ALB for API traffic |
| **Amazon RDS PostgreSQL** | `db.t4g.micro`, Single-AZ, 20GB GP3 | ~$0.0180 / hr + storage | ~$15.00 / mo | KMS-encrypted, automated backups |
| **Amazon DynamoDB** | 2 tables, On-Demand mode | Pay-per-request | ~$0.20 / mo | Free tier covers 25 RCU/WCU |
| **Amazon SQS + SNS** | Standard queues + 1 SNS Topic | Pay-per-request | < $0.10 / mo | Millions of free requests per month |
| **Amazon CloudFront + S3** | Static UI distribution + S3 storage | Pay-per-transfer | < $0.50 / mo | Within CloudFront 1TB free tier |
| **AWS Step Functions** | Standard workflows (failure verification)| Pay-per-state-transition | < $0.20 / mo | 4,000 free transitions/month |
| **AWS Governance** | CloudWatch (7d log), CloudTrail (1 trail), AWS Config (5 rules), Budgets | Low metrics volume | ~$1.50 / mo | Controlled to avoid log bloat |
| **TOTAL (Always-On)** | — | **~$0.067 / hr** | **~$49.00 / mo** | **~$1.60 per day** |

> **Cost Optimization**: With `scripts/pause.sh` setting ASGs to 0 and stopping RDS/Victim instances when not actively working, daily spend drops to under **$0.70/day**, easily fitting within the $20–$40 target budget.

### 5.2 "Demo-Only" Extras (Run for 15–30 minutes during viva, then destroyed)

| Extra Feature | Component Details | Hourly Rate | Cost for 30-min Demo |
| :--- | :--- | :--- | :--- |
| **Multi-AZ RDS Failover** | Convert RDS to Multi-AZ | +$0.018 / hr | ~$0.01 |
| **RDS Read Replica** | 1 x `db.t4g.micro` Read Replica | +$0.018 / hr | ~$0.01 |
| **AWS WAFv2** | Web ACL with AWS Managed Common Rule Set | $5.00/mo base (~$0.007/hr) | ~$0.05 |
| **NAT Gateway** | 1 NAT Gateway in Main VPC | $0.054 / hr + data | ~$0.03 |
| **AWS DMS Replication** | `dms.t3.micro` replication instance | $0.024 / hr | ~$0.02 |
| **Amazon EFS** | 1 General Purpose File System | $0.30 / GB-month | < $0.01 |

---

## 6. Staged Build & Verification Sequence

1. **Stage 1: Foundation**:
   - Bootstrap S3 remote state bucket and DynamoDB locking.
   - KMS key, IAM roles/instance profiles, SSM parameters (JWT secret, origin verify secret).
   - Main VPC (2 AZs), Victim VPC, VPC Peering, Route Tables, S3 Gateway Endpoint, Security Groups.
   - Set up AWS Budgets alert at $20, $35, and $50.
2. **Stage 2: Data & Messaging**:
   - RDS PostgreSQL single-AZ instance in private subnets.
   - DynamoDB tables (`pulsewatch-checks` with Streams & TTL, `pulsewatch-incidents` with GSI).
   - SQS `pulsewatch-check-queue` + Dead-Letter Queue.
   - SNS Topic `pulsewatch-alerts` with email subscription.
3. **Stage 3: Backend & Compute**:
   - Implement FastAPI API service, scheduler loop, and worker daemon.
   - Execute local unit tests (SSRF validation, state derivation, scheduler query).
   - Package code into S3 artifacts bucket.
   - Provision ALB, API ASG, Worker ASG, and Victim EC2 (Nginx + Postgres).
   - Verify health via ALB and Session Manager.
4. **Stage 4: Edge & Frontend**:
   - Build static React frontend in `dist/` with `API_MODE = 'real'`.
   - Provision private S3 bucket and CloudFront distribution with Origin Access Control.
   - Configure CloudFront behavior `/api/*` to forward to the ALB with custom origin header.
   - Test end-to-end user registration, monitor addition, and live telemetry from CloudFront URL.
5. **Stage 5: Automation, Alerts & Governance**:
   - Provision DynamoDB Stream event source mapping, Lambda trigger, and Step Functions state machine.
   - CloudWatch dashboard, metric filters, CloudTrail, AWS Config managed rules.
   - Trigger demo outage (`scripts/demo-outage.sh start` -> Nginx stops -> Step Functions executes -> email alert delivered).
6. **Stage 6: Demo Extras & Viva Runbook**:
   - Validate `scripts/demo-extras.sh` (Multi-AZ failover, Read Replica, WAF, DMS replication).
   - Validate worker scale-out under SQS load test.
   - Compile comprehensive `docs/REPORT.md` and `docs/DEMO_RUNBOOK.md`.

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation Strategy |
| :--- | :--- | :--- |
| **Accidental Cost Overrun** | Credit exhaustion | Strict AWS Budgets at $20, $35, $50; `scripts/pause.sh` stops instances overnight; zero NAT Gateway by default. |
| **SSRF Vulnerability via Probes** | Worker compromise | Worker resolves DNS and strictly blocks loopback, RFC1918, and metadata IPs (`169.254.169.254`) unless whitelisted. |
| **Scheduler Race Conditions** | Duplicate monitor checks | PostgreSQL `FOR UPDATE SKIP LOCKED` guarantees atomic monitor reservation across multi-instance API deployments. |
| **DynamoDB Outage / Throttling** | Dashboard failure | API isolates check history reads; falls back gracefully to `"History unavailable"` while preserving operational status. |
| **Alert Notification Fatigue** | Email spamming | Multi-step Step Functions state machine verifies outage with 2 distinct probes across 50s before dispatching SNS email. |

---

## 8. Academic Syllabus Coverage Matrix

| Academic Module | AWS Implementation in PulseWatch | Key Files & Modules |
| :--- | :--- | :--- |
| **M1: Cloud Fundamentals & Architecture** | Multi-AZ High Availability, CloudFront Edge Caching, Serverless Event-Driven Orchestration | `infra/modules/edge/`, `infra/modules/compute/` |
| **M2: Compute & Auto Scaling** | EC2 Auto Scaling Groups, Launch Templates, IMDSv2, Systemd Services, SQS Metric-based Step Scaling | `infra/modules/compute/`, `backend/worker.py` |
| **M3: Networking & Content Delivery** | Custom VPCs, Public/Private Subnets, S3 Gateway Endpoint, VPC Peering, ALB Path Routing, CloudFront OAC | `infra/modules/network/`, `infra/modules/victim/` |
| **M4: Storage & Databases** | S3 Intelligent Lifecycle, RDS PostgreSQL Relational Engine, DynamoDB NoSQL Timeseries with Streams & TTL | `infra/modules/data/`, `infra/modules/edge/` |
| **M5: Security, Identity & Governance** | Least-privilege IAM Policies, KMS Customer-Managed Encryption, SSM Session Manager, AWS Config, CloudTrail | `infra/modules/security/`, `infra/modules/governance/` |
| **M6: Monitoring & Observability** | CloudWatch Custom Metrics (`SitesDown`), Log Retention policies, Alarms, CloudWatch Unified Dashboard | `infra/modules/governance/` |
| **M7: Serverless & Automation** | AWS Lambda event triggers, Step Functions distributed state machine with task tokens, Amazon SNS | `infra/modules/workflow/`, `infra/modules/messaging/` |
| **M8: Disaster Recovery & Migration** | Multi-AZ Database Failover, Read Replica replication, AWS Database Migration Service (DMS) demo module | `infra/modules/extras/`, `scripts/demo-extras.sh` |
