// ─── Publishing: one code path for the dashboard button AND auto-pilot ────
import fs from 'fs'
import { db } from '@/lib/db'
import { getAutomation, getSetting, getYouTubeCreds } from './settings'
import { uploadVideo, setThumbnail } from './youtube'

async function log(videoId: string, stage: string, message: string, level = 'info') {
  try {
    await db.videoLog.create({ data: { videoId, stage, message: message.slice(0, 900), level } })
  } catch { /* logging must never kill publishing */ }
}

/** Publish one video to YouTube (video + best-effort custom thumbnail).
 *  The atomic claim (ready → uploading in ONE query) guarantees that the
 *  dashboard button, the render worker and the scheduler sweep can never
 *  double-upload the same video. Returns the YouTube video id. */
export async function publishVideoToYouTube(videoId: string): Promise<string> {
  const video = await db.video.findUnique({ where: { id: videoId } })
  if (!video) throw new Error('Video not found')
  if (video.status === 'uploaded' && video.youtubeId) return video.youtubeId
  if (video.status !== 'ready') {
    throw new Error(`Video is "${video.status}" — only Ready videos can be published`)
  }
  if (!video.videoPath || !fs.existsSync(video.videoPath)) {
    throw new Error('Rendered file is missing — retry the video from the dashboard first')
  }

  const creds = await getYouTubeCreds()
  if (!creds) {
    throw new Error('YouTube is not connected — open Settings → YouTube and connect your channel first')
  }

  // atomic claim: exactly one caller wins the upload
  const claim = await db.video.updateMany({
    where: { id: videoId, status: 'ready' },
    data: { status: 'uploading', stage: 'Uploading to YouTube', error: null },
  })
  if (claim.count === 0) throw new Error('Video is already being published')

  try {
    let tags: string[] = []
    try {
      const parsed: unknown = JSON.parse(video.tags || '[]')
      if (Array.isArray(parsed)) tags = parsed.map(String).filter(Boolean).slice(0, 15)
    } catch { /* keep empty */ }
    const privacy = ((await getSetting('ytPrivacy')) || 'public') as 'public' | 'unlisted' | 'private'

    const youtubeId = await uploadVideo(creds, video.videoPath, {
      title: video.title || video.topic || 'TubeForge video',
      description: video.description || '',
      tags,
      privacy,
    })

    if (video.thumbPath && fs.existsSync(video.thumbPath)) {
      // best effort — a failed thumbnail must never fail a finished upload
      await setThumbnail(creds, youtubeId, video.thumbPath).catch(e => {
        console.warn(`[publish] thumbnail skipped: ${e instanceof Error ? e.message : e}`)
      })
    }

    await db.video.update({
      where: { id: videoId },
      data: { status: 'uploaded', stage: 'Published on YouTube', youtubeId, progress: 100 },
    })
    await log(videoId, 'upload', `Published to YouTube — https://youtube.com/watch?v=${youtubeId}`, 'success')
    return youtubeId
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // back to Ready so auto-publish / the dashboard button can retry later
    await db.video.update({
      where: { id: videoId },
      data: { status: 'ready', stage: 'Ready to publish', error: `Upload failed: ${msg.slice(0, 700)}` },
    })
    await log(videoId, 'upload', `Upload failed: ${msg}`, 'error')
    throw e
  }
}

/** Auto-pilot path: publish by itself when Auto-Pilot is on, auto-publish is
 *  enabled, the video came from Auto-Pilot, and YouTube is connected.
 *  Returns true when a publish actually ran. */
export async function autoPublishIfEnabled(videoId: string): Promise<boolean> {
  try {
    const [cfg, creds, v] = await Promise.all([
      getAutomation(),
      getYouTubeCreds(),
      db.video.findUnique({ where: { id: videoId }, select: { source: true, status: true } }),
    ])
    if (!cfg.enabled || !cfg.autoUpload) return false
    if (!v || v.source !== 'auto' || v.status !== 'ready') return false
    if (!creds) {
      await log(videoId, 'upload', 'Auto-publish skipped — connect YouTube in Settings → YouTube. Video stays Ready.', 'warn')
      return false
    }
    await publishVideoToYouTube(videoId)
    return true
  } catch {
    return false // failure details are already logged on the video
  }
}
