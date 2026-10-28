# Deploy TubeForge: GitHub → Render

## 1 · Push to GitHub

```bash
cd <project folder>
git init
git add .
git commit -m "TubeForge: YouTube full-auto video factory"
```

Create an empty repo on <https://github.com/new> (private is fine), then:

```bash
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

`.gitignore` already excludes `media/`, `download/`, `db/` (your database contains the OAuth tokens — never commit it), logs and `.env*`.

## 2 · Deploy on Render

### Option A — Blueprint (recommended)

1. Render Dashboard → **New → Blueprint** → select your repo.
2. Render reads `render.yaml`: Docker runtime, 5 GB persistent disk at `/data`, health check on `/api/stats`.
3. Click **Apply**. First build takes ~5 min (FFmpeg is installed in the image).

### Option B — Manual web service

1. **New → Web Service** → connect the repo.
2. Runtime: **Docker** (Render builds the included `Dockerfile`).
3. Instance type:
   - **Starter** (recommended): supports the persistent disk → videos, database and your OAuth connection survive restarts.
   - **Free**: works, but storage is **ephemeral** (wiped on every deploy/restart) and the service **sleeps after 15 min idle**, pausing Auto-Pilot. Use it for testing only.
4. If you skip the blueprint, add a Disk (mount path `/data`) and these env vars:

| Key | Value |
|---|---|
| `DATABASE_URL` | `file:/data/db/custom.db` |
| `MEDIA_ROOT` | `/data/media` |

The container auto-creates the DB schema on boot (`prisma db push`).

## 3 · Add the AI credentials (required!)

The Z.ai SDK (scripts, voiceover, scene art, thumbnails) reads its credentials
from a config **file**, not from your code. On Render you provide it with one
environment variable — the app materializes the file automatically at boot:

1. Open the file **`z-ai-config-SANDBOX.txt`** that came with your ZIP.
2. Render Dashboard → your service → **Environment** → *Add environment variable*:
   - Key: `ZAI_CONFIG_JSON`
   - Value: the single-line JSON from that file (already minified for copy-paste)
3. **Save** — Render redeploys and the log will show
   `[instrumentation] wrote .z-ai-config from ZAI_CONFIG_JSON env var`.

If AI calls ever fail (the sandbox credential is session-scoped), replace the
value with your own credentials in the same shape:
`{"baseUrl":"<openai-compatible endpoint>","apiKey":"<your key>"}`.

## 4 · Connect your YouTube channel on the deployed URL

1. Open your Render URL → **Settings**.
2. Paste the **Client ID** and **Client Secret** from the JSON you downloaded from Google Cloud.
3. Use the guided connect block:
   - **Desktop app client** → Option A: open the consent page, pick the channel, then paste the redirected `http://localhost:1/?code=…` URL back. (This works on any host — the redirect happens in *your* browser, not on the server.)
   - **Web application client** → Option B: add `https://<your-app>.onrender.com/api/youtube/callback` to *Authorized redirect URIs* in Google Cloud Console, then press **Connect automatically**.
4. Press **Check connection** — it shows exactly which channel will receive uploads. Got 2 channels? The channel you pick during the Google consent screen is the one that gets connected; re-authorize to switch.

## 5 · Notes & limits

- **Quota**: default YouTube quota ≈ 6 uploads/day. Auto-Pilot's default of 3/day leaves headroom.
- **Unverified API projects**: videos uploaded by new Google Cloud projects may be forced private until the OAuth app passes review — set Privacy to `Private` in Settings if uploads get rejected.
- **Renders are CPU-bound**: a long-form video takes a few minutes; Render's free CPU is slower than Starter.
- **Backups**: everything lives in the `/data` disk (SQLite + media). Use Render disk snapshots or download finished MP4s from the dashboard.
- **FFmpeg**: TubeForge bundles static ffmpeg/ffprobe binaries (downloaded automatically per-OS during `npm/bun install`). If the host has no system ffmpeg — e.g. Render's **Node runtime** or a local Windows machine — rendering still works with zero manual setup. A system ffmpeg (Docker image / `apt install ffmpeg`) simply takes priority.

## 6 · Local alternatives

Any Node host works; FFmpeg is optional thanks to the bundled static fallback (a system install is still faster). Example VPS: `apt install -y ffmpeg`, `bun install`, `bun run build`, `bun run start`. Fly.io/Railway work with the same Dockerfile.
