"""FastAPI static host and lightweight in-memory classroom race server."""
from __future__ import annotations

import asyncio
import json
import math
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from server.rooms import Player, Room, RoomError, RoomManager
from tools.build_manifest import build_manifest

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = ROOT / "public"
MAX_MESSAGE_BYTES = 16 * 1024
manager = RoomManager()
app = FastAPI(title="Starbound Run")


@app.on_event("startup")
def refresh_asset_manifest() -> None:
    build_manifest()


def response_error(error: RoomError, status: int = 400) -> JSONResponse:
    return JSONResponse({"error": {"code": error.code, "message": error.message}}, status_code=status)


@app.post("/api/rooms")
async def create_room(request: Request):
    length = request.headers.get("content-length")
    if length and (not length.isdigit() or int(length) > 1024 * 1024):
        return JSONResponse({"error": {"code": "too_large", "message": "Question upload is too large."}}, status_code=413)
    try:
        raw_body = await request.body()
        if len(raw_body) > 1024 * 1024:
            return JSONResponse({"error": {"code": "too_large", "message": "Question upload is too large."}}, status_code=413)
        data = json.loads(raw_body)
        if not isinstance(data, dict):
            raise RoomError("bad_request", "Room details must be an object.")
        seed = data.get("levelSeed", 20261014)
        if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 0xFFFFFFFF:
            raise RoomError("bad_request", "Level seed must be a 32-bit unsigned integer.")
        result = manager.create_room(
            data.get("questions"), tileset_id=data.get("tilesetId", "grass"),
            background_id=data.get("backgroundId", "background_clouds"),
            level_seed=seed,
        )
        return result
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        error = exc if isinstance(exc, RoomError) else RoomError("bad_request", "Invalid room data.")
        return response_error(error)


def finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool):
        raise RoomError("bad_message", f"{label} must be a number.")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise RoomError("bad_message", f"{label} must be a number.") from exc
    if not math.isfinite(result):
        raise RoomError("bad_message", f"{label} must be a finite number.")
    return result


def public_question(room: Room, player: Player) -> dict:
    question = manager.next_question(room, player)
    question["number"] = len(room.questions) - len(player.question_order)
    return question


async def safe_send(websocket: WebSocket | None, message: dict) -> None:
    if websocket:
        try:
            await websocket.send_json(message)
        except (RuntimeError, WebSocketDisconnect):
            pass


async def receive_text_frame(websocket: WebSocket) -> str:
    frame = await websocket.receive()
    if frame.get("type") == "websocket.disconnect":
        raise WebSocketDisconnect(code=frame.get("code", 1000))
    text = frame.get("text")
    if not isinstance(text, str):
        await websocket.close(code=1003, reason="JSON text messages are required")
        raise WebSocketDisconnect(code=1003)
    return text


async def broadcast(room: Room, message: dict, *, include_teacher: bool = True) -> None:
    targets = list(room.connections.values()) if include_teacher else [
        ws for key, ws in room.connections.items() if key != "teacher"
    ]
    for websocket in targets:
        await safe_send(websocket, message)


async def publish_room(room: Room) -> None:
    await broadcast(room, {"type": "room_snapshot", "room": manager.snapshot(room)})
    if room.ended:
        await broadcast(room, {"type": "game_end", "leaderboard": manager.leaderboard(room)})


async def delayed_disconnect_expiry(code: str, token: str) -> None:
    await asyncio.sleep(60)
    try:
        room = manager.get_room(code)
    except RoomError:
        return
    player = room.players.get(token)
    if player and manager.expire_player(room, player):
        await publish_room(room)


@app.websocket("/ws/rooms/{code}")
async def room_socket(websocket: WebSocket, code: str):
    await websocket.accept()
    room: Room | None = None
    player: Player | None = None
    role_key: str | None = None
    try:
        raw = await receive_text_frame(websocket)
        if len(raw.encode("utf-8")) > MAX_MESSAGE_BYTES:
            await websocket.close(code=1009, reason="Message too large")
            return
        hello = json.loads(raw)
        if not isinstance(hello, dict) or hello.get("type") not in {"hello", "join"}:
            raise RoomError("bad_hello", "Start by joining the room.")
        if hello["type"] == "hello" and hello.get("role") == "teacher":
            room = manager.authenticate_teacher(code, str(hello.get("token", "")))
            role_key = "teacher"
            old = room.connections.get(role_key)
            if old and old is not websocket:
                await safe_send(old, {"type": "session_replaced"})
                await old.close(code=4001, reason="Teacher reconnected")
            room.connections[role_key] = websocket
            await websocket.send_json({"type": "connected", "role": "teacher", "room": manager.snapshot(room)})
            await broadcast(room, {"type": "room_resumed" if room.started else "room_snapshot", "room": manager.snapshot(room)}, include_teacher=False)
        elif hello["type"] == "join":
            room, player, resumed = manager.join(code, hello.get("name", ""), hello.get("heroId", "runner"), hello.get("resumeToken"))
            role_key = player.resume_token
            old = room.connections.get(role_key)
            if old and old is not websocket:
                await safe_send(old, {"type": "session_replaced"})
                await old.close(code=4001, reason="Student reconnected")
            room.connections[role_key] = websocket
            await websocket.send_json({"type": "joined", "resumeToken": player.resume_token, "resumed": resumed,
                                       "status": player.status, "lives": player.lives, "deaths": player.deaths,
                                       "checkpointX": player.checkpoint_x, "progress": player.max_x,
                                       "wrongAnswers": player.wrong_answers, "room": manager.snapshot(room)})
        else:
            raise RoomError("bad_hello", "Teacher authentication or student join is required.")
        await publish_room(room)

        while True:
            raw = await receive_text_frame(websocket)
            if len(raw.encode("utf-8")) > MAX_MESSAGE_BYTES:
                await websocket.send_json({"type": "error", "code": "too_large", "message": "Message is too large."})
                continue
            try:
                message = json.loads(raw)
                if not isinstance(message, dict) or not isinstance(message.get("type"), str):
                    raise RoomError("bad_message", "Message must have a type.")
                kind = message["type"]
                request_id = message.get("requestId")
                if request_id is not None and (not isinstance(request_id, str) or len(request_id) > 64):
                    raise RoomError("bad_message", "Invalid request id.")
                reply: dict = {"type": f"{kind}_result", "requestId": request_id, "ok": True}
                if kind == "ping":
                    reply["pong"] = True
                elif role_key == "teacher":
                    if kind == "start":
                        details = manager.start(room)
                        start_data = {"type": "game_started", **details}
                        await broadcast(room, start_data)
                        reply.update(details)
                        await publish_room(room)
                    elif kind in {"end", "close"}:
                        if kind == "close":
                            await broadcast(room, {"type": "room_closed"})
                            manager.close_room(room)
                            await websocket.send_json(reply)
                            break
                        reply["leaderboard"] = manager.end_game(room)
                        await publish_room(room)
                    elif kind == "teacher_ping":
                        room.touched_at = manager.clock()
                    else:
                        raise RoomError("forbidden", "That message is not available to the teacher.")
                elif player:
                    if kind == "question_request":
                        reply["question"] = public_question(room, player)
                    elif kind == "answer":
                        option_index = message.get("optionIndex")
                        if isinstance(option_index, bool) or not isinstance(option_index, int):
                            raise RoomError("bad_message", "Answer choice must be one of the four options.")
                        reply.update(manager.answer_question(room, player, str(message.get("questionId", "")), option_index))
                    elif kind == "progress":
                        x = finite_number(message.get("x"), "Progress")
                        width = manager_level_width()
                        manager.record_progress(room, player, x, width)
                        await broadcast(room, {"type": "room_snapshot", "room": manager.snapshot(room)})
                    elif kind == "gate_reached":
                        if len(str(message.get("gateId", ""))) > 32:
                            raise RoomError("bad_message", "Invalid gate id.")
                        room.touched_at = manager.clock()
                    elif kind == "damage_taken":
                        reason = str(message.get("reason", ""))
                        if len(reason) > 32:
                            raise RoomError("bad_message", "Invalid damage reason.")
                        room.touched_at = manager.clock()
                    elif kind == "checkpoint":
                        x = finite_number(message.get("x"), "Checkpoint")
                        manager.record_checkpoint(room, player, x, valid_checkpoint_xs())
                        reply["checkpointX"] = player.checkpoint_x
                        await broadcast(room, {"type": "room_snapshot", "room": manager.snapshot(room)})
                    elif kind == "died":
                        reply.update(manager.record_death(room, player))
                        await websocket.send_json({"type": "life_update", **reply})
                        await publish_room(room)
                        continue
                    elif kind == "finished":
                        reply.update(manager.finish(room, player, manager_finish_x()))
                        await websocket.send_json({"type": "finish_ack", **reply})
                        await publish_room(room)
                        continue
                    elif kind == "leave":
                        manager.disconnect_player(room, player)
                        break
                    else:
                        raise RoomError("bad_message", "Unknown student message type.")
                else:
                    raise RoomError("forbidden", "This connection is not authorized for that message.")
                await websocket.send_json(reply)
            except (json.JSONDecodeError, TypeError, ValueError, RoomError) as exc:
                error = exc if isinstance(exc, RoomError) else RoomError("bad_message", "Invalid message payload.")
                await websocket.send_json({"type": "error", "requestId": locals().get("request_id"), "code": error.code, "message": error.message})
    except WebSocketDisconnect:
        pass
    except (RoomError, json.JSONDecodeError) as exc:
        error = exc if isinstance(exc, RoomError) else RoomError("bad_hello", "Invalid join request.")
        await safe_send(websocket, {"type": "error", "code": error.code, "message": error.message})
        await websocket.close(code=4400, reason=error.code)
    finally:
        if room and role_key and room.connections.get(role_key) is websocket:
            room.connections.pop(role_key, None)
            if role_key == "teacher":
                manager.disconnect_teacher(room)
                if not room.ended:
                    await broadcast(room, {"type": "room_paused"})
            elif player:
                manager.disconnect_player(room, player)
                asyncio.create_task(delayed_disconnect_expiry(room.code, role_key))
            if room.code in manager.rooms:
                await publish_room(room)


def level_data() -> dict:
    try:
        return json.loads((PUBLIC_DIR / "levels" / "stage1.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"width": 150, "height": 20, "rows": []}


def manager_level_width() -> float:
    level = level_data()
    return float(level.get("width", 150) * 64)


def manager_finish_x() -> float:
    level = level_data()
    for y, row in enumerate(level.get("rows", [])):
        for x, cell in enumerate(row):
            if cell == "F":
                return float(x * 64 - 64)
    return manager_level_width() - 64


def valid_checkpoint_xs() -> set[float]:
    level = level_data()
    return {float(x * 64 + 32) for row in level.get("rows", []) for x, cell in enumerate(row) if cell == "C"}


app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="public")
