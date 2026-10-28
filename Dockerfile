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

# Prisma validates the schema (and resolves DATABASE_URL) even during
# `prisma generate` — and Render does NOT pass dashboard env vars into the
# docker build. Bake safe defaults here; runtime env vars (render.yaml /
# Render dashboard) still override them.
ENV DATABASE_URL=file:/data/db/custom.db \
    MEDIA_ROOT=/data/media

RUN bunx prisma generate \
    && bun run build

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    RENDER_SCALE=720

EXPOSE 3000

# ensure the SQLite schema exists on a fresh disk, then serve
# (mkdir also covers the free plan, where no disk is mounted)
# --max-old-space-size=320 caps Node's heap so Next+Prisma never squeeze out
# the ffmpeg child process on Render's 512MB free tier.
CMD ["sh", "-c", "mkdir -p /data/db /data/media && bunx prisma db push --skip-generate && node --max-old-space-size=320 .next/standalone/server.js"]
