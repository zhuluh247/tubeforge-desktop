import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { db } from '@/lib/db'
import { kickWorker } from '@/lib/yt/pipeline'
import { scriptDir } from '@/lib/yt/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const video = await db.video.findUnique({ where: { id } })
  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (['scripting', 'voicing', 'visualizing', 'rendering', 'thumbnailing', 'uploading'].includes(video.status)) {
    return NextResponse.json({ error: 'Video is currently processing' }, { status: 409 })
  }
  // wipe previous attempt artifacts so stale files never leak into the retry
  try {
    fs.rmSync(scriptDir(id), { recursive: true, force: true })
  } catch { /* best effort */ }
  await db.video.update({
    where: { id },
    data: {
      status: 'queued',
      stage: 'Queued (retry)',
      progress: 0,
      error: null,
      videoPath: null,
      thumbPath: null,
      audioPath: null,
      scenesJson: null,
      durationSec: null,
    },
  })
  kickWorker().catch(() => {})
  return NextResponse.json({ ok: true })
}
