const AGENTS = [
  { id:"scout",   sym:"S", name:"Scout agent",   role:"Player form & fitness" },
  { id:"stats",   sym:"D", name:"Stats agent",   role:"Historical data engine" },
  { id:"weather", sym:"W", name:"Weather agent", role:"Conditions analyzer" },
  { id:"pitch",   sym:"P", name:"Pitch agent",   role:"Surface intelligence" },
  { id:"news",    sym:"N", name:"News agent",    role:"Sentiment & intel" },
  { id:"live",    sym:"⚡", name:"Live Monitor",  role:"Real-time score & prediction updater" },
];

const ARCH = [
  { title:"Data ingestion agents", desc:"Six specialist agents run in parallel — stats, news, weather, pitch, social signals, and the Live Monitor which tracks real-time in-game scores and refreshes predictions as the match progresses. Output: structured JSON context fed to the orchestrator.", tags:["Parallel execution","Web scraping","ESPN / Cricinfo","OpenMeteo","Live score polling"] },
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
    {
      "label": "IPL 2026 Final — TBD",
      "date": "2026-06-01",
      "venue": "TBD",
      "teams": []
    },
    {
      "label": "IPL 2026 Qualifier 2 — TBD",
      "date": "2026-05-30",
      "venue": "TBD",
      "teams": []
    },
    {
      "label": "IPL 2026 Qualifier 1 — TBD",
      "date": "2026-05-28",
      "venue": "TBD",
      "teams": []
    },
    {
      "label": "IPL 2026 Eliminator — TBD",
      "date": "2026-05-27",
      "venue": "TBD",
      "teams": []
    },
    {
      "label": "DC vs KKR — IPL 2026 Match 70, Eden Gardens, Kolkata",
      "date": "2026-05-24",
      "venue": "Eden Gardens, Kolkata",
      "teams": [
        "DC",
        "KKR"
      ]
    },
    {
      "label": "MI vs RR — IPL 2026 Match 69, Wankhede Stadium, Mumbai",
      "date": "2026-05-24",
      "venue": "Wankhede Stadium, Mumbai",
      "teams": [
        "MI",
        "RR"
      ]
    },
    {
      "label": "LSG vs PBKS — IPL 2026 Match 68, BRSABV Ekana Cricket Stadium, Lucknow",
      "date": "2026-05-23",
      "venue": "BRSABV Ekana Cricket Stadium, Lucknow",
      "teams": [
        "LSG",
        "PBKS"
      ]
    },
    {
      "label": "RCB vs SRH — IPL 2026 Match 67, Rajiv Gandhi International Stadium, Hyderabad",
      "date": "2026-05-22",
      "venue": "Rajiv Gandhi International Stadium, Hyderabad",
      "teams": [
        "RCB",
        "SRH"
      ]
    },
    {
      "label": "CSK vs GT — IPL 2026 Match 66, Narendra Modi Stadium, Ahmedabad",
      "date": "2026-05-21",
      "venue": "Narendra Modi Stadium, Ahmedabad",
      "teams": [
        "CSK",
        "GT"
      ]
    },
    {
      "label": "KKR vs MI — IPL 2026 Match 65, Eden Gardens, Kolkata",
      "date": "2026-05-20",
      "venue": "Eden Gardens, Kolkata",
      "teams": [
        "KKR",
        "MI"
      ]
    },
    {
      "label": "LSG vs RR — IPL 2026 Match 64, Sawai Mansingh Stadium, Jaipur",
      "date": "2026-05-19",
      "venue": "Sawai Mansingh Stadium, Jaipur",
      "teams": [
        "LSG",
        "RR"
      ]
    },
    {
      "label": "CSK vs SRH — IPL 2026 Match 63, M. A. Chidambaram Stadium, Chennai",
      "date": "2026-05-18",
      "venue": "M. A. Chidambaram Stadium, Chennai",
      "teams": [
        "CSK",
        "SRH"
      ]
    },
    {
      "label": "DC vs RR — IPL 2026 Match 62, Arun Jaitley Stadium, Delhi",
      "date": "2026-05-17",
      "venue": "Arun Jaitley Stadium, Delhi",
      "teams": [
        "DC",
        "RR"
      ]
    },
    {
      "label": "PBKS vs RCB — IPL 2026 Match 61, IS Bindra Stadium, Mohali",
      "date": "2026-05-17",
      "venue": "IS Bindra Stadium, Mohali",
      "teams": [
        "PBKS",
        "RCB"
      ]
    },
    {
      "label": "GT vs KKR — IPL 2026 Match 60, Eden Gardens, Kolkata",
      "date": "2026-05-16",
      "venue": "Eden Gardens, Kolkata",
      "teams": [
        "GT",
        "KKR"
      ]
    },
    {
      "label": "CSK vs LSG — IPL 2026 Match 59, BRSABV Ekana Cricket Stadium, Lucknow",
      "date": "2026-05-15",
      "venue": "BRSABV Ekana Cricket Stadium, Lucknow",
      "teams": [
        "CSK",
        "LSG"
      ]
    },
    {
      "label": "MI vs PBKS — IPL 2026 Match 58, IS Bindra Stadium, Mohali",
      "date": "2026-05-14",
      "venue": "IS Bindra Stadium, Mohali",
      "teams": [
        "MI",
        "PBKS"
      ]
    },
    {
      "label": "KKR vs RCB — IPL 2026 Match 57, M. Chinnaswamy Stadium, Bengaluru",
      "date": "2026-05-13",
      "venue": "M. Chinnaswamy Stadium, Bengaluru",
      "teams": [
        "KKR",
        "RCB"
      ]
    },
    {
      "label": "GT vs SRH — IPL 2026 Match 56, Narendra Modi Stadium, Ahmedabad",
      "date": "2026-05-12",
      "venue": "Narendra Modi Stadium, Ahmedabad",
      "teams": [
        "GT",
        "SRH"
      ]
    },
    {
      "label": "DC vs PBKS — IPL 2026 Match 55, IS Bindra Stadium, Mohali",
      "date": "2026-05-11",
      "venue": "IS Bindra Stadium, Mohali",
      "teams": [
        "DC",
        "PBKS"
      ]
    },
    {
      "label": "MI vs RCB — IPL 2026 Match 54, M. Chinnaswamy Stadium, Bengaluru",
      "date": "2026-05-10",
      "venue": "M. Chinnaswamy Stadium, Bengaluru",
      "teams": [
        "MI",
        "RCB"
      ]
    },
    {
      "label": "CSK vs LSG — IPL 2026 Match 53, M. A. Chidambaram Stadium, Chennai",
      "date": "2026-05-10",
      "venue": "M. A. Chidambaram Stadium, Chennai",
      "teams": [
        "CSK",
        "LSG"
      ]
    },
    {
      "label": "GT vs RR — IPL 2026 Match 52, Sawai Mansingh Stadium, Jaipur",
      "date": "2026-05-09",
      "venue": "Sawai Mansingh Stadium, Jaipur",
      "teams": [
        "GT",
        "RR"
      ]
    },
    {
      "label": "DC vs KKR — IPL 2026 Match 51, Arun Jaitley Stadium, Delhi",
      "date": "2026-05-08",
      "venue": "Arun Jaitley Stadium, Delhi",
      "teams": [
        "DC",
        "KKR"
      ]
    },
    {
      "label": "LSG vs RCB — IPL 2026 Match 50, BRSABV Ekana Cricket Stadium, Lucknow",
      "date": "2026-05-07",
      "venue": "BRSABV Ekana Cricket Stadium, Lucknow",
      "teams": [
        "LSG",
        "RCB"
      ]
    },
    {
      "label": "PBKS vs SRH — IPL 2026 Match 49, Rajiv Gandhi International Stadium, Hyderabad",
      "date": "2026-05-06",
      "venue": "Rajiv Gandhi International Stadium, Hyderabad",
      "teams": [
        "PBKS",
        "SRH"
      ]
    },
    {
      "label": "CSK vs DC — IPL 2026 Match 48, Arun Jaitley Stadium, Delhi",
      "date": "2026-05-05",
      "venue": "Arun Jaitley Stadium, Delhi",
      "teams": [
        "CSK",
        "DC"
      ]
    },
    {
      "label": "LSG vs MI — IPL 2026 Match 47, Wankhede Stadium, Mumbai",
      "date": "2026-05-04",
      "venue": "Wankhede Stadium, Mumbai",
      "teams": [
        "LSG",
        "MI"
      ]
    },
    {
      "label": "GT vs PBKS — IPL 2026 Match 46, Narendra Modi Stadium, Ahmedabad",
      "date": "2026-05-03",
      "venue": "Narendra Modi Stadium, Ahmedabad",
      "teams": [
        "GT",
        "PBKS"
      ]
    },
    {
      "label": "KKR vs SRH — IPL 2026 Match 45, Rajiv Gandhi International Stadium, Hyderabad",
      "date": "2026-05-03",
      "venue": "Rajiv Gandhi International Stadium, Hyderabad",
      "teams": [
        "KKR",
        "SRH"
      ]
    },
    {
      "label": "CSK vs MI — IPL 2026 Match 44, M. A. Chidambaram Stadium, Chennai",
      "date": "2026-05-02",
      "venue": "M. A. Chidambaram Stadium, Chennai",
      "teams": [
        "CSK",
        "MI"
      ]
    },
    {
      "label": "DC vs RR — IPL 2026 Match 43, Sawai Mansingh Stadium, Jaipur",
      "date": "2026-05-01",
      "venue": "Sawai Mansingh Stadium, Jaipur",
      "teams": [
        "DC",
        "RR"
      ]
    },
    {
      "label": "GT vs RCB — IPL 2026 Match 42, Narendra Modi Stadium, Ahmedabad",
      "date": "2026-04-30",
      "venue": "Narendra Modi Stadium, Ahmedabad",
      "teams": [
        "GT",
        "RCB"
      ]
    },
    {
      "label": "MI vs SRH — IPL 2026 Match 41, Wankhede Stadium, Mumbai",
      "date": "2026-04-29",
      "venue": "Wankhede Stadium, Mumbai",
      "teams": [
        "MI",
        "SRH"
      ]
    },
    {
      "label": "PBKS vs RR — IPL 2026 Match 40, IS Bindra Stadium, Mohali",
      "date": "2026-04-28",
      "venue": "IS Bindra Stadium, Mohali",
      "teams": [
        "PBKS",
        "RR"
      ]
    },
    {
      "label": "DC vs RCB — IPL 2026 Match 39, Arun Jaitley Stadium, Delhi",
      "date": "2026-04-27",
      "venue": "Arun Jaitley Stadium, Delhi",
      "teams": [
        "DC",
        "RCB"
      ]
    },
    {
      "label": "KKR vs LSG — IPL 2026 Match 38, BRSABV Ekana Cricket Stadium, Lucknow",
      "date": "2026-04-26",
      "venue": "BRSABV Ekana Cricket Stadium, Lucknow",
      "teams": [
        "KKR",
        "LSG"
      ]
    },
    {
      "label": "CSK vs GT — IPL 2026 Match 37, M. A. Chidambaram Stadium, Chennai",
      "date": "2026-04-26",
      "venue": "M. A. Chidambaram Stadium, Chennai",
      "teams": [
        "CSK",
        "GT"
      ],
      "completed": true,
      "result": {
        "winner": "GT",
        "summary": "Gujarat Titans won by 8 wickets (CSK 158/7 in 20 ov, GT 162/2 in 16.4 ov)"
      }
    },
    {
      "label": "RR vs SRH — IPL 2026 Match 36, Sawai Mansingh Stadium, Jaipur",
      "date": "2026-04-25",
      "venue": "Sawai Mansingh Stadium, Jaipur",
      "teams": [
        "RR",
        "SRH"
      ],
      "completed": true,
      "result": {
        "winner": "SRH",
        "summary": "Sunrisers Hyderabad won by 5 wickets (RR 228/6 in 20 ov, SRH 229/5 in 18.3 ov)"
      }
    },
    {
      "label": "DC vs PBKS — IPL 2026 Match 35, Arun Jaitley Stadium, Delhi",
      "date": "2026-04-25",
      "venue": "Arun Jaitley Stadium, Delhi",
      "teams": [
        "DC",
        "PBKS"
      ]
    },
    {
      "label": "GT vs RCB — IPL 2026 Match 34, M. Chinnaswamy Stadium, Bengaluru",
      "date": "2026-04-24",
      "venue": "M. Chinnaswamy Stadium, Bengaluru",
      "teams": [
        "GT",
        "RCB"
      ]
    },
    {
      "label": "CSK vs MI — IPL 2026 Match 33, Wankhede Stadium, Mumbai",
      "date": "2026-04-23",
      "venue": "Wankhede Stadium, Mumbai",
      "teams": [
        "CSK",
        "MI"
      ]
    },
    {
      "label": "LSG vs RR — IPL 2026 Match 32, Sawai Mansingh Stadium, Jaipur",
      "date": "2026-04-22",
      "venue": "Sawai Mansingh Stadium, Jaipur",
      "teams": [
        "LSG",
        "RR"
      ],
      "completed": true,
      "result": {
        "winner": "RR",
        "summary": "Rajasthan Royals won by 40 runs (RR 159/6, LSG 119 in 18 ov)"
      }
    },
    {
      "label": "DC vs SRH — IPL 2026 Match 31, Rajiv Gandhi International Stadium, Hyderabad",
      "date": "2026-04-21",
      "venue": "Rajiv Gandhi International Stadium, Hyderabad",
      "teams": [
        "DC",
        "SRH"
      ],
      "completed": true,
      "result": {
        "winner": "SRH",
        "summary": "Sunrisers Hyderabad won by 47 runs (SRH 242/2, DC 195/9 in 20 ov)"
      }
    },
    {
      "label": "GT vs MI — IPL 2026 Match 30, Narendra Modi Stadium, Ahmedabad",
      "date": "2026-04-20",
      "venue": "Narendra Modi Stadium, Ahmedabad",
      "teams": [
        "GT",
        "MI"
      ],
      "completed": true,
      "result": {
        "winner": "MI",
        "summary": "Mumbai Indians won by 99 runs (MI 199/5, GT 100 in 15.5 ov)"
      }
    },
    {
      "label": "LSG vs PBKS — IPL 2026 Match 29, IS Bindra Stadium, Mohali",
      "date": "2026-04-19",
      "venue": "IS Bindra Stadium, Mohali",
      "teams": [
        "LSG",
        "PBKS"
      ],
      "completed": true,
      "result": {
        "winner": "PBKS",
        "summary": "Punjab Kings won by 54 runs (PBKS 254/7, LSG 200/5 in 20 ov)"
      }
    },
    {
      "label": "KKR vs RR — IPL 2026 Match 28, Sawai Mansingh Stadium, Jaipur",
      "date": "2026-04-19",
      "venue": "Sawai Mansingh Stadium, Jaipur",
      "teams": [
        "KKR",
        "RR"
      ],
      "completed": true,
      "result": {
        "winner": "KKR",
        "summary": "Kolkata Knight Riders won by 4 wickets (RR 155/9, KKR 161/6 in 19.4 ov)"
      }
    },
    {
      "label": "CSK vs SRH — IPL 2026 Match 27, Rajiv Gandhi International Stadium, Hyderabad",
      "date": "2026-04-18",
      "venue": "Rajiv Gandhi International Stadium, Hyderabad",
      "teams": [
        "CSK",
        "SRH"
      ],
      "completed": true,
      "result": {
        "winner": "SRH",
        "summary": "Sunrisers Hyderabad won by 10 runs (SRH 194/9, CSK 184/8 in 20 ov)"
      }
    },
    {
      "label": "DC vs RCB — IPL 2026 Match 26, M. Chinnaswamy Stadium, Bengaluru",
      "date": "2026-04-18",
      "venue": "M. Chinnaswamy Stadium, Bengaluru",
      "teams": [
        "DC",
        "RCB"
      ],
      "completed": true,
      "result": {
        "winner": "DC",
        "summary": "Delhi Capitals won by 6 wickets (RCB 175/8, DC 179/4 in 19.5 ov)"
      }
    },
    {
      "label": "GT vs KKR — IPL 2026 Match 25, Narendra Modi Stadium, Ahmedabad",
      "date": "2026-04-17",
      "venue": "Narendra Modi Stadium, Ahmedabad",
      "teams": [
        "GT",
        "KKR"
      ],
      "completed": true,
      "result": {
        "winner": "GT",
        "summary": "Gujarat Titans won by 5 wickets (KKR 180, GT 181/5 in 19.4 ov)"
      }
    },
    {
      "label": "MI vs PBKS — IPL 2026 Match 24, Wankhede Stadium, Mumbai",
      "date": "2026-04-16",
      "venue": "Wankhede Stadium, Mumbai",
      "teams": [
        "MI",
        "PBKS"
      ],
      "completed": true,
      "result": {
        "winner": "PBKS",
        "summary": "Punjab Kings won by 7 wickets (MI 195/6, PBKS 198/3 in 16.3 ov)"
      }
    },
    {
      "label": "LSG vs RCB — IPL 2026 Match 23, M. Chinnaswamy Stadium, Bengaluru",
      "date": "2026-04-15",
      "venue": "M. Chinnaswamy Stadium, Bengaluru",
      "teams": [
        "LSG",
        "RCB"
      ],
      "completed": true,
      "result": {
        "winner": "RCB",
        "summary": "Royal Challengers Bengaluru won by 5 wickets (LSG 146, RCB 149/5 in 15.1 ov)"
      }
    },
    {
      "label": "CSK vs KKR — IPL 2026 Match 22, M. A. Chidambaram Stadium, Chennai",
      "date": "2026-04-14",
      "venue": "M. A. Chidambaram Stadium, Chennai",
      "teams": [
        "CSK",
        "KKR"
      ],
      "completed": true,
      "result": {
        "winner": "CSK",
        "summary": "Chennai Super Kings won by 32 runs (CSK 192/5, KKR 160/7 in 20 ov)"
      }
    },
    {
      "label": "RR vs SRH — IPL 2026 Match 21, Rajiv Gandhi International Stadium, Hyderabad",
      "date": "2026-04-13",
      "venue": "Rajiv Gandhi International Stadium, Hyderabad",
      "teams": [
        "RR",
        "SRH"
      ],
      "completed": true,
      "result": {
        "winner": "SRH",
        "summary": "Sunrisers Hyderabad won by 57 runs (SRH 216/6, RR 159 in 19 ov)"
      }
    },
    {
      "label": "MI vs RCB — IPL 2026 Match 20, M. Chinnaswamy Stadium, Bengaluru",
      "date": "2026-04-12",
      "venue": "M. Chinnaswamy Stadium, Bengaluru",
      "teams": [
        "MI",
        "RCB"
      ],
      "completed": true,
      "result": {
        "winner": "RCB",
        "summary": "Royal Challengers Bengaluru won by 18 runs (RCB 240/4, MI 222/5 in 20 ov)"
      }
    },
    {
      "label": "GT vs LSG — IPL 2026 Match 19, BRSABV Ekana Cricket Stadium, Lucknow",
      "date": "2026-04-12",
      "venue": "BRSABV Ekana Cricket Stadium, Lucknow",
      "teams": [
        "GT",
        "LSG"
      ],
      "completed": true,
      "result": {
        "winner": "GT",
        "summary": "Gujarat Titans won by 7 wickets (LSG 164/8, GT 165/3 in 18.4 ov)"
      }
    },
    {
      "label": "CSK vs DC — IPL 2026 Match 18, M. A. Chidambaram Stadium, Chennai",
      "date": "2026-04-11",
      "venue": "M. A. Chidambaram Stadium, Chennai",
      "teams": [
        "CSK",
        "DC"
      ],
      "completed": true,
      "result": {
        "winner": "CSK",
        "summary": "Chennai Super Kings won by 23 runs (CSK 212/2, DC 189 in 20 ov)"
      }
    },
    {
      "label": "PBKS vs SRH — IPL 2026 Match 17, Rajiv Gandhi International Stadium, Hyderabad",
      "date": "2026-04-11",
      "venue": "Rajiv Gandhi International Stadium, Hyderabad",
      "teams": [
        "PBKS",
        "SRH"
      ],
      "completed": true,
      "result": {
        "winner": "PBKS",
        "summary": "Punjab Kings won by 6 wickets (SRH 219/6, PBKS 223/4 in 18.5 ov)"
      }
    },
    {
      "label": "RCB vs RR — IPL 2026 Match 16, Barsapara Cricket Stadium, Guwahati",
      "date": "2026-04-10",
      "venue": "Barsapara Cricket Stadium, Guwahati",
      "teams": [
        "RCB",
        "RR"
      ],
      "completed": true,
      "result": {
        "winner": "RR",
        "summary": "Rajasthan Royals won by 6 wickets (RCB 201/8, RR 202/4 in 18 ov)"
      }
    },
    {
      "label": "KKR vs LSG — IPL 2026 Match 15, Eden Gardens, Kolkata",
      "date": "2026-04-09",
      "venue": "Eden Gardens, Kolkata",
      "teams": [
        "KKR",
        "LSG"
      ],
      "completed": true,
      "result": {
        "winner": "LSG",
        "summary": "Lucknow Super Giants won by 3 wickets (KKR 181/4, LSG 182/7 in 20 ov)"
      }
    },
    {
      "label": "DC vs GT — IPL 2026 Match 14, Narendra Modi Stadium, Ahmedabad",
      "date": "2026-04-08",
      "venue": "Narendra Modi Stadium, Ahmedabad",
      "teams": [
        "DC",
        "GT"
      ],
      "completed": true,
      "result": {
        "winner": "GT",
        "summary": "Gujarat Titans won by 1 run (GT 210/4, DC 209/8 in 20 ov)"
      }
    },
    {
      "label": "MI vs RR — IPL 2026 Match 13, Sawai Mansingh Stadium, Jaipur",
      "date": "2026-04-07",
      "venue": "Sawai Mansingh Stadium, Jaipur",
      "teams": [
        "MI",
        "RR"
      ],
      "completed": true,
      "result": {
        "winner": "RR",
        "summary": "Rajasthan Royals won by 27 runs D/L (RR 150/3 in 11 ov, MI 123/9 in 11 ov)"
      }
    },
    {
      "label": "KKR vs PBKS — IPL 2026 Match 12, Eden Gardens, Kolkata",
      "date": "2026-04-06",
      "venue": "Eden Gardens, Kolkata",
      "teams": [
        "KKR",
        "PBKS"
      ],
      "completed": true,
      "result": {
        "winner": null,
        "summary": "No result — match abandoned (KKR 25/2 in 3.4 ov)"
      }
    },
    {
      "label": "CSK vs RCB — IPL 2026 Match 11, M. Chinnaswamy Stadium, Bengaluru",
      "date": "2026-04-05",
      "venue": "M. Chinnaswamy Stadium, Bengaluru",
      "teams": [
        "CSK",
        "RCB"
      ],
      "completed": true,
      "result": {
        "winner": "RCB",
        "summary": "Royal Challengers Bengaluru won by 43 runs (RCB 250/3, CSK 207 in 19.4 ov)"
      }
    },
    {
      "label": "LSG vs SRH — IPL 2026 Match 10, Rajiv Gandhi International Stadium, Hyderabad",
      "date": "2026-04-05",
      "venue": "Rajiv Gandhi International Stadium, Hyderabad",
      "teams": [
        "LSG",
        "SRH"
      ],
      "completed": true,
      "result": {
        "winner": "LSG",
        "summary": "Lucknow Super Giants won by 5 wickets (SRH 156/9, LSG 160/5 in 19.5 ov)"
      }
    },
    {
      "label": "GT vs RR — IPL 2026 Match 9, Sawai Mansingh Stadium, Jaipur",
      "date": "2026-04-04",
      "venue": "Sawai Mansingh Stadium, Jaipur",
      "teams": [
        "GT",
        "RR"
      ],
      "completed": true,
      "result": {
        "winner": "RR",
        "summary": "Rajasthan Royals won by 6 runs (RR 210/6, GT 204/8 in 20 ov)"
      }
    },
    {
      "label": "DC vs MI — IPL 2026 Match 8, Wankhede Stadium, Mumbai",
      "date": "2026-04-04",
      "venue": "Wankhede Stadium, Mumbai",
      "teams": [
        "DC",
        "MI"
      ],
      "completed": true,
      "result": {
        "winner": "DC",
        "summary": "Delhi Capitals won by 6 wickets (MI 162/6, DC 164/4 in 18.1 ov)"
      }
    },
    {
      "label": "CSK vs PBKS — IPL 2026 Match 7, M. A. Chidambaram Stadium, Chennai",
      "date": "2026-04-03",
      "venue": "M. A. Chidambaram Stadium, Chennai",
      "teams": [
        "CSK",
        "PBKS"
      ],
      "completed": true,
      "result": {
        "winner": "PBKS",
        "summary": "Punjab Kings won by 5 wickets (CSK 209/5, PBKS 210/5 in 18.4 ov)"
      }
    },
    {
      "label": "KKR vs SRH — IPL 2026 Match 6, Rajiv Gandhi International Stadium, Hyderabad",
      "date": "2026-04-02",
      "venue": "Rajiv Gandhi International Stadium, Hyderabad",
      "teams": [
        "KKR",
        "SRH"
      ],
      "completed": true,
      "result": {
        "winner": "SRH",
        "summary": "Sunrisers Hyderabad won by 65 runs (SRH 226/8, KKR 161 in 16 ov)"
      }
    },
    {
      "label": "DC vs LSG — IPL 2026 Match 5, BRSABV Ekana Cricket Stadium, Lucknow",
      "date": "2026-04-01",
      "venue": "BRSABV Ekana Cricket Stadium, Lucknow",
      "teams": [
        "DC",
        "LSG"
      ],
      "completed": true,
      "result": {
        "winner": "DC",
        "summary": "Delhi Capitals won by 6 wickets (LSG 141, DC 145/4 in 17.1 ov)"
      }
    },
    {
      "label": "GT vs PBKS — IPL 2026 Match 4, Narendra Modi Stadium, Ahmedabad",
      "date": "2026-03-31",
      "venue": "Narendra Modi Stadium, Ahmedabad",
      "teams": [
        "GT",
        "PBKS"
      ],
      "completed": true,
      "result": {
        "winner": "PBKS",
        "summary": "Punjab Kings won by 3 wickets (GT 162/6, PBKS 165/7 in 19.1 ov)"
      }
    },
    {
      "label": "CSK vs RR — IPL 2026 Match 3, M. A. Chidambaram Stadium, Chennai",
      "date": "2026-03-30",
      "venue": "M. A. Chidambaram Stadium, Chennai",
      "teams": [
        "CSK",
        "RR"
      ],
      "completed": true,
      "result": {
        "winner": "RR",
        "summary": "Rajasthan Royals won by 8 wickets (CSK 127, RR 128/2 in 12.1 ov)"
      }
    },
    {
      "label": "KKR vs MI — IPL 2026 Match 2, Eden Gardens, Kolkata",
      "date": "2026-03-29",
      "venue": "Eden Gardens, Kolkata",
      "teams": [
        "KKR",
        "MI"
      ],
      "completed": true,
      "result": {
        "winner": "MI",
        "summary": "Mumbai Indians won by 6 wickets (KKR 220/4, MI 224/4 in 19.1 ov)"
      }
    },
    {
      "label": "RCB vs SRH — IPL 2026 Match 1, M. Chinnaswamy Stadium, Bengaluru",
      "date": "2026-03-28",
      "venue": "M. Chinnaswamy Stadium, Bengaluru",
      "teams": [
        "RCB",
        "SRH"
      ],
      "completed": true,
      "result": {
        "winner": "RCB",
        "summary": "Royal Challengers Bengaluru won by 6 wickets (SRH 201/9, RCB 203/4 in 15.4 ov)"
      }
    },
    {
      "label": "IND vs AUS — 3rd T20I, Wankhede Stadium, Mumbai",
      "date": "2026-06-08",
      "venue": "Wankhede Stadium, Mumbai",
      "teams": [
        "IND",
        "AUS"
      ]
    },
    {
      "label": "IND vs SA — 1st T20I, Wanderers Stadium, Johannesburg",
      "date": "2026-06-12",
      "venue": "Wanderers Stadium, Johannesburg",
      "teams": [
        "IND",
        "SA"
      ]
    },
    {
      "label": "PAK vs IND — ODI, Dubai International Cricket Stadium",
      "date": "2026-06-15",
      "venue": "Dubai International Cricket Stadium",
      "teams": [
        "PAK",
        "IND"
      ]
    },
    {
      "label": "WI vs SA — 1st T20I, Kensington Oval, Bridgetown",
      "date": "2026-06-18",
      "venue": "Kensington Oval, Bridgetown",
      "teams": [
        "WI",
        "SA"
      ]
    },
    {
      "label": "IND vs ENG — 1st ODI, Vidarbha Cricket Association Stadium, Nagpur",
      "date": "2026-06-22",
      "venue": "Vidarbha Cricket Association Stadium, Nagpur",
      "teams": [
        "IND",
        "ENG"
      ]
    },
    {
      "label": "BAN vs SL — 2nd ODI, Shere Bangla Stadium, Mirpur",
      "date": "2026-06-25",
      "venue": "Shere Bangla Stadium, Mirpur",
      "teams": [
        "BAN",
        "SL"
      ]
    },
    {
      "label": "ENG vs WI — 3rd ODI, County Ground, Taunton",
      "date": "2026-06-28",
      "venue": "County Ground, Taunton",
      "teams": [
        "ENG",
        "WI"
      ]
    },
    {
      "label": "IND vs NZ — 2nd Test, M. Chinnaswamy Stadium, Bengaluru",
      "date": "2026-07-02",
      "venue": "M. Chinnaswamy Stadium, Bengaluru",
      "teams": [
        "IND",
        "NZ"
      ]
    },
    {
      "label": "AUS vs ENG — 5th Ashes Test, Kia Oval, London",
      "date": "2026-07-10",
      "venue": "Kia Oval, London",
      "teams": [
        "AUS",
        "ENG"
      ]
    },
    {
      "label": "NZ vs SA — Test, Basin Reserve, Wellington",
      "date": "2026-07-14",
      "venue": "Basin Reserve, Wellington",
      "teams": [
        "NZ",
        "SA"
      ]
    },
    {
      "label": "AFG vs IRE — T20 World Cup group, Providence Stadium, Guyana",
      "date": "2026-07-18",
      "venue": "Providence Stadium, Guyana",
      "teams": [
        "AFG",
        "IRE"
      ]
    },
    {
      "label": "AUS vs IND — Boxing Day Test, Melbourne Cricket Ground",
      "date": "2026-07-26",
      "venue": "Melbourne Cricket Ground",
      "teams": [
        "AUS",
        "IND"
      ]
    }
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

function iplMatchNumberFromLabel(label) {
  const m = String(label).match(/\bMatch\s+(\d+)\b/i);
  return m ? Number(m[1]) : 0;
}

/** Newest fixture date first; same date: lower Match N first (double-headers). */
function compareMatchSuggestionsNewestFirst(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const na = iplMatchNumberFromLabel(a.label);
  const nb = iplMatchNumberFromLabel(b.label);
  if (na !== nb) return na - nb;
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
  document.getElementById('agentsList').innerHTML = AGENTS.map((a) => {
    const refreshBtn =
      a.id === "live"
        ? ""
        : `<button type="button" class="agent-intel-refresh" id="intel-refresh-${a.id}" data-intel-refresh="${a.id}" hidden aria-label="Refresh ${escapeHtml(a.name)}"><svg class="agent-intel-refresh__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 .49-3.56"></path></svg></button>`;
    return `
    <div class="agent-row agent-row--compact agent-row--skeleton" id="row-${a.id}">
      <div class="agent-icon" id="icon-${a.id}">${a.sym}</div>
      <div class="agent-meta">
        <div class="agent-name">${a.name}</div>
        <div class="agent-role">${a.role}</div>
        <div class="agent-insight" id="insight-${a.id}"></div>
      </div>
      ${refreshBtn}
      <div class="status-dot" id="dot-${a.id}"></div>
    </div>`;
  }).join("");
}

function initIntelAgentRefreshHandlers() {
  const root = document.getElementById("agentsList");
  if (!root || root.dataset.intelRefreshBound === "1") return;
  root.dataset.intelRefreshBound = "1";
  root.addEventListener("click", (e) => {
    const t = /** @type {HTMLElement|null} */ (e.target);
    const btn = t && "closest" in t ? /** @type {HTMLButtonElement|null} */ (t.closest("[data-intel-refresh]")) : null;
    if (!btn || !(btn instanceof HTMLButtonElement) || btn.disabled) return;
    const agentId = btn.getAttribute("data-intel-refresh");
    if (!agentId) return;
    e.preventDefault();
    void runSingleIntelAgentRefresh(agentId);
  });
}

function removeAgentSkeleton(agentId) {
  const row = document.getElementById('row-' + agentId);
  if (row) row.classList.remove('agent-row--skeleton');
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

/** Scroll the debate column into view (e.g. when debate phase starts). */
function scrollDebatePanelIntoView(options = {}) {
  const behavior = options.behavior ?? "smooth";
  const block = options.block ?? "nearest";
  const panel = document.getElementById("debatePanel") || document.querySelector(".dash-col--debate");
  if (!panel) return;
  requestAnimationFrame(() => {
    panel.scrollIntoView({ block, behavior, inline: "nearest" });
    if (typeof panel.focus === "function") {
      try {
        panel.focus({ preventScroll: true });
      } catch {
        panel.focus();
      }
    }
  });
}

/** Scroll the verdict / stage column into view (completed match or final verdict). */
function scrollVerdictPanelIntoView(options = {}) {
  const behavior = options.behavior ?? "smooth";
  const panel = document.querySelector(".dash-col--stage");
  if (!panel) return;
  requestAnimationFrame(() => {
    panel.scrollIntoView({ block: "nearest", behavior, inline: "nearest" });
  });
}

/** Keep the typing indicator / latest bubbles visible inside the debate scroller. */
function scrollDebateEnd() {
  requestAnimationFrame(() => {
    const scroller = document.getElementById("debateScroller");
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
    const panel = document.querySelector(".dash-col--debate");
    if (panel) {
      panel.scrollIntoView({ block: "nearest", behavior: "auto", inline: "nearest" });
    }
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

function initNoticeStrip() {
  const btn = document.getElementById("acwrNoticeClose");
  if (!btn) return;
  if (btn.dataset.noticeInit === "1") return;
  btn.dataset.noticeInit = "1";
  btn.addEventListener("click", () => {
    try {
      localStorage.setItem("acwr-notice-dismissed", "1");
    } catch {
      /* private mode */
    }
    document.documentElement.classList.add("acwr-notice-dismissed");
  });
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
  // On file:// there is no server to proxy to; return null to signal offline.
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return null;
  }
  // Served via http/https — use relative URLs (same origin).
  return '';
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/**
 * Split bar: team A left / coral, team B right / blue. Percentages always sum to 100.
 * @param {{ teamA: string, teamB: string }} teams
 * @param {number} pctForTeamA
 * @param {{ variant?: 'judge' | 'final' }} [opts] — judge: model-confidence semantics; final: recorded result bar
 * @returns {{ html: string, pctA: number, pctB: number }}
 */
function renderVerdictWinProbabilityBlock(teams, pctForTeamA, opts = {}) {
  const variant = opts.variant === "final" ? "final" : "judge";
  const pctA = Math.min(100, Math.max(0, Math.round(Number(pctForTeamA) || 0)));
  const pctB = 100 - pctA;
  let title;
  let captionHtml;
  let ariaLabel;
  if (variant === "final") {
    title = "Match result";
    captionHtml = "";
    ariaLabel = `Match result: ${escapeHtml(teams.teamA)} ${pctA} percent, ${escapeHtml(teams.teamB)} ${pctB} percent`;
  } else {
    title = "Model confidence split";
    captionHtml = `<p class="verdict-win-prob__caption">Reflects how strongly the Judge backs its pick. Not a calibrated win probability or betting line.</p>`;
    ariaLabel = `Model confidence split (not win probability): ${escapeHtml(teams.teamA)} ${pctA} percent, ${escapeHtml(teams.teamB)} ${pctB} percent`;
  }
  const html = `
      <div class="verdict-win-prob" aria-label="${ariaLabel}">
        <div class="verdict-win-prob__divider" aria-hidden="true"></div>
        <div class="verdict-win-prob__title">${title}</div>
        <div class="verdict-win-prob__teams">
          <div class="verdict-win-prob__side verdict-win-prob__side--left">
            <div class="verdict-win-prob__name">${escapeHtml(teams.teamA)}</div>
            <div class="verdict-win-prob__pct verdict-win-prob__pct--a">${pctA}%</div>
          </div>
          <div class="verdict-win-prob__side verdict-win-prob__side--right">
            <div class="verdict-win-prob__name">${escapeHtml(teams.teamB)}</div>
            <div class="verdict-win-prob__pct verdict-win-prob__pct--b">${pctB}%</div>
          </div>
        </div>
        <div class="verdict-win-prob__bar">
          <div class="verdict-win-prob__seg verdict-win-prob__seg--a" style="width:0%"></div>
          <div class="verdict-win-prob__seg verdict-win-prob__seg--b" style="width:0%"></div>
        </div>
        ${captionHtml}
      </div>`;
  return { html, pctA, pctB };
}

function scheduleVerdictWinProbabilityAnimation(verdictRoot, pctA, pctB) {
  setTimeout(() => {
    const bar = verdictRoot?.querySelector?.('.verdict-win-prob__bar');
    if (!bar) return;
    const segA = bar.querySelector('.verdict-win-prob__seg--a');
    const segB = bar.querySelector('.verdict-win-prob__seg--b');
    if (segA) segA.style.width = `${pctA}%`;
    if (segB) segB.style.width = `${pctB}%`;
  }, 200);
}

/**
 * Aligns with `judge_service.models.Verdict`: winner, confidence (int 0–100), score_range, key_player, swing_factor, summary.
 * @typedef {{ winner: string, confidence: number, score_range: string, key_player: string, swing_factor: string, summary: string }} WarRoomVerdict
 */

/** @param {string} text */
function extractJudgeJsonObject(text) {
  let s = String(text || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) return s.slice(start, end + 1);
  return s;
}

/**
 * @param {unknown} raw
 * @param {{ teamA: string, teamB: string, codeA: string, codeB: string }} teams
 * @returns {WarRoomVerdict}
 */
function normalizeVerdictPartial(raw, teams) {
  const fallbackWinner = teams.teamB;
  const w = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const confRaw = Number(w.confidence);
  const confidence = Number.isFinite(confRaw) ? Math.min(100, Math.max(0, Math.round(confRaw))) : 55;
  return {
    winner: String(w.winner ?? fallbackWinner).trim() || fallbackWinner,
    confidence,
    score_range: String(w.score_range ?? "").trim() || "—",
    key_player: String(w.key_player ?? "").trim() || "—",
    swing_factor: String(w.swing_factor ?? "").trim() || "—",
    summary:
      String(w.summary ?? "").trim() ||
      `Close contest — ${fallbackWinner} shaded on current read.`,
  };
}

/**
 * Browser-side judge prompt — same field contract as `judge_service.judge.JUDGE_SYSTEM_PROMPT` (winner constrained to displayed teams).
 * @param {{ teamA: string, teamB: string, codeA: string, codeB: string }} teams
 * @param {string} match
/**
 * Parse key in-game metrics from any free-text live score snippet.
 * Returns null when no recognisable numeric data is found.
 * @param {string} text
 * @returns {{ rrr: number|null, runsNeeded: number|null, ballsLeft: number|null, overs: number|null } | null}
 */
function parseLiveScoreText(text) {
  if (!text) return null;
  const s = String(text);

  // RRR patterns: "RRR: >36", "RRR: 14.3", "req. rate 12.5", "required run rate 9.2"
  const rrrRx = /\bR{1,2}R\s*[:\-]?\s*(>?\s*[\d.]+)/i;
  const reqRateRx = /req(?:uired)?\s*(?:run\s*)?rate\s*[:\-]?\s*(>?\s*[\d.]+)/i;
  let rrr = null;
  const rrrM = s.match(rrrRx) || s.match(reqRateRx);
  if (rrrM) {
    rrr = parseFloat(rrrM[1].replace(/^>\s*/, ""));
    if (!Number.isFinite(rrr)) rrr = null;
  }

  // "need 63 runs in 6 balls" / "63 runs needed off 6 balls" / "63 runs from 6 balls"
  const needRx  = /need\s+(\d+)\s+(?:more\s+)?runs?\s+(?:in|off|from)\s+(\d+)\s+balls?/i;
  const needRx2 = /(\d+)\s+(?:more\s+)?runs?\s+(?:needed|required|to\s+win)[\s\S]{0,12}?(\d+)\s+balls?/i;
  const fromRx  = /(\d+)\s+runs?\s+(?:from|off)\s+(\d+)\s+balls?/i;

  let runsNeeded = null;
  let ballsLeft  = null;
  const m = s.match(needRx) || s.match(needRx2) || s.match(fromRx);
  if (m) {
    runsNeeded = parseInt(m[1], 10);
    ballsLeft  = parseInt(m[2], 10);
    if (rrr === null && ballsLeft > 0) {
      rrr = (runsNeeded / ballsLeft) * 6;
    }
  }

  // Overs remaining from patterns like "(19)" or "in 6 balls" → fractional overs
  let overs = null;
  if (ballsLeft != null) overs = +(ballsLeft / 6).toFixed(2);

  if (rrr === null && runsNeeded === null) return null;
  return { rrr, runsNeeded, ballsLeft, overs };
}

/**
 * Given the raw live score text, append a computed game-state verdict so the LLM
 * cannot misread ambiguous phrasing.  Returns the enriched string.
 * @param {string} text
 * @returns {string}
 */
function enrichLiveStateText(text) {
  const parsed = parseLiveScoreText(text);
  if (!parsed) return text;

  const { rrr, runsNeeded, ballsLeft } = parsed;
  const lines = [text.trim()];
  lines.push("\n[COMPUTED FROM LIVE STATE]");

  if (runsNeeded != null && ballsLeft != null) {
    lines.push(`Needs: ${runsNeeded} runs off ${ballsLeft} ball${ballsLeft === 1 ? "" : "s"}`);
    const oversLeft = (ballsLeft / 6).toFixed(2);
    lines.push(`Balls left: ${ballsLeft} (${oversLeft} overs)`);
  }

  if (rrr != null) {
    lines.push(`Required run rate: ${rrr.toFixed(2)} per over`);
    let verdict = "";
    if      (rrr > 30) verdict = "MATHEMATICALLY NEAR-IMPOSSIBLE chase (RRR>30). Bowling team is CERTAIN to win (~99%+).";
    else if (rrr > 20) verdict = "Virtually impossible chase (RRR>20). Bowling team is overwhelming favourite (~97%+).";
    else if (rrr > 14) verdict = "Near-impossible chase (RRR>14). Bowling team has near-certain win (~90%+).";
    else if (rrr > 12) verdict = "Very difficult chase (RRR>12). Bowling team is heavy favourite (~82%+).";
    else if (rrr > 10) verdict = "Difficult chase (RRR>10). Bowling team is clear favourite (~70%+).";
    else if (rrr > 8)  verdict = "Competitive chase (RRR 8-10). Slightly in bowling team's favour.";
    else               verdict = "Achievable RRR — batting team in control of the chase.";
    lines.push(`Situation: ${verdict}`);
  }

  return lines.join("\n");
}

/**
 * @param {{ text: string } | null} [liveState]
 */
function buildBrowserJudgeSystemPrompt(teams, match, liveState) {
  const enrichedText = liveState ? enrichLiveStateText(liveState.text) : null;
  const liveBlock = enrichedText
    ? `\n\nCRITICAL — LIVE IN-GAME STATE (verified ground truth, supersedes all pre-match arguments):\n${enrichedText}\n`
    : "";
  const liveRule = enrichedText
    ? `The LIVE IN-GAME STATE above (including [COMPUTED FROM LIVE STATE] metrics) is THE primary and overriding input for your verdict — it supersedes every pre-match argument in the debate transcript.

MANDATORY RRR CONFIDENCE RULES (non-negotiable — apply these FIRST):
• RRR > 30 → bowling/fielding team WINS; confidence MUST be 99.
• RRR > 20 → bowling/fielding team WINS; confidence MUST be 97.
• RRR > 14 → bowling/fielding team WINS; confidence MUST be 90.
• RRR > 12 → bowling/fielding team WINS; confidence MUST be 82.
• RRR > 10 → bowling/fielding team WINS; confidence MUST be 72.
• RRR ≤ 8  → batting/chasing team likely ahead; derive confidence from margin.

"Bowling team" means the team that batted FIRST (defending their total).
Set "winner" to the defending team whenever RRR exceeds 10.
The debate transcript provides context only — NEVER let it override the live score.`
    : "base your verdict only on the transcript; do not invent live data not implied there.";
  return `You are the Judge for an AI cricket war room. Read the ENTIRE debate transcript and output a single JSON object ONLY — no markdown fences, no commentary before or after.${liveBlock}

The JSON must have exactly these keys and types (matches the server Verdict schema):
- "winner": MUST be exactly "${teams.teamA}" or "${teams.teamB}" (those exact strings).
- "confidence": integer from 0 to 100 (model confidence in that winner, not a betting line).
- "score_range": one short phrase — plausible score band or margin for the format (e.g. "15–25 runs", "2–4 wickets", "innings victory" for Tests).
- "key_player": one player name who most shifts the outcome if they perform.
- "swing_factor": one short phrase for the main uncertainty or match-defining variable.
- "summary": 2–4 sentences explaining why the winner edges it, grounded in points both sides raised.

Rules: ${liveRule} Output must be valid JSON with double-quoted keys and strings.

Fixture label: ${match}`;
}

/**
 * @param {Record<string, unknown>|null|undefined} ctx
 * @returns {string} safe HTML
 */
function formatVerdictIngestionMetaHtml(ctx) {
  if (!ctx || typeof ctx !== "object") {
    return `<div class="verdict-ingestion-meta verdict-ingestion-meta--muted">Evidence metadata not available.</div>`;
  }
  const errRaw = ctx._ingestion_error != null ? String(ctx._ingestion_error).trim() : "";
  const fetchedRaw = ctx.fetched_at != null ? String(ctx.fetched_at).trim() : "";
  const rows = [];

  if (fetchedRaw) {
    rows.push(
      `<div class="verdict-ingestion-meta__row"><span class="verdict-ingestion-meta__k">Evidence fetched</span> <time class="verdict-ingestion-meta__v" datetime="${escapeHtml(fetchedRaw)}">${escapeHtml(fetchedRaw)}</time></div>`
    );
  }

  const src = ctx.sources;
  if (Array.isArray(src) && src.length) {
    const lis = [];
    for (const s of src) {
      if (!s || typeof s !== "object") continue;
      const name = s.name != null ? String(s.name).trim() : "";
      const url = s.url != null ? String(s.url).trim() : "";
      const ok = s.ok !== false;
      if (!name && !url) continue;
      const warn = ok ? "" : ` <span class="verdict-ingestion-meta__warn">(unavailable)</span>`;
      let inner;
      if (url && name) {
        inner = `<a class="verdict-ingestion-meta__link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a>`;
      } else if (url) {
        inner = `<a class="verdict-ingestion-meta__link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
      } else {
        inner = escapeHtml(name);
      }
      lis.push(`<li>${inner}${warn}</li>`);
    }
    if (lis.length) {
      rows.push(
        `<div class="verdict-ingestion-meta__row"><span class="verdict-ingestion-meta__k">Sources</span></div><ul class="verdict-ingestion-meta__sources">${lis.join("")}</ul>`
      );
    }
  }

  const hasSourceList = rows.some((r) => r.includes("verdict-ingestion-meta__sources"));
  if (!fetchedRaw && !hasSourceList) {
    if (errRaw) {
      const msg =
        errRaw === "offline_or_file_origin"
          ? "Evidence not loaded — use http://localhost:3333 (or your Node server URL), not a file:// page."
          : errRaw;
      rows.push(`<div class="verdict-ingestion-meta__row verdict-ingestion-meta--warn">${escapeHtml(msg)}</div>`);
    } else {
      rows.push(
        `<div class="verdict-ingestion-meta__row verdict-ingestion-meta--muted">No evidence timestamp or source list (offline or ingestion skipped).</div>`
      );
    }
  } else if (errRaw) {
    rows.push(`<div class="verdict-ingestion-meta__note">${escapeHtml(errRaw)}</div>`);
  }

  return `<div class="verdict-ingestion-meta">${rows.join("")}</div>`;
}

/**
 * @param {HTMLElement} verdictRootEl
 * @param {WarRoomVerdict} v
 * @param {{ teamA: string, teamB: string, codeA: string, codeB: string }} teams
 * @param {{ source: 'service' | 'browser', predictionId?: number, ingestionCtx?: Record<string, unknown>, judgeApiNote?: string }} meta
 */
function mountJudgeVerdictCard(verdictRootEl, v, teams, meta) {
  const winDisplay = resolveWinnerDisplay(teams, v.winner);
  const winNorm = String(v.winner || "").trim().toLowerCase();
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
  const confRaw = Number(v.confidence);
  const conf = Number.isFinite(confRaw) ? Math.min(100, Math.max(0, confRaw)) : 55;
  const pctForTeamA = pickedA ? conf : 100 - conf;
  const winProb = renderVerdictWinProbabilityBlock(teams, pctForTeamA, { variant: "judge" });
  const ingestionBlock = formatVerdictIngestionMetaHtml(meta.ingestionCtx);
  const sub =
    meta.source === "service" && meta.predictionId != null
      ? `<p class="verdict-subkicker">Saved · prediction #${escapeHtml(String(meta.predictionId))} (Judge service)</p>`
      : meta.source === "browser"
        ? meta.judgeApiNote != null && String(meta.judgeApiNote).trim()
          ? `<p class="verdict-subkicker">Browser judge (fallback)</p>`
          : `<p class="verdict-subkicker">Browser judge — start Judge service on port 8000 to persist picks via the Node proxy.</p>`
        : "";
  const judgeNote =
    meta.judgeApiNote != null && String(meta.judgeApiNote).trim()
      ? `<p class="verdict-subkicker verdict-subkicker--warn">${escapeHtml(String(meta.judgeApiNote).trim())}</p>`
      : "";
  verdictRootEl.innerHTML = `
    <div class="verdict-card">
      <div class="verdict-kicker">Judge verdict</div>
      ${sub}
      ${judgeNote}
      <div class="verdict-winner-row">${verdictLogoHtml}<div class="verdict-winner">${escapeHtml(String(winDisplay).toUpperCase())} WINS</div></div>
      <div class="verdict-summary">${escapeHtml(v.summary || "")}</div>
      ${ingestionBlock}
      ${winProb.html}
      <div class="stat-grid">
        <div class="stat-cell"><div class="stat-label">PROJECTED SCORE</div><div class="stat-val">${escapeHtml(String(v.score_range || "—"))}</div></div>
        <div class="stat-cell"><div class="stat-label">KEY PLAYER</div><div class="stat-val">${escapeHtml(String(v.key_player || "—"))}</div></div>
        <div class="stat-cell"><div class="stat-label">SWING FACTOR</div><div class="stat-val">${escapeHtml(String(v.swing_factor || "—"))}</div></div>
        <div class="stat-cell"><div class="stat-label">MODEL CONFIDENCE</div><div class="stat-val">${escapeHtml(String(v.confidence ?? "—"))}% <span class="stat-sublabel">not win probability</span></div></div>
      </div>
      <div class="verdict-share-row">
        <button type="button" class="verdict-share-btn js-share-prediction" aria-label="Copy link to this prediction">Share this prediction</button>
      </div>
    </div>`;
  scheduleVerdictWinProbabilityAnimation(verdictRootEl, winProb.pctA, winProb.pctB);
  const shareBtn = verdictRootEl.querySelector(".js-share-prediction");
  if (shareBtn) {
    shareBtn.addEventListener("click", () => {
      const mi = /** @type {HTMLInputElement|null} */ (document.getElementById("matchInput"));
      const label = (mi?.value || "").trim();
      if (!label) {
        showAutoDetectToast("Pick a fixture first");
        return;
      }
      void copyPredictionShareLink(label, v);
    });
  }
}

/**
 * @param {string} text
 * @param {number} maxLen
 */
function clipForShareUrl(text, maxLen) {
  const s = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

/**
 * @typedef {{ v: 1, l: string, w: string, c: number, s?: string, r?: string, k?: string, f?: string }} SharePackV1
 */

/** Set when `?p=` or `?sid=` resolves; consumed by {@link applySharedPredictionPreviewFromUrl}. */
let _acwrSharePackP = /** @type {SharePackV1 | null} */ (null);

/**
 * Normalise server or base64-decoded JSON into {@link SharePackV1}.
 * @param {unknown} o
 * @returns {SharePackV1 | null}
 */
function sharePackV1FromApiBody(o) {
  if (!o || typeof o !== "object") return null;
  const raw = /** @type {Record<string, unknown>} */ (o);
  if (Number(raw.v) !== 1) return null;
  const l = String(raw.l ?? "").trim();
  const w = String(raw.w ?? "").trim();
  if (!l || !w) return null;
  const c = Number(raw.c);
  /** @type {SharePackV1} */
  const out = {
    v: 1,
    l,
    w,
    c: Number.isFinite(c) ? Math.min(100, Math.max(0, Math.round(c))) : 55,
  };
  if (raw.s != null && String(raw.s).trim()) out.s = String(raw.s);
  if (raw.r != null && String(raw.r).trim()) out.r = String(raw.r);
  if (raw.k != null && String(raw.k).trim()) out.k = String(raw.k);
  if (raw.f != null && String(raw.f).trim()) out.f = String(raw.f);
  return out;
}

function utf8ToBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * @param {string} b64url
 * @returns {string}
 */
function base64UrlToUtf8(b64url) {
  let b64 = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(out);
}

/**
 * Compact share token: one `p` query param (base64url JSON) instead of many long `share=…&summary=…` params.
 * @param {SharePackV1} pack
 */
function encodeSharePack(pack) {
  return utf8ToBase64Url(JSON.stringify(pack));
}

/**
 * @param {string} b64url
 * @returns {SharePackV1 | null}
 */
function decodeSharePack(b64url) {
  try {
    const s = base64UrlToUtf8(b64url.trim());
    return sharePackV1FromApiBody(JSON.parse(s));
  } catch {
    return null;
  }
}

/**
 * Map Judge winner field to a short team code for share URLs (e.g. SRH).
 * @param {{ teamA: string, teamB: string, codeA: string, codeB: string }} teams
 * @param {string} winnerField
 */
function verdictWinnerToShareCode(teams, winnerField) {
  const winNorm = String(winnerField || "").trim().toLowerCase();
  const isA =
    winNorm === String(teams.teamA).trim().toLowerCase() ||
    winNorm === String(teams.codeA).trim().toLowerCase();
  const isB =
    winNorm === String(teams.teamB).trim().toLowerCase() ||
    winNorm === String(teams.codeB).trim().toLowerCase();
  if (isA && !isB) return normalizeShareTeamCode(teams.codeA);
  if (isB && !isA) return normalizeShareTeamCode(teams.codeB);
  if (isA && isB) return normalizeShareTeamCode(teams.codeA);
  const raw = String(winnerField || "").trim().toUpperCase();
  return raw ? normalizeShareTeamCode(raw.slice(0, 4)) : normalizeShareTeamCode(teams.codeA);
}

/**
 * @param {string} verdictParam
 * @param {{ teamA: string, teamB: string, codeA: string, codeB: string }} teams
 */
function verdictParamMatchesTeams(verdictParam, teams) {
  const raw = String(verdictParam || "").trim();
  if (!raw) return false;
  const vCode = normalizeShareTeamCode(raw);
  const a = normalizeShareTeamCode(teams.codeA);
  const b = normalizeShareTeamCode(teams.codeB);
  if (vCode === a || vCode === b) return true;
  const rl = raw.toLowerCase();
  if (rl === String(teams.teamA).trim().toLowerCase()) return true;
  if (rl === String(teams.teamB).trim().toLowerCase()) return true;
  return false;
}

/**
 * @param {string} matchLabel
 * @param {WarRoomVerdict} v
 * @returns {SharePackV1}
 */
function sharePackFromVerdict(matchLabel, v) {
  const label = String(matchLabel || "").trim();
  const teams = parseTeamsFromMatch(label);
  const conf = Math.round(Number(v.confidence) || 55);
  /** @type {SharePackV1} */
  const pack = {
    v: 1,
    l: label,
    w: verdictWinnerToShareCode(teams, v.winner),
    c: conf,
  };
  const sum = clipForShareUrl(v.summary, 160);
  if (sum) pack.s = sum;
  const sr = clipForShareUrl(v.score_range === "—" ? "" : v.score_range, 40);
  if (sr) pack.r = sr;
  const kp = clipForShareUrl(v.key_player === "—" ? "" : v.key_player, 48);
  if (kp) pack.k = kp;
  const sf = clipForShareUrl(v.swing_factor === "—" ? "" : v.swing_factor, 48);
  if (sf) pack.f = sf;
  return pack;
}

/**
 * Offline / fallback: one `p=` base64url param.
 * @param {string} matchLabel
 * @param {WarRoomVerdict} v
 */
function buildPredictionShareUrlCompactP(matchLabel, v) {
  const u = new URL(window.location.href);
  u.hash = "";
  u.search = "";
  u.searchParams.set("p", encodeSharePack(sharePackFromVerdict(matchLabel, v)));
  return u.toString();
}

/**
 * Short `/s/{id}` when the Node server is available; else compact `?p=`.
 * @param {string} matchLabel
 * @param {WarRoomVerdict} v
 */
async function resolvePredictionShareUrl(matchLabel, v) {
  const pack = sharePackFromVerdict(matchLabel, v);
  if (apiBase() !== null) {
    try {
      const r = await fetch(`${apiBase()}/api/share-prediction`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(pack),
      });
      if (r.ok) {
        const d = await r.json();
        const id = d && d.id != null ? String(d.id).trim().toLowerCase() : "";
        if (id && /^[a-f0-9]{8}$/.test(id)) {
          const u = new URL(window.location.href);
          u.hash = "";
          u.search = "";
          u.pathname = `/s/${id}`;
          return u.toString();
        }
      }
    } catch {
      /* fall back */
    }
  }
  return buildPredictionShareUrlCompactP(matchLabel, v);
}

/**
 * @param {string} matchLabel
 * @param {WarRoomVerdict} v
 */
async function copyPredictionShareLink(matchLabel, v) {
  const url = await resolvePredictionShareUrl(matchLabel, v);
  try {
    await navigator.clipboard.writeText(url);
    showAutoDetectToast("Prediction link copied");
  } catch {
    try {
      window.prompt("Copy this prediction link:", url);
    } catch {
      showAutoDetectToast("Could not copy link");
    }
  }
}

/**
 * Static verdict card when opening a shared prediction URL (?share=…&verdict=…&confidence=…).
 * @param {HTMLElement} verdictRootEl
 * @param {WarRoomVerdict} v
 * @param {{ teamA: string, teamB: string, codeA: string, codeB: string }} teams
 * @param {{ verdictMatchesTeams: boolean }} opts
 */
function mountSharedPredictionPreviewCard(verdictRootEl, v, teams, opts) {
  const winDisplay = resolveWinnerDisplay(teams, v.winner);
  const winNorm = String(v.winner || "").trim().toLowerCase();
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
  const confRaw = Number(v.confidence);
  const conf = Number.isFinite(confRaw) ? Math.min(100, Math.max(0, confRaw)) : 55;
  const pctForTeamA = pickedA ? conf : 100 - conf;
  const winProb = renderVerdictWinProbabilityBlock(teams, pctForTeamA, { variant: "judge" });
  const warn = opts.verdictMatchesTeams
    ? ""
    : `<p class="verdict-subkicker verdict-subkicker--warn">This shared pick doesn't match the fixture's teams - shown as posted.</p>`;
  const sub = `<p class="verdict-subkicker">Someone shared this Judge pick. <strong>Run war room</strong> in the command bar for agents, debate, and live updates.</p>${warn}`;

  verdictRootEl.innerHTML = `
    <div class="verdict-card verdict-card--shared-preview">
      <div class="verdict-kicker">Shared prediction</div>
      ${sub}
      <div class="verdict-winner-row">${verdictLogoHtml}<div class="verdict-winner">${escapeHtml(String(winDisplay).toUpperCase())} WINS</div></div>
      <div class="verdict-summary">${escapeHtml(v.summary || "")}</div>
      ${winProb.html}
      <div class="stat-grid">
        <div class="stat-cell"><div class="stat-label">PROJECTED SCORE</div><div class="stat-val">${escapeHtml(String(v.score_range || "—"))}</div></div>
        <div class="stat-cell"><div class="stat-label">KEY PLAYER</div><div class="stat-val">${escapeHtml(String(v.key_player || "—"))}</div></div>
        <div class="stat-cell"><div class="stat-label">SWING FACTOR</div><div class="stat-val">${escapeHtml(String(v.swing_factor || "—"))}</div></div>
        <div class="stat-cell"><div class="stat-label">MODEL CONFIDENCE</div><div class="stat-val">${escapeHtml(String(v.confidence ?? "—"))}% <span class="stat-sublabel">not win probability</span></div></div>
      </div>
      <div class="verdict-share-row">
        <button type="button" class="verdict-share-cta js-shared-run-war-room">Run full war room</button>
      </div>
    </div>`;
  scheduleVerdictWinProbabilityAnimation(verdictRootEl, winProb.pctA, winProb.pctB);

  const cta = verdictRootEl.querySelector(".js-shared-run-war-room");
  if (cta) {
    cta.addEventListener("click", () => {
      if (running) return;
      void runWarRoom();
    });
  }
}

/**
 * If the URL includes compact `?p=` or legacy `verdict=…` (with fixture in `#matchInput`), show the shared verdict card immediately.
 */
async function applySharedPredictionPreviewFromUrl() {
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById("matchInput"));
  const verdictEl = document.getElementById("verdictArea");
  if (!input || !verdictEl) return;

  const matchLabel = input.value.trim();
  if (!matchLabel) return;

  let sp;
  try {
    sp = new URLSearchParams(window.location.search);
  } catch {
    return;
  }

  let verdictRaw = "";
  let confidence = 55;
  let summary = "";
  let score_range = "";
  let key_player = "";
  let swing_factor = "";

  if (_acwrSharePackP) {
    const p = _acwrSharePackP;
    verdictRaw = String(p.w || "").trim();
    confidence = p.c;
    if (p.s) summary = String(p.s).trim();
    if (p.r) score_range = String(p.r).trim();
    if (p.k) key_player = String(p.k).trim();
    if (p.f) swing_factor = String(p.f).trim();
  } else {
    verdictRaw = String(sp.get("verdict") || "").trim();
    if (!verdictRaw) return;
    const c = Number(sp.get("confidence"));
    confidence = Number.isFinite(c) ? Math.min(100, Math.max(0, Math.round(c))) : 55;
    summary = String(sp.get("summary") || "").trim();
    score_range = String(sp.get("score_range") || "").trim();
    key_player = String(sp.get("key_player") || "").trim();
    swing_factor = String(sp.get("swing_factor") || "").trim();
  }

  if (!verdictRaw) return;

  const teams = parseTeamsFromMatch(matchLabel);
  /** @type {Record<string, unknown>} */
  const partial = { winner: verdictRaw, confidence };
  if (score_range) partial.score_range = score_range;
  if (key_player) partial.key_player = key_player;
  if (swing_factor) partial.swing_factor = swing_factor;
  if (summary) partial.summary = summary;

  const v = normalizeVerdictPartial(partial, teams);
  const verdictMatchesTeams = verdictParamMatchesTeams(verdictRaw, teams);

  mountSharedPredictionPreviewCard(verdictEl, v, teams, { verdictMatchesTeams });
  document.getElementById("main-content")?.classList.remove("dashboard--pre-war-room");
  setMatchBar(matchLabel, teams);
  scrollVerdictPanelIntoView({ behavior: "auto" });
}

/** Transient gateway / cold-start statuses when the Node proxy calls the Judge service on Render. */
function isJudgeTransientHttpStatus(status) {
  return status === 502 || status === 503 || status === 504 || status === 429;
}

/**
 * @param {Response} r
 * @returns {number | null} milliseconds to wait, capped
 */
function parseRetryAfterMsFromResponse(r) {
  const h = (r.headers.get("retry-after") || "").trim();
  if (h) {
    const n = Number(h);
    if (Number.isFinite(n) && n > 0) return Math.min(60_000, Math.ceil(n * 1000));
    const dateMs = Date.parse(h);
    if (Number.isFinite(dateMs)) {
      const delta = dateMs - Date.now();
      if (delta > 0) return Math.min(60_000, delta);
    }
  }
  return null;
}

/**
 * Plain-language copy for common HTTP failures (ingestion, proxy, LLM APIs).
 * @param {number} status
 * @param {string} [serverDetail] optional message from JSON body (not used for 429; keeps copy short)
 */
/** When the server has `WAR_ROOM_API_SECRET`, set the same value in localStorage under this key (dev / locked deploys). */
function warRoomOptionalAuthHeaders() {
  try {
    if (typeof localStorage === "undefined") return {};
    const t = localStorage.getItem("WAR_ROOM_API_SECRET");
    if (t && String(t).trim()) return { Authorization: `Bearer ${String(t).trim()}` };
  } catch {
    /* private mode */
  }
  return {};
}

function humanReadableHttpFailureMessage(status, serverDetail) {
  if (status === 429) {
    return "Rate limited — the API is busy. Try again in a minute.";
  }
  if (status === 502 || status === 503 || status === 504) {
    return "Service temporarily unavailable. Try again shortly.";
  }
  const d = serverDetail != null && String(serverDetail).trim();
  if (d) return d;
  return `Request failed (HTTP ${status}).`;
}

/**
 * Judge routes are proxied to a separate Python service; free-tier cold starts often return 502 briefly.
 * Groq (used by the Judge) may return 429 — retry with backoff so the UI can recover without a full refresh.
 * @param {string} url
 * @param {RequestInit} init
 */
async function fetchJudgeProxyWithRetry(url, init) {
  const maxAttempts = 4;
  const coldStartPauseMs = 3000;
  /** @type {Response|undefined} */
  let last;
  for (let i = 0; i < maxAttempts; i++) {
    const r = await fetch(url, {
      ...init,
      headers: { ...warRoomOptionalAuthHeaders(), ...(init.headers && typeof init.headers === "object" ? init.headers : {}) },
    });
    last = r;
    if (r.ok) return r;
    if (i < maxAttempts - 1 && isJudgeTransientHttpStatus(r.status)) {
      if (r.status === 429) {
        const runLbl = document.getElementById("runningLabel");
        if (runLbl) {
          runLbl.style.display = "";
          runLbl.textContent = "Rate limited — retrying…";
        }
      }
      const pauseMs =
        r.status === 429
          ? parseRetryAfterMsFromResponse(r) ?? Math.min(45_000, 2500 * (i + 1) ** 2)
          : coldStartPauseMs;
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    } else {
      return r;
    }
  }
  return /** @type {Response} */ (last);
}

/**
 * @typedef {{ ok: true, prediction_id: number, verdict: WarRoomVerdict, accuracy?: { total_settled: number, correct: number, accuracy: number | null } }} JudgePredictOk
 * @typedef {{ ok: false, status: number }} JudgePredictErr
 */

/**
 * @param {string} matchId
 * @param {string} debateTranscript
 * @returns {Promise<JudgePredictOk | JudgePredictErr>}
 */
async function postJudgePredict(matchId, debateTranscript) {
  try {
    const r = await fetchJudgeProxyWithRetry(`${apiBase()}/api/judge/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ match_id: matchId, debate_transcript: debateTranscript }),
    });
    if (!r.ok) return { ok: false, status: r.status };
    const data = await r.json();
    if (!data || typeof data !== "object" || !data.verdict) return { ok: false, status: 0 };
    return {
      ok: true,
      prediction_id: Number(data.prediction_id) || 0,
      verdict: /** @type {WarRoomVerdict} */ (data.verdict),
      accuracy: data.accuracy,
    };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * @returns {Promise<{ total_settled: number, correct: number, accuracy: number | null } | null>}
 */
async function fetchJudgeAccuracyStats() {
  try {
    const r = await fetchJudgeProxyWithRetry(`${apiBase()}/api/judge/accuracy`, {
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data || typeof data !== "object") return null;
    return {
      total_settled: Number(data.total_settled) || 0,
      correct: Number(data.correct) || 0,
      accuracy: data.accuracy != null && Number.isFinite(Number(data.accuracy)) ? Number(data.accuracy) : null,
    };
  } catch {
    return null;
  }
}

/**
 * @param {{ total_settled: number, correct: number, accuracy: number | null } | null} stats
 * @param {{ proxyUnreachable?: boolean, fileProtocol?: boolean }} [opts]
 */
function updateJudgeAccuracyFooterFromStats(stats, opts = {}) {
  const el = document.getElementById("judgeAccuracyFooter");
  if (!el) return;
  el.classList.remove("app-footer__line--muted");
  if (opts.fileProtocol) {
    el.classList.add("app-footer__line--muted");
    el.textContent =
      "Prediction stats need the app server — use http://localhost:3333 instead of opening the file directly.";
    return;
  }

  if (!stats) {
    el.classList.add("app-footer__line--muted");
    return;
  }
  if (stats.total_settled <= 0) {
    el.textContent =
      "No settled predictions yet — record match outcomes to see accuracy here.";
    return;
  }
  const pct =
    stats.accuracy != null && Number.isFinite(stats.accuracy)
      ? `${Math.round(stats.accuracy * 1000) / 10}%`
      : "—";
  el.textContent = `Settled predictions: ${stats.correct} of ${stats.total_settled} correct (${pct}).`;
}

async function refreshJudgeAccuracyFooter() {
  const fileProtocol = typeof location !== "undefined" && location.protocol === "file:";
  if (fileProtocol) {
    updateJudgeAccuracyFooterFromStats(null, { fileProtocol: true });
    return;
  }
  let r;
  try {
    r = await fetchJudgeProxyWithRetry(`${apiBase()}/api/judge/accuracy`, { headers: { Accept: "application/json" } });
  } catch {
    updateJudgeAccuracyFooterFromStats(null, { proxyUnreachable: true });
    return;
  }
  if (r.status === 503) {
    updateJudgeAccuracyFooterFromStats(null, { proxyUnreachable: true });
    return;
  }
  if (!r.ok) {
    updateJudgeAccuracyFooterFromStats(null, {});
    return;
  }
  try {
    const data = await r.json();
    if (!data || typeof data !== "object") {
      updateJudgeAccuracyFooterFromStats(null, {});
      return;
    }
    updateJudgeAccuracyFooterFromStats({
      total_settled: Number(data.total_settled) || 0,
      correct: Number(data.correct) || 0,
      accuracy: data.accuracy != null && Number.isFinite(Number(data.accuracy)) ? Number(data.accuracy) : null,
    });
  } catch {
    updateJudgeAccuracyFooterFromStats(null, {});
  }
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

  if (apiBase() === null) return null;

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

/**
 * @param {Array<{role: string, content: string}>} messages
 * @param {string} system
 * @param {number} [maxTokens]
 * @param {'intel'|'debate'|'judge'|'live'|'over'|'misc'} [groqRoute] forwarded to the proxy for Groq model + cap selection (ignored by Anthropic after strip)
 */
async function callClaude(messages, system, maxTokens = 1000, groqRoute = 'misc') {
  const r = await fetch(`${apiBase()}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...warRoomOptionalAuthHeaders() },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages,
      groq_route: groqRoute,
    }),
  });
  let d;
  try {
    d = await r.json();
  } catch {
    throw new Error(`Bad response (HTTP ${r.status}). Use http://localhost:3333 via "node server.mjs", not a raw .html file.`);
  }
  if (!r.ok) {
    const raw =
      d.error?.message ||
      (typeof d.error === "string" ? d.error : null) ||
      d.message ||
      `Request failed (${r.status})`;
    const msg =
      r.status === 429 || r.status === 502 || r.status === 503 || r.status === 504
        ? humanReadableHttpFailureMessage(r.status, typeof raw === "string" ? raw : "")
        : raw;
    throw new Error(msg);
  }
  return (d.content || []).map((b) => (b && b.text != null ? b.text : '')).join('');
}

function setPhaseStep(step) {
  const stepper = document.getElementById('phaseStepper');
  const steps = { intel: 'stepIntel', debate: 'stepDebate', judge: 'stepJudge' };
  const order = ['intel', 'debate', 'judge'];
  if (!stepper) return;
  if (!step) {
    stepper.classList.remove('visible');
    Object.values(steps).forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('active', 'done'); }
    });
    return;
  }
  stepper.classList.add('visible');
  const activeIdx = order.indexOf(step);
  order.forEach((s, i) => {
    const el = document.getElementById(steps[s]);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (i < activeIdx) el.classList.add('done');
    else if (i === activeIdx) el.classList.add('active');
  });
}

function setPhase(text, spinning = false) {
  const b = document.getElementById('phaseBanner');
  b.classList.remove('phase-banner--error');
  if (!text) {
    b.style.display = 'none';
    setPhaseStep(null);
    return;
  }
  b.style.display = 'flex';
  b.innerHTML = (spinning ? '<div class="phase-spinner"></div>' : '') + `<span>${escapeHtml(text)}</span>`;
  const tl = text.toLowerCase();
  if (tl.includes('intel') || tl.includes('gathering')) setPhaseStep('intel');
  else if (tl.includes('debate')) setPhaseStep('debate');
  else if (tl.includes('judge') || tl.includes('deliberat')) setPhaseStep('judge');
}

function showApiError(msg) {
  const b = document.getElementById('phaseBanner');
  b.style.display = 'flex';
  b.classList.add('phase-banner--error');
  b.innerHTML = `<span class="phase-banner__err-text">${escapeHtml(msg)}</span>`;
}

function dismissNoLiveDataWarning() {
  const el = document.getElementById("noLiveDataAlert");
  if (el) el.hidden = true;
  const bar = document.getElementById("liveScoreBar");
  if (bar) bar.classList.remove("live-score-bar--no-data");
}

/**
 * Show/hide the "no live score" warning banner in the debate area.
 * When visible it prompts the user to paste the current score into the live score field.
 * @param {boolean} show
 */
function showNoLiveDataWarning(show) {
  const id = "noLiveDataAlert";
  const bar = document.getElementById("liveScoreBar");
  let el = document.getElementById(id);

  if (!show) {
    if (el) el.hidden = true;
    if (bar) bar.classList.remove("live-score-bar--no-data");
    return;
  }

  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.className = "no-live-alert";
    el.setAttribute("role", "alert");
    el.innerHTML = `
      <svg class="no-live-alert__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span class="no-live-alert__text">
        <strong>No live score detected.</strong>
        For an accurate prediction on a live match, paste the current score into the
        <strong>Live score</strong> row at the top of the command bar (e.g.&nbsp;<em>PBKS 254/7 (20&nbsp;ov) — LSG 192/4 (19&nbsp;ov), need 63 off 6 balls, RRR&nbsp;&gt;36</em>)
        and re-run.
      </span>
      <button type="button" class="no-live-alert__close" aria-label="Dismiss">×</button>`;
    const debateCard = document.getElementById("debateCard");
    if (debateCard) debateCard.prepend(el);
    else return;
    const closeBtn = el.querySelector(".no-live-alert__close");
    if (closeBtn) closeBtn.addEventListener("click", dismissNoLiveDataWarning);
  }

  el.hidden = false;
  if (bar) bar.classList.add("live-score-bar--no-data");
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
  const avatarEmoji = side === 'bull' ? '🐂' : '🐻';
  const avatar = `<div class="bubble-avatar bubble-avatar--${side}" aria-hidden="true">${avatarEmoji}</div>`;
  div.innerHTML = `${kicker}<div class="bubble-head">${avatar}${mark}<div class="bubble-who">${escapeHtml(who)}</div></div><div class="bubble-text">${escapeHtml(text)}</div>`;
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

const INTEL_FALLBACK = "Insufficient data; neutral read.";

const INTEL_SYSTEM =
  "Reply with exactly one sentence of 15–20 words. No preamble, labels, or quotation marks. " +
  "Use ONLY facts stated in the Evidence section; do not invent statistics, scores, or events. " +
  `If the evidence does not support a substantive claim for your specialty, say exactly: ${INTEL_FALLBACK}`;

const MERGED_INTEL_SYSTEM =
  "You are five cricket-analysis specialists collapsed into one call. The user message contains " +
  "five labelled evidence sections — scout, stats, weather, pitch, news. " +
  "Reply with ONLY a JSON object of the exact shape " +
  `{"scout":"...","stats":"...","weather":"...","pitch":"...","news":"..."} — no markdown, no extra keys. ` +
  "Each value must be exactly one sentence of 15–20 words, derived strictly from that section's evidence; " +
  "do not invent statistics, scores, or events; do not cross-reference other specialties. " +
  `If a section's evidence does not support a substantive claim, set its value to exactly: ${INTEL_FALLBACK}`;

const MAX_EVIDENCE_CHARS_PER_AGENT = 1200;
const MAX_DEBATE_HISTORY_CHARS = 2400;

/**
 * Last war-room ingestion bundle so per-agent refresh can re-fetch RSS and re-run one intel call.
 * @type {{ match: string, teams: { teamA: string, teamB: string, codeA: string, codeB: string }, ingestedCtx: Record<string, unknown> } | null}
 */
let intelRefreshSession = null;

function clearIntelRefreshSession() {
  intelRefreshSession = null;
  for (const a of AGENTS) {
    if (a.id === "live") continue;
    const btn = document.getElementById(`intel-refresh-${a.id}`);
    if (btn) /** @type {HTMLButtonElement} */ (btn).hidden = true;
  }
}

/**
 * @param {string} text
 */
function isIntelFallbackInsightText(text) {
  return String(text || "").trim() === INTEL_FALLBACK;
}

/**
 * @param {string} agentId
 */
function syncIntelRefreshButtonForAgent(agentId) {
  if (agentId === "live") return;
  const btn = document.getElementById(`intel-refresh-${agentId}`);
  const ins = document.getElementById(`insight-${agentId}`);
  if (!btn || !ins) return;
  const show =
    intelRefreshSession != null &&
    isIntelFallbackInsightText(ins.textContent || "");
  /** @type {HTMLButtonElement} */ (btn).hidden = !show;
}

/**
 * @param {string} agentId
 */
function syncAllIntelRefreshButtons() {
  for (const a of AGENTS) {
    if (a.id !== "live") syncIntelRefreshButtonForAgent(a.id);
  }
}

/**
 * @param {{ id: string, name: string, role: string }} agentMeta
 */
function buildSingleAgentIntelSystem(agentMeta) {
  return (
    "Reply with exactly one sentence of 15–20 words. No preamble, labels, or quotation marks. " +
    `You are the ${agentMeta.name} (${agentMeta.role}). Use ONLY facts stated in the Evidence section; do not invent statistics, scores, or events. ` +
    `If the evidence does not support a substantive claim for your specialty, say exactly: ${INTEL_FALLBACK}`
  );
}

/**
 * Re-fetch match context, then one LLM call for this agent only (updates tile + session context).
 * @param {string} agentId
 */
async function runSingleIntelAgentRefresh(agentId) {
  if (!intelRefreshSession || agentId === "live") return;
  const meta = AGENTS.find((a) => a.id === agentId);
  if (!meta) return;

  const btn = /** @type {HTMLButtonElement|null} */ (document.getElementById(`intel-refresh-${agentId}`));
  const el = document.getElementById(`insight-${agentId}`);
  if (!btn || !el) return;

  btn.disabled = true;
  btn.classList.add("agent-intel-refresh--busy");
  const { match, teams } = intelRefreshSession;

  try {
    const ingestedCtx = await fetchMatchContextFromServer(match, teams);
    intelRefreshSession.ingestedCtx = ingestedCtx;
    const evidence = clipText(
      buildMergedIntelEvidence(agentId, ingestedCtx).trim(),
      MAX_EVIDENCE_CHARS_PER_AGENT
    );
    if (!evidence) {
      el.textContent = INTEL_FALLBACK;
      el.classList.add("show");
      syncIntelRefreshButtonForAgent(agentId);
      return;
    }
    const userContent =
      `Match: "${match}". Contest: ${teams.teamA} vs ${teams.teamB}.\n\n### Evidence\n${evidence}`;
    const text = await callClaude(
      [{ role: "user", content: userContent }],
      buildSingleAgentIntelSystem(meta),
      140,
      "intel"
    );
    let line = String(text || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!line) line = INTEL_FALLBACK;
    if (line.length > 320) line = `${line.slice(0, 317)}…`;
    el.textContent = line;
    el.classList.add("show");
  } catch (err) {
    el.textContent = "— " + (err instanceof Error ? err.message : "API error");
    el.classList.add("show");
  } finally {
    btn.disabled = false;
    btn.classList.remove("agent-intel-refresh--busy");
    syncIntelRefreshButtonForAgent(agentId);
  }
}

/**
 * @param {string} reason
 * @returns {Record<string, unknown>}
 */
function emptyMatchContext(reason) {
  return {
    news_bullets: [],
    stats_tables: {},
    pitch_note: "",
    weather_note: "",
    sources: [],
    fetched_at: "",
    _ingestion_error: reason,
  };
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeNewsBullets(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x).trim()).filter(Boolean);
}

/**
 * @param {string} match
 * @param {{ teamA: string, teamB: string, codeA: string, codeB: string }} teams
 * @returns {Promise<Record<string, unknown>>}
 */
async function fetchMatchContextFromServer(match, teams) {
  const base = apiBase();
  if (base === null) return emptyMatchContext("offline_or_file_origin");

  let venue = "";
  let date = "";
  let teamsParam =
    teams.teamA !== "Team A" && teams.teamB !== "Team B"
      ? `${teams.codeA},${teams.codeB}`
      : "";

  try {
    const rowR = await fetch(`${base}/api/match-by-label?label=${encodeURIComponent(match)}`);
    if (rowR.ok) {
      const data = await rowR.json();
      const m = data && data.match;
      if (m && typeof m === "object") {
        if (m.venue != null) venue = String(m.venue).trim();
        if (m.date != null) date = String(m.date).trim();
        if (Array.isArray(m.teams) && m.teams.length >= 2) {
          teamsParam = m.teams.map((t) => String(t).trim()).filter(Boolean).join(",");
        }
      }
    }
  } catch {
    /* use label-only query */
  }

  const u = new URL(`${base}/api/match-context`, window.location.href);
  u.searchParams.set("label", match);
  if (teamsParam) u.searchParams.set("teams", teamsParam);
  if (venue) u.searchParams.set("venue", venue);
  if (date) u.searchParams.set("date", date);

  try {
    const r = await fetch(u.toString());
    if (!r.ok) {
      let serverMsg = "";
      try {
        const err = await r.json();
        if (err && err.message != null) serverMsg = String(err.message);
      } catch {
        /* ignore */
      }
      const msg =
        r.status === 429 || r.status === 502 || r.status === 503 || r.status === 504
          ? humanReadableHttpFailureMessage(r.status, serverMsg)
          : serverMsg || humanReadableHttpFailureMessage(r.status);
      return emptyMatchContext(msg);
    }
    return await r.json();
  } catch (e) {
    return emptyMatchContext(e instanceof Error ? e.message : "fetch_failed");
  }
}

/**
 * @param {Record<string, unknown>} ctx
 * @returns {string}
 */
/** Cap ingested bundle size for LLM prompts (tokens ≈ chars/4). */
const MAX_INGESTED_DEBATE_CHARS = 10_000;

/**
 * @param {string} s
 * @param {number} max
 */
function clipText(s, max) {
  const t = String(s);
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 20))}\n…[truncated]`;
}

/**
 * Clip an Anthropic-style debate transcript so the cumulative content length
 * stays at or below `maxChars`. Always preserves the most recent two turns
 * (one user/assistant pair) intact; older turns are summarised to their first
 * ~300 chars and dropped entirely once the budget is still exceeded.
 *
 * @param {{ role: 'user' | 'assistant', content: string }[]} history
 * @param {number} maxChars
 * @returns {{ role: 'user' | 'assistant', content: string }[]}
 */
function clipDebateHistory(history, maxChars) {
  if (!Array.isArray(history) || history.length === 0) return [];
  const total = history.reduce((n, m) => n + String(m.content || "").length, 0);
  if (total <= maxChars) return history;

  // Keep the most recent two turns (last user + last assistant) intact.
  const keepTailCount = Math.min(2, history.length);
  const tail = history.slice(history.length - keepTailCount);
  const head = history.slice(0, history.length - keepTailCount);

  const tailLen = tail.reduce((n, m) => n + String(m.content || "").length, 0);
  let headBudget = Math.max(0, maxChars - tailLen);

  // Summarise older turns; when the budget is exceeded, drop the OLDEST first
  // by walking the head newest→oldest and prepending while the budget allows.
  /** @type {{ role: 'user' | 'assistant', content: string }[]} */
  const summarised = [];
  for (let i = head.length - 1; i >= 0; i--) {
    const m = head[i];
    const summary = clipText(String(m.content || "").trim(), 300);
    if (summary.length + 1 > headBudget) break;
    summarised.unshift({ role: m.role, content: summary });
    headBudget -= summary.length;
  }

  return [...summarised, ...tail];
}

function formatIngestedBlockForDebate(ctx) {
  if (!ctx || ctx._ingestion_error) {
    const reason =
      ctx && ctx._ingestion_error != null ? String(ctx._ingestion_error) : "unknown";
    return `(No ingested evidence — ${reason}. Do not invent match-specific numbers or insider facts.)`;
  }
  const parts = [];
  if (ctx.fetched_at) parts.push(`Fetched: ${ctx.fetched_at}`);
  const src = ctx.sources;
  if (Array.isArray(src) && src.length) {
    const names = src
      .map((s) => (s && typeof s === "object" && s.name != null ? String(s.name) : ""))
      .filter(Boolean);
    if (names.length) parts.push(`Sources: ${names.join(", ")}`);
  }
  if (ctx.pitch_note != null && String(ctx.pitch_note).trim())
    parts.push(`Pitch note: ${clipText(String(ctx.pitch_note).trim(), 600)}`);
  if (ctx.weather_note != null && String(ctx.weather_note).trim())
    parts.push(`Weather note: ${clipText(String(ctx.weather_note).trim(), 600)}`);
  const st = ctx.stats_tables;
  if (st && typeof st === "object" && Object.keys(st).length) {
    try {
      parts.push(`Stats tables:\n${clipText(JSON.stringify(st), 4500)}`);
    } catch {
      parts.push(`Stats tables: ${clipText(String(st), 4500)}`);
    }
  }
  const bullets = normalizeNewsBullets(ctx.news_bullets)
    .slice(0, 24)
    .map((b) => {
      const line = String(b).trim();
      return line.length > 280 ? `${line.slice(0, 279)}…` : line;
    });
  if (bullets.length) {
    parts.push(`News bullets:\n${bullets.map((b, i) => `  ${i + 1}. ${b}`).join("\n")}`);
  }
  if (!parts.length) {
    return "(Evidence bundle empty. Do not invent match-specific numbers or insider facts.)";
  }
  return clipText(parts.join("\n\n"), MAX_INGESTED_DEBATE_CHARS);
}

const SCOUT_RX =
  /\b(form|fitness|injury|injured|recover|bench|playing\s*xi|squad|available|unavailable|ruled\s+out|doubtful|return|comeback|rested)\b/i;
const WEATHER_RX =
  /\b(rain|dew|humid|hot|cold|weather|forecast|thunder|overcast|heat|cool|wind)\b/i;
const PITCH_RX =
  /\b(pitch|wicket|spin|seam|bounce|turn|crack|rough|grass|surface)\b/i;

/**
 * @param {string} agentId
 * @param {Record<string, unknown>} ctx
 * @returns {string}
 */
function buildAgentEvidenceString(agentId, ctx) {
  const bullets = normalizeNewsBullets(ctx.news_bullets);

  if (agentId === "news") {
    if (!bullets.length) return "";
    return clipText(bullets.join("\n"), 6000);
  }

  if (agentId === "stats") {
    const st = ctx.stats_tables;
    if (st && typeof st === "object" && Object.keys(st).length) {
      try {
        return clipText(JSON.stringify(st), 4000);
      } catch {
        return clipText(String(st), 4000);
      }
    }
    return "";
  }

  if (agentId === "weather") {
    const note = ctx.weather_note != null ? String(ctx.weather_note).trim() : "";
    const hit = bullets.filter((b) => WEATHER_RX.test(b));
    const lines = [];
    if (note) lines.push(note);
    if (hit.length) lines.push(...hit);
    return lines.join("\n").trim();
  }

  if (agentId === "pitch") {
    const note = ctx.pitch_note != null ? String(ctx.pitch_note).trim() : "";
    const hit = bullets.filter((b) => PITCH_RX.test(b));
    const lines = [];
    if (note) lines.push(note);
    if (hit.length) lines.push(...hit);
    return lines.join("\n").trim();
  }

  if (agentId === "scout") {
    const hit = bullets.filter((b) => SCOUT_RX.test(b));
    if (hit.length) return clipText(hit.join("\n"), 3500);
    return "";
  }

  if (agentId === "live") {
    const snippet = ctx?.live_score_snippet;
    if (snippet && typeof snippet === "string" && snippet.trim()) return snippet.trim();
    return "";
  }

  return "";
}

/**
 * Evidence for the merged intel LLM. Uses specialist slices from {@link buildAgentEvidenceString};
 * when those are empty but RSS headlines exist, attaches a bounded news excerpt so each role
 * can still emit one grounded sentence (the model must use INTEL_FALLBACK if nothing applies).
 *
 * @param {string} agentId
 * @param {Record<string, unknown>} ctx
 * @returns {string}
 */
function buildMergedIntelEvidence(agentId, ctx) {
  if (agentId === "news") {
    return buildAgentEvidenceString("news", ctx).trim();
  }
  const primary = buildAgentEvidenceString(agentId, ctx).trim();
  if (primary) return primary;
  const news = buildAgentEvidenceString("news", ctx).trim();
  if (!news) return "";
  const roleHint =
    agentId === "scout"
      ? "squad changes, injuries, availability, rest, or named player form"
      : agentId === "stats"
        ? "runs, wickets, overs, required rates, margins, or comparisons explicitly stated"
        : agentId === "weather"
          ? "weather, dew, rain, humidity, heat, wind, or forecast cues"
          : agentId === "pitch"
            ? "pitch, surface, spin, seam, bounce, turn, or wear"
            : "your specialty";
  return (
    `[Ingestion did not isolate lines for this agent only — write at most one short sentence using ONLY facts in the headlines below that clearly relate to: ${roleHint}; if none apply, respond with exactly: ${INTEL_FALLBACK}]\n\n` +
    clipText(news, 1200)
  );
}

/**
 * Try to extract a live score from already-fetched ingested context (from RSS snippets).
 * @param {Record<string, unknown>} ctx
 * @returns {{ text: string } | null}
 */
function extractLiveStateFromCtx(ctx) {
  const snippet = ctx?.live_score_snippet;
  if (snippet && typeof snippet === "string" && snippet.trim()) {
    return { text: snippet.trim() };
  }
  return null;
}

/**
 * Call the server's /api/live-score endpoint (fresh RSS fetch, no cache).
 * @param {string} match
 * @param {{ teamA: string, teamB: string, codeA: string, codeB: string }} teams
 * @returns {Promise<{ snippet: string, hint?: string, unreachable?: boolean }>}
 */
async function fetchLiveScoreDetail(match, teams) {
  const base = apiBase();
  if (!base) return { snippet: "" };
  try {
    const teamsParam = `${teams.codeA},${teams.codeB}`;
    const r = await fetch(
      `${base}/api/live-score?teams=${encodeURIComponent(teamsParam)}&label=${encodeURIComponent(match)}`
    );
    let data = /** @type {Record<string, unknown>} */ ({});
    try {
      data = /** @type {Record<string, unknown>} */ (JSON.parse(await r.text()));
    } catch {
      data = {};
    }
    if (!r.ok) {
      const msg =
        typeof data.message === "string"
          ? data.message
          : typeof data.error === "string"
            ? data.error
            : "";
      return { snippet: "", unreachable: r.status === 503, hint: msg || undefined };
    }
    const sn = typeof data.snippet === "string" ? data.snippet.trim() : "";
    const hint = typeof data.hint === "string" && data.hint.trim() ? data.hint.trim() : undefined;
    return { snippet: sn, hint };
  } catch {
    return { snippet: "" };
  }
}

/**
 * @param {string} match
 * @param {{ teamA: string, teamB: string, codeA: string, codeB: string }} teams
 * @returns {Promise<string>}
 */
async function fetchLiveScore(match, teams) {
  const d = await fetchLiveScoreDetail(match, teams);
  return d.snippet;
}

/**
 * Reads the live panel form fields and builds a compact "ground truth" state string.
 * Returns null when the panel has insufficient data (no runs or overs entered).
 * @returns {{ text: string } | null}
 */
function readLivePanelState() {
  // Priority 1: quick-paste text input (accepts any free-text score)
  const quickText = /** @type {HTMLInputElement|null} */ (document.getElementById("liveScoreInput"))?.value.trim() || "";
  if (quickText) {
    return { text: quickText };
  }

  // Priority 2: structured live panel form fields
  const runsRaw    = /** @type {HTMLInputElement|null} */ (document.getElementById("lfRuns"))?.value.trim() || "";
  const wicketsRaw = /** @type {HTMLInputElement|null} */ (document.getElementById("lfWickets"))?.value.trim() || "";
  const oversRaw   = /** @type {HTMLInputElement|null} */ (document.getElementById("lfOvers"))?.value.trim() || "";
  const targetRaw  = /** @type {HTMLInputElement|null} */ (document.getElementById("lfTarget"))?.value.trim() || "";
  const bat        = /** @type {HTMLInputElement|null} */ (document.getElementById("lfBatTeam"))?.value.trim() || "";
  const bowl       = /** @type {HTMLInputElement|null} */ (document.getElementById("lfBowlTeam"))?.value.trim() || "";
  const inn        = /** @type {HTMLSelectElement|null} */ (document.getElementById("lfInnings"))?.value || "1";
  const fmt        = /** @type {HTMLSelectElement|null} */ (document.getElementById("lfFormat"))?.value || "T20";
  const notes      = /** @type {HTMLInputElement|null} */ (document.getElementById("lfNotes"))?.value.trim() || "";

  if (!runsRaw || !oversRaw) return null;

  const runsNum  = parseInt(runsRaw, 10);
  const wktsNum  = parseInt(wicketsRaw || "0", 10);
  const oversNum = parseFloat(oversRaw);

  if (!Number.isFinite(runsNum) || !Number.isFinite(oversNum)) return null;

  const parts = [];
  const innLabel = inn === "2" ? "2nd innings" : "1st innings";
  const batLabel = bat || "Batting team";
  const bowlLabel = bowl || "Bowling team";
  parts.push(`${fmt} ${innLabel} — ${batLabel} batting, ${bowlLabel} bowling`);
  parts.push(`Score: ${runsNum}/${wktsNum} (${oversNum} overs completed)`);

  if (inn === "2" && targetRaw) {
    const targetNum = parseInt(targetRaw, 10);
    if (Number.isFinite(targetNum) && targetNum > 0) {
      const totalBalls = fmt === "ODI" ? 300 : fmt === "Test" ? null : 120;
      const completedBalls = Math.floor(oversNum) * 6 + Math.round((oversNum % 1) * 10);
      const ballsLeft = totalBalls != null ? totalBalls - completedBalls : null;
      const runsRequired = targetNum - runsNum;
      const rrr = ballsLeft != null && ballsLeft > 0
        ? ((runsRequired / ballsLeft) * 6).toFixed(2) : null;
      const crr = oversNum > 0 ? (runsNum / oversNum).toFixed(2) : null;

      parts.push(`Target: ${targetNum} | Requires: ${runsRequired} runs`);
      if (ballsLeft != null) parts.push(`Balls left: ${ballsLeft}`);
      if (crr) parts.push(`CRR: ${crr}`);
      if (rrr) parts.push(`RRR: ${rrr}`);

      if (rrr != null) {
        const rrrNum = parseFloat(rrr);
        if (rrrNum > 14) parts.push(`Situation: near-impossible chase — ${bowlLabel} overwhelming favourites`);
        else if (rrrNum > 12) parts.push(`Situation: very difficult chase — ${bowlLabel} strong favourites`);
        else if (rrrNum > 10) parts.push(`Situation: tough chase — ${bowlLabel} favourites`);
        else if (rrrNum > 8)  parts.push(`Situation: competitive chase`);
        else                  parts.push(`Situation: ${batLabel} in control of the chase`);
      }
    }
  }

  if (notes) parts.push(`Match notes: ${notes}`);

  return { text: parts.join(" | ") };
}

/**
 * Shared match payload for both debaters — ingested evidence plus specialist lines; evidence-only discipline in system prompts.
 * @param {string} match
 * @param {Record<string, string>} insights
 * @param {{ teamA: string, teamB: string, codeA: string, codeB: string }} teams
 * @param {Record<string, unknown>} ingestedCtx
 * @param {{ text: string } | null} [liveState]
 */
function buildMatchContextBlock(match, insights, teams, ingestedCtx, liveState) {
  const teamLine = `Teams: **${teams.teamA}** vs **${teams.teamB}** (Bull argues for ${teams.teamA}; Bear argues for ${teams.teamB}).\n`;
  const ingested = formatIngestedBlockForDebate(ingestedCtx);
  const lines = AGENTS.map((a) => {
    const raw = insights[a.id]?.trim() || "—";
    return `- ${a.name} (${a.role}): ${clipText(raw, 220)}`;
  }).join("\n");
  const liveBlock = liveState
    ? `\n\n⚡ LIVE IN-GAME STATE (GROUND TRUTH — argue from this reality, not pre-match expectations):\n${enrichLiveStateText(liveState.text)}\n`
    : "";
  return `${teamLine}Fixture: ${match}${liveBlock}\n\nIngested evidence (only treat as factual what appears here):\n${ingested}\n\nSpecialist agent signals:\n${lines}`;
}

/** Bull: team A; Bear: team B; ≤60 words; evidence-bound (keep short — sent every round). */
function debateSystemBull(teams) {
  return `Argue **${teams.teamA}** over **${teams.teamB}** using ONLY the first user message’s ingested evidence + specialist signals. No invented stats. If data is thin, say so in one line. ≤60 words; no preamble.`;
}

function debateSystemBear(teams) {
  return `Argue **${teams.teamB}** over **${teams.teamA}**; counter the last assistant turn using ONLY evidence from the first user message. No invented stats. ≤60 words; no preamble.`;
}

const DEBATE_MAX_TOKENS = 140;

// ─── Live Monitor state ─────────────────────────────────────────────────────
let liveMonitorTimer = null;
let liveMonitorUpdateCount = 0;
const LIVE_MONITOR_MAX_UPDATES = 8;
let _lastLiveSnippet = "";
let _liveMonitorActive = false;

/**
 * Starts the background live-score polling loop.
 * @param {string} match
 * @param {{ teamA: string, teamB: string, codeA: string, codeB: string }} teams
 * @param {string} initialSnippet
 */
function startLiveMonitor(match, teams, initialSnippet) {
  stopLiveMonitor();
  _lastLiveSnippet = initialSnippet || "";
  liveMonitorUpdateCount = 0;
  _liveMonitorActive = true;
  const dot = document.getElementById("dot-live");
  if (dot) dot.classList.add("live");
  liveMonitorTimer = setInterval(async () => {
    if (!_liveMonitorActive) { stopLiveMonitor(); return; }
    if (liveMonitorUpdateCount >= LIVE_MONITOR_MAX_UPDATES) { stopLiveMonitor(); return; }
    await runLiveMonitorCycle(match, teams);
  }, 45_000);
}

function stopLiveMonitor() {
  if (liveMonitorTimer) {
    clearInterval(liveMonitorTimer);
    liveMonitorTimer = null;
  }
  _liveMonitorActive = false;
  const dot = document.getElementById("dot-live");
  if (dot) dot.classList.remove("live");
}

/**
 * One poll cycle: fetch new score, update agent row, call LLM for revised prediction.
 * @param {string} match
 * @param {{ teamA: string, teamB: string, codeA: string, codeB: string }} teams
 */
async function runLiveMonitorCycle(match, teams) {
  const snippet = await fetchLiveScore(match, teams);
  if (!snippet || snippet === _lastLiveSnippet) return;
  _lastLiveSnippet = snippet;

  // Update live agent insight row
  const insightEl = document.getElementById("insight-live");
  if (insightEl) {
    insightEl.textContent = snippet.slice(0, 200);
    insightEl.classList.add("show");
  }

  // Auto-populate live score bar if user hasn't typed anything
  const liveInput = /** @type {HTMLInputElement|null} */ (document.getElementById("liveScoreInput"));
  const liveClear = document.getElementById("liveScoreClear");
  if (liveInput && !liveInput.value.trim()) {
    liveInput.value = snippet;
    if (liveClear) liveClear.hidden = false;
  }

  // Only update verdict if one is already rendered
  const verdictEl = document.getElementById("verdictArea");
  if (!verdictEl || !verdictEl.innerHTML.trim()) return;

  liveMonitorUpdateCount++;
  await updateLivePrediction(match, teams, snippet);
}

/**
 * Ask the LLM for a revised win probability given the current live score.
 * @param {string} match
 * @param {{ teamA: string, teamB: string, codeA: string, codeB: string }} teams
 * @param {string} liveSnippet
 */
async function updateLivePrediction(match, teams, liveSnippet) {
  try {
    const prompt =
      `Match: "${match}"\n` +
      `Teams: ${teams.teamA} (Team A) vs ${teams.teamB} (Team B)\n` +
      `Current live state: ${liveSnippet}\n\n` +
      `Based solely on this in-game situation, estimate updated win probabilities.\n` +
      `Return ONLY this JSON (no markdown, no extra keys):\n` +
      `{"team_a_win_pct":<integer 0-100>,"team_b_win_pct":<integer 0-100>,"reasoning":"<≤20 words>","situation_label":"<e.g. Team A dominant / Tight contest / Team B on top>"}`;
    const raw = await callClaude(
      [{ role: "user", content: prompt }],
      "You are a live cricket probability estimator. Given the current match state, return only valid JSON with updated win percentages.",
      120,
      "live"
    );
    let parsed;
    try {
      parsed = JSON.parse(extractJudgeJsonObject(raw));
    } catch { return; }
    appendLiveUpdate(liveSnippet, parsed, teams);
  } catch { /* silently fail — never crash the UI */ }
}

/**
 * Prepend a live-update card to #liveUpdatesArea.
 * @param {string} liveSnippet
 * @param {{ team_a_win_pct?: unknown, team_b_win_pct?: unknown, reasoning?: unknown, situation_label?: unknown }} prediction
 * @param {{ teamA: string, teamB: string }} teams
 */
function appendLiveUpdate(liveSnippet, prediction, teams) {
  const container = document.getElementById("liveUpdatesArea");
  if (!container) return;
  container.hidden = false;

  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const teamAPct = Math.min(100, Math.max(0, Number(prediction.team_a_win_pct) || 50));
  const teamBPct = Math.min(100, Math.max(0, Number(prediction.team_b_win_pct) || (100 - teamAPct)));
  const reasoning = String(prediction.reasoning || "").trim();
  const situationLabel = String(prediction.situation_label || "").trim();

  const card = document.createElement("div");
  card.className = "live-update-card";
  card.setAttribute("role", "status");
  card.innerHTML = `
    <div class="live-update-card__header">
      <span class="live-dot" aria-hidden="true"></span>
      <span class="live-update-card__label">Live update</span>
      <span class="live-update-card__time">${escapeHtml(time)}</span>
      ${situationLabel ? `<span class="live-update-card__situation">${escapeHtml(situationLabel)}</span>` : ""}
    </div>
    <div class="live-update-card__score">${escapeHtml(liveSnippet.slice(0, 280))}</div>
    <div class="live-update-card__prob">
      <div class="live-update-card__team-row">
        <span class="live-update-card__team-name">${escapeHtml(teams.teamA)}</span>
        <span class="live-update-card__team-pct">${teamAPct}%</span>
      </div>
      <div class="live-update-card__bar">
        <div class="live-update-card__bar-fill live-update-card__bar-fill--a" style="width:${teamAPct}%"></div>
        <div class="live-update-card__bar-fill live-update-card__bar-fill--b" style="width:${teamBPct}%"></div>
      </div>
      <div class="live-update-card__team-row">
        <span class="live-update-card__team-name">${escapeHtml(teams.teamB)}</span>
        <span class="live-update-card__team-pct">${teamBPct}%</span>
      </div>
    </div>
    ${reasoning ? `<div class="live-update-card__reasoning">${escapeHtml(reasoning)}</div>` : ""}
  `;
  const firstCard = container.querySelector(".live-update-card");
  if (firstCard) container.insertBefore(card, firstCard);
  else container.appendChild(card);
}

async function runWarRoom() {
  if (running) return;
  running = true;
  clearIntelRefreshSession();
  document.getElementById("main-content")?.classList.remove("dashboard--pre-war-room");
  const match =
    (document.getElementById('matchInput').value || MATCH_SUGGESTIONS_FALLBACK_ROWS[0].label).trim();

  const completedRow = await lookupCompletedMatchRow(match);
  if (completedRow && completedRow.result && String(completedRow.result.winner || "").trim()) {
    try {
      const teams = parseTeamsFromMatch(match);
      const winCode = String(completedRow.result.winner).trim();
      const winDisplay = resolveWinnerDisplay(teams, winCode);

      AGENTS.forEach((a) => {
        removeAgentSkeleton(a.id);
        document.getElementById("icon-" + a.id).classList.remove("on");
        document.getElementById("dot-" + a.id).classList.remove("live");
        const ins = document.getElementById("insight-" + a.id);
        ins.textContent = "";
        ins.classList.remove("show");
      });
      clearIntelRefreshSession();

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
      const winProbFinal = renderVerdictWinProbabilityBlock(teams, pickedA ? 100 : 0, {
        variant: "final",
      });
      const verdictEl = document.getElementById('verdictArea');
      verdictEl.innerHTML = `
    <div class="verdict-card verdict-card--final">
      <div class="verdict-kicker">Final result</div>
      <div class="verdict-winner-row">${verdictLogoHtml}<div class="verdict-winner">${escapeHtml(winDisplay.toUpperCase())} WINS</div></div>
      <div class="verdict-summary">${escapeHtml(completedRow.result.summary || '')}</div>
      ${winProbFinal.html}
    </div>`;
      scheduleVerdictWinProbabilityAnimation(verdictEl, winProbFinal.pctA, winProbFinal.pctB);

      scrollVerdictPanelIntoView({ behavior: "smooth" });
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

  // Fetch ingested context first so we can auto-extract live score from RSS if not manually entered
  const ingestedCtx = await fetchMatchContextFromServer(match, teams);
  intelRefreshSession = { match, teams, ingestedCtx };

  // Resolve live state: manual quick-input > RSS-extracted snippet > structured live panel
  let liveState = readLivePanelState();
  if (!liveState) {
    const ctxSnippet = extractLiveStateFromCtx(ingestedCtx);
    if (ctxSnippet) {
      liveState = ctxSnippet;
      // Auto-populate the quick-input so the user can see what was detected
      const liveInput = /** @type {HTMLInputElement|null} */ (document.getElementById("liveScoreInput"));
      const liveClear = document.getElementById("liveScoreClear");
      if (liveInput && !liveInput.value.trim()) {
        liveInput.value = ctxSnippet.text;
        if (liveClear) liveClear.hidden = false;
      }
    }
  }

  // Additional fallback: hit /api/live-score directly (a fresh RSS scrape, no ingestion cache)
  if (!liveState) {
    try {
      const directSnippet = await fetchLiveScore(match, teams);
      if (directSnippet) {
        liveState = { text: directSnippet };
        const liveInput = /** @type {HTMLInputElement|null} */ (document.getElementById("liveScoreInput"));
        const liveClear = document.getElementById("liveScoreClear");
        if (liveInput && !liveInput.value.trim()) {
          liveInput.value = directSnippet;
          if (liveClear) liveClear.hidden = false;
        }
      }
    } catch { /* best-effort */ }
  }

  // Show a warning banner when no live data is available so the user can paste it manually
  showNoLiveDataWarning(!liveState);

  const insights = {};
  /** @type {Record<string, string>} agent.id (excluding live) -> trimmed/clipped evidence string */
  const evidenceByAgent = {};

  for (const agent of AGENTS) {
    await sleep(550);
    removeAgentSkeleton(agent.id);
    document.getElementById('icon-'+agent.id).classList.add('on');
    document.getElementById('dot-'+agent.id).classList.add('live');

    // Live Monitor: set insight directly from live state — no LLM call needed
    if (agent.id === "live") {
      const liveText = liveState?.text
        || (ingestedCtx?.live_score_snippet ? String(ingestedCtx.live_score_snippet).trim() : "");
      const el = document.getElementById('insight-live');
      const displayText = liveText
        ? liveText.slice(0, 200)
        : "No live score detected — will poll every 45 s once match starts.";
      el.textContent = displayText;
      el.classList.add('show');
      insights[agent.id] = liveText || "No live score available pre-match.";
      continue;
    }

    const evidenceBlock = clipText(
      buildMergedIntelEvidence(agent.id, ingestedCtx).trim(),
      MAX_EVIDENCE_CHARS_PER_AGENT
    );
    evidenceByAgent[agent.id] = evidenceBlock;

    if (!evidenceBlock) {
      const el = document.getElementById('insight-' + agent.id);
      el.textContent = INTEL_FALLBACK;
      el.classList.add('show');
      insights[agent.id] = INTEL_FALLBACK;
      syncIntelRefreshButtonForAgent(agent.id);
    }
  }

  // Single merged intel call: one LLM round-trip returns one sentence per specialty.
  // Skip entirely if every non-live agent had empty evidence (already filled with INTEL_FALLBACK above).
  const intelAgents = AGENTS.filter((a) => a.id !== "live");
  const agentsNeedingLLM = intelAgents.filter((a) => evidenceByAgent[a.id]);

  if (agentsNeedingLLM.length) {
    const sections = agentsNeedingLLM
      .map((a) => `### ${a.id} — ${a.role}\n${evidenceByAgent[a.id] || "(no evidence)"}`)
      .join("\n\n");

    const userContent =
      `Match: "${match}". Contest: ${teams.teamA} vs ${teams.teamB}.\n\n` +
      `Evidence sections (use ONLY facts in each section; do not cross-reference):\n\n${sections}\n\n` +
      `Respond with ONLY the JSON object described in your instructions.`;

    let parsedIntel = null;
    try {
      const merged = await callClaude(
        [{ role: "user", content: userContent }],
        MERGED_INTEL_SYSTEM,
        220,
        "intel"
      );
      try {
        parsedIntel = JSON.parse(extractJudgeJsonObject(merged));
      } catch {
        parsedIntel = null;
      }
    } catch (err) {
      // Surface the API error on each tile that was awaiting an LLM result.
      const msg = '— ' + (err instanceof Error ? err.message : 'API error');
      for (const a of agentsNeedingLLM) {
        const el = document.getElementById('insight-' + a.id);
        if (el) {
          el.textContent = msg;
          el.classList.add('show');
        }
        insights[a.id] = '';
      }
      parsedIntel = undefined; // sentinel so we skip the per-agent fan-out below
    }

    if (parsedIntel !== undefined) {
      for (const a of agentsNeedingLLM) {
        const raw = parsedIntel && typeof parsedIntel === "object" ? parsedIntel[a.id] : null;
        const text = (raw != null ? String(raw) : "").trim() || INTEL_FALLBACK;
        const el = document.getElementById('insight-' + a.id);
        if (el) {
          el.textContent = text;
          el.classList.add('show');
        }
        insights[a.id] = text;
      }
    }
    syncAllIntelRefreshButtons();
  }

  try {
    const matchContext = buildMatchContextBlock(match, insights, teams, ingestedCtx, liveState);
    setPhase('Debate in progress…', true);
    document.getElementById('runningLabel').textContent = `${teams.codeA} vs ${teams.codeB} · debate`;
    scrollDebatePanelIntoView({ behavior: "smooth", block: "start" });

    const debateLog = [];
    const rounds = [
      {
        side: 'bull',
        who: `Bull · ${teams.teamA}`,
        teamCode: teams.codeA,
        roundLabel: 'Round 1 · Opening',
        userContent:
          `${matchContext}\n\n---\nOpen the debate: argue why **${teams.teamA}** wins this fixture using ONLY the ingested evidence and specialist signals above—no outside facts or invented stats. If evidence is weak, say so briefly. Max 60 words.`,
      },
      {
        side: 'bear',
        who: `Bear · ${teams.teamB}`,
        teamCode: teams.codeB,
        roundLabel: 'Round 1 · Counter',
        userContent: `Counter the Bull directly: argue why **${teams.teamB}** wins using ONLY the ingested evidence and specialist signals from the first message—different angles allowed only when supported there. Max 60 words.`,
      },
      {
        side: 'bull',
        who: `Bull · ${teams.teamA}`,
        teamCode: teams.codeA,
        roundLabel: 'Round 2 · Rebuttal',
        userContent: `Rebut the Bear. Strengthen **${teams.teamA}**’s case with one angle grounded only in that same evidence bundle; if you cannot, concede thin data. Max 60 words.`,
      },
      {
        side: 'bear',
        who: `Bear · ${teams.teamB}`,
        teamCode: teams.codeB,
        roundLabel: 'Round 2 · Final',
        userContent: `Final round: your strongest line for **${teams.teamB}**—still countering the Bull’s last point—using only the ingested evidence and specialist signals. Max 60 words.`,
      },
    ];

    /** Full transcript as Anthropic messages: every prior user + assistant turn is included in each call. */
    const history = [];
    for (const rd of rounds) {
      showTyping(rd.side);
      await sleep(500);
      const system = rd.side === 'bull' ? debateSystemBull(teams) : debateSystemBear(teams);
      const trimmedHistory = clipDebateHistory(history, MAX_DEBATE_HISTORY_CHARS);
      const messages = [...trimmedHistory, { role: 'user', content: rd.userContent }];
      const text = await callClaude(messages, system, DEBATE_MAX_TOKENS, "debate");
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

    const vDiv = document.getElementById('verdictArea');
    const judgePr = await postJudgePredict(match, debateStr);
    hideTyping();

    if (judgePr.ok) {
      const v = normalizeVerdictPartial(judgePr.verdict, teams);
      mountJudgeVerdictCard(vDiv, v, teams, {
        source: 'service',
        predictionId: judgePr.prediction_id,
        ingestionCtx: ingestedCtx,
      });
      if (judgePr.accuracy && typeof judgePr.accuracy === 'object') {
        updateJudgeAccuracyFooterFromStats({
          total_settled: Number(judgePr.accuracy.total_settled) || 0,
          correct: Number(judgePr.accuracy.correct) || 0,
          accuracy:
            judgePr.accuracy.accuracy != null && Number.isFinite(Number(judgePr.accuracy.accuracy))
              ? Number(judgePr.accuracy.accuracy)
              : null,
        });
      } else {
        void refreshJudgeAccuracyFooter();
      }
    } else {
      showTyping('bull');
      await sleep(400);
      const judgeReply = await callClaude(
        [
          {
            role: 'user',
            content: `Match: "${match}"\nTeams: ${teams.teamA} vs ${teams.teamB}${liveState ? `\n\nLIVE IN-GAME STATE (ground truth — overrides everything):\n${enrichLiveStateText(liveState.text)}` : ""}\n\nDebate transcript:\n${clipText(debateStr, 12000)}\n\nRespond with ONLY the JSON object described in your instructions.`,
          },
        ],
        buildBrowserJudgeSystemPrompt(teams, match, liveState),
        520,
        "judge"
      );
      hideTyping();
      let parsed;
      try {
        parsed = JSON.parse(extractJudgeJsonObject(judgeReply));
      } catch {
        parsed = null;
      }
      const v = normalizeVerdictPartial(
        parsed ?? {
          winner: teams.teamB,
          confidence: 61,
          score_range: '168–182',
          key_player: 'Top-order batter in form',
          swing_factor: 'Toss & dew',
          summary: `Close contest — ${teams.teamB} hold the edge on current conditions.`,
        },
        teams
      );
      const judgeApiNote =
        judgePr.status === 429
          ? "Judge API was rate-limited after automatic retries — verdict below is from the browser judge."
          : judgePr.status > 0
            ? `Judge API was unavailable (${humanReadableHttpFailureMessage(judgePr.status)}) — verdict below is from the browser judge.`
            : undefined;
      mountJudgeVerdictCard(vDiv, v, teams, {
        source: 'browser',
        ingestionCtx: ingestedCtx,
        judgeApiNote,
      });
    }

    scrollVerdictPanelIntoView({ behavior: "smooth" });
    setPhase(null);
    document.getElementById('runningLabel').style.display = 'none';

    // Kick off the Live Monitor polling loop — polls every 45 s for score changes
    startLiveMonitor(match, teams, liveState?.text || "");
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
  stopLiveMonitor();
  showNoLiveDataWarning(false);
  const liveUpdates = document.getElementById("liveUpdatesArea");
  if (liveUpdates) { liveUpdates.innerHTML = ""; liveUpdates.hidden = true; }
  document.getElementById('debateArea')?.classList.remove('debate-area--final-only');
  document.getElementById('debateArea').innerHTML = `
    <div class="empty-state" id="emptyState">
      <div class="empty-state__icon" aria-hidden="true"></div>
      <p class="empty-state__title">Ready</p>
      <p class="empty-state__desc">Pick a fixture above, then <strong>Run war room</strong> for intel, debate, and verdict.</p>
    </div>`;
  document.getElementById('verdictArea').innerHTML='';
  document.getElementById('typingBubble').style.display='none';
  hideMatchBar();
  AGENTS.forEach(a => {
    document.getElementById('icon-'+a.id).classList.remove('on');
    document.getElementById('dot-'+a.id).classList.remove('live');
    const row = document.getElementById('row-'+a.id);
    if (row) row.classList.add('agent-row--skeleton');
    const ins = document.getElementById('insight-'+a.id);
    ins.textContent=''; ins.classList.remove('show');
  });
  clearIntelRefreshSession();
  setPhase(null);
  document.getElementById('runBtn').style.display='';
  document.getElementById('resetBtn').style.display='none';
  document.getElementById('runningLabel').style.display='none';
  document.getElementById("main-content")?.classList.add("dashboard--pre-war-room");
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
        if (hit.completed && hit.result) runWarRoom();
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
      const selectedHit = filteredHits[activeIndex];
      input.value = selectedHit.label;
      closeList();
      updateClearBtn();
      if (selectedHit.completed && selectedHit.result) runWarRoom();
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

function initAgentsToggle() {
  const btn = document.getElementById('agentsToggle');
  const col = btn?.closest('.dash-col--agents');
  if (!btn || !col) return;

  function setExpanded(open) {
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    col.classList.toggle('agents-collapsed', !open);
  }

  btn.addEventListener('click', () => {
    const isExpanded = btn.getAttribute('aria-expanded') === 'true';
    setExpanded(!isExpanded);
  });

  const mq = window.matchMedia('(max-width: 760px)');
  function onMq(e) {
    if (!e.matches) {
      setExpanded(true);
      col.classList.remove('agents-collapsed');
    }
  }
  mq.addEventListener('change', onMq);
}

// ─── Live match: over-by-over prediction ───────────────────────────────────

/**
 * @typedef {{
 *   over: number,
 *   projected_runs: number,
 *   wicket_risk: "low"|"medium"|"high",
 *   wicket_probability: number,
 *   key_event: string,
 *   win_probability: number|null
 * }} OverPrediction
 *
 * @typedef {{
 *   summary: string,
 *   projected_total: string,
 *   win_probability: number|null,
 *   overs: OverPrediction[]
 * }} OverPredictionResult
 */

/** @returns {string} */
function buildOverPredictionPrompt() {
  const bat   = (document.getElementById("lfBatTeam").value || "").trim() || "Batting team";
  const bowl  = (document.getElementById("lfBowlTeam").value || "").trim() || "Bowling team";
  const fmt   = document.getElementById("lfFormat").value || "T20";
  const inn   = document.getElementById("lfInnings").value || "1";
  const runs  = (document.getElementById("lfRuns").value || "").trim();
  const wkts  = (document.getElementById("lfWickets").value || "").trim();
  const overs = (document.getElementById("lfOvers").value || "").trim();
  const target= (document.getElementById("lfTarget").value || "").trim();
  const venue = (document.getElementById("lfVenue").value || "").trim();
  const notes = (document.getElementById("lfNotes").value || "").trim();

  const totalOvers = fmt === "T20" ? 20 : fmt === "ODI" ? 50 : 90;
  const oversNum   = parseFloat(overs) || 0;
  const oversCompletedFull = Math.floor(oversNum);
  const remaining  = Math.max(0, totalOvers - oversCompletedFull);

  const matchInput = (document.getElementById("matchInput")?.value || "").trim();
  const matchLine  = matchInput ? `Fixture: ${matchInput}\n` : "";
  const targetLine = inn === "2" && target ? `Target: ${target} runs (${bat} is chasing).\n` : "";
  const venueLine  = venue ? `Venue: ${venue}.\n` : "";
  const notesLine  = notes ? `Additional situation: ${notes}.\n` : "";

  return (
    `${matchLine}Format: ${fmt} — ${inn === "1" ? "1st" : "2nd"} innings.\n` +
    `${bat} batting vs ${bowl}.\n` +
    `Current score: ${runs || "?"}/${wkts || "?"} after ${overs || "?"} overs.\n` +
    `${targetLine}${venueLine}${notesLine}` +
    `Remaining overs to predict: ${remaining} (overs ${oversCompletedFull + 1} to ${totalOvers}).\n\n` +
    `Predict every remaining over. Return ONLY a JSON object with this exact shape:\n` +
    `{\n` +
    `  "summary": "2-3 sentences on match situation and innings trajectory",\n` +
    `  "projected_total": "e.g. 168-182 or \\"Wins with 2 overs to spare\\"",\n` +
    `  "win_probability": <integer 0-100 for ${bat} at current moment, or null if 1st innings>,\n` +
    `  "overs": [\n` +
    `    { "over": <number>, "projected_runs": <integer>, "wicket_risk": "low"|"medium"|"high", "wicket_probability": <integer 0-100, chance a wicket falls IN this over>, "key_event": "<≤10 words>", "win_probability": <integer 0-100 for ${bat} AFTER this over completes, or null if 1st innings> },\n` +
    `    ...\n` +
    `  ]\n` +
    `}\n` +
    `Rules:\n` +
    `- One entry per remaining over.\n` +
    `- wicket_risk "high" only for genuine danger overs.\n` +
    `- wicket_probability: realistic per-over chance (0-100) of AT LEAST ONE wicket in that over. T20 avg ~17%, powerplay ~12%, death ~22%. High-risk spinners/swing overs can be 30-45%.\n` +
    `- key_event must be ≤10 words and specific (e.g. "Spinner likely; consolidation expected", "Death over — 6s likely").\n` +
    `- win_probability per over: show how ${bat}'s chances EVOLVE over by over — it should drift naturally as runs accumulate or wickets fall. For 1st innings use null.\n` +
    `- No markdown fences, no extra keys.`
  );
}

const OVER_PREDICT_SYSTEM =
  "You are an expert cricket analyst with deep knowledge of T20, ODI, and Test match dynamics. " +
  "Given the current live match state, you predict how each remaining over will unfold based on " +
  "typical run rates, wicket fall patterns, phase-of-innings dynamics, and common match scenarios. " +
  "Be realistic and phase-aware (powerplay / middle / death). Output ONLY valid JSON — no preamble, no fences.";

/** @param {string} risk */
function riskClass(risk) {
  if (risk === "high")   return "over-card--high-risk";
  if (risk === "medium") return "over-card--medium-risk";
  return "";
}

/** @param {string} risk */
function riskLabel(risk) {
  if (risk === "high")   return '<span class="over-card__risk over-card__risk--high">⚠ High</span>';
  if (risk === "medium") return '<span class="over-card__risk over-card__risk--medium">~ Medium</span>';
  return '<span class="over-card__risk over-card__risk--low">✓ Low</span>';
}

/** Win sparkline stroke / fill: classic blue vs war-room green */
function winSparkAccentHex() {
  const ui = document.documentElement.getAttribute("data-ui");
  if (ui === "classic") return "#8ab4f8";
  if (ui === "ipl") return "#d4af37";
  return "#00e87a";
}

/**
 * Build an SVG sparkline for win-probability trend across overs.
 * @param {OverPrediction[]} overs
 * @param {number|null} startProb  current win prob before any new over
 * @param {string} bat
 * @param {string} bowl
 * @returns {string} HTML string
 */
function buildWinProbSparkline(overs, startProb, bat, bowl) {
  const accent = winSparkAccentHex();
  const points = overs
    .map((o) => (o.win_probability != null ? Number(o.win_probability) : null))
    .filter((p) => p !== null);

  if (!points.length) return "";

  const allPts = startProb != null ? [startProb, ...points] : points;
  const W = 500, H = 80, PAD_L = 36, PAD_R = 12, PAD_T = 10, PAD_B = 24;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const xStep = allPts.length > 1 ? chartW / (allPts.length - 1) : chartW;
  const toX = (i) => PAD_L + i * xStep;
  const toY = (p) => PAD_T + chartH - (p / 100) * chartH;

  // Filled area path
  const linePoints = allPts.map((p, i) => `${toX(i).toFixed(1)},${toY(p).toFixed(1)}`).join(" L ");
  const areaPath =
    `M ${toX(0).toFixed(1)},${toY(allPts[0]).toFixed(1)} L ${linePoints} ` +
    `L ${toX(allPts.length - 1).toFixed(1)},${(PAD_T + chartH).toFixed(1)} ` +
    `L ${toX(0).toFixed(1)},${(PAD_T + chartH).toFixed(1)} Z`;

  // 50% reference line
  const refY = toY(50).toFixed(1);

  // Y-axis labels
  const yLabels = [0, 25, 50, 75, 100].map((pct) => {
    const y = toY(pct).toFixed(1);
    return `<text x="${(PAD_L - 4).toFixed(1)}" y="${y}" text-anchor="end" dominant-baseline="middle" class="spark-label">${pct}</text>`;
  }).join("");

  // X-axis labels (show over numbers, sparse)
  const overNums = overs.map((o) => o.over);
  const xLabels = allPts.map((_, i) => {
    if (i === 0 && startProb != null) return `<text x="${toX(0).toFixed(1)}" y="${(PAD_T + chartH + 13).toFixed(1)}" text-anchor="middle" class="spark-label">Now</text>`;
    const overIdx = startProb != null ? i - 1 : i;
    const overNum = overNums[overIdx];
    if (overNum == null) return "";
    const step = Math.max(1, Math.floor(allPts.length / 6));
    if (i % step !== 0 && i !== allPts.length - 1) return "";
    return `<text x="${toX(i).toFixed(1)}" y="${(PAD_T + chartH + 13).toFixed(1)}" text-anchor="middle" class="spark-label">Ov ${overNum}</text>`;
  }).join("");

  // Last point circle + label
  const lastX = toX(allPts.length - 1).toFixed(1);
  const lastY = toY(allPts[allPts.length - 1]).toFixed(1);
  const lastPct = allPts[allPts.length - 1];

  return `
    <div class="win-trend">
      <div class="win-trend__head">
        <span class="win-trend__title">Win % trajectory — ${escapeHtml(bat)} <span class="win-trend__vs">vs ${escapeHtml(bowl)}</span></span>
        <span class="win-trend__now">Final: <strong>${lastPct}%</strong></span>
      </div>
      <svg class="win-trend__svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="wpGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${accent}" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="${accent}" stop-opacity="0.03"/>
          </linearGradient>
        </defs>
        <!-- 50% reference line -->
        <line x1="${PAD_L}" y1="${refY}" x2="${(W - PAD_R).toFixed(1)}" y2="${refY}" stroke="rgba(255,255,255,0.09)" stroke-width="1" stroke-dasharray="4 4"/>
        <text x="${(PAD_L + 4).toFixed(1)}" y="${(Number(refY) - 3).toFixed(1)}" class="spark-label spark-label--ref">50%</text>
        <!-- Area fill -->
        <path d="${areaPath}" fill="url(#wpGrad)"/>
        <!-- Line -->
        <polyline points="${allPts.map((p, i) => `${toX(i).toFixed(1)},${toY(p).toFixed(1)}`).join(" ")}" fill="none" stroke="${accent}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
        <!-- Y-axis labels -->
        ${yLabels}
        <!-- X-axis labels -->
        ${xLabels}
        <!-- End point -->
        <circle cx="${lastX}" cy="${lastY}" r="3.5" fill="${accent}"/>
        <text x="${(Number(lastX) + 5).toFixed(1)}" y="${(Number(lastY) + 1).toFixed(1)}" dominant-baseline="middle" class="spark-label spark-label--end">${lastPct}%</text>
      </svg>
    </div>`;
}

/**
 * Build an SVG sparkline for wicket-probability across overs.
 * @param {OverPrediction[]} overs
 * @returns {string} HTML string
 */
function buildWicketProbSparkline(overs) {
  const pts = overs
    .map((o) => (o.wicket_probability != null ? Math.min(100, Math.max(0, Number(o.wicket_probability))) : null))
    .filter((p) => p !== null);

  if (!pts.length) return "";

  const W = 500, H = 72, PAD_L = 36, PAD_R = 12, PAD_T = 8, PAD_B = 22;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  // Use 0–60 as the y-axis ceiling (most values will be 5–45)
  const Y_MAX = 60;
  const toX = (i) => PAD_L + (pts.length > 1 ? (i / (pts.length - 1)) * chartW : chartW / 2);
  const toY = (p) => PAD_T + chartH - Math.min(1, p / Y_MAX) * chartH;

  const areaPath =
    `M ${toX(0).toFixed(1)},${toY(pts[0]).toFixed(1)} ` +
    pts.map((p, i) => `L ${toX(i).toFixed(1)},${toY(p).toFixed(1)}`).join(" ") +
    ` L ${toX(pts.length - 1).toFixed(1)},${(PAD_T + chartH).toFixed(1)} L ${toX(0).toFixed(1)},${(PAD_T + chartH).toFixed(1)} Z`;

  const avgRef = Math.round(pts.reduce((s, p) => s + p, 0) / pts.length);
  const refY   = toY(avgRef).toFixed(1);

  const yLabels = [0, 20, 40, Y_MAX].map((pct) => {
    const y = toY(pct).toFixed(1);
    return `<text x="${(PAD_L - 4).toFixed(1)}" y="${y}" text-anchor="end" dominant-baseline="middle" class="spark-label">${pct}</text>`;
  }).join("");

  const overNums = overs.map((o) => o.over);
  const xLabels = pts.map((_, i) => {
    const overNum = overNums[i];
    if (overNum == null) return "";
    const step = Math.max(1, Math.floor(pts.length / 6));
    if (i % step !== 0 && i !== pts.length - 1) return "";
    return `<text x="${toX(i).toFixed(1)}" y="${(PAD_T + chartH + 13).toFixed(1)}" text-anchor="middle" class="spark-label">Ov ${overNum}</text>`;
  }).join("");

  // Mark high-risk overs (>30%)
  const dangerDots = pts
    .map((p, i) => p > 30
      ? `<circle cx="${toX(i).toFixed(1)}" cy="${toY(p).toFixed(1)}" r="3" fill="#f28b82" opacity="0.85"/>`
      : "")
    .join("");

  const lastX = toX(pts.length - 1).toFixed(1);
  const lastY = toY(pts[pts.length - 1]).toFixed(1);
  const lastPct = pts[pts.length - 1];
  const maxPct  = Math.max(...pts);

  return `
    <div class="wicket-trend">
      <div class="win-trend__head">
        <span class="win-trend__title wicket-trend__title">Wicket fall probability % <span class="win-trend__vs">per over</span></span>
        <span class="win-trend__now">Avg <strong>${avgRef}%</strong> · Peak <strong class="wicket-trend__peak">${maxPct}%</strong></span>
      </div>
      <svg class="win-trend__svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="wkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f28b82" stop-opacity="0.38"/>
            <stop offset="100%" stop-color="#f28b82" stop-opacity="0.03"/>
          </linearGradient>
        </defs>
        <!-- average reference line -->
        <line x1="${PAD_L}" y1="${refY}" x2="${(W - PAD_R).toFixed(1)}" y2="${refY}" stroke="rgba(255,255,255,0.09)" stroke-width="1" stroke-dasharray="4 4"/>
        <text x="${(PAD_L + 4).toFixed(1)}" y="${(Number(refY) - 3).toFixed(1)}" class="spark-label spark-label--ref">avg</text>
        <!-- Area fill -->
        <path d="${areaPath}" fill="url(#wkGrad)"/>
        <!-- Line -->
        <polyline points="${pts.map((p, i) => `${toX(i).toFixed(1)},${toY(p).toFixed(1)}`).join(" ")}" fill="none" stroke="#f28b82" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
        <!-- High-risk dots -->
        ${dangerDots}
        <!-- Y-axis labels -->
        ${yLabels}
        <!-- X-axis labels -->
        ${xLabels}
        <!-- End point -->
        <circle cx="${lastX}" cy="${lastY}" r="3" fill="#f28b82"/>
        <text x="${(Number(lastX) + 5).toFixed(1)}" y="${(Number(lastY) + 1).toFixed(1)}" dominant-baseline="middle" class="spark-label spark-label--wk-end">${lastPct}%</text>
      </svg>
    </div>`;
}

/**
 * @param {HTMLElement} container
 * @param {OverPredictionResult} result
 * @param {{ bat: string, bowl: string, fmt: string, inn: string }} ctx
 */
function renderOverPredictionResult(container, result, ctx) {
  const winProb = result.win_probability != null && Number.isFinite(Number(result.win_probability))
    ? Number(result.win_probability)
    : null;
  const winProbCell = winProb !== null
    ? `<div class="over-predict-summary__cell">
        <div class="over-predict-summary__label">Win prob now (${escapeHtml(ctx.bat)})</div>
        <div class="over-predict-summary__val">${winProb}%</div>
       </div>`
    : "";

  const totalRuns = (result.overs || []).reduce((s, o) => s + (Number(o.projected_runs) || 0), 0);

  // Wicket probability stats
  const wkPts = (result.overs || [])
    .map((o) => (o.wicket_probability != null ? Number(o.wicket_probability) : null))
    .filter((p) => p !== null);
  const avgWkPct = wkPts.length ? Math.round(wkPts.reduce((s, p) => s + p, 0) / wkPts.length) : null;
  const wkSummaryCell = avgWkPct !== null
    ? `<div class="over-predict-summary__cell">
        <div class="over-predict-summary__label">Avg wicket% / over</div>
        <div class="over-predict-summary__val over-predict-summary__val--danger">${avgWkPct}%</div>
       </div>`
    : "";

  // Build sparklines
  const hasWinProbData = (result.overs || []).some((o) => o.win_probability != null);
  const sparklineHtml = hasWinProbData
    ? buildWinProbSparkline(result.overs || [], winProb, ctx.bat, ctx.bowl)
    : "";
  const wicketSparkHtml = wkPts.length
    ? buildWicketProbSparkline(result.overs || [])
    : "";

  container.innerHTML = `
    <div class="over-predict-summary">
      <div class="over-predict-summary__cell">
        <div class="over-predict-summary__label">Projected score</div>
        <div class="over-predict-summary__val">${escapeHtml(String(result.projected_total || "—"))}</div>
      </div>
      <div class="over-predict-summary__cell">
        <div class="over-predict-summary__label">Runs remaining (est.)</div>
        <div class="over-predict-summary__val">+${totalRuns}</div>
      </div>
      ${winProbCell}
      <div class="over-predict-summary__cell">
        <div class="over-predict-summary__label">Overs predicted</div>
        <div class="over-predict-summary__val">${(result.overs || []).length}</div>
      </div>
      ${wkSummaryCell}
      ${result.summary ? `<div class="over-predict-summary__caption">${escapeHtml(result.summary)}</div>` : ""}
    </div>
    ${sparklineHtml}
    ${wicketSparkHtml}
    <div class="over-predict-heading">Over-by-over forecast — ${escapeHtml(ctx.bat)} vs ${escapeHtml(ctx.bowl)} · ${escapeHtml(ctx.fmt)}</div>
    <div class="over-grid">
      ${(result.overs || []).map((o, i) => {
        const wp  = o.win_probability != null ? Number(o.win_probability) : null;
        const wkp = o.wicket_probability != null ? Math.min(100, Math.max(0, Number(o.wicket_probability))) : null;
        const wpBar = wp !== null
          ? `<div class="over-card__wp">
               <div class="over-card__wp-row">
                 <span class="over-card__wp-label">Win%</span>
                 <span class="over-card__wp-val">${wp}%</span>
               </div>
               <div class="over-card__wp-track">
                 <div class="over-card__wp-fill" data-pct="${wp}" style="width:0%"></div>
               </div>
             </div>`
          : "";
        const wkpBar = wkp !== null
          ? `<div class="over-card__wp over-card__wkp">
               <div class="over-card__wp-row">
                 <span class="over-card__wp-label">Wkt%</span>
                 <span class="over-card__wp-val over-card__wkp-val">${wkp}%</span>
               </div>
               <div class="over-card__wp-track">
                 <div class="over-card__wkp-fill" data-pct="${wkp}" style="width:0%"></div>
               </div>
             </div>`
          : "";
        return `
        <div class="over-card ${riskClass(o.wicket_risk)}" style="animation-delay:${i * 28}ms">
          <div class="over-card__num">Over ${o.over}</div>
          <div class="over-card__runs">${o.projected_runs ?? "?"}</div>
          <div class="over-card__runs-label">proj. runs</div>
          ${riskLabel(o.wicket_risk)}
          ${wkpBar}
          ${wpBar}
          <div class="over-card__event">${escapeHtml(o.key_event || "")}</div>
        </div>`;
      }).join("")}
    </div>
  `;
  container.hidden = false;

  // Animate win-probability and wicket-probability bars after paint
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      container.querySelectorAll(".over-card__wp-fill[data-pct], .over-card__wkp-fill[data-pct]").forEach((el) => {
        const pct = Math.min(100, Math.max(0, Number(el.getAttribute("data-pct"))));
        el.style.transition = "width 0.55s cubic-bezier(0.33,1,0.68,1)";
        el.style.width = `${pct}%`;
      });
    });
  });
}

let overPredicting = false;

async function runOverPrediction() {
  if (overPredicting) return;
  overPredicting = true;

  const btn   = document.getElementById("overPredictBtn");
  const label = document.getElementById("overPredictLabel");
  const result= document.getElementById("overPredictResult");

  if (btn)   btn.disabled = true;
  if (label) { label.style.display = ""; label.textContent = "Predicting…"; }
  if (result) result.hidden = true;

  const bat  = (document.getElementById("lfBatTeam")?.value  || "Batting team").trim();
  const bowl = (document.getElementById("lfBowlTeam")?.value || "Bowling team").trim();
  const fmt  = document.getElementById("lfFormat")?.value || "T20";
  const inn  = document.getElementById("lfInnings")?.value || "1";

  try {
    const prompt = buildOverPredictionPrompt();
    const raw = await callClaude(
      [{ role: "user", content: prompt }],
      OVER_PREDICT_SYSTEM,
      1800,
      "over"
    );

    let parsed;
    try {
      const cleaned = extractJudgeJsonObject(raw);
      parsed = JSON.parse(cleaned);
    } catch (_err) {
      throw new Error("Claude returned invalid JSON. Try again or add more match details.");
    }

    if (!Array.isArray(parsed.overs) || !parsed.overs.length) {
      throw new Error("No over-by-over data in response. Try providing clearer match state.");
    }

    renderOverPredictionResult(result, parsed, { bat, bowl, fmt, inn });
  } catch (e) {
    if (result) {
      result.innerHTML = `<div style="color:var(--color-danger);font-size:.82rem;padding:10px 0;">${escapeHtml(e instanceof Error ? e.message : String(e))}</div>`;
      result.hidden = false;
    }
  } finally {
    if (btn)   btn.disabled = false;
    if (label) label.style.display = "none";
    overPredicting = false;
  }
}

function swapLiveFormTeams() {
  const batEl = /** @type {HTMLInputElement|null} */ (document.getElementById("lfBatTeam"));
  const bowlEl = /** @type {HTMLInputElement|null} */ (document.getElementById("lfBowlTeam"));
  if (!batEl || !bowlEl) return;
  const t = batEl.value;
  batEl.value = bowlEl.value;
  bowlEl.value = t;
  bowlEl.focus();
}

window.swapLiveFormTeams = swapLiveFormTeams;

/** Pre-fill live-panel team / venue fields from the fixture search line (same rules as matchInput `change`). */
function populateLiveFormFromMatchInput() {
  const matchInput = /** @type {HTMLInputElement|null} */ (document.getElementById("matchInput"));
  const batEl = /** @type {HTMLInputElement|null} */ (document.getElementById("lfBatTeam"));
  const bowlEl = /** @type {HTMLInputElement|null} */ (document.getElementById("lfBowlTeam"));
  const venueEl = /** @type {HTMLInputElement|null} */ (document.getElementById("lfVenue"));
  if (!matchInput || !batEl || !bowlEl) return;
  const val = matchInput.value.trim();
  if (!val) return;
  try {
    const t = parseTeamsFromMatch(val);
    if (t.codeA !== "TM1" && t.codeB !== "TM2") {
      if (!batEl.value) batEl.value = t.codeA;
      if (!bowlEl.value) bowlEl.value = t.codeB;
    }
  } catch (_e) { /* ignore */ }
  if (venueEl && !venueEl.value) {
    const m = val.match(/,\s*([^,]+)$/);
    if (m) venueEl.value = m[1].trim();
  }
}

function initLivePanel() {
  const head   = document.querySelector(".live-panel__head");
  const toggle = document.getElementById("livePanelToggle");
  const body   = document.getElementById("livePanelBody");
  const innSel = /** @type {HTMLSelectElement|null} */ (document.getElementById("lfInnings"));
  const targetWrap = document.getElementById("lfTargetWrap");

  function setOpen(open) {
    if (!body || !toggle) return;
    body.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.textContent = open ? "Collapse" : "Expand";
    if (open) populateLiveFormFromMatchInput();
  }

  if (head) {
    head.addEventListener("click", () => {
      const isOpen = toggle?.getAttribute("aria-expanded") === "true";
      setOpen(!isOpen);
    });
  }

  if (innSel && targetWrap) {
    const updateTargetVisibility = () => {
      targetWrap.style.display = innSel.value === "2" ? "" : "none";
    };
    innSel.addEventListener("change", updateTargetVisibility);
    updateTargetVisibility();
  }

  const matchInput = /** @type {HTMLInputElement|null} */ (document.getElementById("matchInput"));
  if (matchInput) {
    matchInput.addEventListener("change", populateLiveFormFromMatchInput);
  }
}

function initUmamiButtonTracking() {
  /** @param {string} name @param {Record<string, string|null>} data */
  function umamiTrack(name, data) {
    if (typeof window.umami !== "undefined" && typeof window.umami.track === "function") {
      window.umami.track(name, data);
    }
  }

  /** @param {HTMLButtonElement} btn */
  function buttonLabel(btn) {
    const fromAria = (btn.getAttribute("aria-label") || "").trim();
    if (fromAria) return fromAria.slice(0, 80);
    const txt = (btn.textContent || "").trim().replace(/\s+/g, " ");
    if (txt) return txt.slice(0, 80);
    return btn.id || "button";
  }

  document.addEventListener(
    "click",
    (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;
      const btn = t.closest("button");
      if (!btn) return;
      umamiTrack("button-click", {
        id: btn.id || null,
        label: buttonLabel(/** @type {HTMLButtonElement} */ (btn)),
        class: btn.className || null,
      });
    },
    true
  );
}

renderAgents();
initIntelAgentRefreshHandlers();
renderArch();
renderHowto();
initMatchAutocomplete();
initNoticeStrip();
initInfoSheet();
initAgentsToggle();
initLivePanel();
initLiveScoreBar();
initUmamiButtonTracking();
void refreshJudgeAccuracyFooter();
void (async () => {
  await applyShareQueryParam();
  await applySharedPredictionPreviewFromUrl();
  await autoPopulateTodayMatch();
})();

/**
 * @returns {Promise<MatchSuggestionRow[]>}
 */
async function loadAllMatchSuggestionRows() {
  /** @type {MatchSuggestionRow[]} */
  let rows = MATCH_SUGGESTIONS_FALLBACK_ROWS;
  try {
    const base = apiBase();
    if (base !== null) {
      const r = await fetch(`${base}/api/match-suggest?q=&limit=100`, {
        headers: { Accept: "application/json" },
      });
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data.suggestions) && data.suggestions.length) {
          rows = data.suggestions.map(normalizeSuggestApiEntry);
        }
      }
    }
  } catch {
    /* use bundled */
  }
  return rows;
}

/**
 * @param {string} c
 * @returns {string}
 */
function normalizeShareTeamCode(c) {
  const u = String(c || "").toUpperCase().trim();
  return (MATCH_SUGGEST_TEAM_ALIASES)[u] || u;
}

/**
 * @returns {{ a: string, b: string } | null}
 */
function extractShareTeamCodePair(s) {
  const m = String(s).match(/\b([A-Z]{2,4})\s+vs\.?\s+([A-Z]{2,4})\b/i);
  if (!m) return null;
  return { a: normalizeShareTeamCode(m[1]), b: normalizeShareTeamCode(m[2]) };
}

/**
 * @param {MatchSuggestionRow} row
 * @param {string} a
 * @param {string} b
 */
function rowCoversTeamCodes(row, a, b) {
  const A = String(a).toUpperCase();
  const B = String(b).toUpperCase();
  /** @type {string[]} */
  let codes;
  if (row.teams && row.teams.length >= 2) {
    codes = row.teams.map((t) => normalizeShareTeamCode(t));
  } else {
    const p = parseTeamsFromMatch(row.label);
    codes = [normalizeShareTeamCode(p.codeA), normalizeShareTeamCode(p.codeB)];
  }
  const set = new Set(codes);
  return set.has(A) && set.has(B);
}

/**
 * Last segment after a comma, used to pick among same team-pair (e.g. "Hyderabad").
 * @param {string} s
 */
function venueHintFromShareString(s) {
  const parts = String(s)
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length < 2) return "";
  return parts[parts.length - 1].toLowerCase();
}

/**
 * Map a hand-typed or shortened ?share= string to a canonical `match_suggestions` label.
 * @param {string} shareLabel
 * @param {MatchSuggestionRow[]} rows
 * @returns {string}
 */
function resolveShareStringToLabel(shareLabel, rows) {
  const t = String(shareLabel).trim();
  if (!t) return t;

  const ex = rows.find((r) => r.label === t);
  if (ex) return ex.label;
  const nk = normalizeFixtureLabelKey(t);
  const ex2 = rows.find((r) => normalizeFixtureLabelKey(r.label) === nk);
  if (ex2) return ex2.label;

  const pair = extractShareTeamCodePair(t);
  if (!pair) {
    const hits = getMatchSuggestionHits(rows, t, 1);
    return hits.length ? hits[0].label : t;
  }

  let cand = rows.filter((r) => rowCoversTeamCodes(r, pair.a, pair.b));
  if (cand.length === 0) return t;
  if (cand.length === 1) return cand[0].label;

  const hint = venueHintFromShareString(t);
  if (hint.length >= 3) {
    const v = cand.filter(
      (r) =>
        String(r.venue).toLowerCase().includes(hint) || String(r.label).toLowerCase().includes(hint)
    );
    if (v.length === 1) return v[0].label;
    if (v.length > 0) cand = v;
  }

  cand = [...cand].sort(compareMatchSuggestionsNewestFirst);
  return cand[0].label;
}

/**
 * @param {string} label
 * @returns {Promise<string | null>}
 */
async function tryMatchByLabelApi(label) {
  if (apiBase() === null) return null;
  const t = String(label).trim();
  if (!t) return null;
  try {
    const r = await fetch(`${apiBase()}/api/match-by-label?label=${encodeURIComponent(t)}`);
    if (!r.ok) return null;
    const d = await r.json();
    const m = d && d.match && d.match.label != null ? String(d.match.label) : "";
    return m || null;
  } catch {
    return null;
  }
}

/**
 * Resolve `pack.l` against suggestions / API and fill `#matchInput`.
 * @param {SharePackV1} pack
 * @returns {Promise<boolean>}
 */
async function applyResolvedSharePackToInput(pack) {
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById("matchInput"));
  if (!input) return false;
  let label = String(pack.l).trim();
  if (!label) return false;
  try {
    label = decodeURIComponent(label.replace(/\+/g, " ")).trim();
  } catch {
    /* */ 
  }
  const rows = await loadAllMatchSuggestionRows();
  let final = label;
  const fromApi = await tryMatchByLabelApi(label);
  if (fromApi) {
    final = fromApi;
  } else {
    final = resolveShareStringToLabel(label, rows);
    if (final !== label) {
      const api2 = await tryMatchByLabelApi(final);
      if (api2) final = api2;
    }
  }
  input.value = final;
  const clearBtn = document.getElementById("matchSearchClear");
  if (clearBtn) /** @type {HTMLElement} */ (clearBtn).hidden = false;
  try {
    populateLiveFormFromMatchInput();
  } catch {
    /* */ 
  }
  try {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  } catch {
    /* */ 
  }
  return true;
}

/**
 * Deep link: `/s/{id}` (302 → `?sid=`), `?sid=`, `?p=`, or `?share=` pre-fills the match field.
 * Accepts the exact catalog label **or** a looser hand-written line (e.g. `IPL 2026 — SRH vs DC, Hyderabad`
 * → resolves to the real row such as `DC vs SRH — …, Rajiv Gandhi International Stadium, Hyderabad`).
 * With a share pack (sid / p / legacy verdict + share), {@link applySharedPredictionPreviewFromUrl} shows the preview card.
 */
async function applyShareQueryParam() {
  _acwrSharePackP = null;

  let sp;
  try {
    sp = new URLSearchParams(window.location.search);
  } catch {
    return;
  }

  const sid = String(sp.get("sid") || "").trim().toLowerCase();
  if (sid && /^[a-f0-9]{8}$/.test(sid) && apiBase() !== null) {
    try {
      const r = await fetch(`${apiBase()}/api/share/${encodeURIComponent(sid)}`, {
        headers: { Accept: "application/json" },
      });
      if (r.ok) {
        const data = await r.json();
        const spack = sharePackV1FromApiBody(data);
        if (spack) {
          _acwrSharePackP = spack;
          if (await applyResolvedSharePackToInput(spack)) return;
          _acwrSharePackP = null;
        }
      }
    } catch {
      /* */ 
    }
  }

  const pToken = String(sp.get("p") || "").trim();
  if (pToken) {
    const pack = decodeSharePack(pToken);
    if (pack && pack.l) {
      _acwrSharePackP = pack;
    }
  }

  if (_acwrSharePackP) {
    if (await applyResolvedSharePackToInput(_acwrSharePackP)) return;
    _acwrSharePackP = null;
  }

  let raw = "";
  try {
    raw = sp.get("share") || "";
  } catch {
    return;
  }
  let label = String(raw).trim();
  if (!label) return;
  // URLSearchParams usually decodes; this handles raw % sequences / + in edge cases
  try {
    label = decodeURIComponent(label.replace(/\+/g, " ")).trim();
  } catch {
    label = String(raw).trim();
  }
  if (!label) return;

  const input = /** @type {HTMLInputElement|null} */ (document.getElementById("matchInput"));
  if (!input) return;

  const rows = await loadAllMatchSuggestionRows();

  let final = label;
  const fromApi = await tryMatchByLabelApi(label);
  if (fromApi) {
    final = fromApi;
  } else {
    final = resolveShareStringToLabel(label, rows);
    if (final !== label) {
      const api2 = await tryMatchByLabelApi(final);
      if (api2) final = api2;
    }
  }

  input.value = final;
  const clearBtn = document.getElementById("matchSearchClear");
  if (clearBtn) /** @type {HTMLElement} */ (clearBtn).hidden = false;
  try {
    populateLiveFormFromMatchInput();
  } catch {
    /* live panel fields optional */
  }
  try {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  } catch {
    /* */ 
  }
}

/**
 * On page load, detect today's fixture (or the nearest upcoming one) and auto-fill the match
 * input, the live panel team/venue fields, and the live score bar.
 */
async function autoPopulateTodayMatch() {
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById("matchInput"));
  if (!input || input.value.trim()) return; // user has already typed something

  // Today's date in YYYY-MM-DD (local time)
  const now = new Date();
  const todayStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

  // Fetch fresh suggestion list from server; fall back to bundled rows
  /** @type {{ label: string, date: string, venue: string, completed?: boolean, result?: { winner: string, summary: string } }[]} */
  let rows = MATCH_SUGGESTIONS_FALLBACK_ROWS;
  try {
    const base = apiBase();
    if (base !== null) {
      const r = await fetch(`${base}/api/match-suggest?q=&limit=80`, {
        headers: { Accept: "application/json" },
      });
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data.suggestions) && data.suggestions.length) {
          rows = data.suggestions.map(normalizeSuggestApiEntry);
        }
      }
    }
  } catch { /* best-effort — use bundled fallback */ }

  // 1st priority: today's incomplete (live / upcoming) matches — same-day double-headers: lower Match N first
  const todayLive = rows
    .filter((r) => r.date === todayStr && !r.completed)
    .sort((a, b) => iplMatchNumberFromLabel(a.label) - iplMatchNumberFromLabel(b.label));

  // 2nd priority: nearest future incomplete match
  const upcoming = rows
    .filter((r) => !r.completed && r.date > todayStr)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      return iplMatchNumberFromLabel(a.label) - iplMatchNumberFromLabel(b.label);
    });

  const best = todayLive[0] || upcoming[0];
  if (!best) return;

  // Populate match input
  input.value = best.label;
  const clearBtn = document.getElementById("matchSearchClear");
  if (clearBtn) /** @type {HTMLElement} */ (clearBtn).hidden = false;

  // Parse teams and sync the live-panel fields
  const teams = parseTeamsFromMatch(best.label);
  const batEl  = /** @type {HTMLInputElement|null} */ (document.getElementById("lfBatTeam"));
  const bowlEl = /** @type {HTMLInputElement|null} */ (document.getElementById("lfBowlTeam"));
  const venueEl = /** @type {HTMLInputElement|null} */ (document.getElementById("lfVenue"));
  if (batEl  && !batEl.value)  batEl.value  = teams.codeA;
  if (bowlEl && !bowlEl.value) bowlEl.value = teams.codeB;
  if (venueEl && !venueEl.value) {
    const vMatch = best.label.match(/,\s*([^,]+)$/);
    if (vMatch) venueEl.value = vMatch[1].trim();
    else if (best.venue) venueEl.value = best.venue;
  }

  // Subtle toast — keeps the command bar uncluttered
  showAutoDetectToast(todayLive.length > 0 ? "Today's match auto-detected" : "Next upcoming match auto-detected");

  // Auto-fetch live score only for today's matches (not future ones)
  if (todayLive.length > 0) {
    const liveInput = /** @type {HTMLInputElement|null} */ (document.getElementById("liveScoreInput"));
    const liveClear = document.getElementById("liveScoreClear");
    if (liveInput && !liveInput.value.trim()) {
      try {
        const snippet = await fetchLiveScore(best.label, teams);
        if (snippet) {
          liveInput.value = snippet;
          if (liveClear) /** @type {HTMLElement} */ (liveClear).hidden = false;
        }
      } catch { /* best-effort */ }
    }
  }
}

/**
 * Show a brief bottom toast when the fixture was auto-filled on load, then fade out.
 * @param {string} text
 */
function showAutoDetectToast(text) {
  let region = document.getElementById("toastRegion");
  if (!region) {
    region = document.createElement("div");
    region.id = "toastRegion";
    region.className = "toast-region";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    document.querySelector(".app")?.appendChild(region) ?? document.body.appendChild(region);
  }
  let toast = document.getElementById("autoDetectToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "autoDetectToast";
    toast.className = "toast toast--auto-detect";
    toast.setAttribute("role", "status");
    region.appendChild(toast);
  }
  toast.classList.remove("toast--dismissed", "toast--animate");
  toast.textContent = text;
  void toast.offsetWidth; // force reflow to restart animation
  toast.classList.add("toast--animate");
  toast.addEventListener(
    "animationend",
    (/** @type {AnimationEvent} */ e) => {
      if (e.animationName !== "toastAutoDetect") return;
      toast.classList.remove("toast--animate");
      toast.classList.add("toast--dismissed");
    },
    { once: true },
  );
}

function initLiveScoreBar() {
  const input   = /** @type {HTMLInputElement|null} */ (document.getElementById("liveScoreInput"));
  const clearBtn = document.getElementById("liveScoreClear");
  const fetchBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("liveScoreFetch"));
  if (!input) return;

  const syncClear = () => {
    if (clearBtn) clearBtn.hidden = !input.value.trim();
  };

  input.addEventListener("input", syncClear);

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      input.value = "";
      syncClear();
      input.focus();
    });
  }

  if (fetchBtn) {
    fetchBtn.addEventListener("click", async () => {
      const matchEl = /** @type {HTMLInputElement|null} */ (document.getElementById("matchInput"));
      const match = matchEl?.value.trim() || "";
      if (!match) {
        input.placeholder = "Select a fixture first…";
        return;
      }

      fetchBtn.disabled = true;
      const origLabel = fetchBtn.querySelector("span")?.textContent || "Fetch live";
      const span = fetchBtn.querySelector("span");
      if (span) span.textContent = "Fetching…";

      try {
        const teams = parseTeamsFromMatch(match);
        const d = await fetchLiveScoreDetail(match, teams);
        if (d.snippet) {
          input.value = d.snippet;
          syncClear();
        } else if (d.unreachable) {
          input.placeholder = "Score service offline — start ingestion on :3334, or paste score";
        } else if (d.hint) {
          input.placeholder = d.hint.length > 130 ? `${d.hint.slice(0, 127)}…` : d.hint;
        } else {
          input.placeholder = "No live score found in RSS — paste manually";
        }
      } catch {
        input.placeholder = "Fetch failed — paste score manually";
      } finally {
        fetchBtn.disabled = false;
        if (span) span.textContent = origLabel;
      }
    });
  }

  syncClear();
}
