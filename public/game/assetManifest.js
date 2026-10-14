export const MANIFEST_PATH = "/assets/manifest.json";

export async function loadAssetManifest() {
  try {
    const response = await fetch(MANIFEST_PATH, { cache: "no-cache" });
    if (!response.ok) return null;
    const manifest = await response.json();
    if (!manifest || typeof manifest.activeTheme !== "string" || !manifest.assets || typeof manifest.assets !== "object") return null;
    return manifest;
  } catch {
    return null;
  }
}

export function getAssetPath(manifest, slot) {
  const entry = manifest?.assets?.[slot];
  if (!entry || typeof entry.path !== "string") return null;
  const theme = manifest.activeTheme || "moonlit";
  return entry.path.replaceAll("{theme}", encodeURIComponent(theme));
}

export function getAssetKey(manifest, slot) {
  const entry = manifest?.assets?.[slot];
  return typeof entry?.key === "string" ? entry.key : null;
}

export function loadImageFromManifest(manifest, slot) {
  const src = getAssetPath(manifest, slot);
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}
