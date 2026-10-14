import { TILE } from "./level.js";

export class GameUI {
  constructor(scene, options = {}) {
    this.scene = scene; this.manifest = options.manifest || null; this.onMuteChange = options.onMuteChange;
    this.root = document.createElement("div");
    this.root.className = "game-ui";
    this.root.innerHTML = `<div class="hud"><span class="hearts" aria-label="3 hearts">♥♥♥</span><span class="timer">00:00.0</span><button type="button" class="mute-toggle" aria-label="Toggle sound">${options.muted ? "Sound off" : "Sound on"}</button></div><section class="debug-panel" aria-label="Movement tuning"><header><strong>Movement tuning</strong><span>Press ~ to toggle</span></header><div class="debug-sliders"></div><output class="jump-height"></output><pre class="tuning-output"></pre><button type="button" class="copy-tuning">Copy values</button></section><div class="touch-controls"><div class="touch-group"><button class="touch-button" data-control="left" aria-label="Left">◀</button><button class="touch-button" data-control="right" aria-label="Right">▶</button></div><div class="touch-group"><button class="touch-button" data-control="jump" aria-label="Jump">▲</button></div></div>`;
    document.getElementById("game-root").appendChild(this.root);
    this.hearts = this.root.querySelector(".hearts");
    this.setHearts(3);
    this.timer = this.root.querySelector(".timer");
    this.debugPanel = this.root.querySelector(".debug-panel");
    this.muteButton = this.root.querySelector(".mute-toggle"); this.setMuted(Boolean(options.muted));
    this.muteButton.addEventListener("click", () => this.onMuteChange?.(this.muted = !this.muted));
    this.controls = { left: false, right: false, jump: false };
    this.controlsLocked = false;
    this.root.querySelectorAll("[data-control]").forEach((button) => {
      const control = button.dataset.control;
      const down = (event) => { event.preventDefault(); if (this.controlsLocked) return; this.controls[control] = true; button.setPointerCapture?.(event.pointerId); };
      const up = (event) => { event.preventDefault(); this.controls[control] = false; };
      button.addEventListener("pointerdown", down);
      ["pointerup", "pointercancel", "lostpointercapture"].forEach((name) => button.addEventListener(name, up));
    });
  }
  setHearts(value) {
    this.hearts.replaceChildren(); this.hearts.setAttribute("aria-label", `${value} hearts`);
    for (let i = 0; i < 3; i += 1) {
      const slotName = i < value ? "heartFull" : "heartEmpty"; const slot = this.manifest?.assets?.[slotName];
      if (slot?.key && this.scene?.textures.exists(slot.key)) {
        const img = document.createElement("img"); img.src = this.scene.textures.get(slot.key).getSourceImage().src; img.alt = ""; img.className = "heart-icon"; this.hearts.append(img);
      } else { const span = document.createElement("span"); span.textContent = i < value ? "♥" : "♡"; this.hearts.append(span); }
    }
  }
  setMuted(muted) { this.muted = Boolean(muted); if (this.muteButton) this.muteButton.textContent = this.muted ? "Sound off" : "Sound on"; }
  setTime(seconds) { const m = Math.floor(seconds / 60); const s = seconds % 60; this.timer.textContent = `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`; }
  setLocked(locked) { this.controlsLocked = locked; this.clearControls(); }
  clearControls() { this.controls.left = false; this.controls.right = false; this.controls.jump = false; }
  toggleDebug() { this.debugPanel.classList.toggle("visible"); }
  setupTuning(tuning, onChange) {
    const sliders = [["jumpVelocity", "Jump velocity", 250, 1100, 1], ["gravity", "Gravity", 300, 2200, 10], ["runSpeed", "Run speed", 100, 500, 5], ["coyoteTime", "Coyote time (ms)", 0, 250, 5]];
    const container = this.debugPanel.querySelector(".debug-sliders");
    for (const [key, label, min, max, step] of sliders) {
      const row = document.createElement("label"); row.className = "debug-row";
      row.innerHTML = `<span>${label} <output></output></span><input type="range" min="${min}" max="${max}" step="${step}">`;
      const input = row.querySelector("input"); const output = row.querySelector("output");
      input.value = tuning[key]; output.value = tuning[key];
      input.addEventListener("input", () => { const value = Number(input.value); output.value = value; onChange(key, value); this.updateTuningDisplay(tuning); });
      container.appendChild(row);
    }
    this.root.querySelector(".copy-tuning").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(this.tuningText(tuning)); } catch { /* Values remain visible for manual copying. */ }
    });
    this.updateTuningDisplay(tuning);
  }
  tuningText(tuning) { return `jumpVelocity: ${tuning.jumpVelocity},\ngravity: ${tuning.gravity},\nrunSpeed: ${tuning.runSpeed},\ncoyoteTime: ${tuning.coyoteTime}`; }
  updateTuningDisplay(tuning) {
    const heightTiles = tuning.jumpVelocity ** 2 / (2 * tuning.gravity) / TILE;
    this.debugPanel.querySelector(".jump-height").textContent = `Maximum jump height: ${heightTiles.toFixed(2)} tiles`;
    this.debugPanel.querySelector(".tuning-output").textContent = this.tuningText(tuning);
  }
  showPanel(title, text, buttonText, callback) {
    this.hidePanel();
    const overlay = document.createElement("div"); overlay.className = "overlay";
    const panel = document.createElement("section"); panel.className = "panel";
    this.skinPanel(panel);
    const heading = document.createElement("h1"); heading.textContent = title;
    const copy = document.createElement("p"); copy.textContent = text;
    const button = document.createElement("button"); button.type = "button"; button.textContent = buttonText;
    this.skinButton(button);
    button.addEventListener("click", callback, { once: true });
    panel.append(heading, copy, button); overlay.appendChild(panel); this.root.appendChild(overlay); this.overlay = overlay;
  }
  showQuestion(question, options, mode, onAnswer) {
    this.hidePanel();
    const overlay = document.createElement("div"); overlay.className = "overlay question-overlay";
    const panel = document.createElement("section"); panel.className = "panel question-panel";
    this.skinPanel(panel);
    const layout = document.createElement("div"); layout.className = "question-layout";
    const keeper = this.makeGatekeeper(); if (keeper) layout.append(keeper);
    const content = document.createElement("div"); content.className = "question-content"; layout.append(content); panel.append(layout);
    const heading = document.createElement("h1"); heading.textContent = mode === "revive" ? "Revive question" : "Question gate";
    const prompt = document.createElement("p"); prompt.className = "question-prompt"; prompt.textContent = question.question;
    content.append(heading, prompt);
    if (question.source) {
      const source = document.createElement("p"); source.className = "question-source"; source.textContent = `Source: ${question.source}`; content.append(source);
    }
    const choices = document.createElement("div"); choices.className = "question-choices";
    options.forEach(({ text, correct }, index) => {
      const button = document.createElement("button"); button.type = "button"; button.className = "question-option";
      this.skinButton(button);
      const letter = document.createElement("span"); letter.className = "choice-letter"; letter.textContent = String.fromCharCode(65 + index);
      const answerText = document.createElement("span"); answerText.className = "choice-text"; answerText.textContent = text;
      button.append(letter, answerText);
      button.addEventListener("click", () => onAnswer({ correct, button, optionIndex: index }));
      choices.append(button);
    });
    const note = document.createElement("p"); note.className = "question-note"; note.textContent = "Choose the correct answer to continue. The race clock keeps running.";
    content.append(choices, note); overlay.appendChild(panel); this.root.appendChild(overlay); this.overlay = overlay;
  }
  lockQuestionAfterWrong(button) {
    const overlay = this.overlay;
    if (!overlay) return;
    const choices = [...overlay.querySelectorAll(".question-option")];
    choices.forEach((choice) => { choice.disabled = true; });
    button.classList.add("wrong-choice");
    const note = overlay.querySelector(".question-note");
    const defaultNote = note?.textContent || "Choose the correct answer to continue. The race clock keeps running.";
    let secondsLeft = 3;
    if (note) note.textContent = `✖ Wrong answer. 🔒 Choices unlock in ${secondsLeft} seconds.`;
    const countdown = window.setInterval(() => {
      if (this.overlay !== overlay) { window.clearInterval(countdown); return; }
      secondsLeft -= 1;
      if (note && secondsLeft > 0) note.textContent = `✖ Wrong answer. 🔒 Choices unlock in ${secondsLeft} second${secondsLeft === 1 ? "" : "s"}.`;
      if (secondsLeft <= 0) window.clearInterval(countdown);
    }, 1000);
    window.setTimeout(() => {
      window.clearInterval(countdown);
      if (this.overlay !== overlay) return;
      choices.forEach((choice) => { choice.disabled = choice.classList.contains("wrong-choice"); });
      if (note) note.textContent = defaultNote;
    }, 3000);
  }
  showNotice(title, text) {
    this.hidePanel();
    const overlay = document.createElement("div"); overlay.className = "overlay";
    const panel = document.createElement("section"); panel.className = "panel feedback-panel";
    this.skinPanel(panel);
    const heading = document.createElement("h1"); heading.textContent = title;
    const copy = document.createElement("p"); copy.textContent = text;
    panel.append(heading, copy); overlay.appendChild(panel); this.root.appendChild(overlay); this.overlay = overlay;
  }
  showFinish(time, wrongAnswers, onPlayAgain, onBack) {
    this.hidePanel();
    const overlay = document.createElement("div"); overlay.className = "overlay";
    const panel = document.createElement("section"); panel.className = "panel finish-panel";
    this.skinPanel(panel);
    const heading = document.createElement("h1"); heading.textContent = "Finish flag reached!";
    const copy = document.createElement("p"); copy.textContent = `Total time: ${time}. Wrong answers: ${wrongAnswers}.`;
    const actions = document.createElement("div"); actions.className = "finish-actions";
    const again = document.createElement("button"); again.type = "button"; again.textContent = "Play again"; again.addEventListener("click", onPlayAgain, { once: true });
    const back = document.createElement("button"); back.type = "button"; back.className = "secondary-action"; back.textContent = "Back to menu"; back.addEventListener("click", onBack, { once: true });
    this.skinButton(again); this.skinButton(back);
    actions.append(again, back); panel.append(heading, copy, actions); overlay.appendChild(panel); this.root.appendChild(overlay); this.overlay = overlay;
  }
  hidePanel() { this.overlay?.remove(); this.overlay = null; }
  skinPanel(panel) {
    const slot = this.manifest?.assets?.panelFrame;
    if (!slot?.key || !this.scene?.textures.exists(slot.key)) return;
    const image = this.scene.textures.get(slot.key).getSourceImage(); const slice = slot.slice || { left: 32, right: 32, top: 32, bottom: 32 };
    panel.style.borderStyle = "solid"; panel.style.borderWidth = "24px";
    panel.style.borderImageSource = `url("${image.src}")`; panel.style.borderImageSlice = `${slice.top} ${slice.right} ${slice.bottom} ${slice.left} fill`; panel.style.borderImageRepeat = "stretch";
  }
  skinButton(button) {
    const slot = this.manifest?.assets?.button;
    if (!slot?.key || !this.scene?.textures.exists(slot.key)) return;
    button.classList.add("skinned-button"); button.style.backgroundImage = `url("${this.scene.textures.get(slot.key).getSourceImage().src}")`;
  }
  makeGatekeeper() {
    const slot = this.manifest?.assets?.gatekeeper;
    if (slot?.key && this.scene?.textures.exists(slot.key)) {
      const canvas = document.createElement("canvas"); canvas.className = "gatekeeper-art"; canvas.width = slot.frameSize?.width || 96; canvas.height = slot.frameSize?.height || 128; canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", "Gatekeeper");
      try { const source = this.scene.textures.get(slot.key).getSourceImage(); canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height); } catch { return null; }
      return canvas;
    }
    const fallback = document.createElement("div"); fallback.className = "gatekeeper-fallback"; fallback.setAttribute("aria-label", "Gatekeeper"); fallback.setAttribute("role", "img"); return fallback;
  }
  destroy() { this.root.remove(); }
}
