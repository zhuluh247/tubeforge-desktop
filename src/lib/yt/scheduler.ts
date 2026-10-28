// ─── Fully-automatic scheduler: N videos/day, zero clicks ────────────────
import { db } from '@/lib/db'
import { getAutomation, setSetting, getSetting } from './settings'
import { generateAutoTopic } from './ai'
import { kickWorker, log } from './pipeline'
import { SEED_TOPICS, type VideoFormat } from './constants'

const g = globalThis as unknown as { __tfSchedulerBooted?: boolean }

function computeNextRun(videosPerDay: number, startHour: number, endHour: number): number {
  const interval = Math.max(30 * 60_000, (24 * 3600_000) / Math.max(1, videosPerDay))
  let next = Date.now() + interval
  // if outside the active window, push to the next window start
  const d = new Date(next)
  const h = d.getHours()
  if (h < startHour) {
    d.setHours(startHour, 0, 0, 0)
    next = d.getTime()
  } else if (h >= endHour) {
    d.setTime(next + 3600_000 * 24)
    d.setHours(startHour, 0, 0, 0)
    next = d.getTime()
  }
  return next
}

async function recentTitles(): Promise<string[]> {
  const rows = await db.video.findMany({
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: { title: true, topic: true },
  })
  return rows.map(r => r.title || r.topic).filter(Boolean)
}

async function pickFormat(formats: 'short' | 'long' | 'mixed'): Promise<VideoFormat> {
  if (formats !== 'mixed') return formats
  // balance: count existing, pick the rarer one
  const [shorts, longs] = await Promise.all([
    db.video.count({ where: { format: 'short' } }),
    db.video.count({ where: { format: 'long' } }),
  ])
  return shorts <= longs ? 'short' : 'long'
}

async function tick(): Promise<void> {
  try {
    const cfg = await getAutomation()
    if (!cfg.enabled) return

    const now = Date.now()
    const nextRaw = await getSetting('nextAutoRunAt')
    let nextAt = nextRaw ? parseInt(nextRaw, 10) : NaN

    // while disabled, keep re-arming so enabling starts fresh in ~45s
    if (!nextRaw || isNaN(nextAt)) {
      nextAt = now + 45_000
      await setSetting('nextAutoRunAt', String(nextAt))
      return
    }

    if (now < nextAt) return

    // schedule the following run first (so a slow generation can't tight-loop)
    const following = computeNextRun(cfg.videosPerDay, cfg.startHour, cfg.endHour)
    await setSetting('nextAutoRunAt', String(following))

    // enqueue one auto video
    const titles = await recentTitles()
    let topic: string
    try {
      topic = await generateAutoTopic(cfg.niche, titles)
    } catch {
      topic = SEED_TOPICS[Math.floor(Math.random() * SEED_TOPICS.length)]
    }
    const format = await pickFormat(cfg.formats)
    const v = await db.video.create({
      data: {
        topic,
        format,
        voice: (await getSetting('defaultVoice')) || 'jam',
        status: 'queued',
        source: 'auto',
      },
    })
    await log(v.id, 'system', `Auto-pilot scheduled this video (topic: "${topic}")`, 'success')
    console.log(`[scheduler] enqueued auto video ${v.id} — next run at ${new Date(following).toISOString()}`)

    kickWorker().catch(e => console.error('[scheduler] worker kick failed:', e))
  } catch (e) {
    console.error('[scheduler] tick error:', e)
  }
}

export function bootScheduler(): void {
  if (g.__tfSchedulerBooted) return
  g.__tfSchedulerBooted = true

  void (async () => {
    try {
      const { recoverOnBoot } = await import('./pipeline')
      const n = await recoverOnBoot()
      if (n > 0) console.log(`[boot] recovered ${n} in-flight video(s) back to queue`)
    } catch (e) {
      console.warn('[boot] recovery skipped:', e instanceof Error ? e.message : e)
    }
  })()

  setInterval(tick, 30_000)
  console.log('[boot] TubeForge auto-pilot scheduler running (tick every 30s)')
}

/** Idempotent lazy-start — safe to call from any API route. */
export function ensureScheduler(): void {
  if (!g.__tfSchedulerBooted) bootScheduler()
}
