import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { db } from '@/lib/db'
import { getYouTubeCreds, getSetting } from '@/lib/yt/settings'
import { uploadVideo, setThumbnail } from '@/lib/yt/youtube'
import { log } from '@/lib/yt/pipeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const video = await db.video.findUnique({ where: { id } })
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 })
    }
    if (video.status === 'uploading') {
      return NextResponse.json({ error: 'This video is already being uploaded right now' }, { status: 409 })
    }
    if (video.status === 'uploaded') {
      return NextResponse.json(
        { error: 'Already published to YouTube', youtubeId: video.youtubeId },
        { status: 409 }
      )
    }
    if (video.status !== 'ready' || !video.videoPath || !fs.existsSync(video.videoPath)) {
      return NextResponse.json(
        { error: 'This video is not ready yet (or its file is missing). Re-run the pipeline first.' },
        { status: 400 }
      )
    }

    const creds = await getYouTubeCreds()
    if (!creds) {
      return NextResponse.json(
        { error: 'YouTube is not connected yet. Open Settings → "Connect YouTube channel" and finish the 2-minute authorization.' },
        { status: 400 }
      )
    }

    const privacy = ((await getSetting('ytPrivacy')) || 'public') as 'public' | 'unlisted' | 'private'
    let tags: string[] = []
    try { tags = JSON.parse(video.tags || '[]') } catch { /* ignore */ }
    const title = video.title || video.topic
    const sizeMb = (fs.statSync(video.videoPath).size / 1e6).toFixed(1)

    await db.video.update({
      where: { id },
      data: { status: 'uploading', stage: 'Uploading to YouTube', progress: 55, error: null },
    })
    await log(id, 'upload', `Uploading "${title}" (${sizeMb} MB) to YouTube as ${privacy}…`)

    let youtubeId: string
    try {
      youtubeId = await uploadVideo(creds, video.videoPath, {
        title,
        description: video.description || '',
        tags,
        privacy,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await db.video.update({
        where: { id },
        data: { status: 'ready', stage: 'Ready (upload failed)', progress: 100, error: msg.slice(0, 800) },
      })
      await log(id, 'upload', `Upload failed: ${msg}`, 'error')
      return NextResponse.json({ error: msg }, { status: 502 })
    }

    await db.video.update({
      where: { id },
      data: { status: 'uploaded', stage: 'Published to YouTube', progress: 100, youtubeId, error: null },
    })
    await log(id, 'upload', `Published — https://youtu.be/${youtubeId}`, 'success')

    // thumbnail is best-effort: the video itself is already live
    if (video.thumbPath && fs.existsSync(video.thumbPath)) {
      try {
        await setThumbnail(creds, youtubeId, video.thumbPath)
        await log(id, 'upload', 'Custom thumbnail applied', 'success')
      } catch (e) {
        await log(id, 'upload', `Thumbnail upload failed (video published fine): ${e instanceof Error ? e.message : e}`, 'warn')
      }
    }

    return NextResponse.json({ ok: true, youtubeId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // restore state so the user can simply retry
    try {
      await db.video.updateMany({
        where: { id, status: 'uploading' },
        data: { status: 'ready', stage: 'Ready (upload failed)', progress: 100 },
      })
    } catch { /* ignore */ }
    return NextResponse.json({ error: `Upload error: ${msg}` }, { status: 500 })
  }
}
