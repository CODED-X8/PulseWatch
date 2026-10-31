# PulseWatch Backend & Infrastructure Viva Guide

This guide is designed specifically for academic viva and technical defense. It explains every infrastructure module and backend file in detail: what it accomplishes, why specific architectural choices were made, how it connects to the rest of the system, and likely questions you may be asked by an examiner.

---

## 1. Project Configuration & Planning Documents

### `docs/PLAN.md`
- **What it does**: Comprehensive blueprint containing the high-level ASCII topology, architectural decisions, IAM policy matrix, cost breakdown, risk mitigations, and academic syllabus mapping.
- **Why**: Demonstrates structured systems engineering and provides an authoritative reference for examiners assessing the production readiness and Well-Architected alignment of the system.
- **How it connects**: Directs the phased Terraform module layout (`infra/modules/*`) and backend micro-daemon responsibilities (`backend/`).
- **Likely Viva Questions**:
  1. *Why did you separate the VPC into public and private subnets without a NAT Gateway?*
     - **Answer**: To maintain cost efficiency within student credits while preserving security. The database resides safely in private subnets with zero internet ingress or egress. API and worker instances run in public subnets with public IPs but strictly locked security groups (zero open ingress ports; Session Manager only for administration), completely eliminating the ~$32/month AWS NAT Gateway charge.
  2. *How does the system prevent duplicate probe execution when multiple API instances run in the ASG?*
     - **Answer**: The scheduler uses PostgreSQL's `SELECT ... FOR UPDATE SKIP LOCKED` inside an atomic transaction. Any monitor row locked by one instance is skipped by other instances, guaranteeing exactly-once scheduling without distributed lock managers.

### `docs/BUILD_LOG.md`
- **What it does**: Running engineering journal recording commands executed, timestamps, technical trade-offs, and verification results.
- **Why**: Proves authentic project evolution and provides an audit trail for viva defense.
- **How it connects**: Chronologically maps each stage of Terraform provisioning and backend packaging.
- **Likely Viva Questions**:
  1. *What security precautions were taken regarding AWS credentials and git repositories?*
     - **Answer**: The AWS CLI uses a dedicated named profile (`pulsewatch`) with least-privilege policies. `.gitignore` was hardened before creating any infrastructure files to block `*.tfstate`, `*.tfvars`, `.env`, and secret keys. All application secrets (JWT signing keys, origin validation headers) are managed in AWS SSM Parameter Store with KMS encryption.

---

## 2. Foundation & Network Infrastructure (`infra/modules/`)

### `infra/modules/security/main.tf`
- **What it does**: Provisions the customer-managed KMS key (`alias/pulsewatch-kms`), encrypted SSM Parameter Store secrets, and least-privilege IAM roles/instance profiles for API, Worker, and Victim instances.
- **Why**: Zero secrets in code, state, or user-data. The KMS key enforces envelope encryption for EBS volumes, RDS storage, and SSM SecureString parameters.
- **How it connects**: Instance profiles are attached to EC2 launch templates, enabling passwordless authentication to AWS services via IAM role tokens.
- **Likely Viva Questions**:
  1. *What is the difference between AWS-managed KMS keys and Customer Managed Keys (CMK)?*
     - **Answer**: Customer-managed keys allow granular key policies, audit logging in CloudTrail, and explicit key rotation controls. They give our application cryptographic ownership without relying on shared AWS service keys.
  2. *Why do all instance roles attach `AmazonSSMManagedInstanceCore`?*
     - **Answer**: It enables AWS Systems Manager Session Manager. Operators connect to instances via encrypted WebSockets through the AWS Console or CLI without requiring public SSH keys, bastion hosts, or open port 22 in security groups.

### `infra/modules/network/main.tf`
- **What it does**: Provisions the Main VPC (`10.0.0.0/16`) spanning 2 availability zones, with distinct public and private subnets, an S3 Gateway Endpoint, and 4 dedicated Security Groups.
- **Why**: Enforces defense-in-depth network segregation. RDS is placed in private subnets with no internet route. The S3 endpoint routes artifact downloads and CloudTrail logs within the AWS internal network for free.
- **How it connects**: Provides subnets for the Application Load Balancer, EC2 Auto Scaling Groups, and the RDS database.
- **Likely Viva Questions**:
  1. *Why use an S3 Gateway VPC Endpoint instead of an Interface Endpoint?*
     - **Answer**: Gateway endpoints for S3 and DynamoDB are completely free and modify route tables directly with prefix lists. Interface endpoints (PrivateLink) incur hourly ENI and per-GB processing charges.
  2. *How is the ALB security group locked down if it must serve web traffic?*
     - **Answer**: It references the AWS Managed Prefix List for CloudFront Origin Facing IPs (`pl-XXXX`). Only traffic originating from CloudFront edge locations can connect to the ALB on port 80.

### `infra/modules/victim/main.tf`
- **What it does**: Creates an isolated Victim VPC (`10.1.0.0/16`) connected to the Main VPC via VPC Peering, hosting an EC2 instance running Nginx and PostgreSQL.
- **Why**: Acts as a realistic simulated enterprise target that we can intentionally break during the viva (e.g. stopping Nginx) to prove that the uptime monitoring and Step Functions recovery loop function properly over private IP addresses.
- **How it connects**: Routes probe traffic from Worker instances over the VPC Peering connection (`pcx-XXXX`).
- **Likely Viva Questions**:
  1. *What routing is required for VPC Peering to work?*
     - **Answer**: VPC Peering is non-transitive. Both VPC route tables must have explicit routes: Main VPC has a route for `10.1.0.0/16` targeting the peering connection ID, and Victim VPC has a route for `10.0.0.0/16` targeting the peering connection ID.

---

## 3. Data & Messaging Tier (`infra/modules/data/`, `infra/modules/messaging/`)

### `infra/modules/data/main.tf`
- **What it does**: Provisions the relational core (RDS PostgreSQL) and the NoSQL timeseries engine (DynamoDB `checks` and `incidents`).
- **Why**: Polyglot persistence. High-integrity relational tables (`users` and `monitors`) require ACID constraints and atomic row locking (`SELECT FOR UPDATE SKIP LOCKED`). High-volume synthetic check observations require elastic, sub-millisecond NoSQL writes with automatic TTL expiration to prevent cost growth.
- **How it connects**: RDS stores user accounts and target endpoints. DynamoDB stores time-series check points and active incident states. DynamoDB Streams trigger Lambda when a failed check is inserted.
- **Likely Viva Questions**:
  1. *Why use both RDS and DynamoDB instead of putting everything in PostgreSQL?*
     - **Answer**: Synthetic uptime checks produce continuous timeseries observations (e.g. thousands of points daily). Storing them in DynamoDB avoids inflating the RDS storage volume and connection pool. DynamoDB TTL purges data older than 30 days for free, and DynamoDB Streams enables serverless event-driven outage workflows without polling.
  2. *How is the database protected from internet-based brute force attacks?*
     - **Answer**: The RDS instance is placed in isolated private subnets with `publicly_accessible = false` and has no public IP address. Its security group permits inbound traffic on port 5432 exclusively from the API Security Group (`sg-0cc651b04d675d2f4`).

### `infra/modules/messaging/main.tf`
- **What it does**: Provisions the asynchronous check buffer queue (`pulsewatch-check-queue`), Dead-Letter Queue (`pulsewatch-check-dlq`), and SNS alert notification topic.
- **Why**: Decouples the API scheduler from synthetic probe execution. If a probe job crashes or times out 3 times, SQS moves it to the DLQ, preventing poisoned tasks from blocking the worker fleet.
- **How it connects**: The API scheduler enqueues check jobs to SQS; workers long-poll SQS, execute HTTP pings, and write results to DynamoDB. Step Functions publishes confirmed downtime alerts to SNS.
- **Likely Viva Questions**:
  1. *What is the role of the Dead-Letter Queue (DLQ)?*
     - **Answer**: A DLQ captures poison messages (e.g., malformed URLs or unexpected payloads) after `maxReceiveCount` attempts (configured to 3). This prevents continuous retries that waste compute resources and lets engineers inspect failed payloads.
  2. *Why KMS-encrypt SQS queues?*
     - **Answer**: To protect check payloads (which contain internal URLs and diagnostic metadata) at rest, meeting enterprise compliance standards.

---

## 4. Compute, Edge & Operations (`infra/modules/compute/`, `infra/modules/edge/`, `scripts/`)

### `backend/app.py` & `backend/worker.py`
- **What they do**: `app.py` serves the REST API and runs the background scheduler claiming due monitors via `FOR UPDATE SKIP LOCKED`. `worker.py` polls SQS, executes synthetic checks with SSRF enforcement, writes results to DynamoDB, and delivers Step Functions callbacks.
- **Why**: Decoupled microservices architecture. The API remains responsive to browser traffic while long-running HTTP network probes occur asynchronously across worker instances.
- **How they connect**: Connected through SQS `pulsewatch-check-queue`. The API dispatches check messages; workers consume messages and write telemetry to DynamoDB.
- **Likely Viva Questions**:
  1. *How does the worker guard against SSRF attacks on internal cloud endpoints?*
     - **Answer**: The worker parses the target hostname, resolves DNS records, and strictly checks each resolved IP against RFC1918 private ranges, loopback (`127.0.0.0/8`), link-local, and AWS instance metadata (`169.254.169.254`). Only hosts explicitly registered in SSM parameter `/pulsewatch/allowed_private_hosts` are permitted.
  2. *What happens if a worker instance crashes mid-check?*
     - **Answer**: SQS visibility timeout (60 seconds) expires without a delete call, returning the check message to the queue for another worker to process. After 3 failed attempts, the message moves to the Dead-Letter Queue (DLQ).

### `infra/modules/compute/main.tf`
- **What it does**: Provisions the Application Load Balancer, Launch Templates, API ASG (1–2 instances), Worker ASG (1–3 instances), and SQS queue-depth CloudWatch step scaling alarms. Supports `alb_enabled` toggle for Deep Pause mode.
- **Why**: High availability across 2 availability zones with automated capacity scaling based on message backlog.
- **How it connects**: Receives incoming requests from CloudFront and balances them across EC2 API instances.
- **Likely Viva Questions**:
  1. *Why use an ALB listener rule with a custom header instead of opening the ALB to the public internet?*
     - **Answer**: Defense-in-depth. In addition to the CloudFront Managed Prefix List on the security group, the ALB listener rule verifies the secret header `X-PulseWatch-Origin-Verify`. Any request bypassing CloudFront is immediately rejected with a 403 Forbidden fixed response.

### `infra/modules/edge/main.tf`
- **What it does**: Creates the CloudFront distribution with Origin Access Control (OAC), routing static requests (`/*`) to the private S3 bucket and dynamic calls (`/api/*`) to the ALB.
- **Why**: Single entry point with TLS termination at global edge PoPs. Eliminates CORS issues and complex reverse proxy rules.
- **How it connects**: Routes client traffic to either S3 or the ALB based on URL path patterns.
- **Likely Viva Questions**:
  1. *What is Origin Access Control (OAC) and how does it improve upon Origin Access Identity (OAI)?*
     - **Answer**: OAC uses AWS SigV4 signing for S3 requests, supports SSE-KMS encryption, works across all AWS regions, and provides stronger security posture compared to the legacy OAI mechanism.

### `scripts/pause.sh`, `scripts/resume.sh`, and `scripts/status.sh`
- **What they do**: Operational cost control scripts. `pause.sh` scales ASGs to 0, stops RDS and Victim EC2, purges SQS, pauses Config, and optionally destroys the ALB in deep mode. `resume.sh` brings the stack back to healthy state. `status.sh` calculates current burn and warns if RDS stop approaches the 7-day AWS auto-restart limit.
- **Why**: Keeps student credit expenditure strictly within the $20–$40 target.
- **Likely Viva Questions**:
  1. *What happens to a stopped RDS instance after 7 days?*
     - **Answer**: Amazon RDS automatically starts stopped database instances after 7 consecutive days to perform maintenance and apply security patches. `status.sh` checks the stop timestamp stored in SSM and issues a loud warning when stopped for 6+ days.

---

## 5. Workflow Automation & Governance Tier (`infra/modules/workflow/`, `infra/modules/governance/`)

### `infra/modules/workflow/main.tf` & `lambda/filter.py`
- **What it does**: Provisions the DynamoDB Stream event source mapping, the Lambda stream filter (`pulsewatch-stream-filter`), and the Step Functions state machine (`pulsewatch-incident-workflow`).
- **Why**: Decoupled, serverless outage verification. When a check fails, DynamoDB Streams invokes Lambda, which inspects the state transition and launches a Step Functions execution only for newly suspected incidents, preventing duplicate workflows.
- **How it connects**: Listens to `pulsewatch-checks` stream; writes incidents to `pulsewatch-incidents`; dispatches outage rechecks to SQS (`pulsewatch-check-queue`) with task tokens (`waitForTaskToken`); delivers notifications to SNS (`pulsewatch-alerts-topic`).
- **Likely Viva Questions**:
  1. *Why use Step Functions instead of handling the entire outage loop inside Lambda?*
     - **Answer**: Lambda functions are priced per execution time and have a 15-minute runtime limit. The outage re-verification loop spans 50 seconds and includes pauses (`Wait` states). Step Functions coordinates multi-step state transitions with zero compute charges while waiting (`Wait` states consume $0/second).
  2. *How does the outage re-verification work?*
     - **Answer**: It is outage re-verification by the worker fleet (not multi-AZ verification, as workers may run in the same AZ). Step Functions enqueues a probe to SQS with a task token (`waitForTaskToken`). When the worker fleet executes the check, it calls `SendTaskSuccess` with the probe result. If 2 consecutive rechecks fail, Step Functions marks the incident `CONFIRMED_DOWN` and publishes an email to SNS.
  3. *How does the recovery loop prevent infinite execution?*
     - **Answer**: The recovery loop includes a 300-iteration cap (counter increment in Step Functions state payload) and a 10-iteration "still down" reminder notification before exiting, ensuring workflows never run indefinitely.

### `infra/modules/governance/main.tf`
- **What it does**: Creates the CloudWatch unified operational dashboard (`pulsewatch-overview`), metric alarms, AWS CloudTrail audit trail, and AWS Config compliance recorder with 3 managed rules (`restricted-ssh`, `encrypted-volumes`, `s3-bucket-ssl-requests-only`).
- **Why**: Fulfills the Security and Operational Excellence pillars of the AWS Well-Architected Framework. Provides instant single-pane-of-glass observability during the viva.
- **How it connects**: Alarms monitor SQS DLQ depth and RDS CPU; dashboard graphs ALB latency, SQS backlog, and the custom `PulseWatch/Metrics` `SitesDown` metric published by the API.
- **Likely Viva Questions**:
  1. *Why must CloudWatch alarms specify `treat_missing_data = "notBreaching"`?*
     - **Answer**: When the system is paused overnight via `pause.sh`, metrics stop arriving. Without `notBreaching`, CloudWatch would interpret missing data as a breach and dispatch false-alarm emails via SNS.
  2. *Why limit AWS Config to specific resource types?*
     - **Answer**: AWS Config charges per configuration item recorded ($0.003/item). Recording every ephemeral resource (like ASG ENIs) inflates costs. Restricting the recorder to `AWS::S3::Bucket`, `AWS::EC2::SecurityGroup`, and `AWS::EC2::Volume` satisfies compliance while keeping costs under $0.10.

---

## 6. Demo Extras & Presentation Tools (`infra/modules/extras/`, `scripts/`)

### `infra/modules/extras/main.tf` & `scripts/demo-extras.sh`
- **What they do**: Provide toggle-able demo modules for advanced syllabus topics: AWS WAFv2 Web ACL, RDS PostgreSQL Multi-AZ failover, RDS Read Replica (`db.t4g.micro`), and AWS NAT Gateway.
- **Why**: Demonstrates high-tier enterprise features during the 15-minute viva presentation without burning monthly credits.
- **How it connects**: WAFv2 associates directly with the ALB; Read Replica replicates from primary RDS; NAT Gateway attaches to public subnets.
- **Likely Viva Questions**:
  1. *What is the difference between RDS Multi-AZ and an RDS Read Replica?*
     - **Answer**: Multi-AZ is synchronous replication to a standby instance in a different AZ for high availability and disaster recovery; the standby cannot be queried. Read Replicas use asynchronous replication for scaling read-heavy workloads; clients can query the replica directly.
  2. *What does AWS WAFv2 protect against?*
     - **Answer**: WAFv2 operates at Layer 7 (Application Layer). It inspects HTTP/S traffic for OWASP Top 10 vulnerabilities (SQL Injection, Cross-Site Scripting, HTTP request smuggling) using AWS Managed Rules, blocking malicious payloads before they hit the ALB or EC2.

### `scripts/demo-outage.sh` & `scripts/teardown.sh`
- **What they do**: `demo-outage.sh` commands the Victim EC2 via SSM to stop/start Nginx, initiating the live outage-to-recovery pipeline. `teardown.sh` empties all S3 buckets and executes `terraform destroy` when the project defense is completely finished.
- **Why**: Hands-off, reproducible demonstration and total safety against lingering cloud charges.
