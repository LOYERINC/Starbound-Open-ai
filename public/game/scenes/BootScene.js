export class BootScene extends Phaser.Scene {
  constructor() { super("BootScene"); }

  preload() {
    const launchData = window.platformerLaunchData || {};
    const manifest = structuredClone(launchData.manifest || { activeTheme: "generated", assets: {} });
    manifest.assets ||= {};
    const settings = launchData.settings || {};
    const choose = (items, id, fallback) => items?.find((item) => item.id === id) || items?.find((item) => item.id === fallback) || items?.[0] || null;
    const select = (entry, key, type = "spritesheet") => entry && { ...entry, key, type };
    const hero = choose(manifest.heroes, settings.heroId, null);
    const tiles = choose(manifest.tilesets, settings.tilesetId, "grass");
    const background = choose(manifest.backgrounds, settings.backgroundId, "background_color_hills");
    const enemySet = manifest.enemySets?.find((item) => item.id === settings.enemySetId) || manifest.enemySets?.[0];
    manifest.assets.player = select(hero, "selected-player");
    manifest.assets.tileset = select(tiles, "selected-tileset");
    for (const slotName of ["backgroundFar", "backgroundMid", "backgroundNear"]) delete manifest.assets[slotName];
    const layers = background?.layers?.length ? background.layers : background ? [{ key: "far", path: background.path, speed: 0.16 }] : [];
    const layerSlots = ["backgroundFar", "backgroundMid", "backgroundNear"];
    layers.slice(0, 3).forEach((layer, index) => {
      manifest.assets[layerSlots[index]] = { key: `selected-background-${index}`, path: layer.path, type: "image", frameSize: layer.frameSize || background.frameSize || { width: 256, height: 256 }, pixelArt: background.pixelArt, parallaxSpeed: layer.speed, singleImage: layers.length === 1 };
    });
    const ids = new Set(enemySet?.enemyIds || []);
    manifest.enemies = (manifest.enemies || []).filter((enemy) => ids.has(enemy.id)).map((enemy, index) => ({ ...enemy, key: `selected-enemy-${index}`, type: "spritesheet" }));
    // Load sheets as ordinary images first. Some browsers/dev caches can briefly
    // expose a zero-sized image to Phaser's spritesheet parser; registering the
    // frames only after checking the decoded image avoids Phaser's zero-frame
    // warning and lets the game use its generated fallback art instead.
    const pendingSheets = [];
    for (const [slot, sound] of Object.entries(manifest.sounds || {})) {
      const assetSlot = slot === "music" ? "music" : `sfx${slot[0].toUpperCase()}${slot.slice(1)}`;
      manifest.assets[assetSlot] = { ...sound, key: `audio-${slot}`, type: "audio" };
    }
    this.load.json("stage1", "/levels/stage1.json");
    const loading = document.createElement("div");
    loading.className = "asset-loading";
    loading.setAttribute("role", "status");
    const label = document.createElement("span"); label.textContent = "Loading selected world…";
    const track = document.createElement("div"); track.className = "asset-loading-track";
    const bar = document.createElement("div"); bar.className = "asset-loading-bar"; track.append(bar);
    loading.append(label, track); document.getElementById("game-root")?.append(loading);
    this.load.on("progress", (value) => { bar.style.width = `${Math.round(value * 100)}%`; });
    this.load.on("loaderror", (file) => console.warn("Optional art failed to load; placeholder graphics will be used:", file.src));
    this.load.once("complete", () => {
      for (const { asset, rawKey } of pendingSheets) {
        if (!this.textures.exists(rawKey)) {
          console.warn(`[Starbound Run] Sprite sheet unavailable; using placeholder: ${asset.key} (${asset.path})`);
          continue;
        }
        const image = this.textures.get(rawKey).getSourceImage();
        const width = image?.naturalWidth || image?.width || 0;
        const height = image?.naturalHeight || image?.height || 0;
        const frameWidth = Math.floor(Number(asset.frameSize?.width) || 0);
        const frameHeight = Math.floor(Number(asset.frameSize?.height) || 0);
        const columns = frameWidth ? Math.floor(width / frameWidth) : 0;
        const rows = frameHeight ? Math.floor(height / frameHeight) : 0;
        const actualFrames = columns * rows;
        const expectedFrames = Number(asset.frameCount) || actualFrames;
        console.info(`[Starbound Run] ${asset.key}: image ${width}x${height}, frame ${frameWidth}x${frameHeight}, ${actualFrames} frames (manifest expects ${expectedFrames})`);
        if (!width || !height || !frameWidth || !frameHeight || !actualFrames) {
          console.warn(`[Starbound Run] Invalid sprite sheet; using placeholder: ${asset.key} (image ${width}x${height}, frame ${frameWidth}x${frameHeight})`);
          continue;
        }
        if (actualFrames !== expectedFrames) {
          console.warn(`[Starbound Run] Sprite sheet frame count mismatch: ${asset.key}, expected ${expectedFrames}, actual ${actualFrames}. Animations will be clamped.`);
        }
        try {
          this.textures.addSpriteSheet(asset.key, image, { frameWidth, frameHeight, endFrame: actualFrames - 1 });
          asset.frameCount = actualFrames;
          for (const animation of Object.values(asset.animations || {})) animation.end = Math.min(Number(animation.end) || 0, actualFrames - 1);
        } catch (error) {
          console.warn(`[Starbound Run] Could not register sprite sheet; using placeholder: ${asset.key}`, error);
        }
      }
      loading.remove();
      const assets = [...Object.values(manifest.assets), ...(manifest.enemies || [])];
      for (const asset of assets) {
        if (!asset?.key || !this.textures.exists(asset.key) || !this.textures.get(asset.key).setFilter) continue;
        const pixelArt = Boolean(asset.pixelArt ?? manifest.rendering?.pixelArt);
        this.textures.get(asset.key).setFilter(pixelArt ? Phaser.Textures.FilterMode.NEAREST : Phaser.Textures.FilterMode.LINEAR);
      }
      this.scene.start("GameScene", { ...launchData, manifest });
    });
    for (const asset of [...Object.values(manifest.assets), ...(manifest.enemies || [])]) {
      if (!asset?.key || !asset.path) continue;
      if (asset.type === "spritesheet" && asset.frameSize?.width && asset.frameSize?.height) {
        const rawKey = `__sheet-image-${asset.key}`;
        pendingSheets.push({ asset, rawKey });
        this.load.image(rawKey, asset.path);
      }
      else if (asset.type === "image" || asset.type === "nine-slice") this.load.image(asset.key, asset.path);
      else if (asset.type === "audio") this.load.audio(asset.key, asset.path);
    }
  }
}
