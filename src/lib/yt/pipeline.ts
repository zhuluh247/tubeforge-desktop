// ─── Pipeline orchestrator: script → voice → visuals → render → thumb ────
import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import {
  FORMATS, MEDIA_ROOT, STAGE_ORDER, type VideoFormat,
} from './constants'
import {
  generateScript, generateAutoTopic, synthesizeSpeech,
  generateImage, sanitizeImagePrompt, scriptDir, type VideoScript,
} from './ai'
import {
  probeDuration, makeSceneClip, concatClips, concatVoices,
  buildAssFile, finalRender, makeThumbnail,
} from './media'
import { getDefaultVoice, getAutomation } from './settings'

interface SceneResolved {
  narration: string
  image: string
  audio: string
  dur: number
  start: number
  caption: string
}

const GAP = 0.22 // seconds of pause between scenes

export async function log(videoId: string, stage: string, message: string, level = 'info') {
  try {
    await db.videoLog.create({ data: { videoId, stage, message: message.slice(0, 900), level } })
  } catch { /* logging must never kill the pipeline */ }
}

async function setStage(videoId: string, status: string, stage: string, progress?: number) {
  const data: Record<string, unknown> = { status, stage }
  if (progress !== undefined) data.progress = Math.round(progress)
  await db.video.update({ where: { id: videoId }, data })
}

export async function runPipeline(videoId: string): Promise<void> {
  const video = await db.video.findUnique({ where: { id: videoId } })
  if (!video) return
  const format = (video.format === 'long' ? 'long' : 'short') as VideoFormat
  const f = FORMATS[format]
  const dir = scriptDir(videoId)
  fs.mkdirSync(dir, { recursive: true })

  try {
    await db.video.update({ where: { id: videoId }, data: { error: null } })

    // ── Stage 1: Script + SEO ──────────────────────────────────────────
    await setStage(videoId, 'scripting', 'Writing script', 4)
    let topic = video.topic
    if (!topic || topic === '__auto__') {
      const automation = await getAutomation()
      const recent = await db.video.findMany({
        where: { id: { not: videoId } },
        orderBy: { createdAt: 'desc' }, take: 12,
        select: { title: true },
      })
      topic = await generateAutoTopic(
        automation.niche,
        recent.map(r => r.title || '').filter(Boolean)
      )
      await db.video.update({ where: { id: videoId }, data: { topic } })
      await log(videoId, 'script', `AI picked topic: "${topic}"`)
    }

    const script: VideoScript = await generateScript(topic, format, 'Facts & Curiosities')
    await db.video.update({
      where: { id: videoId },
      data: {
        script: JSON.stringify(script),
        title: script.title,
        description: script.description,
        tags: JSON.stringify(script.tags),
      },
    })
    await log(videoId, 'script', `Script ready — ${script.scenes.length} scenes, title "${script.title}"`, 'success')
    await setStage(videoId, 'scripting', 'Script ready', 12)

    // ── Stage 2: Voiceover (TTS per scene) ─────────────────────────────
    await setStage(videoId, 'voicing', 'Recording voice', 13)
    const voice = video.voice || (await getDefaultVoice())
    const scenes: SceneResolved[] = []
    let cursor = 0
    for (let i = 0; i < script.scenes.length; i++) {
      const sc = script.scenes[i]
      const wavPath = path.join(dir, `voice_${String(i).padStart(2, '0')}.wav`)
      await synthesizeSpeech(sc.narration, voice, f.ttsSpeed, wavPath)
      const dur = await probeDuration(wavPath)
      scenes.push({
        narration: sc.narration,
        caption: sc.caption,
        image: path.join(dir, `scene_${String(i).padStart(2, '0')}.png`),
        audio: wavPath,
        dur,
        start: cursor,
      })
      cursor += dur + GAP
      await setStage(videoId, 'voicing', `Voice ${i + 1}/${script.scenes.length}`, 13 + (17 * (i + 1)) / script.scenes.length)
      await log(videoId, 'voice', `Scene ${i + 1} voiced — ${dur.toFixed(1)}s`)
    }
    const totalDur = cursor - GAP
    await db.video.update({
      where: { id: videoId },
      data: { scenesJson: JSON.stringify(scenes), durationSec: totalDur, audioPath: path.join(dir, 'narration.wav') },
    })
    await log(videoId, 'voice', `Voiceover complete — ${totalDur.toFixed(1)}s total`, 'success')

    // ── Stage 3: AI scene images ───────────────────────────────────────
    await setStage(videoId, 'visualizing', 'Painting scenes', 31)
    for (let i = 0; i < scenes.length; i++) {
      await generateImage(
        sanitizeImagePrompt(script.scenes[i].imagePrompt),
        f.genImageSize, scenes[i].image, i
      )
      await setStage(videoId, 'visualizing', `Scene art ${i + 1}/${scenes.length}`, 31 + (24 * (i + 1)) / scenes.length)
      await log(videoId, 'visual', `Scene ${i + 1} art ready`)
    }
    await log(videoId, 'visual', 'All scene visuals ready', 'success')

    // ── Stage 4: Render ────────────────────────────────────────────────
    await setStage(videoId, 'rendering', 'Animating scenes', 56)
    const clipPaths: string[] = []
    for (let i = 0; i < scenes.length; i++) {
      const clip = path.join(dir, `clip_${String(i).padStart(2, '0')}.mp4`)
      await makeSceneClip(scenes[i].image, clip, scenes[i].dur, format, i)
      clipPaths.push(clip)
      await setStage(videoId, 'rendering', `Animating ${i + 1}/${scenes.length}`, 56 + (14 * (i + 1)) / scenes.length)
    }

    await setStage(videoId, 'rendering', 'Stitching timeline', 72)
    const concatPath = path.join(dir, 'concat.mp4')
    await concatClips(clipPaths, concatPath)

    await setStage(videoId, 'rendering', 'Mixing audio', 78)
    const narrationPath = path.join(dir, 'narration.wav')
    await concatVoices(scenes.map(s => s.audio), GAP, narrationPath)

    await setStage(videoId, 'rendering', 'Burning captions', 82)
    const assPath = path.join(dir, 'captions.ass')
    buildAssFile(
      scenes.map(s => ({ narration: s.narration, dur: s.dur, start: s.start })),
      format, assPath
    )

    await setStage(videoId, 'rendering', 'Final encode', 85)
    const videoPath = path.join(dir, 'video.mp4')
    await finalRender({
      concatVideo: concatPath,
      narrationWav: narrationPath,
      assPath,
      outPath: videoPath,
    })
    // cleanup intermediates
    clipPaths.forEach(c => fs.rmSync(c, { force: true }))
    fs.rmSync(concatPath, { force: true })
    fs.rmSync(assPath, { force: true })

    const realDur = await probeDuration(videoPath)
    await db.video.update({
      where: { id: videoId },
      data: { videoPath, durationSec: realDur },
    })
    await log(videoId, 'render', `Video rendered — ${realDur.toFixed(1)}s, ${(fs.statSync(videoPath).size / 1e6).toFixed(1)}MB`, 'success')

    // ── Stage 5: Thumbnail ─────────────────────────────────────────────
    await setStage(videoId, 'thumbnailing', 'Designing thumbnail', 90)
    const thumbBase = path.join(dir, 'thumb_base.png')
    await generateImage(
      sanitizeImagePrompt(script.thumbnailPrompt + ', bold dramatic YouTube thumbnail background, high contrast'),
      '1344x768', thumbBase, 1
    )
    const thumbPath = path.join(dir, 'thumb.jpg')
    await makeThumbnail(thumbBase, script.thumbnailText, thumbPath, dir)
    fs.rmSync(thumbBase, { force: true })
    await db.video.update({ where: { id: videoId }, data: { thumbPath } })
    await log(videoId, 'thumbnail', `Thumbnail ready — "${script.thumbnailText}"`, 'success')

    // ── Done ───────────────────────────────────────────────────────────
    await db.video.update({
      where: { id: videoId },
      data: { status: 'ready', stage: 'Ready to publish', progress: 100 },
    })
    await log(videoId, 'done', 'Video is ready. Publish from the dashboard or let auto-upload handle it.', 'success')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await log(videoId, 'error', `Pipeline failed: ${msg}`, 'error')
    await db.video.update({
      where: { id: videoId },
      data: { status: 'failed', stage: 'Failed', error: msg.slice(0, 800) },
    })
  }
}

// ─── Sequential queue worker (singleton across hot reloads) ──────────────

const g = globalThis as unknown as { __tfWorkerBusy?: boolean }

export async function kickWorker(): Promise<void> {
  if (g.__tfWorkerBusy) return
  g.__tfWorkerBusy = true
  try {
    for (;;) {
      const next = await db.video.findFirst({
        where: { status: 'queued' },
        orderBy: { createdAt: 'asc' },
      })
      if (!next) break
      await runPipeline(next.id)
    }
  } catch (e) {
    console.error('[worker] crashed:', e)
  } finally {
    g.__tfWorkerBusy = false
  }
}

/** Crash recovery: reset stale in-flight videos back to queued on boot. */
export async function recoverOnBoot(): Promise<number> {
  // A live worker updates the row at every stage — but a single final render
  // can legitimately run 10-20 min on weak CPUs (Render free tier), so the
  // stale window must comfortably exceed that.
  const STALE_MS = 20 * 60_000
  const stuck = await db.video.findMany({
    where: {
      status: { in: [...STAGE_ORDER, 'uploading'] },
      updatedAt: { lt: new Date(Date.now() - STALE_MS) },
    },
  })
  for (const v of stuck) {
    await db.video.update({
      where: { id: v.id },
      data: { status: 'queued', stage: 'Queued (recovered)' },
    })
    await log(v.id, 'system', 'Server restarted mid-job — video requeued automatically.', 'warn')
  }
  return stuck.length
}

export function mediaPath(...parts: string[]): string {
  return path.join(MEDIA_ROOT, ...parts)
}
