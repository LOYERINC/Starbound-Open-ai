"""Temporary black-box probe for the live classroom-room UI.

This deliberately uses only the documented README protocol and browser UI.
"""
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("BLACKBOX_BASE_URL", "http://127.0.0.1:8766/")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
LOG = Path("artifacts/blackbox_ws_frames.jsonl")
HTTP_LOG = Path("artifacts/blackbox_http_responses.jsonl")


def main():
    LOG.parent.mkdir(parents=True, exist_ok=True)
    http_stream = HTTP_LOG.open("w", encoding="utf-8")
    with LOG.open("w", encoding="utf-8") as stream:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=EDGE, headless=True)
            context = browser.new_context()
            page = context.new_page()
            def log_response(response):
                item = {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "status": response.status,
                    "method": response.request.method,
                    "url": response.url,
                }
                http_stream.write(json.dumps(item) + "\n")
                http_stream.flush()

            page.on("response", log_response)

            def record(ws, direction):
                def capture(payload):
                    if isinstance(payload, bytes):
                        payload = payload.decode("utf-8", "replace")
                    try:
                        decoded = json.loads(payload)
                        for secret_key in ("token", "resumeToken"):
                            if secret_key in decoded:
                                decoded[secret_key] = "<redacted>"
                        payload = json.dumps(decoded, separators=(",", ":"), ensure_ascii=False)
                    except (TypeError, ValueError):
                        pass
                    stream.write(json.dumps({
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "direction": direction,
                        "url": ws.url,
                        "payload": str(payload),
                    }, ensure_ascii=False) + "\n")
                    stream.flush()
                return capture

            def on_websocket(ws):
                ws.on("framesent", record(ws, "sent"))
                ws.on("framereceived", record(ws, "received"))

            page.on("websocket", on_websocket)
            page.goto(BASE_URL, wait_until="domcontentloaded")
            page.locator("#go-to-questions").click()
            page.locator("#load-samples").click()
            page.locator("#back-home").click()
            page.locator("#host-room").click()
            for selector in ("#hero-continue", "#world-play"):
                locator = page.locator(selector)
                if locator.count() and locator.is_visible():
                    locator.click()
            page.wait_for_timeout(1500)
            print("URL", page.url)
            body = page.locator("body").inner_text()
            print(body.encode("ascii", "backslashreplace").decode())
            lines = [line.strip() for line in body.splitlines() if line.strip()]
            code_index = lines.index("Share this code with your students.") + 1
            room_code = lines[code_index]

            student_context = browser.new_context()
            student = student_context.new_page()
            student.on("websocket", on_websocket)
            student.on("response", log_response)
            student.goto(BASE_URL, wait_until="domcontentloaded")
            student.locator("#join-room").click()
            student.get_by_label("Room code").fill(room_code)
            student.locator("#student-name").fill("Blackbox Probe")
            student.locator("#join-submit").click()
            student.locator("#hero-continue").click()
            student.wait_for_timeout(1000)
            print("STUDENT", student.locator("body").inner_text().encode("ascii", "backslashreplace").decode())
            page.locator("#lobby-start").click()
            student.wait_for_timeout(3500)
            student.keyboard.down("ArrowRight")
            student.keyboard.down("Space")
            student.wait_for_timeout(8000)
            student.keyboard.up("ArrowRight")
            student.keyboard.up("Space")
            print("AFTER_START_STUDENT", student.locator("body").inner_text().encode("ascii", "backslashreplace").decode())
            page.wait_for_timeout(1000)
            print("WS_LOG", LOG.resolve())
            student_context.close()
            context.close()
            browser.close()
    http_stream.close()


if __name__ == "__main__":
    main()
