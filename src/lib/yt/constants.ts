// ─── TubeForge core constants ────────────────────────────────────────────
import path from 'path'

// Override with MEDIA_ROOT env var when deploying (e.g. a Render persistent disk)
export const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || path.join(process.cwd(), 'media'))

export type VideoFormat = 'short' | 'long'

export const VOICES = [
  { id: 'jam', label: 'Jam — British narrator', desc: 'Refined UK accent, great for facts & documentaries' },
  { id: 'kazi', label: 'Kazi — Clear standard', desc: 'Crisp neutral delivery, high clarity' },
  { id: 'luodo', label: 'Luodo — Expressive', desc: 'Energetic, infectious tone for hooks' },
  { id: 'xiaochen', label: 'Xiaochen — Calm pro', desc: 'Steady, professional documentary feel' },
  { id: 'tongtong', label: 'Tongtong — Warm', desc: 'Friendly and approachable' },
  { id: 'douji', label: 'Douji — Smooth flow', desc: 'Natural conversational pacing' },
  { id: 'chuichui', label: 'Chuichui — Lively', desc: 'Playful upbeat energy' },
] as const

export const FORMATS: Record<
  VideoFormat,
  {
    label: string
    resolution: { w: number; h: number }
    sceneCount: [number, number]
    sceneMaxChars: number
    captionWordsPerCard: number
    captionFontSize: number
    captionMarginV: number
    captionOutline: number
    genImageSize: string
    assPlayRes: { x: number; y: number }
    ttsSpeed: number
    targetDurSec: [number, number]
  }
> = {
  short: {
    label: 'YouTube Short',
    resolution: { w: 1080, h: 1920 },
    sceneCount: [6, 8],
    sceneMaxChars: 240,
    captionWordsPerCard: 3,
    captionFontSize: 82,
    captionMarginV: 420,
    captionOutline: 7,
    genImageSize: '768x1344',
    assPlayRes: { x: 1080, y: 1920 },
    ttsSpeed: 1.05,
    targetDurSec: [35, 60],
  },
  long: {
    label: 'Long-form video',
    resolution: { w: 1920, h: 1080 },
    sceneCount: [10, 13],
    sceneMaxChars: 620,
    captionWordsPerCard: 8,
    captionFontSize: 52,
    captionMarginV: 80,
    captionOutline: 4,
    genImageSize: '1344x768',
    assPlayRes: { x: 1920, y: 1080 },
    ttsSpeed: 1.0,
    targetDurSec: [150, 300],
  },
}

export const STATUS_META: Record<
  string,
  { label: string; color: string; badgeClass: string }
> = {
  queued: { label: 'Queued', color: '#a1a1aa', badgeClass: 'bg-zinc-800 text-zinc-300 border-zinc-700' },
  scripting: { label: 'Writing script', color: '#c084fc', badgeClass: 'bg-purple-950/60 text-purple-300 border-purple-800' },
  voicing: { label: 'Recording voice', color: '#f472b6', badgeClass: 'bg-pink-950/60 text-pink-300 border-pink-800' },
  visualizing: { label: 'Painting scenes', color: '#fb923c', badgeClass: 'bg-orange-950/60 text-orange-300 border-orange-800' },
  rendering: { label: 'Rendering video', color: '#facc15', badgeClass: 'bg-yellow-950/60 text-yellow-300 border-yellow-800' },
  thumbnailing: { label: 'Designing thumbnail', color: '#2dd4bf', badgeClass: 'bg-teal-950/60 text-teal-300 border-teal-800' },
  ready: { label: 'Ready', color: '#34d399', badgeClass: 'bg-emerald-950/60 text-emerald-300 border-emerald-800' },
  uploading: { label: 'Uploading', color: '#e879f9', badgeClass: 'bg-fuchsia-950/60 text-fuchsia-300 border-fuchsia-800' },
  uploaded: { label: 'Published', color: '#4ade80', badgeClass: 'bg-green-950/60 text-green-300 border-green-800' },
  failed: { label: 'Failed', color: '#f87171', badgeClass: 'bg-red-950/60 text-red-300 border-red-800' },
}

export const STAGE_ORDER = [
  'scripting',
  'voicing',
  'visualizing',
  'rendering',
  'thumbnailing',
] as const

export const ACTIVE_STATUSES = [
  'scripting',
  'voicing',
  'visualizing',
  'rendering',
  'thumbnailing',
  'uploading',
]

export const SEED_TOPICS = [
  '5 space facts that sound fake but are 100% real',
  'The most protected places on Earth (and why)',
  'Facts about the human brain that science cannot explain',
  'Things deeper in the ocean than you think',
  'Foods that exist only in one country',
  'Ancient inventions way ahead of their time',
  'The strangest weather phenomena ever recorded',
  'Animals that basically cannot die',
  'Mysteries hidden inside famous landmarks',
  'Everyday things that are illegal in other countries',
]

export interface AutomationConfig {
  enabled: boolean
  videosPerDay: number
  startHour: number
  endHour: number
  formats: 'short' | 'long' | 'mixed'
  niche: string
}

export const DEFAULT_AUTOMATION: AutomationConfig = {
  enabled: false,
  videosPerDay: 3,
  startHour: 8,
  endHour: 23,
  formats: 'mixed',
  niche: 'Facts & Curiosities',
}

export const CATEGORY_ID = '27' // Education
