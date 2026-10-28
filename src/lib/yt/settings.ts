import { db } from '@/lib/db'
import { DEFAULT_AUTOMATION, type AutomationConfig } from './constants'

export interface YouTubeCreds {
  clientId: string
  clientSecret: string
  refreshToken: string
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } })
  return row?.value ?? null
}

export async function setSetting(key: string, value: string) {
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

export async function getAutomation(): Promise<AutomationConfig> {
  const raw = await getSetting('automation')
  if (!raw) return { ...DEFAULT_AUTOMATION }
  try {
    return { ...DEFAULT_AUTOMATION, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_AUTOMATION }
  }
}

export async function setAutomation(cfg: Partial<AutomationConfig>) {
  const cur = await getAutomation()
  await setSetting('automation', JSON.stringify({ ...cur, ...cfg }))
}

function normalizeCreds(
  clientId: string | null | undefined,
  clientSecret: string | null | undefined,
  refreshToken: string | null | undefined
): YouTubeCreds | null {
  const id = (clientId || process.env.YOUTUBE_CLIENT_ID || '').trim()
  const secret = (clientSecret || process.env.YOUTUBE_CLIENT_SECRET || '').trim()
  const token = (refreshToken || process.env.YOUTUBE_REFRESH_TOKEN || '').trim()
  if (!id || !secret || !token) return null
  return { clientId: id, clientSecret: secret, refreshToken: token }
}

/** Saved settings win; env vars (YOUTUBE_CLIENT_ID / _SECRET / _REFRESH_TOKEN) are the fallback. */
export async function getYouTubeCreds(): Promise<YouTubeCreds | null> {
  const [clientId, clientSecret, refreshToken] = await Promise.all([
    getSetting('ytClientId'),
    getSetting('ytClientSecret'),
    getSetting('ytRefreshToken'),
  ])
  return normalizeCreds(clientId, clientSecret, refreshToken)
}

/** For flows that only need the OAuth client (id + secret), e.g. starting consent. */
export async function getOAuthClient(): Promise<{ clientId: string; clientSecret: string } | null> {
  const [clientId, clientSecret] = await Promise.all([
    getSetting('ytClientId'),
    getSetting('ytClientSecret'),
  ])
  const id = (clientId || process.env.YOUTUBE_CLIENT_ID || '').trim()
  const secret = (clientSecret || process.env.YOUTUBE_CLIENT_SECRET || '').trim()
  if (!id || !secret) return null
  return { clientId: id, clientSecret: secret }
}

export async function saveYouTubeCreds(creds: Partial<YouTubeCreds>) {
  if (creds.clientId?.trim()) await setSetting('ytClientId', creds.clientId.trim())
  if (creds.clientSecret?.trim()) await setSetting('ytClientSecret', creds.clientSecret.trim())
  if (creds.refreshToken?.trim()) await setSetting('ytRefreshToken', creds.refreshToken.trim())
}

export async function getDefaultVoice(): Promise<string> {
  return (await getSetting('defaultVoice')) || 'jam'
}
