/**
 * Rasterizes ai-cricket-war-room-logo.png into PWA / favicon / Apple touch PNGs.
 * Requires: npm install (devDependency sharp). Run: npm run icons
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "icons");
/** Wide logo asset (file may be .png but can contain JPEG data). */
const LOGO = path.join(ROOT, "ai-cricket-war-room-logo.png");

const BG = { r: 7, g: 11, b: 18, alpha: 1 };

/**
 * @param {string} filename
 * @param {number} size
 * @param {{ maskable?: boolean }} [opts]
 */
async function writeSquareIcon(filename, size, opts = {}) {
  const { maskable = false } = opts;
  /** Fraction of canvas used for logo bbox (rest is padding / safe zone). */
  const inner = Math.round(size * (maskable ? 0.52 : 0.86));
  const resized = await sharp(LOGO)
    .resize(inner, inner, { fit: "inside", background: BG })
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: resized, gravity: "center" }])
    .png()
    .toFile(path.join(OUT, filename));

  console.log("wrote", filename, size, "x", size, maskable ? "(maskable)" : "");
}

async function main() {
  if (!fs.existsSync(LOGO)) {
    console.error("Missing logo:", LOGO);
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  await writeSquareIcon("icon-192.png", 192);
  await writeSquareIcon("icon-512.png", 512);
  await writeSquareIcon("icon-maskable-512.png", 512, { maskable: true });
  await writeSquareIcon("apple-touch-icon.png", 180);
  await writeSquareIcon("favicon.png", 32);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
