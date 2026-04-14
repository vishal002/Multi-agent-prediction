# AI Cricket War Room

A dark-themed web demo for **multi-agent cricket match analysis**: specialist agents gather intel, two adversarial debaters argue the fixture, and a **Judge** produces a structured verdict (winner, confidence, projected score band, key player, swing factor).

![AI Cricket War Room — RCB vs LSG prediction with intel agents, debate flow, and judge verdict](assets/war-room-screenshot.jpg)

*Example: full prediction flow for an upcoming fixture — search, five intel agents, debate stage, and judge verdict card.*

## What it does

- **Search fixtures** via autocomplete backed by `match_suggestions.json` (and `GET /api/match-suggest` when you use the Node server).
- **Intel agents** (Scout, Stats, Weather, Pitch, News) each return a short insight for the selected match.
- **Debate** — Bull (Team A) vs Bear (Team B) over multiple rounds using the same context with opposite directives.
- **Judge** — reads the transcript and returns JSON-style output rendered as the verdict card (winner, confidence bar, stats grid).
- **Completed matches** — if a fixture is marked `completed: true` with a `result` in `match_suggestions.json`, **Run war room** skips agents, debate, and prediction UI and shows a **Final result** card only.

## Quick start

1. **Recommended:** set an LLM API key and start the local server (avoids CORS and hides keys):

   ```bash
   export GROQ_API_KEY="gsk_..."   # free tier: https://console.groq.com
   # or: export ANTHROPIC_API_KEY="sk-ant-..."
   npm start
   ```

   Open [http://localhost:3333/](http://localhost:3333/).

2. Pick a fixture in the search field, then click **Run war room**. Use **Reset** to clear the stage.

3. Opening `ai_cricket_war_room.html` directly (`file://`) uses a built-in fallback fixture list; full autocomplete and `/api/messages` proxy require the server.

## Configuration

| Environment variable | Purpose |
|----------------------|--------|
| `GROQ_API_KEY` | Groq OpenAI-compatible API (default if present). |
| `GROQ_MODEL` | Override model (default `llama-3.3-70b-versatile`). |
| `ANTHROPIC_API_KEY` | Claude via Anthropic API. |
| `LLM_PROVIDER` | `groq` or `anthropic` to force a provider. |
| `PORT` | HTTP port (default `3333`). |

## API (Node server)

- `POST /api/messages` — proxies to Groq or Anthropic (Anthropic-shaped request body from the front end).
- `GET /api/match-suggest?q=&limit=` — filtered fixture suggestions.
- `GET /api/match-by-label?label=` — exact label lookup (used for completed-match detection when served from the server).

## Data: fixtures and results

Edit **`match_suggestions.json`**. Each entry can include:

- `label`, `date`, `venue`, `teams` (optional short codes).
- **`completed`** + **`result`**: `{ "winner": "RCB", "summary": "…" }` — winner should match team codes; the UI then shows only the final result for that label.

Keep the same rows in **`MATCH_SUGGESTIONS_FALLBACK_ROWS`** inside `ai_cricket_war_room.js` if you rely on offline / fallback behavior.

Restart **`node server.mjs`** after changing the JSON file so the server reloads suggestions.

## Project layout

| Path | Role |
|------|------|
| `ai_cricket_war_room.html` | App shell |
| `ai_cricket_war_room.css` | Layout and theme |
| `ai_cricket_war_room.js` | Agents UI, debate, judge, autocomplete, completed-match shortcut |
| `server.mjs` | Static host + LLM proxy + match APIs |
| `match_suggestions.json` | Fixture catalog |
| `judge_service/` | Separate Python FastAPI service (predictions / accuracy) — optional to this static PoC |

## License / assets

Team logos load from public Wikimedia URLs configured in `ai_cricket_war_room.js`. Replace or host your own assets if you ship this beyond a demo.
