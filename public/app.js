import { launchPlatformer } from "./game/main.js";
import { RoomClient } from "./game/network.js";
import { gameEvents } from "./game/events.js";
import { loadAssetManifest, loadImageFromManifest } from "./game/assetManifest.js";
import { loadMutedPreference, saveMutedPreference } from "./game/audio.js";
import {
  MAX_QUESTIONS,
  SAMPLE_QUESTIONS,
  loadQuestionBank,
  parseQuestionInput,
  saveQuestionBank,
  validateQuestion,
} from "./game/questionBank.js";

const PROMPT_TEMPLATE = `I'm attaching a document. Create {{COUNT}} multiple-choice quiz questions from it
for a fast-paced classroom game played on phones.

Rules:
- Use ONLY information in the attached document. Do not add outside facts.
- Each question has exactly 4 options and exactly one correct answer.
- Keep each question under 140 characters and each option under 60 characters
  so they fit on a phone screen.
- Wrong options must be plausible but clearly wrong according to the document.
  Never use "all of the above", "none of the above", or "both A and B".
- Spread the correct answers evenly across A, B, C and D.
- Mix difficulty: about 40% easy (recall), 40% medium, 20% hard (understanding
  or application).
- Cover the whole document, not just the beginning. Don't test the same fact
  twice.
- Add the page number or section each answer comes from so I can check it.

Output ONLY valid JSON, with no text before or after it, in exactly this format:
[
  {"question": "...", "options": ["...", "...", "...", "..."], "answer": "B", "source": "page 3", "explanation": "One short sentence."}
]`;

const pages = [...document.querySelectorAll("[data-page]")];
const siteUI = document.getElementById("site-ui");
const gameRoot = document.getElementById("game-root");
const pasteBox = document.getElementById("question-input");
const questionCount = document.getElementById("question-count");
const promptOutput = document.getElementById("prompt-output");
const promptStatus = document.getElementById("prompt-status");
const importErrors = document.getElementById("import-errors");
const importStatus = document.getElementById("import-status");
const questionList = document.getElementById("question-list");
const questionCountLabel = document.getElementById("loaded-count");
const playButton = document.getElementById("play-solo");
let questions = loadQuestionBank();
let activeGame = null;
let muted = loadMutedPreference();
let onlineMode = null;
let roomClient = null;
let roomCode = "";
let teacherToken = "";
let studentName = "";
const ONLINE_SESSION_KEY = "starbound-run.online.v1";
const SETTINGS_KEY = "starbound-run.settings.v1";
let settings = loadSettings();
let avatar = settings.avatar;
let manifest = null;
const imageCache = new Map();
const manifestPromise = loadAssetManifest().then((loaded) => { manifest = loaded; renderPickers(); return loaded; });
const previewCanvas = document.getElementById("avatar-preview");
const previewContext = previewCanvas?.getContext("2d");
let previewAssets = { player: null, accessory: null };
const tintedPreviewCanvas = document.createElement("canvas");
tintedPreviewCanvas.width = 32; tintedPreviewCanvas.height = 40;
const tintedPreviewContext = tintedPreviewCanvas.getContext("2d");

function loadAvatar() {
  try {
    const value = JSON.parse(localStorage.getItem("starbound-run.avatar.v1") || "null");
    return { color: /^#[0-9a-f]{6}$/i.test(value?.color) ? value.color : "#4da3ff", accessory: ["none", "cap", "crown", "starband"].includes(value?.accessory) ? value.accessory : "none" };
  } catch { return { color: "#4da3ff", accessory: "none" }; }
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null") || {};
    const legacyAvatar = loadAvatar();
    return {
      heroId: saved.heroId || null, backgroundId: saved.backgroundId || null,
      tilesetId: saved.tilesetId || null, enemySetId: saved.enemySetId || null,
      avatar: {
        color: /^#[0-9a-f]{6}$/i.test(saved.avatar?.color || legacyAvatar.color) ? (saved.avatar?.color || legacyAvatar.color) : "#ffffff",
        accessory: ["none", "cap", "crown", "starband"].includes(saved.avatar?.accessory || legacyAvatar.accessory) ? (saved.avatar?.accessory || legacyAvatar.accessory) : "none",
      },
    };
  } catch {
    return { heroId: null, backgroundId: null, tilesetId: null, enemySetId: null, avatar: { color: "#ffffff", accessory: "none" } };
  }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Keep selections for this session. */ }
}

function updateMuteButtons() {
  for (const button of [document.getElementById("menu-mute")]) { button.textContent = muted ? "Sound off" : "Sound on"; button.setAttribute("aria-pressed", String(muted)); }
}

function drawPreview(timestamp = 0) {
  if (!previewCanvas || !previewContext) return;
  if (siteUI.hidden) { requestAnimationFrame(drawPreview); return; }
  previewContext.clearRect(0, 0, 128, 160);
  previewContext.fillStyle = "#122b48"; previewContext.beginPath(); previewContext.ellipse(64, 139, 46, 10, 0, 0, Math.PI * 2); previewContext.fill();
  const frame = 4 + (Math.floor(timestamp / 110) % 6);
  const drawSheet = (image, selectedFrame, tint = null) => {
    if (!image) return false;
    const sw = 32, sh = 40; const dx = 48, dy = 58;
    if (tint) {
      tintedPreviewContext.clearRect(0, 0, sw, sh); tintedPreviewContext.drawImage(image, selectedFrame * sw, 0, sw, sh, 0, 0, sw, sh); tintedPreviewContext.globalCompositeOperation = "source-atop"; tintedPreviewContext.fillStyle = tint; tintedPreviewContext.fillRect(0, 0, sw, sh); tintedPreviewContext.globalCompositeOperation = "source-over"; previewContext.drawImage(tintedPreviewCanvas, dx, dy, 32, 40);
    } else previewContext.drawImage(image, selectedFrame * sw, 0, sw, sh, dx, dy, 32, 40);
    return true;
  };
  if (!drawSheet(previewAssets.player, frame, avatar.color)) {
    previewContext.fillStyle = avatar.color; previewContext.fillRect(53, 83, 22, 34); previewContext.fillStyle = "#ffd29b"; previewContext.beginPath(); previewContext.arc(64, 77, 12, 0, Math.PI * 2); previewContext.fill(); previewContext.fillStyle = "#243b59"; previewContext.fillRect(67, 75, 3, 3);
  }
  if (previewAssets.accessory) drawSheet(previewAssets.accessory, frame);
  else if (avatar.accessory !== "none") {
    previewContext.fillStyle = avatar.accessory === "crown" ? "#ffd34e" : avatar.accessory === "starband" ? "#f5d35c" : "#68d5f2";
    if (avatar.accessory === "crown") { previewContext.beginPath(); previewContext.moveTo(52, 67); previewContext.lineTo(55, 57); previewContext.lineTo(61, 66); previewContext.lineTo(65, 55); previewContext.lineTo(70, 66); previewContext.lineTo(77, 58); previewContext.lineTo(77, 69); previewContext.closePath(); previewContext.fill(); }
    else { previewContext.fillRect(51, 67, 26, 5); if (avatar.accessory === "starband") { previewContext.beginPath(); previewContext.arc(64, 64, 4, 0, Math.PI * 2); previewContext.fill(); } }
  }
  requestAnimationFrame(drawPreview);
}

async function loadPreviewAssets() {
  const manifest = await manifestPromise;
  if (!manifest) return;
  previewAssets.player = await loadImageFromManifest(manifest, "player");
  const slot = { cap: "accessoryCap", crown: "accessoryCrown", starband: "accessoryStarband" }[avatar.accessory];
  previewAssets.accessory = slot ? await loadImageFromManifest(manifest, slot) : null;
  const bg = await loadImageFromManifest(manifest, "menuBackground");
  if (bg) siteUI.style.backgroundImage = `linear-gradient(#0816299c,#081629d9),url("${bg.src}")`;
  const logo = await loadImageFromManifest(manifest, "logo");
  if (logo) { const element = document.getElementById("game-logo"); element.src = logo.src; element.hidden = false; }
  const buttonArt = await loadImageFromManifest(manifest, "button");
  if (buttonArt) {
    document.querySelectorAll(".menu-button").forEach((button) => { button.classList.add("theme-button"); button.style.backgroundImage = `url("${buttonArt.src}")`; });
  }
}

function persistAvatar() {
  avatar = { color: document.getElementById("avatar-color").value, accessory: document.getElementById("avatar-accessory").value };
  settings.avatar = avatar; saveSettings();
}

function imageForPicker(path) {
  if (!path) return Promise.resolve(null);
  if (!imageCache.has(path)) imageCache.set(path, new Promise((resolve) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => resolve(null); image.src = path;
  }));
  return imageCache.get(path);
}

function chooseFrom(listName, selectedId, preferredId) {
  const list = manifest?.[listName] || [];
  return list.find((item) => item.id === selectedId) || list.find((item) => item.id === preferredId) || list[0] || null;
}

function updatePickers() {
  saveSettings();
  renderPickers();
}

function createPickCard(item, kind, selectedId) {
  const button = document.createElement("button"); button.type = "button"; button.className = "asset-card";
  button.classList.toggle("is-selected", item.id === selectedId); button.setAttribute("aria-pressed", String(item.id === selectedId));
  let image;
  if (kind === "hero" && item.previewSheet) {
    image = document.createElement("canvas"); image.width = 64; image.height = 64; image.className = "hero-card-preview";
    image.classList.toggle("pixel-art-preview", Boolean(item.pixelArt));
    let running = false; let frame = 0; let previewImage = null;
    imageForPicker(item.previewSheet).then((loaded) => { previewImage = loaded; drawFrame(); });
    const drawFrame = () => {
      const context = image.getContext("2d"); context.clearRect(0, 0, 64, 64);
      if (previewImage) context.drawImage(previewImage, frame * 64, 0, 64, 64, 0, 0, 64, 64);
    };
    let animation;
    const animate = () => { if (!running) return; frame = frame === 0 ? 1 : (frame >= (item.previewAnimations?.run?.end || 2) ? 1 : frame + 1); drawFrame(); animation = window.setTimeout(animate, 140); };
    button.addEventListener("pointerenter", () => { running = true; animate(); });
    button.addEventListener("pointerleave", () => { running = false; window.clearTimeout(animation); frame = 0; drawFrame(); });
    button.addEventListener("pointerdown", () => { running = true; animate(); window.setTimeout(() => { running = false; window.clearTimeout(animation); frame = 0; drawFrame(); }, 700); });
  } else {
    image = document.createElement("img"); image.alt = ""; image.loading = "lazy"; image.src = item.thumbnail || "";
    image.classList.toggle("pixel-art-preview", Boolean(item.pixelArt));
  }
  const title = document.createElement("span"); title.textContent = item.name; button.append(image, title);
  if (kind === "hero") {
    button.addEventListener("click", () => { settings.heroId = item.id; updatePickers(); });
  } else button.addEventListener("click", () => {
    if (kind === "background") settings.backgroundId = item.id;
    else settings.tilesetId = item.id;
    updatePickers();
  });
  return button;
}

async function drawWorldPreview() {
  const canvas = document.getElementById("world-preview");
  if (!canvas) return;
  const context = canvas.getContext("2d");
  const background = chooseFrom("backgrounds", settings.backgroundId, "background_color_hills");
  const tileset = chooseFrom("tilesets", settings.tilesetId, "grass");
  context.fillStyle = "#75c9e4"; context.fillRect(0, 0, canvas.width, canvas.height);
  const bgImage = await imageForPicker(background?.thumbnail);
  if (bgImage) {
    context.save(); context.beginPath(); context.rect(0, 0, canvas.width, canvas.height); context.clip();
    context.imageSmoothingEnabled = !background?.pixelArt;
    const scale = Math.max(canvas.width / bgImage.width, canvas.height / bgImage.height);
    const tileWidth = bgImage.width * scale; const tileHeight = bgImage.height * scale;
    for (let x = 0; x < canvas.width; x += tileWidth) context.drawImage(bgImage, x, (canvas.height - tileHeight) / 2, tileWidth, tileHeight);
    context.restore();
  }
  context.fillStyle = "#14283a55"; context.fillRect(0, 0, canvas.width, canvas.height);
  const tileImage = await imageForPicker(tileset?.thumbnail);
  if (tileImage) {
    context.imageSmoothingEnabled = !tileset?.pixelArt;
    const crop = Math.min(tileImage.width, tileImage.height);
    for (let x = 0; x < canvas.width; x += 64) context.drawImage(tileImage, 0, 0, crop, crop, x, canvas.height - 72, 64, 64);
  }
  document.getElementById("world-selection-label").textContent = (background?.name || "Generated sky") + " background · " + (tileset?.name || "Generated") + " tiles";
}

function renderPickers() {
  if (!manifest) return;
  settings.heroId ||= manifest.heroes?.[0]?.id || null;
  settings.backgroundId ||= chooseFrom("backgrounds", null, "background_color_hills")?.id || null;
  settings.tilesetId ||= chooseFrom("tilesets", null, "grass")?.id || null;
  settings.enemySetId ||= manifest.enemySets?.[0]?.id || null;
  const heroGrid = document.getElementById("hero-grid"); heroGrid.replaceChildren();
  for (const hero of manifest.heroes || []) heroGrid.append(createPickCard(hero, "hero", settings.heroId));
  if (!heroGrid.children.length) {
    const fallback = document.createElement("p"); fallback.className = "empty-list";
    fallback.textContent = "No hero art was found. The generated runner will be used."; heroGrid.append(fallback);
  }
  const backgroundGrid = document.getElementById("background-grid"); backgroundGrid.replaceChildren();
  for (const item of manifest.backgrounds || []) backgroundGrid.append(createPickCard(item, "background", settings.backgroundId));
  const tilesetGrid = document.getElementById("tileset-grid"); tilesetGrid.replaceChildren();
  for (const item of manifest.tilesets || []) tilesetGrid.append(createPickCard(item, "tileset", settings.tilesetId));
  document.getElementById("hero-selection-label").textContent = "Selected: " + (chooseFrom("heroes", settings.heroId)?.name || "Generated runner");
  document.getElementById("avatar-color").value = settings.avatar.color;
  document.getElementById("avatar-accessory").value = settings.avatar.accessory;
  saveSettings(); drawWorldPreview();
}

function showPage(name) {
  siteUI.hidden = false;
  for (const page of pages) page.hidden = page.dataset.page !== name;
  gameRoot.hidden = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderPrompt() {
  const raw = Number(questionCount.value);
  const count = Number.isFinite(raw) ? Math.max(5, Math.min(50, Math.trunc(raw))) : 20;
  promptOutput.textContent = PROMPT_TEMPLATE.replaceAll("{{COUNT}}", String(count));
}

function announceImport(message, isError = false) {
  importStatus.textContent = message;
  importStatus.classList.toggle("error-text", isError);
}

function renderErrors(errors) {
  importErrors.replaceChildren();
  if (!errors.length) return;
  const heading = document.createElement("strong");
  heading.textContent = "Some questions need attention:";
  importErrors.append(heading);
  const list = document.createElement("ul");
  for (const message of errors) {
    const item = document.createElement("li");
    item.textContent = message;
    list.append(item);
  }
  importErrors.append(list);
}

function updatePlayButton() {
  const ready = questions.length >= 3;
  playButton.disabled = !ready;
  playButton.setAttribute("aria-disabled", String(!ready));
  document.getElementById("play-hint").textContent = ready ? `${questions.length} questions loaded` : "Add questions first";
}

function updateMenu() {
  updatePlayButton();
  renderPreview();
  document.getElementById("rejoin-room").hidden = !loadOnlineSession();
}

function loadOnlineSession() {
  try { return JSON.parse(localStorage.getItem(ONLINE_SESSION_KEY) || "null"); } catch { return null; }
}

function saveOnlineSession(value) {
  try { value ? localStorage.setItem(ONLINE_SESSION_KEY, JSON.stringify(value)) : localStorage.removeItem(ONLINE_SESSION_KEY); } catch { /* Keep this session usable without storage. */ }
}

function setupRoomClient(client, role) {
  client.bindGameEvents(gameEvents);
  client.addEventListener("message", ({ detail }) => {
    if (detail.type === "room_snapshot") {
      renderLobby(detail.room);
      if (role === "student") {
        const session = loadOnlineSession();
        const mine = detail.room.players?.find((player) => player.name.toLocaleLowerCase() === session?.name?.toLocaleLowerCase());
        if (mine && session) saveOnlineSession({ ...session, checkpointX: mine.checkpointX, lives: mine.lives, heroId: mine.heroId });
      }
      if (detail.room.ended) showLeaderboard([]);
    } else if (detail.type === "game_started") {
      if (role === "teacher") showTeacherDashboard();
      else beginStudentRace(detail);
    } else if (detail.type === "game_end") showLeaderboard(detail.leaderboard || []);
    else if (detail.type === "room_paused") document.getElementById("lobby-copy").textContent = "Teacher connection lost. The race is paused while they reconnect.";
    else if (detail.type === "room_resumed") document.getElementById("lobby-copy").textContent = "Teacher reconnected. The race is live.";
    else if (detail.type === "room_closed") { client.close(); saveOnlineSession(null); roomClient = null; showPage("home"); }
  });
  client.addEventListener("reconnecting", () => { document.getElementById("lobby-copy").textContent = "Connection lost. Reconnecting to your room…"; });
}

function renderLobby(room) {
  if (!room) return;
  const teacher = loadOnlineSession()?.role === "teacher";
  document.getElementById("room-code-display").textContent = room.code;
  document.getElementById("lobby-title").textContent = room.started ? (teacher ? "Race dashboard" : "Race in progress") : "Room lobby";
  document.getElementById("lobby-copy").textContent = room.started ? (teacher ? "Live student progress" : "Waiting for teacher to start…") : (teacher ? "Share this code with your students." : "Waiting for teacher to start…");
  const list = document.getElementById("lobby-students"); list.replaceChildren();
  for (const student of room.players || []) {
    const row = document.createElement("div"); row.className = "student-row";
    const name = document.createElement("strong"); name.textContent = student.name;
    const status = document.createElement("span"); status.textContent = student.status === "finished" ? "Finished" : student.status === "eliminated" || student.status === "disconnected-eliminated" ? "Eliminated" : student.status === "disconnected" ? "Reconnecting…" : student.status === "playing" ? "Playing" : "Waiting";
    const stats = document.createElement("small"); stats.textContent = room.started ? `${student.lives} lives · ${Math.floor(student.progress)} px · ${student.wrongAnswers} wrong · ${student.deaths} deaths` : `${student.heroId || "Runner"}`;
    row.append(name, status, stats); list.append(row);
  }
  const start = document.getElementById("lobby-start"); start.hidden = !teacher || room.started || room.players.length === 0;
  document.getElementById("lobby-end").hidden = !teacher || !room.started || room.ended;
  document.getElementById("lobby-close").hidden = !teacher || room.started;
}

function showTeacherDashboard() {
  showPage("lobby");
  document.getElementById("lobby-copy").textContent = "Race live · student progress updates automatically.";
}

function beginStudentRace(details) {
  if (activeGame || document.querySelector(".race-countdown")) return;
  const countdown = document.createElement("div"); countdown.className = "leaderboard-wrap race-countdown";
  const number = document.createElement("div"); number.className = "room-code-display"; number.textContent = "3"; countdown.append(number); document.body.append(countdown);
  let value = 3;
  const tick = () => {
    value -= 1; number.textContent = value > 0 ? String(value) : "GO!";
    if (value > 0) window.setTimeout(tick, 800);
    else window.setTimeout(() => { countdown.remove(); startOnlineStudent(details); }, 600);
  };
  window.setTimeout(tick, 800);
}

async function startOnlineStudent(details = {}) {
  if (activeGame) return;
  const loadedManifest = (await manifestPromise) || { activeTheme: "generated", tileSize: 64, assets: {}, heroes: [], backgrounds: [], tilesets: [], enemies: [], enemySets: [] };
  settings.tilesetId = details.tilesetId || settings.tilesetId;
  settings.backgroundId = details.backgroundId || settings.backgroundId;
  const session = loadOnlineSession() || {};
  gameRoot.replaceChildren(); gameRoot.hidden = false; siteUI.hidden = true;
  activeGame = launchPlatformer({ manifest: loadedManifest, settings: JSON.parse(JSON.stringify(settings)), avatar: settings.avatar, muted,
    network: roomClient, onlineRoom: true, levelSeed: Number(details.levelSeed), resumeState: loadOnlineSession(), onMuteChange: (value) => { muted = value; saveMutedPreference(value); updateMuteButtons(); },
    onLeaderboard: (rows) => showLeaderboard(rows),
    onBackToMenu: () => { activeGame = null; gameRoot.replaceChildren(); gameRoot.hidden = true; showPage("home"); },
  });
  saveOnlineSession(session);
}

function showLeaderboard(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  window.lastLeaderboard = rows;
  const existing = document.querySelector(".leaderboard-wrap"); existing?.remove();
  const wrap = document.createElement("div"); wrap.className = "leaderboard-wrap";
  const card = document.createElement("section"); card.className = "leaderboard-card";
  const heading = document.createElement("h1"); heading.textContent = "Race results"; card.append(heading);
  const header = document.createElement("div"); header.className = "leaderboard-row leaderboard-header";
  for (const label of ["Rank", "Student", "Hero", "Time / status", "Wrong", "Deaths"]) { const span = document.createElement("span"); span.textContent = label; header.append(span); } card.append(header);
  const session = loadOnlineSession();
  rows.forEach((student) => {
    const row = document.createElement("div"); row.className = "leaderboard-row";
    if (session?.role === "student" && student.name.toLocaleLowerCase() === session.name?.toLocaleLowerCase()) row.classList.add("current-player");
    const rank = document.createElement("span"); rank.textContent = String(student.rank); row.append(rank);
    const name = document.createElement("span"); name.textContent = student.name; row.append(name);
    const hero = document.createElement("span"); hero.textContent = student.heroId || "Runner";
    const art = manifest?.heroes?.find((item) => item.id === student.heroId)?.thumbnail;
    if (art) { const icon = document.createElement("img"); icon.src = art; icon.alt = ""; icon.width = 24; icon.height = 24; icon.style.objectFit = "contain"; icon.style.verticalAlign = "middle"; hero.prepend(icon, document.createTextNode(" ")); }
    row.append(hero);
    for (const value of [student.status === "Finished" ? formatServerTime(student.finishTime) : "Eliminated", student.wrongAnswers, student.deaths]) { const span = document.createElement("span"); span.textContent = String(value ?? "—"); row.append(span); }
    card.append(row);
  });
  const actions = document.createElement("div"); actions.className = "online-actions";
  if (session?.role === "teacher") {
    const back = document.createElement("button"); back.className = "menu-button secondary-button"; back.textContent = "Back to menu"; back.addEventListener("click", async () => { try { await roomClient?.request("close"); } catch { /* Room may already have expired. */ } roomClient?.close(); roomClient = null; saveOnlineSession(null); activeGame?.destroy(true); activeGame = null; gameRoot.replaceChildren(); showPage("home"); wrap.remove(); }); actions.append(back);
  }
  card.append(actions); wrap.append(card); document.body.append(wrap);
}

function formatServerTime(epochSeconds) {
  if (!Number.isFinite(Number(epochSeconds))) return "Finished";
  return `${Number(epochSeconds).toFixed(2)}s`;
}

function persistQuestions() {
  if (!saveQuestionBank(questions)) announceImport("Questions are loaded for this session, but local storage is unavailable.", true);
  updateMenu();
}

function makeField(labelText, value, inputClass = "") {
  const label = document.createElement("label");
  label.className = "edit-field";
  const labelTextNode = document.createElement("span");
  labelTextNode.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.maxLength = labelText === "Question" ? 240 : 120;
  if (inputClass) input.className = inputClass;
  label.append(labelTextNode, input);
  return { label, input };
}

function renderPreview() {
  questionCountLabel.textContent = `${questions.length} / ${MAX_QUESTIONS} questions loaded`;
  questionList.replaceChildren();
  if (questions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = "Your imported questions will appear here.";
    questionList.append(empty);
    return;
  }

  questions.forEach((question, index) => {
    const card = document.createElement("article");
    card.className = "question-card";
    const top = document.createElement("div");
    top.className = "question-card-top";
    const number = document.createElement("h3");
    number.textContent = `Question ${index + 1}`;
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "small-button danger-button"; remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete question ${index + 1}`);
    remove.addEventListener("click", () => {
      questions.splice(index, 1); persistQuestions(); announceImport("Question deleted.");
    });
    top.append(number, remove); card.append(top);

    const questionField = makeField("Question", question.question);
    card.append(questionField.label);
    const optionsGrid = document.createElement("div");
    optionsGrid.className = "options-edit-grid";
    const optionInputs = question.options.map((option, optionIndex) => {
      const field = makeField(`Option ${String.fromCharCode(65 + optionIndex)}`, option);
      optionsGrid.append(field.label); return field.input;
    });
    card.append(optionsGrid);

    const answerLabel = document.createElement("label");
    answerLabel.className = "edit-field answer-field";
    const answerText = document.createElement("span"); answerText.textContent = "Correct answer";
    const answerSelect = document.createElement("select");
    for (const letter of ["A", "B", "C", "D"]) {
      const option = document.createElement("option"); option.value = letter; option.textContent = letter; answerSelect.append(option);
    }
    answerSelect.value = question.answer; answerLabel.append(answerText, answerSelect); card.append(answerLabel);
    if (question.source) {
      const source = document.createElement("p"); source.className = "source-note";
      source.textContent = `Source: ${question.source}`; card.append(source);
    }
    if (question.explanation) {
      const explanation = document.createElement("p"); explanation.className = "source-note";
      explanation.textContent = `Explanation: ${question.explanation}`; card.append(explanation);
    }
    const validationNote = document.createElement("p");
    validationNote.className = "validation-note"; validationNote.setAttribute("aria-live", "polite"); card.append(validationNote);

    const commitEdit = () => {
      const candidate = { ...question, question: questionField.input.value, options: optionInputs.map((input) => input.value), answer: answerSelect.value };
      const result = validateQuestion(candidate, index + 1);
      if (result.errors.length) {
        validationNote.textContent = result.errors.join("; ");
        validationNote.classList.add("error-text");
        return;
      }
      questions[index] = result.question;
      validationNote.textContent = "Saved";
      validationNote.classList.remove("error-text");
      saveQuestionBank(questions); updatePlayButton();
    };
    questionField.input.addEventListener("change", commitEdit);
    optionInputs.forEach((input) => input.addEventListener("change", commitEdit));
    answerSelect.addEventListener("change", commitEdit);
    questionList.append(card);
  });
}

function addImportedQuestions() {
  const parsed = parseQuestionInput(pasteBox.value);
  const errors = [...parsed.errors];
  const accepted = [];
  parsed.rows.forEach((row, index) => {
    const number = index + 1;
    const validated = validateQuestion(row, number);
    if (validated.errors.length) errors.push(...validated.errors);
    else if (questions.length + accepted.length >= MAX_QUESTIONS) errors.push(`Question ${number}: the library limit is ${MAX_QUESTIONS}`);
    else accepted.push(validated.question);
  });
  if (!accepted.length && !errors.length) errors.push("No questions were found in the input.");
  if (accepted.length) {
    questions = [...questions, ...accepted];
    const saved = saveQuestionBank(questions);
    updateMenu();
    announceImport(`${accepted.length} question${accepted.length === 1 ? "" : "s"} imported${saved ? " and saved" : " for this session"}.`);
  } else announceImport("No valid questions were imported.", true);
  renderErrors(errors);
}

document.getElementById("go-to-questions").addEventListener("click", () => showPage("questions"));
document.getElementById("back-home").addEventListener("click", () => showPage("home"));
document.getElementById("copy-prompt").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(promptOutput.textContent);
    promptStatus.textContent = "Prompt copied.";
    promptStatus.classList.remove("error-text");
  } catch {
    const temporary = document.createElement("textarea");
    temporary.value = promptOutput.textContent; temporary.setAttribute("readonly", "");
    temporary.style.position = "fixed"; temporary.style.opacity = "0";
    document.body.append(temporary); temporary.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } catch { copied = false; }
    temporary.remove();
    promptStatus.textContent = copied ? "Prompt copied." : "Clipboard access was blocked. Select the prompt text and copy it manually.";
    promptStatus.classList.toggle("error-text", !copied);
  }
});
questionCount.addEventListener("input", renderPrompt);
questionCount.addEventListener("change", () => {
  const raw = Number(questionCount.value);
  questionCount.value = String(Number.isFinite(raw) ? Math.max(5, Math.min(50, Math.trunc(raw))) : 20);
  renderPrompt();
});
document.getElementById("question-file").addEventListener("change", async (event) => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  try { pasteBox.value = await file.text(); announceImport(`${file.name} loaded into the paste box. Choose Import to add it.`); }
  catch { announceImport("Could not read that file. Try another JSON or CSV file.", true); }
  event.currentTarget.value = "";
});
document.getElementById("load-samples").addEventListener("click", () => {
  const room = MAX_QUESTIONS - questions.length;
  const samples = SAMPLE_QUESTIONS.slice(0, Math.max(0, room));
  if (!samples.length) { announceImport(`The library already has ${MAX_QUESTIONS} questions.`, true); return; }
  questions = [...questions, ...samples.map((question) => ({ ...question, options: [...question.options] }))];
  const saved = saveQuestionBank(questions); updateMenu(); renderErrors([]);
  announceImport(`${samples.length} sample questions loaded${saved ? " and saved" : " for this session"}.`);
});
document.getElementById("import-questions").addEventListener("click", addImportedQuestions);
document.getElementById("clear-questions").addEventListener("click", () => {
  questions = []; saveQuestionBank(questions); renderErrors([]); announceImport("All questions cleared."); updateMenu();
});
playButton.addEventListener("click", () => {
  if (questions.length < 3) return;
  onlineMode = null;
  document.getElementById("world-play").textContent = "Play solo practice →";
  document.getElementById("hero-continue").textContent = "Continue to world →";
  showPage("hero");
});

document.getElementById("hero-back-home").addEventListener("click", () => showPage("home"));
document.getElementById("world-back-hero").addEventListener("click", () => showPage("hero"));
document.getElementById("hero-continue").addEventListener("click", async () => {
  if (onlineMode !== "student") { showPage("world"); return; }
  const session = loadOnlineSession();
  roomClient = new RoomClient(); setupRoomClient(roomClient, "student");
  document.getElementById("lobby-eyebrow").textContent = "Student lobby";
  document.getElementById("lobby-start").hidden = true; document.getElementById("lobby-end").hidden = true;
  document.getElementById("lobby-error").textContent = "Connecting…"; showPage("lobby");
  try {
    const joined = await roomClient.connect(roomCode, { type: "join", name: studentName, heroId: settings.heroId || "runner", resumeToken: session?.resumeToken });
    saveOnlineSession({ role: "student", code: roomCode, name: studentName, resumeToken: joined.resumeToken, heroId: settings.heroId, checkpointX: joined.checkpointX, lives: joined.lives });
    renderLobby(joined.room); showPage("lobby"); document.getElementById("lobby-error").textContent = "";
    if (joined.status === "playing") beginStudentRace(joined.room);
  } catch (error) { roomClient?.close(); roomClient = null; showPage("join"); document.getElementById("join-error").textContent = error.message; }
});
document.getElementById("hero-random").addEventListener("click", () => {
  const heroes = manifest?.heroes || [];
  if (heroes.length) { settings.heroId = heroes[Math.floor(Math.random() * heroes.length)].id; updatePickers(); }
});
document.getElementById("background-random").addEventListener("click", () => {
  const items = manifest?.backgrounds || [];
  if (items.length) { settings.backgroundId = items[Math.floor(Math.random() * items.length)].id; updatePickers(); }
});
document.getElementById("tileset-random").addEventListener("click", () => {
  const items = manifest?.tilesets || [];
  if (items.length) { settings.tilesetId = items[Math.floor(Math.random() * items.length)].id; updatePickers(); }
});
document.getElementById("world-play").addEventListener("click", () => onlineMode === "teacher" ? startHosting() : startGame());

document.getElementById("host-room").addEventListener("click", () => {
  if (questions.length < 3) { announceImport("Load at least three questions before hosting a room.", true); showPage("questions"); return; }
  onlineMode = "teacher"; showPage("world"); document.getElementById("world-play").textContent = "Create classroom room →";
});
document.getElementById("join-room").addEventListener("click", () => { onlineMode = "student"; showPage("join"); });
document.getElementById("join-back").addEventListener("click", () => showPage("home"));
document.getElementById("room-code").addEventListener("input", (event) => { event.currentTarget.value = event.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5); });
document.getElementById("join-submit").addEventListener("click", () => {
  roomCode = document.getElementById("room-code").value.trim().toUpperCase();
  studentName = document.getElementById("student-name").value.trim();
  const error = document.getElementById("join-error");
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(roomCode)) { error.textContent = "Enter the 5-character room code from your teacher."; return; }
  if (!studentName || studentName.length > 16) { error.textContent = "Enter a display name from 1 to 16 characters."; return; }
  error.textContent = ""; showPage("hero"); document.getElementById("hero-continue").textContent = "Join room lobby →";
});

async function startHosting() {
  if (questions.length < 3) { showPage("home"); return; }
  const button = document.getElementById("world-play"); button.disabled = true; button.textContent = "Creating room…";
  try {
    let response;
    try {
      response = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        questions, tilesetId: settings.tilesetId || "grass", backgroundId: settings.backgroundId || "background_clouds", levelSeed: 20261014,
      }) });
    } catch {
      throw new Error("Could not reach the room server. Start the FastAPI app and open the game from that server (usually http://127.0.0.1:8000). ");
    }
    const contentType = response.headers.get("content-type") || "";
    let data = {};
    if (contentType.includes("application/json")) {
      try { data = await response.json(); } catch { data = {}; }
    }
    if (!response.ok) {
      if ([404, 405].includes(response.status) || !contentType.includes("application/json")) {
        throw new Error("This page is running on a static preview server, which cannot create online rooms. Start FastAPI and open the game at http://127.0.0.1:8000.");
      }
      throw new Error(data.error?.message || data.detail || `Could not create room (HTTP ${response.status}).`);
    }
    roomCode = data.code; teacherToken = data.teacherToken;
    roomClient = new RoomClient(); setupRoomClient(roomClient, "teacher");
    const connected = await roomClient.connect(roomCode, { type: "hello", role: "teacher", token: teacherToken });
    saveOnlineSession({ role: "teacher", code: roomCode, token: teacherToken, tilesetId: settings.tilesetId, backgroundId: settings.backgroundId });
    renderLobby(connected.room); document.getElementById("lobby-eyebrow").textContent = "Teacher lobby"; showPage("lobby");
  } catch (error) { document.getElementById("world-status").textContent = error.message; showPage("world"); }
  finally { button.disabled = false; button.textContent = "Create classroom room →"; }
}

document.getElementById("lobby-start").addEventListener("click", async () => {
  try { await roomClient.request("start"); } catch (error) { document.getElementById("lobby-error").textContent = error.message; }
});
document.getElementById("lobby-end").addEventListener("click", async () => {
  try { const result = await roomClient.request("end"); showLeaderboard(result.leaderboard || []); } catch (error) { document.getElementById("lobby-error").textContent = error.message; }
});
document.getElementById("lobby-close").addEventListener("click", async () => {
  try { await roomClient?.request("close"); } catch { /* The close event also clears the room from other tabs. */ }
  roomClient?.close(); roomClient = null; saveOnlineSession(null); showPage("home");
});
document.getElementById("rejoin-room").addEventListener("click", async () => {
  const session = loadOnlineSession(); if (!session) return;
  roomCode = session.code; roomClient = new RoomClient(); setupRoomClient(roomClient, session.role);
  try {
    const hello = session.role === "teacher" ? { type: "hello", role: "teacher", token: session.token } : { type: "join", name: session.name, heroId: session.heroId, resumeToken: session.resumeToken };
    const result = await roomClient.connect(roomCode, hello);
    renderLobby(result.room); showPage("lobby");
    if (session.role === "student" && result.status === "playing") beginStudentRace(result.room);
  } catch (error) { roomClient?.close(); roomClient = null; saveOnlineSession(null); announceImport(error.message, true); }
});

async function startGame() {
  if (questions.length < 3) { showPage("home"); return; }
  const loadedManifest = (await manifestPromise) || { activeTheme: "generated", tileSize: 64, assets: {}, heroes: [], backgrounds: [], tilesets: [], enemies: [], enemySets: [] };
  settings.enemySetId ||= loadedManifest.enemySets?.[0]?.id || null;
  saveSettings();
  for (const page of pages) page.hidden = true;
  siteUI.hidden = true;
  gameRoot.hidden = false;
  window.scrollTo(0, 0);
  try {
    activeGame = launchPlatformer({
      questions: questions.map((question) => ({ ...question, options: [...question.options] })),
      manifest: loadedManifest, settings: JSON.parse(JSON.stringify(settings)), avatar: { ...settings.avatar }, muted,
      onMuteChange: (value) => { muted = value; saveMutedPreference(value); updateMuteButtons(); },
      onBackToMenu: () => { activeGame = null; gameRoot.replaceChildren(); gameRoot.hidden = true; showPage("home"); },
    });
  } catch {
    gameRoot.hidden = true; showPage("home");
    announceImport("The game could not start. Refresh the page and try again.", true);
  }
}

document.getElementById("avatar-color").addEventListener("input", persistAvatar);
document.getElementById("avatar-accessory").addEventListener("change", persistAvatar);
document.getElementById("menu-mute").addEventListener("click", () => { muted = !muted; saveMutedPreference(muted); updateMuteButtons(); });
updateMuteButtons();

renderPrompt(); updateMenu(); showPage("home");
