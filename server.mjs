/**
 * Serves the war room and proxies /api/messages → your LLM provider (hides keys, avoids CORS).
 *
 * FREE (recommended for this PoC): Groq — https://console.groq.com/keys
 *   export GROQ_API_KEY="gsk_..." && node server.mjs
 *
 * Google Gemini (optional fallback or primary): https://aistudio.google.com/apikey
 *   export GEMINI_API_KEY="..."   # or GOOGLE_API_KEY
 *   With GROQ_API_KEY set, Groq is tried first; on rate limits / quota-style errors the
 *   proxy retries once via Gemini when a Gemini key is present.
 *   LLM_PROVIDER=gemini forces Gemini only (no Groq).
 *
 * Paid: Anthropic Claude
 *   export ANTHROPIC_API_KEY="sk-ant-..." && node server.mjs
 *
 * Pick provider explicitly (optional):
 *   LLM_PROVIDER=groq | anthropic | gemini
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
 *   GET /api/judge/accuracy → GET {JUDGE_SERVICE_URL}/accuracy (in-process cache + upstream 429/5xx retries; JUDGE_ACCURACY_CACHE_MS)
 *
 * Match autocomplete: GET /api/match-suggest?q=&limit=10 (reads match_suggestions.json).
 * Completed fixtures: optional { completed: true, result: { winner, summary } } — winner is a team code (e.g. CSK).
 * GET /api/match-by-label?label=… returns the full row for an exact label (404 if unknown).
 * Response: { suggestions: [{ label, date, venue, completed?, result? }] }.
 * With a non-empty q, results are filtered and sorted by fixture date (newest first), then venue.
 *
 * Short prediction links (no Mongo): POST /api/share-prediction → { id }; GET /api/share/:id → pack JSON;
 * GET /s/:id → 302 to /?sid=:id (pack persisted under data/share_predictions.json by default).
 * Open Graph PNGs (1200×630, Sharp): GET /og-homepage.png (site preview); GET /api/og/share/{id}.png (per share).
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
/** AI Studio / Gemini API (same key as Google often labels GOOGLE_API_KEY). */
const GEMINI_KEY = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
/**
 * Default avoids gemini-2.0-flash: many AI Studio projects show free-tier "limit: 0" for 2.0 on
 * generate_content_free_tier_* metrics. Override GEMINI_MODEL / GEMINI_MODEL_FALLBACK as needed.
 */
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
/** Comma-separated extra model ids to try after GEMINI_MODEL on quota / 429 (see forwardGemini). */
const GEMINI_MODEL_FALLBACK = process.env.GEMINI_MODEL_FALLBACK?.trim();
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

/** Optional: require `Authorization: Bearer <secret>` on POST /api/messages and POST /api/judge/predict. */
const WAR_ROOM_API_SECRET = (process.env.WAR_ROOM_API_SECRET || "").trim();
/** Forwarded to Judge on proxied requests when set (Judge must set same `JUDGE_SERVICE_SECRET`). */
const JUDGE_SERVICE_SECRET = (process.env.JUDGE_SERVICE_SECRET || "").trim();
const TRUST_PROXY = process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true";

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MAX_BODY_MESSAGES_BYTES = Math.min(
  8 * 1024 * 1024,
  Math.max(64 * 1024, Number(process.env.MAX_BODY_MESSAGES_BYTES) || 1024 * 1024)
);
const MAX_BODY_JUDGE_BYTES = Math.min(
  8 * 1024 * 1024,
  Math.max(64 * 1024, Number(process.env.MAX_BODY_JUDGE_BYTES) || 2 * 1024 * 1024)
);
const MAX_BODY_SHARE_BYTES = 48_000;

const RL_MESSAGES_PER_MIN = Math.max(0, Number(process.env.RL_MESSAGES_PER_MIN) || 30);
const RL_JUDGE_PER_MIN = Math.max(0, Number(process.env.RL_JUDGE_PER_MIN) || 15);
/** In-process cache for GET /api/judge/accuracy → fewer upstream hits (Render cold start / edge 429). 0 = disabled. */
const JUDGE_ACCURACY_CACHE_MS = Math.max(0, Number(process.env.JUDGE_ACCURACY_CACHE_MS) || 10_000);
/** Extra attempts after the first upstream GET /accuracy (429/502/503/504 only). */
const JUDGE_ACCURACY_UPSTREAM_MAX_RETRIES = Math.max(0, Math.floor(Number(process.env.JUDGE_ACCURACY_UPSTREAM_MAX_RETRIES) || 3));

const VERSION_INFO_MINIMAL =
  process.env.VERSION_INFO_MINIMAL === "1" ||
  process.env.VERSION_INFO_MINIMAL === "true" ||
  process.env.NODE_ENV === "production";

/**
 * @param {import("http").IncomingMessage} req
 * @returns {string}
 */
function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.trim()) {
      const first = xff.split(",")[0].trim();
      if (first) return first;
    }
  }
  return req.socket?.remoteAddress || "unknown";
}

/** @type {Map<string, { t: number }[]>} */
const _rlMessages = new Map();
/** @type {Map<string, { t: number }[]>} */
const _rlJudge = new Map();

/** @type {{ text: string, at: number } | null} */
let judgeAccuracyCache = null;

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {Headers} headers
 * @returns {number | null}
 */
function parseRetryAfterMsFromHeaders(headers) {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const sec = Number(raw.trim());
  if (Number.isFinite(sec)) return Math.min(120_000, Math.max(0, sec * 1000));
  const d = Date.parse(raw.trim());
  if (Number.isFinite(d)) return Math.min(120_000, Math.max(0, d - Date.now()));
  return null;
}

/** @param {number} status */
function judgeAccuracyUpstreamTransient(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * GET {JUDGE_SERVICE_URL}/accuracy with cold-start–friendly timeout and 429/5xx retries.
 * @returns {Promise<{ ok: true, text: string } | { ok: false, status: number, text: string }>}
 */
async function fetchJudgeAccuracyFromUpstream() {
  const target = `${JUDGE_SERVICE_URL}/accuracy`;
  const maxAttempts = JUDGE_ACCURACY_UPSTREAM_MAX_RETRIES + 1;
  let lastStatus = 503;
  let lastText = "";
  for (let i = 0; i < maxAttempts; i++) {
    const r = await fetch(target, {
      method: "GET",
      signal: AbortSignal.timeout(90_000),
      headers: { Accept: "application/json", ...judgeUpstreamAuthHeaders() },
    });
    lastStatus = r.status;
    lastText = await r.text();
    if (r.ok) return { ok: true, text: lastText };
    if (i < maxAttempts - 1 && judgeAccuracyUpstreamTransient(r.status)) {
      const pauseMs =
        r.status === 429
          ? parseRetryAfterMsFromHeaders(r.headers) ?? Math.min(45_000, 2500 * (i + 1) ** 2)
          : 3000;
      await sleepMs(pauseMs);
    } else {
      return { ok: false, status: lastStatus, text: lastText };
    }
  }
  return { ok: false, status: lastStatus, text: lastText };
}

function pruneRlEntries(map, ip, windowMs) {
  const now = Date.now();
  const arr = map.get(ip);
  if (!arr) return [];
  const kept = arr.filter((e) => now - e.t < windowMs);
  if (kept.length) map.set(ip, kept);
  else map.delete(ip);
  return kept;
}

/**
 * @param {string} ip
 * @param {"messages" | "judge"} kind
 * @returns {{ ok: boolean }}
 */
function rateLimitAllow(ip, kind) {
  const windowMs = 60_000;
  const limit = kind === "messages" ? RL_MESSAGES_PER_MIN : RL_JUDGE_PER_MIN;
  if (!limit) return { ok: true };
  const map = kind === "messages" ? _rlMessages : _rlJudge;
  const entries = pruneRlEntries(map, ip, windowMs);
  if (entries.length >= limit) return { ok: false };
  entries.push({ t: Date.now() });
  map.set(ip, entries);
  return { ok: true };
}

/**
 * @param {import("http").IncomingMessage} req
 * @returns {Record<string, string>}
 */
function corsHeaders(req) {
  if (!ALLOWED_ORIGINS.length) {
    return { "Access-Control-Allow-Origin": "*" };
  }
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
  return {};
}

/**
 * @param {import("http").IncomingMessage} req
 * @returns {boolean}
 */
function warRoomBearerOk(req) {
  if (!WAR_ROOM_API_SECRET) return true;
  const h = req.headers.authorization;
  if (!h || typeof h !== "string") return false;
  const m = h.match(/^\s*Bearer\s+(.+)$/i);
  return Boolean(m && m[1].trim() === WAR_ROOM_API_SECRET);
}

/**
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @returns {boolean} true if caller should continue
 */
function denyUnlessWarRoomSecret(req, res) {
  if (warRoomBearerOk(req)) return true;
  res.writeHead(401, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(req),
  });
  res.end(JSON.stringify({ error: { message: "Unauthorized — set Authorization: Bearer or unset WAR_ROOM_API_SECRET." } }));
  return false;
}

/**
 * @returns {Record<string, string>}
 */
function judgeUpstreamAuthHeaders() {
  if (!JUDGE_SERVICE_SECRET) return {};
  return { Authorization: `Bearer ${JUDGE_SERVICE_SECRET}` };
}

/**
 * @param {import("http").IncomingMessage} req
 * @param {{ maxBytes: number }} opts
 * @returns {Promise<{ ok: true; body: string } | { ok: false; code: "payload_too_large" }>}
 */
async function readBody(req, opts) {
  const maxBytes = opts.maxBytes;
  const chunks = [];
  let total = 0;
  try {
    for await (const c of req) {
      total += c.length;
      if (total > maxBytes) {
        return { ok: false, code: "payload_too_large" };
      }
      chunks.push(c);
    }
  } catch {
    return { ok: false, code: "payload_too_large" };
  }
  return { ok: true, body: Buffer.concat(chunks).toString("utf8") };
}

function resolveProvider() {
  if (LLM_PROVIDER === "groq") return GROQ_KEY ? "groq" : null;
  if (LLM_PROVIDER === "anthropic") return ANTHROPIC_KEY ? "anthropic" : null;
  if (LLM_PROVIDER === "gemini") return GEMINI_KEY ? "gemini" : null;
  if (GROQ_KEY) return "groq";
  if (ANTHROPIC_KEY) return "anthropic";
  if (GEMINI_KEY) return "gemini";
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

/**
 * @param {Record<string, unknown>} anthropicJson
 * @param {string} route
 */
function anthropicBodyToGemini(anthropicJson, route) {
  const requested = Math.min(Number(anthropicJson.max_tokens) || 1024, 8192);
  const cap = groqMaxTokensCap(route);
  const maxOutputTokens = Math.min(requested, cap);
  const temperature = groqTemperature(route);
  const sys = anthropicJson.system != null ? String(anthropicJson.system).trim() : "";

  /** @type {{ role: string, parts: { text: string }[] }[]} */
  const contents = [];
  for (const m of anthropicJson.messages || []) {
    const role = m.role === "assistant" ? "model" : "user";
    const raw = contentToString(m.content);
    const text = raw.trim() || " ";
    contents.push({ role, parts: [{ text }] });
  }
  if (!contents.length) {
    contents.push({ role: "user", parts: [{ text: "Respond helpfully." }] });
  }

  /** @type {Record<string, unknown>} */
  const out = {
    contents,
    generationConfig: {
      maxOutputTokens,
      temperature,
    },
  };
  if (sys) {
    out.systemInstruction = { parts: [{ text: sys }] };
  }
  if (route === "intel") {
    /** @type {Record<string, unknown>} */
    const gc = /** @type {Record<string, unknown>} */ (out.generationConfig);
    gc.stopSequences = ["\n\n", "\nUser:"];
  }
  return out;
}

/**
 * @param {Record<string, unknown>} geminiJson
 * @param {string} modelId model that produced this response (for client metadata)
 */
function geminiResponseToAnthropicShape(geminiJson, modelId) {
  const cand = geminiJson.candidates?.[0];
  const parts = cand?.content?.parts;
  let text = "";
  if (Array.isArray(parts)) {
    for (const p of parts) {
      if (p && typeof p === "object" && "text" in p) text += String(/** @type {{ text?: string }} */ (p).text ?? "");
    }
  }
  const meta = geminiJson.usageMetadata;
  /** @type {Record<string, number> | undefined} */
  let usage;
  if (meta && typeof meta === "object") {
    const prompt = Number(/** @type {{ promptTokenCount?: number }} */ (meta).promptTokenCount) || 0;
    const outTok = Number(/** @type {{ candidatesTokenCount?: number }} */ (meta).candidatesTokenCount) || 0;
    usage = { input_tokens: prompt, output_tokens: outTok, total_tokens: prompt + outTok };
  }
  return {
    id: "gemini-msg",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    model: modelId,
    stop_reason: "end_turn",
    usage,
  };
}

/** Ordered list: primary first, then env fallbacks, then built-in alternates (deduped). */
function geminiModelsToTry() {
  const builtin = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-1.5-flash"];
  const fromEnv = GEMINI_MODEL_FALLBACK
    ? GEMINI_MODEL_FALLBACK.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const merged = [GEMINI_MODEL, ...fromEnv, ...builtin];
  const seen = new Set();
  const out = [];
  for (const m of merged) {
    if (!m || seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

/**
 * True when trying another model id might succeed (per-model free tier, RPM, unknown model).
 * @param {number} status
 * @param {string} bodyText
 */
function shouldRetryGeminiWithOtherModel(status, bodyText) {
  if (status === 401) return false;
  if (status === 429) return true;
  if (status === 404) return true;
  if (status >= 500) return true;
  const b = (bodyText || "").toLowerCase();
  if (b.includes("quota exceeded") || b.includes("resource_exhausted")) return true;
  if (b.includes("limit: 0") && b.includes("free_tier")) return true;
  if (status === 403 && (b.includes("quota") || b.includes("billing"))) return true;
  if (status === 400 && (b.includes("quota") || b.includes("exceeded") || b.includes("not available"))) {
    return true;
  }
  return false;
}

/**
 * When Groq fails with overload / quota / daily token limits, retry once via Gemini if configured.
 * @param {{ status: number, body: string }} result
 */
function shouldFallbackGroqToGemini(result) {
  if (result.status === 200) return false;
  if (result.status === 401) return false;
  if (result.status === 429) return true;
  if (result.status >= 500) return true;
  const b = (result.body || "").toLowerCase();
  if (b.includes("tokens per day") || b.includes("rate limit") || b.includes("resource_exhausted")) return true;
  if (result.status === 403 && (b.includes("quota") || b.includes("limit"))) return true;
  if (
    result.status === 400 &&
    (b.includes("rate limit") || b.includes("tokens per day") || b.includes("resource_exhausted"))
  ) {
    return true;
  }
  return false;
}

async function forwardGemini(anthropicBodyString) {
  if (!GEMINI_KEY) {
    return { status: 500, body: JSON.stringify({ error: { message: "GEMINI_API_KEY / GOOGLE_API_KEY is empty." } }) };
  }
  let anthropicJson;
  try {
    anthropicJson = JSON.parse(anthropicBodyString);
  } catch {
    return { status: 400, body: JSON.stringify({ error: { message: "Invalid JSON body" } }) };
  }
  const routeRaw = anthropicJson.groq_route;
  delete anthropicJson.groq_route;
  const route = typeof routeRaw === "string" && routeRaw.trim() ? routeRaw.trim() : "misc";
  const geminiBody = anthropicBodyToGemini(anthropicJson, route);

  const models = geminiModelsToTry();
  /** @type {{ status: number, body: string } | null} */
  let lastFail = null;

  for (let i = 0; i < models.length; i++) {
    const modelId = models[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      modelId
    )}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });
    const text = await r.text();

    if (!r.ok) {
      lastFail = { status: r.status, body: text };
      if (i < models.length - 1 && shouldRetryGeminiWithOtherModel(r.status, text)) {
        console.warn(`[gemini] ${modelId} failed (HTTP ${r.status}); retrying with next model…`);
        continue;
      }
      return lastFail;
    }

    let geminiJson;
    try {
      geminiJson = JSON.parse(text);
    } catch {
      return { status: 502, body: JSON.stringify({ error: { message: "Gemini returned non-JSON" } }) };
    }
    const block = geminiJson.promptFeedback?.blockReason;
    if (block) {
      return {
        status: 400,
        body: JSON.stringify({ error: { message: `Gemini blocked the prompt: ${block}` } }),
      };
    }
    if (i > 0) {
      console.warn(`[gemini] succeeded with fallback model ${modelId}`);
    }
    const shaped = geminiResponseToAnthropicShape(geminiJson, modelId);
    return { status: 200, body: JSON.stringify(shaped) };
  }

  return lastFail || { status: 502, body: JSON.stringify({ error: { message: "Gemini: no model attempts" } }) };
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

/** OG card background (#060a12) — flatten logo alpha onto this so librsvg does not render transparency as white/checkerboard. */
const OG_LOGO_FLATTEN_BG = { r: 6, g: 10, b: 18 };

function findOgLogoPath() {
  const candidates = [
    path.join(STATIC_ROOT, "image", "ai-cricket-war-room-logo.png"),
    path.join(__dirname, "image", "ai-cricket-war-room-logo.png"),
    path.join(__dirname, "ai-cricket-war-room-logo.png"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {
      /* next */
    }
  }
  return null;
}

/**
 * Trim transparent padding, flatten alpha to OG navy (fixes SVG raster white box),
 * return data URI for embedding. Cached after first successful read.
 * @type {string | null | undefined}
 */
let ogLogoDataUriMemo = undefined;
/** @type {Promise<string | null> | null} */
let ogLogoPreparePromise = null;

async function getOgLogoDataUri() {
  if (ogLogoDataUriMemo !== undefined) return ogLogoDataUriMemo;
  if (ogLogoPreparePromise) return ogLogoPreparePromise;
  ogLogoPreparePromise = (async () => {
    const logoPath = findOgLogoPath();
    if (!logoPath) {
      console.warn(
        "War room: ai-cricket-war-room-logo.png not found (image/ or project root) — OG images use WR text / omit logo until the file is present."
      );
      ogLogoDataUriMemo = null;
      return null;
    }
    try {
      const raw = fs.readFileSync(logoPath);
      let buf;
      try {
        buf = await sharp(raw)
          .ensureAlpha()
          .trim({ threshold: 18 })
          .flatten({ background: OG_LOGO_FLATTEN_BG })
          .png({ compressionLevel: 9 })
          .toBuffer();
      } catch {
        buf = await sharp(raw)
          .ensureAlpha()
          .flatten({ background: OG_LOGO_FLATTEN_BG })
          .png({ compressionLevel: 9 })
          .toBuffer();
      }
      ogLogoDataUriMemo = `data:image/png;base64,${buf.toString("base64")}`;
      return ogLogoDataUriMemo;
    } catch (e) {
      console.warn("War room: OG logo preprocess failed:", e instanceof Error ? e.message : e);
      ogLogoDataUriMemo = null;
      return null;
    }
  })();
  return ogLogoPreparePromise;
}

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

  /** @type {Record<string, unknown>} */
  let full = {
    appVersion: pkg.version || "0.0.0",
    buildHash: null,
    builtAt: null,
    commit: null,
    commitShort: null,
    branch: null,
    dirty: null,
    mode: SERVE_DIST ? "production" : "development",
  };

  if (SERVE_DIST) {
    const manifestPath = path.join(__dirname, "dist", "build-manifest.json");
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      full = {
        ...full,
        appVersion: manifest.appVersion || full.appVersion,
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

  if (!VERSION_INFO_MINIMAL) {
    let commit = /** @type {string | null} */ (full.commit);
    if (!commit) {
      try {
        commit = execSync("git rev-parse HEAD", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
        full.commit = commit;
        full.commitShort = commit.slice(0, 7);
        try {
          full.branch = execSync("git rev-parse --abbrev-ref HEAD", {
            cwd: __dirname,
            stdio: ["ignore", "pipe", "ignore"],
          })
            .toString()
            .trim();
        } catch {
          /* detached HEAD */
        }
        try {
          full.dirty =
            execSync("git status --porcelain", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().length > 0;
        } catch {
          /* not a git repo */
        }
      } catch {
        /* git missing or not a repo */
      }
    }
  }

  if (VERSION_INFO_MINIMAL) {
    return {
      appVersion: full.appVersion,
      buildHash: full.buildHash,
      builtAt: full.builtAt,
      mode: full.mode,
    };
  }
  return full;
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
    s.includes("meta-externalagent") ||
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
    s.includes("applebot") ||
    s.includes("snapchat") ||
    s.includes("skypeuripreview") ||
    s.includes("outbrain")
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
 * Same team parsing as the client `parseTeamsFromMatch` (fixture label → short codes).
 * @returns {{ teamA: string, teamB: string, codeA: string, codeB: string }}
 */
function parseShareTeamsFromLabel(match) {
  const fallback = { teamA: "Team A", teamB: "Team B", codeA: "A", codeB: "B" };
  const s = String(match || "").trim();
  if (!s) return fallback;

  const mCodes = s.match(/\b([A-Z]{2,4})\s+vs\.?\s+([A-Z]{2,4})\b/i);
  if (mCodes) {
    const a = mCodes[1].toUpperCase();
    const b = mCodes[2].toUpperCase();
    return { teamA: a, teamB: b, codeA: a, codeB: b };
  }

  const mWords = s.match(
    /\b([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+vs\.?\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\b/i
  );
  if (mWords) {
    const a = mWords[1].trim();
    const b = mWords[2].trim();
    const bad = /^(ipl|match|final|qualifier|eliminator|opener|odi|t20i|test)$/i;
    if (!bad.test(a) && !bad.test(b)) {
      const code = (w) => {
        const parts = w.split(/\s+/).filter(Boolean);
        const initials = parts.map((x) => x[0]).join("").toUpperCase().slice(0, 4);
        return initials || w.slice(0, 3).toUpperCase();
      };
      return { teamA: a, teamB: b, codeA: code(a), codeB: code(b) };
    }
  }

  return fallback;
}

/**
 * 1200×630 homepage Open Graph card (logo + headline + agents strip).
 * @returns {Promise<string>}
 */
async function buildHomepageOgSvg() {
  const W = 1200;
  const H = 630;
  const fontUi = "system-ui,Segoe UI,Roboto,Arial,sans-serif";
  const fontDisplay = "Impact,'Arial Narrow Bold',Arial Black,Arial,sans-serif";
  const logoUri = await getOgLogoDataUri();
  const logo = logoUri
    ? `<clipPath id="hpLogoClip"><rect x="72" y="195" width="240" height="240" rx="18"/></clipPath>`
    : "";
  const logoG = logoUri
    ? `<g clip-path="url(#hpLogoClip)"><image href="${logoUri}" x="72" y="195" width="240" height="240" preserveAspectRatio="xMidYMid slice"/></g>`
    : `<text x="192" y="320" text-anchor="middle" fill="#64748b" font-family="${fontUi}" font-size="22" font-weight="700">Cricket War Room</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    ${logo}
    <linearGradient id="hpTop" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#1e3a8a" stop-opacity="0"/>
      <stop offset="0.1" stop-color="#1e3a8a"/>
      <stop offset="0.22" stop-color="#2563eb"/>
      <stop offset="0.38" stop-color="#16a34a"/>
      <stop offset="0.5" stop-color="#22c55e"/>
      <stop offset="0.65" stop-color="#eab308"/>
      <stop offset="0.8" stop-color="#f97316"/>
      <stop offset="0.9" stop-color="#ef4444"/>
      <stop offset="1" stop-color="#ef4444" stop-opacity="0"/>
    </linearGradient>
    <pattern id="hpGrid" width="60" height="60" patternUnits="userSpaceOnUse">
      <path d="M60 0H0V60" fill="none" stroke="#ffffff" stroke-opacity="0.028" stroke-width="1"/>
    </pattern>
    <radialGradient id="hpHalo" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#2563eb" stop-opacity="0.38"/>
      <stop offset="0.45" stop-color="#16a34a" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#16a34a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="hpCta" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#16a34a"/>
      <stop offset="1" stop-color="#14532d"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#060a12"/>
  <ellipse cx="600" cy="700" rx="560" ry="380" fill="#16a34a" fill-opacity="0.16"/>
  <ellipse cx="40" cy="20" rx="220" ry="180" fill="#1e3a8a" fill-opacity="0.22"/>
  <ellipse cx="1180" cy="30" rx="200" ry="160" fill="#eab308" fill-opacity="0.1"/>
  <rect width="${W}" height="${H}" fill="url(#hpGrid)" opacity="0.9"/>
  <rect x="0" y="0" width="${W}" height="4" fill="url(#hpTop)"/>
  <ellipse cx="192" cy="315" rx="150" ry="150" fill="url(#hpHalo)"/>
  ${logoG}
  <line x1="880" y1="100" x2="880" y2="530" stroke="#ffffff" stroke-opacity="0.07"/>
  <text x="380" y="218" fill="rgba(255,255,255,0.32)" font-family="${fontUi}" font-size="13" font-weight="600" letter-spacing="3">IPL 2026 · AI MATCH ANALYSIS</text>
  <text x="380" y="288" fill="#ffffff" font-family="${fontDisplay}" font-size="86" font-weight="700">6 AIS.</text>
  <text x="380" y="378" font-family="${fontDisplay}" font-size="86" font-weight="700">
    <tspan fill="#22c55e">ONE</tspan><tspan fill="#ffffff"> MATCH.</tspan>
  </text>
  <text x="380" y="468" fill="#ffffff" font-family="${fontDisplay}" font-size="86" font-weight="700">ZERO BIAS.</text>
  <text x="380" y="512" fill="rgba(255,255,255,0.48)" font-family="${fontUi}" font-size="18" font-weight="500">Bull vs Bear multi-round debate. Five intel agents, one Judge verdict.</text>
  <rect x="380" y="528" width="56" height="52" rx="10" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)"/>
  <text x="408" y="562" text-anchor="middle" fill="#22c55e" font-family="${fontDisplay}" font-size="26">6</text>
  <text x="408" y="578" text-anchor="middle" fill="rgba(255,255,255,0.28)" font-family="${fontUi}" font-size="10" font-weight="600" letter-spacing="1">AGENTS</text>
  <rect x="448" y="528" width="88" height="52" rx="10" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)"/>
  <text x="492" y="562" text-anchor="middle" fill="#fbbf24" font-family="${fontDisplay}" font-size="22">MULTI</text>
  <text x="492" y="578" text-anchor="middle" fill="rgba(255,255,255,0.28)" font-family="${fontUi}" font-size="10" font-weight="600" letter-spacing="1">ROUNDS</text>
  <rect x="548" y="528" width="72" height="52" rx="10" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)"/>
  <text x="584" y="562" text-anchor="middle" fill="#f87171" font-family="${fontDisplay}" font-size="22">LIVE</text>
  <text x="584" y="578" text-anchor="middle" fill="rgba(255,255,255,0.28)" font-family="${fontUi}" font-size="10" font-weight="600" letter-spacing="1">DATA</text>
  <rect x="632" y="528" width="72" height="52" rx="10" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)"/>
  <text x="668" y="562" text-anchor="middle" fill="#a78bfa" font-family="${fontDisplay}" font-size="22">FREE</text>
  <text x="668" y="578" text-anchor="middle" fill="rgba(255,255,255,0.28)" font-family="${fontUi}" font-size="10" font-weight="600" letter-spacing="1">ALWAYS</text>
  <rect x="720" y="528" width="200" height="52" rx="12" fill="url(#hpCta)" stroke="rgba(255,255,255,0.14)"/>
  <text x="820" y="562" text-anchor="middle" fill="#ffffff" font-family="${fontUi}" font-size="14" font-weight="700" letter-spacing="1.5">ANALYSE MY MATCH \u2192</text>
  <text x="920" y="168" fill="rgba(255,255,255,0.24)" font-family="${fontUi}" font-size="11" font-weight="600" letter-spacing="2">ACTIVE AI AGENTS</text>
  <rect x="920" y="186" width="260" height="46" rx="23" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)"/>
  <circle cx="944" cy="209" r="5" fill="#22c55e"/>
  <text x="968" y="216" fill="rgba(255,255,255,0.72)" font-family="${fontUi}" font-size="14" font-weight="600">Bull Agent</text>
  <text x="1140" y="216" text-anchor="end" fill="rgba(255,255,255,0.28)" font-family="${fontUi}" font-size="11">Makes the case</text>
  <rect x="920" y="242" width="260" height="46" rx="23" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)"/>
  <circle cx="944" cy="265" r="5" fill="#ef4444"/>
  <text x="968" y="272" fill="rgba(255,255,255,0.72)" font-family="${fontUi}" font-size="14" font-weight="600">Bear Agent</text>
  <text x="1140" y="272" text-anchor="end" fill="rgba(255,255,255,0.28)" font-family="${fontUi}" font-size="11">Counters hard</text>
  <rect x="920" y="298" width="260" height="46" rx="23" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)"/>
  <circle cx="944" cy="321" r="5" fill="#818cf8"/>
  <text x="968" y="328" fill="rgba(255,255,255,0.72)" font-family="${fontUi}" font-size="14" font-weight="600">5 Intel Agents</text>
  <text x="1140" y="328" text-anchor="end" fill="rgba(255,255,255,0.28)" font-family="${fontUi}" font-size="11">Form · Pitch · News</text>
  <rect x="920" y="354" width="260" height="46" rx="23" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)"/>
  <circle cx="944" cy="377" r="5" fill="#eab308"/>
  <text x="968" y="384" fill="rgba(255,255,255,0.72)" font-family="${fontUi}" font-size="14" font-weight="600">Judge Agent</text>
  <text x="1140" y="384" text-anchor="end" fill="rgba(255,255,255,0.28)" font-family="${fontUi}" font-size="11">Final verdict</text>
</svg>`;
}

/**
 * @returns {Promise<Buffer>}
 */
async function renderHomepageOgPng() {
  const svg = await buildHomepageOgSvg();
  return sharp(Buffer.from(svg, "utf8")).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * 1200×630 Open Graph card: high-contrast verdict, confidence bar, share CTA (Sharp rasterizes SVG).
 * @param {Record<string, unknown>} pack
 * @returns {Promise<string>}
 */
async function buildShareOgSvg(pack) {
  const W = 1200;
  const H = 630;
  const winRaw = String(pack.w || "—").trim().toUpperCase().slice(0, 4);
  const c = Math.min(100, Math.max(0, Math.round(Number(pack.c) || 55)));
  const label = String(pack.l || "").trim();
  const teams = parseShareTeamsFromLabel(label);
  const codeA = String(teams.codeA || "A").toUpperCase().slice(0, 4);
  const codeB = String(teams.codeB || "B").toUpperCase().slice(0, 4);
  const win = winRaw || codeA;

  let winnerCode = win;
  let loserCode = codeB;
  if (win === codeA) {
    loserCode = codeB;
    winnerCode = codeA;
  } else if (win === codeB) {
    loserCode = codeA;
    winnerCode = codeB;
  } else {
    winnerCode = win;
    loserCode = codeA !== win ? codeA : codeB;
    if (loserCode === winnerCode) loserCode = codeB === winnerCode ? codeA : codeB;
  }

  const matchBadge = truncateHard(label.replace(/\s+/g, " "), 40).toUpperCase();
  const summaryRaw = pack.s ? String(pack.s).trim().replace(/\s+/g, " ") : "";
  const insight =
    summaryRaw ||
    truncateHard(
      `${winnerCode} favored at ${c}% model confidence — Bull vs Bear debate inside.`,
      120
    );
  const insightLine1 = truncateHard(insight, 72);
  const insightRest = insight.length > 72 ? truncateHard(insight.slice(72), 72) : "";

  const barW = 420;
  const barInner = Math.max(8, Math.round((barW * c) / 100));

  const fontUi = "system-ui,Segoe UI,Roboto,Arial,sans-serif";
  const fontDisplay = "Impact,'Arial Narrow Bold',Arial Black,Arial,sans-serif";

  const logoUri = await getOgLogoDataUri();
  const brandLogoBlock = logoUri
    ? `<clipPath id="ogBrandLogoClip"><rect x="72" y="39" width="52" height="52" rx="12"/></clipPath>`
    : "";
  const brandLogoG = logoUri
    ? `<g clip-path="url(#ogBrandLogoClip)"><image href="${logoUri}" x="72" y="39" width="52" height="52" preserveAspectRatio="xMidYMid slice"/></g>`
    : `<rect x="72" y="40" width="48" height="48" rx="12" fill="#ef4444"/>
  <text x="96" y="76" text-anchor="middle" fill="#ffffff" font-family="${fontUi}" font-size="15" font-weight="700">WR</text>`;
  const verdictLogoClip = logoUri
    ? `<clipPath id="ogVerdictLogoClip"><rect x="1048" y="118" width="80" height="80" rx="12"/></clipPath>`
    : "";
  const verdictLogoBlock = logoUri
    ? `<g clip-path="url(#ogVerdictLogoClip)"><image href="${logoUri}" x="1048" y="118" width="80" height="80" preserveAspectRatio="xMidYMid slice"/></g>`
    : "";

  const insightBlock =
    insightRest.length > 0
      ? `<text x="122" y="548" fill="rgba(255,255,255,0.5)" font-family="${fontUi}" font-size="17">${escapeXmlText(insightLine1)}</text>
    <text x="122" y="574" fill="rgba(255,255,255,0.5)" font-family="${fontUi}" font-size="17">${escapeXmlText(insightRest)}</text>`
      : `<text x="122" y="556" fill="rgba(255,255,255,0.5)" font-family="${fontUi}" font-size="17">${escapeXmlText(insightLine1)}</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    ${brandLogoBlock}
    ${verdictLogoClip}
    <linearGradient id="ogTopAccent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ef4444" stop-opacity="0"/>
      <stop offset="0.1" stop-color="#ef4444"/>
      <stop offset="0.28" stop-color="#f97316"/>
      <stop offset="0.48" stop-color="#eab308"/>
      <stop offset="0.68" stop-color="#22c55e"/>
      <stop offset="0.85" stop-color="#2563eb"/>
      <stop offset="1" stop-color="#2563eb" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="verdictGrad" x1="0" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#ef4444"/>
      <stop offset="0.45" stop-color="#f97316"/>
      <stop offset="1" stop-color="#eab308"/>
    </linearGradient>
    <linearGradient id="confFill" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ef4444"/>
      <stop offset="1" stop-color="#f97316"/>
    </linearGradient>
    <linearGradient id="ctaGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ef4444"/>
      <stop offset="1" stop-color="#991b1b"/>
    </linearGradient>
    <pattern id="shareGrid" width="55" height="55" patternUnits="userSpaceOnUse">
      <path d="M55 0H0V55" fill="none" stroke="#ffffff" stroke-opacity="0.022" stroke-width="1"/>
    </pattern>
    <pattern id="pitchStripe" patternUnits="userSpaceOnUse" width="4" height="19">
      <rect width="4" height="19" fill="transparent"/>
      <line x1="0" y1="18" x2="4" y2="18" stroke="#16a34a" stroke-opacity="0.12" stroke-width="1"/>
    </pattern>
    <linearGradient id="pitchFade" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#060a12" stop-opacity="1"/>
      <stop offset="1" stop-color="#060a12" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="#060a12"/>

  <ellipse cx="600" cy="700" rx="520" ry="360" fill="#16a34a" fill-opacity="0.12"/>
  <ellipse cx="60" cy="40" rx="200" ry="170" fill="#ef4444" fill-opacity="0.1"/>
  <ellipse cx="1140" cy="50" rx="180" ry="150" fill="#eab308" fill-opacity="0.09"/>
  <ellipse cx="80" cy="580" rx="220" ry="160" fill="#1e3a8a" fill-opacity="0.14"/>

  <rect width="${W}" height="${H}" fill="url(#shareGrid)" opacity="0.75"/>
  <rect x="0" y="430" width="${W}" height="200" fill="url(#pitchStripe)" opacity="0.5"/>
  <rect x="0" y="430" width="${W}" height="200" fill="url(#pitchFade)"/>

  <rect x="0" y="0" width="${W}" height="4" fill="url(#ogTopAccent)"/>

  <!-- Brand -->
  ${brandLogoG}
  <text x="138" y="76" fill="rgba(255,255,255,0.65)" font-family="${fontDisplay}" font-size="26" letter-spacing="3">${escapeXmlText("CRICKET WAR ROOM")}</text>

  <!-- Top badges (right) -->
  <rect x="560" y="46" width="378" height="34" rx="17" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)"/>
  <text x="749" y="69" text-anchor="middle" fill="rgba(255,255,255,0.5)" font-family="${fontUi}" font-size="12" font-weight="600" letter-spacing="1.5">${escapeXmlText(matchBadge)}</text>
  <rect x="952" y="46" width="176" height="34" rx="17" fill="rgba(239,68,68,0.15)" stroke="rgba(239,68,68,0.45)"/>
  <circle cx="974" cy="63" r="4" fill="#ef4444"/>
  <text x="1040" y="69" text-anchor="middle" fill="#f87171" font-family="${fontUi}" font-size="13" font-weight="700" letter-spacing="2">LIVE AI</text>

  <!-- Teams row: winner left -->
  <circle cx="108" cy="220" r="38" fill="rgba(239,68,68,0.2)" stroke="rgba(239,68,68,0.55)" stroke-width="2"/>
  <text x="108" y="232" text-anchor="middle" fill="#f87171" font-family="${fontUi}" font-size="18" font-weight="700">${escapeXmlText(winnerCode)}</text>
  <text x="168" y="232" fill="#ffffff" font-family="${fontUi}" font-size="52" font-weight="700">${escapeXmlText(winnerCode)}</text>

  <text x="360" y="232" fill="rgba(255,255,255,0.22)" font-family="${fontUi}" font-size="16" font-weight="700" letter-spacing="3">VS</text>

  <circle cx="428" cy="220" r="38" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
  <text x="428" y="232" text-anchor="middle" fill="rgba(255,255,255,0.35)" font-family="${fontUi}" font-size="18" font-weight="700">${escapeXmlText(loserCode)}</text>
  <text x="488" y="232" fill="rgba(255,255,255,0.32)" font-family="${fontUi}" font-size="52" font-weight="700">${escapeXmlText(loserCode)}</text>

  <!-- Confidence -->
  <text x="72" y="312" fill="rgba(255,255,255,0.32)" font-family="${fontUi}" font-size="12" font-weight="600" letter-spacing="2">AI CONFIDENCE</text>
  <rect x="200" y="298" width="${barW}" height="8" rx="4" fill="rgba(255,255,255,0.1)"/>
  <rect x="200" y="298" width="${barInner}" height="8" rx="4" fill="url(#confFill)"/>
  <text x="${208 + barW + 14}" y="308" fill="#f97316" font-family="${fontUi}" font-size="18" font-weight="700">${c}%</text>

  <!-- Verdict column -->
  <line x1="752" y1="96" x2="752" y2="440" stroke="rgba(255,255,255,0.08)"/>
  ${verdictLogoBlock}
  <text x="1128" y="212" text-anchor="end" fill="rgba(255,255,255,0.32)" font-family="${fontUi}" font-size="12" font-weight="600" letter-spacing="4">AI VERDICT</text>
  <text x="1128" y="298" text-anchor="end" fill="url(#verdictGrad)" font-family="${fontDisplay}" font-size="88" font-weight="700">${escapeXmlText(winnerCode)}</text>
  <text x="1128" y="398" text-anchor="end" fill="url(#verdictGrad)" font-family="${fontDisplay}" font-size="88" font-weight="700">WINS</text>

  <!-- Bottom: insight + CTA -->
  <rect x="72" y="518" width="38" height="38" rx="10" fill="rgba(234,179,8,0.12)" stroke="rgba(234,179,8,0.28)"/>
  <text x="91" y="544" text-anchor="middle" fill="#eab308" font-family="${fontUi}" font-size="17">\u26a1</text>
  ${insightBlock}

  <rect x="848" y="508" width="280" height="52" rx="10" fill="url(#ctaGrad)" stroke="rgba(255,255,255,0.15)"/>
  <text x="988" y="542" text-anchor="middle" fill="#ffffff" font-family="${fontUi}" font-size="14" font-weight="700" letter-spacing="1.5">SEE FULL ANALYSIS \u2192</text>
</svg>`;
}

/**
 * @param {Record<string, unknown>} pack
 * @returns {Promise<Buffer>}
 */
async function renderShareOgPng(pack) {
  const svg = await buildShareOgSvg(pack);
  return sharp(Buffer.from(svg, "utf8")).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @param {URL} url
 * @param {string} id
 * @param {Record<string, unknown>} pack
 * @param {string} appHref e.g. /?sid=…
 * @param {{ clientRedirect?: boolean }} [opts]
 */
function sendShareOgHtml(req, res, url, id, pack, appHref, opts = {}) {
  const clientRedirect = opts.clientRedirect === true;
  const base = `${url.protocol}//${url.host}`;
  const canonical = `${base}/s/${id}`;
  const imgUrl = `${base}/api/og/share/${id}.png`;
  const w = String(pack.w || "").toUpperCase();
  const c = Math.min(100, Math.max(0, Math.round(Number(pack.c) || 55)));
  const title = `${w} wins (${c}% AI confidence) — tap for the war room`;
  const desc =
    (pack.s && truncateHard(String(pack.s), 220)) ||
    `AI verdict: ${w} at ${c}% model confidence — not win odds. Open for Bull vs Bear and the full Judge card.`;
  const redirectScript = clientRedirect
    ? `<script>location.replace(${JSON.stringify(appHref)});</script>`
    : "";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="canonical" href="${escapeHtmlAttr(canonical)}" />
  <title>${escapeHtmlPcdata(title)}</title>
  <meta name="description" content="${escapeHtmlAttr(desc)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Cricket War Room" />
  <meta property="og:title" content="${escapeHtmlAttr(title)}" />
  <meta property="og:description" content="${escapeHtmlAttr(desc)}" />
  <meta property="og:url" content="${escapeHtmlAttr(canonical)}" />
  <meta property="og:image" content="${escapeHtmlAttr(imgUrl)}" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${escapeHtmlAttr(`${w} wins — AI verdict preview card`)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtmlAttr(title)}" />
  <meta name="twitter:description" content="${escapeHtmlAttr(desc)}" />
  <meta name="twitter:image" content="${escapeHtmlAttr(imgUrl)}" />
</head>
<body style="font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:2rem">
  ${redirectScript}
  <p><a href="${escapeHtmlAttr(appHref)}" style="color:#5eead4">Open this prediction in Cricket War Room</a></p>
</body>
</html>`;
  const buf = Buffer.from(html, "utf8");
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=300",
    "Content-Length": String(buf.length),
  };
  if (req.method === "HEAD") {
    res.writeHead(200, headers);
    res.end();
    return;
  }
  res.writeHead(200, headers);
  res.end(buf);
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
      ...corsHeaders(req),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/version") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(req),
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
      ...corsHeaders(req),
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
        ...corsHeaders(req),
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
        ...corsHeaders(req),
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
        ...corsHeaders(req),
        "Cache-Control": "no-store",
      });
      res.end(text);
    } catch (e) {
      res.writeHead(503, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(req),
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
    if (!rateLimitAllow(clientIp(req), "judge").ok) {
      res.writeHead(429, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(req),
        "Retry-After": "60",
      });
      res.end(JSON.stringify({ error: "rate_limited", message: "Too many judge requests; try again shortly." }));
      return;
    }
    if (!denyUnlessWarRoomSecret(req, res)) return;

    const target = `${JUDGE_SERVICE_URL}/predict`;
    const rb = await readBody(req, { maxBytes: MAX_BODY_JUDGE_BYTES });
    if (!rb.ok) {
      res.writeHead(413, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(req),
      });
      res.end(JSON.stringify({ error: "payload_too_large", message: `Body exceeds ${MAX_BODY_JUDGE_BYTES} bytes` }));
      return;
    }
    const body = rb.body;
    const ctrl = AbortSignal.timeout(120_000);
    try {
      const r = await fetch(target, {
        method: "POST",
        signal: ctrl,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...judgeUpstreamAuthHeaders(),
        },
        body: body && body.trim() ? body : "{}",
      });
      const text = await r.text();
      res.writeHead(r.status, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(req),
        "Cache-Control": "no-store",
      });
      res.end(text);
    } catch (e) {
      res.writeHead(503, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(req),
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
    const now = Date.now();
    if (
      JUDGE_ACCURACY_CACHE_MS > 0 &&
      judgeAccuracyCache &&
      now - judgeAccuracyCache.at < JUDGE_ACCURACY_CACHE_MS
    ) {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(req),
        "Cache-Control": "no-store",
        "X-Judge-Accuracy-Cache": "hit",
      });
      res.end(judgeAccuracyCache.text);
      return;
    }
    try {
      const upstream = await fetchJudgeAccuracyFromUpstream();
      if (upstream.ok) {
        judgeAccuracyCache = { text: upstream.text, at: Date.now() };
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders(req),
          "Cache-Control": "no-store",
        });
        res.end(upstream.text);
        return;
      }
      if (judgeAccuracyCache && judgeAccuracyUpstreamTransient(upstream.status)) {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders(req),
          "Cache-Control": "no-store",
          "X-Judge-Accuracy-Stale": "1",
        });
        res.end(judgeAccuracyCache.text);
        return;
      }
      res.writeHead(upstream.status, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(req),
        "Cache-Control": "no-store",
      });
      res.end(upstream.text || JSON.stringify({ error: "judge_accuracy_upstream_failed" }));
    } catch (e) {
      if (judgeAccuracyCache) {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders(req),
          "Cache-Control": "no-store",
          "X-Judge-Accuracy-Stale": "1",
        });
        res.end(judgeAccuracyCache.text);
        return;
      }
      res.writeHead(503, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(req),
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
        ...corsHeaders(req),
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
      ...corsHeaders(req),
      "Cache-Control": "public, max-age=60",
    });
    res.end(JSON.stringify({ match: payload }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/messages") {
    if (!rateLimitAllow(clientIp(req), "messages").ok) {
      res.writeHead(429, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(req),
        "Retry-After": "60",
      });
      res.end(JSON.stringify({ error: { message: "Too many requests; try again shortly." } }));
      return;
    }
    if (!denyUnlessWarRoomSecret(req, res)) return;

    activeProvider = resolveProvider();

    if (!activeProvider) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req) });
      res.end(
        JSON.stringify({
          error: {
            type: "config",
            message:
              "No LLM key set. Free: GROQ_API_KEY (console.groq.com) and/or GEMINI_API_KEY (aistudio.google.com) — Groq is tried first with optional Gemini fallback. Paid: ANTHROPIC_API_KEY. Optional: LLM_PROVIDER=groq|anthropic|gemini",
          },
        })
      );
      return;
    }

    if (LLM_PROVIDER === "groq" && !GROQ_KEY) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req) });
      res.end(JSON.stringify({ error: { message: "LLM_PROVIDER=groq but GROQ_API_KEY is empty." } }));
      return;
    }
    if (LLM_PROVIDER === "anthropic" && !ANTHROPIC_KEY) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req) });
      res.end(
        JSON.stringify({ error: { message: "LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty." } })
      );
      return;
    }
    if (LLM_PROVIDER === "gemini" && !GEMINI_KEY) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req) });
      res.end(
        JSON.stringify({
          error: { message: "LLM_PROVIDER=gemini but GEMINI_API_KEY / GOOGLE_API_KEY is empty." },
        })
      );
      return;
    }

    const rbMsg = await readBody(req, { maxBytes: MAX_BODY_MESSAGES_BYTES });
    if (!rbMsg.ok) {
      res.writeHead(413, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(req),
      });
      res.end(JSON.stringify({ error: { message: `Body exceeds ${MAX_BODY_MESSAGES_BYTES} bytes` } }));
      return;
    }
    const body = rbMsg.body;

    try {
      let result;
      if (activeProvider === "anthropic") {
        result = await forwardAnthropic(body);
      } else if (activeProvider === "gemini") {
        result = await forwardGemini(body);
      } else {
        result = await forwardGroq(body);
        if (shouldFallbackGroqToGemini(result) && GEMINI_KEY) {
          console.warn(`[llm] Groq returned HTTP ${result.status}; falling back to Gemini (${GEMINI_MODEL}).`);
          result = await forwardGemini(body);
        }
      }
      res.writeHead(result.status, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(req),
      });
      res.end(result.body);
    } catch (e) {
      res.writeHead(502, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(req),
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
    const rbShare = await readBody(req, { maxBytes: MAX_BODY_SHARE_BYTES });
    if (!rbShare.ok) {
      res.writeHead(413, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(req),
      });
      res.end(JSON.stringify({ error: { message: `Body exceeds ${MAX_BODY_SHARE_BYTES} bytes` } }));
      return;
    }
    const raw = rbShare.body;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(req),
      });
      res.end(JSON.stringify({ error: { message: "Invalid JSON" } }));
      return;
    }
    const pack = normalizeSharePredictionPack(parsed);
    if (!pack) {
      res.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(req),
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
      ...corsHeaders(req),
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
        ...corsHeaders(req),
      });
      res.end(JSON.stringify({ error: { message: "Invalid id" } }));
      return;
    }
    const row = sharePredictionById.get(id);
    if (!row) {
      res.writeHead(404, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(req),
      });
      res.end(JSON.stringify({ error: { message: "Not found" } }));
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(req),
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
        ...corsHeaders(req),
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

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/og-homepage.png") {
    try {
      const png = await renderHomepageOgPng();
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
        "Content-Length": String(png.length),
        ...corsHeaders(req),
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(png);
    } catch (e) {
      console.warn("[og/homepage] render failed:", e instanceof Error ? e.message : e);
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
    /* Chat apps often fetch /s/… once and do not merge OG tags from a 302 target — always return 200 + og:* here and redirect in-page for real browsers. */
    const appHref = `/?sid=${encodeURIComponent(id)}`;
    sendShareOgHtml(req, res, url, id, row.pack, appHref, { clientRedirect: true });
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
      sendShareOgHtml(req, res, url, sidOnly, row2.pack, `/?sid=${encodeURIComponent(sidOnly)}`);
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
    const fb = GEMINI_KEY ? ` — Gemini fallback enabled (${GEMINI_MODEL})` : "";
    console.log(
      `LLM: Groq${fb} — heavy ${GROQ_MODEL} / light ${GROQ_MODEL_LIGHT} — console.groq.com`
    );
  } else if (activeProvider === "anthropic") {
    console.log("LLM: Anthropic Claude");
  } else if (activeProvider === "gemini") {
    console.log(`LLM: Gemini — ${GEMINI_MODEL} — aistudio.google.com`);
  } else {
    console.log("Warning: set GROQ_API_KEY, GEMINI_API_KEY (or GOOGLE_API_KEY), or ANTHROPIC_API_KEY.");
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
