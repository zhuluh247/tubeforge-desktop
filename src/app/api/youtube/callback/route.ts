import { NextRequest, NextResponse } from 'next/server'
import { getOAuthClient, getSetting, saveYouTubeCreds, getYouTubeCreds } from '@/lib/yt/settings'
import { exchangeCodeForTokens, getChannelInfoDetailed } from '@/lib/yt/youtube'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function page(title: string, message: string, ok = false): NextResponse {
  const color = ok ? '#34d399' : '#f87171'
  const html = `<!doctype html><html><head><title>TubeForge — YouTube connect</title></head>
  <body style="font-family:system-ui;background:#09090b;color:#fafafa;display:grid;place-items:center;height:100vh;margin:0">
  <div style="max-width:560px;padding:32px;border:1px solid #27272a;border-radius:16px;background:#18181b">
    <h1 style="font-size:18px;margin:0 0 12px;color:${color}">${title}</h1>
    <p style="font-size:13px;line-height:1.6;color:#a1a1aa;margin:0 0 16px">${message}</p>
    <a href="/" style="color:#ef4444;font-size:13px">← Back to TubeForge dashboard</a>
  </div>
  <script>if (${ok ? 'true' : 'false'}) { try { window.opener && window.opener.postMessage('tubeforge-oauth-done', '*') } catch (e) {} }</script>
  </body></html>`
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Google redirects back here after consent. Exchanges the code, saves the
 *  refresh token and shows which channel is now connected. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const error = url.searchParams.get('error')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (error) {
    return page(
      'Authorization cancelled',
      `Google returned "${esc(error)}". Nothing was saved — you can safely start again from Settings.`
    )
  }
  if (!code) {
    return page('Missing authorization code', 'Google did not return a code parameter. Start the connect flow again from Settings.')
  }

  const [savedState, redirectUri, client] = await Promise.all([
    getSetting('ytOAuthState'),
    getSetting('ytOAuthRedirect'),
    getOAuthClient(),
  ])
  if (!client || !redirectUri) {
    return page('Connect flow not initialised', 'Save your Client ID and Secret in Settings first, then press "Connect automatically" again.')
  }
  if (!state || !savedState || state !== savedState) {
    return page('State mismatch', 'This callback does not match a connect request from this app (state check failed). Start again from Settings.')
  }

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      redirectUri,
    })
    await saveYouTubeCreds({ refreshToken: tokens.refreshToken })

    const creds = await getYouTubeCreds()
    const info = creds ? await getChannelInfoDetailed(creds, tokens.accessToken) : null
    if (info?.ok) {
      const { setSetting } = await import('@/lib/yt/settings')
      await setSetting('ytChannelTitle', info.title)
      return page(
        `Connected: ${esc(info.title)}`,
        `TubeForge will upload to the YouTube channel <b style="color:#fafafa">${esc(info.title)}</b> (ID: ${esc(info.channelId)}). You can close this tab and publish from the dashboard.`,
        true
      )
    }
    return page(
      'Token saved, channel unclear',
      esc(info && !info.ok ? info.error : 'The refresh token was saved but the channel could not be verified. Use "Check connection" in Settings.')
    )
  } catch (e) {
    return page('Authorization failed', esc(e instanceof Error ? e.message : String(e)))
  }
}
