// ─── Fully-automatic scheduler: N videos/day, zero clicks ────────────────
// Slot grid: the day's videos are spread EVENLY across the active window
// (interval = window ÷ videosPerDay). The default window is the FULL 24h,
// so 6/day fires at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 server time
// (Africa/Lagos on Render) — exactly the even spacing users expect.
import { db } from '@/lib/db'
import { getAutomation, setSetting, getSetting } from './settings'
import { generateAutoTopic, fetchTrendingTopics } from './ai'
import { kickWorker, log } from './pipeline'
import { SEED_TOPICS, type VideoFormat } from './constants'

const g = globalThis as unknown as { __tfSchedulerBooted?: boolean }

function windowHours(startHour: number, endHour: number): number {
  return endHour > startHour ? endHour - startHour : 24
}

/** Even spacing: interval = activeWindow / videosPerDay (never shorter than
 *  30 min). No upper cap — the interval is exactly what the user's math
 *  predicts (24h ÷ 6/day = 4h). */
export function slotIntervalMs(videosPerDay: number, startHour: number, endHour: number): number {
  const n = Math.max(1, videosPerDay)
  const per = (windowHours(startHour, endHour) * 3600_000) / n
  return Math.max(30 * 60_000, per)
}

/** Next slot of the day's grid at/after `from`: windowStart + k·interval.
 *  When today's grid is exhausted, falls through to tomorrow's first slot. */
export function nextSlotMs(videosPerDay: number, startHour: number, endHour: number, from: number): number {
  const interval = slotIntervalMs(videosPerDay, startHour, endHour)
  const n = Math.max(1, videosPerDay)
  for (let day = 0; day < 8; day++) {
    const base = new Date(from)
    base.setDate(base.getDate() + day)
    base.setHours(startHour, 0, 0, 0)
    for (let k = 0; k < n; k++) {
      const t = base.getTime() + k * interval
      // a slot must still start inside the active window (endHour exclusive)
      if (endHour > startHour && endHour < 24 && new Date(t).getHours() >= endHour) break
      if (t >= from) return t
    }
  }
  return from + interval
}

async function recentTitles(): Promise<string[]> {
  const rows = await db.video.findMany({
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: { title: true, topic: true },
  })
  return rows.map(r => r.title || r.topic).filter(Boolean)
}

async function pickFormat(formats: 'short' | 'long' | 'story' | 'howto' | 'mixed'): Promise<VideoFormat> {
  if (formats === 'mixed') {
    // balance the two flagship content engines: pick the rarer one
    const [story, howto] = await Promise.all([
      db.video.count({ where: { format: 'story' } }),
      db.video.count({ where: { format: 'howto' } }),
    ])
    return story <= howto ? 'story' : 'howto'
  }
  return formats
}

async function tick(): Promise<void> {
  try {
    const cfg = await getAutomation()
    if (!cfg.enabled) return

    // sweep: auto-publish any Ready auto-video (crash recovery / backlog).
    // Only videos idle ≥5 min — a failed upload backs off instead of retry-looping.
    const sweep = await db.video.findFirst({
      where: { status: 'ready', source: 'auto', updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
      orderBy: { updatedAt: 'asc' },
    })
    if (sweep) {
      const { autoPublishIfEnabled } = await import('./publish')
      if (await autoPublishIfEnabled(sweep.id)) return // upload running — next tick continues
    }

    const now = Date.now()
    const nextRaw = await getSetting('nextAutoRunAt')
    const nextAt = nextRaw ? parseInt(nextRaw, 10) : NaN

    // while disabled, keep re-arming so enabling starts fresh in ~45s
    if (!nextRaw || isNaN(nextAt)) {
      await setSetting('nextAutoRunAt', String(now + 45_000))
      return
    }

    if (now < nextAt) return

    // schedule the following slot FIRST (so a slow generation can't tight-loop)
    const following = nextSlotMs(cfg.videosPerDay, cfg.startHour, cfg.endHour, Date.now() + 60_000)
    await setSetting('nextAutoRunAt', String(following))

    // enqueue one auto video (topics ride live Google Trends when available)
    const format = await pickFormat(cfg.formats)
    const titles = await recentTitles()
    const trends = await fetchTrendingTopics()
    let topic: string
    try {
      topic = await generateAutoTopic(cfg.niche, titles, format)
    } catch {
      topic = SEED_TOPICS[Math.floor(Math.random() * SEED_TOPICS.length)]
    }
    const v = await db.video.create({
      data: {
        topic,
        format,
        // empty voice = pipeline picks the format's signature voice
        // (story → expressive narrator, howto → calm British guide)
        voice: '',
        status: 'queued',
        source: 'auto',
      },
    })
    await log(v.id, 'system', trends.length
      ? `Auto-pilot picked a topic riding live Google Trends (top trend: "${trends[0]}") — topic: "${topic}"`
      : `Auto-pilot scheduled this video (topic: "${topic}")`, 'success')
    console.log(`[scheduler] enqueued auto video ${v.id} — next slot at ${new Date(following).toISOString()}`)

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
