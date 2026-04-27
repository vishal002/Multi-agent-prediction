# ── Node.js production image (two-stage) ─────────────────────────────────────
# Stage 1 builds the minified, hashed, pre-compressed bundle in dist/.
# Stage 2 ships server.mjs + dist/ + production node_modules (Sharp renders 1200×630 /api/og/share PNGs from SVG).
# Used by docker-compose.yml; Render uses its native Node runtime + render.yaml.
# Build: docker build -t cricket-war-room .
# Run:   docker run -p 3333:3333 -e GROQ_API_KEY=gsk_... cricket-war-room

FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY ai_cricket_war_room.html \
     disclaimer.html         \
     ai_cricket_war_room.css  \
     ai_cricket_war_room.js   \
     sw.js                    \
     match_suggestions.json   \
     manifest.webmanifest     \
     ./
COPY icons ./icons/
COPY image ./image/
COPY scripts ./scripts/

RUN npm run build

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    SERVE_DIST=1

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.mjs ./
COPY --from=builder /app/dist ./dist

EXPOSE 3333

CMD ["node", "server.mjs"]
