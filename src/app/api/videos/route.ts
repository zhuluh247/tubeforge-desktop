import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { kickWorker } from '@/lib/yt/pipeline'
import { getDefaultVoice } from '@/lib/yt/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const videos = await db.video.findMany({
    orderBy: { createdAt: 'desc' },
    include: { logs: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })
  return NextResponse.json({ videos })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
    const format = body.format === 'long' ? 'long' : 'short'
    const voice = typeof body.voice === 'string' && body.voice ? body.voice : await getDefaultVoice()
    const count = Math.min(5, Math.max(1, parseInt(body.count, 10) || 1))
    if (topic && topic !== '__auto__' && topic.length > 200) {
      return NextResponse.json({ error: 'Topic too long (max 200 chars)' }, { status: 400 })
    }

    const created: Awaited<ReturnType<typeof db.video.create>>[] = []
    for (let i = 0; i < count; i++) {
      const v = await db.video.create({
        data: {
          topic: topic || '__auto__',
          format,
          voice,
          status: 'queued',
          source: 'manual',
        },
      })
      created.push(v)
    }
    kickWorker().catch(() => {})
    return NextResponse.json({ created })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to create video' },
      { status: 500 }
    )
  }
}
