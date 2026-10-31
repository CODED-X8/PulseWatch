import os
import sys
import time
import json
import uuid
import socket
import ipaddress
import threading
import logging
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse

import boto3
import bcrypt
import jwt
import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, Header, Depends, status, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("pulsewatch-api")

REGION = os.environ.get("AWS_REGION", "ap-south-1")

from botocore.config import Config

ssm_client = boto3.client("ssm", region_name=REGION)
sqs_client = boto3.client("sqs", region_name=REGION)
dynamodb_resource = boto3.resource("dynamodb", region_name=REGION)
asg_client = boto3.client("autoscaling", region_name=REGION)
s3_client = boto3.client(
    "s3",
    region_name=REGION,
    endpoint_url=f"https://s3.{REGION}.amazonaws.com",
    config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"})
)
cw_client = boto3.client("cloudwatch", region_name=REGION)

def get_ssm_param(name: str, with_decryption: bool = False, default: str = "") -> str:
    try:
        resp = ssm_client.get_parameter(Name=name, WithDecryption=with_decryption)
        return resp["Parameter"]["Value"]
    except Exception as e:
        logger.warning(f"Failed to read SSM param {name}: {e}")
        return default

JWT_SECRET = get_ssm_param("/pulsewatch/jwt_secret", with_decryption=True, default="fallback_dev_secret")
ADMIN_EMAIL = get_ssm_param("/pulsewatch/admin_email", default="singhayushbr@gmail.com")
ALLOWED_HOSTS_RAW = get_ssm_param("/pulsewatch/allowed_private_hosts", default="10.1.1.111")
ALLOWED_HOSTS = [h.strip() for h in ALLOWED_HOSTS_RAW.split(",") if h.strip()]

DB_HOST = get_ssm_param("/pulsewatch/db_host", default="")
DB_PORT = get_ssm_param("/pulsewatch/db_port", default="5432")
DB_NAME = get_ssm_param("/pulsewatch/db_name", default="pulsewatch")
DB_USER = get_ssm_param("/pulsewatch/db_user", default="pulsewatch_admin")
DB_PASSWORD = get_ssm_param("/pulsewatch/db_password", with_decryption=True, default="")

REPORTS_BUCKET = get_ssm_param("/pulsewatch/reports_bucket", default=os.environ.get("REPORTS_BUCKET", ""))
CHECK_QUEUE_URL = os.environ.get("CHECK_QUEUE_URL", "")

table_checks = dynamodb_resource.Table("pulsewatch-checks")
table_incidents = dynamodb_resource.Table("pulsewatch-incidents")

def get_db_connection():
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        connect_timeout=5
    )

def init_db():
    if not DB_HOST:
        logger.warning("DB_HOST not set, skipping DB init.")
        return
    logger.info("Initializing database tables...")
    retries = 5
    while retries > 0:
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS users (
                            id UUID PRIMARY KEY,
                            email VARCHAR(255) UNIQUE NOT NULL,
                            password_hash VARCHAR(255) NOT NULL,
                            created_at TIMESTAMPTZ DEFAULT NOW()
                        );
                        CREATE TABLE IF NOT EXISTS monitors (
                            id UUID PRIMARY KEY,
                            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                            name VARCHAR(255) NOT NULL,
                            url VARCHAR(2048) NOT NULL,
                            interval_min INT NOT NULL DEFAULT 5,
                            expected_status INT NOT NULL DEFAULT 200,
                            timeout_sec INT NOT NULL DEFAULT 10,
                            paused BOOLEAN NOT NULL DEFAULT FALSE,
                            next_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            created_at TIMESTAMPTZ DEFAULT NOW(),
                            CONSTRAINT uq_user_url UNIQUE(user_id, url)
                        );
                        CREATE INDEX IF NOT EXISTS idx_monitors_due 
                        ON monitors(next_check_at) 
                        WHERE paused = false;
                    """)
                    conn.commit()
            logger.info("Database tables verified.")
            break
        except Exception as e:
            logger.error(f"DB init attempt failed: {e}")
            retries -= 1
            time.sleep(3)

def is_ssrf_safe(url: str, allowlist: list) -> tuple[bool, str]:
    if not url or len(url) > 2048:
        return False, "URL length exceeds limit"
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False, "Only HTTP/HTTPS protocols are supported"
    hostname = parsed.hostname
    if not hostname:
        return False, "Missing or invalid hostname in URL"
    
    hostname_lower = hostname.lower()
    for allowed in allowlist:
        if hostname_lower == allowed.lower():
            return True, "Whitelisted"
            
    try:
        resolved_ips = socket.gethostbyname_ex(hostname_lower)[2]
    except Exception:
        try:
            ipaddress.ip_address(hostname_lower)
            resolved_ips = [hostname_lower]
        except ValueError:
            return False, "Could not resolve target hostname"

    for ip_str in resolved_ips:
        ip = ipaddress.ip_address(ip_str)
        if ip.is_loopback:
            return False, f"Target host {hostname_lower} resolves to loopback IP"
        if ip.is_private:
            return False, f"Target host {hostname_lower} resolves to private RFC1918 address"
        if ip.is_link_local or ip_str == "169.254.169.254":
            return False, f"Target host {hostname_lower} resolves to cloud metadata / link-local address"
            
    return True, "Safe"

app = FastAPI(title="PulseWatch API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def create_jwt_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "iat": datetime.now(timezone.utc)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def get_current_user(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid token")
    token = authorization.split(" ")[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return {"id": payload["sub"], "email": payload["email"]}
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalid or expired")

class AuthPayload(BaseModel):
    email: str
    password: str

class MonitorCreatePayload(BaseModel):
    name: str
    url: str
    intervalMin: int = 5
    expectedStatus: int = 200
    timeoutSec: int = 10

class MonitorUpdatePayload(BaseModel):
    name: str
    url: str
    intervalMin: int
    expectedStatus: int
    timeoutSec: int

class LoadTestPayload(BaseModel):
    count: int = 50

@app.on_event("startup")
def startup_event():
    init_db()
    start_scheduler()

@app.get("/api/health")
def health():
    return {"ok": True}

@app.post("/api/auth/register")
def register(payload: AuthPayload):
    email = payload.email.strip().lower()
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    
    salt = bcrypt.gensalt()
    pw_hash = bcrypt.hashpw(payload.password.encode("utf-8"), salt).decode("utf-8")
    user_id = str(uuid.uuid4())

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO users (id, email, password_hash) VALUES (%s, %s, %s)",
                    (user_id, email, pw_hash)
                )
                conn.commit()
    except psycopg2.IntegrityError:
        raise HTTPException(status_code=400, detail="An account with this email already exists")
    except Exception as e:
        logger.error(f"Register failed: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

    token = create_jwt_token(user_id, email)
    role = "Admin" if email == ADMIN_EMAIL.lower() else "Engineer"
    return {
        "token": token,
        "user": {"id": user_id, "email": email, "name": email.split("@")[0], "role": role}
    }

@app.post("/api/auth/login")
def login(payload: AuthPayload):
    email = payload.email.strip().lower()
    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute("SELECT id, email, password_hash FROM users WHERE email = %s", (email,))
                user = cur.fetchone()
    except Exception as e:
        logger.error(f"Login DB query failed: {e}")
        raise HTTPException(status_code=500, detail="Database unreachable")

    if not user or not bcrypt.checkpw(payload.password.encode("utf-8"), user["password_hash"].encode("utf-8")):
        raise HTTPException(status_code=400, detail="Invalid email or password")

    user_id = str(user["id"])
    token = create_jwt_token(user_id, email)
    role = "Admin" if email == ADMIN_EMAIL.lower() else "Engineer"
    return {
        "token": token,
        "user": {"id": user_id, "email": email, "name": email.split("@")[0], "role": role}
    }

def get_monitor_state_and_checks(monitor_id: str, paused: bool):
    if paused:
        return "PAUSED", "steady", None, []

    state = "PENDING"
    heartbeat = "steady"

    try:
        state_resp = table_incidents.get_item(Key={"monitor_id": monitor_id, "item_id": "STATE"})
        if "Item" in state_resp:
            st = state_resp["Item"].get("state", "UP").upper()
            if st == "SUSPECTED":
                state = "SUSPECTED"
                heartbeat = "irregular"
            elif st in ("DOWN", "CONFIRMED"):
                state = "DOWN"
                heartbeat = "flat"
    except Exception as e:
        logger.warning(f"Could not read state for {monitor_id}: {e}")

    checks = []
    latest_check = None
    try:
        resp = table_checks.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key("monitor_id").eq(monitor_id),
            ScanIndexForward=False,
            Limit=90
        )
        checks = resp.get("Items", [])
        if checks:
            latest_check = checks[0]
            if state == "PENDING":
                state = "UP"
                heartbeat = "steady"
    except Exception as e:
        logger.warning(f"Could not read checks for {monitor_id}: {e}")

    return state, heartbeat, latest_check, checks

@app.get("/api/summary")
def get_summary(user: dict = Depends(get_current_user)):
    user_id = user["id"]
    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute("SELECT id, paused FROM monitors WHERE user_id = %s", (user_id,))
                rows = cur.fetchall()
    except Exception as e:
        logger.error(f"Summary DB query failed: {e}")
        raise HTTPException(status_code=500, detail="Database unreachable")

    up = 0
    down = 0
    suspected = 0
    paused = 0
    total_latency = 0
    latency_count = 0
    total_uptime = 0.0

    for r in rows:
        m_id = str(r["id"])
        is_paused = r["paused"]
        st, _, latest, checks = get_monitor_state_and_checks(m_id, is_paused)

        if st == "UP":
            up += 1
        elif st == "DOWN":
            down += 1
        elif st == "SUSPECTED":
            suspected += 1
        elif st == "PAUSED":
            paused += 1

        if latest and latest.get("latency_ms") and st != "DOWN":
            total_latency += int(latest["latency_ms"])
            latency_count += 1

        if checks:
            up_count = sum(1 for c in checks if c.get("status") == "up")
            total_uptime += (up_count / len(checks)) * 100.0
        else:
            total_uptime += 100.0

    count = len(rows)
    avg_latency = round(total_latency / latency_count) if latency_count > 0 else 45
    uptime_24h = round(total_uptime / count, 2) if count > 0 else 100.0
    spark = [42, 44, 46, 43, 45, 48, 47, 44, 45, avg_latency]

    return {
        "up": up,
        "down": down,
        "suspected": suspected,
        "paused": paused,
        "uptime24h": uptime_24h,
        "avgLatency24h": avg_latency,
        "spark": spark
    }

@app.get("/api/monitors")
def get_monitors(user: dict = Depends(get_current_user)):
    user_id = user["id"]
    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute("""
                    SELECT id, name, url, interval_min, expected_status, timeout_sec, paused, created_at
                    FROM monitors WHERE user_id = %s ORDER BY created_at DESC
                """, (user_id,))
                rows = cur.fetchall()
    except Exception as e:
        logger.error(f"Monitors DB query failed: {e}")
        raise HTTPException(status_code=500, detail="Database unreachable")

    monitors_list = []
    for r in rows:
        m_id = str(r["id"])
        st, hb, latest, checks = get_monitor_state_and_checks(m_id, r["paused"])

        strip = []
        if checks:
            for c in reversed(checks[:90]):
                strip.append("up" if c.get("status") == "up" else "down")
        while len(strip) < 90:
            strip.insert(0, "none")

        data_days = [s for s in strip if s in ("up", "down")]
        up_cnt = sum(1 for s in data_days if s == "up")
        uptime = round((up_cnt / len(data_days)) * 100.0, 2) if data_days else 100.0

        monitors_list.append({
            "id": m_id,
            "name": r["name"],
            "url": r["url"],
            "intervalMin": r["interval_min"],
            "expectedStatus": r["expected_status"],
            "timeoutSec": r["timeout_sec"],
            "state": st,
            "lastCheckedAt": latest["ts_iso"] if latest and "ts_iso" in latest else (datetime.now(timezone.utc).isoformat()),
            "lastLatencyMs": int(latest["latency_ms"]) if latest and "latency_ms" in latest else 0,
            "uptime24h": uptime,
            "strip": strip,
            "heartbeat": hb
        })

    return monitors_list

@app.post("/api/monitors", status_code=201)
def create_monitor(payload: MonitorCreatePayload, user: dict = Depends(get_current_user)):
    user_id = user["id"]
    name = payload.name.strip()
    url = payload.url.strip()

    if not name or not url:
        raise HTTPException(status_code=400, detail="Name and URL are required")

    safe, reason = is_ssrf_safe(url, ALLOWED_HOSTS)
    if not safe:
        raise HTTPException(status_code=403, detail=f"SSRF Policy Violation: {reason}")

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM monitors WHERE user_id = %s", (user_id,))
                count = cur.fetchone()[0]
                if count >= 10:
                    raise HTTPException(status_code=400, detail="Max 10 monitors allowed per account")

                m_id = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO monitors (id, user_id, name, url, interval_min, expected_status, timeout_sec, next_check_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                """, (m_id, user_id, name, url, payload.intervalMin, payload.expectedStatus, payload.timeoutSec))
                conn.commit()
    except psycopg2.IntegrityError:
        raise HTTPException(status_code=409, detail=f"A monitor with URL '{url}' already exists for your account")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create monitor DB query failed: {e}")
        raise HTTPException(status_code=500, detail="Database write error")

    return {
        "id": m_id,
        "name": name,
        "url": url,
        "intervalMin": payload.intervalMin,
        "expectedStatus": payload.expectedStatus,
        "timeoutSec": payload.timeoutSec,
        "state": "PENDING",
        "lastCheckedAt": datetime.now(timezone.utc).isoformat(),
        "lastLatencyMs": 0,
        "uptime24h": 100.0,
        "strip": ["none"] * 90,
        "heartbeat": "steady"
    }

@app.put("/api/monitors/{monitor_id}")
def update_monitor(monitor_id: str, payload: MonitorUpdatePayload, user: dict = Depends(get_current_user)):
    user_id = user["id"]
    name = payload.name.strip()
    url = payload.url.strip()

    safe, reason = is_ssrf_safe(url, ALLOWED_HOSTS)
    if not safe:
        raise HTTPException(status_code=403, detail=f"SSRF Policy Violation: {reason}")

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE monitors
                    SET name = %s, url = %s, interval_min = %s, expected_status = %s, timeout_sec = %s
                    WHERE id = %s AND user_id = %s
                """, (name, url, payload.intervalMin, payload.expectedStatus, payload.timeoutSec, monitor_id, user_id))
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Monitor not found")
                conn.commit()
    except psycopg2.IntegrityError:
        raise HTTPException(status_code=409, detail=f"Another monitor with URL '{url}' already exists")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update monitor DB error: {e}")
        raise HTTPException(status_code=500, detail="Database write error")

    return {"id": monitor_id, "name": name, "url": url}

@app.delete("/api/monitors/{monitor_id}")
def delete_monitor(monitor_id: str, user: dict = Depends(get_current_user)):
    user_id = user["id"]
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM monitors WHERE id = %s AND user_id = %s", (monitor_id, user_id))
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Monitor not found")
                conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete monitor error: {e}")
        raise HTTPException(status_code=500, detail="Database error")

    return {"ok": True, "deletedId": monitor_id}

@app.post("/api/monitors/{monitor_id}/pause")
def pause_monitor(monitor_id: str, user: dict = Depends(get_current_user)):
    user_id = user["id"]
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE monitors SET paused = TRUE WHERE id = %s AND user_id = %s", (monitor_id, user_id))
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Monitor not found")
                conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"id": monitor_id, "state": "PAUSED"}

@app.post("/api/monitors/{monitor_id}/resume")
def resume_monitor(monitor_id: str, user: dict = Depends(get_current_user)):
    user_id = user["id"]
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE monitors SET paused = FALSE, next_check_at = NOW() WHERE id = %s AND user_id = %s", (monitor_id, user_id))
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Monitor not found")
                conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"id": monitor_id, "state": "UP"}

@app.get("/api/monitors/{monitor_id}/history")
def get_monitor_history(monitor_id: str, range: str = Query("24h"), user: dict = Depends(get_current_user)):
    now_ms = int(time.time() * 1000)
    range_ms = 3600 * 1000 if range == "1h" else (7 * 86400 * 1000 if range == "7d" else 86400 * 1000)
    start_ms = now_ms - range_ms

    try:
        resp = table_checks.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key("monitor_id").eq(monitor_id) &
                                   boto3.dynamodb.conditions.Key("ts").gte(start_ms),
            ScanIndexForward=True,
            Limit=200
        )
        points = []
        for c in resp.get("Items", []):
            points.append({
                "ts": c.get("ts_iso", datetime.fromtimestamp(int(c["ts"])/1000, tz=timezone.utc).isoformat()),
                "status": c.get("status", "up").upper(),
                "httpCode": int(c.get("http_code", 200)),
                "latencyMs": int(c.get("latency_ms", 0)),
                "error": c.get("error")
            })
        return points
    except Exception as e:
        logger.error(f"DynamoDB history query failed for {monitor_id}: {e}")
        raise HTTPException(status_code=503, detail="History unavailable")

@app.get("/api/incidents")
def get_incidents(state: str = Query(None), user: dict = Depends(get_current_user)):
    user_id = user["id"]
    try:
        resp = table_incidents.query(
            IndexName="by_user",
            KeyConditionExpression=boto3.dynamodb.conditions.Key("user_id").eq(user_id),
            ScanIndexForward=False,
            Limit=50
        )
        items = resp.get("Items", [])
        results = []
        for it in items:
            st = it.get("state", "CONFIRMED")
            if state:
                if state.lower() == "open" and st == "RESOLVED":
                    continue
                if state.lower() == "resolved" and st != "RESOLVED":
                    continue

            started_raw = it.get("startedAt", "")
            started_formatted = started_raw
            if str(started_raw).isdigit():
                try:
                    started_formatted = datetime.fromtimestamp(int(started_raw) / 1000.0, tz=timezone.utc).isoformat()
                except Exception:
                    pass

            results.append({
                "id": it.get("incidentId", it["item_id"]),
                "monitorId": it["monitor_id"],
                "monitorName": it.get("monitorName", "Service"),
                "startedAt": started_formatted,
                "resolvedAt": it.get("resolvedAt"),
                "state": st,
                "rootCause": it.get("rootCause")
            })
        return results
    except Exception as e:
        logger.error(f"Incidents query failed: {e}")
        return []

@app.post("/api/reports/export")
def export_report(user: dict = Depends(get_current_user)):
    user_id = user["id"]
    try:
        resp = table_incidents.query(
            IndexName="by_user",
            KeyConditionExpression=boto3.dynamodb.conditions.Key("user_id").eq(user_id),
            Limit=100
        )
        incidents = resp.get("Items", [])
        csv_lines = ["Incident ID,Monitor ID,Monitor Name,State,Started At,Resolved At,Root Cause"]
        for inc in incidents:
            csv_lines.append(
                f'"{inc.get("incidentId", "")}","{inc.get("monitor_id", "")}","{inc.get("monitorName", "")}",'
                f'"{inc.get("state", "")}","{inc.get("startedAt", "")}","{inc.get("resolvedAt", "")}","{inc.get("rootCause", "")}"'
            )
        csv_data = "\n".join(csv_lines)

        target_bucket = get_ssm_param("/pulsewatch/reports_bucket", default=REPORTS_BUCKET) or REPORTS_BUCKET
        if not target_bucket:
            raise ValueError("Reports S3 bucket is not configured in SSM /pulsewatch/reports_bucket")

        file_key = f"reports/incidents_{user_id}_{int(time.time())}.csv"
        s3_client.put_object(
            Bucket=target_bucket,
            Key=file_key,
            Body=csv_data.encode("utf-8"),
            ContentType="text/csv"
        )
        url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": target_bucket, "Key": file_key},
            ExpiresIn=900
        )
        return {"downloadUrl": url, "expiresInSec": 900}
    except Exception as e:
        logger.error(f"Report export failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate CSV export")

@app.get("/api/system")
def get_system():
    instance_id = "i-unknown"
    az = "ap-south-1a"
    try:
        import urllib.request
        token_req = urllib.request.Request(
            "http://169.254.169.254/latest/api/token",
            headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"},
            method="PUT"
        )
        imds_token = urllib.request.urlopen(token_req, timeout=1).read().decode()
        
        id_req = urllib.request.Request(
            "http://169.254.169.254/latest/meta-data/instance-id",
            headers={"X-aws-ec2-metadata-token": imds_token}
        )
        instance_id = urllib.request.urlopen(id_req, timeout=1).read().decode()

        az_req = urllib.request.Request(
            "http://169.254.169.254/latest/meta-data/placement/availability-zone",
            headers={"X-aws-ec2-metadata-token": imds_token}
        )
        az = urllib.request.urlopen(az_req, timeout=1).read().decode()
    except Exception:
        pass

    q_depth = 0
    in_flight = 0
    dlq_depth = 0
    try:
        if CHECK_QUEUE_URL:
            attr = sqs_client.get_queue_attributes(
                QueueUrl=CHECK_QUEUE_URL,
                AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"]
            )["Attributes"]
            q_depth = int(attr.get("ApproximateNumberOfMessages", 0))
            in_flight = int(attr.get("ApproximateNumberOfMessagesNotVisible", 0))
    except Exception as e:
        logger.warning(f"Could not read SQS attributes: {e}")

    worker_list = []
    try:
        asg_resp = asg_client.describe_auto_scaling_groups(AutoScalingGroupNames=["pulsewatch-worker-asg"])
        if asg_resp.get("AutoScalingGroups"):
            instances = asg_resp["AutoScalingGroups"][0].get("Instances", [])
            for inst in instances:
                worker_list.append({
                    "id": inst["InstanceId"],
                    "az": inst.get("AvailabilityZone", "ap-south-1a"),
                    "status": inst.get("LifecycleState", "InService"),
                    "activeChecks": 1,
                    "cpuPercent": 24,
                    "lastHeartbeatSec": 2
                })
    except Exception as e:
        logger.warning(f"Could not describe worker ASG: {e}")

    if not worker_list:
        worker_list = [{
            "id": "wrk-01",
            "az": "ap-south-1a",
            "status": "HEALTHY",
            "activeChecks": 1,
            "cpuPercent": 20,
            "lastHeartbeatSec": 2
        }]

    rds_ok = "HEALTHY"
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
    except Exception:
        rds_ok = "DEGRADED"

    ddb_ok = "HEALTHY"
    try:
        table_checks.load()
    except Exception:
        ddb_ok = "DEGRADED"

    sqs_ok = "HEALTHY" if CHECK_QUEUE_URL else "DEGRADED"

    return {
        "instanceId": instance_id,
        "az": az,
        "queueDepth": q_depth,
        "inFlight": in_flight,
        "dlq": dlq_depth,
        "workers": worker_list,
        "deps": {
            "rds": rds_ok,
            "ddb": ddb_ok,
            "sqs": sqs_ok
        }
    }

@app.post("/api/system/load-test")
def trigger_load_test(payload: LoadTestPayload, user: dict = Depends(get_current_user)):
    if user["email"].lower() != ADMIN_EMAIL.lower():
        raise HTTPException(status_code=403, detail="Access denied: Admin credentials required for load tests")

    count = min(max(1, payload.count), 200)
    now_ms = int(time.time() * 1000)

    try:
        for i in range(count):
            msg = {
                "type": "check",
                "checkId": f"loadtest-{uuid.uuid4()}",
                "monitorId": "mon-loadtest",
                "url": "http://10.1.1.111/healthz",
                "expectedStatus": 200,
                "timeoutSec": 5,
                "scheduledAt": now_ms,
                "source": "loadtest"
            }
            sqs_client.send_message(
                QueueUrl=CHECK_QUEUE_URL,
                MessageBody=json.dumps(msg)
            )
        return {
            "enqueued": count,
            "queue": "pulsewatch-check-queue",
            "status": "LOAD_TEST_DISPATCHED"
        }
    except Exception as e:
        logger.error(f"Failed to enqueue load test messages: {e}")
        raise HTTPException(status_code=500, detail="Failed to enqueue load test jobs")

def scheduler_thread():
    logger.info("Distributed scheduler background loop active.")
    while True:
        try:
            with get_db_connection() as conn:
                with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                    cur.execute("""
                        UPDATE monitors
                        SET next_check_at = NOW() + (interval_min * INTERVAL '1 minute')
                        WHERE id IN (
                            SELECT id FROM monitors
                            WHERE paused = FALSE AND next_check_at <= NOW()
                            ORDER BY next_check_at
                            LIMIT 50
                            FOR UPDATE SKIP LOCKED
                        )
                        RETURNING id, user_id, name, url, expected_status, timeout_sec;
                    """)
                    due_monitors = cur.fetchall()
                    conn.commit()

            now_ms = int(time.time() * 1000)
            for m in due_monitors:
                msg = {
                    "type": "check",
                    "checkId": f"{m['id']}#{now_ms}",
                    "monitorId": str(m["id"]),
                    "userId": str(m["user_id"]),
                    "monitorName": m["name"],
                    "url": m["url"],
                    "expectedStatus": int(m["expected_status"]),
                    "timeoutSec": int(m["timeout_sec"]),
                    "scheduledAt": now_ms,
                    "source": "scheduled"
                }
                if CHECK_QUEUE_URL:
                    sqs_client.send_message(
                        QueueUrl=CHECK_QUEUE_URL,
                        MessageBody=json.dumps(msg)
                    )

            # Publish custom SitesDown metric to CloudWatch for dashboard widget
            try:
                resp = table_incidents.scan(
                    FilterExpression=boto3.dynamodb.conditions.Attr("item_id").eq("STATE") & boto3.dynamodb.conditions.Attr("state").eq("DOWN")
                )
                down_count = len(resp.get("Items", []))
                cw_client.put_metric_data(
                    Namespace="PulseWatch/Metrics",
                    MetricData=[
                        {
                            "MetricName": "SitesDown",
                            "Value": float(down_count),
                            "Unit": "Count",
                            "Timestamp": datetime.now(timezone.utc)
                        }
                    ]
                )
            except Exception as cw_err:
                logger.debug(f"CloudWatch SitesDown metric skipped: {cw_err}")

        except Exception as e:
            logger.error(f"Scheduler tick error: {e}")
        time.sleep(15)

def start_scheduler():
    t = threading.Thread(target=scheduler_thread, daemon=True)
    t.start()
