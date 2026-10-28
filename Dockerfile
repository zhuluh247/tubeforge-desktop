# ── TubeForge image: Node + Bun + FFmpeg + fonts ──────────────────────────
FROM node:20-slim

# system deps: ffmpeg (rendering), DejaVu fonts (captions + thumbnails), curl for healthcheck
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# bun for fast, lockfile-exact installs (node stays as the runtime)
RUN npm install -g bun@1

WORKDIR /app

# install deps first for better layer caching
COPY package.json bun.lock ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile

# build the app
COPY . .
RUN bunx prisma generate \
    && bun run build

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

EXPOSE 3000

# ensure the SQLite schema exists on a fresh disk, then serve
CMD ["sh", "-c", "bunx prisma db push --skip-generate && node .next/standalone/server.js"]
