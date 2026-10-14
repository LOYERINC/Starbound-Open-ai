import { TILE, setDisplayTileSize, buildLevel, createEnemySpawnPlan, setCheckpointActive, setGateOpenArt } from "../level.js";
import { GameUI } from "../ui.js";
import { gameEvents } from "../events.js";
import { DEFAULT_TUNING } from "../tuning.js";
import { GameAudio } from "../audio.js";

export class GameScene extends Phaser.Scene {
  constructor() { super("GameScene"); }

  init(data) { this.launchData = data || {}; }

  create() {
    this.level = this.cache.json.get("stage1");
    if (Number.isFinite(Number(this.launchData.levelSeed))) this.level.enemySeed = Number(this.launchData.levelSeed);
    this.assetManifest = this.launchData.manifest || null;
    const selectedTileset = this.assetManifest?.tilesets?.find((item) => item.id === this.launchData.settings?.tilesetId) || this.assetManifest?.tilesets?.find((item) => item.id === "grass") || this.assetManifest?.assets?.tileset;
    this.tileProfile = selectedTileset || { tileSize: this.assetManifest?.tileSize || 64, displayTileSize: this.assetManifest?.displayTileSize || 48, pixelArt: this.assetManifest?.rendering?.pixelArt };
    setDisplayTileSize(this.tileProfile.displayTileSize || 48);
    this.level.tileSize = this.tileProfile.tileSize || this.level.tileSize || 64;
    this.level.displayTileSize = TILE;
    this.pixelArt = Boolean(this.tileProfile.pixelArt ?? this.assetManifest?.rendering?.pixelArt);
    this.avatar = this.launchData.avatar || { color: "#4da3ff", accessory: "none" };
    this.audio = new GameAudio(this, this.assetManifest, this.launchData.muted, (muted) => this.launchData.onMuteChange?.(muted));
    this.ui = new GameUI(this, {
      manifest: this.assetManifest,
      muted: this.audio.muted,
      onMuteChange: (muted) => this.audio.setMuted(muted),
    });
    const worldScale = TILE / 64;
    this.tuning = { ...DEFAULT_TUNING, gravity: DEFAULT_TUNING.gravity * worldScale,
      jumpVelocity: DEFAULT_TUNING.jumpVelocity * Math.sqrt(worldScale), runSpeed: DEFAULT_TUNING.runSpeed * worldScale };
    this.physics.world.gravity.y = this.tuning.gravity;
    this.ui.setupTuning(this.tuning, (key, value) => this.setTuning(key, value));
    this.questions = Array.isArray(this.launchData.questions) ? this.launchData.questions : [];
    this.network = this.launchData.network || null;
    this.onlineRoom = Boolean(this.launchData.onlineRoom && this.network);
    if (this.onlineRoom) this.network.bindGameEvents(gameEvents);
    this.questionPool = []; this.currentQuestion = null; this.questionPurpose = null; this.wrongAnswers = 0;
    const resume = this.launchData.resumeState || {};
    this.timeElapsed = 0; this.hearts = this.onlineRoom && Number.isFinite(resume.lives) ? resume.lives : 3; this.checkpointX = this.level.spawn.x * TILE + TILE / 2;
    this.checkpointY = (this.level.spawn.y + 1) * TILE;
    if (this.onlineRoom && Number(resume.checkpointX) > 0) {
      const checkpointTile = Math.round(Number(resume.checkpointX) / TILE - .5);
      const row = this.level.rows.findIndex((line) => line[checkpointTile] === "C");
      if (row >= 0) { this.checkpointX = Number(resume.checkpointX); this.checkpointY = (row + 1) * TILE; }
    }
    this.ui.setHearts(this.hearts);
    this.invulnerableUntil = 0;
    this.gateOpen = new Set(); this.finished = false; this.isPausedByPanel = false;
    this.paintBackdrop();
    this.createPlayerAnimations();
    this.objects = buildLevel(this, this.level);
    this.player = this.createPlayer(this.checkpointX, this.checkpointY);
    this.physics.add.collider(this.player, this.objects.solid);
    this.physics.add.collider(this.player, this.objects.gates, (_player, gate) => this.reachGate(gate));
    this.createEnemies();
    this.physics.add.overlap(this.player, this.objects.hazards, () => this.takeDamage("spike"));
    this.physics.add.overlap(this.player, this.objects.checkpoints, (_p, flag) => this.setCheckpoint(flag));
    this.physics.add.overlap(this.player, this.objects.finish, () => this.finishLevel());
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys("W,A,S,D,SPACE");
    this.debugKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.BACKTICK);
    this.physicsDebugKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F2);
    this.physics.world.debugGraphic = this.add.graphics().setDepth(10000);
    this.physics.world.debugGraphic.setVisible(false);
    this.physics.world.drawDebug = false;
    const mapWidth = this.level.width * TILE; const mapHeight = this.level.height * TILE;
    this.physics.world.setBounds(0, 0, mapWidth, mapHeight + TILE * 4);
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
    this.cameras.main.startFollow(this.player, true, .12, .1);
    this.cameras.main.setDeadzone(190, 100);
    this.fitCamera(this.scale.width, this.scale.height);
    this.resizeParallax(this.scale.width, this.scale.height);
    this.logAssetScales();
    this.scale.on("resize", this.handleResize, this);
    this.events.once("shutdown", () => { this.ui.destroy(); this.scale.off("resize", this.handleResize, this); });
    if (this.onlineRoom) {
      this.networkMessageHandler = (event) => this.handleRoomMessage(event.detail);
      this.network.addEventListener("message", this.networkMessageHandler);
      this.events.once("shutdown", () => this.network.removeEventListener("message", this.networkMessageHandler));
    }
  }

  paintBackdrop() {
    const fallbackBg = this.add.graphics().setScrollFactor(0).setDepth(-10);
    fallbackBg.fillGradientStyle(0x77cfee, 0x77cfee, 0xe4f7ff, 0xe4f7ff, 1).fillRect(0, 0, this.level.width * TILE + 1200, this.level.height * TILE + 600);
    for (let i = 0; i < 8; i += 1) {
      const x = 100 + i * 215; const y = 155 + (i % 3) * 54;
      fallbackBg.fillStyle(0xffffff, .5).fillCircle(x, y, 27).fillCircle(x + 28, y - 9, 35).fillCircle(x + 61, y, 26);
    }
    const fallbackHills = this.add.graphics().setScrollFactor(.25).setDepth(-5);
    fallbackHills.fillStyle(0x7dc9bb, .75);
    for (let x = 0; x < this.level.width * TILE + 600; x += TILE * 4.4) fallbackHills.fillEllipse(x, this.level.height * TILE * .7, TILE * 6.1, TILE * 2.75);
    this.parallaxLayers = [];
    for (const slotName of ["backgroundFar", "backgroundMid", "backgroundNear"]) {
      const slot = this.assetManifest?.assets?.[slotName];
      if (!slot?.key || !this.textures.exists(slot.key)) continue;
      const layer = slot.singleImage
        ? this.add.image(0, 0, slot.key).setOrigin(0).setScrollFactor(0).setDepth(-4 + this.parallaxLayers.length)
        : this.add.tileSprite(0, 0, this.scale.width, this.scale.height, slot.key).setOrigin(0).setScrollFactor(0).setDepth(-4 + this.parallaxLayers.length);
      layer.parallaxSpeed = Number(slot.parallaxSpeed) || 0;
      layer.assetSlot = slot;
      layer.singleImage = Boolean(slot.singleImage);
      this.parallaxLayers.push(layer);
    }
    // Generated scenery is only for missing-art mode. It must not peek out
    // at the edge of a selected pack background when the camera scrolls.
    if (this.parallaxLayers.length) { fallbackBg.destroy(); fallbackHills.destroy(); }
  }

  resizeParallax(width, height) {
    const zoom = this.cameras?.main?.zoom || 1;
    const worldWidth = width / zoom;
    const worldHeight = height / zoom;
    for (const layer of this.parallaxLayers || []) {
      const source = layer.texture.getSourceImage();
      const sourceWidth = source?.naturalWidth || source?.width || layer.assetSlot?.frameSize?.width || 256;
      const sourceHeight = source?.naturalHeight || source?.height || layer.assetSlot?.frameSize?.height || 256;
      let coverScale = Math.max(worldWidth / Math.max(1, sourceWidth), worldHeight / Math.max(1, sourceHeight));
      if (coverScale > 1) coverScale = Math.ceil(coverScale);
      if (layer.singleImage) {
        layer.setScale(coverScale);
        layer.baseX = (worldWidth - sourceWidth * coverScale) / 2;
        layer.baseY = (worldHeight - sourceHeight * coverScale) / 2;
        layer.setPosition(layer.baseX, layer.baseY);
      } else {
        layer.setPosition(0, 0).setSize(worldWidth, worldHeight);
        layer.tileScaleX = coverScale;
        layer.tileScaleY = coverScale;
      }
      layer.viewportWorldWidth = worldWidth;
      layer.viewportWorldHeight = worldHeight;
      layer.displayWorldWidth = sourceWidth * coverScale;
      layer.assetDisplay = { native: `${sourceWidth}x${sourceHeight}`, displayed: `${Math.round(sourceWidth * coverScale)}x${Math.round(sourceHeight * coverScale)}`, scale: coverScale };
    }
  }

  fitCamera(width, height) {
    if (!this.cameras?.main) return;
    const targetVerticalTiles = window.matchMedia?.("(orientation: portrait)").matches ? 11 : 11.5;
    const zoom = Phaser.Math.Clamp(height / (targetVerticalTiles * TILE), .5, 3);
    this.cameras.main.setZoom(zoom);
  }

  logAssetScales() {
    const rows = [];
    const add = (name, gameObject, info = {}) => {
      if (!gameObject?.texture) return;
      const source = gameObject.texture.getSourceImage?.();
      const nativeWidth = info.frameSize?.width || source?.naturalWidth || source?.width || 0;
      const nativeHeight = info.frameSize?.height || source?.naturalHeight || source?.height || 0;
      const scaleX = gameObject.scaleX ?? 1; const scaleY = gameObject.scaleY ?? 1;
      rows.push({ asset: name, native: `${nativeWidth}×${nativeHeight}`, display: `${Math.round(nativeWidth * scaleX)}×${Math.round(nativeHeight * scaleY)}`, scale: `${scaleX.toFixed(2)}×${scaleY.toFixed(2)}` });
    };
    add("hero", this.player, this.assetManifest?.assets?.player);
    const tileset = this.assetManifest?.tilesets?.find((item) => item.id === this.launchData.settings?.tilesetId) || this.assetManifest?.assets?.tileset;
    rows.push({ asset: "tileset", native: `${tileset?.tileSize || TILE}×${tileset?.tileSize || TILE}`, display: `${TILE}×${TILE}`, scale: `${(TILE / (tileset?.tileSize || TILE)).toFixed(2)}×${(TILE / (tileset?.tileSize || TILE)).toFixed(2)}` });
    const reportedSlots = new Set(["player", "tileset", "backgroundFar", "backgroundMid", "backgroundNear"]);
    for (const [slotName, slot] of Object.entries(this.assetManifest?.assets || {})) {
      if (reportedSlots.has(slotName) || !slot?.key || !this.textures.exists(slot.key) || slot.type === "audio") continue;
      const texture = this.textures.get(slot.key);
      add(slotName, { texture, scaleX: 1, scaleY: 1 }, slot);
    }
    for (const [index, layer] of (this.parallaxLayers || []).entries()) rows.push({ asset: `background-${index + 1}`, native: layer.assetDisplay?.native, display: layer.assetDisplay?.displayed, scale: layer.assetDisplay?.scale?.toFixed(2) });
    for (const [index, enemy] of (this.enemies || []).entries()) add(`enemy-${index + 1}`, enemy, { frameSize: enemy.frameSize });
    console.info(`[Starbound Run] tile ${this.level.tileSize}px native → ${TILE}px world; max jump ${(this.tuning.jumpVelocity ** 2 / (2 * this.tuning.gravity) / TILE).toFixed(2)} tiles`);
    if (rows.length) console.table(rows);
  }

  createPlayerAnimations() {
    const slots = ["player", "accessoryCap", "accessoryCrown", "accessoryStarband"];
    for (const slotName of slots) {
      const slot = this.assetManifest?.assets?.[slotName];
      if (!slot?.key || !this.textures.exists(slot.key)) continue;
      const texture = this.textures.get(slot.key);
      const maxFrame = Math.min(Number(slot.frameCount || Infinity) - 1, texture.frameTotal - 1);
      for (const [name, definition] of Object.entries(slot.animations || {})) {
        const key = `${slot.key}-${name}`;
        const start = Math.max(0, Number(definition.start) || 0);
        const end = Math.min(Number(definition.end), maxFrame);
        const frames = [];
        for (let frame = start; frame <= end; frame += 1) if (texture.frames[String(frame)]) frames.push({ key: slot.key, frame });
        if (!frames.length) continue;
        if (!this.anims.exists(key)) this.anims.create({ key, frames, frameRate: definition.frameRate || 6, repeat: definition.repeat ?? -1 });
      }
    }
  }

  createPlayer(x, y) {
    const slot = this.assetManifest?.assets?.player;
    const hasArt = slot?.key && this.textures.exists(slot.key);
    const fallback = this.ensureFallbackTexture("fallback-player");
    const key = hasArt ? slot.key : fallback.key;
    const player = this.physics.add.sprite(x, y, key, 0).setOrigin(.5, 1);
    const hitbox = hasArt ? (slot.hitbox || { width: 81, height: 97, offsetX: 23.5, offsetY: 31 }) : fallback.hitbox;
    const displayHitbox = slot?.displayHitbox || { width: TILE * .82, height: TILE * .88 };
    const frameWidth = hasArt ? slot.frameSize.width : 64;
    const frameHeight = hasArt ? slot.frameSize.height : 64;
    const baseScale = displayHitbox.height / Math.max(1, hitbox.height);
    const scale = baseScale * (Number(slot?.scale) || 1);
    player.setScale(scale);
    const bodyHitbox = slot?.hitbox || hitbox;
    player.body.setSize(bodyHitbox.width, bodyHitbox.height).setOffset(bodyHitbox.offsetX, bodyHitbox.offsetY).setCollideWorldBounds(true);
    const scaleX = scale; const scaleY = scale;
    this.playerArtInfo = { hitbox, frameWidth, frameHeight, feet: hasArt ? slot.feet : { x: 32, y: 64 }, scaleX, scaleY };
    this.playerSprite = player;
    let tint = 0xffffff; try { tint = Phaser.Display.Color.HexStringToColor(this.avatar.color).color; } catch { /* default tint */ }
    player.setTint(tint);
    if (hasArt) {
      const idleAnimation = this.anims.exists(`${key}-idle`) ? `${key}-idle` : `${key}-run`;
      if (this.anims.exists(idleAnimation)) player.play(idleAnimation);
    }
    this.positionActorAtFeet(player, this.playerArtInfo, x, y);
    const accessorySlot = { cap: "accessoryCap", crown: "accessoryCrown", starband: "accessoryStarband" }[this.avatar.accessory];
    const accessoryKey = accessorySlot && this.assetManifest?.assets?.[accessorySlot]?.key;
    if (accessoryKey && this.textures.exists(accessoryKey)) {
      this.accessorySprite = this.add.sprite(player.x, player.y, accessoryKey, 0).setOrigin(.5, 1).setScale(scaleX, scaleY); this.accessorySprite.play(`${accessoryKey}-idle`);
    } else if (this.avatar.accessory !== "none") {
      this.accessoryHat = this.add.graphics().setDepth(4);
      this.accessoryHat.fillStyle(this.avatar.accessory === "crown" ? 0xffd34e : this.avatar.accessory === "starband" ? 0xf5d35c : 0x68d5f2, 1);
      if (this.avatar.accessory === "crown") this.accessoryHat.fillTriangle(-12, -55, -7, -66, 0, -54).fillTriangle(0, -54, 6, -67, 12, -53).fillRoundedRect(-13, -55, 26, 5, 2);
      else this.accessoryHat.fillRoundedRect(-13, -58, 26, 7, 3);
    }
    player.body.setMaxVelocity(420, 1200); player.body.setDragX(1800);
    return player;
  }

  ensureFallbackTexture(key) {
    if (this.textures.exists(key)) return { key, hitbox: key === "fallback-player" ? { width: 40, height: 56, offsetX: 12, offsetY: 8 } : { width: 44, height: 48, offsetX: 10, offsetY: 16 } };
    const graphics = this.make.graphics({ x: 0, y: 0, add: false });
    if (key === "fallback-player") {
      let tint = 0x4da3ff; try { tint = Phaser.Display.Color.HexStringToColor(this.avatar.color).color; } catch { /* default */ }
      graphics.fillStyle(tint).fillRoundedRect(12, 23, 40, 41, 11).fillStyle(0xffd29b).fillCircle(32, 20, 17).fillStyle(0x253a59).fillCircle(39, 19, 3);
      graphics.fillStyle(0xffefb8).fillRoundedRect(9, 57, 22, 7, 3).fillRoundedRect(33, 57, 22, 7, 3);
    } else graphics.fillStyle(0xe36b56).fillRoundedRect(10, 16, 44, 48, 13).fillStyle(0xffd76e).fillCircle(23, 31, 3).fillCircle(41, 31, 3);
    graphics.generateTexture(key, 64, 64); graphics.destroy();
    return { key, hitbox: key === "fallback-player" ? { width: 40, height: 56, offsetX: 12, offsetY: 8 } : { width: 44, height: 48, offsetX: 10, offsetY: 16 } };
  }

  positionPlayerAtFeet(x, feetY) {
    const info = this.playerArtInfo;
    if (!info) { this.player.setPosition(x, feetY); return; }
    this.player.setPosition(
      x + (info.frameWidth / 2 - info.feet.x) * info.scaleX,
      feetY + (info.frameHeight - info.feet.y) * info.scaleY,
    );
  }

  update(_time, delta) {
    if (!this.player?.body) return;
    if (!this.finished) this.timeElapsed += delta / 1000;
    this.ui.setTime(this.timeElapsed);
    if (this.onlineRoom && this.time.now - (this.lastProgressSent || 0) >= 500) {
      this.lastProgressSent = this.time.now;
      gameEvents.emit("progress", { x: this.player.x });
    }
    this.updateEnemies(delta);
    if (Phaser.Input.Keyboard.JustDown(this.debugKey)) this.ui.toggleDebug();
    if (Phaser.Input.Keyboard.JustDown(this.physicsDebugKey)) {
      this.physics.world.drawDebug = !this.physics.world.drawDebug;
      this.physics.world.debugGraphic.setVisible(this.physics.world.drawDebug);
      this.physics.world.debugGraphic.clear();
    }
    if (this.accessorySprite?.active) this.accessorySprite.setPosition(this.player.x, this.player.y).setFlipX(this.player.flipX);
    if (this.accessoryHat?.active) this.accessoryHat.setPosition(this.player.x, this.player.y);
    if (this.isPausedByPanel || this.finished || this.hearts <= 0) { this.player.body.setVelocity(0, 0); this.player.body.setAcceleration(0, 0); return; }
    const body = this.player.body;
    const left = this.cursors.left.isDown || this.keys.A.isDown || this.ui.controls.left;
    const right = this.cursors.right.isDown || this.keys.D.isDown || this.ui.controls.right;
    if (left === right) body.setAccelerationX(0);
    else { body.setAccelerationX(left ? -2200 : 2200); this.player.setFlipX(left); }
    body.setMaxVelocity(this.tuning.runSpeed, 1200);
    const grounded = body.blocked.down || body.touching.down;
    if (grounded) this.lastGroundedAt = this.time.now;
    const jumpDown = this.cursors.up.isDown || this.keys.W.isDown || this.keys.SPACE.isDown || this.ui.controls.jump;
    const jumpJustPressed = Phaser.Input.Keyboard.JustDown(this.cursors.up) || Phaser.Input.Keyboard.JustDown(this.keys.W) || Phaser.Input.Keyboard.JustDown(this.keys.SPACE) || (jumpDown && !this.previousTouchJump);
    if (jumpJustPressed && (grounded || this.time.now - (this.lastGroundedAt ?? -Infinity) <= this.tuning.coyoteTime)) {
      body.setVelocityY(-this.tuning.jumpVelocity); this.lastGroundedAt = -Infinity;
      this.audio.play("jump");
    }
    if (!jumpDown && body.velocity.y < -100) body.setVelocityY(body.velocity.y * .55);
    this.previousTouchJump = this.ui.controls.jump;
    for (const layer of this.parallaxLayers || []) {
      if (layer.singleImage) {
        const overflow = Math.max(0, layer.displayWorldWidth - layer.viewportWorldWidth);
        // The image starts centered, so it can pan only half its total excess
        // width before its far edge reaches the viewport edge.
        const offset = Phaser.Math.Clamp(this.cameras.main.scrollX * layer.parallaxSpeed, 0, overflow / 2);
        layer.x = layer.baseX - offset;
      } else layer.tilePositionX = this.cameras.main.scrollX * layer.parallaxSpeed;
    }
    this.updatePlayerAnimation(grounded);
    if (this.player.y > this.level.height * TILE + TILE * .5) this.takeDamage("pit");
  }

  createEnemies() {
    const enemyTypes = this.assetManifest?.enemies || [];
    for (const entry of enemyTypes) {
      if (!entry.key || !this.textures.exists(entry.key)) continue;
      this.createSafeAnimations(entry);
    }
    this.enemies = [];
    const plan = createEnemySpawnPlan(this.level, enemyTypes);
    for (const spawn of plan) {
      const entry = spawn.type;
      const flying = entry.behavior === "flying";
      // The Kenney block is a mobile enemy, even if an older cached manifest
      // still labels it stationary.
      const isBlockEnemy = /block/i.test(`${entry.id || ""} ${entry.name || ""}`);
      const stationary = entry.behavior === "stationary" && !isBlockEnemy;
      const behavior = isBlockEnemy ? "patrol" : (entry.behavior || "patrol");
      let hitbox = entry.hitbox;
      let frameSize = entry.frameSize;
      let key = entry.key;
      if (!key || !this.textures.exists(key)) {
        const fallback = this.ensureFallbackTexture("fallback-enemy");
        key = fallback.key; hitbox = fallback.hitbox; frameSize = { width: 64, height: 64 };
      }
      const scale = (Number(entry.displayHeight) || TILE * .82) / Math.max(1, hitbox?.height || 48) * (Number(entry.scale) || 1);
      const enemy = this.physics.add.sprite(spawn.x, spawn.y, key, 0).setOrigin(.5, 1).setScale(scale);
      enemy.body.setSize(hitbox?.width || 44, hitbox?.height || 48).setOffset(hitbox?.offsetX || 0, hitbox?.offsetY || 0).setCollideWorldBounds(true);
      enemy.body.setAllowGravity(!flying && !stationary);
      if (!flying && !stationary) this.physics.add.collider(enemy, this.objects.solid);
      enemy.direction = spawn.band % 2 ? -1 : 1;
      enemy.setFlipX(enemy.direction < 0);
      enemy.behavior = behavior;
      enemy.baseY = spawn.y; enemy.phase = spawn.band * .8; enemy.hitbox = hitbox; enemy.frameSize = frameSize;
      enemy.feetInfo = { feet: entry.feet || { x: frameSize.width / 2, y: frameSize.height }, scaleX: scale, scaleY: scale, frameWidth: frameSize.width, frameHeight: frameSize.height };
      this.positionActorAtFeet(enemy, enemy.feetInfo, spawn.x, spawn.y);
      enemy.spawnX = spawn.x;
      enemy.patrolSpeed = 115 + spawn.band * 9;
      enemy.body.setVelocityX(stationary || flying ? 0 : enemy.direction * enemy.patrolSpeed);
      const preferredAnimation = stationary ? "idle" : "run";
      const animation = `${key}-${this.anims.exists(`${key}-${preferredAnimation}`) ? preferredAnimation : "idle"}`;
      if (this.anims.exists(animation)) enemy.play(animation);
      console.debug(`[Starbound Run] Enemy ${entry.id}: ${enemy.behavior}, ${stationary || flying ? "still" : `${enemy.patrolSpeed}px/s`}, animation=${animation}`);
      this.physics.add.overlap(this.player, enemy, (_player, overlappedEnemy) => this.hitEnemy(overlappedEnemy));
      this.enemies.push(enemy);
    }
  }

  updateEnemies() {
    if (!this.enemies) return;
    for (const enemy of this.enemies) {
      if (!enemy.active || !enemy.body || this.isPausedByPanel) continue;
      if (enemy.behavior === "flying") {
        this.positionActorAtFeet(enemy, enemy.feetInfo, enemy.spawnX, enemy.baseY + Math.sin(this.time.now / 380 + enemy.phase) * TILE * .52);
      } else if (enemy.behavior === "patrol") {
        const aheadX = Math.floor((enemy.x + enemy.direction * (enemy.body.width / 2 + 3)) / TILE);
        const footY = Math.floor((enemy.body.bottom + 2) / TILE);
        const wallY = Math.floor((enemy.body.center.y - enemy.body.height / 2 + 2) / TILE);
        const hasGroundAhead = this.level.rows[footY]?.[aheadX] === "#";
        const hasWallAhead = this.level.rows[wallY]?.[aheadX] === "#";
        if (enemy.body.blocked.left || enemy.body.blocked.right || !hasGroundAhead || hasWallAhead) {
          enemy.direction *= -1;
          enemy.setFlipX(enemy.direction < 0);
        }
        // Reassert motion each update so a collision or an old stopped body
        // cannot leave a patrol frozen at its spawn point.
        enemy.body.setVelocityX(enemy.direction * enemy.patrolSpeed);
      }
    }
  }

  hitEnemy(enemy) {
    if (!enemy?.active || enemy.getData("killed") || this.time.now < this.invulnerableUntil) return;
    const playerBody = this.player.body;
    if (playerBody.velocity.y > 80 && playerBody.bottom <= enemy.body.top + 18) {
      this.killEnemy(enemy); playerBody.setVelocityY(-this.tuning.jumpVelocity * .48);
    } else this.takeDamage("enemy");
  }

  killEnemy(enemy) {
    if (!enemy?.active || enemy.getData("killed")) return;
    enemy.setData("killed", true);
    if (enemy.body) { enemy.body.enable = false; enemy.body.setVelocity(0, 0); }
    this.tweens.add({ targets: enemy, scaleY: .08, alpha: .45, duration: 150, ease: "Quad.easeIn", onComplete: () => enemy.destroy() });
  }

  createSafeAnimations(entry) {
    const texture = this.textures.get(entry.key);
    const maxFrame = Math.min(Number(entry.frameCount || Infinity) - 1, texture.frameTotal - 1);
    for (const [state, definition] of Object.entries(entry.animations || {})) {
      const key = `${entry.key}-${state}`;
      const start = Math.max(0, Number(definition.start) || 0);
      const end = Math.min(Number(definition.end), maxFrame);
      const frames = [];
      for (let frame = start; frame <= end; frame += 1) if (texture.frames[String(frame)]) frames.push({ key: entry.key, frame });
      if (!frames.length) continue;
      if (!this.anims.exists(key)) this.anims.create({ key, frames, frameRate: definition.frameRate || 6, repeat: definition.repeat ?? -1 });
    }
  }

  positionActorAtFeet(actor, info, x, feetY) {
    actor.setPosition(
      x + (info.frameWidth / 2 - info.feet.x) * info.scaleX,
      feetY + (info.frameHeight - info.feet.y) * info.scaleY,
    );
  }

  updatePlayerAnimation(grounded) {
    const key = this.playerSprite?.texture?.key;
    if (!key || !this.playerSprite.play) return;
    let state = this.time.now < (this.hurtUntil || 0) ? "hurt" : !grounded ? (this.player.body.velocity.y < 0 ? "jump" : "fall") : Math.abs(this.player.body.velocity.x) > 25 ? "run" : "idle";
    for (const sprite of [this.playerSprite, this.accessorySprite]) {
      if (!sprite?.play) continue;
      const animKey = `${sprite.texture.key}-${state}`;
      if (this.anims.exists(animKey) && sprite.anims.currentAnim?.key !== animKey) sprite.play(animKey, true);
    }
  }

  setTuning(key, value) {
    this.tuning[key] = value;
    if (key === "gravity") this.physics.world.gravity.y = value;
  }

  clearKeyboardState() {
    this.input.keyboard.resetKeys();
    for (const key of [this.cursors.left, this.cursors.right, this.cursors.up, this.cursors.down, ...Object.values(this.keys), this.debugKey]) key.reset();
  }

  setCheckpoint(flag) {
    const id = flag.getData("id");
    if (this.activeCheckpoint === id) return;
    const old = this.objects.checkpoints.getChildren().find((item) => item.getData("id") === this.activeCheckpoint);
    if (old) setCheckpointActive(this, old, false);
    this.activeCheckpoint = id; this.checkpointX = flag.x; this.checkpointY = flag.getData("respawnY");
    setCheckpointActive(this, flag, true); this.audio.play("checkpoint");
    gameEvents.emit("checkpointReached", { checkpointId: id, x: this.checkpointX, y: this.checkpointY });
  }

  reachGate(gate) {
    const id = gate.getData("id");
    if (this.gateOpen.has(id) || this.isPausedByPanel || this.finished) return;
    gameEvents.emit("gateReached", { gateId: id });
    this.presentQuestion("gate", gate);
  }

  takeDamage(reason) {
    if (this.time.now < this.invulnerableUntil || this.hearts <= 0 || this.finished) return;
    if (this.onlineRoom) {
      this.invulnerableUntil = this.time.now + 1400; this.hurtUntil = this.time.now + 450; this.audio.play("hurt");
      gameEvents.emit("damageTaken", { reason, heartsRemaining: this.hearts - 1 });
      gameEvents.emit("died", { reason, x: this.player.x });
      this.positionPlayerAtFeet(this.checkpointX, this.checkpointY); this.player.body.setVelocity(0, 0);
      return;
    }
    this.hearts -= 1; this.ui.setHearts(this.hearts); this.invulnerableUntil = this.time.now + 1400; this.hurtUntil = this.time.now + 450; this.audio.play("hurt");
    gameEvents.emit("damageTaken", { reason, heartsRemaining: this.hearts });
    if (this.hearts <= 0) {
      this.presentQuestion("revive");
    } else {
      this.positionPlayerAtFeet(this.checkpointX, this.checkpointY); this.player.body.setVelocity(0, 0);
    }
  }

  finishLevel() {
    if (this.finished) return;
    this.finished = true; this.player.body.setVelocity(0, 0); this.player.body.setAllowGravity(false);
    this.audio.play("finish");
    if (this.onlineRoom) gameEvents.emit("progress", { x: this.player.x, force: true });
    gameEvents.emit("finished", { time: this.timeElapsed, x: this.player.x });
    if (this.onlineRoom) {
      this.showOnlineWaiting(false);
      return;
    }
    this.ui.showFinish(this.ui.timer.textContent, this.wrongAnswers,
      () => this.scene.restart(this.launchData),
      () => {
        const onBackToMenu = this.launchData.onBackToMenu;
        this.game.destroy(true);
        onBackToMenu?.();
      });
  }

  presentQuestion(mode, gate = null) {
    if (this.onlineRoom && mode === "gate") { this.presentRoomQuestion(gate); return; }
    if (!this.questions.length) {
      this.isPausedByPanel = true;
      this.lockMovementForPanel();
      this.ui.showPanel("No questions loaded", "Add at least three questions from the menu to play.", "Back to menu", () => {
        const onBackToMenu = this.launchData.onBackToMenu; this.game.destroy(true); onBackToMenu?.();
      });
      return;
    }
    if (!this.questionPool.length) {
      this.questionPool = [...this.questions];
      for (let i = this.questionPool.length - 1; i > 0; i -= 1) {
        const j = Phaser.Math.Between(0, i);
        [this.questionPool[i], this.questionPool[j]] = [this.questionPool[j], this.questionPool[i]];
      }
    }
    this.currentQuestion = this.questionPool.shift();
    this.questionPurpose = { mode, gate };
    this.lockMovementForPanel();
    const correctIndex = this.currentQuestion.answer.charCodeAt(0) - 65;
    const options = this.currentQuestion.options.map((text, index) => ({ text, correct: index === correctIndex }));
    for (let i = options.length - 1; i > 0; i -= 1) {
      const j = Phaser.Math.Between(0, i);
      [options[i], options[j]] = [options[j], options[i]];
    }
    this.ui.showQuestion(this.currentQuestion, options, mode, ({ correct, button }) => this.answerQuestion(correct, button));
  }

  async presentRoomQuestion(gate) {
    this.questionPurpose = { mode: "gate", gate };
    this.lockMovementForPanel();
    try {
      const result = await this.network.request("question_request");
      const question = result.question;
      this.currentQuestion = { ...question };
      const options = question.options.map((text) => ({ text, correct: false }));
      this.ui.showQuestion(question, options, "gate", ({ button, optionIndex }) => {
        if (button.disabled) return;
        button.disabled = true;
        this.network.request("answer", { questionId: question.id, optionIndex }).then((answer) => {
          if (!answer.correct) {
            this.wrongAnswers = answer.wrongAnswers;
            this.audio.play("wrong"); this.ui.lockQuestionAfterWrong(button);
            return;
          }
          this.wrongAnswers = answer.wrongAnswers;
          this.currentQuestion.explanation = answer.explanation || "";
          this.acceptCorrectAnswer();
        }).catch(() => { button.disabled = false; });
      });
    } catch (error) {
      this.ui.showPanel("Room connection lost", error.message, "Retry question", () => this.presentRoomQuestion(gate));
    }
  }

  handleRoomMessage(message) {
    if (message.type === "joined") {
      this.hearts = message.lives; this.ui.setHearts(this.hearts);
      if (Number(message.checkpointX) > 0) {
        const tileX = Math.round(Number(message.checkpointX) / TILE - .5);
        const row = this.level.rows.findIndex((line) => line[tileX] === "C");
        if (row >= 0) { this.checkpointX = Number(message.checkpointX); this.checkpointY = (row + 1) * TILE; }
      }
    } else if (message.type === "room_paused") {
      if (this.waitingOnline) return;
      this.lockMovementForPanel();
      this.ui.showPanel("Teacher reconnecting", "The room is paused while the teacher reconnects.", "Waiting…", () => {});
    } else if (message.type === "room_resumed") {
      if (this.waitingOnline) return;
      this.isPausedByPanel = false; this.input.keyboard.enabled = true; this.player.body.setAllowGravity(true); this.ui.setLocked(false); this.ui.hidePanel();
    } else if (message.type === "room_snapshot") {
      const players = message.room?.players || [];
      this.onlineCounts = { playing: players.filter((p) => p.status === "playing").length, total: players.length };
      if (this.waitingOnline) this.showOnlineWaiting(this.waitingOnline === "eliminated");
    } else if (message.type === "game_end") {
      this.isPausedByPanel = true; this.player.body.setVelocity(0, 0); this.player.body.setAllowGravity(false);
      this.launchData.onLeaderboard?.(message.leaderboard);
    } else if (message.type === "life_update") {
      this.hearts = message.lives; this.ui.setHearts(this.hearts);
      if (message.status === "eliminated") this.showOnlineWaiting(true);
    }
  }

  showOnlineWaiting(eliminated) {
    this.waitingOnline = eliminated ? "eliminated" : "finished";
    this.isPausedByPanel = true;
    this.player.body.setVelocity(0, 0); this.player.body.setAllowGravity(false);
    const stillPlaying = this.onlineCounts?.playing ?? "…"; const total = this.onlineCounts?.total ?? "…";
    const title = eliminated ? "You're out!" : "Finished!";
    const text = eliminated ? `Waiting for others to complete the game… ${stillPlaying} of ${total} students still playing.` : "Waiting for others to complete the game…";
    this.ui.showPanel(title, text, "Waiting…", () => {});
  }

  lockMovementForPanel() {
    this.isPausedByPanel = true;
    this.player.body.setVelocity(0, 0); this.player.body.setAcceleration(0, 0);
    this.player.body.setAllowGravity(false);
    this.previousTouchJump = false; this.ui.setLocked(true); this.clearKeyboardState(); this.input.keyboard.enabled = false;
  }

  answerQuestion(correct, button) {
    if (!this.isPausedByPanel) return;
    if (!correct) {
      this.wrongAnswers += 1;
      this.audio.play("wrong");
      this.ui.lockQuestionAfterWrong(button);
      return;
    }
    this.acceptCorrectAnswer();
  }

  acceptCorrectAnswer() {
    const purpose = this.questionPurpose;
    this.audio.play("correct");
    if (purpose.mode === "gate" && purpose.gate?.active) { setGateOpenArt(this, purpose.gate); this.audio.play("gateOpen"); }
    const feedback = this.currentQuestion.explanation || (purpose.mode === "revive" ? "You are back in the race!" : "The gate is opening!");
    this.ui.showNotice("Correct!", feedback);
    this.time.delayedCall(1300, () => {
      if (purpose.mode === "gate") {
        const gate = purpose.gate;
        const id = gate?.getData("id");
        if (gate && gate.active) { this.gateOpen.add(id); gate.getData("art")?.destroy(); gate.getData("sprite")?.destroy(); gate.destroy(); }
      } else {
        this.hearts = 3; this.ui.setHearts(this.hearts); this.invulnerableUntil = this.time.now + 1400;
        this.positionPlayerAtFeet(this.checkpointX, this.checkpointY); this.player.body.setVelocity(0, 0);
      }
      this.isPausedByPanel = false; this.input.keyboard.enabled = true; this.clearKeyboardState();
      this.player.body.setAllowGravity(true);
      this.previousTouchJump = false; this.ui.setLocked(false); this.ui.hidePanel();
      this.currentQuestion = null; this.questionPurpose = null;
    });
  }

  handleResize(gameSize) {
    this.fitCamera(gameSize.width, gameSize.height);
    this.resizeParallax(gameSize.width, gameSize.height);
  }
}
