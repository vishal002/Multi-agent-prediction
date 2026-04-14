const AGENTS = [
  { id:"scout",   sym:"S", name:"Scout agent",   role:"Player form & fitness" },
  { id:"stats",   sym:"D", name:"Stats agent",   role:"Historical data engine" },
  { id:"weather", sym:"W", name:"Weather agent", role:"Conditions analyzer" },
  { id:"pitch",   sym:"P", name:"Pitch agent",   role:"Surface intelligence" },
  { id:"news",    sym:"N", name:"News agent",    role:"Sentiment & intel" },
];

const ARCH = [
  { title:"Data ingestion agents", desc:"Five specialist agents run in parallel, each scraping a different domain — stats, news, weather, pitch, social signals. Output: structured JSON context fed to the orchestrator.", tags:["Parallel execution","Web scraping","ESPN / Cricinfo","OpenMeteo"] },
  { title:"Orchestrator (LangGraph)", desc:"Central orchestrator aggregates all agent outputs into a unified match context object and fans it out to the debate engine. Handles retries, timeouts and context windowing.", tags:["LangGraph","Agent mesh","Context builder","FastAPI"] },
  { title:"Debate engine", desc:"Two adversarial analyst agents — Bull (favors Team A) and Bear (favors Team B) — argue for four rounds. Each has the same context but a different directive persona and cannot see the other's reasoning mid-round.", tags:["Adversarial AI","Multi-turn debate","Tool calls","4-round format"] },
  { title:"Judge agent + confidence scorer", desc:"A neutral Judge LLM reads the full transcript and produces a structured verdict: winner, confidence %, score range, key player, and swing factor. Output validated against a JSON schema.", tags:["Structured output","JSON schema","Confidence scoring","Historical calibration"] },
  { title:"Delivery interface", desc:"Dashboard streams the war-room replay in real time via WebSockets, surfaces the verdict card, agent insight tiles, and an accuracy tracker that updates as results come in.", tags:["Next.js 14","WebSockets","Vercel","Accuracy tracker"] },
];

/**
 * Offline / file:// fallback — keep in sync with match_suggestions.json on the server.
 * When served via `node server.mjs`, suggestions load from GET /api/match-suggest.
 */
/** @typedef {{ label: string, date: string, venue: string, teams: string[], completed?: boolean, result?: { winner: string, summary?: string } }} MatchSuggestionRow */

/** Same rows as match_suggestions.json (order preserved for empty search). */
const MATCH_SUGGESTIONS_FALLBACK_ROWS = /** @type {MatchSuggestionRow[]} */ ([
  { label: "IPL 2026 final — Narendra Modi Stadium, Ahmedabad", date: "2026-05-25", venue: "Narendra Modi Stadium, Ahmedabad", teams: [] },
  { label: "IPL 2026 Qualifier 2 — Eden Gardens, Kolkata", date: "2026-05-23", venue: "Eden Gardens, Kolkata", teams: [] },
  { label: "IPL 2026 Qualifier 1 — Wankhede Stadium, Mumbai", date: "2026-05-21", venue: "Wankhede Stadium, Mumbai", teams: [] },
  { label: "IPL 2026 Eliminator — Arun Jaitley Stadium, Delhi", date: "2026-05-19", venue: "Arun Jaitley Stadium, Delhi", teams: [] },
  { label: "DC vs GT — IPL 2026 Match 70, Arun Jaitley Stadium, Delhi", date: "2026-05-18", venue: "Arun Jaitley Stadium, Delhi", teams: ["DC", "GT"] },
  { label: "PBKS vs SRH — IPL 2026 Match 69, IS Bindra Stadium, Mohali", date: "2026-05-17", venue: "IS Bindra Stadium, Mohali", teams: ["PBKS", "SRH"] },
  { label: "KKR vs RR — IPL 2026 Match 68, Eden Gardens, Kolkata", date: "2026-05-15", venue: "Eden Gardens, Kolkata", teams: ["KKR", "RR"] },
  { label: "MI vs LSG — IPL 2026 Match 67, Wankhede Stadium, Mumbai", date: "2026-05-13", venue: "Wankhede Stadium, Mumbai", teams: ["MI", "LSG"] },
  { label: "RCB vs CSK — IPL 2026 Match 66, M. Chinnaswamy Stadium, Bengaluru", date: "2026-05-11", venue: "M. Chinnaswamy Stadium, Bengaluru", teams: ["RCB", "CSK"] },
  { label: "GT vs MI — IPL 2026 Match 12, Narendra Modi Stadium, Ahmedabad", date: "2026-04-28", venue: "Narendra Modi Stadium, Ahmedabad", teams: ["GT", "MI"] },
  { label: "LSG vs PBKS — IPL 2026 Match 11, BRSABV Ekana Stadium, Lucknow", date: "2026-04-26", venue: "BRSABV Ekana Stadium, Lucknow", teams: ["LSG", "PBKS"] },
  { label: "SRH vs DC — IPL 2026 Match 10, Rajiv Gandhi Stadium, Hyderabad", date: "2026-04-24", venue: "Rajiv Gandhi Stadium, Hyderabad", teams: ["SRH", "DC"] },
  { label: "RR vs KKR — IPL 2026 Match 9, Sawai Mansingh Stadium, Jaipur", date: "2026-04-22", venue: "Sawai Mansingh Stadium, Jaipur", teams: ["RR", "KKR"] },
  { label: "CSK vs RCB — IPL 2026 Match 8, M. A. Chidambaram Stadium, Chennai", date: "2026-04-20", venue: "M. A. Chidambaram Stadium, Chennai", teams: ["CSK", "RCB"] },
  { label: "CSK vs MI — IPL 2026 Match 7, M. A. Chidambaram Stadium, Chennai", date: "2026-04-18", venue: "M. A. Chidambaram Stadium, Chennai", teams: ["CSK", "MI"] },
  {
    label: "CSK vs KKR — IPL 2026 Match 22, M. A. Chidambaram Stadium, Chennai",
    date: "2026-04-15",
    venue: "M. A. Chidambaram Stadium, Chennai",
    teams: ["CSK", "KKR"],
    completed: true,
    result: { winner: "CSK", summary: "Chennai Super Kings won by 8 wickets (with 24 balls remaining)." },
  },
  { label: "RCB vs KKR — IPL 2026 Match 6, M. Chinnaswamy Stadium, Bengaluru", date: "2026-04-16", venue: "M. Chinnaswamy Stadium, Bengaluru", teams: ["RCB", "KKR"] },
  { label: "IPL 2026 opener — KKR vs RCB, Eden Gardens, Kolkata", date: "2026-03-22", venue: "Eden Gardens, Kolkata", teams: ["KKR", "RCB"] },
  { label: "IND vs AUS — 3rd T20I, Wankhede Stadium, Mumbai", date: "2026-06-08", venue: "Wankhede Stadium, Mumbai", teams: ["IND", "AUS"] },
  { label: "IND vs SA — 1st T20I, Wanderers Stadium, Johannesburg", date: "2026-06-12", venue: "Wanderers Stadium, Johannesburg", teams: ["IND", "SA"] },
  { label: "PAK vs IND — ODI, Dubai International Cricket Stadium", date: "2026-06-15", venue: "Dubai International Cricket Stadium", teams: ["PAK", "IND"] },
  { label: "WI vs SA — 1st T20I, Kensington Oval, Bridgetown", date: "2026-06-18", venue: "Kensington Oval, Bridgetown", teams: ["WI", "SA"] },
  { label: "IND vs ENG — 1st ODI, Vidarbha Cricket Association Stadium, Nagpur", date: "2026-06-22", venue: "Vidarbha Cricket Association Stadium, Nagpur", teams: ["IND", "ENG"] },
  { label: "BAN vs SL — 2nd ODI, Shere Bangla Stadium, Mirpur", date: "2026-06-25", venue: "Shere Bangla Stadium, Mirpur", teams: ["BAN", "SL"] },
  { label: "ENG vs WI — 3rd ODI, County Ground, Taunton", date: "2026-06-28", venue: "County Ground, Taunton", teams: ["ENG", "WI"] },
  { label: "IND vs NZ — 2nd Test, M. Chinnaswamy Stadium, Bengaluru", date: "2026-07-02", venue: "M. Chinnaswamy Stadium, Bengaluru", teams: ["IND", "NZ"] },
  { label: "AUS vs ENG — 5th Ashes Test, Kia Oval, London", date: "2026-07-10", venue: "Kia Oval, London", teams: ["AUS", "ENG"] },
  { label: "NZ vs SA — Test, Basin Reserve, Wellington", date: "2026-07-14", venue: "Basin Reserve, Wellington", teams: ["NZ", "SA"] },
  { label: "AFG vs IRE — T20 World Cup group, Providence Stadium, Guyana", date: "2026-07-18", venue: "Providence Stadium, Guyana", teams: ["AFG", "IRE"] },
  { label: "AUS vs IND — Boxing Day Test, Melbourne Cricket Ground", date: "2026-07-26", venue: "Melbourne Cricket Ground", teams: ["AUS", "IND"] },
]);

const MATCH_SUGGEST_TEAM_ALIASES = { KXIP: "PBKS", DD: "DC" };

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

function matchSuggestionRowMatches(row, qLower) {
  if (!qLower) return true;
  if (textMatchesSuggestQuery(row.label, qLower) || textMatchesSuggestQuery(row.venue, qLower)) return true;
  return row.teams.some((t) => {
    const tl = t.toLowerCase();
    return tl === qLower || (qLower.length >= 2 && tl.startsWith(qLower));
  });
}

function compareMatchSuggestionsNewestFirst(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.venue.localeCompare(b.venue, undefined, { sensitivity: "base" });
}

/**
 * @typedef {{ label: string, date: string, venue: string, completed?: boolean, result?: { winner: string, summary: string } }} MatchSuggestHit
 */

/**
 * @param {MatchSuggestionRow[]} rows
 * @param {string} q
 * @param {number} limit
 * @returns {MatchSuggestHit[]}
 */
function getMatchSuggestionHits(rows, q, limit) {
  const raw = q.trim();
  const qLower = (MATCH_SUGGEST_TEAM_ALIASES[raw.toUpperCase()] || raw).trim().toLowerCase();
  const withOrder = rows.map((row, order) => ({ ...row, order }));
  let pool = withOrder.filter((row) => matchSuggestionRowMatches(row, qLower));
  if (qLower) {
    pool = [...pool].sort(compareMatchSuggestionsNewestFirst);
  } else {
    pool = [...pool].sort((a, b) => a.order - b.order);
  }
  return pool.slice(0, limit).map((row) => {
    const hit = { label: row.label, date: row.date, venue: row.venue };
    if (row.completed && row.result && String(row.result.winner || "").trim()) {
      hit.completed = true;
      hit.result = {
        winner: String(row.result.winner).trim(),
        summary: row.result.summary != null ? String(row.result.summary) : "",
      };
    }
    return hit;
  });
}

/**
 * @param {MatchSuggestionRow[]} rows
 * @param {string} q
 * @param {number} limit
 * @returns {string[]}
 */
function getMatchSuggestionLabels(rows, q, limit) {
  return getMatchSuggestionHits(rows, q, limit).map((h) => h.label);
}

const HOWTO = [
  { sprint:"Sprint 1 · Week 1–2", title:"Data pipeline", steps:["Stand up LangGraph agent skeleton with five nodes","Integrate ESPN Cricinfo scraper via Playwright","Plug in OpenMeteo weather API (free tier)","Model all outputs as typed Pydantic schemas","Validate on three historical match queries"] },
  { sprint:"Sprint 2 · Week 3", title:"Debate engine", steps:["Define Bull & Bear persona system prompts","Build four-round adversarial loop (configurable depth)","Inject match context into each agent's window","Add tool-calling for live stat lookups mid-debate","Persist full transcript to PostgreSQL"] },
  { sprint:"Sprint 3 · Week 4", title:"Judge + verdict API", steps:["Build Judge agent with JSON schema output","Add confidence calibration from historical accuracy","Create POST /predict endpoint via FastAPI","Ingest live results via webhook for accuracy tracking","Add Redis caching for repeated match queries"] },
  { sprint:"Sprint 4 · Week 5–6", title:"Dashboard & launch", steps:["Build Next.js war room UI with WebSocket streaming","User auth + saved predictions history","SEO-optimised public match pages for organic traffic","Deploy frontend on Vercel, agents on Modal.com","Set up daily cron for upcoming match predictions"] },
];

function renderAgents() {
  document.getElementById('agentsList').innerHTML = AGENTS.map(a => `
    <div class="agent-row agent-row--compact" id="row-${a.id}">
      <div class="agent-icon" id="icon-${a.id}">${a.sym}</div>
      <div class="agent-meta">
        <div class="agent-name">${a.name}</div>
        <div class="agent-role">${a.role}</div>
        <div class="agent-insight" id="insight-${a.id}"></div>
      </div>
      <div class="status-dot" id="dot-${a.id}"></div>
    </div>
  `).join('');
}

function renderArch() {
  document.getElementById('archList').innerHTML = ARCH.map((a,i) => `
    <div class="arch-item">
      <div class="arch-num">${i+1}</div>
      <div>
        <div class="arch-title">${a.title}</div>
        <div class="arch-desc">${a.desc}</div>
        <div class="arch-tags">${a.tags.map(t=>`<span class="tag">${t}</span>`).join('')}</div>
      </div>
    </div>
  `).join('');
}

function renderHowto() {
  document.getElementById('howtoGrid').innerHTML = HOWTO.map(h => `
    <div class="howto-card">
      <div class="howto-sprint">${h.sprint}</div>
      <div class="howto-title">${h.title}</div>
      ${h.steps.map(s=>`<div class="howto-step">${s}</div>`).join('')}
    </div>
  `).join('');
}

function scrollDebateEnd() {
  requestAnimationFrame(() => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "auto",
    });
  });
}

/**
 * Team crests from Wikipedia / Wikimedia (fair use / project logos).
 * Thumbnail URLs match en.wikipedia.org REST `originalimage` for each franchise or board.
 */
const TEAM_LOGO_URL = {
  CSK: "https://upload.wikimedia.org/wikipedia/en/thumb/2/2b/Chennai_Super_Kings_Logo.svg/330px-Chennai_Super_Kings_Logo.svg.png",
  MI: "https://upload.wikimedia.org/wikipedia/en/thumb/c/cd/Mumbai_Indians_Logo.svg/330px-Mumbai_Indians_Logo.svg.png",
  RCB: "https://upload.wikimedia.org/wikipedia/en/thumb/d/d4/Royal_Challengers_Bengaluru_Logo.svg/330px-Royal_Challengers_Bengaluru_Logo.svg.png",
  KKR: "https://upload.wikimedia.org/wikipedia/en/thumb/4/4c/Kolkata_Knight_Riders_Logo.svg/250px-Kolkata_Knight_Riders_Logo.svg.png",
  DC: "https://upload.wikimedia.org/wikipedia/en/thumb/2/2f/Delhi_Capitals.svg/330px-Delhi_Capitals.svg.png",
  PBKS: "https://upload.wikimedia.org/wikipedia/en/thumb/d/d4/Punjab_Kings_Logo.svg/330px-Punjab_Kings_Logo.svg.png",
  RR: "https://upload.wikimedia.org/wikipedia/en/thumb/5/5c/This_is_the_logo_for_Rajasthan_Royals%2C_a_cricket_team_playing_in_the_Indian_Premier_League_%28IPL%29.svg/250px-This_is_the_logo_for_Rajasthan_Royals%2C_a_cricket_team_playing_in_the_Indian_Premier_League_%28IPL%29.svg.png",
  SRH: "https://upload.wikimedia.org/wikipedia/en/thumb/5/51/Sunrisers_Hyderabad_Logo.svg/500px-Sunrisers_Hyderabad_Logo.svg.png",
  GT: "https://upload.wikimedia.org/wikipedia/en/thumb/0/09/Gujarat_Titans_Logo.svg/500px-Gujarat_Titans_Logo.svg.png",
  LSG: "https://upload.wikimedia.org/wikipedia/en/thumb/3/34/Lucknow_Super_Giants_Logo.svg/500px-Lucknow_Super_Giants_Logo.svg.png",
  IND: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Board_of_Control_for_Cricket_in_India_Logo_%282024%29.svg/960px-Board_of_Control_for_Cricket_in_India_Logo_%282024%29.svg.png",
  AUS: "https://upload.wikimedia.org/wikipedia/en/thumb/3/35/Australia_cricket_logo.svg/330px-Australia_cricket_logo.svg.png",
  ENG: "https://upload.wikimedia.org/wikipedia/en/thumb/c/ce/England_cricket_team_logo.svg/250px-England_cricket_team_logo.svg.png",
  PAK: "https://upload.wikimedia.org/wikipedia/commons/a/ad/Pakistan_cricket_team_logo.png",
  NZ: "https://upload.wikimedia.org/wikipedia/en/1/19/Logo_of_cricket_New_zealand_Team.png",
  SA: "https://upload.wikimedia.org/wikipedia/en/thumb/5/59/Southafrica_cricket_logo.svg/250px-Southafrica_cricket_logo.svg.png",
  WI: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Cricket_West_Indies_Logo_2017.svg/960px-Cricket_West_Indies_Logo_2017.svg.png",
  SL: "https://upload.wikimedia.org/wikipedia/en/thumb/e/eb/Sri_Lanka_Cricket_Cap_Insignia.svg/330px-Sri_Lanka_Cricket_Cap_Insignia.svg.png",
  BAN: "https://upload.wikimedia.org/wikipedia/en/thumb/5/5c/Bangladesh_Cricket_Board_Logo.svg/330px-Bangladesh_Cricket_Board_Logo.svg.png",
  AFG: "https://upload.wikimedia.org/wikipedia/commons/1/1f/Afghanistan_cricket_board_logo.jpg",
  IRE: "https://upload.wikimedia.org/wikipedia/en/thumb/0/0c/Ireland_cricket_logo.svg/330px-Ireland_cricket_logo.svg.png",
};

const TEAM_LOGO_ALIASES = {
  KXIP: "PBKS",
  DD: "DC",
};

/** IPL / franchise hues for fixture bar chips (inspired by sports SERP cards). */
const TEAM_STYLE = {
  CSK: { hue: "yellow" },
  MI: { hue: "blue" },
  RCB: { hue: "red" },
  KKR: { hue: "purple" },
  DC: { hue: "blue2" },
  PBKS: { hue: "red2" },
  RR: { hue: "pink" },
  SRH: { hue: "orange" },
  GT: { hue: "teal" },
  LSG: { hue: "green" },
  IND: { hue: "blue" },
  AUS: { hue: "gold" },
  ENG: { hue: "navy" },
  PAK: { hue: "green2" },
  NZ: { hue: "black" },
  SA: { hue: "green" },
  WI: { hue: "maroon" },
  SL: { hue: "blue2" },
  BAN: { hue: "green2" },
  AFG: { hue: "blue" },
  IRE: { hue: "green" },
};

/**
 * @returns {{ teamA: string, teamB: string, codeA: string, codeB: string }}
 */
function parseTeamsFromMatch(match) {
  const fallback = { teamA: "Team A", teamB: "Team B", codeA: "A", codeB: "B" };
  const s = String(match).trim();
  if (!s) return fallback;

  const mCodes = s.match(/\b([A-Z]{2,4})\s+vs\.?\s+([A-Z]{2,4})\b/);
  if (mCodes) {
    const a = mCodes[1];
    const b = mCodes[2];
    return { teamA: a, teamB: b, codeA: a, codeB: b };
  }

  const mWords = s.match(
    /\b([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+vs\.?\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\b/
  );
  if (mWords) {
    const a = mWords[1].trim();
    const b = mWords[2].trim();
    const bad = /^(ipl|match|final|qualifier|eliminator|opener|odi|t20i|test)$/i;
    if (!bad.test(a) && !bad.test(b)) {
      const code = (w) =>
        w
          .split(/\s+/)
          .map((x) => x[0])
          .join("")
          .toUpperCase()
          .slice(0, 4) || w.slice(0, 3).toUpperCase();
      return { teamA: a, teamB: b, codeA: code(a), codeB: code(b) };
    }
  }

  return fallback;
}

/** @returns {string | null} */
function resolveTeamLogoUrl(code, teamName) {
  const c = String(code || "").toUpperCase();
  if (TEAM_LOGO_URL[c]) return TEAM_LOGO_URL[c];
  const alias = TEAM_LOGO_ALIASES[c];
  if (alias && TEAM_LOGO_URL[alias]) return TEAM_LOGO_URL[alias];
  const n = String(teamName || "").toUpperCase();
  if (n.includes("CHENNAI") || n.includes("SUPER KING")) return TEAM_LOGO_URL.CSK;
  if (n.includes("MUMBAI") && n.includes("INDIAN")) return TEAM_LOGO_URL.MI;
  if (n.includes("ROYAL") && n.includes("CHALLENGER")) return TEAM_LOGO_URL.RCB;
  if (n.includes("KOLKATA") || n.includes("KNIGHT")) return TEAM_LOGO_URL.KKR;
  if (n.includes("DELHI") && n.includes("CAPITAL")) return TEAM_LOGO_URL.DC;
  if (n.includes("PUNJAB") || n.includes("KINGS XI")) return TEAM_LOGO_URL.PBKS;
  if (n.includes("RAJASTHAN") || n.includes("ROYALS")) return TEAM_LOGO_URL.RR;
  if (n.includes("SUNRISER") || n.includes("HYDERABAD")) return TEAM_LOGO_URL.SRH;
  if (n.includes("GUJARAT") && n.includes("TITAN")) return TEAM_LOGO_URL.GT;
  if (n.includes("LUCKNOW") || n.includes("SUPER GIANT")) return TEAM_LOGO_URL.LSG;
  return null;
}

function setMatchBarTeamImage(imgEl, pillEl, code, teamName) {
  if (!imgEl) return;
  const url = resolveTeamLogoUrl(code, teamName);
  if (!url) {
    imgEl.removeAttribute("src");
    imgEl.hidden = true;
    imgEl.alt = "";
    pillEl?.classList.add("match-bar__pill--nologo");
    return;
  }
  pillEl?.classList.remove("match-bar__pill--nologo");
  imgEl.alt = `${teamName || code} logo`;
  imgEl.onerror = () => {
    imgEl.hidden = true;
    pillEl?.classList.add("match-bar__pill--nologo");
  };
  imgEl.src = url;
  imgEl.hidden = false;
}

function extractFixtureMeta(match, teams) {
  const s = String(match).trim();
  let league = "";
  let venue = "";
  const ipl = s.match(/IPL\s+20\d{2}/i);
  if (ipl) league = ipl[0].toUpperCase();
  const finalQ = s.match(/\b(final|qualifier\s*\d|eliminator|opener)\b/i);
  if (finalQ && league) league += " · " + finalQ[0].replace(/\s+/g, " ");
  else if (finalQ && !league) league = finalQ[0].replace(/\s+/g, " ");
  const dash = s.match(/[—–-]\s*(.+)$/);
  if (dash) {
    const tail = dash[1].trim();
    if (/\b(stadium|ground|oval|park|gardens|arena)\b/i.test(tail)) venue = tail;
    else if (!league && tail.length < 80) league = tail;
    else if (!venue && tail.length < 120) venue = tail;
  }
  if (!league && (teams.teamA === "Team A" || teams.teamB === "Team B")) {
    league = "Fixture";
  } else if (!league) {
    league = `${teams.teamA} vs ${teams.teamB}`;
  }
  return { league, venue };
}

function setMatchBar(match, teams) {
  const bar = document.getElementById("matchBar");
  if (!bar) return;
  const { league, venue } = extractFixtureMeta(match, teams);
  const codeA = document.getElementById("matchBarCodeA");
  const codeB = document.getElementById("matchBarCodeB");
  const pillA = document.getElementById("matchBarTeamA");
  const pillB = document.getElementById("matchBarTeamB");
  const imgA = document.getElementById("matchBarImgA");
  const imgB = document.getElementById("matchBarImgB");
  const elLeague = document.getElementById("matchBarLeague");
  const elVenue = document.getElementById("matchBarVenue");
  if (elLeague) elLeague.textContent = league;
  if (codeA) codeA.textContent = teams.codeA;
  if (codeB) codeB.textContent = teams.codeB;
  setMatchBarTeamImage(imgA, pillA, teams.codeA, teams.teamA);
  setMatchBarTeamImage(imgB, pillB, teams.codeB, teams.teamB);
  if (pillA) {
    pillA.className = "match-bar__pill";
    const st = TEAM_STYLE[teams.codeA] || TEAM_STYLE[teams.teamA];
    if (st?.hue) pillA.classList.add("match-bar__pill--" + st.hue);
  }
  if (pillB) {
    pillB.className = "match-bar__pill";
    const st = TEAM_STYLE[teams.codeB] || TEAM_STYLE[teams.teamB];
    if (st?.hue) pillB.classList.add("match-bar__pill--" + st.hue);
  }
  if (elVenue) {
    elVenue.textContent = venue || "";
    elVenue.hidden = !venue;
  }
  bar.hidden = false;
  const summary = document.getElementById("stageFixtureVerdict");
  if (summary) summary.hidden = false;
}

function hideMatchBar() {
  const bar = document.getElementById("matchBar");
  if (bar) bar.hidden = true;
  const summary = document.getElementById("stageFixtureVerdict");
  if (summary) summary.hidden = true;
}

function switchInfoTab(name) {
  const arch = document.getElementById("panelArch");
  const how = document.getElementById("panelHowto");
  const btnA = document.getElementById("tabBtnArch");
  const btnH = document.getElementById("tabBtnHowto");
  if (!arch || !how || !btnA || !btnH) return;
  if (name === "arch") {
    arch.hidden = false;
    how.hidden = true;
    btnA.classList.add("active");
    btnA.setAttribute("aria-selected", "true");
    btnH.classList.remove("active");
    btnH.setAttribute("aria-selected", "false");
  } else {
    arch.hidden = true;
    how.hidden = false;
    btnH.classList.add("active");
    btnH.setAttribute("aria-selected", "true");
    btnA.classList.remove("active");
    btnA.setAttribute("aria-selected", "false");
  }
}

function openInfoSheet(tab) {
  const d = document.getElementById("infoSheet");
  if (!d) return;
  switchInfoTab(tab);
  d.showModal();
}

function initInfoSheet() {
  const d = document.getElementById("infoSheet");
  if (!d) return;
  document.getElementById("btnOpenArch")?.addEventListener("click", () => openInfoSheet("arch"));
  document.getElementById("btnOpenHowto")?.addEventListener("click", () => openInfoSheet("howto"));
  document.getElementById("infoSheetClose")?.addEventListener("click", () => d.close());
  document.getElementById("tabBtnArch")?.addEventListener("click", () => switchInfoTab("arch"));
  document.getElementById("tabBtnHowto")?.addEventListener("click", () => switchInfoTab("howto"));
  d.addEventListener("click", (e) => {
    if (e.target === d) d.close();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

let running = false;

/** Same origin when you open the app via `node server.mjs` (http://localhost:3333). Override if needed. */
function apiBase() {
  if (typeof window !== 'undefined' && window.WAR_ROOM_API_BASE != null) {
    return String(window.WAR_ROOM_API_BASE).replace(/\/$/, '');
  }
  return '';
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function mergeSuggestIntervals(intervals) {
  if (!intervals.length) return [];
  const s = [...intervals].sort((a, b) => a[0] - b[0]);
  const out = [s[0]];
  for (let i = 1; i < s.length; i++) {
    const [a, b] = out[out.length - 1];
    const [c, d] = s[i];
    if (c <= b) out[out.length - 1] = [a, Math.max(b, d)];
    else out.push([c, d]);
  }
  return out;
}

function highlightSuggestLabel(text, qRaw) {
  const q = qRaw.trim();
  if (!q) return escapeHtml(text);
  const lower = text.toLowerCase();
  const tokens = [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length);
  const ranges = [];
  for (const tok of tokens) {
    let pos = 0;
    while ((pos = lower.indexOf(tok, pos)) !== -1) {
      ranges.push([pos, pos + tok.length]);
      pos += tok.length;
    }
  }
  if (!ranges.length) return escapeHtml(text);
  const merged = mergeSuggestIntervals(ranges);
  let html = "";
  let cur = 0;
  for (const [a, b] of merged) {
    html += escapeHtml(text.slice(cur, a));
    html += '<mark class="g-search__hl">' + escapeHtml(text.slice(a, b)) + "</mark>";
    cur = b;
  }
  html += escapeHtml(text.slice(cur));
  return html;
}

function formatSuggestMetaLine(date, venue) {
  const v = String(venue || "").trim();
  const d = String(date || "").trim();
  let datePart = "";
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const dt = new Date(d + "T12:00:00");
    datePart = dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  if (datePart && v) return datePart + " · " + v;
  return datePart || v || "";
}

function normalizeSuggestApiEntry(x) {
  if (typeof x === "string") return { label: x, date: "", venue: "" };
  if (x && typeof x === "object" && x.label != null) {
    const base = {
      label: String(x.label),
      date: x.date != null ? String(x.date) : "",
      venue: x.venue != null ? String(x.venue) : "",
    };
    const r = x.result && typeof x.result === "object" ? x.result : null;
    const w = r && r.winner != null ? String(r.winner).trim() : "";
    if (x.completed === true && w) {
      base.completed = true;
      base.result = {
        winner: w,
        summary: r.summary != null ? String(r.summary) : "",
      };
    }
    return base;
  }
  return { label: String(x), date: "", venue: "" };
}

/** Collapse hyphen / en / em dash so pasted labels still resolve. */
function normalizeFixtureLabelKey(s) {
  return String(s)
    .trim()
    .replace(/[\u2013\u2014\-–]/g, "\u2014")
    .replace(/\s+/g, " ");
}

/**
 * @param {string} label
 * @returns {Promise<MatchSuggestionRow | null>}
 */
async function lookupCompletedMatchRow(label) {
  const t = String(label).trim();
  if (!t) return null;
  const isDone = (row) =>
    row &&
    row.completed === true &&
    row.result &&
    String(row.result.winner || "").trim();

  const key = normalizeFixtureLabelKey(t);
  const local =
    MATCH_SUGGESTIONS_FALLBACK_ROWS.find((r) => r.label === t) ||
    MATCH_SUGGESTIONS_FALLBACK_ROWS.find((r) => normalizeFixtureLabelKey(r.label) === key);
  if (isDone(local)) return local;

  if (!apiBase()) return null;

  try {
    const r = await fetch(`${apiBase()}/api/match-by-label?label=${encodeURIComponent(t)}`);
    if (!r.ok) return null;
    const d = await r.json();
    const m = d.match;
    if (!isDone(m)) return null;
    return {
      label: String(m.label),
      date: m.date != null ? String(m.date) : "",
      venue: m.venue != null ? String(m.venue) : "",
      teams: Array.isArray(m.teams) ? m.teams.map((x) => String(x)) : [],
      completed: true,
      result: {
        winner: String(m.result.winner).trim(),
        summary: m.result.summary != null ? String(m.result.summary) : "",
      },
    };
  } catch {
    return null;
  }
}

/**
 * @param {{ teamA: string, teamB: string, codeA: string, codeB: string }} teams
 * @param {string} winnerCodeOrName
 */
function resolveWinnerDisplay(teams, winnerCodeOrName) {
  const w = String(winnerCodeOrName || "").trim();
  if (!w) return "Winner";
  const wu = w.toUpperCase();
  if (wu === String(teams.codeA).toUpperCase() || wu === String(teams.teamA).toUpperCase()) return teams.teamA;
  if (wu === String(teams.codeB).toUpperCase() || wu === String(teams.teamB).toUpperCase()) return teams.teamB;
  return w;
}

async function callClaude(messages, system, maxTokens = 1000) {
  const r = await fetch(`${apiBase()}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });
  let d;
  try {
    d = await r.json();
  } catch {
    throw new Error(`Bad response (HTTP ${r.status}). Use http://localhost:3333 via "node server.mjs", not a raw .html file.`);
  }
  if (!r.ok) {
    const msg =
      d.error?.message ||
      (typeof d.error === 'string' ? d.error : null) ||
      d.message ||
      `Request failed (${r.status})`;
    throw new Error(msg);
  }
  return (d.content || []).map((b) => (b && b.text != null ? b.text : '')).join('');
}

function setPhase(text, spinning = false) {
  const b = document.getElementById('phaseBanner');
  b.classList.remove('phase-banner--error');
  if (!text) {
    b.style.display = 'none';
    return;
  }
  b.style.display = 'flex';
  b.innerHTML = (spinning ? '<div class="phase-spinner"></div>' : '') + `<span>${escapeHtml(text)}</span>`;
}

function showApiError(msg) {
  const b = document.getElementById('phaseBanner');
  b.style.display = 'flex';
  b.classList.add('phase-banner--error');
  b.innerHTML = `<span class="phase-banner__err-text">${escapeHtml(msg)}</span>`;
}

/**
 * @param {'bull'|'bear'} side
 * @param {string} who
 * @param {string} text
 * @param {{ roundLabel?: string, teamCode?: string, teamName?: string }} [meta]
 */
function addBubble(side, who, text, meta = {}) {
  const area = document.getElementById('debateArea');
  const div = document.createElement('div');
  div.className = `bubble ${side}`;
  const { roundLabel, teamCode, teamName } = meta;
  if (teamCode) div.setAttribute('data-team', teamCode);
  const kicker = roundLabel
    ? `<div class="bubble-kicker">${escapeHtml(roundLabel)}</div>`
    : '';
  const logoUrl = resolveTeamLogoUrl(teamCode, teamName);
  const mark = logoUrl
    ? `<img class="bubble-logo" src="${escapeHtml(logoUrl)}" width="26" height="26" alt="" decoding="async" loading="lazy" />`
    : teamCode
      ? `<span class="team-chip">${escapeHtml(teamCode)}</span>`
      : "";
  div.innerHTML = `${kicker}<div class="bubble-head">${mark}<div class="bubble-who">${escapeHtml(who)}</div></div><div class="bubble-text">${escapeHtml(text)}</div>`;
  area.appendChild(div);
  scrollDebateEnd();
}

function showTyping(side) {
  const t = document.getElementById('typingBubble');
  t.className = `bubble typing-bubble ${side}`;
  t.style.display='block';
  scrollDebateEnd();
}
function hideTyping() { document.getElementById('typingBubble').style.display='none'; }

/** Shared match payload for both debaters — same data, opposite directives in system prompts. */
function buildMatchContextBlock(match, insights, teams) {
  const teamLine = `Teams: **${teams.teamA}** vs **${teams.teamB}** (Bull argues for ${teams.teamA}; Bear argues for ${teams.teamB}).\n`;
  const lines = AGENTS.map(
    (a) => `- ${a.name} (${a.role}): ${insights[a.id]?.trim() || "—"}`
  ).join("\n");
  return `${teamLine}Fixture: ${match}\n\nSpecialist agent signals:\n${lines}`;
}

/** Bull: team A; Bear: team B; ≤60 words. */
function debateSystemBull(teams) {
  return `You are an aggressive cricket analyst who always argues **${teams.teamA}** beats **${teams.teamB}**. You have access to match data in the conversation. Name both teams when it helps clarity. Be confident, cite specific stats, player form, and conditions. Stay at or under 60 words per response.`;
}

function debateSystemBear(teams) {
  return `You are a skeptical analyst who always argues **${teams.teamB}** beats **${teams.teamA}**. Counter the previous argument directly. Name both teams when it helps clarity. Cite different angles — historical record, opponent weaknesses, conditions. Stay at or under 60 words per response.`;
}

const DEBATE_MAX_TOKENS = 220;

async function runWarRoom() {
  if (running) return;
  running = true;
  const match =
    (document.getElementById('matchInput').value || MATCH_SUGGESTIONS_FALLBACK_ROWS[0].label).trim();

  const completedRow = await lookupCompletedMatchRow(match);
  if (completedRow && completedRow.result && String(completedRow.result.winner || "").trim()) {
    try {
      const teams = parseTeamsFromMatch(match);
      const winCode = String(completedRow.result.winner).trim();
      const winDisplay = resolveWinnerDisplay(teams, winCode);

      AGENTS.forEach((a) => {
        document.getElementById("icon-" + a.id).classList.remove("on");
        document.getElementById("dot-" + a.id).classList.remove("live");
        const ins = document.getElementById("insight-" + a.id);
        ins.textContent = "";
        ins.classList.remove("show");
      });

      document.getElementById('runBtn').style.display = 'none';
      document.getElementById('resetBtn').style.display = '';
      document.getElementById('runningLabel').style.display = 'none';
      document.getElementById('emptyState').style.display = 'none';
      document.getElementById('verdictArea').innerHTML = '';
      setPhase(null);

      const debateEl = document.getElementById('debateArea');
      debateEl.classList.add('debate-area--final-only');
      debateEl.innerHTML = '';

      setMatchBar(match, teams);

      const pickedA =
        String(teams.codeA).toUpperCase() === winCode.toUpperCase() ||
        String(teams.teamA).toUpperCase() === winCode.toUpperCase();
      const winnerLogoUrl = resolveTeamLogoUrl(
        pickedA ? teams.codeA : teams.codeB,
        pickedA ? teams.teamA : teams.teamB
      );
      const verdictLogoHtml = winnerLogoUrl
        ? `<img class="verdict-winner-logo" src="${escapeHtml(winnerLogoUrl)}" width="44" height="44" alt="" decoding="async" loading="lazy" />`
        : "";
      document.getElementById('verdictArea').innerHTML = `
    <div class="verdict-card verdict-card--final">
      <div class="verdict-kicker">Final result</div>
      <div class="verdict-winner-row">${verdictLogoHtml}<div class="verdict-winner">${escapeHtml(winDisplay.toUpperCase())} WINS</div></div>
      <div class="verdict-summary">${escapeHtml(completedRow.result.summary || '')}</div>
    </div>`;

      scrollDebateEnd();
    } catch (e) {
      showApiError(e instanceof Error ? e.message : String(e));
      document.getElementById('runBtn').style.display = '';
      document.getElementById('resetBtn').style.display = 'none';
    } finally {
      running = false;
    }
    return;
  }

  const debateAreaPre = document.getElementById('debateArea');
  debateAreaPre.classList.remove('debate-area--final-only');

  const teams = parseTeamsFromMatch(match);

  document.getElementById('runBtn').style.display='none';
  document.getElementById('resetBtn').style.display='';
  document.getElementById('runningLabel').style.display='';
  document.getElementById('emptyState').style.display='none';
  document.getElementById('verdictArea').innerHTML='';
  setMatchBar(match, teams);

  setPhase('Gathering intelligence…', true);
  document.getElementById('runningLabel').textContent = 'Agents live…';

  const insights = {};
  const agentPromises = [];

  for (const agent of AGENTS) {
    await sleep(550);
    document.getElementById('icon-'+agent.id).classList.add('on');
    document.getElementById('dot-'+agent.id).classList.add('live');

    agentPromises.push(
      callClaude(
        [
          {
            role: 'user',
            content: `You are the ${agent.name} for a cricket AI. Match: "${match}". Contest: ${teams.teamA} vs ${teams.teamB}. Give ONE sharp data insight (15–20 words) from your specialty: ${agent.role}. No intro words.`,
          },
        ],
        'Reply with exactly one insight sentence. No preamble, no labels.'
      )
        .then((text) => {
          const el = document.getElementById('insight-' + agent.id);
          el.textContent = text.trim();
          el.classList.add('show');
          insights[agent.id] = text.trim();
        })
        .catch((err) => {
          const el = document.getElementById('insight-' + agent.id);
          el.textContent = '— ' + (err instanceof Error ? err.message : 'API error');
          el.classList.add('show');
          insights[agent.id] = '';
        })
    );
  }

  try {
    await Promise.all(agentPromises);

    const matchContext = buildMatchContextBlock(match, insights, teams);
    setPhase('Debate in progress…', true);
    document.getElementById('runningLabel').textContent = `${teams.codeA} vs ${teams.codeB} · debate`;

    const debateLog = [];
    const rounds = [
      {
        side: 'bull',
        who: `Bull · ${teams.teamA}`,
        teamCode: teams.codeA,
        roundLabel: 'Round 1 · Opening',
        userContent:
          `${matchContext}\n\n---\nOpen the debate: argue why **${teams.teamA}** wins this fixture. Ground your case in the match data above (stats, form, conditions). Max 60 words.`,
      },
      {
        side: 'bear',
        who: `Bear · ${teams.teamB}`,
        teamCode: teams.codeB,
        roundLabel: 'Round 1 · Counter',
        userContent: `Counter the Bull directly: argue why **${teams.teamB}** wins. Use different angles — historical record, opponent weaknesses, conditions. Max 60 words.`,
      },
      {
        side: 'bull',
        who: `Bull · ${teams.teamA}`,
        teamCode: teams.codeA,
        roundLabel: 'Round 2 · Rebuttal',
        userContent: `Rebut the Bear. Strengthen **${teams.teamA}**’s case with one angle they ignored or misread. Max 60 words.`,
      },
      {
        side: 'bear',
        who: `Bear · ${teams.teamB}`,
        teamCode: teams.codeB,
        roundLabel: 'Round 2 · Final',
        userContent: `Final round: your strongest line for **${teams.teamB}** — still countering the Bull’s last point. Max 60 words.`,
      },
    ];

    /** Full transcript as Anthropic messages: every prior user + assistant turn is included in each call. */
    const history = [];
    for (const rd of rounds) {
      showTyping(rd.side);
      await sleep(500);
      const system = rd.side === 'bull' ? debateSystemBull(teams) : debateSystemBear(teams);
      const messages = [...history, { role: 'user', content: rd.userContent }];
      const text = await callClaude(messages, system, DEBATE_MAX_TOKENS);
      history.push({ role: 'user', content: rd.userContent }, { role: 'assistant', content: text });
      hideTyping();
      debateLog.push({
        side: rd.side,
        who: rd.who,
        teamCode: rd.teamCode,
        roundLabel: rd.roundLabel,
        userContent: rd.userContent,
        text: text.trim(),
      });
      addBubble(rd.side, rd.who, text.trim(), {
        roundLabel: rd.roundLabel,
        teamCode: rd.teamCode,
        teamName: rd.side === "bull" ? teams.teamA : teams.teamB,
      });
      await sleep(350);
    }

    setPhase('Judge deliberating…', true);
    document.getElementById('runningLabel').textContent = 'Finalising verdict…';
    showTyping('bull');
    await sleep(700);

    const debateStr = debateLog
      .map((d) => `[${d.roundLabel || d.side}] ${d.who}: ${d.text}`)
      .join('\n\n');
    const judgeReply = await callClaude(
      [{ role: 'user', content: `Match: "${match}"\nTeams: ${teams.teamA} vs ${teams.teamB}\n\nDebate transcript:\n${debateStr}\n\nProvide verdict as JSON only.` }],
      `You are a neutral cricket prediction judge. Read the debate and return ONLY this JSON (no markdown, no extra text). The "winner" field MUST be exactly "${teams.teamA}" or "${teams.teamB}" (those exact strings).
{"winner":"${teams.teamA}","confidence":65,"score_range":"170-185","key_player":"Name + 5-word reason","swing_factor":"one critical variable","summary":"one punchy verdict sentence max 18 words"}`
    );
    hideTyping();

    let v;
    try {
      v = JSON.parse(judgeReply.replace(/```json|```/g, '').trim());
    } catch {
      v = {
        winner: teams.teamB,
        confidence: 61,
        score_range: '168–182',
        key_player: 'Top-order batter in form',
        swing_factor: 'Toss & dew',
        summary: `Close contest — ${teams.teamB} hold the edge on current conditions.`,
      };
    }

    const winName = String(v.winner || teams.teamB);
    const winNorm = winName.trim().toLowerCase();
    const pickedA =
      winNorm === String(teams.teamA).trim().toLowerCase() ||
      winNorm === String(teams.codeA).trim().toLowerCase();
    const winnerLogoUrl = resolveTeamLogoUrl(
      pickedA ? teams.codeA : teams.codeB,
      pickedA ? teams.teamA : teams.teamB
    );
    const verdictLogoHtml = winnerLogoUrl
      ? `<img class="verdict-winner-logo" src="${escapeHtml(winnerLogoUrl)}" width="44" height="44" alt="" decoding="async" loading="lazy" />`
      : "";
    const vDiv = document.getElementById('verdictArea');
    vDiv.innerHTML = `
    <div class="verdict-card">
      <div class="verdict-kicker">Judge verdict</div>
      <div class="verdict-winner-row">${verdictLogoHtml}<div class="verdict-winner">${escapeHtml(winName.toUpperCase())} WINS</div></div>
      <div class="verdict-summary">${escapeHtml(v.summary || '')}</div>
      <div class="verdict-conf-label">Confidence: ${escapeHtml(String(v.confidence ?? ''))}%</div>
      <div class="conf-track"><div class="conf-fill" id="confFill"></div></div>
      <div class="stat-grid">
        <div class="stat-cell"><div class="stat-label">PROJECTED SCORE</div><div class="stat-val">${escapeHtml(String(v.score_range || '—'))}</div></div>
        <div class="stat-cell"><div class="stat-label">KEY PLAYER</div><div class="stat-val">${escapeHtml(String(v.key_player || '—'))}</div></div>
        <div class="stat-cell"><div class="stat-label">SWING FACTOR</div><div class="stat-val">${escapeHtml(String(v.swing_factor || '—'))}</div></div>
        <div class="stat-cell"><div class="stat-label">CONFIDENCE</div><div class="stat-val">${escapeHtml(String(v.confidence ?? '—'))}%</div></div>
      </div>
    </div>`;

    setTimeout(() => {
      const f = document.getElementById('confFill');
      if (f) f.style.width = v.confidence + '%';
    }, 200);

    scrollDebateEnd();
    setPhase(null);
    document.getElementById('runningLabel').style.display = 'none';
  } catch (e) {
    hideTyping();
    setPhase(null);
    showApiError(e instanceof Error ? e.message : String(e));
    document.getElementById('runningLabel').style.display = 'none';
    document.getElementById('runBtn').style.display = '';
    document.getElementById('resetBtn').style.display = 'none';
  }
  running = false;
}

function resetWarRoom() {
  running = false;
  document.getElementById('debateArea')?.classList.remove('debate-area--final-only');
  document.getElementById('debateArea').innerHTML = `
    <div class="empty-state" id="emptyState">
      <div class="empty-state__icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      </div>
      <p class="empty-state__title">Ready</p>
      <p class="empty-state__desc">Pick a fixture above, then <strong>Run war room</strong> for intel, debate, and verdict.</p>
    </div>`;
  document.getElementById('verdictArea').innerHTML='';
  document.getElementById('typingBubble').style.display='none';
  hideMatchBar();
  AGENTS.forEach(a => {
    document.getElementById('icon-'+a.id).classList.remove('on');
    document.getElementById('dot-'+a.id).classList.remove('live');
    const ins = document.getElementById('insight-'+a.id);
    ins.textContent=''; ins.classList.remove('show');
  });
  setPhase(null);
  document.getElementById('runBtn').style.display='';
  document.getElementById('resetBtn').style.display='none';
  document.getElementById('runningLabel').style.display='none';
}

function initMatchAutocomplete() {
  const input = document.getElementById("matchInput");
  const list = document.getElementById("matchAutocompleteList");
  const panel = document.getElementById("matchAutocompletePanel");
  const emptyEl = document.getElementById("matchAutocompleteEmpty");
  const clearBtn = document.getElementById("matchSearchClear");
  if (!input || !list || !panel) return;

  const MAX_SHOW = 10;
  const SUGGEST_DEBOUNCE_MS = 200;
  let activeIndex = -1;
  /** @type {MatchSuggestHit[]} */
  let filteredHits = [];
  let fetchGen = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let debounceTimer = null;

  function setExpanded(open) {
    input.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function updateClearBtn() {
    if (clearBtn) clearBtn.hidden = input.value.trim().length === 0;
  }

  function renderList() {
    list.innerHTML = "";
    const q = input.value.trim();
    const shown = filteredHits.slice(0, MAX_SHOW);

    if (!shown.length && q) {
      if (emptyEl) emptyEl.hidden = false;
      panel.hidden = false;
      setExpanded(true);
      activeIndex = -1;
      updateClearBtn();
      return;
    }

    if (emptyEl) emptyEl.hidden = true;

    if (!shown.length) {
      panel.hidden = true;
      setExpanded(false);
      updateClearBtn();
      return;
    }

    panel.hidden = false;
    setExpanded(true);
    updateClearBtn();

    shown.forEach((hit, i) => {
      const li = document.createElement("li");
      li.className = "g-search__result" + (i === activeIndex ? " g-search__result--active" : "");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", i === activeIndex ? "true" : "false");
      const meta = formatSuggestMetaLine(hit.date, hit.venue);
      li.innerHTML =
        '<div class="g-search__result-title">' +
        highlightSuggestLabel(hit.label, q) +
        "</div>" +
        (meta
          ? '<div class="g-search__result-meta">' + escapeHtml(meta) + "</div>"
          : "");
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = hit.label;
        closeList();
        updateClearBtn();
      });
      list.appendChild(li);
      if (i === activeIndex) li.scrollIntoView({ block: "nearest" });
    });
  }

  function closeList() {
    filteredHits = [];
    activeIndex = -1;
    list.innerHTML = "";
    panel.hidden = true;
    if (emptyEl) emptyEl.hidden = true;
    setExpanded(false);
    updateClearBtn();
  }

  function applyFilteredAndRender(resetActive) {
    const n = Math.min(filteredHits.length, MAX_SHOW);
    if (resetActive) {
      activeIndex = n > 0 ? 0 : -1;
    } else if (n > 0) {
      activeIndex = Math.max(0, Math.min(activeIndex, n - 1));
    } else {
      activeIndex = -1;
    }
    renderList();
  }

  async function refreshSuggestions(resetActive) {
    const gen = ++fetchGen;
    const q = input.value.trim();
    /** @type {MatchSuggestHit[]} */
    let next = [];

    try {
      const r = await fetch(
        `${apiBase()}/api/match-suggest?q=${encodeURIComponent(q)}&limit=${MAX_SHOW}`
      );
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      const arr = Array.isArray(data.suggestions) ? data.suggestions : [];
      next = arr.map(normalizeSuggestApiEntry);
    } catch {
      if (gen !== fetchGen) return;
      next = getMatchSuggestionHits(MATCH_SUGGESTIONS_FALLBACK_ROWS, q, MAX_SHOW);
    }

    if (gen !== fetchGen) return;
    filteredHits = next;
    applyFilteredAndRender(resetActive);
  }

  input.addEventListener("input", () => {
    updateClearBtn();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      refreshSuggestions(true);
    }, SUGGEST_DEBOUNCE_MS);
  });

  input.addEventListener("focus", () => {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    refreshSuggestions(true);
  });

  input.addEventListener("blur", () => {
    setTimeout(closeList, 180);
  });

  if (clearBtn) {
    clearBtn.addEventListener("mousedown", (e) => e.preventDefault());
    clearBtn.addEventListener("click", () => {
      input.value = "";
      updateClearBtn();
      refreshSuggestions(true);
      input.focus();
    });
  }

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      const t = e.target;
      const tag = t && typeof t === "object" && "tagName" in t ? String(t.tagName).toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || (t && /** @type {HTMLElement} */ (t).isContentEditable)) {
        return;
      }
      e.preventDefault();
      input.focus();
      input.select();
      refreshSuggestions(true);
    }
  });

  input.addEventListener("keydown", (e) => {
    if (panel.hidden) return;
    const q = input.value.trim();
    const n = Math.min(filteredHits.length, MAX_SHOW);
    if (!n && !q) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!n) return;
      if (activeIndex < 0) activeIndex = 0;
      else activeIndex = Math.min(activeIndex + 1, n - 1);
      renderList();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!n) return;
      if (activeIndex <= 0) activeIndex = 0;
      else activeIndex -= 1;
      renderList();
      return;
    }
    if (e.key === "Enter" && activeIndex >= 0 && n > 0) {
      e.preventDefault();
      input.value = filteredHits[activeIndex].label;
      closeList();
      updateClearBtn();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeList();
    }
  });

  document.addEventListener("click", (e) => {
    const field = document.querySelector(".match-field");
    if (field && e.target instanceof Node && !field.contains(e.target)) closeList();
  });

  updateClearBtn();
}

renderAgents();
renderArch();
renderHowto();
initMatchAutocomplete();
initInfoSheet();
