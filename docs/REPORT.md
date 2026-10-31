# PulseWatch: Cloud-Native Synthetic Uptime & Resilience Monitoring Platform

**Comprehensive Architecture Report, Well-Architected Framework Assessment & Syllabus Defense**  
**Region**: `ap-south-1` (Mumbai) | **AWS Account**: `826903518995` | **Author**: SRE Capstone Team  

---

## 1. Executive Summary & Problem Statement

Modern cloud operations require continuous verification of service availability and latency from both external and internal network boundaries. Traditional monolithic monitoring agents present two fundamental flaws:
1. **Network Blindness & SSRF Risk**: Probing internal infrastructure from public monitoring fleets often introduces severe Server-Side Request Forgery (SSRF) vulnerabilities or requires dangerous public exposure of private subnets.
2. **Alert Fatigue**: Transient network blips frequently trigger false-positive incident paging, degrading engineering response efficacy.

**PulseWatch** resolves these challenges by deploying a distributed, multi-tier synthetic uptime platform natively inside AWS. It combines:
- **Polyglot Persistence**: ACID relational guarantees on Amazon RDS (PostgreSQL 15) for accounts and monitor definitions paired with Amazon DynamoDB for high-throughput time-series metrics.
- **Serverless Event-Driven Incident Verification**: An automated AWS Step Functions state machine triggered via DynamoDB Streams and AWS Lambda that coordinates multi-step outage re-verification across the worker fleet before dispatching alert notifications.
- **Zero-Trust Private Monitoring**: Peered VPC connectivity enabling synthetic health probes across private RFC1918 subnets (`10.1.1.111`) with strict kernel-level IP filtering.

---

## 2. System Architecture & Component Inventory

### 2.1 High-Level Architecture Topology

```
                                 [ CloudFront Edge / S3 Website ]
                                                │
                                    (Public Internet Route)
                                                ▼
                                [ Application Load Balancer (ALB) ]
                                                │
                                   (Port 8000 Target Group)
                                                ▼
                                [ API Auto Scaling Group (EC2) ]
                                    (FastAPI Microservice)
                                     │                  │
                (Atomic Claim:       │                  │ (Enqueue Due Checks)
           FOR UPDATE SKIP LOCKED)   ▼                  ▼
                         [ RDS PostgreSQL ]    [ Amazon SQS Queue ]
                           (Private Subnets)    (pulsewatch-check-queue)
                                                        │
                                                        ▼
                                           [ Worker Fleet (EC2 ASG) ]
                                                │               │
                            (Synthetic HTTP     │               │ (Persist Latency
                               Probe via PCX)   │               │  & Result)
                                                ▼               ▼
                                    [ Victim EC2 (10.1.1.111) ] [ DynamoDB (checks) ]
                                     (Isolated Victim VPC)              │
                                                                 (DynamoDB Stream)
                                                                        ▼
                                                            [ Stream Filter (Lambda) ]
                                                                        │
                                                             (Trigger on Failure)
                                                                        ▼
                                                         [ Step Functions State Machine ]
                                                                        │
                                                            (Outage Re-verification
                                                               via Worker Fleet)
                                                                        ▼
                                                            [ Amazon SNS Alert Topic ]
                                                                (Email Dispatch)
```

### 2.2 AWS Service Inventory

| AWS Service | Resource Name / Identifier | Purpose & Role in PulseWatch |
| :--- | :--- | :--- |
| **Amazon VPC** | `pulsewatch-main-vpc` (`10.0.0.0/16`) | Isolated cloud network spanning 2 Availability Zones (`ap-south-1a`, `ap-south-1b`). |
| **Amazon VPC** | `pulsewatch-victim-vpc` (`10.1.0.0/16`) | Simulated enterprise target VPC connected via VPC Peering (`pcx-0f2306f05a2b2ac72`). |
| **AWS KMS** | `alias/pulsewatch-kms` | Customer Managed Key (CMK) enforcing envelope encryption for RDS, DynamoDB, SQS, S3, and SSM. |
| **Amazon RDS** | `pulsewatch-db` (`db.t4g.micro`) | Relational database in private subnets storing user credentials and target definitions. |
| **Amazon DynamoDB** | `pulsewatch-checks` | High-throughput time-series store with Streams enabled and 30-day automated TTL expiration. |
| **Amazon DynamoDB** | `pulsewatch-incidents` | Incident state tracker with GSI `by_user` indexed by `user_id` and `startedAt`. |
| **Amazon SQS** | `pulsewatch-check-queue` | Decoupling message buffer between API scheduler and probe workers, backed by `pulsewatch-check-dlq`. |
| **Amazon SNS** | `pulsewatch-alerts-topic` | Notification topic dispatching verified outage and recovery emails to `anandayush798@gmail.com`. |
| **Amazon EC2 / ASG** | `pulsewatch-api-asg` | Elastic compute fleet running the FastAPI REST gateway and scheduler. |
| **Amazon EC2 / ASG** | `pulsewatch-worker-asg` | Auto-scaling worker fleet consuming SQS check jobs with CloudWatch backlog scaling policies. |
| **Elastic Load Balancing** | `pulsewatch-alb` | Application Load Balancer distributing HTTP traffic across API instances. |
| **Amazon CloudFront** | S3 Origin / ALB Origin | Global edge distribution terminating TLS and routing static assets to S3 and `/api/*` to the ALB. |
| **Amazon S3** | `pulsewatch-reports-826903518995`<br>`pulsewatch-artifacts-826903518995`<br>`pulsewatch-frontend-826903518995` | Multi-tier object storage: dedicated KMS-encrypted reports bucket with automated lifecycle tiering (Standard -> Standard-IA -> Glacier -> Expiration), versioned artifacts bucket, and static website hosting. |
| **AWS Lambda** | `pulsewatch-stream-filter` | Serverless stream filter parsing DynamoDB shard events to trigger incident workflows. |
| **AWS Step Functions** | `pulsewatch-incident-workflow` | Distributed orchestration state machine managing re-verification probes and recovery loops. |
| **Amazon CloudWatch** | `pulsewatch-overview` | Single-pane-of-glass dashboard displaying queue depth, latency, and custom `SitesDown` metric. |
| **AWS CloudTrail** | `pulsewatch-cloudtrail` | Governance trail capturing management API calls to encrypted S3 bucket. |
| **AWS Config** | `pulsewatch-recorder` | Compliance recorder evaluating resource configurations against 3 AWS managed rules. |
| **AWS SSM** | Parameter Store | Encrypted storage for JWT signing keys, DB credentials, and origin verification secrets. |

---

## 3. AWS Well-Architected Framework Review

### 3.1 Pillar 1: Operational Excellence
- **Infrastructure as Code (IaC)**: 100% of the foundation, compute, data, workflow, and governance stacks are defined in modular Terraform (`infra/modules/*`).
- **Telemetry & Unified Observability**: A custom Amazon CloudWatch dashboard (`pulsewatch-overview`) aggregates API request latency, SQS backlog depth, RDS CPU load, and the custom `PulseWatch/Metrics` `SitesDown` metric published every scheduler tick.
- **Runbook Automation**: Routine operations are fully scripted:
  - `status.sh`: Real-time fleet health, queue telemetry, and hourly burn rate calculation.
  - `pause.sh` & `resume.sh`: Deep cost-conservation automation for scaling compute to zero during idle periods.
  - `demo-outage.sh`: Hands-off outage simulation using SSM Run Command to stop/start Nginx on `10.1.1.111`.

### 3.2 Pillar 2: Security
- **Zero Open Management Ports**: No SSH port 22 is open on any security group. All administrative access to API, worker, and victim instances is brokered over TLS WebSockets using **AWS Systems Manager Session Manager**.
- **Envelope Encryption at Rest**: Customer Managed KMS key (`alias/pulsewatch-kms`) encrypts RDS PostgreSQL storage, DynamoDB tables, SQS message payloads, S3 artifact buckets, and CloudTrail logs.
- **Least Privilege IAM**: Separate IAM instance profiles exist for API instances (`pulsewatch-api-instance-role`) and Worker instances (`pulsewatch-worker-instance-role`). Workers have zero access to RDS or JWT secrets.
- **SSRF Defense**: The probe engine strictly checks resolved IP addresses against private RFC1918 blocks, loopback (`127.0.0.0/8`), link-local, and EC2 instance metadata (`169.254.169.254`). Only hosts explicitly registered in SSM parameter `/pulsewatch/allowed_private_hosts` are queried.
- **Temporary Security Exceptions**:
  > [!NOTE]
  > **Documented Temporary Exceptions**:
  > 1. *Public S3 Frontend Bucket & Public HTTP ALB*: CloudFront custom distributions in newly created AWS accounts are subject to account verification by AWS Trust & Safety. During this evaluation window, the S3 static website bucket (`pulsewatch-frontend-826903518995`) and the ALB (`pulsewatch-alb`) are configured to allow direct HTTP access restricted by the operator's IP (`my_ip_cidr`) and origin header checks. Once account verification completes, CloudFront OAC will strictly block direct S3 and ALB access.

### 3.3 Pillar 3: Reliability
- **Multi-AZ Availability**: VPC spans two availability zones (`ap-south-1a`, `ap-south-1b`). Compute instances run across both zones behind the Application Load Balancer.
- **Decoupled Asynchronous Buffering**: Decoupling probe scheduling from probe execution via Amazon SQS guarantees that a slow target or network timeout never blocks the API or exhausts web worker threads.
- **Poison Message Isolation**: SQS Dead-Letter Queue (`pulsewatch-check-dlq`) captures tasks that fail 3 consecutive times, preventing pipeline stalls.
- **Outage Re-Verification by the Worker Fleet**:
  > [!IMPORTANT]
  > Rather than alerting on an isolated failure, Step Functions immediately marks the target `SUSPECTED`, pauses 5 seconds, and dispatches a single re-verification check to the worker fleet. This intentionally trades ~5 seconds of detection latency to completely eliminate transient false alarms from network jitter before confirming downtime and dispatching alert notifications to Amazon SNS.

### 3.4 Pillar 4: Performance Efficiency
- **Polyglot Persistence**: Heavy relational transactions (`users`, `monitors`) are handled by RDS, while synthetic time-series check history is ingested by Amazon DynamoDB with sub-10ms response times.
- **Concurrency without Locks**: PostgreSQL's `SELECT ... FOR UPDATE SKIP LOCKED` guarantees atomic monitor reservation across multi-instance API deployments without requiring Redis or distributed locking overhead.
- **Edge Acceleration**: CloudFront edge caches static frontend assets globally, reducing load on origin compute.

### 3.5 Pillar 5: Cost Optimization
- **Elimination of NAT Gateways**: Running API and worker instances in public subnets with strict security groups (zero open ingress ports) completely eliminated the continuous **$32/month** AWS NAT Gateway hourly charge.
- **DynamoDB Time-To-Live (TTL)**: Telemetry records automatically expire and delete after 30 days at zero compute or scan cost.
- **S3 Tiered Lifecycle Management**: Dedicated incident reports bucket (`pulsewatch-reports-826903518995`) enforces automated lifecycle transitions: Standard -> Standard-IA at 30 days -> Glacier Flexible Retrieval at 90 days -> Expire at 365 days, aborting incomplete multipart uploads after 7 days. Housekeeping lifecycle rules on audit/config buckets prevent unbounded storage accumulation. Cost trade-off caveats: S3 enforces a 30-day minimum duration before transitioning to Standard-IA and a 128 KB minimum billable object size; small CSV exports (~1 KB) are billed at 128 KB in Standard-IA/Glacier, making lifecycle transitions optimal for enterprise compliance retention while automated expiration caps storage liability. Verified in `docs/proof/s3_lifecycle.txt`.
- **Automated Lifecycle Pausing**: `scripts/pause.sh` scales ASGs to 0, stops RDS and Victim EC2, and purges SQS, reducing daily spend to **<$0.70/day** during non-working hours.
- **S3 Gateway Endpoint**: S3 traffic is routed internally over AWS infrastructure at zero data-transfer cost.

### 3.6 Pillar 6: Sustainability
- **Right-Sized Compute**: Smallest Graviton-based instances (`db.t4g.micro`, `t3.micro`) are utilized, maximizing energy efficiency.
- **Dynamic Auto-Scaling**: CloudWatch Step Scaling automatically scales down workers during periods of low check volume.
- **Auto-Purge**: DynamoDB TTL ensures obsolete synthetic monitoring data does not accumulate indefinitely on physical storage media.

---

## 4. Academic Syllabus Mapping Matrix

| Academic Module | AWS Implementation in PulseWatch | Key Files & Modules |
| :--- | :--- | :--- |
| **M1: Cloud Fundamentals & Architecture** | Multi-tier decoupled architecture, High Availability across 2 AZs, Edge Caching | `infra/main.tf`, `infra/modules/edge/`, `infra/modules/compute/` |
| **M2: Compute & Auto Scaling** | EC2 Launch Templates, Auto Scaling Groups, IMDSv2, SQS Step Scaling Policies | `infra/modules/compute/main.tf`, `backend/worker.py` |
| **M3: Networking & Content Delivery** | Custom VPCs, Public/Private Subnetting, VPC Peering, S3 Gateway Endpoint, ALB | `infra/modules/network/main.tf`, `infra/modules/victim/main.tf` |
| **M4: Storage & Databases** | S3 Intelligent Storage & Tiered Lifecycle, RDS PostgreSQL Relational Engine, DynamoDB NoSQL with Streams & TTL | `infra/modules/compute/main.tf`, `infra/modules/data/main.tf`, `docs/proof/s3_lifecycle.txt` |
| **M5: Security, Identity & Governance** | Least-privilege IAM Roles, KMS Envelope Encryption, AWS Config, CloudTrail, SSM Session Manager | `infra/modules/security/main.tf`, `infra/modules/governance/main.tf` |
| **M6: Monitoring & Observability** | CloudWatch Alarms, Metric Filters, Custom Metric Namespace (`PulseWatch/Metrics`), Unified Dashboard | `infra/modules/governance/main.tf`, `backend/app.py` |
| **M7: Serverless & Automation** | AWS Lambda DynamoDB Stream processing, Step Functions state machine with Task Tokens, Amazon SNS | `infra/modules/workflow/main.tf`, `infra/modules/messaging/main.tf` |
| **M8: Disaster Recovery & Migration** | Multi-AZ Failover, Read Replica replication, automated backup retention, toggle-able demo extras | `infra/modules/extras/main.tf`, `scripts/demo-extras.sh` |

---

## 5. Cost Breakdown & Budget Reconciliation

### 5.1 Baseline Operational Cost Profile (ap-south-1)

| Service Component | Sizing & Configuration | Monthly Cost (USD) | Hourly Rate (USD) |
| :--- | :--- | :--- | :--- |
| **RDS PostgreSQL** | 1 x `db.t4g.micro` (Single-AZ, 20 GB gp3) | ~$13.50 | ~$0.018 |
| **EC2 Instances** | 2 x `t3.micro` (1 API, 1 Worker) | ~$15.18 | ~$0.021 |
| **Victim EC2** | 1 x `t3.micro` (Nginx + Postgres) | ~$7.59 | ~$0.010 |
| **Application Load Balancer** | 1 x ALB (ap-south-1) | ~$16.20 | ~$0.022 |
| **DynamoDB** | On-Demand (checks + incidents) | ~$0.25 | <$0.001 |
| **Amazon SQS & SNS** | Pay-per-request | ~$0.10 | <$0.001 |
| **AWS KMS** | 1 Customer Managed Key | $1.00 | ~$0.001 |
| **AWS Config & CloudTrail** | 3 Managed Rules, 1 Trail | ~$0.50 | <$0.001 |
| **Total Running Burn Rate** | **Continuous Execution** | **~$54.32 / mo** | **~$0.075 / hr** |

### 5.2 Optimized Spend with `pause.sh` (Student Credit Compliance)
When non-continuous development is practiced:
- Compute ASGs scaled to 0: **-$22.77 / mo**
- RDS and Victim EC2 stopped: **-$21.09 / mo**
- **Effective Daily Spend during project build**: **~$0.35 - $0.70 / day**
- **Total Project Expenditure**: Strictly contained between **$20.00 and $40.00**, verified against AWS Budgets alerts set at $20, $35, and $50.

---

## 6. Live Verification & Demo Proof

The following test artifacts are recorded in `docs/proof/` and validate system resilience, high availability, and auto-scaling:

### 6.1 Worker Auto Scaling & Self-Healing Fleet (`docs/proof/autoscaling_and_resilience.txt`)
- **Queue Backlog Scaling**: Injected 20 synthetic check messages to `pulsewatch-check-queue`. Executed step scaling policy `pulsewatch-worker-sqs-scale-out`.
- **Instance Failure & Self-Healing**: Terminated worker instance `i-09ab7fcf79e52c24c`. The Worker Auto Scaling Group immediately detected the missing health beacon, transitioned the instance to `shutting-down`, and launched a replacement node into service without losing queued SQS tasks.
- **ALB Ingress High Availability**: Verified continuous HTTP 200 responses from `http://pulsewatch-alb-2049379350.ap-south-1.elb.amazonaws.com/api/health` across worker churn.

### 6.2 Outage Verification & Step Functions Serverless Healing (`docs/proof/alerting_sns.txt`)
- **Outage Progression**: Stopped Nginx on Victim EC2 (`10.1.1.111`).
- **Telemetry State**: Initial scheduled check failed at `01:30:15.557 UTC` (`T0`).
- **Worker Fleet Re-Verification**: Step Functions marked target `SUSPECTED`, executed a 5-second wait (`recheck_wait_seconds=5`), and sent a single recheck probe via SQS Task Token (`waitForTaskToken`). Upon confirmation of failure, marked state `DOWN`, wrote incident record `INC#<ts>` with `user_id` to DynamoDB (indexed on GSI `by_user`), and dispatched critical alert email via Amazon SNS (`pulsewatch-alerts-topic`) at `01:30:24.233 UTC` (`T2`). Total time to alert: **8.68 seconds**.
- **Self-Healing Recovery**: Nginx restarted on Victim EC2 at `01:31:00.879 UTC` (`T3`). Step Functions 15-second recovery polling loop detected HTTP 200, marked state `UP`, updated incident record to `RESOLVED` with `resolvedAt` at `01:31:09.871 UTC`, and dispatched recovery email at `01:31:10.056 UTC` (`T4`). Total time to recovery notification: **9.18 seconds**.
- **Root Cause & Resilience Note**: In early morning runs, missing DOWN emails were traced to the SNS subscription being in `PendingConfirmation` state rather than IAM/KMS failures. Step Functions and DynamoDB schema updates now guarantee end-to-end incident delivery to the UI and email inbox.

### 6.3 S3 Storage Architecture & Tiered Lifecycle Management (`docs/proof/s3_lifecycle.txt`)
- **Dedicated Reports Bucket**: Created `pulsewatch-reports-826903518995` with SSE-KMS customer-managed key encryption and Block Public Access enabled across all 4 controls. Bucket name is resolved dynamically from SSM parameter `/pulsewatch/reports_bucket`.
- **API Least-Privilege IAM Policy**: API instance role policy scoped strictly to `s3:PutObject` and `s3:GetObject` on `arn:aws:s3:::pulsewatch-reports-826903518995/*`.
- **Automated Lifecycle Policies Verified**:
  - `pulsewatch-reports-826903518995`: Rule `reports-tiered-retention` (30-day Standard-IA transition, 90-day Glacier transition, 365-day expiration, 7-day multipart upload abort).
  - `pulsewatch-artifacts-826903518995`: Rule `artifacts-cleanup` (30-day noncurrent version expiration, 7-day multipart upload abort).
  - `pulsewatch-cloudtrail-826903518995` & `pulsewatch-config-826903518995`: Rules `cloudtrail-retention` and `config-retention` (30-day Standard-IA transition, 365-day expiration, 7-day multipart upload abort).
- **End-to-End Presigned URL Verification**: Tested `POST /api/reports/export` with JWT authentication. Generated presigned S3 download URL (`https://pulsewatch-reports-826903518995.s3.ap-south-1.amazonaws.com/reports/...`), executed client-side `curl` download, verified complete CSV incident records, and confirmed object metadata in S3 with `rule-id="reports-tiered-retention"` and `ServerSideEncryption: aws:kms`.

---

## 7. Extended Academic Syllabus Topics (Theoretical & Architectural Analysis)

Examiners assessing enterprise cloud architecture often evaluate trade-offs between managed AWS services. The following analysis supports syllabus defense:

### 7.1 AWS Direct Connect vs. Site-to-Site VPN
- **Site-to-Site VPN**: Rapidly deployed over public internet using IPsec tunnels. Bandwidth is capped (~1.25 Gbps per tunnel) and latency fluctuates based on internet routing. In PulseWatch, VPC Peering was chosen for simulated enterprise connectivity due to zero transit appliance cost.
- **Direct Connect (DX)**: Dedicated 1 Gbps / 10 Gbps physical fiber cross-connect into an AWS Direct Connect Location. Bypasses public internet, providing deterministic sub-5ms latency and reduced data egress pricing ($0.02/GB vs $0.09/GB), ideal for continuous high-frequency enterprise telemetry ingestion.

### 7.2 AWS Snowball Family (Data Migration at Scale)
- **Snowcone (8 TB)** / **Snowball Edge (80 TB)** / **Snowmobile (up to 100 PB)**: Physical ruggedized appliances for bulk data transfer where network bandwidth is constrained. Transferring 50 TB over a 100 Mbps uplink requires >45 days; Snowball completes offline physical transit within days.

### 7.3 Amazon Aurora vs. Standard Amazon RDS
- **Standard RDS (PulseWatch)**: Traditional database instance attached to Amazon EBS volumes. Storage volume I/O is bounded by EBS provisioned IOPS, and Multi-AZ replication operates at the physical disk level.
- **Amazon Aurora**: Cloud-native distributed log-structured storage. Replicates 6 ways across 3 Availability Zones at the storage layer without database write amplification. Aurora Serverless v2 scales compute in fine-grained increments (0.5 ACUs), which would allow PulseWatch to scale database compute to zero during non-peak overnight monitoring windows.

### 7.4 AWS Step Functions vs. AWS Simple Workflow Service (SWF)
- **AWS SWF**: Legacy workflow engine requiring operators to write and maintain persistent "Decider" compute daemons to transition states.
- **Step Functions (PulseWatch)**: Modern serverless state machine defined in Amazon States Language (ASL). Manages state transitions, retries, exponential backoffs, and task tokens (`waitForTaskToken`) natively without managing decider infrastructure.

### 7.5 AWS Database Migration Service (DMS) Feasibility Assessment
- **Role in Capstone**: Used for migrating existing on-premises PostgreSQL relational tables into Amazon RDS.
- **Cost & Effort Trade-off**: A live DMS `dms.t3.micro` replication instance costs ~$0.024/hr. For viva demonstration, schema migration was achieved directly via SQL DDL inside `backend/app.py` at zero additional hourly cost. A live DMS instance can be spawned within 10 minutes via `infra/modules/extras/`.

### 7.6 AWS Server Migration Service (SMS) Retirement
- AWS Server Migration Service was formally deprecated in March 2022 and replaced by **AWS Application Migration Service (AWS MGN)**. AWS MGN provides continuous block-level data replication, enabling non-disruptive cutovers of physical, virtual, or cloud servers into EC2.

### 7.7 AWS Shield Standard vs. AWS Shield Advanced
- **Shield Standard (Active in PulseWatch)**: Automatically defends all AWS customers against Layer 3 (Network) and Layer 4 (Transport) SYN floods and UDP reflection attacks at no additional cost.
- **Shield Advanced ($3,000/month)**: Adds Layer-7 DDoS mitigation, 24/7 access to the AWS Shield Response Team (SRT), and DDoS cost protection against scaling spikes during an attack.

### 7.8 AWS Trusted Advisor & Cost Governance
- PulseWatch was audited against AWS Trusted Advisor core checks: service limits, open security group ingress, and idle resource detection. Pausing compute with `pause.sh` reflects Trusted Advisor cost recommendations.

---

## 8. Known Limitations & Future Architecture Work

### 8.1 Known Limitations
1. **Public ALB Ingress Fallback**: While awaiting AWS account verification for global CloudFront distributions, the ALB is configured to accept direct HTTP traffic restricted by `my_ip_cidr`.
2. **Step Functions Recovery Cap**: The outage recovery loop is bounded by a 300-iteration cap (counter increment in Step Functions state payload) and a 10-iteration "still down" reminder notification before exiting, ensuring workflows never run indefinitely.
3. **Single Victim Instance**: Simulated target infrastructure runs on a single `t3.micro` in `pulsewatch-victim-vpc`.
4. **No Custom Route 53 Domain**: Endpoints currently use AWS-assigned DNS names (`pulsewatch-alb-*.ap-south-1.elb.amazonaws.com`) to avoid Route 53 hosted zone monthly maintenance fees ($0.50/zone).

### 8.2 Future Work
- **Global Probe Distribution**: Deploying worker fleets across multiple AWS regions (`us-east-1`, `eu-west-1`, `ap-southeast-1`) to measure latency and availability from diverse geographic perspectives.
- **Route 53 Private Hosted Zone**: Registering an internal DNS zone (`victim.pulsewatch.internal`) attached to the Main VPC for human-readable target routing over VPC peering.
- **WebSocket Push Notifications**: Replacing browser polling with AWS API Gateway WebSocket APIs or AWS AppSync GraphQL subscriptions for real-time dashboard updates.

---

## 9. Conclusion & Viva Defense Recommendations

PulseWatch demonstrates enterprise cloud engineering principles far beyond typical student capstones. By orchestrating decoupled microservices with serverless event-driven healing, least-privilege security controls, and strict financial governance, the project serves as an end-to-end realization of production AWS cloud architecture.
