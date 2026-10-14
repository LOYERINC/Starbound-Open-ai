#!/usr/bin/env python
"""Index art packs and build lightweight runtime assets and manifest."""

from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
ASSETS = PUBLIC / "assets"
PACKS = ASSETS / "packs"
MANIFEST = ASSETS / "manifest.json"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
CATEGORIES = {"characters", "enemies", "backgrounds", "tiles"}
SHEET_WARNINGS: list[str] = []
PACK_RENDER_SETTINGS_CACHE: dict[str, dict] = {}
ANIMATION_STATES = ("idle", "run", "jump", "fall", "hurt", "die", "attack")
STATE_SUFFIXES = (
    ("attack", r"(?:attack)(?:_[a-z0-9]+)?"),
    ("hurt", r"(?:hurt|hit|damage)(?:_[a-z0-9]+)?"),
    ("die", r"(?:die|death|dead)(?:_[a-z0-9]+)?"),
    ("jump", r"jump(?:_[a-z0-9]+)?"),
    ("fall", r"fall(?:_[a-z0-9]+)?"),
    ("jump", r"up(?:_[a-z0-9]+)?"),
    ("fall", r"down(?:_[a-z0-9]+)?"),
    ("idle", r"flat(?:_[a-z0-9]+)?"),
    ("idle", r"(?:idle|rest)(?:_[a-z0-9]+)?"),
    ("run", r"(?:run|walk|move|swim|fly)(?:_[a-z0-9]+)?"),
    ("run", r"(?:[ab]|frame_?[0-9]+|[0-9]+)"),
)


def url_path(path: Path) -> str:
    return "/" + path.resolve().relative_to(PUBLIC.resolve()).as_posix()


def infer_category(path: Path) -> str | None:
    parts = [part.lower() for part in path.parts]
    for category in CATEGORIES:
        if category in parts or category.rstrip("s") in parts:
            return category
    name = path.stem.lower()
    if name.startswith(("preview", "sample")):
        return None
    if "characters" in name or "character_" in name:
        return "characters"
    if "enemies" in name:
        return "enemies"
    if "backgrounds" in name:
        return "backgrounds"
    if "tiles" in name:
        return "tiles"
    if name.startswith("character_"):
        return "characters"
    if name.startswith(("terrain_", "block_", "hud_", "spikes")):
        return "tiles"
    if name.startswith("background_"):
        return "backgrounds"
    if any(token in name for token in ("slime", "barnacle", "ladybug", "worm", "frog", "bee_", "fly_")):
        return "enemies"
    return None


def source_rank(path: Path) -> int:
    parts = [part.lower() for part in path.parts]
    if "double" in parts:
        return 4
    if ".generated" in parts:
        return 3
    if "vector" in parts:
        return 2
    if "default" in parts:
        return 0
    return 1


def image_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        return image.size


def pack_render_settings(pack: Path, overrides: list[tuple[Path, dict]], records: list[dict] | None = None) -> dict:
    """Return native tile and pixel/display settings for one pack."""
    cache_key = str(pack.resolve())
    if cache_key in PACK_RENDER_SETTINGS_CACHE:
        return dict(PACK_RENDER_SETTINGS_CACHE[cache_key])
    config: dict = {}
    for parent, data in overrides:
        if parent == pack:
            config.update(data)
    world = config.get("world", {}) if isinstance(config.get("world"), dict) else {}
    rendering = config.get("rendering", {}) if isinstance(config.get("rendering"), dict) else {}
    native = config.get("tileSize", world.get("tileSize"))
    if not isinstance(native, (int, float)) or native <= 0:
        candidates = []
        candidates_to_check = [(record["path"], record["name"]) for record in records or [] if record.get("category") == "tiles"]
        if not candidates_to_check:
            candidates_to_check = [(path, path.stem) for path in pack.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS and category_for(path, overrides) == "tiles"]
        for path, raw_name in candidates_to_check:
            name = Path(raw_name).stem.lower()
            if not (name.startswith("terrain_") or name in {"spikes", "block_spikes"}):
                continue
            try:
                width, height = image_size(path)
                if width == height and 8 <= width <= 256:
                    candidates.append(width)
            except (OSError, ValueError):
                continue
        if candidates:
            counts = {value: candidates.count(value) for value in set(candidates)}
            most_common = max(counts.values())
            native = min(value for value, count in counts.items() if count == most_common)
        else:
            native = 64
    pixel_art = rendering.get("pixelArt", config.get("pixelArt"))
    if not isinstance(pixel_art, bool):
        pixel_art = "pixel" in pack.name.lower()
    requested = config.get("displayTileSize", world.get("displayTileSize", 48))
    requested = max(16, int(requested)) if isinstance(requested, (int, float)) else 48
    display = int(native * max(1, round(requested / native))) if pixel_art else requested
    result = {"tileSize": int(native), "displayTileSize": display, "pixelArt": pixel_art}
    PACK_RENDER_SETTINGS_CACHE[cache_key] = result
    return dict(result)


def actor_frame_size(frame_size: tuple[int, int], target_height: int) -> tuple[int, int]:
    width, height = frame_size
    return max(1, round(width * target_height / max(1, height))), max(1, target_height)


def frame_size_from_report(category: str, tile_size: int = 64) -> tuple[int, int]:
    return {
        "characters": (tile_size * 2, tile_size * 2),
        "enemies": (tile_size, tile_size),
        "tiles": (tile_size, tile_size),
        "backgrounds": (tile_size * 4, tile_size * 4),
    }.get(category, (64, 64))


def list_theme_overrides(pack: Path) -> list[tuple[Path, dict]]:
    result = []
    for path in pack.rglob("theme.json"):
        if ".generated" in path.parts:
            continue
        try:
            result.append((path.parent, json.loads(path.read_text(encoding="utf-8"))))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"Warning: ignoring invalid {path}: {exc}")
    return result


def overrides_for(path: Path, overrides: list[tuple[Path, dict]]) -> dict:
    merged: dict = {}
    for parent, data in overrides:
        try:
            path.relative_to(parent)
        except ValueError:
            continue
        for category, entries in data.items():
            if isinstance(entries, dict):
                merged.setdefault(category, {}).update(entries)
    return merged


def add_named_frame(
    frames: list[dict], category: str, path: Path, name: str, rank: int = 2
) -> None:
    frames.append({"category": category, "path": path, "name": name, "rank": rank})


def category_for(path: Path, overrides: list[tuple[Path, dict]]) -> str | None:
    """Resolve folder/name defaults, then let an enclosing theme.json correct them."""
    value = infer_category(path)
    for parent, data in overrides:
        try:
            relative = path.relative_to(parent).as_posix()
        except ValueError:
            continue
        classifications = data.get("classifications", data.get("classify", {}))
        if not isinstance(classifications, dict):
            continue
        for key in (relative, path.name, path.stem):
            if key in classifications:
                target = classifications[key]
                if isinstance(target, str):
                    return normalize_category(target)
        for category, patterns in classifications.items():
            normalized = normalize_category(category)
            if normalized not in CATEGORIES:
                continue
            patterns = [patterns] if isinstance(patterns, str) else patterns if isinstance(patterns, list) else []
            if any(str(pattern).lower() in relative.lower() for pattern in patterns):
                return normalized
    return value


def normalize_category(value: str) -> str | None:
    custom = value.lower().rstrip("s")
    return {"character": "characters", "enemy": "enemies", "background": "backgrounds", "tile": "tiles"}.get(
        custom, custom if custom in CATEGORIES else None
    )


def extract_atlases(pack: Path, generated: Path, frames: list[dict], overrides: list[tuple[Path, dict]]) -> set[Path]:
    """Expand XML and JSON atlas entries into named frame PNGs."""
    recognized: set[Path] = set()
    generated.mkdir(parents=True, exist_ok=True)
    for atlas in list(pack.rglob("*.xml")) + list(pack.rglob("*.json")):
        if ".generated" in atlas.parts or atlas.name.lower() in {"theme.json", "sheet.json"}:
            continue
        category = category_for(atlas, overrides)
        if not category:
            continue
        image_path = None
        entries: list[tuple[str, int, int, int, int]] = []
        try:
            if atlas.suffix.lower() == ".xml":
                root = ET.parse(atlas).getroot()
                image_name = root.attrib.get("imagePath")
                image_path = atlas.parent / image_name if image_name else None
                for item in root.findall(".//SubTexture"):
                    entries.append((item.attrib["name"], int(item.attrib["x"]), int(item.attrib["y"]), int(item.attrib["width"]), int(item.attrib["height"])))
            else:
                data = json.loads(atlas.read_text(encoding="utf-8"))
                image_name = data.get("meta", {}).get("image")
                image_path = atlas.parent / image_name if image_name else None
                data_frames = data.get("frames", {})
                iterator = data_frames.items() if isinstance(data_frames, dict) else (
                    (item.get("filename", item.get("name", "")), item) for item in data_frames
                )
                for name, item in iterator:
                    rect = item.get("frame", item)
                    if rect.get("rotated"):
                        continue
                    entries.append((name, int(rect["x"]), int(rect["y"]), int(rect["w"]), int(rect["h"])))
        except (OSError, ValueError, KeyError, TypeError, ET.ParseError, json.JSONDecodeError):
            continue
        if not image_path or not image_path.exists() or not entries:
            continue
        recognized.add(atlas)
        recognized.add(image_path)
        target_dir = generated / "atlas" / atlas.stem
        target_dir.mkdir(parents=True, exist_ok=True)
        try:
            with Image.open(image_path) as source:
                for name, x, y, width, height in entries:
                    clean = re.sub(r"[^a-zA-Z0-9_-]+", "-", name)
                    output = target_dir / f"{clean}.png"
                    if not output.exists() or output.stat().st_mtime < atlas.stat().st_mtime:
                        source.crop((x, y, x + width, y + height)).save(output)
                    add_named_frame(frames, category, output, name, rank=3)
        except (OSError, ValueError) as exc:
            print(f"Warning: could not extract atlas {atlas}: {exc}")
    return recognized


def extract_plain_sheets(pack: Path, generated: Path, frames: list[dict], atlas_files: set[Path], overrides: list[tuple[Path, dict]]) -> set[Path]:
    """Split explicitly named sheets, using sheet.json or report dimensions."""
    recognized: set[Path] = set()
    for image_path in pack.rglob("*"):
        if image_path.suffix.lower() not in IMAGE_EXTENSIONS or ".generated" in image_path.parts:
            continue
        if image_path in atlas_files or "spritesheet" not in image_path.stem.lower() and "sheet" not in image_path.stem.lower():
            continue
        category = category_for(image_path, overrides)
        if not category:
            continue
        config_path = image_path.parent / "sheet.json"
        config = {}
        if config_path.exists():
            try:
                config = json.loads(config_path.read_text(encoding="utf-8"))
                recognized.add(config_path)
            except (OSError, json.JSONDecodeError):
                print(f"Warning: invalid sheet override {config_path}")
        native_size = pack_render_settings(pack, overrides)["tileSize"]
        default_width, default_height = frame_size_from_report(category, native_size)
        frame_width = int(config.get("frameWidth", default_width))
        frame_height = int(config.get("frameHeight", default_height))
        columns = int(config.get("columns", 0))
        margin = int(config.get("margin", 0))
        spacing = int(config.get("spacing", 0))
        target_dir = generated / "sheets" / image_path.stem
        target_dir.mkdir(parents=True, exist_ok=True)
        try:
            with Image.open(image_path) as source:
                if not columns:
                    columns = max(1, (source.width - 2 * margin + spacing) // (frame_width + spacing))
                rows = max(1, (source.height - 2 * margin + spacing) // (frame_height + spacing))
                frame_count = int(config.get("frameCount", columns * rows))
                for index in range(frame_count):
                    col, row = index % columns, index // columns
                    x, y = margin + col * (frame_width + spacing), margin + row * (frame_height + spacing)
                    if x + frame_width > source.width or y + frame_height > source.height:
                        break
                    output = target_dir / f"{image_path.stem}_{index:03}.png"
                    source.crop((x, y, x + frame_width, y + frame_height)).save(output)
                    add_named_frame(frames, category, output, f"{image_path.stem}_{index}", rank=3)
            recognized.add(image_path)
        except (OSError, ValueError) as exc:
            print(f"Warning: could not split sheet {image_path}: {exc}")
    return recognized


def high_resolution_background_svg(svg: Path, pack: Path, generated: Path) -> Path:
    """Make a larger SVG viewport while retaining its original vector paths."""
    source = svg.read_text(encoding="utf-8", errors="replace")
    root_match = re.search(r"<svg\b([^>]*)>", source, re.IGNORECASE | re.DOTALL)
    if not root_match:
        return svg
    attrs = root_match.group(1)
    width_match = re.search(r"\bwidth\s*=\s*([\"'])([\d.]+)(?:px)?\1", attrs, re.IGNORECASE)
    height_match = re.search(r"\bheight\s*=\s*([\"'])([\d.]+)(?:px)?\1", attrs, re.IGNORECASE)
    native_width = float(width_match.group(2)) if width_match else 256
    native_height = float(height_match.group(2)) if height_match else 256
    scale = 2048 / max(native_width, native_height, 1)
    width = max(1, round(native_width * scale))
    height = max(1, round(native_height * scale))
    if not re.search(r"\bviewBox\s*=", attrs, re.IGNORECASE):
        attrs += f' viewBox="0 0 {native_width:g} {native_height:g}"'
    if width_match:
        attrs = attrs[:width_match.start()] + f'width="{width}"' + attrs[width_match.end():]
    else:
        attrs += f' width="{width}"'
    # Re-match after replacing width because its string offset may have changed.
    height_match = re.search(r"\bheight\s*=\s*([\"'])([\d.]+)(?:px)?\1", attrs, re.IGNORECASE)
    if height_match:
        attrs = attrs[:height_match.start()] + f'height="{height}"' + attrs[height_match.end():]
    else:
        attrs += f' height="{height}"'
    output = source[:root_match.start(1)] + attrs + source[root_match.end(1):]
    target = generated / "vector-hires" / svg.relative_to(svg.parents[len(svg.parts) - len(svg.parts)]) if False else None
    # Preserve the pack-relative folder structure under .generated.
    pack_root = next((parent for parent in svg.parents if parent.name == "packs"), None)
    del pack_root  # the caller's generated directory is already pack-scoped
    target = generated / "vector-hires" / svg.relative_to(pack)
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or target.stat().st_mtime < svg.stat().st_mtime or target.read_text(encoding="utf-8", errors="replace") != output:
        target.write_text(output, encoding="utf-8")
    return target


def convert_svgs(pack: Path, generated: Path, frames: list[dict], overrides: list[tuple[Path, dict]]) -> set[Path]:
    recognized: set[Path] = set()
    vector_files = [svg for svg in pack.rglob("*.svg") if ".generated" not in svg.parts]
    # Keep background artwork as vector at a large intrinsic viewport. This
    # avoids both Cairo's native Windows dependency and blurry runtime upscales.
    for svg in vector_files:
        if category_for(svg, overrides) == "backgrounds":
            target = high_resolution_background_svg(svg, pack, generated)
            add_named_frame(frames, "backgrounds", target, svg.stem, rank=-1)
            recognized.add(svg)
    try:
        import cairosvg
    except Exception as exc:
        print(f"Warning: SVG conversion unavailable ({exc}); non-background vectors will use placeholders.")
        return recognized
    for svg in vector_files:
        category = category_for(svg, overrides)
        if not category or category == "backgrounds":
            continue
        width, height = frame_size_from_report(category, pack_render_settings(pack, overrides)["tileSize"])
        target = generated / "vector" / svg.relative_to(pack).with_suffix(".png")
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or target.stat().st_mtime < svg.stat().st_mtime:
            try:
                cairosvg.svg2png(url=str(svg), write_to=str(target), output_width=width, output_height=height)
            except Exception as exc:  # malformed or unsupported source artwork
                print(f"Warning: SVG conversion failed for {svg}: {exc}")
                continue
        add_named_frame(frames, category, target, svg.stem, rank=2)
        recognized.add(svg)
    return recognized


def parse_frame_name(stem: str, category: str) -> tuple[str, str, str]:
    normalized = stem.lower().replace("-", "_").replace(" ", "_")
    if category == "characters" and normalized.startswith("character_"):
        for suffix in ("_climb_a", "_climb_b", "_duck", "_front"):
            if normalized.endswith(suffix):
                return normalized[len("character_") : -len(suffix)], "aux", normalized
    if category == "enemies" and normalized.endswith("_shell"):
        return normalized[:-len("_shell")], "aux", normalized
    state = "idle"
    base = normalized
    for candidate, expression in STATE_SUFFIXES:
        match = re.search(rf"(?:^|_)({expression})$", normalized)
        if match:
            suffix = match.group(1)
            state = candidate
            base = normalized[: match.start()].rstrip("_")
            if not base and category == "enemies" and suffix in {"fly_a", "fly_b"}:
                base, state = "fly", "run"
            if candidate == "run":
                # a/b frames without a motion word (bee_a, saw_b) are run cycles.
                pass
            if suffix in {"walk", "run", "move", "swim", "fly"}:
                state = "run"
            break
    if category == "characters" and base.startswith("character_"):
        base = base[len("character_") :]
    if not base:
        base = normalized
    return base, state, normalized


def natural_key(value: str) -> list:
    return [int(piece) if piece.isdigit() else piece for piece in re.split(r"(\d+)", value)]


def create_animation_sheet(
    entity_id: str,
    category: str,
    paths_by_state: dict[str, list[Path]],
    generated: Path,
    target_height: int | None = None,
    pixel_art: bool = False,
) -> tuple[Path, tuple[int, int], int, dict]:
    idle_paths = paths_by_state.get("idle") or next((items for items in paths_by_state.values() if items), [])
    if not idle_paths:
        raise ValueError(f"{entity_id} has no image frames")
    state_paths = {
        "idle": paths_by_state.get("idle") or idle_paths[:1],
        "run": paths_by_state.get("run") or paths_by_state.get("idle") or idle_paths[:1],
        "jump": paths_by_state.get("jump") or paths_by_state.get("idle") or idle_paths[:1],
        "fall": paths_by_state.get("fall") or paths_by_state.get("idle") or idle_paths[:1],
        "hurt": paths_by_state.get("hurt") or paths_by_state.get("idle") or idle_paths[:1],
        "die": paths_by_state.get("die") or paths_by_state.get("idle") or idle_paths[:1],
        "attack": paths_by_state.get("attack") or paths_by_state.get("idle") or idle_paths[:1],
    }
    sequence: list[Path] = []
    animations = {}
    for state in ANIMATION_STATES:
        chosen = state_paths[state]
        start = len(sequence)
        sequence.extend(chosen)
        animations[state] = {"start": start, "end": len(sequence) - 1, "frameRate": 8 if state == "run" else 5, "repeat": -1 if state in {"idle", "run"} else 0}
    with Image.open(sequence[0]) as first:
        source_width, source_height = first.size
    frame_width, frame_height = actor_frame_size((source_width, source_height), target_height) if target_height else (source_width, source_height)
    resampling = Image.Resampling.NEAREST if pixel_art else Image.Resampling.LANCZOS
    sheet_dir = generated / category
    sheet_dir.mkdir(parents=True, exist_ok=True)
    style = "pixel" if pixel_art else "smooth"
    sheet_path = sheet_dir / f"{re.sub(r'[^a-z0-9_-]+', '-', entity_id)}-h{frame_height}-{style}.png"
    expected_size = (frame_width * len(sequence), frame_height)
    rebuild = not sheet_path.exists()
    if not rebuild:
        try:
            rebuild = image_size(sheet_path) != expected_size or any(path.stat().st_mtime > sheet_path.stat().st_mtime for path in sequence)
        except (OSError, ValueError):
            rebuild = True
    if rebuild:
        sheet = Image.new("RGBA", (frame_width * len(sequence), frame_height), (0, 0, 0, 0))
        for index, frame_path in enumerate(sequence):
            with Image.open(frame_path) as frame:
                frame = frame.convert("RGBA")
                frame.thumbnail((frame_width, frame_height), resampling)
                sheet.alpha_composite(frame, (index * frame_width + (frame_width - frame.width) // 2, frame_height - frame.height))
        sheet.save(sheet_path)
    actual_width, actual_height = image_size(sheet_path)
    actual_count = (actual_width // frame_width) * (actual_height // frame_height)
    for state, definition in animations.items():
        definition["start"] = min(definition["start"], actual_count - 1)
        definition["end"] = min(definition["end"], actual_count - 1)
    ranges = ", ".join(f"{name}={data['start']}-{data['end']}" for name, data in animations.items())
    print(f"Sheet {category}/{entity_id}: image={actual_width}x{actual_height}px, frame={frame_width}x{frame_height}px, frames={actual_count}; {ranges}")
    if actual_count != len(sequence):
        warning = f"{sheet_path}: expected {len(sequence)} frames, actual {actual_count} ({actual_width}x{actual_height}px / {frame_width}x{frame_height}px)"
        SHEET_WARNINGS.append(warning)
        print(f"WARNING: {warning}")
    return sheet_path, (frame_width, frame_height), actual_count, animations


def alpha_bounds(path: Path) -> tuple[int, int, int, int]:
    with Image.open(path) as image:
        rgba = image.convert("RGBA")
        bounds = rgba.getchannel("A").getbbox()
        if bounds is None:
            return (0, 0, rgba.width, rgba.height)
        left, top, right, bottom = bounds
        return (left, top, right - left, bottom - top)


def save_thumbnail(source: Path, target: Path, size: tuple[int, int], pixel_art: bool = False, cover: bool = False) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
        return
    with Image.open(source) as image:
        image = image.convert("RGBA")
        method = Image.Resampling.NEAREST if pixel_art else Image.Resampling.LANCZOS
        if cover:
            scale = max(size[0] / image.width, size[1] / image.height)
            resized = image.resize((max(size[0], round(image.width * scale)), max(size[1], round(image.height * scale))), method)
            left = (resized.width - size[0]) // 2; top = (resized.height - size[1]) // 2
            image = resized.crop((left, top, left + size[0], top + size[1]))
        else:
            image.thumbnail(size, method)
        canvas = Image.new("RGBA", size, (16, 36, 60, 255))
        canvas.alpha_composite(image, ((size[0] - image.width) // 2, (size[1] - image.height) // 2))
        canvas.save(target)


def runtime_background(path: Path, generated: Path, render_settings: dict) -> Path:
    """Downsample exceptionally large backdrops offline to avoid runtime shrinking."""
    try:
        width, height = image_size(path)
    except (OSError, ValueError):
        return path
    max_edge = 4096
    max_height = render_settings["displayTileSize"] * 12
    if max(width, height) <= max_edge and height <= max_height:
        return path
    scale = min(max_edge / width, max_edge / height, max_height / height)
    target_size = (max(1, round(width * scale)), max(1, round(height * scale)))
    style = "pixel" if render_settings["pixelArt"] else "smooth"
    target = generated / "backgrounds" / f"{path.stem}-runtime-{style}.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or target.stat().st_mtime < path.stat().st_mtime or image_size(target) != target_size:
        method = Image.Resampling.NEAREST if render_settings["pixelArt"] else Image.Resampling.LANCZOS
        with Image.open(path) as source:
            source.convert("RGBA").resize(target_size, method).save(target)
    return target


def background_dimensions(path: Path) -> tuple[int, int]:
    """Read dimensions from raster or SVG background files."""
    if path.suffix.lower() != ".svg":
        return image_size(path)
    source = path.read_text(encoding="utf-8", errors="replace")
    root = re.search(r"<svg\b([^>]*)>", source, re.IGNORECASE | re.DOTALL)
    attrs = root.group(1) if root else ""
    width_match = re.search(r"\bwidth\s*=\s*[\"']([\d.]+)", attrs, re.IGNORECASE)
    height_match = re.search(r"\bheight\s*=\s*[\"']([\d.]+)", attrs, re.IGNORECASE)
    viewbox_match = re.search(r"\bviewBox\s*=\s*[\"']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)", attrs, re.IGNORECASE)
    width = int(float(width_match.group(1))) if width_match else (int(float(viewbox_match.group(1))) if viewbox_match else 256)
    height = int(float(height_match.group(1))) if height_match else (int(float(viewbox_match.group(2))) if viewbox_match else 256)
    return max(1, width), max(1, height)


def background_runtime_source(path: Path, generated: Path, render_settings: dict) -> tuple[Path, tuple[int, int]]:
    if path.suffix.lower() == ".svg":
        return path, background_dimensions(path)
    target = runtime_background(path, generated, render_settings)
    return target, image_size(target)


def load_image_records(pack: Path, generated: Path, overrides: list[tuple[Path, dict]]) -> tuple[list[dict], set[Path]]:
    frames: list[dict] = []
    recognized = extract_atlases(pack, generated, frames, overrides)
    recognized |= extract_plain_sheets(pack, generated, frames, recognized, overrides)
    recognized |= convert_svgs(pack, generated, frames, overrides)
    for path in pack.rglob("*"):
        if not path.is_file() or ".generated" in path.parts:
            continue
        if path in recognized:
            continue
        category = category_for(path, overrides)
        if category and path.suffix.lower() in IMAGE_EXTENSIONS:
            if "spritesheets" in [part.lower() for part in path.parts]:
                recognized.add(path)
                continue
            add_named_frame(frames, category, path, path.stem, source_rank(path))
            recognized.add(path)
    return frames, recognized


def entity_records(
    pack: Path,
    category: str,
    frames: list[dict],
    overrides: list[tuple[Path, dict]],
    generated: Path,
    render_settings: dict,
) -> list[dict]:
    grouped: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    chosen: dict[tuple[str, str, str], dict] = {}
    for record in frames:
        if record["category"] != category:
            continue
        base, state, normalized = parse_frame_name(record["name"], category)
        if not base:
            continue
        key = (base, state, normalized)
        old = chosen.get(key)
        if old is None or record["rank"] < old["rank"]:
            chosen[key] = record
    # Preserve multiple numbered/lettered frames while removing duplicate 1x/2x variants.
    for (base, state, normalized), record in chosen.items():
        grouped[base][state].append(record)

    entries = []
    for entity_id, state_records in sorted(grouped.items()):
        # An atlas can contain general tiles named without an entity state; only keep
        # animation-like groups. For character/enemy folders, each stem naturally yields one.
        if not any(state_records.get(state) for state in ("idle", "run", "jump", "fall", "hurt", "die", "attack")):
            continue
        path_states: dict[str, list[Path]] = {}
        for state, records in state_records.items():
            records.sort(key=lambda rec: natural_key(rec["name"]))
            path_states[state] = [record["path"] for record in records]
        # Preserve source detail where possible. The old fixed ~41px enemy
        # frames discarded pixels before Phaser scaled them back up.
        idle_source = (path_states.get("idle") or path_states.get("run") or next(iter(path_states.values())))[0]
        with Image.open(idle_source) as idle_image:
            source_height = idle_image.height
        target_height = max(render_settings["displayTileSize"], min(source_height, render_settings["displayTileSize"] * 2))
        sheet, frame_size, frame_count, animations = create_animation_sheet(entity_id, category, path_states, generated, target_height, render_settings["pixelArt"])
        with Image.open(sheet) as sheet_image:
            idle_frame = sheet_image.convert("RGBA").crop((0, 0, frame_size[0], frame_size[1]))
            bounds = idle_frame.getchannel("A").getbbox() or (0, 0, frame_size[0], frame_size[1])
            tight = (bounds[0], bounds[1], bounds[2] - bounds[0], bounds[3] - bounds[1])
        style_suffix = "pixel" if render_settings["pixelArt"] else "smooth"
        thumb = generated / "thumbs" / category / f"{re.sub(r'[^a-z0-9_-]+', '-', entity_id)}-{style_suffix}.png"
        save_thumbnail(idle_source, thumb, (96, 96), render_settings["pixelArt"])
        preview = generated / "thumbs" / category / f"{re.sub(r'[^a-z0-9_-]+', '-', entity_id)}-preview-{style_suffix}.png"
        preview_frames = [
            idle_source,
            *(path_states.get("run") or path_states.get("idle") or [idle_source])[:2],
        ]
        preview_resampling = Image.Resampling.NEAREST if render_settings["pixelArt"] else Image.Resampling.LANCZOS
        preview.parent.mkdir(parents=True, exist_ok=True)
        with Image.new("RGBA", (64 * len(preview_frames), 64), (16, 36, 60, 0)) as preview_sheet:
            for frame_index, source_path in enumerate(preview_frames):
                with Image.open(source_path) as source_image:
                    frame_image = source_image.convert("RGBA")
                    frame_image.thumbnail((60, 60), preview_resampling)
                    preview_sheet.alpha_composite(frame_image, (frame_index * 64 + (64 - frame_image.width) // 2, 2 + (60 - frame_image.height) // 2))
            preview_sheet.save(preview)
        name = entity_id.replace("_", " ").title()
        override = {}
        for scope, data in overrides:
            try:
                pack_path = (pack / entity_id)
                data_for_category = data.get(category, data.get(category.rstrip("s"), {}))
                if isinstance(data_for_category, dict) and isinstance(data_for_category.get(entity_id), dict):
                    override.update(data_for_category[entity_id])
            except (TypeError, ValueError):
                pass
        entry = {
            "id": entity_id,
            "name": str(override.get("name", name)),
            "path": url_path(sheet),
            "thumbnail": url_path(thumb),
            "previewSheet": url_path(preview),
            "previewFrameSize": {"width": 64, "height": 64},
            "previewAnimations": {"idle": {"start": 0, "end": 0}, "run": {"start": 1, "end": len(preview_frames) - 1}},
            "frameSize": {"width": frame_size[0], "height": frame_size[1]},
            "frameCount": frame_count,
            "animations": animations,
            "tightBounds": {"x": tight[0], "y": tight[1], "width": tight[2], "height": tight[3]},
            "feet": {"x": tight[0] + tight[2] / 2, "y": tight[1] + tight[3]},
            "sourceFiles": sorted({
                url_path(record["path"]) if record["path"].resolve().is_relative_to(PUBLIC.resolve()) else record["path"].name
                for records in state_records.values() for record in records
            }),
            "tileSize": render_settings["tileSize"],
            "displayTileSize": render_settings["displayTileSize"],
            "pixelArt": render_settings["pixelArt"],
        }
        if category == "characters":
            entry["color"] = entity_id.split("_")[0]
            entry["displayHitbox"] = {"width": round(render_settings["displayTileSize"] * .82), "height": round(render_settings["displayTileSize"] * .88)}
        if category == "enemies":
            inferred = infer_behavior(entity_id)
            entry["behavior"] = str(override.get("behavior", inferred))
            entry["hitbox"] = {"width": tight[2], "height": tight[3], "offsetX": tight[0], "offsetY": tight[1]}
            entry["displayHeight"] = round(render_settings["displayTileSize"] * .82)
        if isinstance(override.get("scale"), (int, float)):
            entry["scale"] = float(override["scale"])
        if isinstance(override.get("hitbox"), dict):
            entry["hitbox"] = override["hitbox"]
        entries.append(entry)
    return entries


def infer_behavior(name: str) -> str:
    lowered = name.lower()
    if any(token in lowered for token in ("bat", "bird", "fly", "ghost", "bee")):
        return "flying"
    if any(token in lowered for token in ("plant", "spike", "turret", "saw", "barnacle")):
        return "stationary"
    return "patrol"


def tile_candidates(frames: list[dict], generated: Path, render_settings: dict) -> list[dict]:
    by_name: dict[str, dict] = {}
    for rec in frames:
        if rec["category"] != "tiles":
            continue
        name = Path(rec["name"]).stem.lower()
        old = by_name.get(name)
        if old is None or rec["rank"] < old["rank"]:
            by_name[name] = rec
    spikes = by_name.get("spikes") or by_name.get("block_spikes")
    result = []
    for theme in ("grass", "dirt", "sand", "snow", "stone", "purple"):
        ground = by_name.get(f"terrain_{theme}_block_center") or by_name.get(f"terrain_{theme}_block")
        top = by_name.get(f"terrain_{theme}_block_top") or ground
        platform = by_name.get(f"terrain_{theme}_cloud_middle") or by_name.get(f"terrain_{theme}_horizontal_middle") or ground
        if not ground or not top or not platform or not spikes:
            continue
        sources = [ground["path"], top["path"], platform["path"], spikes["path"]]
        native_tile_size = render_settings["tileSize"]
        display_tile_size = render_settings["displayTileSize"]
        style = "pixel" if render_settings["pixelArt"] else "smooth"
        target = generated / "tilesets" / f"{theme}-{native_tile_size}-{display_tile_size}-{style}.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or any(path.stat().st_mtime > target.stat().st_mtime for path in sources):
            sheet = Image.new("RGBA", (display_tile_size * 4, display_tile_size), (0, 0, 0, 0))
            resampling = Image.Resampling.NEAREST if render_settings["pixelArt"] else Image.Resampling.LANCZOS
            for index, source_path in enumerate(sources):
                with Image.open(source_path) as image:
                    image = image.convert("RGBA").resize((display_tile_size, display_tile_size), resampling)
                    sheet.alpha_composite(image, (index * display_tile_size, 0))
            sheet.save(target)
        actual_width, actual_height = image_size(target)
        actual_count = (actual_width // display_tile_size) * (actual_height // display_tile_size)
        sheet_info = f"tilesets/{theme}: native={native_tile_size}px, image={actual_width}x{actual_height}px, frame={display_tile_size}x{display_tile_size}px, frames={actual_count}; static=0-0, groundTop=1-1, platform=2-2, spikes=3-3"
        print(f"Sheet {sheet_info}")
        if actual_count != 4:
            warning = f"{target}: expected 4 frames, actual {actual_count} ({actual_width}x{actual_height}px / {display_tile_size}x{display_tile_size}px)"
            SHEET_WARNINGS.append(warning)
            print(f"WARNING: {warning}")
        thumb = generated / "thumbs" / "tilesets" / f"{theme}-{style}.png"
        save_thumbnail(ground["path"], thumb, (64, 64), render_settings["pixelArt"])
        result.append({
            "id": theme, "name": theme.title(), "key": f"tileset-{theme}",
            "path": url_path(target), "thumbnail": url_path(thumb),
            "frameSize": {"width": display_tile_size, "height": display_tile_size}, "frameCount": 4,
            "tileSize": native_tile_size, "displayTileSize": display_tile_size, "pixelArt": render_settings["pixelArt"],
            "frameMap": {"ground": 0, "groundTop": 1, "platform": 2, "spikes": 3},
            "collisionOffsets": {
                "ground": round(alpha_bounds(ground["path"])[1] * display_tile_size / max(1, image_size(ground["path"])[1])),
                "groundTop": round(alpha_bounds(top["path"])[1] * display_tile_size / max(1, image_size(top["path"])[1])),
                "platform": round(alpha_bounds(platform["path"])[1] * display_tile_size / max(1, image_size(platform["path"])[1])),
                "spikes": round(alpha_bounds(spikes["path"])[1] * display_tile_size / max(1, image_size(spikes["path"])[1])),
            },
            "sourceFiles": [url_path(path) for path in sources],
        })
    return result


def background_records(frames: list[dict], generated: Path, overrides: list[tuple[Path, dict]], render_settings: dict) -> list[dict]:
    selected: dict[str, dict] = {}
    for rec in frames:
        if rec["category"] != "backgrounds":
            continue
        stem = Path(rec["name"]).stem.lower()
        # Skip generic atlas frame aliases that are not named like the original assets.
        old = selected.get(stem)
        if old is None or rec["rank"] < old["rank"]:
            selected[stem] = rec
    entries = []
    consumed = set()
    style = "pixel" if render_settings["pixelArt"] else "smooth"
    for bg_id, rec in sorted(selected.items()):
        if bg_id in consumed:
            continue
        layer_match = re.match(r"(.+?)[_-](far|mid|near)$", bg_id)
        if layer_match:
            prefix = layer_match.group(1)
            layer_records = {
                suffix: selected.get(f"{prefix}_{suffix}") or selected.get(f"{prefix}-{suffix}")
                for suffix in ("far", "mid", "near")
            }
            if all(layer_records.values()):
                layers = []
                for suffix, speed in (("far", 0.12), ("mid", 0.26), ("near", 0.48)):
                    layer_rec = layer_records[suffix]
                    layer_path, (layer_width, layer_height) = background_runtime_source(layer_rec["path"], generated, render_settings)
                    layers.append({"key": suffix, "path": url_path(layer_path), "speed": speed, "frameSize": {"width": layer_width, "height": layer_height}})
                    consumed.add(f"{prefix}_{suffix}")
                    consumed.add(f"{prefix}-{suffix}")
                thumb_source = layer_records["far"]["path"]
                thumb = generated / "thumbs" / "backgrounds" / f"{prefix}-{style}-cover.png"
                if thumb_source.suffix.lower() == ".svg":
                    thumb = thumb_source
                else:
                    save_thumbnail(thumb_source, thumb, (160, 96), render_settings["pixelArt"], cover=True)
                entries.append({
                    "id": prefix, "name": prefix.replace("_", " ").title(),
                    "path": layers[0]["path"], "thumbnail": url_path(thumb), "layers": layers,
                    "tileableX": True, "frameSize": layers[0]["frameSize"],
                    "tileSize": render_settings["tileSize"], "displayTileSize": render_settings["displayTileSize"], "pixelArt": render_settings["pixelArt"],
                })
                continue
        target, (bg_width, bg_height) = background_runtime_source(rec["path"], generated, render_settings)
        thumb = generated / "thumbs" / "backgrounds" / f"{re.sub(r'[^a-z0-9_-]+', '-', bg_id)}-{style}-cover.png"
        if target.suffix.lower() == ".svg":
            thumb = target
        else:
            save_thumbnail(target, thumb, (160, 96), render_settings["pixelArt"], cover=True)
        entries.append({
            "id": bg_id, "name": bg_id.replace("background_", "").replace("_", " ").title(),
            "path": url_path(target), "thumbnail": url_path(thumb),
            "layers": [{"key": "far", "path": url_path(target), "speed": 0.16, "frameSize": {"width": bg_width, "height": bg_height}}],
            "tileableX": True, "frameSize": {"width": bg_width, "height": bg_height},
            "tileSize": render_settings["tileSize"], "displayTileSize": render_settings["displayTileSize"], "pixelArt": render_settings["pixelArt"],
        })
    return entries


def sound_records(pack: Path) -> tuple[dict, list[str]]:
    slots = {
        "jump": ("jump",),
        "hurt": ("hurt", "hit", "damage"),
        "checkpoint": ("checkpoint",),
        "gateOpen": ("gate-open", "gate_open", "gateopen", "door-open", "door_open"),
        "correct": ("correct", "success"),
        "wrong": ("wrong", "incorrect", "fail"),
        "finish": ("finish", "win", "complete"),
        "music": ("music", "bgm", "background"),
    }
    files = [p for p in pack.rglob("*") if p.is_file() and p.suffix.lower() in {".ogg", ".wav", ".mp3"}]
    result = {}
    used = set()
    for event, tokens in slots.items():
        candidates = [p for p in files if any(token in p.stem.lower().replace("_", "-") for token in tokens)]
        if event == "jump":
            candidates.sort(key=lambda p: ("high" in p.stem.lower(), "high" in p.stem.lower(), p.name.lower()))
        if candidates:
            chosen = candidates[0]
            result[event] = {"key": f"audio-{event}", "path": url_path(chosen), "type": "audio", "loop": event == "music"}
            used.add(chosen)
    unmatched = [url_path(path) for path in files if path not in used]
    return result, unmatched


def make_runtime_assets(heroes: list[dict], backgrounds: list[dict], tilesets: list[dict], sounds: dict) -> dict:
    assets = {}
    if heroes:
        hero = heroes[0]
        assets["player"] = {**hero, "key": "selected-player", "type": "spritesheet"}
    if backgrounds:
        bg = backgrounds[0]
        layer = bg["layers"][0]
        assets["backgroundFar"] = {"key": "selected-background-far", "path": layer["path"], "type": "image", "frameSize": bg["frameSize"], "frameCount": 1, "animations": {}, "parallaxSpeed": layer["speed"]}
    if tilesets:
        tileset = tilesets[0]
        assets["tileset"] = {**tileset, "type": "spritesheet", "animations": {}}
    for event, path in sounds.items():
        name = {"jump": "sfxJump", "hurt": "sfxHurt", "checkpoint": "sfxCheckpoint", "gateOpen": "sfxGateOpen", "correct": "sfxCorrect", "wrong": "sfxWrong", "finish": "sfxFinish", "music": "music"}[event]
        assets[name] = path
    return assets


def build_manifest() -> dict:
    SHEET_WARNINGS.clear()
    PACK_RENDER_SETTINGS_CACHE.clear()
    PACKS.mkdir(parents=True, exist_ok=True)
    packs_data = []
    all_heroes, all_enemies, all_backgrounds, all_tilesets = [], [], [], []
    sound_slots, unused = {}, []
    classified: set[Path] = set()
    pack_dirs = sorted(path for path in PACKS.iterdir() if path.is_dir() and not path.name.startswith("."))
    for pack in pack_dirs:
        generated = pack / ".generated"
        overrides = list_theme_overrides(pack)
        frames, recognized = load_image_records(pack, generated, overrides)
        classified |= recognized
        for path in pack.rglob("*"):
            if not path.is_file() or ".generated" in path.parts:
                continue
            category = category_for(path, overrides)
            if category or path.name.lower() in {"license.txt", "readme.txt", "readme.md", "theme.json", "sheet.json"} or path.name.lower().startswith(("preview", "sample")) or path.suffix.lower() == ".url":
                classified.add(path)
        render_settings = pack_render_settings(pack, overrides, frames)
        heroes = entity_records(pack, "characters", frames, overrides, generated, render_settings)
        enemies = entity_records(pack, "enemies", frames, overrides, generated, render_settings)
        backgrounds = background_records(frames, generated, overrides, render_settings)
        tilesets = tile_candidates(frames, generated, render_settings)
        sounds, unmatched_sounds = sound_records(pack)
        all_heroes.extend(heroes)
        all_enemies.extend(enemies)
        all_backgrounds.extend(backgrounds)
        all_tilesets.extend(tilesets)
        for event, asset in sounds.items():
            sound_slots.setdefault(event, asset)
        pack_id = re.sub(r"[^a-z0-9_-]+", "-", pack.name.lower())
        packs_data.append({
            "id": pack_id, "name": pack.name, "heroes": [item["id"] for item in heroes],
            "enemies": [item["id"] for item in enemies], "backgrounds": [item["id"] for item in backgrounds],
            "tilesets": [item["id"] for item in tilesets], "sounds": sounds, **render_settings,
        })
        # An unmatched sound is still a classified audio file, but report it as unassigned.
        classified.update(path for path in pack.rglob("*") if path.is_file() and path.suffix.lower() in {".ogg", ".wav", ".mp3"})
    if all_heroes:
        standard_width = max(item["tightBounds"]["width"] for item in all_heroes)
        standard_height = max(item["tightBounds"]["height"] for item in all_heroes)
        for hero in all_heroes:
            fw = hero["frameSize"]["width"]
            fh = hero["frameSize"]["height"]
            width = min(standard_width, fw)
            height = min(standard_height, fh)
            hero["hitbox"] = {"width": width, "height": height, "offsetX": (fw - width) / 2, "offsetY": fh - height}
    for pack in pack_dirs:
        for path in pack.rglob("*"):
            if not path.is_file() or ".generated" in path.parts or path in classified:
                continue
            unused.append(url_path(path))

    # Apply pack-level or nested overrides by id, including behavior and labels.
    for pack in pack_dirs:
        for _, data in list_theme_overrides(pack):
            for category, entries in data.items():
                if not isinstance(entries, dict):
                    continue
                target = {"heroes": all_heroes, "characters": all_heroes, "enemies": all_enemies, "backgrounds": all_backgrounds, "tilesets": all_tilesets}.get(category.lower())
                if target is None:
                    continue
                for item in target:
                    override = entries.get(item["id"])
                    if isinstance(override, dict):
                        item.update({key: value for key, value in override.items() if key in {"name", "behavior", "tileSize", "displayTileSize", "scale", "hitbox", "layered", "layers"}})

    all_tilesets.sort(key=lambda item: (item["id"] != "grass", item["name"]))
    all_heroes.sort(key=lambda item: (item["name"], item["id"]))
    all_enemies.sort(key=lambda item: (item["name"], item["id"]))
    all_backgrounds.sort(key=lambda item: item["name"])
    default_tileset = next((item for item in all_tilesets if item["id"] == "grass"), all_tilesets[0] if all_tilesets else None)
    default_pack = next((item for item in packs_data if item["id"] == "kenney-new-platformer-pack-1-1"), packs_data[0] if packs_data else {})
    manifest = {
        "activeTheme": "kenney",
        "tileSize": default_tileset.get("tileSize", default_pack.get("tileSize", 32)) if default_tileset else 32,
        "displayTileSize": 48,
        "rendering": {"pixelArt": bool(default_tileset.get("pixelArt", default_pack.get("pixelArt", False))) if default_tileset else False,
                      "filter": "nearest" if default_tileset and default_tileset.get("pixelArt") else "linear"},
        "assets": make_runtime_assets(all_heroes, all_backgrounds, all_tilesets, sound_slots),
        "heroes": all_heroes,
        "backgrounds": all_backgrounds,
        "tilesets": all_tilesets,
        "enemies": all_enemies,
        "enemySets": [{"id": pack["id"], "name": pack["name"], "enemyIds": pack["enemies"]} for pack in packs_data],
        "sounds": sound_slots,
        "unassignedSounds": sorted(path for pack in pack_dirs for path in sound_records(pack)[1]),
        "packs": packs_data,
        "unused": sorted(set(unused)),
    }
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Built {MANIFEST} from {len(pack_dirs)} pack(s): {len(all_heroes)} heroes, {len(all_enemies)} enemies, {len(all_backgrounds)} backgrounds, {len(all_tilesets)} tilesets, {len(sound_slots)} sound slots.")
    if manifest["unused"]:
        print("Unclassified files:")
        for path in manifest["unused"]:
            print(f" - {path}")
    else:
        print("Unclassified files: none")
    if SHEET_WARNINGS:
        print("Sheet validation warnings:")
        for warning in SHEET_WARNINGS:
            print(f" - {warning}")
    else:
        print("Sheet validation warnings: none")
    return manifest


def main() -> None:
    global ASSETS, PACKS, MANIFEST, PUBLIC
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets-dir", type=Path, default=ASSETS, help="Assets directory containing packs/ and manifest.json")
    args = parser.parse_args()
    ASSETS = args.assets_dir.resolve()
    PUBLIC = ASSETS.parent
    PACKS = ASSETS / "packs"
    MANIFEST = ASSETS / "manifest.json"
    build_manifest()


if __name__ == "__main__":
    main()
