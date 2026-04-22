# ── Node.js production image ───────────────────────────────────────────────────
# Serves the war room UI and proxies LLM API calls (Groq / Anthropic).
# Used by docker-compose.yml; Render uses its native Node runtime instead.
# Build: docker build -t cricket-war-room .
# Run:   docker run -p 3333:3333 -e GROQ_API_KEY=gsk_... cricket-war-room

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY ai_cricket_war_room.html \
     ai_cricket_war_room.css  \
     ai_cricket_war_room.js   \
     sw.js                    \
     match_suggestions.json   \
     manifest.webmanifest     \
     server.mjs               \
     ./
COPY icons ./icons/

EXPOSE 3333

CMD ["node", "server.mjs"]
