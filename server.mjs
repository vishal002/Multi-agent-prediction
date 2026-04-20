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
 * Groq model override (if defaults change):
 *   GROQ_MODEL=llama-3.3-70b-versatile
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
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
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

/** Newest fixture date first; tie-break by venue A→Z. */
function compareMatchSuggestionsNewestFirst(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
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

function anthropicBodyToGroq(anthropicJson) {
  const messages = [];
  const sys = anthropicJson.system;
  if (sys != null && String(sys).trim()) {
    messages.push({ role: "system", content: String(sys) });
  }
  for (const m of anthropicJson.messages || []) {
    const role = m.role === "assistant" ? "assistant" : "user";
    messages.push({ role, content: contentToString(m.content) });
  }
  return {
    model: GROQ_MODEL,
    messages,
    max_tokens: Math.min(Number(anthropicJson.max_tokens) || 1024, 8192),
    temperature: 0.7,
  };
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

async function forwardGroq(anthropicBodyString) {
  let anthropicJson;
  try {
    anthropicJson = JSON.parse(anthropicBodyString);
  } catch {
    return { status: 400, body: JSON.stringify({ error: { message: "Invalid JSON body" } }) };
  }
  const groqBody = anthropicBodyToGroq(anthropicJson);
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify(groqBody),
  });
  const text = await r.text();
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
  const shaped = groqResponseToAnthropicShape(groqJson);
  return { status: 200, body: JSON.stringify(shaped) };
}

async function forwardAnthropic(body) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body,
  });
  const text = await r.text();
  return { status: r.status, body: text };
}

const STATIC_FILES = new Set([
  "ai_cricket_war_room.html",
  "ai_cricket_war_room.css",
  "ai_cricket_war_room.js",
  "match_suggestions.json",
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

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
      url.pathname === "/api/judge/accuracy")
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

  if (req.method === "GET" && url.pathname === "/api/match-suggest") {
    const qRaw = (url.searchParams.get("q") || "").trim();
    const q = normalizeMatchSuggestQuery(qRaw);
    let limit = Number(url.searchParams.get("limit"));
    if (!Number.isFinite(limit)) limit = 10;
    limit = Math.min(Math.max(Math.floor(limit), 1), 50);
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

      const snippet = bestScore >= 5 ? best.slice(0, 400) : "";
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ snippet, richness: bestScore, fetched_at: data.fetched_at || null }));
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
    const ctrl = AbortSignal.timeout(15_000);
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

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }

  const filePath = safeJoin(__dirname, url.pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath);
  const name = path.basename(filePath);
  if (!STATIC_FILES.has(name)) {
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
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
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
    console.log(`LLM: Groq (model ${GROQ_MODEL}) — free tier at console.groq.com`);
  } else if (activeProvider === "anthropic") {
    console.log("LLM: Anthropic Claude");
  } else {
    console.log("Warning: set GROQ_API_KEY (free) or ANTHROPIC_API_KEY.");
  }
});
