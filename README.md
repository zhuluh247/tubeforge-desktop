# TubeForge — YouTube Full-Auto Video Factory

Faceless-channel automation: **script → voiceover → AI scene art → animated render with burned captions → thumbnail → YouTube upload**, fully automated (Auto-Pilot schedules N videos/day).

Built with Next.js 16 + Prisma (SQLite) + FFmpeg + the Z.ai SDK (LLM / TTS / image generation).

## Features

- **Shorts (1080×1920) and long-form (1920×1080)** with Ken Burns motion, word-timed ASS captions, subtle noise bed, AI thumbnails with drawtext titles
- **Auto-Pilot**: pick videos/day, active hours, format mix and niche — topics are invented by AI and de-duplicated against your history
- **One dashboard**: live per-stage progress, scene-by-scene preview, logs, retry, download MP4, publish
- **YouTube upload** via Data API v3 (resumable) + custom thumbnail, with a guided OAuth connect flow in Settings
- **Crash-safe**: queue worker + boot recovery re-queues anything interrupted mid-job

## Local development

Prereqs: **Node 20+**, **Bun** (`npm i -g bun`), and **FFmpeg** on your PATH:

- Ubuntu/Debian: `sudo apt install -y ffmpeg`
- macOS: `brew install ffmpeg`
- Windows: `winget install Gyan.FFmpeg`

```bash
bun install                # deps + prisma client
bun run db:push            # create the SQLite schema
bun run dev                # http://localhost:3000
```

If FFmpeg lives somewhere unusual, set `FFMPEG_PATH` / `FFPROBE_PATH`.

## Environment variables (all optional)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite file location (default `file:./db/custom.db`) |
| `MEDIA_ROOT` | Where renders/media are written (default `./media`) |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` / `YOUTUBE_REFRESH_TOKEN` | Fallback YouTube credentials (Settings UI wins) |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Explicit binary locations |

YouTube credentials are normally configured **in the dashboard** (Settings → Connect your YouTube channel). Settings are stored in the local database — see `DEPLOY.md` for persistence on Render.

## Deploying (GitHub → Render)

See **[DEPLOY.md](./DEPLOY.md)** — includes a Render blueprint (`render.yaml`), the Dockerfile (ships FFmpeg + fonts), and the OAuth redirect-URI notes for a hosted domain.

## Daily quota note

YouTube's free default quota allows roughly **6 uploads/day** (1,600 units each). Auto-Pilot defaults to 3/day for headroom.
