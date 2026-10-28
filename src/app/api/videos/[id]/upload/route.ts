import { NextRequest, NextResponse } from 'next/server'
import { publishVideoToYouTube } from '@/lib/yt/publish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Manual publish (dashboard Publish button). Same atomic path auto-pilot uses. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const youtubeId = await publishVideoToYouTube(id)
    return NextResponse.json({ ok: true, youtubeId })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Upload failed' },
      { status: 400 }
    )
  }
}
