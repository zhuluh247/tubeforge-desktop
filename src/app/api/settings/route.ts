import { NextRequest, NextResponse } from 'next/server'
import {
  getAutomation, setAutomation, getSetting, setSetting, getYouTubeCreds, getDefaultVoice,
  getOAuthClient, saveYouTubeCreds,
} from '@/lib/yt/settings'
import { getChannelInfoDetailed } from '@/lib/yt/youtube'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const [automation, voice, yt] = await Promise.all([
    getAutomation(),
    getDefaultVoice(),
    getYouTubeCreds(),
  ])
  const [nextAutoRunAt, ytPrivacy, channelTitle, oauthClient] = await Promise.all([
    getSetting('nextAutoRunAt'),
    getSetting('ytPrivacy'),
    getSetting('ytChannelTitle'),
    getOAuthClient(),
  ])
  return NextResponse.json({
    automation,
    defaultVoice: voice,
    youtube: {
      configured: !!yt,
      hasClient: !!oauthClient,
      channelTitle: channelTitle || null,
      privacy: ytPrivacy || 'public',
    },
    nextAutoRunAt: nextAutoRunAt ? parseInt(nextAutoRunAt, 10) : null,
  })
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()

    if (body.automation) {
      const a = body.automation
      await setAutomation({
        enabled: !!a.enabled,
        videosPerDay: Math.min(12, Math.max(1, Number(a.videosPerDay) || 1)),
        startHour: Math.min(23, Math.max(0, Number(a.startHour) || 0)),
        endHour: Math.min(24, Math.max(1, Number(a.endHour) || 24)),
        formats: ['short', 'long', 'mixed'].includes(a.formats) ? a.formats : 'mixed',
        niche: typeof a.niche === 'string' && a.niche.trim() ? a.niche.trim().slice(0, 60) : 'Facts & Curiosities',
      })
      // re-arm the timer whenever settings change
      await setSetting('nextAutoRunAt', String(Date.now() + 45_000))
    }

    if (body.defaultVoice) {
      await setSetting('defaultVoice', String(body.defaultVoice).slice(0, 30))
    }

    if (body.youtube && typeof body.youtube === 'object') {
      const y = body.youtube
      // only overwrite values that are actually provided and non-empty
      await saveYouTubeCreds({
        clientId: typeof y.clientId === 'string' ? y.clientId : undefined,
        clientSecret: typeof y.clientSecret === 'string' ? y.clientSecret : undefined,
        refreshToken: typeof y.refreshToken === 'string' ? y.refreshToken : undefined,
      })
      if (['public', 'unlisted', 'private'].includes(y.privacy)) {
        await setSetting('ytPrivacy', y.privacy)
      }
      if (y.removeToken === true) {
        await setSetting('ytRefreshToken', '')
      }
      if (y.test) {
        const creds = await getYouTubeCreds()
        if (!creds) {
          return NextResponse.json(
            { error: 'Fill in the Client ID, Client Secret and Refresh token (or connect via the guided flow) first.' },
            { status: 400 }
          )
        }
        const info = await getChannelInfoDetailed(creds)
        if (info.ok) {
          await setSetting('ytChannelTitle', info.title)
          return NextResponse.json({ ok: true, channel: info.title, channelId: info.channelId })
        }
        return NextResponse.json({ error: info.error }, { status: 400 })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to save settings' },
      { status: 500 }
    )
  }
}
