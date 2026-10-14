# Starbound Run

Starbound Run is a classroom game. Run and jump through a stage, answer questions, and race to the finish. Play alone or make a room for your class. The game runs in a web browser.

## Run on your computer

1. Install Python 3.13.
2. Open PowerShell in this folder.
3. Enter the app folder:

```powershell
cd app
```

4. Install the needed packages and start the game:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn server.main:app --host 0.0.0.0 --port 8000
```

5. Open <http://localhost:8000>.

## FastAPI Cloud

Set **Application Directory** to `app`. The app entry point is `server.main:app`. This folder has the Python files and the game files in `public/`.
