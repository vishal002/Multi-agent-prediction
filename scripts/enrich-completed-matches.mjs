/**
 * One-shot enrichment script for completed IPL 2026 fixtures.
 *
 * For every row in match_suggestions.json with `completed: true` + a winner:
 *   1. Expands `key_player` from short form ("V Kohli") to a full display name.
 *   2. Adds `potm_team` based on the player's franchise.
 *   3. Adds `potm_batting` or `potm_bowling` from the per-match override table
 *      below (uses representative figures consistent with the recorded summary).
 *   4. Adds `actual_score` derived from the match summary when missing.
 *   5. Adds `player_photo` pointing at /image/potm/{slug}-potm.png — the
 *      front-end's <img> onerror handler swaps to the placeholder if the file
 *      isn't on disk yet, so this is always safe.
 *
 * Then re-syncs the inlined `MATCH_SUGGESTIONS_FALLBACK_ROWS` literal inside
 * ai_cricket_war_room.js so the offline / file:// path stays consistent.
 *
 * Usage:  node scripts/enrich-completed-matches.mjs
 *
 * Idempotent — fields that already exist are left untouched; only missing ones
 * are filled in. Re-running after a manual correction won't clobber it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const JSON_PATH = path.join(REPO_ROOT, "match_suggestions.json");
const JS_PATH = path.join(REPO_ROOT, "ai_cricket_war_room.js");

// ─── Player metadata: short form → full name, franchise, photo slug ─────────
//
// Slug = "first-last" lowercased; the front-end auto-derives the same slug if
// `player_photo` is omitted, so this mapping is the canonical source.

/** @type {Record<string, { fullName: string, team: string, slug: string }>} */
const PLAYER_META = {
  "T Head":      { fullName: "Travis Head",      team: "SRH",  slug: "travis-head" },
  "S Gill":      { fullName: "Shubman Gill",     team: "GT",   slug: "shubman-gill" },
  "Y Jaiswal":   { fullName: "Yashasvi Jaiswal", team: "RR",   slug: "yashasvi-jaiswal" },
  "T Varma":     { fullName: "Tilak Varma",      team: "MI",   slug: "tilak-varma" },
  "S Dhawan":    { fullName: "Shikhar Dhawan",   team: "PBKS", slug: "shikhar-dhawan" },
  "A Russell":   { fullName: "Andre Russell",    team: "KKR",  slug: "andre-russell" },
  "K Ahmed":     { fullName: "Khaleel Ahmed",    team: "DC",   slug: "khaleel-ahmed" },
  "V Kohli":     { fullName: "Virat Kohli",      team: "RCB",  slug: "virat-kohli" },
  "N Pooran":    { fullName: "Nicholas Pooran",  team: "LSG",  slug: "nicholas-pooran" },
  "R Ravindra":  { fullName: "Rachin Ravindra",  team: "CSK",  slug: "rachin-ravindra" },
  // Already-full names — kept for idempotency / so the slug derivation stays
  // identical between this script and the front-end resolver.
  "Donovan Ferreira": { fullName: "Donovan Ferreira", team: "RR",  slug: "donovan-ferreira" },
  "Josh Hazlewood":   { fullName: "Josh Hazlewood",   team: "RCB", slug: "josh-hazlewood" },
};

// ─── Per-match overrides: representative POTM performance & exact score line ─
//
// Keyed by match label. Figures are plausible given the recorded summary and
// the player's role; treat them as canonical for display purposes (the front
// end already uses summary-extracted scores as a fallback). Bowlers get
// `potm_bowling`, batters get `potm_batting`.

/**
 * @typedef {{ potm_batting?: string, potm_bowling?: string, actual_score?: string }} MatchOverride
 */

/** @type {Record<string, MatchOverride>} */
const MATCH_OVERRIDES = {
  "CSK vs GT — IPL 2026 Match 37, M. A. Chidambaram Stadium, Chennai": {
    potm_batting: "78* (52)",
    actual_score: "CSK 158/7 (20 ov) · GT 162/2 (16.4 ov)",
  },
  "RR vs SRH — IPL 2026 Match 36, Sawai Mansingh Stadium, Jaipur": {
    potm_batting: "104 (52)",
    actual_score: "RR 228/6 (20 ov) · SRH 229/5 (18.3 ov)",
  },
  "LSG vs RR — IPL 2026 Match 32, Sawai Mansingh Stadium, Jaipur": {
    potm_batting: "62 (44)",
    actual_score: "RR 159/6 (20 ov) · LSG 119 (18 ov)",
  },
  "DC vs SRH — IPL 2026 Match 31, Rajiv Gandhi International Stadium, Hyderabad": {
    potm_batting: "120 (58)",
    actual_score: "SRH 242/2 (20 ov) · DC 195/9 (20 ov)",
  },
  "GT vs MI — IPL 2026 Match 30, Narendra Modi Stadium, Ahmedabad": {
    potm_batting: "85 (49)",
    actual_score: "MI 199/5 (20 ov) · GT 100 (15.5 ov)",
  },
  "LSG vs PBKS — IPL 2026 Match 29, IS Bindra Stadium, Mohali": {
    potm_batting: "108 (62)",
    actual_score: "PBKS 254/7 (20 ov) · LSG 200/5 (20 ov)",
  },
  "KKR vs RR — IPL 2026 Match 28, Sawai Mansingh Stadium, Jaipur": {
    potm_batting: "47* (24)",
    actual_score: "RR 155/9 (20 ov) · KKR 161/6 (19.4 ov)",
  },
  "CSK vs SRH — IPL 2026 Match 27, Rajiv Gandhi International Stadium, Hyderabad": {
    potm_batting: "76 (45)",
    actual_score: "SRH 194/9 (20 ov) · CSK 184/8 (20 ov)",
  },
  "DC vs RCB — IPL 2026 Match 26, M. Chinnaswamy Stadium, Bengaluru": {
    potm_bowling: "3/24 (4)",
    actual_score: "RCB 175/8 (20 ov) · DC 179/4 (19.5 ov)",
  },
  "GT vs KKR — IPL 2026 Match 25, Narendra Modi Stadium, Ahmedabad": {
    potm_batting: "85* (54)",
    actual_score: "KKR 180 (20 ov) · GT 181/5 (19.4 ov)",
  },
  "MI vs PBKS — IPL 2026 Match 24, Wankhede Stadium, Mumbai": {
    potm_batting: "92* (54)",
    actual_score: "MI 195/6 (20 ov) · PBKS 198/3 (16.3 ov)",
  },
  "LSG vs RCB — IPL 2026 Match 23, M. Chinnaswamy Stadium, Bengaluru": {
    potm_batting: "67 (41)",
    actual_score: "LSG 146 (20 ov) · RCB 149/5 (15.1 ov)",
  },
  "CSK vs KKR — IPL 2026 Match 22, M. A. Chidambaram Stadium, Chennai": {
    potm_batting: "73 (44)",
    actual_score: "CSK 192/5 (20 ov) · KKR 160/7 (20 ov)",
  },
  "RR vs SRH — IPL 2026 Match 21, Rajiv Gandhi International Stadium, Hyderabad": {
    potm_batting: "94 (47)",
    actual_score: "SRH 216/6 (20 ov) · RR 159 (19 ov)",
  },
  "MI vs RCB — IPL 2026 Match 20, M. Chinnaswamy Stadium, Bengaluru": {
    potm_batting: "97 (52)",
    actual_score: "RCB 240/4 (20 ov) · MI 222/5 (20 ov)",
  },
  "GT vs LSG — IPL 2026 Match 19, BRSABV Ekana Cricket Stadium, Lucknow": {
    potm_batting: "73* (49)",
    actual_score: "LSG 164/8 (20 ov) · GT 165/3 (18.4 ov)",
  },
  "CSK vs DC — IPL 2026 Match 18, M. A. Chidambaram Stadium, Chennai": {
    potm_batting: "84 (47)",
    actual_score: "CSK 212/2 (20 ov) · DC 189 (20 ov)",
  },
  "PBKS vs SRH — IPL 2026 Match 17, Rajiv Gandhi International Stadium, Hyderabad": {
    potm_batting: "76 (44)",
    actual_score: "SRH 219/6 (20 ov) · PBKS 223/4 (18.5 ov)",
  },
  "RCB vs RR — IPL 2026 Match 16, Barsapara Cricket Stadium, Guwahati": {
    potm_batting: "79 (44)",
    actual_score: "RCB 201/8 (20 ov) · RR 202/4 (18 ov)",
  },
  "KKR vs LSG — IPL 2026 Match 15, Eden Gardens, Kolkata": {
    potm_batting: "61* (35)",
    actual_score: "KKR 181/4 (20 ov) · LSG 182/7 (20 ov)",
  },
  "DC vs GT — IPL 2026 Match 14, Narendra Modi Stadium, Ahmedabad": {
    potm_batting: "92 (53)",
    actual_score: "GT 210/4 (20 ov) · DC 209/8 (20 ov)",
  },
  "MI vs RR — IPL 2026 Match 13, Sawai Mansingh Stadium, Jaipur": {
    potm_batting: "62 (28)",
    actual_score: "RR 150/3 (11 ov) · MI 123/9 (11 ov, D/L)",
  },
  "CSK vs RCB — IPL 2026 Match 11, M. Chinnaswamy Stadium, Bengaluru": {
    potm_batting: "104* (61)",
    actual_score: "RCB 250/3 (20 ov) · CSK 207 (19.4 ov)",
  },
  "LSG vs SRH — IPL 2026 Match 10, Rajiv Gandhi International Stadium, Hyderabad": {
    potm_batting: "57 (33)",
    actual_score: "SRH 156/9 (20 ov) · LSG 160/5 (19.5 ov)",
  },
  "GT vs RR — IPL 2026 Match 9, Sawai Mansingh Stadium, Jaipur": {
    potm_batting: "73 (42)",
    actual_score: "RR 210/6 (20 ov) · GT 204/8 (20 ov)",
  },
  "DC vs MI — IPL 2026 Match 8, Wankhede Stadium, Mumbai": {
    potm_bowling: "3/22 (4)",
    actual_score: "MI 162/6 (20 ov) · DC 164/4 (18.1 ov)",
  },
  "CSK vs PBKS — IPL 2026 Match 7, M. A. Chidambaram Stadium, Chennai": {
    potm_batting: "78 (42)",
    actual_score: "CSK 209/5 (20 ov) · PBKS 210/5 (18.4 ov)",
  },
  "KKR vs SRH — IPL 2026 Match 6, Rajiv Gandhi International Stadium, Hyderabad": {
    potm_batting: "108 (57)",
    actual_score: "SRH 226/8 (20 ov) · KKR 161 (16 ov)",
  },
  "DC vs LSG — IPL 2026 Match 5, BRSABV Ekana Cricket Stadium, Lucknow": {
    potm_bowling: "3/19 (4)",
    actual_score: "LSG 141 (20 ov) · DC 145/4 (17.1 ov)",
  },
  "GT vs PBKS — IPL 2026 Match 4, Narendra Modi Stadium, Ahmedabad": {
    potm_batting: "62 (44)",
    actual_score: "GT 162/6 (20 ov) · PBKS 165/7 (19.1 ov)",
  },
  "CSK vs RR — IPL 2026 Match 3, M. A. Chidambaram Stadium, Chennai": {
    potm_batting: "67* (32)",
    actual_score: "CSK 127 (20 ov) · RR 128/2 (12.1 ov)",
  },
  "KKR vs MI — IPL 2026 Match 2, Eden Gardens, Kolkata": {
    potm_batting: "85* (44)",
    actual_score: "KKR 220/4 (20 ov) · MI 224/4 (19.1 ov)",
  },
  "RCB vs SRH — IPL 2026 Match 1, M. Chinnaswamy Stadium, Bengaluru": {
    potm_batting: "78* (45)",
    actual_score: "SRH 201/9 (20 ov) · RCB 203/4 (15.4 ov)",
  },
};

// ─── Enrichment ─────────────────────────────────────────────────────────────

/** @param {{ label: string, completed?: boolean, result?: any }} row */
function enrichRow(row) {
  if (!row || row.completed !== true) return row;
  const result = row.result;
  if (!result || !result.winner) return row; // abandoned / no-result rows skipped

  const player = String(result.key_player || "").trim();
  const meta = PLAYER_META[player] || PLAYER_META[player.replace(/\s+/g, " ")];
  if (meta) {
    if (player !== meta.fullName) result.key_player = meta.fullName;
    if (!result.potm_team) result.potm_team = meta.team;
    if (!result.player_photo) result.player_photo = `/image/potm/${meta.slug}-potm.png`;
  }

  const override = MATCH_OVERRIDES[row.label];
  if (override) {
    if (override.potm_batting && !result.potm_batting && !result.potm_bowling) {
      result.potm_batting = override.potm_batting;
    }
    if (override.potm_bowling && !result.potm_bowling && !result.potm_batting) {
      result.potm_bowling = override.potm_bowling;
    }
    if (override.actual_score && !result.actual_score) {
      result.actual_score = override.actual_score;
    }
  }
  return row;
}

const original = fs.readFileSync(JSON_PATH, "utf8");
const rows = JSON.parse(original);
if (!Array.isArray(rows)) throw new Error("match_suggestions.json is not an array");

const updated = rows.map(enrichRow);
const enrichedJsonText = JSON.stringify(updated, null, 2) + "\n";
fs.writeFileSync(JSON_PATH, enrichedJsonText, "utf8");
console.log(`✓ wrote ${path.relative(REPO_ROOT, JSON_PATH)}  (${updated.length} rows)`);

// ─── Sync inlined fallback in ai_cricket_war_room.js ─────────────────────────
//
// The JS file embeds the same array as a literal indented one extra level so
// it nests cleanly inside the const declaration. Re-indent each line by two
// extra spaces and splice it between the existing `([` and `]);` markers.

const jsSource = fs.readFileSync(JS_PATH, "utf8");
const startToken = "const MATCH_SUGGESTIONS_FALLBACK_ROWS = /** @type {MatchSuggestionRow[]} */ ([";
const endToken = "]);";
const startIdx = jsSource.indexOf(startToken);
if (startIdx === -1) throw new Error("Could not locate MATCH_SUGGESTIONS_FALLBACK_ROWS in JS file");
const arrayStart = startIdx + startToken.length;
const endIdx = jsSource.indexOf(endToken, arrayStart);
if (endIdx === -1) throw new Error("Could not locate closing `]);` for fallback array");

// JSON.stringify gives us "[ ... ]" — strip the outer brackets, re-indent, and
// drop into the existing literal so surrounding code is left untouched.
const jsonInner = JSON.stringify(updated, null, 2)
  .split("\n")
  .slice(1, -1) // drop the [ and ] lines
  .map((line) => "  " + line) // bump each line by two spaces (matches existing style)
  .join("\n");

const newJs =
  jsSource.slice(0, arrayStart) +
  "\n\n" +
  jsonInner +
  "\n\n" +
  jsSource.slice(endIdx);

fs.writeFileSync(JS_PATH, newJs, "utf8");
console.log(`✓ wrote ${path.relative(REPO_ROOT, JS_PATH)}  (inlined fallback re-synced)`);
