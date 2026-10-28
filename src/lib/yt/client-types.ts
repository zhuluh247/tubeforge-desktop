// Shared client-side types for the TubeForge dashboard
export interface VideoLogRow {
  id: string
  level: string
  stage: string
  message: string
  createdAt: string
}

export interface VideoRow {
  id: string
  topic: string
  format: 'short' | 'long'
  voice: string
  status: string
  stage: string
  progress: number
  title: string | null
  description: string | null
  tags: string | null
  script: string | null
  scenesJson: string | null
  durationSec: number | null
  thumbPath: string | null
  videoPath: string | null
  youtubeId: string | null
  error: string | null
  source: string
  createdAt: string
  updatedAt: string
  logs?: VideoLogRow[]
}

export interface Stats {
  total: number
  ready: number
  uploaded: number
  failed: number
  active: number
  workerBusy: boolean
  nextAutoRunAt: number | null
  automation: AutomationConfigUI
}

export interface AutomationConfigUI {
  enabled: boolean
  videosPerDay: number
  startHour: number
  endHour: number
  formats: 'short' | 'long' | 'mixed'
  niche: string
}

export interface SettingsPayload {
  automation: AutomationConfigUI
  defaultVoice: string
  youtube: { configured: boolean; hasClient?: boolean; channelTitle: string | null; privacy: string }
  nextAutoRunAt: number | null
}

/** Parse a fetch response as JSON, with a readable error when it isn't JSON
 *  (e.g. an HTML error page) — prevents cryptic "Unexpected token" crashes. */
export async function readJsonSafe(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text().catch(() => '')
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180)
    throw new Error(snippet || `Server returned HTTP ${res.status} with an unreadable body`)
  }
}

export function assetUrl(id: string, name: string, download = false, as?: string): string {
  const p = `/api/videos/${id}/asset/${name}`
  const qs: string[] = []
  if (download) qs.push('download=1')
  if (as) qs.push(`as=${encodeURIComponent(as)}`)
  return qs.length ? `${p}?${qs.join('&')}` : p
}

export function fmtDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}

export const VOICE_OPTIONS = [
  { id: 'jam', label: 'Jam — British narrator' },
  { id: 'kazi', label: 'Kazi — Clear standard' },
  { id: 'luodo', label: 'Luodo — Expressive' },
  { id: 'xiaochen', label: 'Xiaochen — Calm pro' },
  { id: 'tongtong', label: 'Tongtong — Warm' },
  { id: 'douji', label: 'Douji — Smooth flow' },
  { id: 'chuichui', label: 'Chuichui — Lively' },
]

export const STATUS_LABEL: Record<string, { label: string; badge: string; dot: string }> = {
  queued: { label: 'Queued', badge: 'bg-zinc-800 text-zinc-300 border-zinc-700', dot: 'bg-zinc-400' },
  scripting: { label: 'Writing script', badge: 'bg-purple-950/70 text-purple-300 border-purple-800', dot: 'bg-purple-400' },
  voicing: { label: 'Recording voice', badge: 'bg-pink-950/70 text-pink-300 border-pink-800', dot: 'bg-pink-400' },
  visualizing: { label: 'Painting scenes', badge: 'bg-orange-950/70 text-orange-300 border-orange-800', dot: 'bg-orange-400' },
  rendering: { label: 'Rendering', badge: 'bg-yellow-950/70 text-yellow-300 border-yellow-800', dot: 'bg-yellow-400' },
  thumbnailing: { label: 'Thumbnail', badge: 'bg-teal-950/70 text-teal-300 border-teal-800', dot: 'bg-teal-400' },
  ready: { label: 'Ready', badge: 'bg-emerald-950/70 text-emerald-300 border-emerald-800', dot: 'bg-emerald-400' },
  uploading: { label: 'Uploading', badge: 'bg-fuchsia-950/70 text-fuchsia-300 border-fuchsia-800', dot: 'bg-fuchsia-400' },
  uploaded: { label: 'Published', badge: 'bg-green-950/70 text-green-300 border-green-800', dot: 'bg-green-400' },
  failed: { label: 'Failed', badge: 'bg-red-950/70 text-red-300 border-red-800', dot: 'bg-red-400' },
}
