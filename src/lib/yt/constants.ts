// ─── TubeForge core constants ────────────────────────────────────────────
import path from 'path'

// Override with MEDIA_ROOT env var when deploying (e.g. a Render persistent disk)
export const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || path.join(process.cwd(), 'media'))

export type VideoFormat = 'short' | 'long' | 'story' | 'howto'

// ── Render scale ────────────────────────────────────────────────
// 1080 (default) → Shorts 1080x1920, Long 1920x1080.
// 720            → Shorts 720x1280,  Long 1280x720 — ~56% fewer pixels,
//                  which on Render's free tier (512MB RAM, 0.1 CPU) is the
//                  difference between finishing and being OOM-killed.
// Caption layout scales with it automatically, so subtitles stay pixel-perfect.
const K = Math.min(2, Math.max(0.5, (Number(process.env.RENDER_SCALE) || 1080) / 1080))
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

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
    captionColor: string
    capsUppercase: boolean
    fps: number
    genImageSize: string
    assPlayRes: { x: number; y: number }
    ttsSpeed: number
    voice: string
    targetDurSec: [number, number]
  }
> = {
  short: {
    label: 'YouTube Short',
    resolution: { w: even(1080 * K), h: even(1920 * K) },
    sceneCount: [6, 8],
    sceneMaxChars: 220,
    captionWordsPerCard: Math.max(1, Number(process.env.CAPTION_WORDS_SHORT) || 1),
    captionFontSize: Math.max(18, Math.round(82 * K)),
    captionMarginV: Math.round(420 * K),
    captionOutline: Math.max(2, Math.round(7 * K)),
    captionColor: '&H00FFFFFF',
    capsUppercase: true,
    // 12 fps: half the frames of 24 → roughly half the encode time + RAM on
    // Render's free CPU, while Ken Burns motion still reads smoothly.
    fps: Math.min(30, Math.max(6, Number(process.env.FPS_SHORT) || 12)),
    genImageSize: '768x1344',
    assPlayRes: { x: even(1080 * K), y: even(1920 * K) },
    ttsSpeed: Number(process.env.TTS_SPEED_SHORT) || 1.18,
    voice: 'jam',
    targetDurSec: [35, 60],
  },
  long: {
    label: 'Long-form video',
    resolution: { w: even(1920 * K), h: even(1080 * K) },
    sceneCount: [10, 13],
    sceneMaxChars: 620,
    captionWordsPerCard: 8,
    captionFontSize: Math.max(18, Math.round(52 * K)),
    captionMarginV: Math.round(80 * K),
    captionOutline: Math.max(2, Math.round(4 * K)),
    captionColor: '&H00FFFFFF',
    capsUppercase: false,
    fps: 24,
    genImageSize: '1344x768',
    assPlayRes: { x: even(1920 * K), y: even(1080 * K) },
    ttsSpeed: 1.0,
    voice: 'jam',
    targetDurSec: [150, 300],
  },
  // ── Story-cartoon Short (the flagship format) ─────────────────────────
  // One protagonist, one shocking story, cliffhanger ending. Crossfaded
  // scenes with camera motion, word-synced captions, emotional music bed.
  story: {
    label: 'Story Short (9:16)',
    resolution: { w: even(1080 * K), h: even(1920 * K) },
    sceneCount: [6, 8],
    sceneMaxChars: 210,
    captionWordsPerCard: Math.max(1, Number(process.env.CAPTION_WORDS_STORY) || 2),
    captionFontSize: Math.max(18, Math.round(80 * K)),
    captionMarginV: Math.round(400 * K),
    captionOutline: Math.max(2, Math.round(7 * K)),
    captionColor: '&H004AE2FF', // warm yellow (BGR) — sample-look captions
    capsUppercase: false,
    fps: Math.min(30, Math.max(6, Number(process.env.FPS_STORY) || 12)),
    genImageSize: '768x1344',
    assPlayRes: { x: even(1080 * K), y: even(1920 * K) },
    ttsSpeed: Number(process.env.TTS_SPEED_STORY) || 1.35,
    voice: 'luodo',
    targetDurSec: [45, 75],
  },
  // ── How-To Educational (16:9) ─────────────────────────────────────────
  // Clean step cards + flat illustrations + calm narrator. No character
  // consistency needed, so it is the most reliable long-form engine.
  howto: {
    label: 'How-To Video (16:9)',
    resolution: { w: even(1920 * K), h: even(1080 * K) },
    sceneCount: [11, 13],
    sceneMaxChars: 240,
    captionWordsPerCard: 0, // step cards already carry the text — no burned captions
    captionFontSize: Math.max(18, Math.round(52 * K)),
    captionMarginV: Math.round(80 * K),
    captionOutline: Math.max(2, Math.round(4 * K)),
    captionColor: '&H00FFFFFF',
    capsUppercase: false,
    fps: Math.min(30, Math.max(12, Number(process.env.FPS_HOWTO) || 24)),
    genImageSize: '1344x768',
    assPlayRes: { x: even(1920 * K), y: even(1080 * K) },
    ttsSpeed: Number(process.env.TTS_SPEED_HOWTO) || 1.2,
    voice: 'jam',
    targetDurSec: [75, 115],
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

// ─── Story engine constants ───────────────────────────────────────────────

// Stories rotate across the globe so the channel never feels local-only.
// One region is drawn at random per video and fed to the scriptwriter.
export const STORY_REGIONS = [
  'Tokyo, Japan', 'Mexico City, Mexico', 'Mumbai, India', 'Berlin, Germany',
  'São Paulo, Brazil', 'Cairo, Egypt', 'Seoul, South Korea', 'New York, USA',
  'Istanbul, Türkiye', 'Jakarta, Indonesia', 'Nairobi, Kenya', 'Sydney, Australia',
  'Lagos, Nigeria', 'Paris, France', 'Bangkok, Thailand', 'Toronto, Canada',
]

// Story visual style — locked across every scene so the art direction never
// drifts inside one video.
export const STORY_STYLE =
  '3D Pixar-style cartoon, expressive character, vibrant saturated colors, dramatic cinematic lighting, ultra detailed, high quality render, no text, no watermark'

// Timeline geometry for the crossfaded story timeline (seconds).
export const STORY_XFADE = 0.5
export const STORY_LEAD = 0.2
export const STORY_TAIL = 0.9
export const STORY_LAST_TAIL = 1.4

export interface AutomationConfig {
  enabled: boolean
  videosPerDay: number
  startHour: number
  endHour: number
  autoUpload: boolean
  formats: 'short' | 'long' | 'story' | 'howto' | 'mixed'
  niche: string
}

export const DEFAULT_AUTOMATION: AutomationConfig = {
  enabled: false,
  videosPerDay: 6,
  startHour: 0,   // full 24h even grid: 6/day → 00:00, 04:00, 08:00, 12:00, 16:00, 20:00
  endHour: 24,
  autoUpload: true,
  formats: 'mixed',
  niche: 'Facts & Curiosities',
}

export const CATEGORY_ID = '27' // Education
