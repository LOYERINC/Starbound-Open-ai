import pytest

from server.rooms import MAX_PLAYERS, Player, RoomError, RoomManager


def questions(count=3):
    return [{"question": f"Q{i}", "options": [f"A{i}", f"B{i}", f"C{i}", f"D{i}"], "answer": "A"} for i in range(count)]


def room_with_players(count=2):
    manager = RoomManager(code_factory=lambda: "ABC23")
    created = manager.create_room(questions())
    room = manager.get_room(created["code"])
    players = [manager.join(room.code, f"Student {i}", "hero")[1] for i in range(count)]
    return manager, room, players


def test_room_creation_and_question_validation():
    manager = RoomManager(code_factory=lambda: "AB234")
    created = manager.create_room(questions())
    assert created["code"] == "AB234"
    with pytest.raises(RoomError, match="answer must"):
        manager.create_room([{**questions()[0], "answer": "AB"}, *questions()[1:]])


def test_join_validation_bad_code_duplicate_full_and_started():
    manager, room, players = room_with_players(1)
    with pytest.raises(RoomError) as error:
        manager.join("NOPE", "A", "hero")
    assert error.value.code == "bad_code"
    with pytest.raises(RoomError) as error:
        manager.join(room.code, players[0].name, "hero")
    assert error.value.code == "duplicate_name"
    for i in range(1, MAX_PLAYERS):
        manager.join(room.code, f"Student {i}", "hero")
    with pytest.raises(RoomError) as error:
        manager.join(room.code, "Overflow", "hero")
    assert error.value.code == "full"
    manager.start(room)
    with pytest.raises(RoomError) as error:
        manager.join(room.code, "Late", "hero")
    assert error.value.code == "started"


def test_elimination_after_third_death():
    manager, room, (player,) = room_with_players(1)
    manager.start(room)
    assert [manager.record_death(room, player)["lives"] for _ in range(3)] == [2, 1, 0]
    assert player.status == "eliminated"
    assert room.ended


def test_finish_order_and_leaderboard_ranking():
    now = [10.0]
    manager = RoomManager(clock=lambda: now[0], code_factory=lambda: "ABC23")
    data = manager.create_room(questions())
    room = manager.get_room(data["code"])
    first = manager.join(room.code, "First", "hero")[1]
    second = manager.join(room.code, "Second", "hero")[1]
    eliminated = manager.join(room.code, "Third", "hero")[1]
    manager.start(room)
    finish_x = 1000
    now[0] += 6
    for p, progress in [(first, finish_x), (second, finish_x), (eliminated, 800)]:
        manager.record_progress(room, p, progress, 2000)
    manager.record_death(room, eliminated); manager.record_death(room, eliminated); manager.record_death(room, eliminated)
    manager.finish(room, first, finish_x)
    now[0] += 2
    result = manager.finish(room, second, finish_x)
    assert [row["name"] for row in result["leaderboard"]] == ["First", "Second", "Third"]
    assert result["leaderboard"][0]["finishAt"] < result["leaderboard"][1]["finishAt"]
    assert result["leaderboard"][2]["status"] == "Eliminated"


def test_reconnection_restores_player_state_for_sixty_seconds():
    now = [100.0]
    manager = RoomManager(clock=lambda: now[0], code_factory=lambda: "ABC23")
    room = manager.get_room(manager.create_room(questions())["code"])
    player = manager.join(room.code, "Learner", "hero")[1]
    manager.start(room)
    now[0] += 5
    manager.record_progress(room, player, 640, 2000)
    manager.record_checkpoint(room, player, 640, {640})
    manager.record_death(room, player)
    token = player.resume_token
    manager.disconnect_player(room, player)
    now[0] += 30
    rejoined_room, resumed, did_resume = manager.join(room.code, "Learner", "hero", token)
    assert rejoined_room is room and did_resume and resumed is player
    assert resumed.lives == 2 and resumed.checkpoint_x == 640
    manager.disconnect_player(room, player)
    now[0] += 61
    assert manager.expire_player(room, player)
    assert player.status == "disconnected-eliminated"


def test_progress_cannot_teleport_to_finish():
    now = [100.0]
    manager = RoomManager(clock=lambda: now[0], code_factory=lambda: "ABC23")
    room = manager.get_room(manager.create_room(questions())["code"])
    player = manager.join(room.code, "Learner", "hero")[1]
    manager.start(room)
    manager.record_progress(room, player, 9000, 10000)
    assert player.max_x < 9000
    with pytest.raises(RoomError, match="Finish is not confirmed"):
        manager.finish(room, player, 9000)
