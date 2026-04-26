/**
 * Serves the war room and proxies /api/messages → your LLM provider (hides keys, avoids CORS).
 *
 * FREE (recommended for this PoC): Groq — https://console.groq.com/keys
 *   export GROQ_API_KEY="gsk_..." && node server.mjs
 *
 * Other free-ish options you can wire similarly (not built in here):
 *   - Google Gemini (AI Studio): https://aistudio.google.com/apikey
 *   - OpenRouter: some models with $ in free credits
 *
 * Paid: Anthropic Claude
 *   export ANTHROPIC_API_KEY="sk-ant-..." && node server.mjs
 *
 * Pick provider explicitly (optional):
 *   LLM_PROVIDER=groq | anthropic
 * Groq models (defaults: 70B for judge/over JSON, 8B for intel/debate/live — saves TPD):
 *   GROQ_MODEL=llama-3.3-70b-versatile
 *   GROQ_MODEL_LIGHT=llama-3.1-8b-instant
 *
 * Open: http://localhost:3333/
 *
 * Match context (grounding): GET /api/match-context?label=&teams=&venue=&date= proxies to the Python
 * ingestion service (ESPNcricinfo + Cricbuzz RSS + CricAPI live scores). Start ingestion:
 *   pip install -r requirements-ingestion.txt
 *   python -m uvicorn ingestion_service.app:app --host 127.0.0.1 --port 3334
 * Override upstream URL: INGESTION_SERVICE_URL=http://127.0.0.1:3334
 *
 * CricAPI live scores (free tier — https://cricapi.com):
 *   export CRICAPI_KEY="your_key_here"   # set before starting ingestion service
 * Without CRICAPI_KEY the ingestion service falls back to RSS-only (ESPNcricinfo + Cricbuzz).
 *
 * Judge service (FastAPI predictions + accuracy): proxied for same-origin browser calls.
 *   pip install -r requirements-judge.txt
 *   python -m uvicorn judge_service.app:app --host 127.0.0.1 --port 8000
 * Override upstream URL: JUDGE_SERVICE_URL=http://127.0.0.1:8000
 *   POST /api/judge/predict → POST {JUDGE_SERVICE_URL}/predict
 *   GET /api/judge/accuracy → GET {JUDGE_SERVICE_URL}/accuracy
 *
 * Match autocomplete: GET /api/match-suggest?q=&limit=10 (reads match_suggestions.json).
 * Completed fixtures: optional { completed: true, result: { winner, summary } } — winner is a team code (e.g. CSK).
 * GET /api/match-by-label?label=… returns the full row for an exact label (404 if unknown).
 * Response: { suggestions: [{ label, date, venue, completed?, result? }] }.
 * With a non-empty q, results are filtered and sorted by fixture date (newest first), then venue.
 *
 * Short prediction links (no Mongo): POST /api/share-prediction → { id }; GET /api/share/:id → pack JSON;
 * GET /s/:id → 302 to /?sid=:id (pack persisted under data/share_predictions.json by default).
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3333;

const MATCH_SUGGESTIONS_PATH = path.join(__dirname, "match_suggestions.json");

/**
 * @param {unknown} raw
 * @returns {{ winner: string, summary: string } | null}
 */
function normalizeMatchResult(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const winner = o.winner != null ? String(o.winner).trim() : "";
  if (!winner) return null;
  const summary = o.summary != null ? String(o.summary).trim() : "";
  return { winner, summary };
}

/**
 * @param {unknown} parsed
 * @returns {{ label: string, date: string, venue: string, teams: string[], order: number, completed: boolean, result: { winner: string, summary: string } | null }[]}
 */
function normalizeMatchSuggestions(parsed) {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry, index) => {
      if (typeof entry === "string") {
        return {
          label: String(entry),
          date: "1970-01-01",
          venue: "",
          teams: [],
          order: index,
          completed: false,
          result: null,
        };
      }
      if (entry && typeof entry === "object") {
        const o = /** @type {Record<string, unknown>} */ (entry);
        const result = normalizeMatchResult(o.result);
        const completed = Boolean(o.completed) && result != null;
        return {
          label: String(o.label ?? ""),
          date: typeof o.date === "string" && o.date ? o.date : "1970-01-01",
          venue: String(o.venue ?? ""),
          teams: Array.isArray(o.teams) ? o.teams.map((t) => String(t)) : [],
          order: index,
          completed,
          result: completed ? result : null,
        };
      }
      return {
        label: "",
        date: "1970-01-01",
        venue: "",
        teams: [],
        order: index,
        completed: false,
        result: null,
      };
    })
    .filter((r) => r.label);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Avoid false positives (e.g. "ind" inside "Bindra") for short queries. */
function textMatchesSuggestQuery(text, qLower) {
  if (!qLower) return true;
  const raw = String(text);
  const t = raw.toLowerCase();
  if (qLower.length >= 4) return t.includes(qLower);
  try {
    return new RegExp(`\\b${escapeRegExp(qLower)}`, "i").test(raw);
  } catch {
    return t.includes(qLower);
  }
}

/**
 * @param {{ label: string, venue: string, teams: string[], date: string, completed?: boolean, result?: { winner: string, summary: string } | null }} row
 * @param {string} qLower trimmed lowercase query
 */
function matchSuggestionRowMatches(row, qLower) {
  if (!qLower) return true;
  if (textMatchesSuggestQuery(row.label, qLower) || textMatchesSuggestQuery(row.venue, qLower)) return true;
  return row.teams.some((t) => {
    const tl = t.toLowerCase();
    return tl === qLower || (qLower.length >= 2 && tl.startsWith(qLower));
  });
}

/** @param {string} label */
function iplMatchNumberFromLabel(label) {
  const m = String(label).match(/\bMatch\s+(\d+)\b/i);
  return m ? Number(m[1]) : 0;
}

/** Newest fixture date first; same date: lower Match N first (double-headers: afternoon before evening). */
function compareMatchSuggestionsNewestFirst(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const na = iplMatchNumberFromLabel(a.label);
  const nb = iplMatchNumberFromLabel(b.label);
  if (na !== nb) return na - nb;
  return a.venue.localeCompare(b.venue, undefined, { sensitivity: "base" });
}

const TEAM_SUGGEST_ALIASES = { KXIP: "PBKS", DD: "DC" };

/** @param {string} qRaw */
function normalizeMatchSuggestQuery(qRaw) {
  const raw = qRaw.trim();
  if (!raw) return "";
  const mapped = TEAM_SUGGEST_ALIASES[raw.toUpperCase()];
  return (mapped || raw).trim().toLowerCase();
}

/** @type {ReturnType<typeof normalizeMatchSuggestions>} */
let matchSuggestionsRows = [];
try {
  const raw = fs.readFileSync(MATCH_SUGGESTIONS_PATH, "utf8");
  const parsed = JSON.parse(raw);
  matchSuggestionsRows = normalizeMatchSuggestions(parsed);
} catch {
  console.warn("War room: match_suggestions.json missing or invalid — /api/match-suggest returns [].");
}

const GROQ_KEY = process.env.GROQ_API_KEY?.trim();
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY?.trim();
const LLM_PROVIDER = process.env.LLM_PROVIDER?.toLowerCase();

const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile";
/** Smaller/cheaper Groq model for short intel + live + misc turns (saves TPD vs 70B). */
const GROQ_MODEL_LIGHT = process.env.GROQ_MODEL_LIGHT?.trim() || "llama-3.1-8b-instant";
/**
 * Model used for the multi-round debate. Defaults to the 70B (12k TPM bucket on
 * Groq's free tier) so the debate transcript doesn't compete with the 8B intel
 * burst for the 6k TPM bucket. Override with GROQ_MODEL_DEBATE if needed.
 */
const GROQ_MODEL_DEBATE = process.env.GROQ_MODEL_DEBATE?.trim() || GROQ_MODEL;

const INGESTION_SERVICE_URL = (process.env.INGESTION_SERVICE_URL || "http://127.0.0.1:3334").replace(
  /\/$/,
  ""
);

const JUDGE_SERVICE_URL = (process.env.JUDGE_SERVICE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

function resolveProvider() {
  if (LLM_PROVIDER === "groq") return GROQ_KEY ? "groq" : null;
  if (LLM_PROVIDER === "anthropic") return ANTHROPIC_KEY ? "anthropic" : null;
  if (GROQ_KEY) return "groq";
  if (ANTHROPIC_KEY) return "anthropic";
  return null;
}

/** @type {string | null} */
let activeProvider = resolveProvider();

function contentToString(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && typeof b === "object" && "text" in b ? String(b.text) : "")).join("");
  }
  return String(content);
}

/** @param {string} route */
function groqModelForRoute(route) {
  if (route === "judge" || route === "over") return GROQ_MODEL;
  if (route === "debate") return GROQ_MODEL_DEBATE;
  return GROQ_MODEL_LIGHT;
}

/** @param {string} route */
function groqMaxTokensCap(route) {
  // intel: bumped from 96 → 240 to fit the merged 5-key JSON object.
  // debate: bumped from 160 → 220 — well under the 70B model's per-turn limits.
  const caps = { intel: 240, debate: 220, judge: 640, live: 140, over: 2200, misc: 1024 };
  return caps[route] ?? 1024;
}

/** @param {string} route */
function groqTemperature(route) {
  const t = { intel: 0.35, debate: 0.55, judge: 0.25, live: 0.2, over: 0.35, misc: 0.55 };
  return t[route] ?? 0.55;
}

/**
 * @param {Record<string, unknown>} anthropicJson
 * @param {string} route
 */
function anthropicBodyToGroq(anthropicJson, route) {
  const messages = [];
  const sys = anthropicJson.system;
  if (sys != null && String(sys).trim()) {
    messages.push({ role: "system", content: String(sys) });
  }
  for (const m of anthropicJson.messages || []) {
    const role = m.role === "assistant" ? "assistant" : "user";
    messages.push({ role, content: contentToString(m.content) });
  }
  const requested = Math.min(Number(anthropicJson.max_tokens) || 1024, 8192);
  const cap = groqMaxTokensCap(route);
  const body = {
    model: groqModelForRoute(route),
    messages,
    max_tokens: Math.min(requested, cap),
    temperature: groqTemperature(route),
  };
  if (route === "intel") {
    body.stop = ["\n\n", "\nUser:"];
  }
  return body;
}

function groqResponseToAnthropicShape(groqJson) {
  const text = groqJson.choices?.[0]?.message?.content ?? "";
  return {
    id: groqJson.id || "groq-msg",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: typeof text === "string" ? text : String(text) }],
    model: groqJson.model || GROQ_MODEL,
    stop_reason: "end_turn",
    usage: groqJson.usage,
  };
}

// ── Per-model concurrency + sliding-window TPM gate ────────────────────────
//
// Groq's free tier publishes per-model TPM caps. We defend against bursts
// (e.g. parallel intel calls) by:
//   1. Capping in-flight requests per model (MAX_INFLIGHT_PER_MODEL).
//   2. Tracking token usage in a 60s sliding window per model and sleeping
//      until the oldest entry expires when a request would push us over the
//      cap (minus a safety reserve).
//   3. Retrying transparent 429s up to MAX_429_RETRIES, parsing the wait
//      hint from the body ("try again in N.Ns") or the Retry-After header.
//
// All sleeps are capped at MAX_BACKOFF_MS so a stuck upstream cannot wedge a
// request indefinitely.
const GROQ_TPM = {
  "llama-3.1-8b-instant": 6000,
  "llama-3.3-70b-versatile": 12000,
};
const DEFAULT_TPM = 6000;
const RESERVE_TPM = 500;
const MAX_INFLIGHT_PER_MODEL = 2;
const MAX_429_RETRIES = 2;
const MAX_BACKOFF_MS = 30_000;

/** @type {Map<string, number>} model -> current in-flight count */
const inflightByModel = new Map();
/** @type {Map<string, { resolve: () => void }[]>} model -> FIFO of waiters */
const concurrencyWaiters = new Map();
/** @type {Map<string, { t: number, tokens: number }[]>} model -> entries in last 60s */
const tpmWindow = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** @param {string} model */
function acquireConcurrencySlot(model) {
  const current = inflightByModel.get(model) || 0;
  if (current < MAX_INFLIGHT_PER_MODEL) {
    inflightByModel.set(model, current + 1);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const queue = concurrencyWaiters.get(model) || [];
    queue.push({ resolve });
    concurrencyWaiters.set(model, queue);
  });
}

/** @param {string} model */
function releaseConcurrencySlot(model) {
  const queue = concurrencyWaiters.get(model);
  if (queue && queue.length) {
    const next = queue.shift();
    // Hand the slot off directly; in-flight count stays the same.
    next.resolve();
    return;
  }
  const current = inflightByModel.get(model) || 1;
  inflightByModel.set(model, Math.max(0, current - 1));
}

/** @param {string} model */
function pruneTpmWindow(model) {
  const cutoff = Date.now() - 60_000;
  const entries = tpmWindow.get(model) || [];
  let i = 0;
  while (i < entries.length && entries[i].t < cutoff) i++;
  if (i > 0) tpmWindow.set(model, entries.slice(i));
}

/** @param {string} model */
function tokensUsedInWindow(model) {
  pruneTpmWindow(model);
  const entries = tpmWindow.get(model) || [];
  let sum = 0;
  for (const e of entries) sum += e.tokens;
  return sum;
}

/**
 * Wait until the rolling 60s TPM bucket has room for `estTokens` (or capped wait).
 * @param {string} model
 * @param {number} estTokens
 */
async function awaitTpmHeadroom(model, estTokens) {
  const limit = (GROQ_TPM[model] ?? DEFAULT_TPM) - RESERVE_TPM;
  for (let i = 0; i < 6; i++) {
    pruneTpmWindow(model);
    const used = tokensUsedInWindow(model);
    if (used + estTokens <= limit) return;
    const entries = tpmWindow.get(model) || [];
    if (!entries.length) return;
    const oldest = entries[0];
    const waitMs = Math.min(MAX_BACKOFF_MS, Math.max(250, 60_000 - (Date.now() - oldest.t) + 100));
    console.warn(
      `[groq-gate] ${model} TPM ${used}/${limit} + est ${estTokens}; sleeping ${waitMs}ms`
    );
    await sleep(waitMs);
  }
}

/**
 * Parse Groq's "Please try again in 1.5s" or Retry-After header into ms.
 * @param {Response} response
 * @param {string} bodyText
 */
function parseRetryAfterMs(response, bodyText) {
  const header = response.headers.get("retry-after");
  if (header) {
    const n = Number(header);
    if (Number.isFinite(n) && n > 0) return Math.min(MAX_BACKOFF_MS, Math.ceil(n * 1000));
    const dateMs = Date.parse(header);
    if (Number.isFinite(dateMs)) {
      const delta = dateMs - Date.now();
      if (delta > 0) return Math.min(MAX_BACKOFF_MS, delta);
    }
  }
  // Body shapes: "try again in 1.5s", "try again in 850ms", "try again in 12s"
  const m = bodyText && bodyText.match(/try again in\s+([\d.]+)\s*(ms|s)\b/i);
  if (m) {
    const value = parseFloat(m[1]);
    if (Number.isFinite(value) && value > 0) {
      const ms = m[2].toLowerCase() === "ms" ? value : value * 1000;
      return Math.min(MAX_BACKOFF_MS, Math.ceil(ms));
    }
  }
  return null;
}

/** @param {{ messages?: { content?: unknown }[], max_tokens?: number }} groqBody */
function estimateTokens(groqBody) {
  let chars = 0;
  for (const msg of groqBody.messages || []) {
    chars += String(msg && msg.content != null ? msg.content : "").length;
  }
  return Math.ceil(chars / 4) + (Number(groqBody.max_tokens) || 0);
}

async function forwardGroq(anthropicBodyString) {
  let anthropicJson;
  try {
    anthropicJson = JSON.parse(anthropicBodyString);
  } catch {
    return { status: 400, body: JSON.stringify({ error: { message: "Invalid JSON body" } }) };
  }
  const routeRaw = anthropicJson.groq_route;
  delete anthropicJson.groq_route;
  const route = typeof routeRaw === "string" && routeRaw.trim() ? routeRaw.trim() : "misc";
  const groqBody = anthropicBodyToGroq(anthropicJson, route);
  const model = groqBody.model;
  const estTokens = estimateTokens(groqBody);

  await acquireConcurrencySlot(model);
  try {
    let lastStatus = 0;
    let lastBody = "";
    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
      await awaitTpmHeadroom(model, estTokens);
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_KEY}`,
        },
        body: JSON.stringify(groqBody),
      });
      const text = await r.text();
      lastStatus = r.status;
      lastBody = text;

      if (r.status === 429 && attempt < MAX_429_RETRIES) {
        const waitMs = parseRetryAfterMs(r, text) ?? Math.min(MAX_BACKOFF_MS, 1000 * (attempt + 1) ** 2);
        console.warn(
          `[groq-gate] ${model} 429 on attempt ${attempt + 1}/${MAX_429_RETRIES + 1}; sleeping ${waitMs}ms`
        );
        await sleep(waitMs);
        continue;
      }

      if (!r.ok) {
        return { status: r.status, body: text };
      }
      let groqJson;
      try {
        groqJson = JSON.parse(text);
      } catch {
        return {
          status: 502,
          body: JSON.stringify({ error: { message: "Groq returned non-JSON" } }),
        };
      }
      const usedTokens = Number(groqJson?.usage?.total_tokens) || estTokens;
      const entries = tpmWindow.get(model) || [];
      entries.push({ t: Date.now(), tokens: usedTokens });
      tpmWindow.set(model, entries);

      const shaped = groqResponseToAnthropicShape(groqJson);
      return { status: 200, body: JSON.stringify(shaped) };
    }
    // All retries exhausted on a 429 — surface the upstream response so the UI gets a meaningful error.
    return { status: lastStatus || 429, body: lastBody };
  } finally {
    releaseConcurrencySlot(model);
  }
}

async function forwardAnthropic(body) {
  let outbound = body;
  try {
    const j = JSON.parse(body);
    if (j && typeof j === "object" && "groq_route" in j) {
      delete j.groq_route;
      outbound = JSON.stringify(j);
    }
  } catch {
    /* not JSON — pass through */
  }
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: outbound,
  });
  const text = await r.text();
  return { status: r.status, body: text };
}

/**
 * Production layout: when SERVE_DIST=1, serve the prebuilt, hashed bundle from
 * dist/. We discover the file set at startup so we don't have to maintain a
 * hand-curated allowlist alongside the build script.
 *
 * Dev layout (default): serve raw source files from the project root, just like
 * before the build pipeline existed.
 */
const SERVE_DIST = process.env.SERVE_DIST === "1";
const STATIC_ROOT = SERVE_DIST ? path.join(__dirname, "dist") : __dirname;

/**
 * Hashed asset filename suffix from build.mjs (8-char SHA-256 prefix).
 * Files matching `name.HASH.{js,css}` are immutable — the URL changes whenever
 * the bytes change, so they can be cached forever.
 */
const HASHED_ASSET_RX = /\.[A-Z0-9]{8}\.(js|css)$/;

const DEV_STATIC_FILES = new Set([
  "ai_cricket_war_room.html",
  "disclaimer.html",
  "ai_cricket_war_room.css",
  "ai_cricket_war_room.js",
  "sw.js",
  "match_suggestions.json",
  "manifest.webmanifest",
  "sitemap.xml",
  "robots.txt",
  "favicon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "apple-touch-icon.png",
]);

/** @returns {Set<string>} relative POSIX paths under STATIC_ROOT we'll serve */
function buildDistAllowlist(root) {
  /** @type {Set<string>} */
  const out = new Set();
  /** @type {string[]} */
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      // Encoded siblings are picked up automatically based on the raw name; no
      // need to expose them as separately-routable URLs.
      if (ent.name.endsWith(".gz") || ent.name.endsWith(".br")) continue;
      const rel = path.relative(root, full).split(path.sep).join("/");
      out.add(rel);
    }
  }
  return out;
}

/** @type {Set<string> | null} */
let DIST_ALLOWLIST = null;
if (SERVE_DIST) {
  try {
    DIST_ALLOWLIST = buildDistAllowlist(STATIC_ROOT);
  } catch (e) {
    console.warn(`War room: SERVE_DIST=1 but dist/ is missing — run \`npm run build\`. (${e instanceof Error ? e.message : e})`);
    DIST_ALLOWLIST = new Set();
  }
}

/**
 * Resolve the version payload exposed at GET /api/version.
 *
 * In SERVE_DIST mode we read the build-manifest the build script writes
 * (single source of truth for the deployed bundle). In dev mode we synthesise
 * the same shape from package.json + a best-effort `git rev-parse` so the UI
 * footer stays populated while iterating locally.
 *
 * Resolved once at process start and reused across requests — version metadata
 * is immutable for the life of the process.
 */
function resolveVersionInfo() {
  const pkgPath = path.join(__dirname, "package.json");
  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    /* package.json missing in some weird container — fall through with empty */
  }

  if (SERVE_DIST) {
    const manifestPath = path.join(__dirname, "dist", "build-manifest.json");
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      return {
        appVersion: manifest.appVersion || pkg.version || "0.0.0",
        buildHash: manifest.buildHash || null,
        builtAt: manifest.builtAt || null,
        commit: manifest.git?.commit ?? null,
        commitShort: manifest.git?.commitShort ?? null,
        branch: manifest.git?.branch ?? null,
        dirty: manifest.git?.dirty ?? null,
        mode: "production",
      };
    } catch {
      /* fall through to dev-style payload — better than 500ing */
    }
  }

  // Dev (or prod-without-manifest) fallback: probe git directly.
  let commit = null;
  let branch = null;
  let dirty = null;
  try {
    commit = execSync("git rev-parse HEAD", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch { /* detached HEAD */ }
    try {
      dirty = execSync("git status --porcelain", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().length > 0;
    } catch { /* not a git repo */ }
  } catch {
    /* git missing or not a repo */
  }

  return {
    appVersion: pkg.version || "0.0.0",
    buildHash: null,
    builtAt: null,
    commit,
    commitShort: commit ? commit.slice(0, 7) : null,
    branch,
    dirty,
    mode: SERVE_DIST ? "production" : "development",
  };
}

const VERSION_INFO = resolveVersionInfo();
const VERSION_INFO_JSON = JSON.stringify(VERSION_INFO);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".map": "application/json; charset=utf-8",
};

const ENCODING_EXT = { br: ".br", gzip: ".gz" };

/**
 * Parse Accept-Encoding and pick the best precomputed sibling that exists on
 * disk. Brotli wins when both are available because it gives ~15-20% smaller
 * payloads than gzip for our text assets.
 *
 * @param {string} acceptEncoding raw header value
 * @param {string} filePath absolute path to the raw file
 * @returns {{ encoding: "br" | "gzip", path: string } | null}
 */
function pickEncoding(acceptEncoding, filePath) {
  if (!acceptEncoding) return null;
  const accepts = acceptEncoding.toLowerCase();
  // Don't compress images / source maps that won't get smaller, and don't
  // double-compress already-compressed assets.
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png" || ext === ".webp" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif") return null;
  if (accepts.includes("br")) {
    const p = filePath + ENCODING_EXT.br;
    if (fs.existsSync(p)) return { encoding: "br", path: p };
  }
  if (accepts.includes("gzip")) {
    const p = filePath + ENCODING_EXT.gzip;
    if (fs.existsSync(p)) return { encoding: "gzip", path: p };
  }
  return null;
}

/**
 * @param {string} relPath  path relative to STATIC_ROOT (POSIX-style)
 * @param {string} ext
 */
function cacheControlFor(relPath, ext) {
  const base = path.basename(relPath);
  if (HASHED_ASSET_RX.test(base)) return "public, max-age=31536000, immutable";
  if (base === "sw.js") return "no-cache";
  if (ext === ".html" || base === "manifest.webmanifest" || base === "match_suggestions.json") return "no-cache";
  if (relPath.startsWith("icons/")) return "public, max-age=86400";
  return "no-cache";
}

function safeJoin(root, reqPath) {
  const base = reqPath === "/" || reqPath === "" ? "ai_cricket_war_room.html" : reqPath.slice(1);
  const normalized = path.normalize(base).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = path.join(root, normalized);
  if (!full.startsWith(root)) return null;
  return full;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

// ── Short share links: POST pack → id; GET /s/:id → app with ?sid= ─────────
const SHARE_PREDICTION_STORE_PATH =
  process.env.SHARE_PREDICTION_STORE_PATH || path.join(__dirname, "data", "share_predictions.json");
const MAX_SHARE_PREDICTIONS = 5000;
const SHARE_ID_HEX_RX = /^[a-f0-9]{8}$/;

/** @type {Map<string, { created: number, pack: Record<string, unknown> }>} */
const sharePredictionById = new Map();

function loadSharePredictionsFromDisk() {
  try {
    if (!fs.existsSync(SHARE_PREDICTION_STORE_PATH)) return;
    const raw = fs.readFileSync(SHARE_PREDICTION_STORE_PATH, "utf8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    for (const row of arr) {
      if (!row || typeof row !== "object") continue;
      const id = String(row.id || "").trim().toLowerCase();
      if (!SHARE_ID_HEX_RX.test(id)) continue;
      const created = Number(row.created) || Date.now();
      const pack = row.pack;
      if (pack && typeof pack === "object") sharePredictionById.set(id, { created, pack });
    }
  } catch (e) {
    console.warn("[share-predictions] load:", e instanceof Error ? e.message : e);
  }
}

function persistSharePredictions() {
  try {
    const dir = path.dirname(SHARE_PREDICTION_STORE_PATH);
    fs.mkdirSync(dir, { recursive: true });
    let rows = [...sharePredictionById.entries()].map(([id, v]) => ({
      id,
      created: v.created,
      pack: v.pack,
    }));
    rows.sort((a, b) => a.created - b.created);
    while (rows.length > MAX_SHARE_PREDICTIONS) rows.shift();
    sharePredictionById.clear();
    for (const r of rows) sharePredictionById.set(r.id, { created: r.created, pack: r.pack });
    fs.writeFileSync(SHARE_PREDICTION_STORE_PATH, JSON.stringify(rows), "utf8");
  } catch (e) {
    console.warn("[share-predictions] persist:", e instanceof Error ? e.message : e);
  }
}

function pruneSharePredictionsIfNeeded() {
  if (sharePredictionById.size <= MAX_SHARE_PREDICTIONS) return;
  const sorted = [...sharePredictionById.entries()].sort((a, b) => a[1].created - b[1].created);
  while (sharePredictionById.size > MAX_SHARE_PREDICTIONS && sorted.length) {
    const [id] = sorted.shift();
    sharePredictionById.delete(id);
  }
}

/**
 * @param {unknown} body
 * @returns {Record<string, unknown> | null}
 */
function normalizeSharePredictionPack(body) {
  if (!body || typeof body !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (body);
  if (Number(o.v) !== 1) return null;
  const l = String(o.l ?? "").trim();
  const w = String(o.w ?? "").trim();
  if (!l || l.length > 520) return null;
  if (!w || w.length > 32) return null;
  const cRaw = Number(o.c);
  const c = Number.isFinite(cRaw) ? Math.min(100, Math.max(0, Math.round(cRaw))) : 55;
  /** @type {Record<string, unknown>} */
  const pack = { v: 1, l, w, c };
  const clip = (x, max) => {
    const s = String(x ?? "").trim();
    if (!s) return null;
    return s.length > max ? s.slice(0, max) : s;
  };
  const s = clip(o.s, 400);
  if (s) pack.s = s;
  const r = clip(o.r, 80);
  if (r) pack.r = r;
  const k = clip(o.k, 120);
  if (k) pack.k = k;
  const f = clip(o.f, 120);
  if (f) pack.f = f;
  return pack;
}

function newSharePredictionId() {
  for (let i = 0; i < 24; i++) {
    const id = crypto.randomBytes(4).toString("hex");
    if (!sharePredictionById.has(id)) return id;
  }
  return crypto.randomBytes(4).toString("hex");
}

loadSharePredictionsFromDisk();

/** Chat / social crawlers: return OG HTML for short links instead of a 302 to the SPA. */
function isSharePreviewBot(ua) {
  const s = String(ua || "").toLowerCase();
  return (
    s.includes("facebookexternalhit") ||
    s.includes("facebot") ||
    s.includes("whatsapp") ||
    s.includes("twitterbot") ||
    s.includes("linkedinbot") ||
    s.includes("slackbot") ||
    s.includes("telegrambot") ||
    s.includes("discordbot") ||
    s.includes("pinterest") ||
    s.includes("googlebot") ||
    s.includes("bingpreview") ||
    s.includes("embedly") ||
    s.includes("vkshare") ||
    s.includes("applebot")
  );
}

function escapeHtmlAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlPcdata(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeXmlText(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncateHard(s, max) {
  const t = String(s || "")
    .trim()
    .replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trim()}…`;
}

/**
 * 1200×1200 square: stacked Verdict + Debate cards with padding so square thumbnails
 * (e.g. WhatsApp) show both sections zoomed-out and readable — not a tight crop of a wide strip.
 * @param {Record<string, unknown>} pack
 */
function buildShareOgSvg(pack) {
  const team = String(pack.w || "—").toUpperCase();
  const c = Math.min(100, Math.max(0, Math.round(Number(pack.c) || 55)));
  const fixture = truncateHard(pack.l, 88);
  const summaryRaw = pack.s ? String(pack.s).trim().replace(/\s+/g, " ") : "";
  const cardW = 1136;
  const cardH = 548;
  const pad = 48;
  const barW = cardW - pad * 2;
  const barInner = Math.max(10, Math.round((barW * c) / 100));

  /** @type {string[]} */
  const sumLines = [];
  if (summaryRaw) {
    const maxL = 62;
    let pos = 0;
    for (let i = 0; i < 3 && pos < summaryRaw.length; i++) {
      sumLines.push(truncateHard(summaryRaw.slice(pos), maxL));
      pos += maxL;
    }
  }
  const summaryBlock =
    sumLines.length > 0
      ? `<text x="${pad}" y="268" fill="#cbd5e1" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="19">${sumLines
          .map((line, i) => `<tspan x="${pad}" dy="${i === 0 ? "0" : "28"}">${escapeXmlText(line)}</tspan>`)
          .join("")}</text>`
      : "";

  const bull1 = truncateHard(`Bull backs ${team}: momentum, matchups, and specialist intel.`, 48);
  const bull2 = truncateHard("Full multi-round argument in the app.", 48);
  const bear1 = truncateHard("Bear counters: risk factors, conditions, depth.", 48);
  const bear2 = truncateHard("See transcript for every rebuttal.", 48);

  const vCardY = 32;
  const cardGap = 16;
  const dCardY = vCardY + cardH + cardGap;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
  <defs>
    <linearGradient id="ogbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1220"/>
      <stop offset="1" stop-color="#020617"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="1200" fill="url(#ogbg)"/>

  <g transform="translate(32,${vCardY})">
    <rect width="${cardW}" height="${cardH}" rx="22" fill="#0f172a" stroke="#1e3a5f" stroke-width="2"/>
    <text x="${pad}" y="42" fill="#5eead4" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="17" font-weight="600">CRICKET WAR ROOM</text>
    <text x="${pad}" y="78" fill="#34d399" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="12" font-weight="700" letter-spacing="0.2em">JUDGE VERDICT</text>
    <text x="${pad}" y="148" fill="#f8fafc" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="40" font-weight="700">${escapeXmlText(team)} WINS</text>
    <text x="${pad}" y="188" fill="#94a3b8" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="17">${escapeXmlText(fixture)}</text>
    ${summaryBlock}
    <text x="${pad}" y="378" fill="#64748b" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="12" font-weight="600">MODEL CONFIDENCE (NOT WIN PROBABILITY)</text>
    <rect x="${pad}" y="394" width="${barW}" height="22" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1"/>
    <rect x="${pad}" y="394" width="${barInner}" height="22" rx="8" fill="#06b6d4"/>
    <text x="${pad}" y="458" fill="#e2e8f0" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="26" font-weight="700">${c}%</text>
  </g>

  <g transform="translate(32,${dCardY})">
    <rect width="${cardW}" height="${cardH}" rx="22" fill="#0f172a" stroke="#1e3a5f" stroke-width="2"/>
    <text x="${cardW / 2}" y="44" text-anchor="middle" fill="#94a3b8" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="13" font-weight="700" letter-spacing="0.18em">DEBATE</text>
    <line x1="${pad}" y1="58" x2="${cardW - pad}" y2="58" stroke="#334155" stroke-width="1"/>
    <text x="${pad}" y="102" fill="#fca5a5" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="17" font-weight="700">BULL</text>
    <text x="${pad}" y="132" fill="#e2e8f0" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="17">${escapeXmlText(bull1)}</text>
    <text x="${pad}" y="162" fill="#94a3b8" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="16">${escapeXmlText(bull2)}</text>
    <text x="${cardW / 2 + 24}" y="102" fill="#93c5fd" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="17" font-weight="700">BEAR</text>
    <text x="${cardW / 2 + 24}" y="132" fill="#e2e8f0" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="17">${escapeXmlText(bear1)}</text>
    <text x="${cardW / 2 + 24}" y="162" fill="#94a3b8" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="16">${escapeXmlText(bear2)}</text>
    <text x="${pad}" y="240" fill="#64748b" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="15">Four Bull vs Bear rounds, then Judge — open link for full replay.</text>
  </g>
</svg>`;
}

/**
 * @param {Record<string, unknown>} pack
 * @returns {Promise<Buffer>}
 */
async function renderShareOgPng(pack) {
  const svg = buildShareOgSvg(pack);
  return sharp(Buffer.from(svg, "utf8")).resize(1200, 1200).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * @param {import("http").ServerResponse} res
 * @param {URL} url
 * @param {string} id
 * @param {Record<string, unknown>} pack
 * @param {string} appHref e.g. /?sid=… or /s/id
 */
function sendShareOgHtml(res, url, id, pack, appHref) {
  const base = `${url.protocol}//${url.host}`;
  const canonical = `${base}/s/${id}`;
  const imgUrl = `${base}/api/og/share/${id}.png`;
  const w = String(pack.w || "").toUpperCase();
  const c = Math.min(100, Math.max(0, Math.round(Number(pack.c) || 55)));
  const title = `${w} wins — Cricket War Room`;
  const desc =
    (pack.s && truncateHard(String(pack.s), 220)) ||
    `Judge pick: ${w} at ${c}% model confidence. Open for Bull vs Bear debate and full verdict.`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtmlPcdata(title)}</title>
  <meta name="description" content="${escapeHtmlAttr(desc)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Cricket War Room" />
  <meta property="og:title" content="${escapeHtmlAttr(title)}" />
  <meta property="og:description" content="${escapeHtmlAttr(desc)}" />
  <meta property="og:url" content="${escapeHtmlAttr(canonical)}" />
  <meta property="og:image" content="${escapeHtmlAttr(imgUrl)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="1200" />
  <meta property="og:image:alt" content="Judge verdict and Bull vs Bear debate preview" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtmlAttr(title)}" />
  <meta name="twitter:description" content="${escapeHtmlAttr(desc)}" />
  <meta name="twitter:image" content="${escapeHtmlAttr(imgUrl)}" />
</head>
<body style="font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:2rem">
  <p><a href="${escapeHtmlAttr(appHref)}" style="color:#5eead4">Open this prediction in Cricket War Room</a></p>
</body>
</html>`;
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (
    req.method === "OPTIONS" &&
    (url.pathname === "/api/messages" ||
      url.pathname === "/api/match-suggest" ||
      url.pathname === "/api/match-by-label" ||
      url.pathname === "/api/match-context" ||
      url.pathname === "/api/live-score" ||
      url.pathname === "/api/judge/predict" ||
      url.pathname === "/api/judge/accuracy" ||
      url.pathname === "/api/version" ||
      url.pathname === "/api/share-prediction" ||
      url.pathname.startsWith("/api/share/") ||
      url.pathname.startsWith("/api/og/share/"))
  ) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/version") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      // Always fresh — version flips on every deploy and the payload is tiny.
      "Cache-Control": "no-cache",
    });
    res.end(VERSION_INFO_JSON);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/match-suggest") {
    const qRaw = (url.searchParams.get("q") || "").trim();
    const q = normalizeMatchSuggestQuery(qRaw);
    let limit = Number(url.searchParams.get("limit"));
    if (!Number.isFinite(limit)) limit = 10;
    limit = Math.min(Math.max(Math.floor(limit), 1), 100);
    const src = matchSuggestionsRows;
    let pool = src.filter((row) => matchSuggestionRowMatches(row, q));
    if (q) {
      pool = [...pool].sort(compareMatchSuggestionsNewestFirst);
    } else {
      pool = [...pool].sort((a, b) => a.order - b.order);
    }
    const suggestions = pool.slice(0, limit).map((r) => {
      const o = { label: r.label, date: r.date, venue: r.venue };
      if (r.completed && r.result) {
        o.completed = true;
        o.result = r.result;
      }
      return o;
    });
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60",
    });
    res.end(JSON.stringify({ suggestions }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/live-score") {
    // Fresh fetch (nocache=1) from the ingestion service so we always get latest RSS data.
    const teamsParam = url.searchParams.get("teams") || "";
    const labelParam = url.searchParams.get("label") || "";
    const target =
      `${INGESTION_SERVICE_URL}/api/match-context` +
      `?nocache=1&teams=${encodeURIComponent(teamsParam)}&label=${encodeURIComponent(labelParam)}`;
    const ctrl = AbortSignal.timeout(20_000);
    try {
      const r = await fetch(target, { method: "GET", signal: ctrl, headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();

      // Score / RRR patterns
      const SCORE_RX  = /\b\d{1,3}\/\d{1,2}\s*\([\d.]+/i;
      const RRR_RX    = /\b(RRR|req(?:uired)?\s*(?:run\s*)?rate)\s*[:\-]?\s*[\d.]+/i;
      const NEED_RX   = /\bneed\s+\d+\s+(runs?|more|in\s+\d+)/i;
      const CHASE_RX  = /\b(chasing|target\s*[:\-]?)\s*\d+/i;

      function scoreRichness(text) {
        let s = 0;
        if (SCORE_RX.test(text)) s += 4;
        if (RRR_RX.test(text))   s += 3;
        if (NEED_RX.test(text))  s += 3;
        if (CHASE_RX.test(text)) s += 2;
        if (/\b(live|score|update|inning|over)\b/i.test(text)) s += 1;
        return s;
      }

      // Use pre-extracted snippet from ingestion service if present
      const preExtracted = data.live_score_snippet || "";

      let best = preExtracted;
      let bestScore = preExtracted ? scoreRichness(preExtracted) : 0;

      // Also scan all news bullets ourselves (full text, not stripped)
      const bullets = Array.isArray(data.news_bullets) ? data.news_bullets : [];
      for (const b of bullets) {
        const plain = String(b).replace(/^\[[^\]]+\]\s*/, "").trim();
        const s = scoreRichness(plain);
        if (s > bestScore) { bestScore = s; best = plain; }
      }

      const snippet =
        bestScore >= 5 || (bestScore >= 4 && best && SCORE_RX.test(best)) ? best.slice(0, 400) : "";
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify({
          snippet,
          richness: bestScore,
          fetched_at: data.fetched_at || null,
          hint:
            !snippet && bestScore > 0
              ? "RSS had a weak score signal for this fixture; paste the score or set CRICAPI_KEY on the ingestion service."
              : null,
        })
      );
    } catch (e) {
      res.writeHead(503, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ snippet: "", error: e instanceof Error ? e.message : String(e) }));
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/match-context") {
    const target = `${INGESTION_SERVICE_URL}/api/match-context${url.search}`;
    const ctrl = AbortSignal.timeout(25_000);
    try {
      const r = await fetch(target, {
        method: "GET",
        signal: ctrl,
        headers: { Accept: "application/json" },
      });
      const text = await r.text();
      res.writeHead(r.status, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(text);
    } catch (e) {
      res.writeHead(503, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify({
          error: "ingestion_unreachable",
          message: e instanceof Error ? e.message : "Ingestion service unreachable",
          hint: "pip install -r requirements-ingestion.txt && python -m uvicorn ingestion_service.app:app --host 127.0.0.1 --port 3334",
        })
      );
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/judge/predict") {
    const target = `${JUDGE_SERVICE_URL}/predict`;
    let body;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ error: "invalid_body" }));
      return;
    }
    const ctrl = AbortSignal.timeout(120_000);
    try {
      const r = await fetch(target, {
        method: "POST",
        signal: ctrl,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: body && body.trim() ? body : "{}",
      });
      const text = await r.text();
      res.writeHead(r.status, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(text);
    } catch (e) {
      res.writeHead(503, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify({
          error: "judge_service_unreachable",
          message: e instanceof Error ? e.message : "Judge service unreachable",
          hint: "pip install -r requirements-judge.txt && python -m uvicorn judge_service.app:app --host 127.0.0.1 --port 8000",
        })
      );
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/judge/accuracy") {
    const target = `${JUDGE_SERVICE_URL}/accuracy`;
    // Judge on Render free tier can take 30s+ to cold-start; keep below Node fetch limits but above typical wake time.
    const ctrl = AbortSignal.timeout(90_000);
    try {
      const r = await fetch(target, {
        method: "GET",
        signal: ctrl,
        headers: { Accept: "application/json" },
      });
      const text = await r.text();
      res.writeHead(r.status, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(text);
    } catch (e) {
      res.writeHead(503, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify({
          error: "judge_service_unreachable",
          message: e instanceof Error ? e.message : "Judge service unreachable",
          hint: "pip install -r requirements-judge.txt && python -m uvicorn judge_service.app:app --host 127.0.0.1 --port 8000",
        })
      );
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/match-by-label") {
    const label = (url.searchParams.get("label") || "").trim();
    const dashNorm = (s) =>
      String(s)
        .trim()
        .replace(/[\u2013\u2014\-–]/g, "\u2014")
        .replace(/\s+/g, " ");
    const key = label ? dashNorm(label) : "";
    const row = label
      ? matchSuggestionsRows.find((r) => r.label === label) ||
        matchSuggestionsRows.find((r) => dashNorm(r.label) === key)
      : undefined;
    if (!row) {
      res.writeHead(404, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    const payload = {
      label: row.label,
      date: row.date,
      venue: row.venue,
      teams: row.teams,
      completed: row.completed,
      result: row.result,
    };
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60",
    });
    res.end(JSON.stringify({ match: payload }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/messages") {
    activeProvider = resolveProvider();

    if (!activeProvider) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          error: {
            type: "config",
            message:
              "No LLM key set. For a free API: export GROQ_API_KEY from https://console.groq.com — or use ANTHROPIC_API_KEY for Claude. Optional: LLM_PROVIDER=groq|anthropic",
          },
        })
      );
      return;
    }

    if (LLM_PROVIDER === "groq" && !GROQ_KEY) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: { message: "LLM_PROVIDER=groq but GROQ_API_KEY is empty." } }));
      return;
    }
    if (LLM_PROVIDER === "anthropic" && !ANTHROPIC_KEY) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({ error: { message: "LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty." } })
      );
      return;
    }

    let body;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: { message: "Invalid body" } }));
      return;
    }

    try {
      let result;
      if (activeProvider === "groq") {
        result = await forwardGroq(body);
      } else {
        result = await forwardAnthropic(body);
      }
      res.writeHead(result.status, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(result.body);
    } catch (e) {
      res.writeHead(502, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(
        JSON.stringify({
          error: { message: e instanceof Error ? e.message : "Proxy failed" },
        })
      );
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/share-prediction") {
    let raw = "";
    try {
      raw = await readBody(req);
    } catch {
      res.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ error: { message: "Empty body" } }));
      return;
    }
    if (raw.length > 48_000) {
      res.writeHead(413, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ error: { message: "Body too large" } }));
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ error: { message: "Invalid JSON" } }));
      return;
    }
    const pack = normalizeSharePredictionPack(parsed);
    if (!pack) {
      res.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ error: { message: "Invalid share payload" } }));
      return;
    }
    const id = newSharePredictionId();
    sharePredictionById.set(id, { created: Date.now(), pack });
    pruneSharePredictionsIfNeeded();
    persistSharePredictions();
    res.writeHead(201, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ id }));
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/share/")) {
    const id = url.pathname.slice("/api/share/".length).trim().toLowerCase();
    if (!SHARE_ID_HEX_RX.test(id)) {
      res.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ error: { message: "Invalid id" } }));
      return;
    }
    const row = sharePredictionById.get(id);
    if (!row) {
      res.writeHead(404, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ error: { message: "Not found" } }));
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(row.pack));
    return;
  }

  const ogShareMatch = url.pathname.match(/^\/api\/og\/share\/([a-f0-9]{8})\.png$/i);
  if ((req.method === "GET" || req.method === "HEAD") && ogShareMatch) {
    const ogId = ogShareMatch[1].toLowerCase();
    const ogRow = sharePredictionById.get(ogId);
    if (!ogRow) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    try {
      const png = await renderShareOgPng(ogRow.pack);
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=120",
        "Content-Length": String(png.length),
        "Access-Control-Allow-Origin": "*",
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(png);
    } catch (e) {
      console.warn("[og/share] render failed:", e instanceof Error ? e.message : e);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("OG render error");
    }
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }

  if (url.pathname.startsWith("/s/")) {
    const id = url.pathname.slice(3).trim().toLowerCase();
    if (!SHARE_ID_HEX_RX.test(id) || !sharePredictionById.has(id)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Share link not found");
      return;
    }
    const row = sharePredictionById.get(id);
    if (row && isSharePreviewBot(req.headers["user-agent"])) {
      sendShareOgHtml(res, url, id, row.pack, `/?sid=${encodeURIComponent(id)}`);
      return;
    }
    const absolute = `${url.protocol}//${url.host}/?sid=${encodeURIComponent(id)}`;
    res.writeHead(302, {
      Location: absolute,
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }

  const sidOnly = (url.searchParams.get("sid") || "").trim().toLowerCase();
  if (
    url.pathname === "/" &&
    sidOnly &&
    SHARE_ID_HEX_RX.test(sidOnly) &&
    sharePredictionById.has(sidOnly) &&
    isSharePreviewBot(req.headers["user-agent"])
  ) {
    const row2 = sharePredictionById.get(sidOnly);
    if (row2) {
      sendShareOgHtml(res, url, sidOnly, row2.pack, `/?sid=${encodeURIComponent(sidOnly)}`);
      return;
    }
  }

  const filePath = safeJoin(STATIC_ROOT, url.pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath);
  const relPath = path.relative(STATIC_ROOT, filePath).split(path.sep).join("/");

  const devStaticOk =
    DEV_STATIC_FILES.has(relPath) ||
    DEV_STATIC_FILES.has(path.basename(filePath)) ||
    relPath.startsWith("icons/") ||
    relPath.startsWith("image/");

  const allowed = SERVE_DIST ? DIST_ALLOWLIST != null && DIST_ALLOWLIST.has(relPath) : devStaticOk;

  if (!allowed) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": cacheControlFor(relPath, ext),
      Vary: "Accept-Encoding",
    };

    // Only negotiate encodings when serving the prebuilt bundle — dev mode
    // doesn't have .br/.gz siblings on disk.
    const picked = SERVE_DIST ? pickEncoding(req.headers["accept-encoding"] || "", filePath) : null;
    if (picked) {
      try {
        const encStat = fs.statSync(picked.path);
        headers["Content-Encoding"] = picked.encoding;
        headers["Content-Length"] = String(encStat.size);
        res.writeHead(200, headers);
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        fs.createReadStream(picked.path).pipe(res);
        return;
      } catch {
        /* fall through to raw */
      }
    }

    headers["Content-Length"] = String(st.size);
    res.writeHead(200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`War room: http://localhost:${PORT}/`);
  activeProvider = resolveProvider();
  if (activeProvider === "groq") {
    console.log(
      `LLM: Groq — heavy ${GROQ_MODEL} / light ${GROQ_MODEL_LIGHT} (set GROQ_MODEL_LIGHT to tune TPD) — console.groq.com`
    );
  } else if (activeProvider === "anthropic") {
    console.log("LLM: Anthropic Claude");
  } else {
    console.log("Warning: set GROQ_API_KEY (free) or ANTHROPIC_API_KEY.");
  }

  void (async () => {
    try {
      const r = await fetch(`${INGESTION_SERVICE_URL}/healthz`, { signal: AbortSignal.timeout(2500) });
      if (!r.ok) console.warn(`Ingestion service at ${INGESTION_SERVICE_URL} returned HTTP ${r.status} — live scores & match context need: pip install -r requirements-ingestion.txt && python -m uvicorn ingestion_service.app:app --host 127.0.0.1 --port 3334`);
    } catch {
      console.warn(
        `Ingestion service unreachable (${INGESTION_SERVICE_URL}) — live RSS scores and /api/match-context will fail until you run: pip install -r requirements-ingestion.txt && python -m uvicorn ingestion_service.app:app --host 127.0.0.1 --port 3334`
      );
    }
    try {
      const r = await fetch(`${JUDGE_SERVICE_URL}/accuracy`, { signal: AbortSignal.timeout(2500) });
      if (!r.ok) console.warn(`Judge service at ${JUDGE_SERVICE_URL} returned HTTP ${r.status} — /api/judge/predict will not work until the Judge API is healthy.`);
    } catch {
      console.warn(
        `Judge service unreachable (${JUDGE_SERVICE_URL}) — POST /api/judge/predict returns 503 until you run: pip install -r requirements-judge.txt && python -m uvicorn judge_service.app:app --host 127.0.0.1 --port 8000`
      );
    }
  })();
});
