"""Small in-memory multiplayer room state for classroom races."""
from __future__ import annotations

import random
import secrets
import string
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
MAX_PLAYERS = 40
ROOM_TTL_SECONDS = 2 * 60 * 60
RECONNECT_SECONDS = 60


class RoomError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Player:
    name: str
    hero_id: str
    resume_token: str = field(default_factory=lambda: secrets.token_urlsafe(24))
    status: str = "waiting"
    lives: int = 3
    deaths: int = 0
    wrong_answers: int = 0
    max_x: float = 0
    checkpoint_x: float = 0
    progress_x: float = 0
    progress_at: float | None = None
    finish_at: float | None = None
    disconnected_at: float | None = None
    status_before_disconnect: str | None = None
    question_order: list[int] = field(default_factory=list)
    current_question: dict[str, Any] | None = None


@dataclass
class Room:
    code: str
    teacher_token: str
    questions: list[dict[str, Any]]
    level_seed: int
    tileset_id: str
    background_id: str
    created_at: float
    touched_at: float
    started_at: float | None = None
    players: dict[str, Player] = field(default_factory=dict)
    started: bool = False
    ended: bool = False
    teacher_connected: bool = False
    connections: dict[str, Any] = field(default_factory=dict)


def normalized_name(name: str) -> str:
    return " ".join(name.strip().split()).casefold()


def clean_questions(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not 3 <= len(value) <= 200:
        raise RoomError("bad_questions", "Load at least 3 and no more than 200 questions first.")
    cleaned = []
    for index, row in enumerate(value, 1):
        if not isinstance(row, dict):
            raise RoomError("bad_questions", f"Question {index} must be an object.")
        question = str(row.get("question", "")).strip()
        options = row.get("options")
        answer = str(row.get("answer", "")).strip().upper()
        if not question or len(question) > 200 or not isinstance(options, list) or len(options) != 4:
            raise RoomError("bad_questions", f"Question {index} has invalid text or options.")
        options = [str(option).strip() for option in options]
        if any(not option or len(option) > 100 for option in options) or len({item.casefold() for item in options}) != 4:
            raise RoomError("bad_questions", f"Question {index} needs four distinct non-empty options of at most 100 characters.")
        if answer not in {"A", "B", "C", "D"}:
            raise RoomError("bad_questions", f"Question {index} answer must be A, B, C or D.")
        cleaned.append({
            "id": index - 1,
            "question": question,
            "options": options,
            "answerIndex": ord(answer) - 65,
            "source": str(row.get("source", ""))[:200],
            "explanation": str(row.get("explanation", ""))[:500],
        })
    return cleaned


class RoomManager:
    def __init__(self, *, code_factory=None, clock=time.time):
        self.rooms: dict[str, Room] = {}
        self.code_factory = code_factory or (lambda: "".join(secrets.choice(ROOM_CODE_ALPHABET) for _ in range(5)))
        self.clock = clock

    def cleanup(self, now: float | None = None) -> None:
        now = self.clock() if now is None else now
        for code, room in list(self.rooms.items()):
            if now - room.touched_at >= ROOM_TTL_SECONDS:
                del self.rooms[code]

    def create_room(self, questions, *, tileset_id="grass", background_id="background_clouds", level_seed=20261014) -> dict:
        self.cleanup()
        cleaned = clean_questions(questions)
        for _ in range(100):
            code = self.code_factory().upper()
            if code and code not in self.rooms:
                break
        else:
            raise RoomError("code_unavailable", "Could not create a room code. Try again.")
        now = self.clock()
        room = Room(code, secrets.token_urlsafe(32), cleaned, int(level_seed), str(tileset_id)[:64], str(background_id)[:64], now, now)
        self.rooms[code] = room
        return {"code": code, "teacherToken": room.teacher_token, "levelSeed": room.level_seed}

    def get_room(self, code: str) -> Room:
        self.cleanup()
        room = self.rooms.get(code.upper().strip())
        if not room:
            raise RoomError("bad_code", "We couldn't find that room code. Check it and try again.")
        room.touched_at = self.clock()
        return room

    def join(self, code: str, name: str, hero_id: str, resume_token: str | None = None) -> tuple[Room, Player, bool]:
        room = self.get_room(code)
        clean_name = " ".join(str(name).strip().split())
        if not clean_name or len(clean_name) > 16:
            raise RoomError("bad_name", "Enter a name from 1 to 16 characters.")
        hero_id = str(hero_id or "runner")[:64]
        if resume_token:
            player = next((p for p in room.players.values() if secrets.compare_digest(p.resume_token, resume_token)), None)
            if player and player.disconnected_at is not None and self.clock() - player.disconnected_at <= RECONNECT_SECONDS:
                player.disconnected_at = None
                player.name = clean_name
                player.hero_id = hero_id
                player.status = player.status_before_disconnect or ("playing" if room.started else "waiting")
                player.status_before_disconnect = None
                player.progress_at = self.clock()
                room.touched_at = self.clock()
                return room, player, True
        if room.started or room.ended:
            raise RoomError("started", "This game has already started.")
        if any(normalized_name(player.name) == normalized_name(clean_name) for player in room.players.values()):
            raise RoomError("duplicate_name", "That name is already in this room. Choose another.")
        if len(room.players) >= MAX_PLAYERS:
            raise RoomError("full", "This room is full (40 students maximum).")
        player = Player(clean_name, hero_id)
        room.players[player.resume_token] = player
        return room, player, False

    def authenticate_teacher(self, code: str, token: str) -> Room:
        room = self.get_room(code)
        if not secrets.compare_digest(room.teacher_token, str(token)):
            raise RoomError("unauthorized", "Teacher session not recognized.")
        was_disconnected = not room.teacher_connected
        room.teacher_connected = True
        if was_disconnected:
            now = self.clock()
            for player in room.players.values():
                player.progress_at = now
        return room

    def start(self, room: Room) -> dict:
        if room.ended:
            raise RoomError("ended", "This room has ended.")
        if room.started:
            raise RoomError("started", "This game has already started.")
        if not room.players:
            raise RoomError("empty_room", "At least one student must join before starting.")
        room.started = True
        room.started_at = self.clock() + 3.0
        for player in room.players.values():
            player.status = "playing"
            player.lives = 3
            player.progress_x = 160.0
            player.max_x = max(player.max_x, player.progress_x)
            player.progress_at = room.started_at
        room.touched_at = self.clock()
        return {"levelSeed": room.level_seed, "tilesetId": room.tileset_id, "backgroundId": room.background_id,
                "startAt": room.started_at}

    def record_progress(self, room: Room, player: Player, x: float, level_width: float) -> None:
        if player.status != "playing":
            return
        value = max(0.0, min(float(level_width), float(x)))
        now = self.clock()
        elapsed = max(0.0, now - (player.progress_at if player.progress_at is not None else now))
        # Bound claimed movement so a client cannot fabricate finish order by
        # reporting the flag immediately. A small packet-jitter allowance is
        # included, while normal 260 px/s play is comfortably below the cap.
        allowed = player.progress_x + elapsed * 300.0 + 48.0
        accepted = min(value, allowed)
        player.progress_x = max(player.progress_x, accepted)
        player.max_x = max(player.max_x, player.progress_x)
        player.progress_at = now
        room.touched_at = now

    def record_checkpoint(self, room: Room, player: Player, x: float, valid_checkpoints: set[float] | None = None) -> None:
        value = max(0.0, float(x))
        if valid_checkpoints and value not in valid_checkpoints:
            return
        if value > player.max_x + 200:
            return
        player.checkpoint_x = value
        player.max_x = max(player.max_x, value)
        player.progress_x = max(player.progress_x, value)
        room.touched_at = self.clock()

    def record_death(self, room: Room, player: Player) -> dict:
        if not room.started or player.status != "playing":
            return {"lives": player.lives, "deaths": player.deaths, "status": player.status}
        player.deaths += 1
        player.lives = max(0, player.lives - 1)
        if player.lives == 0:
            player.status = "eliminated"
        room.touched_at = self.clock()
        self._finish_if_done(room)
        return {"lives": player.lives, "deaths": player.deaths, "status": player.status}

    def next_question(self, room: Room, player: Player) -> dict:
        if player.status != "playing":
            raise RoomError("not_playing", "This player is no longer in the game.")
        if player.current_question:
            question = player.current_question
            return self._public_question(question)
        if not player.question_order:
            player.question_order = list(range(len(room.questions)))
            random.shuffle(player.question_order)
        question_index = player.question_order.pop()
        source = room.questions[question_index]
        choices = list(enumerate(source["options"]))
        random.shuffle(choices)
        question = {
            "id": uuid.uuid4().hex,
            "question": source["question"],
            "options": [text for _, text in choices],
            "correctIndex": next(i for i, (original, _) in enumerate(choices) if original == source["answerIndex"]),
            "source": source.get("source", ""),
            "explanation": source.get("explanation", ""),
        }
        player.current_question = question
        return self._public_question(question)

    @staticmethod
    def _public_question(question: dict) -> dict:
        return {key: question[key] for key in ("id", "question", "options", "source")}

    def answer_question(self, room: Room, player: Player, question_id: str, option_index: int) -> dict:
        question = player.current_question
        if player.status != "playing" or not question or question["id"] != question_id or not 0 <= option_index < 4:
            raise RoomError("stale_question", "That answer is no longer active. Reopen the gate question.")
        correct = option_index == question["correctIndex"]
        if correct:
            explanation = question.get("explanation", "")
            player.current_question = None
            return {"correct": True, "explanation": explanation, "wrongAnswers": player.wrong_answers}
        player.wrong_answers += 1
        return {"correct": False, "wrongAnswers": player.wrong_answers}

    def finish(self, room: Room, player: Player, finish_x: float) -> dict:
        if player.status != "playing" or player.max_x < finish_x:
            raise RoomError("finish_not_reached", "Finish is not confirmed yet. Keep moving to the flag.")
        player.status = "finished"
        player.finish_at = self.clock()
        room.touched_at = self.clock()
        self._finish_if_done(room)
        return {"finishAt": player.finish_at, "leaderboard": self.leaderboard(room) if room.ended else None}

    def leaderboard(self, room: Room) -> list[dict]:
        finishers = sorted((p for p in room.players.values() if p.status == "finished"), key=lambda p: p.finish_at or float("inf"))
        eliminated = sorted((p for p in room.players.values() if p.status in {"eliminated", "disconnected-eliminated"}), key=lambda p: (-p.max_x, normalized_name(p.name)))
        ranked = finishers + eliminated
        return [{
            "rank": index + 1,
            "name": player.name,
            "heroId": player.hero_id,
            "status": "Finished" if player.status == "finished" else "Eliminated",
            "finishAt": player.finish_at,
            "finishTime": max(0.0, (player.finish_at or 0) - (room.started_at or room.created_at)) if player.status == "finished" else None,
            "progress": player.max_x,
            "wrongAnswers": player.wrong_answers,
            "deaths": player.deaths,
        } for index, player in enumerate(ranked)]

    def end_game(self, room: Room) -> list[dict]:
        room.ended = True
        for player in room.players.values():
            if player.status in {"playing", "waiting", "disconnected"}:
                player.status = "eliminated"
        room.touched_at = self.clock()
        return self.leaderboard(room)

    def disconnect_player(self, room: Room, player: Player) -> None:
        if player.status in {"playing", "waiting"}:
            player.status_before_disconnect = player.status
            player.status = "disconnected"
            player.disconnected_at = self.clock()
        room.touched_at = self.clock()

    def disconnect_teacher(self, room: Room) -> None:
        room.teacher_connected = False
        room.touched_at = self.clock()

    def expire_player(self, room: Room, player: Player, now: float | None = None) -> bool:
        now = self.clock() if now is None else now
        if player.disconnected_at is None or now - player.disconnected_at < RECONNECT_SECONDS:
            return False
        if player.status == "disconnected":
            player.status = "disconnected-eliminated"
            self._finish_if_done(room)
            room.touched_at = now
            return True
        return False

    def close_room(self, room: Room) -> None:
        self.rooms.pop(room.code, None)

    def _finish_if_done(self, room: Room) -> None:
        if room.started and room.players and all(p.status in {"finished", "eliminated", "disconnected-eliminated"} for p in room.players.values()):
            room.ended = True

    def snapshot(self, room: Room) -> dict:
        return {
            "code": room.code,
            "started": room.started,
            "ended": room.ended,
            "teacherConnected": room.teacher_connected,
            "levelSeed": room.level_seed,
            "tilesetId": room.tileset_id,
            "backgroundId": room.background_id,
            "players": [{"name": p.name, "heroId": p.hero_id, "status": p.status, "lives": p.lives,
                         "progress": p.max_x, "wrongAnswers": p.wrong_answers, "deaths": p.deaths,
                         "checkpointX": p.checkpoint_x, "finishAt": p.finish_at}
                        for p in room.players.values()],
        }
