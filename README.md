# Starbound Run

Starbound Run is a classroom game. Run and jump through a stage, answer questions, and race to the finish. You can play alone or make a room for other players. Your questions and game choices stay in your browser. The server keeps room details while a room is open.

## Run the game

1. Install Python 3.
2. Open PowerShell in this folder.
3. Install the needed packages:

```powershell
python -m pip install -r requirements.txt
```

4. Start the game:

```powershell
python -m uvicorn server.main:app --host 0.0.0.0
```

5. Open <http://localhost:8000> in your browser.

Use the arrow keys or WASD to move. Press Space to jump. On a phone or tablet, use the screen buttons. To let others on your Wi-Fi join your room, share your computer's network address and port 8000.
