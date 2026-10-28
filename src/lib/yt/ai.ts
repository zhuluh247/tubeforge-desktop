// ─── AI layer: LLM script/SEO + TTS + image generation ──────────────────
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'
import path from 'path'
import { FORMATS, MEDIA_ROOT, type VideoFormat } from './constants'

let _zai: ZAI | null = null
export async function getZAI(): Promise<ZAI> {
  if (!_zai) _zai = await ZAI.create()
  return _zai
}

async function chat(system: string, user: string, attempts = 3): Promise<string> {
  let lastErr: unknown
  for (let i = 1; i <= attempts; i++) {
    try {
      const zai = await getZAI()
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: system },
          { role: 'user', content: user },
        ],
        thinking: { type: 'disabled' },
      })
      const content = completion.choices[0]?.message?.content?.trim()
      if (!content) throw new Error('Empty AI response')
      return content
    } catch (e) {
      lastErr = e
      if (i < attempts) await new Promise(r => setTimeout(r, 1200 * i))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    /* fallthrough */
  }
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first !== -1 && last > first) {
    const slice = text.slice(first, last + 1)
    try {
      return JSON.parse(slice)
    } catch {
      /* fallthrough */
    }
  }
  throw new Error('AI did not return valid JSON')
}

// ─── Script + SEO generation ─────────────────────────────────────────────

export interface ScriptScene {
  narration: string
  imagePrompt: string
  caption: string
}
export interface VideoScript {
  title: string
  hook: string
  scenes: ScriptScene[]
  description: string
  tags: string[]
  thumbnailText: string
  thumbnailPrompt: string
}

export async function generateScript(
  topic: string,
  format: VideoFormat,
  niche: string
): Promise<VideoScript> {
  const f = FORMATS[format]
  const [minScenes, maxScenes] = f.sceneCount
  const sys = `You are a viral YouTube faceless-channel scriptwriter for the "${niche}" niche. You write tight, factual, high-retention narration. You ALWAYS reply with valid JSON only — no markdown fences, no commentary.`

  const user = `Write a complete production package for a ${f.label} about: "${topic}".

Requirements:
- EXACTLY ${minScenes} to ${maxScenes} scenes. Each scene is one beat of the video.
- Each scene.narration: spoken words for that scene, max ${f.sceneMaxChars} characters. Write for text-to-speech: plain sentences, no emojis, no markdown, no abbreviations with periods like "Dr." or "U.S." (write them out), spell numbers so they sound natural.
- Each scene.imagePrompt: a vivid, cinematic AI image prompt describing what to show (style: cinematic, dramatic lighting, photorealistic). No text/words/captions in the image.
- Each scene.caption: a 3-6 word punchy caption summarizing the scene (used as on-screen text).
- Scene 1 narration is the HOOK: a shocking claim or question in the first 2 seconds. The script.hook field repeats scene 1 narration.
- script.title: clickbait-but-true YouTube title, max 90 chars.
- script.description: 2-3 sentence SEO description with a call to subscribe.
- script.tags: 10-14 lowercase SEO tags (single words or short phrases).
- script.thumbnailText: 2-4 words, ALL CAPS, shocking, for the thumbnail (e.g. "IT NEVER ENDS").
- script.thumbnailPrompt: cinematic AI image prompt for the thumbnail background, one clear focal subject, dramatic colors, high contrast.

Reply with EXACTLY this JSON shape:
{"title":"...","hook":"...","scenes":[{"narration":"...","imagePrompt":"...","caption":"..."}],"description":"...","tags":["..."],"thumbnailText":"...","thumbnailPrompt":"..."}`

  const raw = await chat(sys, user)
  const parsed = extractJson(raw) as VideoScript
  if (!parsed?.scenes?.length) throw new Error('Script missing scenes')
  // sanitize
  parsed.scenes = parsed.scenes
    .filter(s => s?.narration?.trim())
    .map(s => ({
      narration: s.narration.trim(),
      imagePrompt: (s.imagePrompt || 'cinematic abstract background').trim(),
      caption: (s.caption || '').trim().slice(0, 60),
    }))
  parsed.title = (parsed.title || topic).trim().slice(0, 100)
  parsed.tags = Array.isArray(parsed.tags) ? parsed.tags.slice(0, 15).map(t => String(t).toLowerCase().slice(0, 40)) : []
  parsed.thumbnailText = (parsed.thumbnailText || 'MIND BLOWN').toUpperCase().slice(0, 24)
  return parsed
}

export async function generateAutoTopic(niche: string, recentTitles: string[]): Promise<string> {
  const sys = `You invent viral YouTube video topics for a faceless "${niche}" facts channel. Reply with ONLY the topic text — one line, no quotes, no numbering.`
  const avoid = recentTitles.slice(0, 12).join(' | ') || 'none yet'
  const user = `Invent one fresh, highly clickable facts topic (max 80 characters). Avoid anything similar to these existing titles: ${avoid}. Topics should be surprising, specific, and curiosity-driving.`
  try {
    const raw = await chat(sys, user)
    const topic = raw.split('\n')[0].replace(/^["'\d.\-\s]+/, '').trim()
    if (topic.length >= 8) return topic.slice(0, 90)
  } catch {
    /* fallback below */
  }
  const fallback = [
    '5 historical facts that sound completely made up',
    'The strongest materials in the universe ranked',
    'Places on Earth where gravity stops making sense',
    'Animals that outlive humans by centuries',
    'What NASA discovered in the last unexplored places',
  ]
  return fallback[Math.floor(Math.random() * fallback.length)]
}

// ─── TTS ─────────────────────────────────────────────────────────────────

function splitForTTS(text: string, max = 950): string[] {
  if (text.length <= max) return [text]
  const sentences = text.match(/[^.!?]+[.!?]+["']?\s*/g) || [text]
  const chunks: string[] = []
  let cur = ''
  for (const s of sentences) {
    if ((cur + s).length <= max) cur += s
    else {
      if (cur) chunks.push(cur.trim())
      cur = s
    }
  }
  if (cur) chunks.push(cur.trim())
  return chunks
}

export async function synthesizeSpeech(
  text: string,
  voice: string,
  speed: number,
  outPath: string
): Promise<void> {
  const zai = await getZAI()
  const chunks = splitForTTS(text)
  const buffers: Buffer[] = []
  for (const chunk of chunks) {
    let lastErr: unknown
    let buf: Buffer | null = null
    for (let i = 1; i <= 3 && !buf; i++) {
      try {
        const response = await zai.audio.tts.create({
          input: chunk,
          voice,
          speed,
          response_format: 'wav',
          stream: false,
        })
        const ab = await response.arrayBuffer()
        buf = Buffer.from(new Uint8Array(ab))
        if (buf.length < 1000) { buf = null; throw new Error('TTS returned tiny/empty audio') }
      } catch (e) {
        lastErr = e
        if (i < 3) await new Promise(r => setTimeout(r, 1500 * i))
      }
    }
    if (!buf) throw lastErr instanceof Error ? lastErr : new Error('TTS failed')
    buffers.push(buf)
  }
  const final = buffers.length === 1 ? buffers[0] : concatWavBuffers(buffers)
  fs.writeFileSync(outPath, final)
}

/** Concatenate identical-format WAV buffers by stitching PCM data (same header layout). */
function concatWavBuffers(buffers: Buffer[]): Buffer {
  // Parse RIFF headers: assume same fmt for all (24kHz 16-bit mono from TTS)
  const view0 = new DataView(buffers[0].buffer, buffers[0].byteOffset, buffers[0].byteLength)
  // find data chunk offset in first buffer
  function findData(b: Buffer): { offset: number; size: number } {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
    let pos = 12
    while (pos + 8 <= b.length) {
      const id = b.toString('ascii', pos, pos + 4)
      const size = v.getUint32(pos + 4, true)
      if (id === 'data') return { offset: pos + 8, size }
      pos += 8 + size + (size % 2)
    }
    return { offset: 44, size: b.length - 44 }
  }
  const d0 = findData(buffers[0])
  const header = buffers[0].slice(0, d0.offset)
  const fmtSize = d0.offset // header bytes incl. data chunk header? we sliced full prefix up to data
  const parts: Buffer[] = []
  let total = 0
  for (const b of buffers) {
    const d = findData(b)
    const pcm = b.slice(d.offset, d.offset + d.size)
    parts.push(pcm)
    total += pcm.length
  }
  // Rebuild header with correct sizes
  const h = Buffer.from(header)
  const hv = new DataView(h.buffer, h.byteOffset, h.byteLength)
  // RIFF size at 4 = fmtSize - 8 + total ... simpler: total file size = fmtSize + total
  hv.setUint32(4, fmtSize - 8 + total, true)
  // find data chunk header position (offset-8) and set size
  const dataHdr = fmtSize - 8
  hv.setUint32(dataHdr + 4, total, true)
  return Buffer.concat([h, ...parts])
}

// ─── Image generation ────────────────────────────────────────────────────

const GRADIENT_FALLBACKS = ['0x0f172a:0x334155', '0x1c1917:0x57534e', '0x14532d:0x4ade80', '0x450a0a:0xf87171']

export async function generateImage(prompt: string, size: string, outPath: string, sceneIdx: number): Promise<void> {
  let lastErr: unknown
  for (let i = 1; i <= 4; i++) {
    try {
      const zai = await getZAI()
      const response = await zai.images.generations.create({ prompt, size: size as '1024x1024' })
      const b64 = response.data?.[0]?.base64
      if (!b64) throw new Error('No image data')
      const buf = Buffer.from(b64, 'base64')
      if (buf.length < 5000) throw new Error('Image too small')
      fs.writeFileSync(outPath, buf)
      return
    } catch (e) {
      lastErr = e
      if (i < 4) await new Promise(r => setTimeout(r, 2500 * i))
    }
  }
  // Fallback: procedural gradient so the pipeline never dies
  const [w, h] = size.split('x')
  const pal = GRADIENT_FALLBACKS[sceneIdx % GRADIENT_FALLBACKS.length]
  const [c0, c1] = pal.split(':')
  const { run, ffmpegBin } = await import('./media')
  await run(ffmpegBin(), [
    '-y', '-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${w}:y1=${h}`,
    '-frames:v', '1', outPath,
  ])
  console.warn(`[image] fallback gradient used for scene ${sceneIdx}: ${lastErr}`)
}

export function sanitizeImagePrompt(p: string): string {
  return `${p.replace(/["\n]/g, ' ').slice(0, 400)}, cinematic lighting, ultra detailed, photorealistic, dramatic composition, no text, no watermark`
}

export function scriptDir(videoId: string): string {
  return path.join(MEDIA_ROOT, videoId)
}
