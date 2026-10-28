import { NextRequest, NextResponse } from 'next/server'
import { getOAuthClient, saveYouTubeCreds, getYouTubeCreds } from '@/lib/yt/settings'
import { exchangeCodeForTokens, getChannelInfoDetailed, PASTE_REDIRECT_URI } from '@/lib/yt/youtube'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Finish the "paste the redirect URL" OAuth flow.
 *  Body: { code?, redirectUrl?, redirectUri?, clientId?, clientSecret? }
 *  Either `code` directly, or `redirectUrl` = the full localhost URL the user copied. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    let code = typeof body.code === 'string' ? body.code.trim() : ''
    if (!code && typeof body.redirectUrl === 'string') {
      // accept the whole pasted URL and extract ?code=… safely
      const raw = body.redirectUrl.trim()
      try {
        const u = new URL(raw)
        code = u.searchParams.get('code')?.trim() || ''
        if (!code) {
          return NextResponse.json(
            { error: 'That URL has no ?code= parameter. Copy the full address from the browser bar right after Google redirects you.' },
            { status: 400 }
          )
        }
      } catch {
        // maybe they pasted just the raw code
        if (/^[A-Za-z0-9_\-]+$/.test(raw)) code = raw
      }
    }
    if (!code) {
      return NextResponse.json(
        { error: 'Missing authorization code. Paste the full redirected URL (http://localhost:1/?code=…) or the code itself.' },
        { status: 400 }
      )
    }

    // client credentials: from body, else from saved settings
    let clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
    let clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : ''
    if (!clientId || !clientSecret) {
      const saved = await getOAuthClient()
      clientId = clientId || saved?.clientId || ''
      clientSecret = clientSecret || saved?.clientSecret || ''
    }
    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'Client ID and Client Secret must be saved first (fill them in Settings and press Save).' },
        { status: 400 }
      )
    }

    const redirectUri =
      (typeof body.redirectUri === 'string' && body.redirectUri.trim()) || PASTE_REDIRECT_URI

    const tokens = await exchangeCodeForTokens({ code, clientId, clientSecret, redirectUri })

    await saveYouTubeCreds({ clientId, clientSecret, refreshToken: tokens.refreshToken })

    // confirm which channel this token controls (this is what answers "which of my channels?")
    const creds = await getYouTubeCreds()
    const info = creds ? await getChannelInfoDetailed(creds, tokens.accessToken) : null
    if (info?.ok) {
      const { setSetting } = await import('@/lib/yt/settings')
      await setSetting('ytChannelTitle', info.title)
      return NextResponse.json({ ok: true, channel: info.title, channelId: info.channelId })
    }
    return NextResponse.json({
      ok: true,
      warn: info && !info.ok ? info.error : 'Connected, but the channel could not be verified yet.',
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'OAuth exchange failed' },
      { status: 400 }
    )
  }
}
