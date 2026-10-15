# --- залежності (better-sqlite3 — нативний модуль, потрібні інструменти збірки) ---
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# --- тести + збірка ---
FROM deps AS build
COPY . .
RUN npm test && npm run build

# --- лише прод-залежності ---
FROM deps AS prod-deps
RUN npm prune --omit=dev

# --- рантайм ---
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3004 \
    DB_PATH=/app/data/meds.db \
    CLIENT_DIR=/app/dist/client
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3004
CMD ["node", "dist/server.cjs"]
