# AI Cricket War Room

**Live demo:** [cricket-war-room.onrender.com](https://cricket-war-room.onrender.com)

A dark-themed web demo for **multi-agent cricket match analysis**: specialist agents gather intel, two adversarial debaters argue the fixture, and a **Judge** produces a structured verdict (winner, confidence, projected score band, key player, swing factor).

## AI / tooling context (paste into any assistant)

Use this block when indexing the repo or loading context for code generation, debugging, or deployment.

| Fact | Detail |
|------|--------|
| **Purpose** | Single-page **vanilla JS** app (`ai_cricket_war_room.js`) for IPL-style fixtures: parallel **intel agents** (Scout, Stats, Weather, Pitch, News) → multi-round **Bull vs Bear debate** → **Judge** verdict JSON rendered as a card. Optional **Python FastAPI** services for RSS/CricAPI **ingestion** and SQLite-backed **judge predictions**. |
| **Primary runtime** | **Node 20** `server.mjs`: static files + API proxy (hides LLM keys, same-origin `/api/*`). Default port **3333**. |
| **Front-end stack** | No framework: HTML + large CSS + ~4k-line JS. **PWA**: `manifest.webmanifest`, `sw.js`, `icons/`. **Production**: `npm run build` → `dist/` (esbuild-minified hashed JS/CSS, html-minifier, precomputed `.gz`/`.br`); `SERVE_DIST=1` serves only allowlisted `dist/` assets. **Dockerfile** runs that path. |
| **LLM routing (Node)** | `POST /api/messages` → **Groq** (OpenAI-compatible) or **Anthropic** from env; optional `LLM_PROVIDER`. Separate Groq models for heavy vs light traffic (`GROQ_MODEL`, `GROQ_MODEL_LIGHT`, `GROQ_MODEL_DEBATE`). |
| **Fixture data** | `match_suggestions.json` (array of objects with `label`, `date`, `venue`, `teams[]`, optional `completed` + `result.{winner,summary}`). Server reads at startup; **restart Node** after edits. Browser **file://** uses `MATCH_SUGGESTIONS_FALLBACK_ROWS` in `ai_cricket_war_room.js` — keep in sync if offline matters. |
| **Orchestration** | `render.yaml`: three Render services (`cricket-war-room`, `cricket-ingestion`, `cricket-judge`). `docker-compose.yml`: same trio with internal URLs. |

**Node HTTP API (all under the main origin):**

| Method | Path | Role |
|--------|------|------|
| `POST` | `/api/messages` | Proxy to Groq or Anthropic (request shape from front end). |
| `GET` | `/api/match-suggest?q=&limit=` | Filtered suggestions from `match_suggestions.json`. |
| `GET` | `/api/match-by-label?label=` | Full row for exact label (404 if missing); drives completed-match shortcut. |
| `GET` | `/api/match-context?...` | Reverse-proxy to ingestion service `GET /api/match-context` (RSS + optional CricAPI bundle). |
| `GET` | `/api/live-score?teams=&label=` | Fresh ingestion fetch (`nocache=1`), returns JSON `{ snippet, richness, fetched_at?, hint? }` for live line UI. |
| `POST` | `/api/judge/predict` | Body → judge service `POST /predict` (stores prediction, returns verdict + running accuracy). |
| `GET` | `/api/judge/accuracy` | Proxy to judge `GET /accuracy`. |
| `GET` | `/api/version` | Build/version JSON (`appVersion`, `buildHash`, `mode`, git fields in dev). |

**Python services (direct ports when run locally):**

| Service | Module | Port (typical) | Notable routes |
|---------|--------|----------------|----------------|
| Ingestion | `ingestion_service.app:app` | 3334 | `GET /api/match-context`, `GET /healthz`; env `CRICAPI_KEY`, `INGESTION_DISABLE`, cache/TTL vars. |
| Judge | `judge_service.app:app` | 8000 | `POST /predict`, `GET /accuracy`, `PATCH /predictions/{id}/result`, `POST /predictions/result-by-match`; env `GROQ_API_KEY` / `ANTHROPIC_API_KEY`, `WAR_ROOM_DB_PATH`, optional `GROQ_JUDGE_MODEL` / `ANTHROPIC_JUDGE_MODEL`. |

**npm scripts:** `build` → `scripts/build.mjs`; `start` → `SERVE_DIST=1 node server.mjs` (production assets; use a Unix-style shell or set `SERVE_DIST=1` manually on Windows CMD); `start:dev` → `node server.mjs` (serves repo root, unhashed files); `icons` → `scripts/generate-pwa-icons.mjs`.

**Judge verdict schema (Pydantic / UI):** `winner`, `confidence` (0–100), `score_range`, `key_player`, `swing_factor`, `summary` — see `judge_service/models.py` and `judge_service/judge.py` system prompt.

**Where to change common behavior:** UI flow and prompts → `ai_cricket_war_room.js`; styling → `ai_cricket_war_room.css`; shell markup → `ai_cricket_war_room.html`; proxy and static policy → `server.mjs`; RSS/CricAPI aggregation → `ingestion_service/build.py` (+ `rss.py`, `cache.py`); judge LLM + DB → `judge_service/`; deploy topology → `render.yaml`, `docker-compose.yml`, `Dockerfile` / `Dockerfile.python`.

---

### Latest — v3

![AI Cricket War Room v3 — full prediction flow: intel agents, judge verdict, and multi-round debate (SRH vs DC)](image/war-room-v3-demo.png)

**v3 highlights:**
- **End-to-end prediction flow** — fixture search → five parallel intel agents → Judge verdict card → multi-round Bull vs Bear debate, all in a single dark-themed canvas.
- **Judge verdict card** (SRH vs DC): SRH predicted winner at **55% confidence**, with projected score band, key player call-out, and primary swing factor.
- **Three-round debate** — Bull (SRH) and Bear (DC) each respond to the prior round's argument, converging on a final recommendation before the Judge delivers the structured JSON verdict.
- **Completed-match shortcut** — if a fixture is marked `completed` in `match_suggestions.json`, agents and debate are skipped and only the **Final result** card is rendered.

---

### Earlier screenshots

![AI Cricket War Room v2 — SRH vs CSK: intel agents, debate rounds, and judge verdict](image/war-room-v2-latest.png)

*v2: full prediction flow for SRH vs CSK — five intel agents, multi-round Bull vs Bear debate, and the Judge verdict card (CSK 60% confidence, key player Overton).*

![AI Cricket War Room — RCB vs LSG prediction with intel agents, debate flow, and judge verdict](image/war-room-screenshot.jpg)

*v1 example: full prediction flow for an upcoming fixture — search, five intel agents, debate stage, and judge verdict card.*

![AI Cricket War Room — completed fixture shows Final result only (CSK vs KKR)](image/war-room-final-result.jpg)

*Completed-match mode: a fixture marked `completed: true` in `match_suggestions.json` — agents and debate are skipped; only the **Final result** card is shown.*

## What it does

- **Search fixtures** via autocomplete backed by `match_suggestions.json` (and `GET /api/match-suggest` when you use the Node server).
- **Intel agents** (Scout, Stats, Weather, Pitch, News) each return a short insight for the selected match.
- **Debate** — Bull (Team A) vs Bear (Team B) over multiple rounds using the same context with opposite directives.
- **Judge** — reads the transcript and returns JSON-style output rendered as the verdict card (winner, confidence bar, stats grid).
- **Completed matches** — if a fixture is marked `completed: true` with a `result` in `match_suggestions.json`, **Run war room** skips agents, debate, and prediction UI and shows a **Final result** card only.

## Deploy to Render (free)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

Or manually:

1. Push this repo to GitHub.
2. Go to [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint** → select your repo. Render will read `render.yaml` and create all three services automatically.
3. After the first deploy, open each service in the dashboard and add your API keys under **Environment**:

   | Service | Variable | Value |
   |---------|----------|-------|
   | `cricket-war-room` | `GROQ_API_KEY` | your key from [console.groq.com](https://console.groq.com) (free) |
   | `cricket-war-room` | `INGESTION_SERVICE_URL` | `https://cricket-ingestion.onrender.com` |
   | `cricket-war-room` | `JUDGE_SERVICE_URL` | `https://cricket-judge.onrender.com` |
   | `cricket-ingestion` | `CRICAPI_KEY` | optional live-scores key |
   | `cricket-judge` | `GROQ_API_KEY` | same key as above |

4. Trigger a redeploy on `cricket-war-room` so it picks up the new env vars. Your app is live at `https://cricket-war-room.onrender.com`.

> **Free-tier note:** services spin down after 15 min of inactivity — the first request takes ~30 s to wake up. The SQLite predictions DB resets on restart (upgrade to a paid plan + disk for persistence).

## Run with Docker (local or self-hosted VPS)

```bash
cp .env.example .env        # fill in GROQ_API_KEY (minimum)
docker compose up --build   # http://localhost:3333/
```

All three services start together. Judge predictions persist in a Docker volume (`judge_data`).

---

## Quick start (local, no Docker)

1. **Recommended:** set an LLM API key and start the local server (avoids CORS and hides keys):

   ```bash
   export GROQ_API_KEY="gsk_..."   # free tier: https://console.groq.com
   # or: export ANTHROPIC_API_KEY="sk-ant-..."
   npm run start:dev               # serves ai_cricket_war_room.* from repo root (iterate on JS/CSS)
   # production-like bundle (requires `npm run build` first):
   # SERVE_DIST=1 node server.mjs  # same as `npm start` on Unix shells; on Windows CMD use `set SERVE_DIST=1`
   ```

   Open [http://localhost:3333/](http://localhost:3333/).

2. Pick a fixture in the search field, then click **Run war room**. Use **Reset** to clear the stage.

3. Opening `ai_cricket_war_room.html` directly (`file://`) uses a built-in fallback fixture list; full autocomplete and `/api/messages` proxy require the server.

## Configuration

| Environment variable | Purpose |
|----------------------|--------|
| `GROQ_API_KEY` | Groq OpenAI-compatible API (default if present). Free tier: [console.groq.com](https://console.groq.com). |
| `GROQ_MODEL` | Override model (default `llama-3.3-70b-versatile`). |
| `GROQ_MODEL_LIGHT` | Smaller Groq model for short intel / lighter calls (default `llama-3.1-8b-instant`). |
| `GROQ_MODEL_DEBATE` | Groq model for debate rounds (defaults to `GROQ_MODEL` / 70B to avoid TPM contention with the light model). |
| `ANTHROPIC_API_KEY` | Claude via Anthropic API. |
| `LLM_PROVIDER` | `groq` or `anthropic` to force a provider. |
| `PORT` | HTTP port (default `3333`). |
| `CRICAPI_KEY` | **CricAPI** live scores key. Free tier at [cricapi.com](https://cricapi.com) (~100 calls/day). Set on the ingestion service process. Without it, the ingestion service falls back to RSS-only. |
| `INGESTION_ESPN_RSS_URL` | Override ESPNcricinfo RSS feed URL. |
| `INGESTION_CRICBUZZ_RSS_URL` | Override Cricbuzz FeedBurner RSS URL. |
| `INGESTION_FETCH_TIMEOUT_SEC` | Per-source HTTP timeout in seconds (default `8`). |
| `INGESTION_CACHE_TTL_SEC` | Ingestion cache TTL in seconds (default `900`). Set `0` to disable. |
| `INGESTION_DISABLE` | Set `1` to disable the ingestion service entirely. |
| `SERVE_DIST` | Set `1` on the Node process to serve **only** hashed assets from `dist/` (after `npm run build`). Used in `Dockerfile` and `npm start`. |
| `INGESTION_SERVICE_URL` | Base URL for the Python ingestion service (no trailing slash); default `http://127.0.0.1:3334`. |
| `JUDGE_SERVICE_URL` | Base URL for the Python judge service; default `http://127.0.0.1:8000`. |
| `WAR_ROOM_DB_PATH` | SQLite path for judge predictions (judge service); Render free tier often uses `/tmp/war_room.db`. |

**Judge service (Python-only env):** `GROQ_JUDGE_MODEL`, `ANTHROPIC_JUDGE_MODEL` override the default models in `judge_service/judge.py`.

### Live data setup (CricAPI)

1. Register at [cricapi.com](https://cricapi.com) to get your free API key.
2. Export it **before** starting the ingestion service:

   ```bash
   export CRICAPI_KEY="your_key_here"
   python -m uvicorn ingestion_service.app:app --host 127.0.0.1 --port 3334
   ```

3. CricAPI live match bullets are prepended to `news_bullets` so all five intel agents see them first. The `live_score_snippet` field (used by the Scout/Stats agents) is populated from CricAPI structured scores when available, falling back to RSS-scraped headlines.

## API (Node server)

- `POST /api/messages` — proxies to Groq or Anthropic (Anthropic-shaped request body from the front end).
- `GET /api/match-suggest?q=&limit=` — filtered fixture suggestions.
- `GET /api/match-by-label?label=` — exact label lookup (used for completed-match detection when served from the server).
- `GET /api/match-context?...` — forwards query string to the ingestion service (same path); returns the match-context JSON bundle used to ground agents.
- `GET /api/live-score?teams=&label=` — forces a fresh ingestion pull and returns a short **snippet** plus metadata for the live score strip (503 if ingestion is down).
- `POST /api/judge/predict` — forwards to the judge service; persists a prediction row when the judge API is reachable.
- `GET /api/judge/accuracy` — running accuracy stats from the judge SQLite store.
- `GET /api/version` — `{ appVersion, buildHash, builtAt, commit, mode, ... }` for debugging deploys (`buildHash` populated when `SERVE_DIST=1` and `dist/build-manifest.json` exists).

## Data: fixtures and results

Edit **`match_suggestions.json`**. Each entry can include:

- `label`, `date`, `venue`, `teams` (optional short codes).
- **`completed`** + **`result`**: `{ "winner": "RCB", "summary": "…" }` — winner should match team codes; the UI then shows only the final result for that label.

Keep the same rows in **`MATCH_SUGGESTIONS_FALLBACK_ROWS`** inside `ai_cricket_war_room.js` if you rely on offline / fallback behavior.

Restart **`node server.mjs`** after changing the JSON file so the server reloads suggestions.

## Project layout

| Path | Role |
|------|------|
| `ai_cricket_war_room.html` | App shell (entry HTML; build rewrites script/link hrefs to hashed names) |
| `ai_cricket_war_room.css` | Layout and theme |
| `ai_cricket_war_room.js` | Agents UI, debate, judge client, autocomplete, completed-match shortcut, `MATCH_SUGGESTIONS_FALLBACK_ROWS` |
| `sw.js` | Service worker; build injects precache list / static asset version |
| `server.mjs` | Static host + LLM proxy + match/judge/live APIs; `SERVE_DIST` toggles `dist/` |
| `scripts/build.mjs` | esbuild (JS/CSS) + HTML minify + gzip/brotli siblings + `dist/build-manifest.json` |
| `scripts/generate-pwa-icons.mjs` | PWA icon generation (sharp) |
| `match_suggestions.json` | Fixture catalog for server + build copy |
| `manifest.webmanifest` | PWA manifest |
| `icons/` | PNG icons referenced by the manifest |
| `sitemap.xml`, `robots.txt` | Static SEO files copied to `dist/` |
| `dist/` | **Build output only** — do not edit by hand; gitignore recommended for clean clones |
| `judge_service/` | Python FastAPI — `app.py`, `judge.py`, `models.py`, `predictions_db.py` |
| `ingestion_service/` | Python FastAPI — `app.py`, `build.py`, `rss.py`, `cache.py` |
| `requirements-ingestion.txt` | `fastapi`, `uvicorn`, `httpx` |
| `requirements-judge.txt` | `fastapi`, `uvicorn`, `pydantic`, `anthropic` (+ Groq via `httpx` in judge) |
| `package.json` | `type: "module"`; devDependencies: esbuild, html-minifier-terser, sharp |
| `render.yaml` | Render Blueprint — one-click deploy of all 3 services |
| `Dockerfile` | Multi-stage Node 20 Alpine: `npm run build` then runtime with `SERVE_DIST=1` |
| `Dockerfile.python` | Python image for ingestion + judge |
| `docker-compose.yml` | Local Docker orchestration (web + ingestion + judge volume) |
| `.env.example` | Template for required environment variables |
| `openclaw/README.md` | Optional: re-home services as OpenClaw tool nodes |

## License / assets

Team logos load from public Wikimedia URLs configured in `ai_cricket_war_room.js`. Replace or host your own assets if you ship this beyond a demo.
