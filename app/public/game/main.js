import { BootScene } from "./scenes/BootScene.js";
import { GameScene } from "./scenes/GameScene.js";
import { DEFAULT_TUNING } from "./tuning.js";

export function launchPlatformer(options) {
  window.platformerLaunchData = options;
  const settings = options?.settings || {};
  const tileset = options?.manifest?.tilesets?.find((item) => item.id === settings.tilesetId) || options?.manifest?.tilesets?.find((item) => item.id === "grass");
  const pixelArt = Boolean(tileset?.pixelArt ?? options?.manifest?.rendering?.pixelArt);
  const config = {
    type: Phaser.AUTO,
    parent: "game-root",
    backgroundColor: "#8dd9f3",
    scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%", autoCenter: Phaser.Scale.CENTER_BOTH },
    physics: { default: "arcade", arcade: { gravity: { y: DEFAULT_TUNING.gravity }, debug: false } },
    scene: [BootScene, GameScene],
    render: { antialias: !pixelArt, pixelArt, roundPixels: pixelArt },
  };
  return new Phaser.Game(config);
}
