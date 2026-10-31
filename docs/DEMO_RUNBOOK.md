# PulseWatch: Examiner Viva Presentation Runbook

This runbook gives you a step-by-step, 15-minute presentation script designed to impress university examiners and guarantee maximum viva scores. It aligns the live AWS infrastructure with core CS cloud engineering principles.

---

## ⏱️ Viva Presentation Timeline (15 Minutes)

| Time | Segment | What to Show / Demonstrate | Key Concept to Emphasize |
| :--- | :--- | :--- | :--- |
| **00:00 - 02:00** | **1. Architecture Overview** | Open `docs/PLAN.md` diagram and React UI | Multi-AZ decoupled architecture; Polyglot persistence |
| **02:00 - 04:00** | **2. Live Telemetry & Database** | React Dashboard showing live monitor & RDS/DynamoDB | Atomic scheduling (`FOR UPDATE SKIP LOCKED`) & DynamoDB TTL |
| **04:00 - 08:00** | **3. Outage & Serverless Healing** | Run `./scripts/demo-outage.sh start` & watch Step Functions | Event-driven architecture; SQS Task Token re-verification |
| **08:00 - 10:00** | **4. Service Recovery & Alerts** | Run `./scripts/demo-outage.sh stop` & show SNS recovery email | Automatic recovery loop with 300-iteration protection cap |
| **10:00 - 13:00** | **5. Advanced Cloud Extras** | Run `./scripts/demo-extras.sh` (WAF or Read Replica toggle) | Layer-7 WAF inspection, Read scale-out, NAT Gateway trade-offs |
| **13:00 - 15:00** | **6. Governance & Cost Optimization** | CloudWatch Dashboard (`pulsewatch-overview`) & `status.sh` | AWS Well-Architected Framework; Spending under $40 budget |

---

## 🚀 Step-by-Step Execution Guide

### Step 1: Pre-Viva Environment Verification (Run 5 min before exam)
Open your terminal in `/home/coded-x/Desktop/WebPulse`:
```bash
# 1. Verify all AWS services are running and healthy
./scripts/status.sh

# 2. Check that the frontend and API are live
curl -I http://pulsewatch-alb-2049379350.ap-south-1.elb.amazonaws.com/api/health
```
Open these browser tabs beforehand:
1. **PulseWatch Web App**: `http://pulsewatch-frontend-826903518995.s3-website.ap-south-1.amazonaws.com`
2. **AWS Step Functions Console**: `ap-south-1` -> State Machines -> `pulsewatch-incident-workflow`
3. **AWS CloudWatch Dashboard**: `ap-south-1` -> Dashboards -> `pulsewatch-overview`

---

### Step 2: Architecture Walkthrough (00:00 - 02:00)
**What to say to the examiner**:
> *"Good morning/afternoon professors. For my cloud computing capstone, I built **PulseWatch**, an enterprise-grade synthetic uptime monitoring platform on AWS.*
> *Rather than a standard monolithic deployment, PulseWatch uses a **decoupled, multi-tier event-driven architecture** spanning two Availability Zones in the Mumbai region (`ap-south-1`).*
> *It features polyglot persistence: PostgreSQL on RDS for high-integrity relational entities like user accounts and monitor configurations, and Amazon DynamoDB for millisecond time-series probe metrics with automatic TTL purging."*

---

### Step 3: Atomic Scheduling & Database Concurrency (02:00 - 04:00)
**Action**: Log into the PulseWatch frontend using your registered admin email (`singhayushbr@gmail.com`) and your secure password. Show the live monitor `Victim Host Internal` (`http://10.1.1.111/healthz`).

**What to say**:
> *"Our API scheduler runs on an EC2 Auto Scaling fleet. To prevent multiple API instances from picking up the exact same monitor at the same second, we implemented PostgreSQL's `SELECT ... FOR UPDATE SKIP LOCKED` inside an atomic transaction. This gives us zero-conflict, exactly-once scheduling without needing Redis or external distributed lock managers.*
> *When a check is due, the scheduler dispatches a task to SQS. Our worker instances long-poll SQS, execute the probe with SSRF protection, and persist the telemetry to DynamoDB."*

---

### Step 4: The Live Outage & Serverless Healing Demo (04:00 - 08:00)
**Action**: In terminal, run:
```bash
./scripts/demo-outage.sh start
```
**What happens**:
1. SSM commands the Victim EC2 at `10.1.1.111` to stop Nginx.
2. The next worker probe fails (`Connection Refused`).
3. The worker writes the failed check to DynamoDB.
4. DynamoDB Streams invokes the Lambda filter (`pulsewatch-stream-filter`).
5. Lambda launches Step Functions execution `inc-XXXX`.

**What to show**:
Switch to the **AWS Step Functions Console** and show the visual state machine executing in real time:
- State 1: `MarkSuspected` (immediately marks monitor SUSPECTED upon first failure)
- State 2: `WaitBeforeRecheck` (pauses for 5 seconds at zero compute cost)
- State 3: `ExecuteRecheck` (dispatches a single re-verification probe to SQS with `.waitForTaskToken`)
- State 4: Worker fleet re-verifies the failure and reports failure back via task token.
- State 5: `ConfirmDownState` -> `RecordIncidentForUI` (writes `INC#<ts>` record with `user_id` so UI displays incident).
- State 6: `SendDownAlert` (Amazon SNS dispatches an urgent DOWN alert email to `anandayush798@gmail.com`).

**What to say**:
> *"Notice that we do NOT alert on a single blip. To prevent alert fatigue, our serverless state machine initiates outage re-verification by the worker fleet. By waiting 5 seconds and running a single confirmation probe, we trade just ~5 seconds of detection latency to completely eliminate transient false alarms from network jitter. Once verified, Step Functions records the incident for the UI and dispatches an Amazon SNS critical alert in under 9 seconds total."*

---

### Step 5: Service Recovery (08:00 - 10:00)
**Action**: In terminal, run:
```bash
./scripts/demo-outage.sh stop
```
**What happens**:
1. SSM restarts Nginx on `10.1.1.111`.
2. Step Functions is running its internal recovery loop (polling every 15s with a 300-iteration safety limit).
3. The probe returns HTTP 200.
4. Step Functions transitions to `MarkResolved`, updates the incident record in DynamoDB with `resolvedAt`, and sends an SNS RECOVERED email notification.
5. In the web dashboard, the monitor heartbeat turns green (`UP`) and the Incidents dashboard marks the incident `RESOLVED`.

---

### Step 6: Advanced Cloud Extras (10:00 - 13:00)
**Action**: In terminal, launch the demo extras controller:
```bash
./scripts/demo-extras.sh
```
Choose Option 1 to toggle AWS WAFv2 on the ALB, or Option 3 to spin up an RDS Read Replica.

**What to say**:
> *"To address Module 8 (Disaster Recovery) and Module 5 (Application Security), we built toggle-able Terraform modules. With a single command, we can attach an AWS WAFv2 Web ACL with the AWS Managed Common Rule Set to shield our ALB against OWASP Top-10 attacks, or provision a cross-AZ RDS Read Replica for offloading read traffic."*

---

### Step 7: Governance, Storage & Cost Optimization (13:00 - 15:00)
**Action**:
1. Switch to the **AWS CloudWatch Dashboard** (`pulsewatch-overview`). Show:
   - Live SQS queue depth & worker activity
   - RDS CPU utilization
   - The custom metric `SitesDown` published under `PulseWatch/Metrics`
   - AWS Config managed rules verifying EBS encryption and restricted SSH.
2. In the PulseWatch web UI (`/incidents`), click **"Export Incidents (CSV)"**:
   - Show how the API requests a presigned URL from the dedicated KMS-encrypted bucket `pulsewatch-reports-826903518995` (configured via SSM parameter `/pulsewatch/reports_bucket`).
   - Browser downloads the audit CSV directly from S3 without passing bulk binary data through the API.
3. Switch to **Amazon S3 Console** -> `pulsewatch-reports-826903518995` -> **Management**:
   - Highlight the automated lifecycle rule `reports-tiered-retention`: Standard -> Standard-IA (30 days) -> Glacier Flexible Retrieval (90 days) -> Expire (365 days).
   - Point out that incomplete multipart uploads abort after 7 days, and artifacts bucket cleans up noncurrent versions after 30 days.
   - Mention the 30-day minimum residency and 128 KB minimum billable object size trade-offs for viva cost governance defense.

**Concluding Statement**:
> *"PulseWatch was engineered strictly according to the Six Pillars of the AWS Well-Architected Framework:
> 1. **Security**: Zero SSH keys, Session Manager only, KMS customer-managed encryption everywhere, IAM least-privilege.
> 2. **Reliability**: Multi-AZ deployments, Auto Scaling Groups, and SQS DLQ handling.
> 3. **Performance Efficiency**: S3 edge hosting, CloudFront OAC, and DynamoDB sub-millisecond writes.
> 4. **Cost Optimization**: Operational pause automation (`pause.sh`), eliminating unnecessary NAT Gateways, and S3 tiered lifecycle management (Standard-IA -> Glacier -> Expiration) kept our total cloud burn strictly under our \$40 budget.
> 5. **Operational Excellence**: Infrastructure as Code with Terraform, AWS CloudTrail audit logs, and CloudWatch unified telemetry.
> 6. **Sustainability**: Auto Scaling instances to 0 when idle, S3 object expiration, and DynamoDB automatic TTL cleanup reduce unneeded cloud compute resources."*

---

## 🌐 Venue Network Setup: Updating `my_ip_cidr`

When presenting from a university Wi-Fi, lab network, or hotspot, your public IP will differ from your home network. To instantly lock the ALB ingress to your venue network with one command:

```bash
# Automatically detects venue public IP and updates ALB ingress security group:
./scripts/set-my-ip.sh
```
Alternatively, pass your IP explicitly via Terraform:
```bash
terraform -chdir=infra apply -var="my_ip_cidr=$(curl -s https://checkip.amazonaws.com)/32" -target=module.network.aws_security_group.alb -auto-approve
```

---

## ⚡ Live External Site Demo: Monitoring a Personal Vercel/Next.js App

If the examiner asks: *"Can PulseWatch monitor external production web apps hosted outside AWS?"*

1. **Add the External Monitor**:
   - In the PulseWatch web UI (`/`), click **"+ Add Monitor"**.
   - **Name**: `Personal Portfolio / Vercel Web App`
   - **URL**: `https://your-app.vercel.app` (or your personal domain)
   - **Check Interval**: `1 minute`
   - **Expected Status**: `200 OK`
   - Click **"Create Monitor"**.
2. **Observe Steady Telemetry**:
   - Within 15–30 seconds, worker instances resolve the DNS, execute the probe, and display latency (typically 20–45ms) and a green `UP` heartbeat.
3. **Simulate an Outage on Vercel**:
   - **Method A**: Temporarily change the monitor URL in PulseWatch to a non-existent route: `https://your-app.vercel.app/simulated-outage-404` (Expected status: 200).
   - **Method B**: Redeploy or put Vercel project into maintenance/password-protected mode.
4. **Watch State Progression**:
   - `UP` -> `SUSPECTED` (Worker probe encounters 404 or 503).
   - DynamoDB Stream triggers Lambda -> Step Functions executes re-verification.
   - After a 5-second wait and 1 confirmation recheck probe -> Status transitions to `DOWN` (flatline heartbeat).
   - Amazon SNS dispatches an urgent alert email to `anandayush798@gmail.com`.
5. **Restore the Site**:
   - Restore the route or redeploy on Vercel.
   - Step Functions recovery loop detects HTTP 200 -> Transitions to `RESOLVED` -> Heartbeat turns green!

---

## 🛠️ Post-Viva Actions
When your presentation is concluded and examiners have completed scoring:
```bash
# Option A: Pause instances overnight (costs ~$0.01/day)
./scripts/pause.sh

# Option B: Permanently destroy all infrastructure when semester is finished
./scripts/teardown.sh
```
