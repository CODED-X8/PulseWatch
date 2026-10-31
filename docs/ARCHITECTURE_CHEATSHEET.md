# PulseWatch: Architecture Cheatsheet (One-Page Viva Guide)

---

## 1. System Topology & Connectivity

```
[ Operator / Evaluator Browser ]
            │
            ▼ (HTTP Direct / S3 Website Fallback)
[ Application Load Balancer (ALB) ]
  • ap-south-1a & ap-south-1b (Public Subnets)
  • Rule 1: X-PulseWatch-Origin-Verify header match -> Forward to API Target Group
  • Rule 2: Host header / direct path -> Forward to API Target Group
            │ (Port 8000)
            ▼
[ API Auto Scaling Group ] (Desired: 1, Min: 1, Max: 2, t3.micro)
  • FastAPI (Uvicorn) daemon on systemd
  • Distributed scheduler thread claiming due checks via:
    SELECT ... FOR UPDATE SKIP LOCKED
     ├── Writes checks/monitors to ──► [ RDS PostgreSQL 15 ] (db.t4g.micro, Private Subnets)
     └── Enqueues due probes into ───► [ Amazon SQS ] (pulsewatch-check-queue + DLQ, KMS encrypted)
                                             │
                                             ▼ (Long-polling 20s, max 10 msgs)
                                   [ Worker Auto Scaling Group ] (Desired: 1, Min: 1, Max: 3, t3.micro)
                                     • SSRF filter: loopback, RFC1918, metadata (169.254.169.254) blocked
                                     • Allowed private hosts: 10.1.1.111 (SSM whitelisted)
                                     • Outbound synthetic HTTP probe over VPC Peering (pcx-0f2306f05a2b2ac72)
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       ▼                                           ▼
         [ Victim EC2 Host ] (10.1.1.111)           [ DynamoDB: pulsewatch-checks ]
         (Nginx + Postgres in Victim VPC)           (On-demand, TTL 30 days, Stream NEW_IMAGE)
                                                                   │ (DynamoDB Stream)
                                                                   ▼
                                                    [ Lambda: stream-filter ]
                                                    (Filters: status == "down" && source == "scheduled")
                                                                   │
                                                                   ▼ (Trigger Execution)
                                                    [ AWS Step Functions State Machine ]
                                                    (pulsewatch-incident-workflow)
                                                    • MarkSuspected -> Wait 15s -> Recheck 1 (SQS Task Token)
                                                    • Wait 15s -> Recheck 2 -> ConfirmDown
                                                    • Dispatches Critical Alert -> [ Amazon SNS Topic ]
                                                    • Recovery Loop (Wait 30s -> Recheck -> Cap 300 cycles)
                                                    • MarkResolved -> Recovery Alert -> [ SNS Email ]
```

---

## 2. Core Operational Flows in 3 Lines Each

### Flow A: Scheduling & Probe Execution
1. API background thread queries PostgreSQL with `UPDATE monitors ... WHERE id IN (SELECT id ... FOR UPDATE SKIP LOCKED)` every 15s.
2. Due monitor jobs are enqueued to KMS-encrypted SQS queue `pulsewatch-check-queue`.
3. Worker daemon long-polls SQS, verifies URL against SSRF rules, probes target (e.g. `10.1.1.111`), writes observation to DynamoDB, and deletes message.

### Flow B: Outage Detection & Serverless Fleet Re-Verification
1. Worker probe encounters outage (`Connection refused`), writing a check with `status = "down"` to DynamoDB.
2. DynamoDB Streams invokes `pulsewatch-stream-filter` Lambda, which initiates a Step Functions execution (`inc-<id>-<ts>`).
3. Step Functions marks `SUSPECTED`, waits 15s, dispatches 2 consecutive SQS rechecks with task tokens across 50s; upon failure, marks `CONFIRMED_DOWN` and fires SNS email.

### Flow C: Automated Service Recovery
1. When target recovers (e.g. Nginx restarted), Step Functions polling loop (30s intervals, capped at 300 cycles) executes a recheck probe.
2. Worker returns `ok: true` via `states:SendTaskSuccess`.
3. Step Functions updates DynamoDB incident to `UP` (`resolvedAt`), sends an SNS `[RESOLVED]` email, and terminates successfully.

---

## 3. Service Inventory & Fast Reference

| AWS Service | Resource Name / Identifier | Core Job in PulseWatch |
| :--- | :--- | :--- |
| **Amazon VPC** | `pulsewatch-main-vpc` (`10.0.0.0/16`) | Dual-AZ network hosting ALB, API, workers, and RDS |
| **Amazon VPC** | `pulsewatch-victim-vpc` (`10.1.0.0/16`) | Isolated network hosting target server (`10.1.1.111`) |
| **VPC Peering** | `pcx-0f2306f05a2b2ac72` | Private route between Main VPC and Victim VPC |
| **AWS KMS** | `alias/pulsewatch-kms` | Customer Managed Key encrypting RDS, DynamoDB, SQS, S3, SSM |
| **Amazon RDS** | `pulsewatch-db` (`db.t4g.micro`) | PostgreSQL 15 ACID store for user credentials & monitors |
| **Amazon DynamoDB** | `pulsewatch-checks`, `pulsewatch-incidents` | High-throughput NoSQL timeseries store with Streams, TTL & GSI |
| **Amazon SQS** | `pulsewatch-check-queue` + `dlq` | Asynchronous probe decoupling buffer with DLQ (3 retries) |
| **Amazon SNS** | `pulsewatch-alerts-topic` | Email notification dispatcher (`anandayush798@gmail.com`) |
| **AWS Lambda** | `pulsewatch-stream-filter` | Stream parser invoking Step Functions on failure |
| **AWS Step Functions**| `pulsewatch-incident-workflow` | Outage re-verification state machine with Task Tokens |
| **CloudWatch** | `pulsewatch-overview` | Operational dashboard graphing SQS, ALB, RDS, and `SitesDown` |
| **AWS Systems Manager**| SSM Parameter Store & Session Manager | KMS-encrypted secret storage and agent-based access (No port 22) |
| **Amazon CloudFront** | S3 Origin / ALB Origin | Edge CDN (Distribution awaiting AWS trust verification) |

---

## 4. Key Numbers to Remember for Viva

- **VPC Subnets**: Main VPC `10.0.0.0/16` (Public: `10.0.1.0/24`, `10.0.2.0/24`; Private: `10.0.11.0/24`, `10.0.12.0/24`). Victim VPC `10.1.0.0/16` (`10.1.1.0/24`).
- **EC2 Sizing**: `t3.micro` (2 vCPU, 1 GiB RAM). RDS: `db.t4g.micro` (Graviton2, 2 vCPU, 1 GiB RAM, 20 GB gp3).
- **Outage Recheck Timings**: 1st Wait: `15s`, SQS Timeout: `45s`, 2nd Wait: `15s`, Total to DOWN email: `~50s`.
- **Recovery Loop**: Interval: `30s`, Safety Loop Cap: `300 iterations` (~2.5 hours max), Reminders at cycles `60, 120, 180, 240`.
- **DynamoDB Retention**: TTL: `30 days` (`2,592,000s`) on attribute `ttl`. SQS Retention: Main: `1 day`, DLQ: `14 days`.
- **Cost Burn**: Running: **~$0.043–$0.061 / hr** (~$31–$44 / mo). Paused: **~$0.0225 / hr** (~$0.54 / day).
