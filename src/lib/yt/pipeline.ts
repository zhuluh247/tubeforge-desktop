// ─── Pipeline orchestrator: script → voice → visuals → render → thumb ────
import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import {
  FORMATS, MEDIA_ROOT, STAGE_ORDER,
  STORY_XFADE, STORY_LEAD, STORY_TAIL, STORY_LAST_TAIL, STORY_STYLE,
  type VideoFormat,
} from './constants'
import {
  generateScript, generateAutoTopic, synthesizeSpeech,
  generateImage, sanitizeImagePrompt, sanitizeStoryPrompt, sanitizeHowtoPrompt,
  scriptDir, type VideoScript,
} from './ai'
import {
  probeDuration, makeSceneClip, concatClips, concatClipsXfade, concatVoices,
  mixNarrationTimeline, makeMusicBed, buildAssFile, finalRender, makeThumbnail,
  makeHowtoCards,
} from './media'
import { getDefaultVoice, getAutomation } from './settings'

interface SceneResolved {
  narration: string
  image: string
  audio: string | null
  dur: number
  start: number // start of the NARRATION on the final timeline
  caption: string
}

const GAP = 0.1 // seconds of pause between scenes — snappy, no dead air

/** Stable per-video seed for the image engine. Same seed + same character
 *  description across all scenes of one video = a consistent character look
 *  on seed-aware models (Pollinations flux). salt shifts the seed for
 *  one-off assets like the thumbnail so they don't clone a scene. */
function seedFor(videoId: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < videoId.length; i++) {
    h ^= videoId.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h) % 1_000_000_000
}

// howto segment geometry (sequential hard-cut timeline)
const HOWTO_LEAD = 0.25
const HOWTO_TAIL = 0.55
const HOWTO_SILENT = 2.0

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

async function resolveVoice(voice: string | null, format: VideoFormat): Promise<string> {
  const v = (voice || '').trim()
  if (v) return v
  return FORMATS[format].voice || (await getDefaultVoice())
}

export async function runPipeline(videoId: string): Promise<void> {
  const video = await db.video.findUnique({ where: { id: videoId } })
  if (!video) return
  const format = (['short', 'long', 'story', 'howto'].includes(video.format)
    ? video.format
    : 'short') as VideoFormat
  const dir = scriptDir(videoId)
  fs.mkdirSync(dir, { recursive: true })

  try {
    await db.video.update({ where: { id: videoId }, data: { error: null } })
    if (format === 'story') await renderStory(video, dir)
    else if (format === 'howto') await renderHowto(video, dir)
    else await renderFacts(video, format as 'short' | 'long', dir)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await log(videoId, 'error', `Pipeline failed: ${msg}`, 'error')
    await db.video.update({
      where: { id: videoId },
      data: { status: 'failed', stage: 'Failed', error: msg.slice(0, 800) },
    })
  }
}

async function resolveTopic(
  video: { id: string; topic: string },
  format: VideoFormat
): Promise<string> {
  let topic = video.topic
  if (!topic || topic === '__auto__') {
    const automation = await getAutomation()
    const recent = await db.video.findMany({
      where: { id: { not: video.id } },
      orderBy: { createdAt: 'desc' }, take: 12,
      select: { title: true },
    })
    topic = await generateAutoTopic(
      automation.niche,
      recent.map(r => r.title || '').filter(Boolean),
      format
    )
    await db.video.update({ where: { id: video.id }, data: { topic } })
    await log(video.id, 'script', `AI picked topic: "${topic}"`)
  }
  return topic
}

async function finish(
  videoId: string,
  dir: string,
  script: VideoScript,
  scenes: SceneResolved[],
  videoPath: string,
  thumbBaseSource: string
): Promise<void> {
  // ── Stage 5: Thumbnail ─────────────────────────────────────────────
  await setStage(videoId, 'thumbnailing', 'Designing thumbnail', 90)
  const thumbBase = path.join(dir, 'thumb_base.png')
  await generateImage(
    sanitizeImagePrompt(script.thumbnailPrompt + ', bold dramatic YouTube thumbnail background, high contrast'),
    '1344x768', thumbBase, 1,
    { seed: seedFor(videoId, 7919) }
  )
  const thumbPath = path.join(dir, 'thumb.jpg')
  await makeThumbnail(thumbBase || thumbBaseSource, script.thumbnailText, thumbPath, dir)
  fs.rmSync(thumbBase, { force: true })
  await db.video.update({ where: { id: videoId }, data: { thumbPath } })
  await log(videoId, 'thumbnail', `Thumbnail ready — "${script.thumbnailText}"`, 'success')

  // ── Disk diet ─────────────────────────────────────────────────────
  for (const s of scenes) {
    if (s.image) fs.rmSync(s.image, { force: true })
    if (s.audio) fs.rmSync(s.audio, { force: true })
  }

  await db.video.update({
    where: { id: videoId },
    data: { status: 'ready', stage: 'Ready to publish', progress: 100 },
  })
  await log(videoId, 'done', 'Video is ready. Auto-publish takes it from here — zero clicks.', 'success')
}

// ═══ Legacy facts pipeline (short / long) — unchanged behavior ═══════════

async function renderFacts(
  video: { id: string; topic: string; voice: string | null },
  format: 'short' | 'long',
  dir: string
): Promise<void> {
  const videoId = video.id
  const f = FORMATS[format]

  // ── Stage 1: Script + SEO ──────────────────────────────────────────
  await setStage(videoId, 'scripting', 'Writing script', 4)
  const topic = await resolveTopic(video, format)
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
  const voice = await resolveVoice(video.voice, format)
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
    const ctx = script.scenes[i].narration.replace(/\s+/g, ' ').trim().slice(0, 160)
    const visual = `${script.scenes[i].imagePrompt}. Depict exactly this moment: ${ctx}`
    await generateImage(
      sanitizeImagePrompt(visual),
      f.genImageSize, scenes[i].image, i,
      { seed: seedFor(videoId) }
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
    const clipDur = scenes[i].dur + (i < scenes.length - 1 ? GAP : 0)
    await makeSceneClip(scenes[i].image, clip, clipDur, format, i)
    clipPaths.push(clip)
    await setStage(videoId, 'rendering', `Animating ${i + 1}/${scenes.length}`, 56 + (14 * (i + 1)) / scenes.length)
  }

  await setStage(videoId, 'rendering', 'Stitching timeline', 72)
  const concatPath = path.join(dir, 'concat.mp4')
  await concatClips(clipPaths, concatPath)

  await setStage(videoId, 'rendering', 'Mixing audio', 78)
  const narrationPath = path.join(dir, 'narration.wav')
  await concatVoices(scenes.map(s => s.audio as string), GAP, narrationPath)

  await setStage(videoId, 'rendering', 'Burning captions', 82)
  const assPath = path.join(dir, 'captions.ass')
  buildAssFile(
    scenes.map(s => ({ narration: s.narration, dur: s.dur, start: s.start })),
    format, assPath
  )

  await setStage(videoId, 'rendering', 'Final encode', 85)
  const videoPath = path.join(dir, 'video.mp4')
  await finalRender({ concatVideo: concatPath, narrationWav: narrationPath, assPath, outPath: videoPath })
  clipPaths.forEach(c => fs.rmSync(c, { force: true }))
  fs.rmSync(concatPath, { force: true })
  fs.rmSync(assPath, { force: true })

  const realDur = await probeDuration(videoPath)
  await db.video.update({
    where: { id: videoId },
    data: { videoPath, durationSec: realDur },
  })
  await log(videoId, 'render', `Video rendered — ${realDur.toFixed(1)}s, ${(fs.statSync(videoPath).size / 1e6).toFixed(1)}MB`, 'success')

  await finish(videoId, dir, script, scenes, videoPath, scenes[0]?.image || '')
}

// ═══ Story pipeline: shocking global mini-story, crossfaded cartoon ══════

async function renderStory(
  video: { id: string; topic: string; voice: string | null },
  dir: string
): Promise<void> {
  const videoId = video.id
  const format: VideoFormat = 'story'
  const f = FORMATS[format]

  // ── Stage 1: Story script ──────────────────────────────────────────
  await setStage(videoId, 'scripting', 'Writing story', 4)
  const topic = await resolveTopic(video, format)
  const script = await generateScript(topic, format, 'Facts & Curiosities')
  await db.video.update({
    where: { id: videoId },
    data: {
      script: JSON.stringify(script),
      title: script.title,
      description: script.description,
      tags: JSON.stringify(script.tags),
    },
  })
  await log(videoId, 'script', `Story ready — ${script.scenes.length} scenes, lead: "${(script.character || '').slice(0, 80)}…"`, 'success')
  await setStage(videoId, 'scripting', 'Story ready', 12)

  // ── Stage 2: Voiceover ─────────────────────────────────────────────
  await setStage(videoId, 'voicing', 'Recording voice', 13)
  const voice = await resolveVoice(video.voice, format)
  const n = script.scenes.length
  const voiceDurs: number[] = []
  const voicePaths: string[] = []
  for (let i = 0; i < n; i++) {
    const wavPath = path.join(dir, `voice_${String(i).padStart(2, '0')}.wav`)
    await synthesizeSpeech(script.scenes[i].narration, voice, f.ttsSpeed, wavPath)
    voiceDurs.push(await probeDuration(wavPath))
    voicePaths.push(wavPath)
    await setStage(videoId, 'voicing', `Voice ${i + 1}/${n}`, 13 + (17 * (i + 1)) / n)
    await log(videoId, 'voice', `Scene ${i + 1} voiced — ${voiceDurs[i].toFixed(1)}s`)
  }

  // Timeline with crossfade overlap: scene clip = lead + voice + tail,
  // and the crossfade eats into the tail so narration never overlaps.
  const fps = f.fps
  const clipDurs: number[] = []
  const starts: number[] = []
  let t = 0
  for (let i = 0; i < n; i++) {
    const ideal = STORY_LEAD + voiceDurs[i] + (i < n - 1 ? STORY_TAIL : STORY_LAST_TAIL)
    const actual = Math.max(2, Math.round(ideal * fps)) / fps // zoompan frame quantum
    starts.push(t)
    clipDurs.push(actual)
    t += actual - STORY_XFADE
  }
  const totalDur = starts[n - 1] + clipDurs[n - 1]
  const scenes: SceneResolved[] = script.scenes.map((sc, i) => ({
    narration: sc.narration,
    caption: sc.caption,
    image: path.join(dir, `scene_${String(i).padStart(2, '0')}.png`),
    audio: voicePaths[i],
    dur: voiceDurs[i],
    start: starts[i] + STORY_LEAD, // narration start on the final timeline
  }))
  await db.video.update({
    where: { id: videoId },
    data: { scenesJson: JSON.stringify(scenes), durationSec: totalDur, audioPath: path.join(dir, 'narration.wav') },
  })
  await log(videoId, 'voice', `Voiceover complete — ${totalDur.toFixed(1)}s timeline`, 'success')

  // ── Stage 3: Consistent character art ──────────────────────────────
  await setStage(videoId, 'visualizing', 'Painting scenes', 31)
  const character = script.character || ''
  for (let i = 0; i < n; i++) {
    const ctx = script.scenes[i].narration.replace(/\s+/g, ' ').trim().slice(0, 150)
    const visual = `${character}. ${script.scenes[i].imagePrompt}. Depict exactly this moment: ${ctx}`
    await generateImage(
      sanitizeStoryPrompt(visual, STORY_STYLE),
      f.genImageSize, scenes[i].image, i,
      { preferZai: true, seed: seedFor(videoId) } // cartoon leads come out far better on the Z.ai engine
    )
    await setStage(videoId, 'visualizing', `Scene art ${i + 1}/${n}`, 31 + (24 * (i + 1)) / n)
    await log(videoId, 'visual', `Scene ${i + 1} art ready`)
  }
  await log(videoId, 'visual', 'All scene visuals ready', 'success')

  // ── Stage 4: Render (crossfades + captions + music) ────────────────
  await setStage(videoId, 'rendering', 'Animating scenes', 56)
  const clipPaths: string[] = []
  for (let i = 0; i < n; i++) {
    const clip = path.join(dir, `clip_${String(i).padStart(2, '0')}.mp4`)
    await makeSceneClip(scenes[i].image, clip, clipDurs[i], format, i)
    clipPaths.push(clip)
    await setStage(videoId, 'rendering', `Animating ${i + 1}/${n}`, 56 + (14 * (i + 1)) / n)
  }

  await setStage(videoId, 'rendering', 'Crossfade stitching', 72)
  const concatPath = path.join(dir, 'concat.mp4')
  await concatClipsXfade(clipPaths, clipDurs, STORY_XFADE, fps, concatPath)

  await setStage(videoId, 'rendering', 'Mixing audio', 78)
  const narrationPath = path.join(dir, 'narration.wav')
  await mixNarrationTimeline(
    scenes.map(s => ({ wav: s.audio, start: s.start })),
    totalDur, narrationPath
  )
  const musicPath = path.join(dir, 'music.wav')
  makeMusicBed('story', totalDur, musicPath)

  await setStage(videoId, 'rendering', 'Burning captions', 82)
  const assPath = path.join(dir, 'captions.ass')
  buildAssFile(
    scenes.map(s => ({ narration: s.narration, dur: s.dur, start: s.start })),
    format, assPath
  )

  await setStage(videoId, 'rendering', 'Final encode', 85)
  const videoPath = path.join(dir, 'video.mp4')
  await finalRender({
    concatVideo: concatPath, narrationWav: narrationPath, assPath,
    outPath: videoPath, musicWav: musicPath, musicVol: 0.16,
  })
  clipPaths.forEach(c => fs.rmSync(c, { force: true }))
  fs.rmSync(concatPath, { force: true })
  fs.rmSync(assPath, { force: true })
  fs.rmSync(musicPath, { force: true })

  const realDur = await probeDuration(videoPath)
  await db.video.update({
    where: { id: videoId },
    data: { videoPath, durationSec: realDur },
  })
  await log(videoId, 'render', `Story rendered — ${realDur.toFixed(1)}s, ${(fs.statSync(videoPath).size / 1e6).toFixed(1)}MB`, 'success')

  await finish(videoId, dir, script, scenes, videoPath, scenes[0]?.image || '')
}

// ═══ How-To pipeline: clean 5-step educational video ═════════════════════

async function renderHowto(
  video: { id: string; topic: string; voice: string | null },
  dir: string
): Promise<void> {
  const videoId = video.id
  const format: VideoFormat = 'howto'
  const f = FORMATS[format]

  // ── Stage 1: How-to script ─────────────────────────────────────────
  await setStage(videoId, 'scripting', 'Writing guide', 4)
  const topic = await resolveTopic(video, format)
  const script = await generateScript(topic, format, 'Facts & Curiosities')
  await db.video.update({
    where: { id: videoId },
    data: {
      script: JSON.stringify(script),
      title: script.title,
      description: script.description,
      tags: JSON.stringify(script.tags),
    },
  })
  await log(videoId, 'script', `Guide ready — ${script.scenes.length} segments, title "${script.title}"`, 'success')
  await setStage(videoId, 'scripting', 'Guide ready', 12)

  // ── Stage 2: Voiceover (skip silent segments) ──────────────────────
  await setStage(videoId, 'voicing', 'Recording voice', 13)
  const voice = await resolveVoice(video.voice, format)
  const segs = script.scenes
  const n = segs.length
  const voiceDurs: (number | null)[] = []
  const voicePaths: (string | null)[] = []
  let voiced = 0
  for (let i = 0; i < n; i++) {
    if (segs[i].silent || !segs[i].narration.trim()) {
      voiceDurs.push(null); voicePaths.push(null)
      continue
    }
    const wavPath = path.join(dir, `voice_${String(i).padStart(2, '0')}.wav`)
    await synthesizeSpeech(segs[i].narration, voice, f.ttsSpeed, wavPath)
    const dur = await probeDuration(wavPath)
    voiceDurs.push(dur); voicePaths.push(wavPath)
    voiced++
    await setStage(videoId, 'voicing', `Voice ${voiced}/${n}`, 13 + (17 * (i + 1)) / n)
    await log(videoId, 'voice', `Segment ${i + 1} voiced — ${dur.toFixed(1)}s`)
  }

  // Sequential timeline (hard cuts)
  const starts: number[] = []
  const segDurs: number[] = []
  let t = 0
  for (let i = 0; i < n; i++) {
    starts.push(t)
    segDurs.push(voiceDurs[i] == null ? HOWTO_SILENT : HOWTO_LEAD + (voiceDurs[i] as number) + HOWTO_TAIL)
    t += segDurs[i]
  }
  const totalDur = t
  const scenes: SceneResolved[] = segs.map((sc, i) => ({
    narration: sc.narration,
    caption: sc.caption,
    image: path.join(dir, `scene_${String(i).padStart(2, '0')}.png`),
    audio: voicePaths[i],
    dur: voiceDurs[i] ?? 0,
    start: starts[i] + (voiceDurs[i] == null ? 0 : HOWTO_LEAD),
  }))
  await db.video.update({
    where: { id: videoId },
    data: { scenesJson: JSON.stringify(scenes), durationSec: totalDur, audioPath: path.join(dir, 'narration.wav') },
  })
  await log(videoId, 'voice', `Voiceover complete — ${totalDur.toFixed(1)}s timeline`, 'success')

  // ── Stage 3: Step cards + illustrations ────────────────────────────
  await setStage(videoId, 'visualizing', 'Building slides', 31)
  const cardDefs = segs.map(sc => sc.card)
  const cardIdx = cardDefs.map((c, i) => (c ? i : -1)).filter(i => i >= 0)
  const stepTitles = segs
    .map(sc => (sc.card?.kind === 'step' ? sc.card.line1 : ''))
    .filter(Boolean)
  const cardOutPaths: string[] = segs.map((_, i) => path.join(dir, `scene_${String(i).padStart(2, '0')}.png`))
  const onlyCardOuts = cardIdx.map(i => cardOutPaths[i])
  const onlyCards = cardIdx.map(i => cardDefs[i]!) as { kind: 'title' | 'step' | 'recap' | 'outro'; stepNumber?: number; line1: string; line2?: string }[]
  await makeHowtoCards(onlyCards, stepTitles, dir, f.resolution.w, f.resolution.h, onlyCardOuts)
  let art = 0
  for (let i = 0; i < n; i++) {
    if (cardDefs[i]) continue // already rendered as a card
    await generateImage(
      sanitizeHowtoPrompt(segs[i].imagePrompt),
      f.genImageSize, cardOutPaths[i], i,
      { seed: seedFor(videoId) }
    )
    art++
    await setStage(videoId, 'visualizing', `Art ${art}/${n}`, 31 + (24 * (i + 1)) / n)
    await log(videoId, 'visual', `Segment ${i + 1} art ready`)
  }
  await log(videoId, 'visual', 'All visuals ready', 'success')

  // ── Stage 4: Render ────────────────────────────────────────────────
  await setStage(videoId, 'rendering', 'Animating scenes', 56)
  const clipPaths: string[] = []
  for (let i = 0; i < n; i++) {
    const clip = path.join(dir, `clip_${String(i).padStart(2, '0')}.mp4`)
    await makeSceneClip(scenes[i].image, clip, segDurs[i], format, cardDefs[i] ? -1 : i)
    clipPaths.push(clip)
    await setStage(videoId, 'rendering', `Animating ${i + 1}/${n}`, 56 + (14 * (i + 1)) / n)
  }

  await setStage(videoId, 'rendering', 'Stitching timeline', 72)
  const concatPath = path.join(dir, 'concat.mp4')
  await concatClips(clipPaths, concatPath)

  await setStage(videoId, 'rendering', 'Mixing audio', 78)
  const narrationPath = path.join(dir, 'narration.wav')
  await mixNarrationTimeline(
    scenes.map(s => ({ wav: s.audio, start: s.start })),
    totalDur, narrationPath
  )
  const musicPath = path.join(dir, 'music.wav')
  makeMusicBed('howto', totalDur, musicPath)

  await setStage(videoId, 'rendering', 'Final encode', 85)
  const videoPath = path.join(dir, 'video.mp4')
  await finalRender({
    concatVideo: concatPath, narrationWav: narrationPath, assPath: null,
    outPath: videoPath, musicWav: musicPath, musicVol: 0.13,
  })
  clipPaths.forEach(c => fs.rmSync(c, { force: true }))
  fs.rmSync(concatPath, { force: true })
  fs.rmSync(musicPath, { force: true })

  const realDur = await probeDuration(videoPath)
  await db.video.update({
    where: { id: videoId },
    data: { videoPath, durationSec: realDur },
  })
  await log(videoId, 'render', `How-to rendered — ${realDur.toFixed(1)}s, ${(fs.statSync(videoPath).size / 1e6).toFixed(1)}MB`, 'success')

  await finish(videoId, dir, script, scenes, videoPath, cardOutPaths[1] || cardOutPaths[0] || '')
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
      // Auto-publish: Auto-Pilot videos go straight to YouTube — zero clicks.
      // (No-op for manual videos and when auto-publish is off / YT not connected.)
      try {
        const { autoPublishIfEnabled } = await import('./publish')
        await autoPublishIfEnabled(next.id)
      } catch { /* publish.ts logs its own errors */ }
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
    // 'uploading' means the render FINISHED and only the upload died — the
    // video file is intact, so restore it to Ready (auto-publish / the
    // dashboard button will retry) instead of re-rendering from scratch.
    const wasUploading = v.status === 'uploading'
    await db.video.update({
      where: { id: v.id },
      data: {
        status: wasUploading ? 'ready' : 'queued',
        stage: wasUploading ? 'Ready (upload recovered)' : 'Queued (recovered)',
      },
    })
    await log(v.id, 'system', wasUploading
      ? 'Server restarted during upload — video is intact, re-queued for publishing.'
      : 'Server restarted mid-job — video requeued automatically.', 'warn')
  }
  return stuck.length
}

export function mediaPath(...parts: string[]): string {
  return path.join(MEDIA_ROOT, ...parts)
}
