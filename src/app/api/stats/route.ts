import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAutomation } from '@/lib/yt/settings'
import { getSetting } from '@/lib/yt/settings'
import { ensureScheduler } from '@/lib/yt/scheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  ensureScheduler()
  const [total, ready, uploaded, failed, active] = await Promise.all([
    db.video.count(),
    db.video.count({ where: { status: 'ready' } }),
    db.video.count({ where: { status: 'uploaded' } }),
    db.video.count({ where: { status: 'failed' } }),
    db.video.count({ where: { status: { in: ['queued', 'scripting', 'voicing', 'visualizing', 'rendering', 'thumbnailing', 'uploading'] } } }),
  ])
  const automation = await getAutomation()
  const nextRaw = await getSetting('nextAutoRunAt')
  const workerBusy = active > 0
  return NextResponse.json({
    total,
    ready,
    uploaded,
    failed,
    active,
    workerBusy,
    automation,
    nextAutoRunAt: nextRaw ? parseInt(nextRaw, 10) : null,
  })
}
