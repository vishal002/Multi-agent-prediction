/**
 * Adds optional result.key_player for completed fixtures (demo catalog data)
 * and rewrites MATCH_SUGGESTIONS_FALLBACK_ROWS in ai_cricket_war_room.js from match_suggestions.json.
 * Run from repo root: node scripts/enrich-match-result-key-players.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const jsonPath = path.join(root, "match_suggestions.json");
const jsPath = path.join(root, "ai_cricket_war_room.js");

/** Illustrative standout per winning franchise for fictional IPL 2026 demo rows. */
const KEY_PLAYER_BY_WINNER = {
  CSK: "R Ravindra",
  DC: "K Ahmed",
  GT: "S Gill",
  KKR: "A Russell",
  LSG: "N Pooran",
  MI: "T Varma",
  PBKS: "S Dhawan",
  RCB: "V Kohli",
  RR: "Y Jaiswal",
  SRH: "T Head",
};

const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
if (!Array.isArray(data)) {
  console.error("match_suggestions.json must be a JSON array");
  process.exit(1);
}

for (const row of data) {
  if (!row || typeof row !== "object") continue;
  if (!row.completed || !row.result || typeof row.result !== "object") continue;
  const w = String(row.result.winner || "").trim();
  if (!w) continue;
  const existing = String(row.result.key_player || row.result.man_of_the_match || "").trim();
  if (existing) continue;
  const pick = KEY_PLAYER_BY_WINNER[w];
  if (pick) row.result.key_player = pick;
}

fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + "\n");

let js = fs.readFileSync(jsPath, "utf8");
const raw = JSON.stringify(data, null, 2);
const inner = raw
  .substring(1, raw.lastIndexOf("]"))
  .split("\n")
  .map((l) => (l ? `  ${l}` : ""))
  .join("\n");
const block = `const MATCH_SUGGESTIONS_FALLBACK_ROWS = /** @type {MatchSuggestionRow[]} */ ([\n${inner}\n]);`;
const re =
  /const MATCH_SUGGESTIONS_FALLBACK_ROWS = \/\*\* @type \{MatchSuggestionRow\[\]\} \*\/ \(\[[\s\S]*?\n\]\);/;
if (!re.test(js)) {
  console.error("Could not find MATCH_SUGGESTIONS_FALLBACK_ROWS block in ai_cricket_war_room.js");
  process.exit(1);
}
js = js.replace(re, block);
fs.writeFileSync(jsPath, js);
console.log("Enriched result.key_player where missing; synced MATCH_SUGGESTIONS_FALLBACK_ROWS.");
