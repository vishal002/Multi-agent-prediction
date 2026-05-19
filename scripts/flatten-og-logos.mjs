/**
 * Flatten transparent logo onto solid OG backgrounds (dark + light).
 * Satori/@vercel/og does not fill transparent PNG pixels against the card bg.
 *
 * Run: npm run og-logos
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "image");
const SIZE = 480;

const SOURCE_CANDIDATES = [
  path.join(ROOT, "image", "ai-cricket-war-room-logo.png"),
  path.join(ROOT, "ai-cricket-war-room-logo.png"),
];

/** Matches HOMEPAGE_OG_THEMES in server.mjs */
const THEMES = {
  dark: { hex: "#060a12", out: "og-logo-flat-dark.png", legacy: "og-logo-flat.png" },
  light: { hex: "#f4f6f8", out: "og-logo-flat-light.png" },
};

function parseHex(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    alpha: 1,
  };
}

function findSourceLogo() {
  for (const p of SOURCE_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * @param {string} source
 * @param {string} bgHex
 * @param {string} outPath
 */
async function flattenLogo(source, bgHex, outPath) {
  const bg = parseHex(bgHex);
  const inner = Math.round(SIZE * 0.88);
  const resized = await sharp(source)
    .resize(inner, inner, { fit: "inside", background: { ...bg, alpha: 0 } })
    .toBuffer();

  await sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: bg },
  })
    .composite([{ input: resized, gravity: "center" }])
    .png()
    .toFile(outPath);
}

async function main() {
  const source = findSourceLogo();
  if (!source) {
    console.error("Missing source logo. Expected one of:", SOURCE_CANDIDATES.join(", "));
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const [name, cfg] of Object.entries(THEMES)) {
    const outPath = path.join(OUT_DIR, cfg.out);
    await flattenLogo(source, cfg.hex, outPath);
    console.log("wrote", cfg.out, `(${name}, ${cfg.hex})`);
    if (cfg.legacy) {
      const legacyPath = path.join(OUT_DIR, cfg.legacy);
      fs.copyFileSync(outPath, legacyPath);
      console.log("wrote", cfg.legacy, "(legacy alias of dark)");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
