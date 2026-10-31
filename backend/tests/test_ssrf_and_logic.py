import unittest
import ipaddress
import socket
from urllib.parse import urlparse

def is_ssrf_safe(url: str, allowlist: list[str]) -> tuple[bool, str]:
    if not url or len(url) > 2048:
        return False, "URL length invalid"
    
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False, "Only HTTP/HTTPS supported"
    
    hostname = parsed.hostname
    if not hostname:
        return False, "Missing hostname"
    
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
            return False, "Could not resolve host"

    for ip_str in resolved_ips:
        ip = ipaddress.ip_address(ip_str)
        if ip.is_loopback:
            return False, "Loopback addresses prohibited"
        if ip.is_private:
            return False, "RFC1918 private addresses prohibited"
        if ip.is_link_local:
            return False, "Link-local / Cloud metadata prohibited"
        if ip_str == "169.254.169.254":
            return False, "AWS instance metadata prohibited"
            
    return True, "Safe"

def derive_monitor_state(paused: bool, state_item: dict | None, latest_check: dict | None) -> tuple[str, str]:
    if paused:
        return "PAUSED", "steady"
    if state_item:
        st = state_item.get("state", "UP").upper()
        if st == "SUSPECTED":
            return "SUSPECTED", "irregular"
        if st in ("DOWN", "CONFIRMED"):
            return "DOWN", "flat"
    if latest_check:
        return "UP", "steady"
    return "PENDING", "steady"

class TestPulseWatchLogic(unittest.TestCase):
    def test_ssrf_blocks_loopback(self):
        safe, reason = is_ssrf_safe("http://127.0.0.1/status", [])
        self.assertFalse(safe)

    def test_ssrf_blocks_metadata(self):
        safe, reason = is_ssrf_safe("http://169.254.169.254/latest/meta-data/", [])
        self.assertFalse(safe)

    def test_ssrf_blocks_private_rfc1918(self):
        safe, reason = is_ssrf_safe("http://10.0.1.5:8000/health", [])
        self.assertFalse(safe)

    def test_ssrf_allows_whitelisted_private_ip(self):
        safe, reason = is_ssrf_safe("http://10.1.1.111:80/healthz", ["10.1.1.111"])
        self.assertTrue(safe)
        self.assertEqual(reason, "Whitelisted")

    def test_state_derivation_paused(self):
        st, hb = derive_monitor_state(True, {"state": "DOWN"}, None)
        self.assertEqual(st, "PAUSED")

    def test_state_derivation_suspected(self):
        st, hb = derive_monitor_state(False, {"state": "SUSPECTED"}, {"status": "up"})
        self.assertEqual(st, "SUSPECTED")
        self.assertEqual(hb, "irregular")

    def test_state_derivation_down(self):
        st, hb = derive_monitor_state(False, {"state": "CONFIRMED"}, {"status": "down"})
        self.assertEqual(st, "DOWN")
        self.assertEqual(hb, "flat")

    def test_state_derivation_up(self):
        st, hb = derive_monitor_state(False, None, {"status": "up"})
        self.assertEqual(st, "UP")
        self.assertEqual(hb, "steady")

    def test_state_derivation_pending(self):
        st, hb = derive_monitor_state(False, None, None)
        self.assertEqual(st, "PENDING")

if __name__ == "__main__":
    unittest.main()

    def test_csv_report_generation(self):
        incidents = [
            {"incidentId": "inc-1", "monitor_id": "mon-1", "monitorName": "API Gateway", "state": "RESOLVED", "startedAt": "2026-10-20T10:00:00Z", "resolvedAt": "2026-10-20T10:05:00Z", "rootCause": "OOM"}
        ]
        csv_lines = ["Incident ID,Monitor ID,Monitor Name,State,Started At,Resolved At,Root Cause"]
        for inc in incidents:
            csv_lines.append(
                f'"{inc.get("incidentId", "")}","{inc.get("monitor_id", "")}","{inc.get("monitorName", "")}",'
                f'"{inc.get("state", "")}","{inc.get("startedAt", "")}","{inc.get("resolvedAt", "")}","{inc.get("rootCause", "")}"'
            )
        csv_content = "\n".join(csv_lines)
        self.assertIn("Incident ID,Monitor ID", csv_content)
        self.assertIn('"API Gateway"', csv_content)
        self.assertIn('"RESOLVED"', csv_content)

    def test_claim_query_syntax(self):
        query = """
            UPDATE monitors
            SET next_check_at = NOW() + (interval_min * INTERVAL '1 minute')
            WHERE id IN (
                SELECT id FROM monitors
                WHERE paused = FALSE AND next_check_at <= NOW()
                ORDER BY next_check_at
                LIMIT 50
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, name, url, expected_status, timeout_sec;
        """
        self.assertIn("FOR UPDATE SKIP LOCKED", query)
        self.assertIn("RETURNING", query)
