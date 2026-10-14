# Kenney New Platformer Pack 1.1 — Asset Report

Inspected read-only at C:\Users\user\Downloads\kenney_new-platformer-pack-1.1.
The pack contains **1,333 files**. No game files or source assets were changed.

## 1. Folder tree and inventory

Counts below are recursive for each directory. File types are extensions and
counts. The two Default and Double folders contain matching artwork at 1× and
2× resolutions.

- Pack root — 8 files: PNG 5, TXT 1, URL 2
- Sounds/ — 10 files: OGG 10
- Sprites/ — 866 files: PNG 866
  - Backgrounds/ — 28 PNG
    - Default/ — 14 PNG
    - Double/ — 14 PNG
  - Characters/ — 90 PNG
    - Default/ — 45 PNG
    - Double/ — 45 PNG
  - Enemies/ — 120 PNG
    - Default/ — 60 PNG
    - Double/ — 60 PNG
  - Tiles/ — 628 PNG
    - Default/ — 314 PNG
    - Double/ — 314 PNG
- Spritesheets/ — 16 files: PNG 8, XML 8
- Vector/ — 433 files: SVG 433
  - Backgrounds/ — 14 SVG
  - Characters/ — 45 SVG
  - Enemies/ — 60 SVG
  - Tiles/ — 314 SVG

The 8 files directly in the pack root are License.txt, three Preview PNGs,
Sample A.png, Sample B.png, and two Kenney link files. The root PNG previews
and samples are 918 × 515 px.

## 2. What each folder contains

| Folder | Contents and basis |
| --- | --- |
| Pack root | License and link files plus three category previews and two sample compositions; these are documentation/examples rather than runtime art. |
| Sounds/ | Ten OGG sound effects, named for likely game events. No music track. |
| Sprites/Backgrounds/Default/ | Background component images: clouds, colored/faded landscape backdrops, and solid color fills. Names and square dimensions suggest reusable backdrop layers or fills. |
| Sprites/Backgrounds/Double/ | Same background set at twice the pixel dimensions; filenames correspond to Default. |
| Sprites/Characters/Default/ | Five playable-character color variants, each with separate pose files for idle, movement, jump, hit, duck, and climbing. |
| Sprites/Characters/Double/ | The same five character variants and poses at 2× resolution. |
| Sprites/Enemies/Default/ | Separate enemy pose/animation-frame images for 18 enemy types (insects, fish, frog, slimes, snail, worms, saw, etc.). |
| Sprites/Enemies/Double/ | Same 18 enemy types and poses at 2× resolution. |
| Sprites/Tiles/Default/ | Individual 64 px tile/object PNGs: terrain pieces, blocks, platforms, hazards, pickups, switches, doors/keys, HUD symbols, and decorative objects. |
| Sprites/Tiles/Double/ | Matching tile/object art at 128 px per tile/frame. |
| Spritesheets/ | Eight packed PNG atlases and eight matching XML TextureAtlas frame maps for backgrounds, characters, enemies, and tiles at both sizes. These are XML atlases, not JSON atlases. |
| Vector/Backgrounds/ | 14 scalable backdrop components matching the raster backgrounds. SVG root size is 256 × 256 px. |
| Vector/Characters/ | 45 scalable character pose images matching the raster character set. SVG root size is 128 × 128 px. |
| Vector/Enemies/ | 60 scalable enemy pose images matching the raster enemy set. SVG root size is 64 × 64 px. |
| Vector/Tiles/ | 314 scalable tiles, objects, HUD icons, and terrain pieces. SVG root size is 64 × 64 px. |

There is no dedicated UI directory. HUD items such as hearts, coins, keys, and
player icons are included among Sprites/Tiles/ and Vector/Tiles/.

## 3. Characters and enemies

The individual PNG pose files are also indexed by the character/enemy XML
atlases. They are **individual frame/pose images**, not animated strips. A
matching Default image is 1×; Double is exactly 2×. Atlas frame dimensions
match the corresponding individual images.

### Characters

Five color variants are present: beige, green, pink, purple, and yellow. Each
color has the same nine files/states in both raster sizes:

| State files | What is present |
| --- | --- |
| idle | One idle pose. |
| walk_a, walk_b | Two separate walk-cycle poses; no separate run-named files. |
| jump | One jump pose. |
| hit | One hit/damage pose. |
| climb_a, climb_b | Two separate climb poses. |
| duck | One duck/crouch pose. |
| front | One front-facing pose. |

All 45 individual character PNGs in Sprites/Characters/Default/ are 128 ×
128 px; all 45 in Double/ are 256 × 256 px. The atlas sheets contain 45
frames: spritesheet-characters-default.png is 902 × 902 px with 128 × 128
frames, and the Double sheet is 1,798 × 1,798 px with 256 × 256 frames.
Packing includes approximately one-pixel gaps between atlas frames.

No named fall animation or attack animation was found for the player
characters. hit is available as a hurt-like pose.

### Enemies

Each entry below is a set of separate single-pose PNGs (and corresponding
XML-atlas frames). Suffixes a/b are alternate animation frames. Every enemy
has 64 × 64 px images in Default/ and 128 × 128 px images in Double/. The
matching enemy atlases contain 60 frames: 519 × 519 px (Default, 64 px frames)
and 1,031 × 1,031 px (Double, 128 px frames).

| Enemy | States/files found |
| --- | --- |
| Barnacle | attack_a, attack_b, attack_rest |
| Bee | a, b, rest (likely flutter/fly cycle) |
| Block | fall, idle, rest |
| Blue fish | rest, swim_a, swim_b |
| Purple fish | down, rest, up |
| Yellow fish | rest, swim_a, swim_b |
| Fly | a, b, rest (likely flight cycle) |
| Frog | idle, jump, rest |
| Ladybug | fly, rest, walk_a, walk_b |
| Mouse | rest, walk_a, walk_b |
| Saw | a, b, rest (likely rotation states) |
| Block slime | jump, rest, walk_a, walk_b |
| Fire slime | flat, rest, walk_a, walk_b |
| Normal slime | flat, rest, walk_a, walk_b |
| Spike slime | flat, rest, walk_a, walk_b |
| Snail | rest, shell, walk_a, walk_b |
| Normal worm | move_a, move_b, rest |
| Ring worm | move_a, move_b, rest |

Only the barnacle has an explicitly named attack sequence. No enemy hurt
sequence was found. The files provide no universal fall state; the block
enemy has a fall pose and the frog/slime have jump.

## 4. Backgrounds

Backgrounds are **individual square images**, not preassembled multilayer
parallax sets. The categories can be composed into a scene: background_clouds,
four background_color_* landscape images (desert, hills, mushrooms, trees),
four corresponding background_fade_* images, and five background_solid_*
fills (cloud, dirt, grass, sand, sky). Default PNGs are 256 × 256 px; Double
PNGs are 512 × 512 px. The matching atlases have 14 frames each:
1,027 × 1,027 px (Default, 256 px frames) and 2,051 × 2,051 px (Double,
512 px frames). The Vector background images are 256 × 256 px.

## 5. Tiles and terrain

There are 314 individual tile/object images per raster size. Default is
64 × 64 px per image; Double is 128 × 128 px. The Vector tiles are 64 × 64
px. The atlases index 314 frames: 1,169 × 1,169 px (Default, 64 px frames)
and 2,321 × 2,321 px (Double, 128 px frames), with roughly one-pixel packing
gaps.

- **Ground and fill:** terrain_grass_*, terrain_dirt_*, terrain_sand_*,
  terrain_snow_*, terrain_stone_*, and terrain_purple_*; families include
  block corners/centers, horizontal and vertical segments, and ramps.
  *_block_center and *_block are useful fill pieces.
- **Platforms:** terrain cloud sets (terrain_*_cloud*), horizontal ledges,
  overhangs, and plank/block objects provide floating or suspended platform
  candidates.
- **Spikes:** spikes and block_spikes are explicit hazard images.
- **Other gameplay tiles:** colored blocks, breakable/coin/exclamation blocks,
  switches, doors, keys, ladders, ropes, springs, water/lava, signs, saws,
  coins/gems/stars, and HUD icons are included.

For the current game's 32 × 32 px grid, the 64 px Default tile art can be
displayed at half size; the 128 px Double art can be displayed at quarter size.
The pack does not appear to contain a single-purpose four-frame
ground/platform/spikes sheet; use the XML tiles atlas or assemble selected
individual tiles.

## 6. Audio

All ten files are OGG sound effects; none is music. Guesses based on names:

| File | Likely use |
| --- | --- |
| sfx_bump.ogg | Collision or bump. |
| sfx_coin.ogg | Coin pickup. |
| sfx_disappear.ogg | Object/enemy disappears. |
| sfx_gem.ogg | Gem pickup. |
| sfx_hurt.ogg | Player damage. |
| sfx_jump.ogg | Regular jump. |
| sfx_jump-high.ogg | Strong/high jump. |
| sfx_magic.ogg | Magic effect or power-up. |
| sfx_select.ogg | Menu/UI selection. |
| sfx_throw.ogg | Throw or projectile action. |

## 7. Vector files

All 433 SVGs are scalable counterparts to the sprite categories, with matching
counts and descriptive filenames: backgrounds (14), characters (45), enemies
(60), and tiles/UI/gameplay objects (314). Their nominal root sizes are
256 × 256 px for backgrounds, 128 × 128 px for characters, and 64 × 64 px
for enemies and tiles. They are individual SVG illustrations, not SVG
animation files.

## 8. License and readme

License.txt identifies this as New Platformer Pack 1.1, created/distributed by
Kenney, and states **Creative Commons Zero (CC0)**. It explicitly allows
personal, educational, and commercial use. Crediting Kenney or kenney.nl is
suggested but not required by that file. No README file was found.

## 9. Unclassified items and issues

- Preview (Backgrounds).png, Preview (Characters).png, and Preview (Tiles).png
  are category preview sheets; Sample A.png and Sample B.png are example
  compositions. All five are 918 × 515 px.
- The two .url files link to Kenney's website and Patreon; they are not
  gameplay assets.
- Raster families have consistent 1×/2× sizes. Atlas canvases have odd
  dimensions because frames are packed with small gaps; rely on XML frame
  coordinates rather than dividing the atlas canvas evenly.
- Character and enemy animations are supplied as separately named poses rather
  than ready-to-play sequences. Integrating them requires choosing frame order
  and animation timing.
- There are no explicit player fall/attack frames, no general enemy hurt
  animations, no music, and no already-layered three-speed parallax background
  set.
- No unusually large files were found: the largest is the Double tiles atlas
  PNG at about 248 KiB. The pack's art is mostly 64–256 px assets and small
  atlases, so file size does not look problematic.

## 10. Runtime scale and rendering settings

The game now reads the selected tileset's `tileSize` (native art pixels) and
`displayTileSize` (world-grid pixels) from the generated manifest. The default
requested display size is 48 px. Pixel-art packs round this to a whole-number
native scale; a 16 px pack therefore uses 48 px tiles, and this pack's 64 px
tiles use a 64 px display cell. The included New Platformer Pack is detected as
a smooth-art pack unless its `theme.json` sets `pixelArt: true`. Its generated
actor frames are resized to about 1.15 tiles high for heroes and 0.86 tiles for
enemies, with Lanczos filtering for smooth art. Pixel-art resizing uses nearest
neighbor. The builder writes per-pack settings and effective tile sizes into
the manifest.

Background layers use uniform cover scaling, horizontal tiling, per-layer
parallax speed, and recalculation after orientation/viewport changes. The
camera targets about 11–12 tiles vertically. `GameScene` logs the native size,
display size, and render scale for the selected visual assets on each run.

The Downloads folder supplied with the request contains the New Platformer
Pack and `kenney_ui-pack-adventure`, but no separate Kenney Pixel Platformer
folder was available for a full pack visual check. The builder's 16 px tile
scale path is checked separately during verification; it does not imply that
the missing pack's artwork was loaded into the game.
