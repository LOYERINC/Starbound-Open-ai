export let TILE = 48;

export function setDisplayTileSize(size) {
  TILE = Math.max(16, Math.round(Number(size) || 48));
  return TILE;
}

export function createEnemySpawnPlan(level, enemyTypes = []) {
  const pool = enemyTypes.length ? enemyTypes : [{ id: "fallback", behavior: "patrol" }];
  let seed = (Number(level.enemySeed) || 1) >>> 0;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const safe = [level.spawn?.x || 0, level.finish?.x || level.width - 1, ...(level.gates || [])];
  for (const row of level.rows) for (let x = 0; x < row.length; x += 1) if (row[x] === "C") safe.push(x);
  const plan = []; let lastX = -20;
  const bands = 10;
  for (let band = 0; band < bands; band += 1) {
    const start = Math.floor((band + .18) * level.width / bands);
    const end = Math.floor((band + .82) * level.width / bands);
    for (let tries = 0; tries < 24; tries += 1) {
      const x = start + Math.floor(random() * Math.max(1, end - start));
      const floorRow = level.rows.findIndex((row, y) => y >= 16 && row[x] === "#");
      const tile = level.rows[17]?.[x];
      if (floorRow < 0 || (tile !== " " && tile !== "^") || x - lastX < 8 || safe.some((s) => Math.abs(s - x) < 6)) continue;
      if (level.rows[17]?.[x] === "^") continue;
      const type = pool[Math.floor(random() * pool.length)];
      plan.push({ id: `${level.enemySeed}-${band}`, type, x: x * TILE + TILE / 2, y: floorRow * TILE, band });
      lastX = x; break;
    }
  }
  return plan;
}

export function buildLevel(scene, level) {
  const solid = scene.physics.add.staticGroup();
  const hazards = scene.physics.add.staticGroup();
  const checkpoints = scene.physics.add.staticGroup();
  const gates = scene.physics.add.staticGroup();
  const finish = scene.physics.add.staticGroup();

  level.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const code = row[x];
      if (code === "#") addTile(scene, solid, x, y, "ground", level.rows[y - 1]?.[x] !== "#");
      else if (code === "=") addTile(scene, solid, x, y, "platform");
      else if (code === "^") addTile(scene, hazards, x, y, "spikes");
      else if (code === "C") addMarker(scene, checkpoints, x, y, "checkpoint", String(x));
      else if (code === "G") addGate(scene, gates, x, String(level.gates.indexOf(x)), level.height * TILE);
      else if (code === "F") addMarker(scene, finish, x, y, "finish", "finish");
    }
  });

  return { solid, hazards, checkpoints, gates, finish };
}

function addTile(scene, group, x, y, kind, groundTop = false) {
  const cx = x * TILE + TILE / 2;
  const cy = y * TILE + TILE / 2;
  const body = scene.add.rectangle(cx, cy, TILE, TILE, 0xffffff, 0);
  const artSlot = getTextureSlot(scene, "tileset");
  const frameName = kind === "ground" ? (groundTop ? "groundTop" : "ground") : kind;
  const frame = artSlot?.frameMap?.[frameName];
  if (artSlot && Number.isInteger(frame) && hasTextureFrame(scene, artSlot.key, frame)) {
    scene.add.image(cx, cy, artSlot.key, frame).setDisplaySize(TILE, TILE).setDepth(1);
  } else {
    const shape = scene.add.graphics();
    if (kind === "ground") {
      shape.fillStyle(0x5b9b58, 1).fillRect(cx - TILE / 2, cy - TILE / 2, TILE, TILE);
      shape.fillStyle(0x8bd06c, 1).fillRect(cx - TILE / 2, cy - TILE / 2, TILE, TILE * .22);
      shape.lineStyle(Math.max(1, TILE / 64), 0x386944, .5).strokeRect(cx - TILE / 2, cy - TILE / 2 + TILE * .22, TILE, TILE * .78);
    } else if (kind === "platform") {
      shape.fillStyle(0xc77f4d, 1).fillRoundedRect(cx - TILE / 2, cy - TILE * .22, TILE, TILE * .56, TILE * .125);
      shape.fillStyle(0xffc174, 1).fillRoundedRect(cx - TILE / 2, cy - TILE * .22, TILE, TILE * .19, TILE * .09);
    } else {
      shape.fillStyle(0xff596d, 1);
      shape.fillTriangle(cx - TILE * .47, cy + TILE * .44, cx, cy - TILE * .44, cx + TILE * .47, cy + TILE * .44);
      shape.lineStyle(Math.max(1, TILE * .047), 0xffc2a4, .8).strokeTriangle(cx - TILE * .47, cy + TILE * .44, cx, cy - TILE * .44, cx + TILE * .47, cy + TILE * .44);
    }
    shape.setDepth(1);
  }
  scene.physics.add.existing(body, true);
  group.add(body);
  const visibleArt = artSlot && Number.isInteger(frame) && hasTextureFrame(scene, artSlot.key, frame);
  const surfaceOffset = visibleArt ? Math.max(0, Math.min(TILE - 1, (Number(artSlot.collisionOffsets?.[frameName]) || 0) * TILE / (Number(artSlot.frameSize?.height) || TILE))) : 0;
  if (surfaceOffset && body.body) {
    body.body.setSize(TILE, TILE - surfaceOffset);
    body.body.setOffset(0, surfaceOffset);
    body.body.updateFromGameObject();
  }
  body.setData("kind", kind);
  return body;
}

function addMarker(scene, group, x, y, kind, id) {
  const cx = x * TILE + TILE / 2;
  const cy = y * TILE + TILE / 2;
  const body = scene.add.rectangle(cx, cy, TILE * .5, TILE * 1.25, 0xffffff, 0);
  const slotName = kind === "checkpoint" ? "checkpoint" : "finish";
  const slot = getTextureSlot(scene, slotName);
  let sprite = null; let art = null;
  const hasRequiredFrames = kind === "finish" || (hasTextureFrame(scene, slot?.key, slot?.frameMap?.inactive ?? 0) && hasTextureFrame(scene, slot?.key, slot?.frameMap?.active ?? 1));
  if (slot && hasRequiredFrames) {
    const frame = kind === "checkpoint" ? (slot.frameMap?.inactive ?? 0) : undefined;
    sprite = scene.add.image(cx, cy, slot.key, frame).setDisplaySize(TILE, TILE).setDepth(2);
  } else {
    art = scene.add.graphics().setDepth(2);
    drawMarkerFallback(art, cx, cy, kind, false);
  }
  scene.physics.add.existing(body, true);
  group.add(body);
  body.setData({ kind, id });
  body.setData({ art, sprite, slot: slotName, centerX: cx, centerY: cy, respawnY: (y + 1) * TILE });
  return body;
}

function addGate(scene, group, x, id, mapHeight) {
  const cx = x * TILE + TILE / 2;
  const body = scene.add.rectangle(cx, mapHeight / 2, TILE * .45, mapHeight, 0xffffff, 0);
  const slot = getTextureSlot(scene, "gate");
  let sprite = null; let art = null;
  if (slot && hasTextureFrame(scene, slot.key, slot.frameMap?.closed ?? 0) && hasTextureFrame(scene, slot.key, slot.frameMap?.open ?? 1)) {
    sprite = scene.add.image(cx, mapHeight / 2, slot.key, slot.frameMap?.closed ?? 0).setDisplaySize(TILE, mapHeight).setDepth(2);
  } else {
    art = scene.add.graphics().setDepth(2);
    drawGateFallback(art, cx, mapHeight, false);
  }
  scene.physics.add.existing(body, true);
  group.add(body);
  body.setData({ kind: "gate", id, art, sprite, slot: "gate", centerX: cx, mapHeight });
  return body;
}

export function setCheckpointActive(scene, flag, active) {
  const slot = getTextureSlot(scene, "checkpoint");
  const frame = slot?.frameMap?.[active ? "active" : "inactive"] ?? (active ? 1 : 0);
  const sprite = flag.getData("sprite");
  if (sprite && hasTextureFrame(scene, slot?.key, frame)) sprite.setFrame(frame);
  else {
    const art = flag.getData("art");
    if (art) { art.clear(); drawMarkerFallback(art, flag.getData("centerX"), flag.getData("centerY"), "checkpoint", active); }
  }
}

export function setGateOpenArt(scene, gate) {
  const slot = getTextureSlot(scene, "gate");
  const frame = slot?.frameMap?.open ?? 1;
  const sprite = gate.getData("sprite");
  if (sprite && hasTextureFrame(scene, slot?.key, frame)) sprite.setFrame(frame);
  else {
    const art = gate.getData("art");
    if (art) { art.clear(); drawGateFallback(art, gate.getData("centerX"), gate.getData("mapHeight"), true); }
  }
}

function getTextureSlot(scene, name) {
  const slot = scene.assetManifest?.assets?.[name];
  return slot?.key && scene.textures.exists(slot.key) ? slot : null;
}

function hasTextureFrame(scene, key, frame) {
  if (!key || !scene.textures.exists(key)) return false;
  if (frame === undefined || frame === null) return true;
  return Boolean(scene.textures.get(key).frames?.[String(frame)]);
}

function drawMarkerFallback(graphics, cx, cy, kind, active) {
  const poleWidth = TILE * .16; const poleHeight = TILE * 1.5;
  graphics.fillStyle(0xe9f5ff, 1).fillRoundedRect(cx - poleWidth / 2, cy - poleHeight / 2, poleWidth, poleHeight, poleWidth / 2);
  const color = kind === "finish" ? 0xffd65c : active ? 0xffdc71 : 0x74e5bb;
  graphics.fillStyle(color, 1).fillTriangle(cx, cy - TILE * .72, cx + TILE * .7, cy - TILE * .48, cx, cy - TILE * .23);
  graphics.lineStyle(Math.max(1, TILE * .047), 0xffffff, .85).strokeTriangle(cx, cy - TILE * .72, cx + TILE * .7, cy - TILE * .48, cx, cy - TILE * .23);
  if (kind === "checkpoint") graphics.fillCircle(cx, cy - TILE * .48, TILE * .09);
}

function drawGateFallback(graphics, cx, mapHeight, open) {
  graphics.fillStyle(open ? 0x64d9af : 0x4b3c9e, open ? .32 : .9).fillRect(cx - 26, 0, 52, mapHeight);
  if (!open) {
    graphics.fillStyle(0x8975e8, .9).fillRect(cx - 14, 0, 28, mapHeight);
    graphics.lineStyle(5, 0xc6b5ff, 1).strokeRect(cx - 26, 0, 52, mapHeight);
    for (let y = TILE * .6; y < mapHeight; y += TILE * 1.5) graphics.fillStyle(0xf5d879, .95).fillCircle(cx, y, TILE * .09);
  }
}
