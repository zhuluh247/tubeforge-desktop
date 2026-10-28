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

The container auto-creates the DB schema on boot (`prisma db push`). The Docker image also bakes safe defaults (`file:/data/db/custom.db`, `/data/media`), so it boots even before you add these — the env vars matter when you relocate data to the persistent disk.

## 3 · Add the AI credentials (required!)

The Z.ai SDK (scripts, scene art, thumbnails) needs a Z.ai **Open Platform** API key:

1. Register at <https://z.ai/model-api> → create a **Standard API Key** at
   <https://z.ai/manage-apikey/apikey-list> (top up at the Billing page if asked).
2. Render Dashboard → your service → **Environment** → *Add environment variable*:
   - Key: `ZAI_CONFIG_JSON`
   - Value: `{"baseUrl":"https://api.z.ai/api/paas/v4","apiKey":"YOUR_KEY"}` (one line)
3. **Save** — the app materializes the config at boot and logs
   `[instrumentation] wrote .z-ai-config from ZAI_CONFIG_JSON env var`.

**Costs:** script/SEO generation uses `glm-4.5-flash` — **free**. Scene art +
thumbnails use `glm-image` (~$0.01/image, a short video ≈ $0.10). Upgrade
quality anytime with `ZAI_CHAT_MODEL` / `ZAI_IMAGE_MODEL` env vars.

**Voiceover:** included free with **no key needed** — it uses Microsoft Edge
neural voices (falls back to Google TTS). For premium voices, set `TTS_API_URL`
(+ `TTS_API_KEY`) to any OpenAI-style `/audio/speech` endpoint.

> The old sandbox credential (`internal-api.z.ai`) only works inside the build
> sandbox — from Render it times out with `ConnectTimeoutError`. Use the
> public `https://api.z.ai/api/paas/v4` baseUrl above.

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
