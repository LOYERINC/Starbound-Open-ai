export const MUTE_STORAGE_KEY = "starbound-run.muted.v1";

export function loadMutedPreference() {
  try { return localStorage.getItem(MUTE_STORAGE_KEY) === "true"; } catch { return false; }
}

export function saveMutedPreference(muted) {
  try { localStorage.setItem(MUTE_STORAGE_KEY, String(Boolean(muted))); } catch { /* Sound still works for this session. */ }
}

const SOUND_SLOTS = {
  jump: "sfxJump",
  hurt: "sfxHurt",
  checkpoint: "sfxCheckpoint",
  gateOpen: "sfxGateOpen",
  correct: "sfxCorrect",
  wrong: "sfxWrong",
  finish: "sfxFinish",
};

export class GameAudio {
  constructor(scene, manifest, muted, onMuteChange) {
    this.scene = scene;
    this.manifest = manifest;
    this.muted = Boolean(muted);
    this.onMuteChange = onMuteChange;
    this.armed = false;
    this.music = null;
    this.effects = new Map();

    if (manifest && scene.cache.audio) {
      for (const [name, slot] of Object.entries(SOUND_SLOTS)) {
        const key = manifest.assets?.[slot]?.key;
        if (key && scene.cache.audio.exists(key)) {
          try { this.effects.set(name, scene.sound.add(key, { volume: 0.55 })); } catch { /* Optional audio can be absent or unsupported. */ }
        }
      }
      const musicKey = manifest.assets?.music?.key;
      if (musicKey && scene.cache.audio.exists(musicKey)) {
        try { this.music = scene.sound.add(musicKey, { loop: manifest.assets.music.loop !== false, volume: 0.28 }); } catch { this.music = null; }
      }
    }

    this.unlock = () => this.unlockAudio();
    window.addEventListener("pointerdown", this.unlock, { once: true });
    scene.events.once("shutdown", () => {
      window.removeEventListener("pointerdown", this.unlock);
      this.music?.stop(); this.music?.destroy();
      for (const sound of this.effects.values()) { sound.stop(); sound.destroy(); }
      this.effects.clear();
    });
  }

  unlockAudio() {
    if (this.armed) return;
    this.armed = true;
    if (!this.muted && this.music && !this.music.isPlaying) {
      try { this.music.play(); } catch { /* Browser audio may remain unavailable. */ }
    }
  }

  play(name) {
    if (!this.armed || this.muted) return;
    const sound = this.effects.get(name);
    if (sound) { try { sound.play(); } catch { /* Missing/unsupported sound never blocks gameplay. */ } }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.muted) this.music?.stop();
    else if (this.armed && this.music && !this.music.isPlaying) {
      try { this.music.play(); } catch { /* Browser audio may remain unavailable. */ }
    }
    this.onMuteChange?.(this.muted);
  }
}
