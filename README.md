# Starbound Run

A mobile-friendly classroom platform game. Phaser 3 Arcade Physics runs in the
browser; FastAPI serves static files under `/public` and handles small
in-memory classroom rooms over WebSockets. There is no bundler or build step.
The game keeps generated placeholder art for missing or failed-to-load images
and sounds.

## Run

For Windows development, from PowerShell run:

```powershell
.\run_dev.ps1
```

The script checks for Python and the required packages, installs `requirements.txt`
if needed, then starts Uvicorn with auto-reload on port 8000. If that port is
already occupied, choose another one with `.\run_dev.ps1 -Port 8001`. Pass
`-NoReload` to disable auto-reload.

To start it manually or from another platform:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn server.main:app --host 0.0.0.0
```

Open <http://localhost:8000>. Phaser 3 and Papa Parse are supplied through
cdnjs. On Windows, use `python -m uvicorn` when the `uvicorn` console command
is not on PATH.

## UI theme

The browser UI uses a neo-brutalist theme defined in
`public/styles/theme.css`. Its palette is available as CSS variables: `--bg`,
`--ink`, `--yellow`, `--pink`, `--blue`, `--green`, `--red`, and `--white`.
Shared primitives are `.nb-button`, `.nb-card`, `.nb-badge`, `.nb-input`, and
`.nb-panel`; screen-specific layouts and legacy game selectors are styled in
`public/game/style.css`. The Phaser canvas stays pixelated and is not filtered.

## Importing art packs

Art is copied into `public/assets/packs/<pack-name>/`. The original pack must
remain unmodified; keep its license and README files in that folder. The
included Kenney pack is at
`public/assets/packs/kenney-new-platformer-pack-1.1/`.

The manifest builder scans every pack and writes
`public/assets/manifest.json`. FastAPI runs it at application startup, or run
it yourself after adding files:

```powershell
python -m tools.build_manifest
```

To scan another assets directory, pass `--assets-dir PATH`. The builder groups
individual numbered animation frames, reads JSON/XML sprite atlases, and can
use an explicit `sheet.json` (`frameWidth`, `frameHeight`, optionally
`frameCount`). Animation names are fuzzily mapped to idle, run/walk, jump,
fall, hurt/hit, die, and attack. Missing animation states use idle frames.
Recognized SVG images are rasterized to generated PNGs at build time; source
SVGs stay intact. Generated files and thumbnails live beside the pack under
`.generated/`; unclassified files are listed in the manifest and printed by
the builder.

An optional `theme.json` may live at the pack root or in a nested folder. Its
`classify` mapping assigns filename/path fragments to `characters`, `enemies`,
`backgrounds`, or `tiles`. A `classifications` object can be used instead.
Category overrides are keyed by the generated item id, for example:

```json
{
  "enemies": {
    "bat": { "name": "Cave Bat", "behavior": "flying" }
  },
  "classify": {
    "characters": ["Sprites/Heroes/"],
    "enemies": ["Sprites/Monsters/"]
  }
}
```

Enemy behavior defaults to patrol. Names containing bat, bird, fly, ghost, or
bee use a sine-wave flight path; plants, spikes, turrets, saws, and similar
names are stationary. Set `behavior` to `patrol`, `flying`, or `stationary` in
`theme.json` to override. The level seed in
`public/levels/stage1.json` fixes enemy positions for every player. Enemies
avoid the spawn, checkpoints, gates, and finish, and spawn only over solid
ground.

## Art and world selection

The menu flow is **Menu → Choose your hero → Choose your world → Play**.
Character entries are selectable heroes with animated idle/run previews. The
world picker independently selects the tileset and background; layered
backgrounds use parallax, and single images scroll and tile horizontally.
Selections and tint/accessory options are stored together in localStorage as
`starbound-run.settings.v1`. Random choices are available on both pickers.
Only the selected hero, tileset, background layers, enemy pack, and available
sound files load for a run. Picker screens load generated thumbnails only.

Stage rows are a tile grid; the chosen pack supplies its native `tileSize` and
each tileset records its effective `displayTileSize`. The default requested
display size is 48 px. Pixel-art packs round that to the nearest whole native
pixel scale (for example, 16 px tiles render at 48 px, while 64 px tiles render
at 64 px); smooth packs use the requested 48 px size. Put `tileSize`,
`displayTileSize`, and `pixelArt` in a pack's root `theme.json` to override
detection. Per-item `scale` and `hitbox` overrides are accepted for heroes and
enemies. The builder prepares actor frames and tileset frames at their intended
display dimensions, using nearest-neighbor resizing for pixel art and Lanczos
for smooth art.

Backgrounds always use a single uniform cover scale on both axes and tile
horizontally; small images are enlarged by a whole-number factor where
possible. Resizing/orientation changes recompute the cover scale. Parallax
layers keep their own scroll speeds. The camera fits roughly 11–12 tiles high
on portrait and landscape screens, and follows the player.

Movement defaults are based on the original 64 px world: `jumpVelocity: 778`,
`gravity: 1050`, `runSpeed: 260`, and `coyoteTime: 110`. Gravity and run speed
scale with the effective display tile size, while jump velocity scales by its
square root; this keeps the theoretical maximum jump near 4.5 tiles. Press
backtick during play to tune these values live. On game start, the browser logs
the selected tile size and a table of each loaded visual's native size,
display size, and scale.

Audio maps by filename to jump, hurt, checkpoint, gate open, correct, wrong,
finish, and music. Unmatched slots remain silent. Sound starts only after the
first pointer/touch interaction; the mute control affects music and effects,
and its preference is saved in localStorage.

The art report for the imported pack is in `ASSET_REPORT.md`. `public/assets/ART_SPEC.md`
describes the game's original generated/fallback visual slots. Missing or
failed pack assets always fall back to generated placeholder graphics.

## Questions and controls

The Questions page imports JSON or CSV with the header
`question,A,B,C,D,answer`. It includes a source-document prompt, sample
questions, validation, inline editing, and delete/clear controls. Questions
stay in this browser's local storage (up to 200); the PDF never touches the
server. Solo practice requires at least three loaded questions. Gate and revive
questions are shuffled without repeats until the pool is exhausted. Correct
answers open gates or restore three hearts; wrong answers count toward the
finish summary and lock choices for three seconds. The race timer keeps running
during question panels.

Use arrows or WASD to move, and Space/Up/W to jump. Touch controls appear on
touch devices and work in portrait and landscape. Game events (`gateReached`,
`damageTaken`, `checkpointReached`, `died`, `progress`, and `finished`) pass
through the small client emitter in `public/game/events.js`; the thin
`public/game/network.js` layer forwards them for classroom races.

## Classroom rooms

The home menu supports **Host a room** and **Join a room**. To host, import at
least three questions, select a world, and share the generated five-character
code. Students enter the code and a display name (up to 16 characters), choose
a hero, and wait for the teacher to start. The teacher stays on the live
dashboard; student tabs run their own copy of the stage after a shared 3-2-1
countdown. The level seed, hero/world choices, questions, and room status are
held by the server in memory. Up to 40 students may join. Rooms expire after
about two hours of inactivity; a teacher can close a completed room from the
leaderboard. No account or database is used.

Room mode gives each student three lives, disables question revives, and marks
them eliminated after their third death. Gates use the same shuffled,
no-repeat question pool, with answer checks on the server. Finish timestamps
are assigned by the server, and the leaderboard ranks finishers by arrival,
then eliminated students by furthest progress. A student can reconnect for 60
seconds using the **Rejoin your room** button. A disconnected teacher pauses
the room until they reconnect. Students do not see one another in the game;
only race status and progress are shared.

The WebSocket protocol is JSON, at `/ws/rooms/{code}`. The first message is
`{type:"hello",role:"teacher",token}` for the teacher or
`{type:"join",name,heroId,resumeToken?}` for a student. The server sends
`connected`/`joined`, then broadcasts `room_snapshot`. Requests carry a
`requestId` and receive a `<type>_result` response. Main client messages are
`start`, `question_request`, `answer`, `progress`, `checkpoint`, `died`, and
`finished`; server events include `game_started`, `life_update`, `room_paused`,
`room_resumed`, and `game_end`. Messages are size limited and room membership,
question correctness, lives, finish order, and finish timestamps are managed
server-side. Progress is sent about twice per second.

For a school Wi-Fi/LAN race, start the server with:

```powershell
python -m uvicorn server.main:app --host 0.0.0.0
```

Find the teacher computer's LAN IP address, then students open
`http://<teacher-ip>:8000` (for example `http://192.168.1.25:8000`). The
teacher computer's firewall must allow incoming connections on port 8000.
Run the room rules tests with `python -m pytest -q`. A tab-by-tab manual test
checklist is in [docs/manual-multiplayer-test.md](docs/manual-multiplayer-test.md).

Question files stay in the importing browser until a teacher creates a room.
For that room only, its question set is uploaded to server memory so the server
can send questions without answers and check student responses. It is removed
when the room is closed or expires. The PDF and any AI-generated source files
are never sent to the server; only the imported question data is.

Press **F2** during play to toggle Arcade body outlines; press **backtick** for
the movement tuning panel.
