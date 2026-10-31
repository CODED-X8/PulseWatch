# PulseWatch Build Log

## Overview
This log documents all actions, architectural decisions, and operational tracking for the PulseWatch AWS infrastructure and backend deployment.

---

## Log Entries

### Phase 0: Reconnaissance & Planning
- **Date**: 2026-10-27
- **Actions Executed**:
  - Inspected existing codebase layout (`src/`, `docs/`, `package.json`, `dist/`).
  - Executed read-only credential and environment checks:
    - AWS Caller Identity: `arn:aws:iam::826903518995:user/pulsewatch-admin` (Account: `826903518995`) via profile `pulsewatch`.
    - Terraform Version: `v1.17.0` (linux_amd64).
    - Python Version: `3.12.3`.
  - Hardened `.gitignore` to prevent any accidental leakage of `.tfstate`, `*.tfvars`, `.env`, secrets, or Python virtualenv artifacts.
  - Inspected `docs/API_CONTRACT.md` and reconciled with target backend requirements:
    - Identified required endpoint additions: `POST /api/system/load-test {count}` (admin only) and system status telemetry fields.
    - Added clearly marked addition section in `docs/API_CONTRACT.md`.
  - Authored comprehensive architecture and execution plan in `docs/PLAN.md`.
- **Decisions**:
  - Target spend budgeted strictly to $20–$40 within available ~$140 credit.
  - Zero NAT Gateway by default; API and workers run in public subnets with strict Security Groups (no public ingress except ALB, egress to SQS/DynamoDB/Internet probes).
  - RDS runs in private database subnets with single-AZ `db.t4g.micro` or `db.t3.micro`.
  - EC2 instances are `t4g.nano`/`t4g.micro` or `t3.nano`/`t3.micro` managed via Auto Scaling Groups with IMDSv2 enforced, encrypted EBS, and SSM Session Manager (zero SSH keys / port 22).

### Stage 1: Foundation Provisioned
- **Date**: 2026-10-27
- **Terraform State**: Created S3 state bucket `pulsewatch-tfstate-826903518995` and applied root configuration (`infra/main.tf`).
- **Provisioned Infrastructure (47 resources)**:
  - Customer Managed KMS Key: `alias/pulsewatch-kms` (`arn:aws:kms:ap-south-1:826903518995:key/70ec4ea9-4403-4f3f-857c-2b290f9d5f18`).
  - SSM Parameters:
    - `/pulsewatch/admin_email`: `singhayushbr@gmail.com`
    - `/pulsewatch/alert_email`: `anandayush798@gmail.com`
    - `/pulsewatch/jwt_secret`: SecureString encrypted with KMS.
    - `/pulsewatch/origin_verify_secret`: SecureString encrypted with KMS.
    - `/pulsewatch/allowed_private_hosts`: `10.1.1.111,victim.pulsewatch.internal`.
  - IAM Roles & Instance Profiles: API, Worker, and Victim instances equipped with `AmazonSSMManagedInstanceCore` and least-privilege KMS/SSM/SQS policies.
  - Main VPC (`vpc-01bdc1c3539572a91`): 2 public subnets (`subnet-04d60aa1a6d717dba`, `subnet-0607eabc3d68ae938`) and 2 private database subnets (`subnet-0d6c0227e149052c6`, `subnet-0df16d93a9c2196ed`), plus S3 Gateway Endpoint (`vpce-04bf7325da0fcea5a`).
  - Victim VPC (`vpc-0df9f47a55f4fb4ba`): Standalone subnet and VPC Peering (`pcx-0f2306f05a2b2ac72`) with bidirectional route entries.
  - Victim EC2 Host (`i-014c34ab76c8e1a67`): Private IP `10.1.1.111` running Nginx and PostgreSQL.
  - AWS Budgets: Alert configured at $35 monthly threshold with alerts to `anandayush798@gmail.com`.

### Stage 2: Data & Messaging Provisioned
- **Date**: 2026-10-27
- **Provisioned Infrastructure (21 resources total)**:
  - Amazon RDS PostgreSQL: `pulsewatch-db` (Engine: 15.13, Class: `db.t4g.micro`, 20GB GP3, Single-AZ, Private Subnets, KMS-encrypted).
    - Endpoint: `pulsewatch-db.cvcc6wo4k2o1.ap-south-1.rds.amazonaws.com:5432`.
    - Connection secrets saved to SSM: `/pulsewatch/db_host`, `/pulsewatch/db_port`, `/pulsewatch/db_name`, `/pulsewatch/db_user`, `/pulsewatch/db_password` (KMS SecureString).
  - Amazon DynamoDB:
    - `pulsewatch-checks`: On-Demand, Partition Key `monitor_id` (S), Sort Key `ts` (N), Streams (`NEW_IMAGE`), TTL enabled on `ttl`, KMS-encrypted.
    - `pulsewatch-incidents`: On-Demand, Partition Key `monitor_id` (S), Sort Key `item_id` (S), GSI `by_user` (Partition Key `user_id`, Sort Key `startedAt`), KMS-encrypted.
  - Amazon SQS:
    - Dead-Letter Queue: `pulsewatch-check-dlq` (14-day retention).
    - Main Queue: `pulsewatch-check-queue` (Visibility timeout 60s, maxReceiveCount 3 to DLQ).
  - Amazon SNS:
    - Alert Topic: `pulsewatch-alerts-topic`.
    - Email Subscription: Dispatched subscription request to `anandayush798@gmail.com`.
  - IAM Groups: Created `pulsewatch-developers` and `pulsewatch-readonly` with least-privilege policies.
- **Unit Testing**:
  - Pure Python unit tests for SSRF validation and state derivation passed 9 of 9 tests in `backend/tests/test_ssrf_and_logic.py`.

### Stages 3 & 4: Backend Code, Compute, Edge, and Pause/Resume Automation
- **Backend Application (`backend/`)**:
  - `backend/app.py`: Complete FastAPI implementation strictly following `docs/API_CONTRACT.md`. Features JWT auth, monitor CRUD with SSRF validation, `/api/summary` aggregated metrics, `/api/system` telemetry with IMDSv2 and SQS attributes, `/api/system/load-test`, S3 CSV incident report exports, and the atomic background scheduler loop using PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED`.
  - `backend/worker.py`: Autonomous SQS polling daemon. Probes HTTP/HTTPS URLs with SSRF validation, writes results to DynamoDB `pulsewatch-checks`, and handles Step Functions recheck callbacks via `states:SendTaskSuccess`.
  - Packaged into `infra/backend_package.zip` via `scripts/package-backend.sh`.
- **Infrastructure Modules (`infra/modules/compute`, `infra/modules/edge`)**:
  - `compute`: S3 artifacts bucket, Application Load Balancer with custom origin header validation (`X-PulseWatch-Origin-Verify`), Target Group with `/api/health`, Launch Templates (AL2023, IMDSv2, encrypted EBS), API ASG (1–2 `t3.micro`), Worker ASG (1–3 `t3.micro`) with SQS queue-depth step scaling. Configured `alb_enabled` variable for Deep Pause mode.
  - `edge`: S3 private frontend bucket, CloudFront Origin Access Control (OAC), CloudFront Distribution with default certificate, `/api/*` path pattern routing to ALB with origin secret injection, and SPA error routing.
- **Automation Scripts (`scripts/`)**:
  - `deploy-frontend.sh`: Compiles React app in real mode (`API_BASE_URL: ''`), syncs to S3, and invalidates CloudFront.
  - `status.sh`: Real-time operational inspection of ASGs, RDS, Victim EC2, ALB, SQS, and calculated hourly/monthly burn. Warns if stopped RDS approaches 6+ days.
  - `pause.sh light|deep`: Safely scales ASGs to 0, stops Victim EC2 & RDS, purges SQS, pauses Config recorder, persists state to SSM `/pulsewatch/pause_state` and `scripts/.pause_state.json`. Deep mode destroys ALB via Terraform.
  - `resume.sh`: Restores ASGs, RDS, Victim EC2, recreates ALB (if deep mode), and purges orphan DynamoDB state items.
- **Unit Tests**: Extended `backend/tests/test_ssrf_and_logic.py` with CSV report formatting and claim query syntax validation (100% passed).
- **Live Verification & Integration**:
  - Virtual Environment Adaptation: Solved Amazon Linux 2023 system RPM dependency conflicts by creating isolated `/opt/pulsewatch/venv` and removing redundant `urllib3` pin in `backend/requirements.txt`.
  - Security & Least-Privilege Fixes: Granted `kms:GenerateDataKey*` to `pulsewatch-api-instance-role` for KMS-encrypted SQS messaging, and added `s3:GetObject` to `pulsewatch-worker-instance-role` for artifact packaging.
  - End-to-End Live Workflow Verified: Registered user `singhayushbr@gmail.com`, logged in, created monitor for `http://10.1.1.111/healthz`.
  - Distributed scheduler atomically claimed due check with `FOR UPDATE SKIP LOCKED`, dispatched to KMS-encrypted SQS queue.
  - Worker daemon consumed SQS message, executed probe across VPC Peering (3ms latency, HTTP 200), wrote check to DynamoDB `pulsewatch-checks` with TTL.
  - Target monitor state successfully transitioned from `PENDING` to `UP`.
  - Verified `GET /api/system` IMDSv2 metadata (`i-087e1cef16884f5f5`, AZ `ap-south-1a`) and operational health of RDS, DynamoDB, and SQS.
  - Verified `./scripts/status.sh` and `./scripts/deploy-frontend.sh` operational health.

### Stage 5: Workflow Automation (Step Functions + Lambda) & Governance (CloudWatch + CloudTrail + Config)
- **Workflow Architecture (`infra/modules/workflow/`)**:
  - `lambda/filter.py`: Serverless stream parser invoked by DynamoDB Stream on `pulsewatch-checks`. Triggers Step Functions execution only when a check transitions to `DOWN`/`ERROR`, eliminating redundant executions for healthy probes.
  - Step Functions State Machine (`pulsewatch-incident-workflow`):
    - Implemented outage re-verification by the worker fleet (not multi-AZ verification, as workers may run in the same AZ) using `waitForTaskToken`.
    - Coordinates 2 distinct recheck probes across 50 seconds before confirming downtime.
    - Added 300-iteration protection cap on the recovery polling loop and 10-iteration "still down" reminder notification to prevent infinite execution.
    - Updated DynamoDB updates in Step Functions to handle String (`S`) format for `startedAt` required by GSI `by_user`.
- **Governance & Monitoring (`infra/modules/governance/`)**:
  - CloudWatch Dashboard (`pulsewatch-overview`): Single-pane observability for SQS depth, ALB latency, RDS CPU, and custom `PulseWatch/Metrics` `SitesDown` metric published by the API scheduler loop.
  - Alarms: Configured with `treat_missing_data = "notBreaching"` on DLQ messages and high RDS CPU to prevent false-alarm emails when the stack is paused overnight.
  - AWS CloudTrail: Trail `pulsewatch-cloudtrail` with encrypted S3 logging bucket `pulsewatch-cloudtrail-826903518995`.
  - AWS Config: Recorder `pulsewatch-recorder` limited to `AWS::S3::Bucket`, `AWS::EC2::SecurityGroup`, and `AWS::EC2::Volume` with 3 AWS managed compliance rules.
- **Outage Simulation & Recovery Validation**:
  - Scripted `scripts/demo-outage.sh` controlling Nginx on Victim EC2 (`10.1.1.111`) via SSM.
  - Outage triggered via `./scripts/demo-outage.sh start`:
    - Worker probe failed (`Connection Refused`).
    - DynamoDB Streams invoked Lambda filter, which started execution `inc-76fad97c-d320-45-1793096123217`.
    - State machine executed `MarkSuspected` -> `WaitBeforeRecheck1` -> `Recheck1` -> `WaitBeforeRecheck2` -> `Recheck2` -> `ConfirmDown`.
    - SNS dispatched confirmed DOWN alert email to `anandayush798@gmail.com`.
    - Monitor transitioned to `DOWN` with heartbeat flatlined in React frontend.
  - Recovery triggered via `./scripts/demo-outage.sh stop`:
    - Nginx restored on `10.1.1.111`.
    - Step Functions recovery loop detected HTTP 200, executed `MarkResolved`, and dispatched RECOVERED email via SNS.
    - Monitor heartbeat restored to steady green (`UP`) with 0 downtime in `/api/summary`.

### Stage 6: Demo Extras, Presentation Runbook & Final Academic Deliverables
- **Demo Extras (`infra/modules/extras/` & `scripts/demo-extras.sh`)**:
  - Built toggle-able, off-by-default Terraform module for:
    - AWS WAFv2 Web ACL on ALB (`enable_waf`).
    - RDS PostgreSQL Read Replica `pulsewatch-db-replica` (`enable_replica`).
    - AWS NAT Gateway for public subnet egress demo (`enable_nat`).
    - Multi-AZ RDS Failover demonstration via `rds reboot-db-instance`.
    - Worker SQS scale-out demonstration under synthetic backlog.
  - Tested `./scripts/demo-extras.sh --status` verifying all extras remain safely disabled by default.
- **Teardown Automation (`scripts/teardown.sh`)**:
  - Implemented safe teardown script that empties versioned/unversioned S3 buckets (artifacts, frontend, cloudtrail, config) and executes `terraform destroy` with explicit confirmation prompt.
- **Academic Viva Documentation**:
  - Authored comprehensive `docs/REPORT.md` including Six Well-Architected Framework Pillars review, syllabus mapping matrix (M1–M8), cost reconciliation, and documented temporary exceptions (public S3/ALB fallback pending CloudFront verification).
  - Authored step-by-step 15-minute presentation guide `docs/DEMO_RUNBOOK.md` with script lines, timings, and live demo commands.
  - Updated `docs/BACKEND_GUIDE.md` with detailed explanations and 2–3 anticipated viva questions per module.

### Final Verification Pass & Complete Infrastructure Pause (Light Mode)
- **Master Documentation Created**:
  - `docs/PROJECT_DOCUMENTATION.md`: Master comprehensive study document (10 sections) created from actual repo code and live AWS describe queries, complete with Mermaid diagrams, ASCII fallbacks, syllabus mapping (M1–M8), and explicit discrepancy disclosures.
  - `docs/ARCHITECTURE_CHEATSHEET.md`: High-density one-page quick-reference sheet for viva defense.
- **Hourly-Billed Demo Extras Verified & Destroyed**:
  - AWS WAFv2 Web ACL tested (legitimate 200, directory traversal blocked 403) and destroyed (`Active Regional WebACL count: 0`).
  - RDS Read Replica (`pulsewatch-db-replica`) provisioned and destroyed without final snapshot (`Active replica count: 0`).
  - Multi-AZ reboot failover timing captured.
- **Infrastructure Paused**:
  - Execution Time: `2026-10-27 16:34:52 IST` (`11:04:52 UTC`).
  - API ASG instances: `0` (Desired: 0, Min: 0, Max: 0).
  - Worker ASG instances: `0` (Desired: 0, Min: 0, Max: 0).
  - Victim EC2 (`10.1.1.111`): `stopped` ($0 compute burn).
  - RDS PostgreSQL (`pulsewatch-db`): `stopped` (AWS initiated shutdown).
  - SQS check queue: `0` messages (purged).
  - AWS Config recorder: `stopped` (`recording: false`).
  - Active Demo Extras: `0` WAF ACLs, `0` Read Replicas, `0` NAT Gateways, `0` Elastic IPs.
  - **AWS RDS 7-Day Auto-Restart Window**:
    - Under AWS RDS operational policy, stopped databases automatically restart after 7 days (168 hours).
    - **Exact Scheduled Auto-Restart Time**: **`2026-11-03 16:35:00 IST`** (`2026-11-03 11:05:00 UTC`).
  - **Current Estimated Run Rate**: **~$0.0225 / hour** (~$0.54 / day, ~$16.42 / month) solely for ALB base and allocated gp3 storage.
