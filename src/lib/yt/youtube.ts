// ─── YouTube Data API v3 — resumable upload with plain fetch ─────────────
import fs from 'fs'
import { CATEGORY_ID } from './constants'
import type { YouTubeCreds } from './settings'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos'
const THUMB_URL = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set'
const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels'

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
]

/** Paste-flow redirect: works with "Desktop app" OAuth clients, zero config.
 *  After consent the browser lands on this closed port — the user copies the
 *  URL from the address bar (it contains ?code=…) and pastes it back. */
export const PASTE_REDIRECT_URI = 'http://localhost:1'

export function buildAuthUrl(opts: { clientId: string; redirectUri: string; state?: string }): string {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: YOUTUBE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  })
  if (opts.state) q.set('state', opts.state)
  return `${AUTH_URL}?${q.toString()}`
}

// ─── Safe response parsing — never explode on non-JSON bodies ────────────

async function safeJson(res: Response): Promise<{ json: Record<string, unknown> | null; text: string }> {
  let text = ''
  try {
    text = await res.text()
  } catch { /* ignore read errors */ }
  try {
    return { json: JSON.parse(text) as Record<string, unknown>, text }
  } catch {
    return { json: null, text }
  }
}

/** Turn a Google error payload into a human, actionable message. */
function googleError(context: string, status: number, json: Record<string, unknown> | null, text: string): string {
  const err = (json?.error ?? null) as string | { message?: string } | undefined
  const errStr = typeof err === 'string' ? err : err?.message || ''
  const desc = typeof json?.error_description === 'string' ? (json.error_description as string) : ''
  const key = `${errStr} ${desc}`.toLowerCase()

  if (key.includes('invalid_grant')) {
    return `${context}: Google rejected the grant (invalid_grant). The code/token was already used or expired — restart the authorization step (and check your machine clock is correct).`
  }
  if (key.includes('invalid_client')) {
    return `${context}: Google rejected the client ID / client secret (invalid_client). Re-copy both values from the JSON file you downloaded, with no extra spaces or quotes.`
  }
  if (key.includes('redirect_uri_mismatch')) {
    return `${context}: redirect_uri_mismatch. The redirect_uri sent to Google does not match your OAuth client. — Desktop app client → use Option A (paste flow); http://localhost redirects are auto-allowed, no Google Console setup. — Web application client → Option B: in Google Cloud Console → Clients → your client → Authorized redirect URIs, add exactly your-deployed-url/api/youtube/callback (https, no trailing slash), then press Connect automatically again.`
  }
  if (key.includes('access_denied') || key.includes('admin_policy')) {
    return `${context}: access was denied. In Google Cloud Console → Google Auth Platform → Audience, make sure Publishing status is "In production" (or add your Google account under Test users), then authorize again.`
  }
  if (key.includes('unauthorized_client')) {
    return `${context}: this client is not allowed to use the requested grant type. Recreate the OAuth client as a "Desktop app" in Google Cloud Console.`
  }
  if (status === 401) {
    return `${context}: unauthorized (401). The refresh token is missing the youtube scope or was revoked — reconnect the channel in Settings.`
  }
  if (status === 403) {
    if (key.includes('quota')) return `${context}: YouTube API quota exceeded for today (default allows ~6 uploads/day). Try again after the quota resets at midnight Pacific Time.`
    if (key.includes('forbidden') || key.includes('permissions')) {
      return `${context}: forbidden (403). The connected Google account/channel doesn't allow uploads — re-authorize and pick the right channel, and confirm the YouTube Data API v3 is enabled in your Google Cloud project.`
    }
    return `${context}: forbidden (403). ${errStr || desc || text.slice(0, 160)}`
  }
  const detail = errStr || desc || (text ? text.slice(0, 160) : `HTTP ${status}`)
  return `${context}: ${detail}`
}

// ─── Token operations ─────────────────────────────────────────────────────

export async function refreshAccessToken(creds: YouTubeCreds): Promise<string> {
  let res: Response
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: 'refresh_token',
      }),
    })
  } catch (e) {
    throw new Error(`Could not reach Google OAuth (${e instanceof Error ? e.message : e}). Check this server's internet connection.`)
  }
  const { json, text } = await safeJson(res)
  const accessToken = json?.access_token
  if (!res.ok || typeof accessToken !== 'string' || !accessToken) {
    throw new Error(googleError('Token refresh failed', res.status, json, text))
  }
  return accessToken
}

export interface ExchangeResult {
  refreshToken: string
  accessToken: string
  scope: string
}

/** Exchange an authorization code (from the consent redirect) for tokens. */
export async function exchangeCodeForTokens(opts: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
}): Promise<ExchangeResult> {
  let res: Response
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: opts.code,
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        redirect_uri: opts.redirectUri,
        grant_type: 'authorization_code',
      }),
    })
  } catch (e) {
    throw new Error(`Could not reach Google OAuth (${e instanceof Error ? e.message : e}). Check this server's internet connection.`)
  }
  const { json, text } = await safeJson(res)
  const refreshToken = typeof json?.refresh_token === 'string' ? json.refresh_token : null
  const accessToken = typeof json?.access_token === 'string' ? json.access_token : null
  if (!res.ok || !refreshToken || !accessToken) {
    throw new Error(googleError('Authorization failed', res.status, json, text))
  }
  return {
    refreshToken,
    accessToken,
    scope: typeof json?.scope === 'string' ? json.scope : '',
  }
}

// ─── Channel info ─────────────────────────────────────────────────────────

export type ChannelInfo =
  | { ok: true; title: string; channelId: string }
  | { ok: false; error: string }

export async function getChannelInfoDetailed(creds: YouTubeCreds, accessToken?: string): Promise<ChannelInfo> {
  try {
    const token = accessToken || (await refreshAccessToken(creds))
    const res = await fetch(`${CHANNELS_URL}?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const { json, text } = await safeJson(res)
    if (!res.ok) {
      return { ok: false, error: googleError('Channel check failed', res.status, json, text) }
    }
    const items = (json?.items ?? null) as { id?: string; snippet?: { title?: string } }[] | null
    const item = items?.[0]
    if (!item?.id) {
      return {
        ok: false,
        error: 'Google accepted the token but returned no YouTube channel. This Google account may not have a channel, or the wrong one was selected during authorization. Reconnect and pick the correct channel.',
      }
    }
    return { ok: true, title: item.snippet?.title || 'Unnamed channel', channelId: item.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Back-compat helper: null when unavailable. */
export async function fetchChannelInfo(creds: YouTubeCreds): Promise<{ title: string; channelId: string } | null> {
  const info = await getChannelInfoDetailed(creds)
  return info.ok ? { title: info.title, channelId: info.channelId } : null
}

// ─── Upload ───────────────────────────────────────────────────────────────

export interface UploadMeta {
  title: string
  description: string
  tags: string[]
  privacy: 'public' | 'unlisted' | 'private'
}

export async function uploadVideo(
  creds: YouTubeCreds,
  filePath: string,
  meta: UploadMeta
): Promise<string> {
  const token = await refreshAccessToken(creds)
  const size = fs.statSync(filePath).size
  if (size < 1000) throw new Error(`Rendered file is too small (${size} bytes) — re-run the pipeline first`)

  // 1) init resumable session
  let init: Response
  try {
    init = await fetch(`${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify({
        snippet: {
          title: meta.title.slice(0, 100),
          description: meta.description.slice(0, 4900),
          tags: meta.tags.slice(0, 15),
          categoryId: CATEGORY_ID,
          defaultLanguage: 'en',
          defaultAudioLanguage: 'en',
        },
        status: {
          privacyStatus: meta.privacy,
          selfDeclaredMadeForKids: false,
        },
      }),
    })
  } catch (e) {
    throw new Error(`Could not reach YouTube (${e instanceof Error ? e.message : e}). Check this server's internet connection.`)
  }
  const initData = await safeJson(init)
  if (!init.ok) {
    throw new Error(googleError('YouTube session init failed', init.status, initData.json, initData.text))
  }
  const location = init.headers.get('location')
  if (!location) throw new Error('YouTube did not return an upload session URL')

  // 2) PUT the file as a STREAM (far below the 256GB cap). Buffering the
  //    whole MP4 in RAM OOMs Render's free tier — stream instead, with an
  //    exact Content-Length from the file size.
  const { Readable } = await import('stream')
  const fileStream = Readable.toWeb(
    fs.createReadStream(filePath)
  ) as unknown as ReadableStream
  let up: Response
  try {
    up = await fetch(location, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(size),
      },
      body: fileStream,
      duplex: 'half',
    } as RequestInit)
  } catch (e) {
    throw new Error(`Upload transfer failed (${e instanceof Error ? e.message : e}). The session may be resumable — try again.`)
  }
  const upData = await safeJson(up)
  const videoId = typeof upData.json?.id === 'string' ? upData.json.id : null
  if (!up.ok || !videoId) {
    throw new Error(googleError('YouTube upload failed', up.status, upData.json, upData.text))
  }
  return videoId
}

export async function setThumbnail(
  creds: YouTubeCreds,
  videoId: string,
  thumbPath: string
): Promise<void> {
  const token = await refreshAccessToken(creds)
  const body = new Uint8Array(fs.readFileSync(thumbPath))
  const res = await fetch(`${THUMB_URL}?videoId=${videoId}&uploadType=media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'image/jpeg',
    },
    body,
  })
  if (!res.ok) {
    const { json, text } = await safeJson(res)
    throw new Error(googleError('Thumbnail upload failed', res.status, json, text))
  }
}
