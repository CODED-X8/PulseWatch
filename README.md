# PulseWatch: Cloud-Native Synthetic Uptime & Resilience Monitoring Platform on AWS

[![AWS Architecture](https://img.shields.io/badge/AWS-Cloud--Native-FF9900?logo=amazon-aws&logoColor=white)](https://aws.amazon.com/)
[![Terraform](https://img.shields.io/badge/IaC-Terraform_1.5+-844FBA?logo=terraform&logoColor=white)](https://www.terraform.io/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React 18](https://img.shields.io/badge/Frontend-React_18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/RDS-PostgreSQL_15-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![DynamoDB](https://img.shields.io/badge/NoSQL-DynamoDB_Streams-4053D6?logo=amazon-dynamodb&logoColor=white)](https://aws.amazon.com/dynamodb/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **PulseWatch** is a production-grade, distributed synthetic uptime monitoring and automated fault-remediation platform engineered natively on Amazon Web Services (AWS) in the Mumbai region (`ap-south-1`). It continuously evaluates endpoint availability, round-trip HTTP response times, and network health across private VPC peered infrastructure and public domains without alert fatigue or Server-Side Request Forgery (SSRF) exposure.

---

## 📌 Table of Contents
- [Architecture Overview](#-architecture-overview)
- [Key Engineering Innovations](#-key-engineering-innovations)
- [System Components & AWS Services](#-system-components--aws-services)
- [Repository Structure](#-repository-structure)
- [Quick Start: Local Development](#-quick-start-local-development)
- [Cloud Deployment via Terraform](#-cloud-deployment-via-terraform)
- [Operational Automation & Runbooks](#-operational-automation--runbooks)
- [Empirical Benchmarks & Verification](#-empirical-benchmarks--verification)
- [Academic Report & Course Documentation](#-academic-report--course-documentation)
- [Security & Financial Governance](#-security--financial-governance)
- [License & Acknowledgments](#-license--acknowledgments)

---

## 🏗 Architecture Overview

PulseWatch is structured around decoupled compute tiers, event-driven serverless state machines, and polyglot persistence to achieve resilience and high availability under educational budget constraints ($35.00/month cap).

```
                            [ Public Internet Route / Edge Ingress ]
                                               │
                                               ▼
                              [ Application Load Balancer (ALB) ]
                                    (Dual-AZ: ap-south-1a/b)
                                               │
                                 (Port 8000 Target Group)
                                               ▼
                            [ API Auto Scaling Group (EC2) ]
                                (FastAPI Microservice Fleet)
                                 │                       │
           (Atomic Claim Query:  │                       │ (Enqueue Due Targets)
     SELECT ... FOR UPDATE       ▼                       ▼
          SKIP LOCKED)   [ RDS PostgreSQL 15 ]    [ Amazon SQS Queue ]
                           (Private Subnets)      (pulsewatch-check-queue)
                                                         │
                                                         ▼
                                            [ Worker Fleet (EC2 ASG) ]
                                                 │               │
                             (Synthetic Probe    │               │ (Persist Latency
                                via VPC Peering) │               │  & Result)
                                                 ▼               ▼
                                       [ Target VPC Host ] [ DynamoDB (checks) ]
                                         (10.1.1.111)            │
                                                          (DynamoDB Stream)
                                                                 ▼
                                                      [ Lambda Stream Filter ]
                                                                 │
                                                       (Trigger on Down State)
                                                                 ▼
                                                  [ Step Functions State Machine ]
                                                                 │
                                                    (Re-Verification & Recovery)
                                                                 ▼
                                                      [ Amazon SNS Topic ]
                                                    (Verified Alert Emails)
```

---

## 💡 Key Engineering Innovations

### 1. Two-Tier False-Alarm Suppression
Transient network blips, server garbage collection pauses, or momentary packet loss frequently trigger false-positive alerts in traditional monitoring platforms.
- PulseWatch implements a two-tier verification workflow: when an initial scheduled probe fails, the monitor transitions to `SUSPECTED` state.
- AWS Step Functions pauses for a mandatory 5-second jitter interval (`WaitBeforeRecheck`) and coordinates an external out-of-band re-probe via an SQS task token (`waitForTaskToken`).
- Downtime is declared and Amazon SNS alert emails are published **only when the secondary probe confirms the outage**, eliminating 100% of single-probe false alarms while keeping detection latency under 8.7 seconds.

### 2. Polyglot Persistence Architecture
- **Amazon RDS (PostgreSQL 15)**: Houses relational, transactional entities (user accounts, authentication credentials hashed with bcrypt, monitor configurations, and scheduling cadence).
- **Amazon DynamoDB**: Operates in On-Demand mode for high-throughput, append-only time-series check observations (`pulsewatch-checks`) with native 30-day Time-To-Live (TTL) automatic deletion and DynamoDB Streams enabled (`NEW_IMAGE`).
- **Amazon S3**: Multi-tier object storage utilizing dedicated KMS envelope encryption and lifecycle tiering (30d Standard-IA $\to$ 90d Glacier $\to$ 365d Expiration) for incident CSV audit exports.

### 3. Distributed Non-Blocking Concurrency Control
To scale out API scheduler instances across multiple Availability Zones without duplicate check dispatches:
```sql
UPDATE monitors
SET next_check_at = NOW() + (interval_sec || ' seconds')::interval,
    updated_at = NOW()
WHERE id IN (
    SELECT id FROM monitors
    WHERE is_active = TRUE AND next_check_at <= NOW()
    ORDER BY next_check_at ASC
    LIMIT 10
    FOR UPDATE SKIP LOCKED
)
RETURNING id, user_id, name, url, expected_status, timeout_sec;
```
This atomic SQL query reserves candidate rows exclusively; concurrent nodes immediately bypass already-locked rows without blocking.

### 4. Zero-Trust Private VPC Peering & SSRF Defense
- Probes against internal microservices transit across a dedicated, non-transitive VPC Peering connection (`10.0.0.0/16` $\leftrightarrow$ `10.1.0.0/16`) over AWS internal fiber.
- Workers enforce kernel-level IP resolution checks before socket allocation: requests targeting loopback (`127.0.0.0/8`), private RFC 1918 blocks, or AWS instance metadata endpoints (`169.254.169.254`) are intercepted and rejected unless explicitly registered in the AWS Systems Manager allowlist parameter `/pulsewatch/allowed_private_hosts`.

---

## ☁️ System Components & AWS Services

| AWS Service | Identifier / Role | Operational Status |
| :--- | :--- | :---: |
| **Amazon VPC** | Dual-VPC architecture (`10.0.0.0/16` Main VPC & `10.1.0.0/16` Target VPC) | `LIVE` |
| **VPC Peering** | Direct peering (`pcx-0f2306f05a2b2ac72`) routing private RFC 1918 probes | `LIVE` |
| **Amazon EC2 / ASG** | Elastic compute fleets for API (`pulsewatch-api-asg`) and workers (`pulsewatch-worker-asg`) | `LIVE` |
| **Elastic Load Balancing** | Application Load Balancer (`pulsewatch-alb`) across dual Availability Zones | `LIVE` |
| **Amazon RDS** | PostgreSQL 15 (`db.t4g.micro`, 20 GiB gp3 storage encrypted via KMS) | `LIVE` |
| **Amazon DynamoDB** | Time-series checks store (`pulsewatch-checks`) with DynamoDB Streams & 30-day TTL | `LIVE` |
| **Amazon SQS** | Asynchronous check task buffer (`pulsewatch-check-queue`) backed by Dead-Letter Queue | `LIVE` |
| **Amazon SNS** | Encrypted notification topic (`pulsewatch-alerts-topic`) dispatching verified alert emails | `LIVE` |
| **AWS Lambda** | Stream filter runtime (`pulsewatch-stream-filter`) triggering Step Functions on down state | `LIVE` |
| **AWS Step Functions** | Distributed state machine (`pulsewatch-incident-workflow`) orchestrating recheck & recovery | `LIVE` |
| **Amazon S3** | Dedicated KMS-encrypted reports bucket with 30d IA / 90d Glacier lifecycle retention | `LIVE` |
| **AWS KMS** | Customer Managed Key (`alias/pulsewatch-kms`) enforcing envelope encryption at rest | `LIVE` |
| **Amazon CloudWatch** | Unified operational dashboard (`pulsewatch-overview`) tracking backlog, latency, and down count | `LIVE` |
| **AWS CloudTrail** | Management API audit trail writing signed digest logs to encrypted S3 | `LIVE` |
| **AWS Config** | Compliance recorder evaluating resource configurations against managed security rules | `LIVE` |
| **AWS Systems Manager** | Parameter Store for encrypted configurations; Session Manager for zero-port SSH-free access | `LIVE` |
| **AWS Budgets** | Automated cost governance alarm tracking a $35.00 monthly threshold | `LIVE` |
| **AWS WAFv2** | Regional Web ACL blocking Layer 7 directory traversal attacks with HTTP 403 Forbidden | `DEMONSTRATED` |

---

## 📂 Repository Structure

```
PulseWatch/
├── backend/                  # Python backend microservice
│   ├── app.py                # FastAPI REST API, auth, monitors, and scheduler
│   ├── worker.py             # SQS probe daemon with socket-level SSRF defense
│   ├── requirements.txt      # Python dependencies (fastapi, psycopg2, boto3, etc.)
│   └── tests/                # Unit test suite (SSRF containment and scheduler logic)
├── infra/                    # HashiCorp Terraform infrastructure-as-code
│   ├── main.tf               # Root Terraform entrypoint
│   ├── variables.tf          # Parameter declarations
│   ├── terraform.tfvars.example # Example environment variables template
│   └── modules/              # Modular IaC architecture
│       ├── networking/       # Dual-VPC, subnets, route tables, and VPC Peering
│       ├── compute/          # EC2 launch templates, Auto Scaling Groups, and ALB
│       ├── database/         # Amazon RDS PostgreSQL 15 and DynamoDB tables
│       ├── messaging/        # Amazon SQS queues, DLQ, and Amazon SNS alert topic
│       ├── workflow/         # AWS Lambda stream filter and Step Functions JSON state machine
│       ├── storage/          # S3 reports, artifacts, frontend, and lifecycle policies
│       ├── security/         # KMS Customer Managed Key (CMK) and IAM policies
│       ├── governance/       # AWS CloudTrail, AWS Config rules, and AWS Budgets
│       └── edge/             # CloudFront distribution and Origin Access Control (OAC)
├── scripts/                  # Operational runbooks and administrative automation
│   ├── status.sh             # Real-time health inspect, ASG state, queue depth, burn rate
│   ├── pause.sh              # Cost-conservation script scaling compute to 0 (light/deep)
│   ├── resume.sh             # Stack resume script restoring databases and instances
│   ├── demo-outage.sh        # Controlled outage test via SSM Run Command (start/stop)
│   ├── demo-extras.sh        # Interactive toggles for WAF, Multi-AZ reboot, Read Replica
│   ├── deploy-frontend.sh    # Builds and deploys React app to S3 website bucket
│   └── teardown.sh           # Clean resource destruction automation
├── src/                      # React 18 frontend single-page application
│   ├── components/           # UI widgets (ECG heartbeat animation, uptime strip, charts)
│   ├── pages/                # Dashboard, Monitor Detail, Incidents, and System Reactor
│   ├── api/                  # Unified API client (supports both Mock and Real AWS backends)
│   └── config.js             # Runtime configuration toggle (Mock vs. Real mode)
├── docs/                     # Comprehensive academic report and verification evidence
│   ├── ACADEMIC_REPORT.md    # 12,800+ word academic project report (IEEE-referenced)
│   ├── REPORT_FACT_CHECK.md  # Unvarnished audit of claims, divergences, and CLI checks
│   ├── SCREENSHOT_CHECKLIST.md # Console verification targets matching report figures
│   └── proof/                # Captured CLI command execution proof transcripts
└── README.md                 # Project documentation and setup guide
```

---

## 🚀 Quick Start: Local Development

### 1. Frontend Development (Mock Mode)
PulseWatch features a built-in browser-side Mock API with simulated latency, random jitter, and local state persistence.

```bash
# 1. Clone repository
git clone https://github.com/CODED-X8/PulseWatch.git
cd PulseWatch

# 2. Install dependencies
npm install

# 3. Launch Vite development server
npm run dev
```
Open `http://localhost:5173/` in your browser.

- Use **`Ctrl + K`** to open the Command Palette.
- Use **`Ctrl + Shift + D`** to toggle the Chaos Engineering & Dev Control Panel.

### 2. Running the Backend Locally
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run unit tests (SSRF validation and core logic)
python3 -m unittest tests/test_ssrf_and_logic.py
```

---

## 🛠 Cloud Deployment via Terraform

### Prerequisites
- AWS CLI v2 configured with appropriate credentials (e.g., profile `pulsewatch`).
- Terraform v1.5 or newer.
- An S3 bucket and DynamoDB table for Terraform remote state locking (optional for local state).

### Deployment Steps
```bash
cd infra

# 1. Create your terraform.tfvars from example
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your region and alert email addresses

# 2. Initialize Terraform
terraform init

# 3. Plan and apply infrastructure
terraform plan -out=tfplan
terraform apply tfplan

# 4. Deploy frontend web assets
cd ../
./scripts/deploy-frontend.sh
```

---

## ⚡ Operational Automation & Runbooks

PulseWatch includes battle-tested operational scripts in `scripts/`:

```bash
# Check stack status, active instances, and hourly burn rate
./scripts/status.sh

# Initiate a controlled outage test on the target host (stops Nginx via SSM)
./scripts/demo-outage.sh start

# Restore service on target host (Step Functions recovery loop verifies HTTP 200)
./scripts/demo-outage.sh stop

# Pause compute to minimize costs when idle (~$0.0225/hr instead of ~$0.0613/hr)
./scripts/pause.sh light

# Resume infrastructure back to operational capacity
./scripts/resume.sh
```

---

## 📊 Empirical Benchmarks & Verification

The platform has been empirically verified through live automated testing in AWS Mumbai (`ap-south-1`):

| Test Metric | Target Criterion | Measured Empirical Result | Status |
| :--- | :--- | :--- | :---: |
| **Outage Alert Latency** | $< 10.0$ seconds | **8.68 seconds** ($T_0$ to $T_2$ alert email dispatch) | **PASSED** |
| **Service Recovery Latency**| $< 15.0$ seconds | **9.18 seconds** ($T_3$ to $T_4$ recovery notification) | **PASSED** |
| **Transient Blip Rejection**| 100% false alarm rejection | **100% rejected** (State machine resolved transient without SNS alert) | **PASSED** |
| **Scheduler Concurrency** | Zero duplicate task dispatches | **Zero duplicates** (`SELECT ... FOR UPDATE SKIP LOCKED` atomic claim) | **PASSED** |
| **SSRF Containment** | 100% of illegal IPs blocked | **100% blocked** (Loopback, link-local metadata, private RFC 1918) | **PASSED** |
| **ASG Self-Healing** | Automatic instance replacement | Terminated worker replaced automatically with zero queue loss | **PASSED** |
| **S3 Lifecycle Tiering** | Verified transition rules | 30d Standard-IA $\to$ 90d Glacier $\to$ 365d expiration active | **PASSED** |

---

## 📖 Academic Report & Course Documentation

Comprehensive project documentation is compiled in the `docs/` folder:
- **[ACADEMIC_REPORT.md](docs/ACADEMIC_REPORT.md)**: Full academic capstone report (12,800+ words) covering cloud architecture principles, syllabus mapping across 36 AWS services, security analysis, Well-Architected assessment, and IEEE references.
- **[REPORT_FACT_CHECK.md](docs/REPORT_FACT_CHECK.md)**: An audit document detailing all verified empirical results, service status classifications, build-time defect resolutions, and hand-verification CLI commands.
- **[SCREENSHOT_CHECKLIST.md](docs/SCREENSHOT_CHECKLIST.md)**: Step-by-step console screenshot guide corresponding to Figures 4 through 12 in the academic report.

---

## 🔒 Security & Financial Governance

### Security Highlights
- **Zero Open Inbound SSH Ports**: All administrative access is handled via encrypted WebSockets using **AWS Systems Manager Session Manager**. Port 22 is disabled.
- **Envelope Encryption**: Storage at rest across RDS, DynamoDB, SQS, SNS, S3, and SSM is encrypted with a customer-managed KMS CMK (`alias/pulsewatch-kms`).
- **IMDSv2 Enforcement**: EC2 metadata access strictly requires a session token with a single-hop limit to defeat SSRF exfiltration.
- **Continuous Compliance**: AWS Config evaluates real-time compliance against `restricted-ssh`, `encrypted-volumes`, and `s3-bucket-ssl-requests-only`.

### Financial Governance
- Continuous running burn rate: **~$0.0613 / hour** (~$1.47 / day).
- Standby paused burn rate: **~$0.0225 / hour** (~$0.54 / day).
- Monitored by **AWS Budgets** configured with automated spend alerts at 50%, 80%, and 100% of the $35.00 monthly allocation.

---

## 📜 License & Acknowledgments

This project is licensed under the [MIT License](LICENSE).

- **Conceptual Attribution**: Inspiration for the incident state transition counter and failure threshold concepts is drawn from open-source research by [Robel Biruk (PulseWatch)](https://github.com/Robibiruk/PulseWatch).
- Developed as a Cloud Architecture capstone project on Amazon Web Services.
