import os
import sys
import time
import json
import socket
import ipaddress
import logging
from datetime import datetime, timezone
from urllib.parse import urlparse

import boto3
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [WORKER] %(message)s")
logger = logging.getLogger("pulsewatch-worker")

REGION = os.environ.get("AWS_REGION", "ap-south-1")
CHECK_QUEUE_URL = os.environ.get("CHECK_QUEUE_URL", "")

ssm_client = boto3.client("ssm", region_name=REGION)
sqs_client = boto3.client("sqs", region_name=REGION)
sfn_client = boto3.client("stepfunctions", region_name=REGION)
dynamodb_resource = boto3.resource("dynamodb", region_name=REGION)

table_checks = dynamodb_resource.Table("pulsewatch-checks")

def get_ssm_param(name: str, default: str = "") -> str:
    try:
        resp = ssm_client.get_parameter(Name=name)
        return resp["Parameter"]["Value"]
    except Exception as e:
        logger.warning(f"Could not read SSM param {name}: {e}")
        return default

ALLOWED_HOSTS_RAW = get_ssm_param("/pulsewatch/allowed_private_hosts", default="10.1.1.111")
ALLOWED_HOSTS = [h.strip() for h in ALLOWED_HOSTS_RAW.split(",") if h.strip()]

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
            return False, "Loopback addresses prohibited"
        if ip.is_private:
            return False, "RFC1918 private addresses prohibited"
        if ip.is_link_local or ip_str == "169.254.169.254":
            return False, "Cloud metadata / link-local addresses prohibited"
            
    return True, "Safe"

def execute_probe(url: str, expected_status: int, timeout_sec: int) -> tuple[bool, int, int, str]:
    safe, reason = is_ssrf_safe(url, ALLOWED_HOSTS)
    if not safe:
        return False, 0, 0, f"Blocked by SSRF Policy: {reason}"

    start_t = time.perf_counter()
    try:
        session = requests.Session()
        session.max_redirects = 3
        resp = session.get(url, timeout=timeout_sec, allow_redirects=True)
        latency_ms = int((time.perf_counter() - start_t) * 1000)
        ok = (resp.status_code == expected_status)
        err = None if ok else f"Unexpected HTTP status {resp.status_code} (expected {expected_status})"
        return ok, resp.status_code, latency_ms, err
    except requests.exceptions.Timeout:
        latency_ms = int((time.perf_counter() - start_t) * 1000)
        return False, 0, latency_ms, f"Connection timed out after {timeout_sec}s"
    except requests.exceptions.RequestException as e:
        latency_ms = int((time.perf_counter() - start_t) * 1000)
        return False, 0, latency_ms, str(e)

def poll_and_process():
    logger.info(f"Worker daemon starting long-poll loop on {CHECK_QUEUE_URL}...")
    while True:
        try:
            if not CHECK_QUEUE_URL:
                time.sleep(5)
                continue

            resp = sqs_client.receive_message(
                QueueUrl=CHECK_QUEUE_URL,
                MaxNumberOfMessages=10,
                WaitTimeSeconds=20
            )
            messages = resp.get("Messages", [])
            for msg in messages:
                receipt = msg["ReceiptHandle"]
                body = json.loads(msg["Body"])
                msg_type = body.get("type", "check")

                url = body["url"]
                expected_status = int(body.get("expectedStatus", 200))
                timeout_sec = int(body.get("timeoutSec", 10))

                ok, code, latency_ms, err = execute_probe(url, expected_status, timeout_sec)

                if msg_type == "check":
                    monitor_id = body["monitorId"]
                    sched_at = int(body.get("scheduledAt", int(time.time() * 1000)))
                    source = body.get("source", "scheduled")

                    if source == "scheduled":
                        now_dt = datetime.now(timezone.utc)
                        ttl_sec = int(now_dt.timestamp()) + (30 * 86400)
                        try:
                            check_item = {
                                "monitor_id": monitor_id,
                                "url": url,
                                "ts": sched_at,
                                "ts_iso": now_dt.isoformat(),
                                "status": "up" if ok else "down",
                                "http_code": code,
                                "latency_ms": latency_ms,
                                "error": err if err else "",
                                "source": "scheduled",
                                "ttl": ttl_sec
                            }
                            if "userId" in body:
                                check_item["user_id"] = str(body["userId"])
                            if "monitorName" in body:
                                check_item["monitor_name"] = str(body["monitorName"])

                            table_checks.put_item(
                                Item=check_item,
                                ConditionExpression="attribute_not_exists(ts)"
                            )
                        except Exception as e:
                            logger.warning(f"DynamoDB check write skipped: {e}")

                elif msg_type == "recheck":
                    task_token = body.get("taskToken")
                    if task_token:
                        try:
                            sfn_client.send_task_success(
                                taskToken=task_token,
                                output=json.dumps({
                                    "ok": ok,
                                    "httpCode": code,
                                    "latencyMs": latency_ms,
                                    "error": err if err else ""
                                })
                            )
                        except Exception as e:
                            logger.error(f"Failed to send task success: {e}")

                sqs_client.delete_message(
                    QueueUrl=CHECK_QUEUE_URL,
                    ReceiptHandle=receipt
                )

        except Exception as e:
            logger.error(f"Worker poll error: {e}")
            time.sleep(2)

if __name__ == "__main__":
    poll_and_process()
