#!/bin/bash
# Package TubeForge into a clean, GitHub-ready ZIP (no secrets, no build junk).
set -e

SRC=/home/z/my-project
STAGE=/home/z/my-project/.stage-tubeforge
OUT=/home/z/my-project/download/tubeforge-deploy.zip

rm -rf "$STAGE"
mkdir -p "$STAGE/tubeforge"
cd "$STAGE/tubeforge"

# ── root files needed for build/deploy ──────────────────────────────────────
for f in \
  .dockerignore .env.example .gitignore \
  Dockerfile render.yaml DEPLOY.md README.md \
  bun.lock package.json tsconfig.json next.config.ts next-env.d.ts \
  components.json tailwind.config.ts postcss.config.mjs eslint.config.mjs
do
  cp "$SRC/$f" ./
done

# ── source directories ──────────────────────────────────────────────────────
cp -r "$SRC/prisma" "$SRC/public" "$SRC/scripts" "$SRC/src" "$SRC/assets" ./

# ── safety net: make sure no junk/secrets ever slipped in ───────────────────
rm -rf node_modules .next .git db media download upload examples skills \
       tests mini-services .zscripts .env .claude scripts/sample \
       *.log *.tsbuildinfo worklog.md Caddyfile 2>/dev/null || true
# public/ may contain the served copies of this very zip + the AI credentials
# file (used for browser downloads) — they must NEVER ship inside the repo zip.
# Demo videos / sample pages are sandbox-only artifacts, also excluded.
rm -f public/*.zip public/z-ai-config* public/*.txt public/*.mp4 public/samples.html 2>/dev/null || true

# ── zip it (from STAGE so the archive has a top-level tubeforge/ folder) ────
mkdir -p /home/z/my-project/download
rm -f "$OUT"
cd "$STAGE"
zip -rq "$OUT" tubeforge

echo "== ZIP created =="
ls -lh "$OUT"
echo
echo "== contents (top-level) =="
unzip -l "$OUT" | awk '{print $4}' | rg -v '^$' | cut -d/ -f1,2 | sort -u | head -30
echo
echo "== total files =="
unzip -l "$OUT" | tail -1
echo
echo "== secret leak check (expect nothing) =="
unzip -l "$OUT" | rg -i '\.env$|\.env\.|custom\.db|/media/|node_modules|\.next/|\.git/|dev\.log|server\.log' || echo "CLEAN — no secrets or build junk inside"
