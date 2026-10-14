"""Black-box checks against the running FastAPI app, using only the README protocol/UI."""
import asyncio
import json
import os
import re
import threading
import time
from pathlib import Path

import pytest
import websockets
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("BLACKBOX_BASE_URL", "http://127.0.0.1:8766/")
WS_BASE = BASE_URL.replace("http://", "ws://").replace("https://", "wss://").rstrip("/")
EDGE = os.environ.get(
    "BLACKBOX_EDGE",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
)
FRAME_LOG = Path("artifacts/blackbox_ws_frames.jsonl")
_log_lock = threading.Lock()


def _write_frame(url, direction, payload):
    if isinstance(payload, bytes):
        payload = payload.decode("utf-8", "replace")
    try:
        message = json.loads(payload)
        for secret_key in ("token", "resumeToken"):
            if secret_key in message:
                message[secret_key] = "<redacted>"
        payload = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        payload = str(payload)
    row = {
        "timestamp": time.time(),
        "direction": direction,
        "url": url,
        "payload": payload,
    }
    FRAME_LOG.parent.mkdir(parents=True, exist_ok=True)
    with _log_lock, FRAME_LOG.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(row, ensure_ascii=False) + "\n")


def _capture_page(page):
    page._blackbox_frames = []

    def save(url, direction, payload):
        raw = payload.decode("utf-8", "replace") if isinstance(payload, bytes) else str(payload)
        try:
            message = json.loads(raw)
        except ValueError:
            message = None
        if isinstance(message, dict):
            page._blackbox_frames.append((direction, message))
        _write_frame(url, direction, raw)

    def on_socket(socket):
        socket.on("framesent", lambda payload: save(socket.url, "sent", payload))
        socket.on("framereceived", lambda payload: save(socket.url, "received", payload))

    page.on("websocket", on_socket)


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as playwright:
        instance = playwright.chromium.launch(executable_path=EDGE, headless=True)
        yield instance
        instance.close()


def _create_teacher(browser):
    context = browser.new_context()
    page = context.new_page()
    _capture_page(page)
    page.goto(BASE_URL, wait_until="domcontentloaded")
    page.locator("#go-to-questions").click()
    page.locator("#load-samples").click()
    page.locator("#back-home").click()
    page.locator("#host-room").click()
    for selector in ("#hero-continue", "#world-play"):
        control = page.locator(selector)
        if control.count() and control.is_visible():
            control.click()
    page.locator("#lobby-title").wait_for(state="visible", timeout=20000)
    lines = [line.strip() for line in page.locator("body").inner_text().splitlines() if line.strip()]
    code = lines[lines.index("Share this code with your students.") + 1]
    assert re.fullmatch(r"[A-Z0-9]{5}", code), f"unexpected room code: {code!r}"
    return context, page, code


def _join_student(browser, code, name):
    context = browser.new_context()
    page = context.new_page()
    _capture_page(page)
    page.goto(BASE_URL, wait_until="domcontentloaded")
    page.locator("#join-room").click()
    page.get_by_label("Room code").fill(code)
    page.locator("#student-name").fill(name)
    page.locator("#join-submit").click()
    page.locator("#hero-continue").click()
    page.locator("#lobby-title").wait_for(state="visible", timeout=20000)
    page.get_by_text(name, exact=True).wait_for(state="visible", timeout=10000)
    return context, page


def _run_async(coroutine):
    """Run asyncio clients outside Playwright's synchronous event-loop thread."""
    result = []
    failure = []

    def run():
        try:
            result.append(asyncio.run(coroutine))
        except BaseException as error:
            failure.append(error)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    thread.join()
    if failure:
        raise failure[0]
    return result[0] if result else None


async def _open_student(code, name, resume_token=None):
    socket = await websockets.connect(f"{WS_BASE}/ws/rooms/{code}", max_size=None)
    payload = {"type": "join", "name": name, "heroId": "beige"}
    if resume_token:
        payload["resumeToken"] = resume_token
    await socket.send(json.dumps(payload))
    seen = []
    deadline = time.monotonic() + 6
    while time.monotonic() < deadline:
        try:
            raw = await asyncio.wait_for(socket.recv(), timeout=max(0.1, deadline - time.monotonic()))
        except websockets.exceptions.ConnectionClosed:
            return socket, seen
        message = json.loads(raw)
        seen.append(message)
        if message.get("type") == "joined":
            return socket, seen
        if message.get("type") in {"error", "join_result"} and not message.get("ok", False):
            return socket, seen
    return socket, seen


def test_two_live_rooms_and_solo_storage_are_isolated(browser):
    teacher_a = student_a = teacher_b = student_b = solo = None
    try:
        teacher_a, page_a, code_a = _create_teacher(browser)
        teacher_b, page_b, code_b = _create_teacher(browser)
        assert code_a != code_b
        student_a, student_page_a = _join_student(browser, code_a, "Room A Student")
        student_b, student_page_b = _join_student(browser, code_b, "Room B Student")

        assert "Room A Student" in page_a.locator("#lobby-students").inner_text()
        assert "Room B Student" not in page_a.locator("#lobby-students").inner_text()
        assert "Room B Student" in page_b.locator("#lobby-students").inner_text()
        assert "Room A Student" not in page_b.locator("#lobby-students").inner_text()

        page_a.locator("#lobby-start").click()
        page_a.locator("#lobby-students").get_by_text("Playing", exact=True).wait_for(state="visible", timeout=10000)
        student_page_a.locator("canvas").last.wait_for(state="visible", timeout=20000)
        assert "Waiting" in student_page_b.locator("#lobby-students").inner_text()
        page_b.locator("#lobby-start").click()
        page_b.locator("#lobby-students").get_by_text("Playing", exact=True).wait_for(state="visible", timeout=10000)
        student_page_b.locator("canvas").last.wait_for(state="visible", timeout=20000)

        solo = browser.new_context()
        solo_page = solo.new_page()
        solo_page.goto(BASE_URL, wait_until="domcontentloaded")
        solo_page.locator("#go-to-questions").click()
        solo_page.locator("#load-samples").click()
        before = solo_page.evaluate("() => JSON.stringify(Object.fromEntries(Object.entries(localStorage)))")
        solo_page.locator("#back-home").click()
        solo_page.locator("#play-solo").click()
        solo_page.locator("#hero-continue").click()
        solo_page.locator("#world-play").click()
        solo_page.locator("canvas").wait_for(state="visible", timeout=20000)
        after = solo_page.evaluate("() => JSON.stringify(Object.fromEntries(Object.entries(localStorage)))")
        assert before == after, "solo play changed the browser's stored questions/settings"
    finally:
        for context in (student_a, student_b, solo, teacher_a, teacher_b):
            if context:
                context.close()


def test_room_capacity_boundary_39_40_41_and_normal_join_after(browser):
    teacher = None
    sockets = []
    try:
        teacher, _, code = _create_teacher(browser)

        async def boundary():
            for index in range(1, 42):
                socket, messages = await _open_student(code, f"Boundary {index:02d}")
                sockets.append(socket)
                joined = any(message.get("type") == "joined" for message in messages)
                if index <= 40:
                    assert joined, f"student {index} was rejected before the advertised 40-student cap: {messages}"
                else:
                    assert not joined, f"student 41 was accepted beyond the advertised 40-student cap: {messages}"
            for socket in sockets:
                await socket.close()
            sockets.clear()

        _run_async(boundary())
        # A fresh room remains joinable after the capacity boundary exercise.
        followup, followup_page, followup_code = _create_teacher(browser)
        normal_context, normal_page = _join_student(browser, followup_code, "After Boundary")
        try:
            assert "After Boundary" in followup_page.locator("#lobby-students").inner_text()
        finally:
            normal_context.close()
            followup.close()
    finally:
        for socket in sockets:
            try:
                _run_async(socket.close())
            except Exception:
                pass
        if teacher:
            teacher.close()


def test_abuse_does_not_take_down_server_and_teacher_close_removes_room(browser):
    teacher = student = None
    _, _, code = (None, None, None)
    try:
        teacher, page, code = _create_teacher(browser)

        async def abuse():
            cases = [
                "{malformed json",
                "x" * (2 * 1024 * 1024),
                json.dumps({"type": "unknown_message_type"}),
                json.dumps({"type": "hello", "role": "teacher", "token": "not-a-token"}),
            ]
            for payload in cases:
                try:
                    socket = await websockets.connect(f"{WS_BASE}/ws/rooms/{code}", max_size=None)
                    try:
                        await socket.send(payload)
                        try:
                            await asyncio.wait_for(socket.recv(), timeout=1)
                        except Exception:
                            pass
                    finally:
                        await socket.close()
                except Exception:
                    pass

        _run_async(abuse())
        student, student_page = _join_student(browser, code, "Recovery Join")
        assert "Recovery Join" in page.locator("#lobby-students").inner_text()
        student.close()
        student = None
        teacher.close()  # Closing the teacher tab for good must remove the room.
        teacher = None

        async def stale_code_rejected():
            socket = await websockets.connect(f"{WS_BASE}/ws/rooms/{code}", max_size=None)
            await socket.send(json.dumps({"type": "join", "name": "Too Late", "heroId": "beige"}))
            try:
                message = json.loads(await asyncio.wait_for(socket.recv(), timeout=2))
                assert message.get("type") != "joined", f"closed room accepted a student: {message}"
            except websockets.exceptions.ConnectionClosed:
                pass
            finally:
                await socket.close()

        _run_async(stale_code_rejected())

        teacher2, _, _ = _create_teacher(browser)
        teacher2.close()
    finally:
        if student:
            student.close()
        if teacher:
            teacher.close()


@pytest.mark.slow
def test_student_reconnects_within_sixty_second_window(browser):
    teacher = student = None
    try:
        teacher, _, code = _create_teacher(browser)
        student, student_page = _join_student(browser, code, "Reconnect Student")
        joined_frames = [message for direction, message in student_page._blackbox_frames if direction == "received" and message.get("type") == "joined"]
        assert joined_frames and joined_frames[-1].get("resumeToken"), "join response did not include a reconnect token"
        resume_token = joined_frames[-1]["resumeToken"]
        student_page.close()

        disconnected_at = time.time()
        time.sleep(55)
        rejoin_page = student.new_page()
        _capture_page(rejoin_page)
        rejoin_page.goto(BASE_URL, wait_until="domcontentloaded")
        rejoin_page.locator("#rejoin-room").click()
        deadline = time.monotonic() + 8
        resumed = False
        while time.monotonic() < deadline:
            resumed |= any(
                message.get("type") == "joined" and message.get("resumed") is True
                for direction, message in rejoin_page._blackbox_frames
                if direction == "received"
            )
            if resumed:
                break
            time.sleep(0.1)
        assert resumed, f"the UI did not resume the same student; frames={rejoin_page._blackbox_frames}"
        reconnected_at = time.time()
        assert reconnected_at - disconnected_at >= 55
        assert "Reconnect Student" in teacher.pages[0].locator("#lobby-students").inner_text()
    finally:
        if student:
            student.close()
        if teacher:
            teacher.close()


@pytest.mark.slow
def test_finish_order_and_teacher_play_again_lives_reset(browser):
    """Use UI-created participants, then drive the documented finished message in order."""
    teacher = student_a = student_b = None
    try:
        teacher, teacher_page, code = _create_teacher(browser)
        student_a, student_page_a = _join_student(browser, code, "Finish Order A")
        student_b, student_page_b = _join_student(browser, code, "Finish Order B")
        tokens = []
        for page in (student_page_a, student_page_b):
            joined = [
                message for direction, message in page._blackbox_frames
                if direction == "received" and message.get("type") == "joined"
            ]
            assert joined and joined[-1].get("resumeToken"), "join response did not include a reconnect token"
            tokens.append(joined[-1]["resumeToken"])

        teacher_page.locator("#lobby-start").click()
        teacher_page.locator("#lobby-students").get_by_text("Playing", exact=True).wait_for(state="visible", timeout=10000)
        student_page_a.locator("canvas").last.wait_for(state="visible", timeout=20000)
        student_page_b.locator("canvas").last.wait_for(state="visible", timeout=20000)
        time.sleep(4)

        async def finish_in_order():
            snapshots = []
            for index, (name, token) in enumerate(zip(("Finish Order A", "Finish Order B"), tokens)):
                socket, received = await _open_student(code, name, token)
                joined = next((m for m in received if m.get("type") == "joined"), None)
                assert joined and joined.get("resumed") is True, f"resume failed before finish test: {received}"
                await socket.send(json.dumps({"type": "progress", "x": 100000}))
                await socket.send(json.dumps({"type": "finished", "requestId": f"finish-{index + 1}", "time": index + 1}))
                deadline = time.monotonic() + 8
                while time.monotonic() < deadline:
                    try:
                        message = json.loads(await asyncio.wait_for(socket.recv(), timeout=1))
                    except asyncio.TimeoutError:
                        continue
                    if message.get("type") == "room_snapshot":
                        snapshots.append(message["room"])
                        player = next((p for p in message["room"]["players"] if p["name"] == name), None)
                        if player and player.get("finishAt") is not None:
                            break
                else:
                    raise AssertionError(f"server did not accept finished for {name}; snapshots={snapshots}")
                await socket.close()
                if index == 0:
                    time.sleep(1.25)
            return snapshots

        finish_snapshots = _run_async(finish_in_order())
        latest = finish_snapshots[-1]
        finish_times = {p["name"]: p["finishAt"] for p in latest["players"] if p.get("finishAt") is not None}
        assert set(finish_times) == {"Finish Order A", "Finish Order B"}, f"both finishers should appear in the room snapshot: {latest}"
        assert finish_times["Finish Order A"] < finish_times["Finish Order B"], f"server timestamps are out of order: {finish_times}"

        replay = teacher_page.get_by_role("button", name=re.compile("Play again", re.I))
        replay.wait_for(state="visible", timeout=10000)
        replay.click()
        teacher_page.locator("#lobby-title").wait_for(state="visible", timeout=10000)
        rows = teacher_page.locator("#lobby-students").inner_text()
        assert "3 lives" in rows, f"replay should reset each student's lives: {rows}"
        assert code in teacher_page.locator("body").inner_text(), "Play again should keep the same room code"
    finally:
        if student_a:
            student_a.close()
        if student_b:
            student_b.close()
        if teacher:
            teacher.close()
