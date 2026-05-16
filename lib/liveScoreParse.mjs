/**
 * Shared live-score snippet parser (browser + Node gateway).
 * Keep in sync with {@link parseLiveScoreSnippet} usage in ai_cricket_war_room.js.
 */

/**
 * @param {string} snippet
 * @param {{ codeA?: string, codeB?: string } | null} [fixtureTeams]
 * @returns {{
 *   runs: number,
 *   wickets: number,
 *   overs: string,
 *   batting_team: string | null,
 *   bowling_team: string | null,
 *   innings: 1 | 2 | null,
 * } | null}
 */
export function parseLiveScoreSnippet(snippet, fixtureTeams) {
  if (typeof snippet !== "string") return null;
  const text = snippet.trim();
  if (!text) return null;

  const SCORE_WITH_OVERS =
    /(?:\b([A-Z]{2,4})\s+)?\b(\d{1,3})\/(10|\d)\s*\(\s*(\d+(?:\.\d)?)(?:\s*(?:ov|overs?))?\s*\)/g;

  /** @type {Array<{ team: string|null, runs: number, wickets: number, overs: string, idx: number }>} */
  const matches = [];
  let m;
  while ((m = SCORE_WITH_OVERS.exec(text)) !== null) {
    matches.push({
      team: m[1] ? m[1].toUpperCase() : null,
      runs: parseInt(m[2], 10),
      wickets: parseInt(m[3], 10),
      overs: m[4],
      idx: m.index,
    });
  }
  if (matches.length === 0) return null;

  const codeA = (fixtureTeams?.codeA || "").toUpperCase();
  const codeB = (fixtureTeams?.codeB || "").toUpperCase();
  const fixtureCodes = new Set([codeA, codeB].filter(Boolean));

  const fixtureMatches = matches.filter((x) => x.team && fixtureCodes.has(x.team));

  /** @type {typeof matches[number]} */
  let chosen;
  if (fixtureMatches.length === 1) {
    chosen = fixtureMatches[0];
  } else if (fixtureMatches.length >= 2) {
    chosen = fixtureMatches[fixtureMatches.length - 1];
  } else {
    chosen = matches[matches.length - 1];
  }

  let batting_team = chosen.team && fixtureCodes.has(chosen.team) ? chosen.team : null;
  /** @type {string | null} */
  let bowling_team = null;
  if (batting_team) {
    bowling_team = batting_team === codeA ? codeB : batting_team === codeB ? codeA : null;
  }

  /** @type {1 | 2 | null} */
  let innings = null;
  if (/\b2nd\s+innings?\b/i.test(text)) innings = 2;
  else if (/\b1st\s+innings?\b/i.test(text)) innings = 1;
  else if (
    /\b(chasing|target\s*[:\-]?\s*\d+|RRR|req(?:uired)?\s*(?:run\s*)?rate|need\s+\d+\s+(?:runs?|more|in\s+\d+)|DLS)\b/i.test(
      text,
    )
  ) {
    innings = 2;
  } else if (fixtureMatches.length >= 2) {
    innings = 2;
  }

  return {
    runs: chosen.runs,
    wickets: chosen.wickets,
    overs: chosen.overs,
    batting_team,
    bowling_team,
    innings,
  };
}

/**
 * @param {unknown} inning
 * @returns {1 | 2 | null}
 */
export function inningsFromInningField(inning) {
  if (inning === 1 || inning === "1") return 1;
  if (inning === 2 || inning === "2") return 2;
  if (typeof inning === "string") {
    const lo = inning.trim().toLowerCase();
    if (lo === "2nd" || lo.startsWith("second")) return 2;
    if (lo === "1st" || lo.startsWith("first")) return 1;
  }
  return null;
}
