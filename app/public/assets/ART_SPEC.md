# Imported art pack and game sizing

The game now builds its catalog from `public/assets/packs/`; it does not use
the old hand-authored `themes/<theme>/` slot sheet. The imported Kenney New
Platformer Pack is CC0 and its original license/readme are retained beside the
source art. See the root `ASSET_REPORT.md` for the inventory and
`../assets/manifest.json` for the current generated catalog.

## Runtime sizing

The imported tiles are natively **64 × 64 px**. The level uses 64 px per tile;
`public/levels/stage1.json` declares this as `tileSize: 64`. The manifest's
tileset sheets have four horizontal 64 × 64 frames in this order: ground,
ground top, platform, spikes. The current builder recognizes Grass, Dirt,
Sand, Snow, Stone, and Purple candidates when matching ground/platform/spike
tiles are present.

Character and enemy image frame sizes are detected from source frames, atlases,
or a folder's `sheet.json`. The current catalog's generated character sheets
use their detected frame dimensions, and generated menu previews use 64 × 64
frames (idle, then run frames). Animation names are normalized to idle, run,
jump, fall, hurt, die, and attack; missing states reuse idle. The manifest
stores the exact frame dimensions/count and animation ranges for every item.

Background entries can be one image or a far/mid/near group. Layered sets use
parallax speeds of 0.12, 0.26, and 0.48. Single images tile horizontally at a
slow scroll speed. Source SVGs are kept; the builder creates game-ready PNG
copies under the pack's `.generated/` directory.

## Extending or correcting the catalog

Add a new source pack under `public/assets/packs/<pack-name>/` and retain its
license files. Run `python -m tools.build_manifest` to rebuild the catalog;
FastAPI also rebuilds it at startup. Use optional `sheet.json` and `theme.json`
files to supply frame dimensions, classify files, or override names and enemy
behavior. See the `Importing art packs` section in the root README for the
supported override shape. Unclassified files are recorded under `unused` in
the manifest and printed by the builder.

Every game display has generated fallback art, so empty packs, unsupported
files, and failed downloads do not prevent play.
