import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getOAuthClient, setSetting } from '@/lib/yt/settings'
import { buildAuthUrl, PASTE_REDIRECT_URI } from '@/lib/yt/youtube'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function errorPage(title: string, message: string): NextResponse {
  const html = `<!doctype html><html><body style="font-family:system-ui;background:#09090b;color:#fafafa;display:grid;place-items:center;height:100vh;margin:0">
  <div style="max-width:520px;padding:32px;border:1px solid #27272a;border-radius:16px;background:#18181b">
    <h1 style="font-size:18px;margin:0 0 12px">${title}</h1>
    <p style="font-size:13px;line-height:1.6;color:#a1a1aa;margin:0 0 16px">${message}</p>
    <a href="/" style="color:#ef4444;font-size:13px">← Back to TubeForge</a>
  </div></body></html>`
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

/** Start the OAuth flow.
 *  - flow=paste (Option A, Desktop-app client): redirect_uri = http://localhost:1
 *    — Google auto-allows loopback redirects for Desktop clients, no Google
 *    Console configuration needed. The browser lands on a "site can't be
 *    reached" page whose URL contains ?code=, which the user pastes back.
 *  - no flow (Option B, Web-application client): redirect_uri = this host's
 *    /api/youtube/callback — must be added to Authorized redirect URIs in
 *    Google Cloud Console.
 *  With ?mode=url the consent URL is returned as JSON instead of redirecting. */
export async function GET(req: NextRequest) {
  const client = await getOAuthClient()
  if (!client) {
    const wantJson = new URL(req.url).searchParams.get('mode') === 'url'
    const msg = 'Save your Google OAuth Client ID and Client Secret in TubeForge Settings first, then click Connect again.'
    if (wantJson) return NextResponse.json({ error: msg }, { status: 400 })
    return errorPage('Client credentials missing', msg)
  }

  const isPaste = new URL(req.url).searchParams.get('flow') === 'paste'
  let redirectUri: string
  let state: string | undefined

  if (isPaste) {
    redirectUri = PASTE_REDIRECT_URI
  } else {
    // resolve the external origin (works behind proxies like Render / Caddy)
    const proto = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '')
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host
    const origin = `${proto}://${host}`
    redirectUri = `${origin}/api/youtube/callback`
    state = randomUUID()
    await setSetting('ytOAuthState', state)
    await setSetting('ytOAuthRedirect', redirectUri)
  }

  const authUrl = buildAuthUrl({ clientId: client.clientId, redirectUri, state })
  if (new URL(req.url).searchParams.get('mode') === 'url') {
    return NextResponse.json({ ok: true, url: authUrl, redirectUri })
  }
  return NextResponse.redirect(authUrl, 302)
}

/** Small helper used by Settings to know whether a connect flow is possible. */
export async function POST() {
  const client = await getOAuthClient()
  return NextResponse.json({ ok: !!client })
}
