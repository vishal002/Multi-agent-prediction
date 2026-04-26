/**
 * Production build pipeline for the war room front-end.
 *
 * Outputs go to dist/:
 *   - ai_cricket_war_room.[hash].js      (esbuild minified + sourcemap)
 *   - ai_cricket_war_room.[hash].css     (esbuild minified)
 *   - ai_cricket_war_room.html           (html-minifier-terser, refs rewritten to hashed names)
 *   - sw.js                              (PRECACHE_URLS rewritten + STATIC_ASSET_VERSION = build hash)
 *   - match_suggestions.json, manifest.webmanifest, icons/*, image/*  (copied verbatim, stable URLs)
 *   - build-manifest.json                (original → hashed map)
 *   - <file>.gz / <file>.br              (precomputed text-asset siblings)
 *
 * Run via `npm run build`. Server picks dist/ up when SERVE_DIST=1.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as esbuild from "esbuild";
import { minify as minifyHtml } from "html-minifier-terser";

const gzip = promisify(zlib.gzip);
const brotli = promisify(zlib.brotliCompress);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const HTML_ENTRY = "ai_cricket_war_room.html";
const JS_ENTRY = "ai_cricket_war_room.js";
const CSS_ENTRY = "ai_cricket_war_room.css";
const SW_ENTRY = "sw.js";

const COPY_FILES = ["match_suggestions.json", "manifest.webmanifest", "sitemap.xml", "robots.txt"];
const COPY_DIRS = ["icons", "image"];

// Brotli tuning: quality 11 + text mode is the heaviest setting; fine for a one-shot build.
const BROTLI_OPTS = {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
  },
};
const COMPRESS_EXTS = new Set([".html", ".css", ".js", ".json", ".svg", ".webmanifest", ".map"]);

function rmDistSync() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
}

function copyFileToDist(rel) {
  const src = path.join(ROOT, rel);
  const dst = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyDirToDist(rel) {
  const src = path.join(ROOT, rel);
  const dst = path.join(DIST, rel);
  fs.cpSync(src, dst, { recursive: true });
}

/**
 * Minify a single entry with esbuild and emit it under dist/ with a content-hash
 * in the filename. Returns { hashedName, sizeBefore, sizeAfter }.
 *
 * @param {{ entry: string, loader: "js" | "css" }} opts
 */
async function buildAsset({ entry, loader }) {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: false,
    minify: true,
    sourcemap: true,
    target: ["es2020"],
    write: false,
    outdir: DIST,
    loader: { ".js": "js", ".css": "css" },
    legalComments: "none",
    logLevel: "warning",
  });

  // esbuild gives us 2 files (asset + sourcemap). Hash by the asset's content.
  const assetExt = loader === "css" ? ".css" : ".js";
  const assetFile = result.outputFiles.find((f) => f.path.endsWith(assetExt));
  const mapFile = result.outputFiles.find((f) => f.path.endsWith(".map"));
  if (!assetFile) throw new Error(`esbuild produced no ${assetExt} for ${entry}`);

  const hash = crypto.createHash("sha256").update(assetFile.contents).digest("hex").slice(0, 8).toUpperCase();
  const baseNoExt = path.basename(entry, path.extname(entry));
  const hashedName = `${baseNoExt}.${hash}${assetExt}`;
  const outPath = path.join(DIST, hashedName);
  const mapName = `${hashedName}.map`;

  // Rewrite the //# sourceMappingURL line so it points at the hashed map.
  let assetText = Buffer.from(assetFile.contents).toString("utf8");
  if (mapFile) {
    const oldRef = `${path.basename(assetFile.path)}.map`;
    if (assetText.includes(oldRef)) {
      assetText = assetText.replace(oldRef, mapName);
    } else {
      // Fall back: append a sourceMappingURL comment if esbuild stripped/omitted it.
      const comment = loader === "css" ? `\n/*# sourceMappingURL=${mapName} */` : `\n//# sourceMappingURL=${mapName}`;
      assetText = assetText + comment;
    }
  }

  fs.writeFileSync(outPath, assetText);
  if (mapFile) fs.writeFileSync(path.join(DIST, mapName), mapFile.contents);

  const sizeBefore = fs.statSync(path.join(ROOT, entry)).size;
  const sizeAfter = Buffer.byteLength(assetText);
  return { hashedName, sizeBefore, sizeAfter };
}

/**
 * Rewrite the HTML to point at the hashed asset names and minify it.
 * The plan calls out specific lines (23 / 409) but we use a tag-aware regex
 * so the build won't silently break if the file is reformatted.
 *
 * @param {Record<string, string>} hashed map of original filename → hashed filename
 */
async function buildHtml(hashed) {
  let html = fs.readFileSync(path.join(ROOT, HTML_ENTRY), "utf8");

  const cssHashed = hashed[CSS_ENTRY];
  const jsHashed = hashed[JS_ENTRY];

  // <link rel="stylesheet" href="/ai_cricket_war_room.css" /> (leading / optional)
  html = html.replace(
    /(<link\b[^>]*\bhref=)(["'])\/?ai_cricket_war_room\.css\2/g,
    (_m, pre, q) => `${pre}${q}/${cssHashed}${q}`
  );
  // <script src="/ai_cricket_war_room.js"></script>
  html = html.replace(
    /(<script\b[^>]*\bsrc=)(["'])\/?ai_cricket_war_room\.js\2/g,
    (_m, pre, q) => `${pre}${q}/${jsHashed}${q}`
  );

  const minified = await minifyHtml(html, {
    collapseWhitespace: true,
    removeComments: true,
    conservativeCollapse: true,
    minifyCSS: true,
    minifyJS: true,
    decodeEntities: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    sortAttributes: true,
    sortClassName: true,
  });

  fs.writeFileSync(path.join(DIST, HTML_ENTRY), minified);
  return { sizeBefore: Buffer.byteLength(html), sizeAfter: Buffer.byteLength(minified) };
}

/**
 * Rewrite sw.js so PRECACHE_URLS points at hashed files and STATIC_ASSET_VERSION
 * matches the current build (so the activate handler evicts the previous bucket).
 *
 * @param {Record<string, string>} hashed
 * @param {string} buildVersion
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Best-effort git metadata for the build manifest. Returns nulls if git isn't
 * available (e.g. when building from a tarball inside Docker without .git).
 *
 * @returns {{ commit: string | null, commitShort: string | null, branch: string | null, dirty: boolean | null }}
 */
function readGitInfo() {
  const run = (args) => execSync(`git ${args}`, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  try {
    const commit = run("rev-parse HEAD");
    const branch = (() => { try { return run("rev-parse --abbrev-ref HEAD"); } catch { return null; } })();
    const dirty = (() => { try { return run("status --porcelain").length > 0; } catch { return null; } })();
    return { commit, commitShort: commit.slice(0, 7), branch, dirty };
  } catch {
    return { commit: null, commitShort: null, branch: null, dirty: null };
  }
}

function buildSw(hashed, buildVersion) {
  let sw = fs.readFileSync(path.join(ROOT, SW_ENTRY), "utf8");

  sw = sw.replace(
    /(STATIC_ASSET_VERSION\s*=\s*)(["'])[^"']+\2/,
    (_m, pre, q) => `${pre}${q}${buildVersion}${q}`
  );

  for (const [orig, hash] of Object.entries(hashed)) {
    const re = new RegExp(`/${escapeRegExp(orig)}(?=["'])`, "g");
    sw = sw.replace(re, `/${hash}`);
  }

  fs.writeFileSync(path.join(DIST, SW_ENTRY), sw);
  return { sizeBefore: fs.statSync(path.join(ROOT, SW_ENTRY)).size, sizeAfter: Buffer.byteLength(sw) };
}

/** Walk dist/ and emit .gz + .br siblings for compressible text assets. */
async function emitCompressedSiblings() {
  /** @type {string[]} */
  const queue = [DIST];
  /** @type {string[]} */
  const targets = [];
  while (queue.length) {
    const dir = queue.pop();
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        queue.push(full);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (COMPRESS_EXTS.has(ext)) targets.push(full);
      }
    }
  }

  await Promise.all(
    targets.map(async (file) => {
      const buf = fs.readFileSync(file);
      // Skip tiny payloads — Brotli/gzip framing overhead would make the sibling
      // bigger than the original, and clients hit the raw file just as fast.
      if (buf.length < 256) return;
      const [gz, br] = await Promise.all([gzip(buf, { level: 9 }), brotli(buf, BROTLI_OPTS)]);
      if (gz.length < buf.length) fs.writeFileSync(`${file}.gz`, gz);
      if (br.length < buf.length) fs.writeFileSync(`${file}.br`, br);
    })
  );
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
  const t0 = Date.now();
  rmDistSync();

  const [jsOut, cssOut] = await Promise.all([
    buildAsset({ entry: JS_ENTRY, loader: "js" }),
    buildAsset({ entry: CSS_ENTRY, loader: "css" }),
  ]);

  const hashed = {
    [JS_ENTRY]: jsOut.hashedName,
    [CSS_ENTRY]: cssOut.hashedName,
  };

  // Combine the two content hashes into a stable build version so the SW cache
  // bucket name changes whenever any precached asset changes.
  const buildVersion = crypto
    .createHash("sha256")
    .update(jsOut.hashedName + "|" + cssOut.hashedName)
    .digest("hex")
    .slice(0, 12)
    .toLowerCase();

  const htmlOut = await buildHtml(hashed);
  const swOut = buildSw(hashed, buildVersion);

  for (const f of COPY_FILES) copyFileToDist(f);
  for (const d of COPY_DIRS) copyDirToDist(d);

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const git = readGitInfo();

  const manifest = {
    name: pkg.name,
    appVersion: pkg.version || "0.0.0",
    buildHash: buildVersion,
    builtAt: new Date().toISOString(),
    git,
    assets: hashed,
  };
  fs.writeFileSync(path.join(DIST, "build-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  await emitCompressedSiblings();

  const elapsed = Date.now() - t0;
  console.log(`✓ build complete in ${elapsed} ms (version ${buildVersion})`);
  console.log(
    `  js   ${JS_ENTRY.padEnd(28)} ${fmtBytes(jsOut.sizeBefore).padStart(10)} → ${fmtBytes(jsOut.sizeAfter).padStart(10)}  (${jsOut.hashedName})`
  );
  console.log(
    `  css  ${CSS_ENTRY.padEnd(28)} ${fmtBytes(cssOut.sizeBefore).padStart(10)} → ${fmtBytes(cssOut.sizeAfter).padStart(10)}  (${cssOut.hashedName})`
  );
  console.log(
    `  html ${HTML_ENTRY.padEnd(28)} ${fmtBytes(htmlOut.sizeBefore).padStart(10)} → ${fmtBytes(htmlOut.sizeAfter).padStart(10)}`
  );
  console.log(
    `  sw   ${SW_ENTRY.padEnd(28)} ${fmtBytes(swOut.sizeBefore).padStart(10)} → ${fmtBytes(swOut.sizeAfter).padStart(10)}`
  );
}

main().catch((err) => {
  console.error("✗ build failed:", err);
  process.exit(1);
});
