// ─── AI layer: LLM script/SEO + TTS + image generation ──────────────────
// Works with BOTH:
//  • the Z.ai sandbox endpoint (internal-api.z.ai — as found in /etc/.z-ai-config)
//  • the PUBLIC Z.ai API (https://api.z.ai/api/paas/v4 + your own API key),
//    which needs an explicit chat model, an image model, ≥1024px image
//    sizes and returns image URLs instead of base64.
// TTS: the public Z.ai API has no text-to-speech, so voiceover automatically
// falls back to free no-key providers (Microsoft Edge neural voices, then
// Google Translate TTS). Point TTS_API_URL at any OpenAI-style /audio/speech
// endpoint for dedicated premium voices.
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { FORMATS, MEDIA_ROOT, type VideoFormat } from './constants'

// ── credential discovery (mirrors the SDK: ZAI_CONFIG_JSON → cwd → home → /etc)
interface ZaiConfig { baseUrl: string; apiKey: string }
let _cfg: ZaiConfig | null | undefined
function zaiConfig(): ZaiConfig | null {
  if (_cfg !== undefined) return _cfg
  const candidates: string[] = []
  if (process.env.ZAI_CONFIG_JSON?.trim()) candidates.push(process.env.ZAI_CONFIG_JSON.trim())
  for (const p of [
    path.join(process.cwd(), '.z-ai-config'),
    path.join(os.homedir(), '.z-ai-config'),
    '/etc/.z-ai-config',
  ]) {
    try { candidates.push(fs.readFileSync(p, 'utf-8')) } catch { /* skip */ }
  }
  for (const c of candidates) {
    try {
      const j = JSON.parse(c)
      if (j.baseUrl && j.apiKey) { _cfg = { baseUrl: j.baseUrl, apiKey: j.apiKey }; return _cfg }
    } catch { /* try next */ }
  }
  _cfg = null
  return _cfg
}

/** Public api.z.ai vs the sandbox-internal endpoint (very different capabilities). */
function isPublicApi(): boolean {
  const cfg = zaiConfig()
  return !!cfg && !cfg.baseUrl.includes('internal-api')
}

const CHAT_MODEL = process.env.ZAI_CHAT_MODEL || 'glm-4.5-flash' // free on api.z.ai
const IMAGE_MODEL = process.env.ZAI_IMAGE_MODEL || 'glm-image'

let _zai: ZAI | null = null
export async function getZAI(): Promise<ZAI> {
  if (!_zai) _zai = await ZAI.create()
  return _zai
}

function isRateLimit(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e)
  return m.includes('429') || m.toLowerCase().includes('too many requests')
}

async function chat(system: string, user: string, attempts = 3): Promise<string> {
  let lastErr: unknown
  for (let i = 1; i <= attempts; i++) {
    try {
      const zai = await getZAI()
      const body = {
        model: CHAT_MODEL,
        messages: [
          { role: 'assistant', content: system },
          { role: 'user', content: user },
        ],
        thinking: { type: 'disabled' },
      }
      const completion = await zai.chat.completions.create(
        body as unknown as Parameters<typeof zai.chat.completions.create>[0]
      )
      const content = completion.choices[0]?.message?.content?.trim()
      if (!content) throw new Error('Empty AI response')
      return content
    } catch (e) {
      lastErr = e
      // rate limits need real cooldowns — 1.2s retries never recover them
      if (i < attempts) await new Promise(r => setTimeout(r, isRateLimit(e) ? 30_000 : 1200 * i))
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
  // howto only: a rendered step card instead of AI art for this segment
  card?: { kind: 'title' | 'step' | 'recap' | 'outro'; stepNumber?: number; line1: string; line2?: string }
  // howto only: silent breather segment (music only, no voice)
  silent?: boolean
}
export interface VideoScript {
  title: string
  hook: string
  scenes: ScriptScene[]
  description: string
  tags: string[]
  thumbnailText: string
  thumbnailPrompt: string
  // story only: protagonist bible injected verbatim into every image prompt
  character?: string
}

function sanitizeScenes(parsed: VideoScript, topic: string): VideoScript {
  if (!parsed?.scenes?.length) throw new Error('Script missing scenes')
  parsed.scenes = parsed.scenes
    .filter(s => s && (s.narration?.trim() || s.card || s.silent))
    .map(s => ({
      narration: (s.narration || '').trim(),
      imagePrompt: (s.imagePrompt || 'cinematic abstract background').trim(),
      caption: (s.caption || '').trim().slice(0, 60),
      card: s.card?.line1 ? { ...s.card, line1: String(s.card.line1).slice(0, 80) } : undefined,
      silent: Boolean(s.silent),
    }))
  parsed.title = (parsed.title || topic).trim().slice(0, 100)
  parsed.tags = Array.isArray(parsed.tags) ? parsed.tags.slice(0, 15).map(t => String(t).toLowerCase().slice(0, 40)) : []
  parsed.thumbnailText = (parsed.thumbnailText || 'MIND BLOWN').toUpperCase().slice(0, 24)
  return parsed
}

export async function generateScript(
  topic: string,
  format: VideoFormat,
  niche: string
): Promise<VideoScript> {
  const f = FORMATS[format]
  const [minScenes, maxScenes] = f.sceneCount

  if (format === 'story') return generateStoryScript(topic, niche, minScenes, maxScenes)
  if (format === 'howto') return generateHowtoScript(topic, niche)

  const sys = `You are a viral YouTube faceless-channel scriptwriter for the "${niche}" niche. You write tight, factual, high-retention narration that is INFORMATION-DENSE: every single sentence delivers a new fact or twist — zero filler, zero "let's dive in", zero repetition. You ALWAYS reply with valid JSON only — no markdown fences, no commentary.`

  const user = `Write a complete production package for a ${f.label} about: "${topic}".

Requirements:
- EXACTLY ${minScenes} to ${maxScenes} scenes. Each scene is one beat of the video.
- Each scene.narration: spoken words for that scene, max ${f.sceneMaxChars} characters. Write for text-to-speech: plain sentences, no emojis, no markdown, no abbreviations with periods like "Dr." or "U.S." (write them out), spell numbers so they sound natural.
- Each scene.imagePrompt: a movie-still of EXACTLY what that scene's narration says — one clear focal subject with concrete visual nouns (creatures, places, objects, actions straight from the narration) plus setting and camera angle. NEVER generic/abstract backgrounds, NEVER add things the narration does not mention. 15-30 words. Style: cinematic, dramatic lighting, photorealistic. No text/words/captions in the image.
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
  sanitizeScenes(parsed, topic)
  return parsed
}

// ─── Story engine: shocking global mini-stories with a persistent lead ────

const STORY_HOOK_EXAMPLES = `
- "The phone showed him tomorrow. The third video showed HIS name."
- "She took the night bus to save money. The driver never stopped driving."
- "At 3:33 AM his smart speaker answered a question nobody had asked."`

async function generateStoryScript(topic: string, niche: string, minScenes: number, maxScenes: number): Promise<VideoScript> {
  const { STORY_REGIONS, STORY_STYLE } = await import('./constants')
  const region = STORY_REGIONS[Math.floor(Math.random() * STORY_REGIONS.length)]

  const sys = `You are a viral STORYTELLER for a faceless YouTube Shorts channel. You write gripping, SHOCKING short fiction that FEELS real — the kind of story strangers rewatch, finish, and comment "PART 2!!!" on. Stories are fictional but grounded: real-feeling streets, times, names, amounts — concrete details make them believable and binge-worthy. You ALWAYS reply with valid JSON only.`

  const user = `Write a complete production package for a vertical STORY SHORT set in: ${region}.
Story seed (adapt freely if a better idea serves it): "${topic}". Channel niche: ${niche}.

RULES:
- EXACTLY ${minScenes} to ${maxScenes} scenes. Each scene narration: max 210 characters, plain spoken sentences for text-to-speech (no emojis, no markdown, spell numbers naturally).
- Scene 1 is the COLD-OPEN HOOK: the single most shocking image/moment of the whole story in one or two sentences. No setup, no "once upon a time". Examples of the energy:${STORY_HOOK_EXAMPLES}
- Then escalate: setup → discovery → rising danger → twist. Pack CONCRETE specifics into every scene (exact times, street names, sums of money, ages, objects) — that is what makes it feel real and informative.
- The FINAL scene is a CLIFFHANGER that flips everything and is left UNRESOLVED (viewers must beg for part 2).
- script.character: ONE protagonist bible, 25-45 words: name, age, gender, ethnicity matching ${region}, two fixed facial features, one fixed outfit. This EXACT text will be pasted into every scene's image prompt, so every scene must draw the same person.
- Every scene.imagePrompt: what the camera sees in THAT moment (15-30 words), ALWAYS opening with the protagonist exactly as described in script.character (when he/she is in the scene), plus setting, action, emotion, camera angle. Cinematic and dramatic. No text/words in the image.
- Every scene.caption: 2-4 word punchy on-screen label.
- script.title: clickbait-but-honest YouTube Shorts title, max 90 chars, curiosity gap.
- script.description: 2-3 sentences + "Which part shocked you? Comment below." + subscribe call.
- script.tags: 10-14 lowercase SEO tags. script.thumbnailText: 2-3 words ALL CAPS. script.thumbnailPrompt: the protagonist's face close-up with the most shocking prop, dramatic colors.

Reply with EXACTLY this JSON shape:
{"title":"...","hook":"...","character":"...","scenes":[{"narration":"...","imagePrompt":"...","caption":"..."}],"description":"...","tags":["..."],"thumbnailText":"...","thumbnailPrompt":"..."}`

  const raw = await chat(sys, user)
  const parsed = extractJson(raw) as VideoScript
  sanitizeScenes(parsed, topic)
  parsed.character = (parsed.character || `a young adult from ${region}, casually dressed`).trim().slice(0, 300)
  // Lock the art direction: style suffix stored once, applied at render time.
  parsed.thumbnailPrompt = `${parsed.thumbnailPrompt} ${STORY_STYLE}`
  return parsed
}

// ─── How-To engine: clean 5-step educational video (16:9) ─────────────────

async function generateHowtoScript(topic: string, niche: string): Promise<VideoScript> {
  const sys = `You are a calm, credible educational YouTube scriptwriter. You teach ONE skill per video in exactly five concrete steps, information-dense but friendly. You ALWAYS reply with valid JSON only.`

  const user = `Write a complete production package for a 16:9 educational video teaching: "${topic}". Niche: ${niche}.

STRUCTURE — EXACTLY 13 segments in this order:
1. {"card":{"kind":"title","line1":"<short main title>","line2":"<5-8 word subtitle>"},"narration":"One sentence announcing what the video teaches and the payoff."}
2. intro illustration: {"narration":"One sentence: what the viewer will be able to do by the end.","imagePrompt":"flat modern vector illustration of the end result"}
3-12. FIVE step pairs. Each pair is:
   a) step card: {"card":{"kind":"step","stepNumber":N,"line1":"<2-5 word step title, CAPS>","line2":"<6-10 word one-line rule of thumb>"},"narration":"Step N. <2 informative sentences with one concrete detail, tool name, number or time estimate>"}
   b) step illustration: {"silent":true,"imagePrompt":"flat modern vector illustration of step N in action"}
13. recap card + outro: {"card":{"kind":"recap","line1":"THE 5 STEPS"},"narration":"Recap the five steps in one breath, then end with: Follow, because the next video goes even deeper."}

RULES:
- narration: plain sentences for text-to-speech, no emojis, no markdown, spell numbers naturally. Step narrations max 240 chars.
- The five steps must be genuinely actionable and specific (name real free tools, real numbers, real first actions) — the video must teach something, not vague motivation.
- Illustration imagePrompts: flat modern vector style, dark navy background with amber accents, minimal, high detail, NO text in the image.
- script.title: max 90 chars, e.g. "How to X in 2026 (step by step)". script.description: 2-3 sentences + follow call. script.tags: 10-14 lowercase tags. script.thumbnailText: 2-4 words CAPS. script.thumbnailPrompt: bold flat illustration of the result, high contrast.

Reply with EXACTLY this JSON shape:
{"title":"...","hook":"...","scenes":[{"narration":"...","imagePrompt":"...","caption":"...","card":{...}|omitted,"silent":true|omitted}],"description":"...","tags":["..."],"thumbnailText":"...","thumbnailPrompt":"..."}`

  const raw = await chat(sys, user)
  const parsed = extractJson(raw) as VideoScript
  sanitizeScenes(parsed, topic)
  return parsed
}

// ─── Free trending topics (Google Trends RSS — no key, no account, $0) ────
// https://trends.google.com/trending/rss?geo=US returns the day's top
// searches with real search volume. Cached 3h so auto-pilot never hammers
// it. On any failure we return [] and topic generation falls back to
// evergreen ideas — the pipeline never dies because trends are down.

let _trendsCache: { at: number; topics: string[] } | null = null

function xmlDecode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(?:#39|apos);/g, "'")
    .trim()
}

export async function fetchTrendingTopics(): Promise<string[]> {
  if (_trendsCache && Date.now() - _trendsCache.at < 3 * 3600_000) return _trendsCache.topics
  const geo = (process.env.TRENDS_GEO || 'US').toUpperCase().slice(0, 2)
  try {
    const res = await fetch(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TubeForge/1.0)' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`trends RSS responded ${res.status}`)
    const xml = await res.text()
    const topics = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .map(m => m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] || '')
      .map(xmlDecode)
      .filter(t => t.length >= 3)
      .slice(0, 12)
    if (!topics.length) throw new Error('trends RSS had no items')
    _trendsCache = { at: Date.now(), topics }
    return topics
  } catch (e) {
    console.warn(`[trends] unavailable (${e instanceof Error ? e.message : e}) — falling back to evergreen topics`)
    return _trendsCache?.topics || []
  }
}

export async function generateAutoTopic(
  niche: string,
  recentTitles: string[],
  format: VideoFormat = 'short'
): Promise<string> {
  const persona = format === 'story'
    ? `You invent viral STORY premises for a faceless YouTube Shorts channel in the "${niche}" space. Reply with ONLY the premise text — one line, no quotes, no numbering.`
    : format === 'howto'
      ? `You invent high-demand HOW-TO video topics for an educational faceless YouTube channel in the "${niche}" space. Reply with ONLY the topic text — one line, no quotes, no numbering, phrased like "How to X ...".`
      : `You invent viral YouTube video topics for a faceless "${niche}" facts channel. Reply with ONLY the topic text — one line, no quotes, no numbering.`
  const avoid = recentTitles.slice(0, 12).join(' | ') || 'none yet'
  // Ride live search demand: blend a trending search into the niche when it fits
  const trends = await fetchTrendingTopics()
  const trendLine = trends.length
    ? `\n\nLive Google Trends RIGHT NOW (massive search volume): ${trends.slice(0, 10).join(' | ')}. If one of these can be spun into a surprising "${niche}" angle — a fact, mystery, ranking or comparison people are ALREADY searching for — build the topic around it to ride that wave. Keep it evergreen enough to still make sense next week.`
    : ''
  const ask = format === 'story'
    ? `Invent one fresh fictional story premise (max 80 characters): an ordinary person in an ordinary place stumbles into one SHOCKING, impossible situation with twist potential. Avoid anything similar to these existing titles: ${avoid}.${trendLine}`
    : format === 'howto'
      ? `Invent one fresh how-to topic (max 80 characters, phrased "How to ...") that beginners actively search for and that can be taught in 5 free steps. Avoid anything similar to these existing titles: ${avoid}.${trendLine}`
      : `Invent one fresh, highly clickable facts topic (max 80 characters). Avoid anything similar to these existing titles: ${avoid}. Topics should be surprising, specific, and curiosity-driving.${trendLine}`
  const user = ask
  try {
    const raw = await chat(persona, user)
    const topic = raw.split('\n')[0].replace(/^["'\d.\-\s]+/, '').trim()
    if (topic.length >= 8) return topic.slice(0, 90)
  } catch {
    /* fallback below */
  }
  const fallback = format === 'story'
    ? [
        'A delivery rider finds a phone that texts tomorrow\'s news',
        'The night-shift barber who recognizes a missing person',
        'A tenant discovers the previous renter never left',
        'A tourist bookings a room that does not exist by morning',
      ]
    : format === 'howto'
      ? [
          'How to start a faceless YouTube channel for free',
          'How to learn any skill in 30 days',
          'How to write a resume that beats the AI filters',
          'How to grow your first 1000 followers',
        ]
      : [
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
  if (process.env.TTS_API_URL) {
    return ttsViaCustom(text, voice, speed, outPath)
  }
  const cfg = zaiConfig()
  if (cfg && cfg.baseUrl.includes('internal-api')) {
    return ttsViaZai(text, voice, speed, outPath)
  }
  return ttsViaFree(text, voice, speed, outPath)
}

/** Original path: the Z.ai SDK TTS (sandbox / internal endpoint only). */
async function ttsViaZai(text: string, voice: string, speed: number, outPath: string): Promise<void> {
  const zai = await getZAI()
  const chunks = splitForTTS(text)
  const buffers: Buffer[] = []
  for (const chunk of chunks) {
    let lastErr: unknown
    let buf: Buffer | null = null
    for (let i = 1; i <= 5 && !buf; i++) {
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
        if (i < 5) await new Promise(r => setTimeout(r, isRateLimit(e) ? 30_000 * i : 1500 * i))
      }
    }
    if (!buf) throw lastErr instanceof Error ? lastErr : new Error('TTS failed')
    buffers.push(buf)
  }
  const final = buffers.length === 1 ? buffers[0] : concatWavBuffers(buffers)
  fs.writeFileSync(outPath, final)
}

/** OpenAI-style /audio/speech endpoint via TTS_API_URL (+ optional TTS_API_KEY/TTS_MODEL). */
async function ttsViaCustom(text: string, voice: string, speed: number, outPath: string): Promise<void> {
  const cfg = zaiConfig()
  const key = process.env.TTS_API_KEY || cfg?.apiKey || ''
  const chunks = splitForTTS(text)
  const buffers: Buffer[] = []
  for (const chunk of chunks) {
    let lastErr: unknown
    let buf: Buffer | null = null
    for (let i = 1; i <= 3 && !buf; i++) {
      try {
        const res = await fetch(process.env.TTS_API_URL as string, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: process.env.TTS_MODEL || 'tts-1',
            input: chunk,
            voice: process.env.TTS_VOICE || voice,
            speed,
            response_format: 'wav',
          }),
          signal: AbortSignal.timeout(120_000),
        })
        if (!res.ok) throw new Error(`TTS_API_URL responded ${res.status}: ${(await res.text()).slice(0, 200)}`)
        buf = Buffer.from(new Uint8Array(await res.arrayBuffer()))
        if (buf.length < 1000) { buf = null; throw new Error('TTS returned tiny/empty audio') }
      } catch (e) {
        lastErr = e
        if (i < 3) await new Promise(r => setTimeout(r, 1500 * i))
      }
    }
    if (!buf) {
      throw lastErr instanceof Error
        ? lastErr
        : new Error('Custom TTS failed')
    }
    buffers.push(buf)
  }
  const final = buffers.length === 1 ? buffers[0] : concatWavBuffers(buffers)
  fs.writeFileSync(outPath, final)
}

/**
 * Free no-key voiceover chain:
 *   1. msedge-tts (Microsoft Edge neural voices — best quality)
 *   2. Google Translate TTS (robotic but dependable, ≤200 chars per call)
 * Both work from datacenter hosts (Render etc.) without any API key.
 */
const EDGE_VOICE_MAP: Record<string, string> = {
  jam: 'en-GB-RyanNeural',          // British male — matches "British narrator"
  kazi: 'en-US-JennyNeural',        // clear US female
  luodo: 'en-US-GuyNeural',         // expressive US male
  xiaochen: 'en-US-ChristopherNeural', // calm professional US male
  tongtong: 'en-US-AriaNeural',     // warm US female
  douji: 'en-US-EricNeural',        // smooth conversational US male
  chuichui: 'en-US-MichelleNeural', // lively upbeat US female
}
const DEFAULT_FREE_VOICE = process.env.TTS_FREE_VOICE || 'en-US-ChristopherNeural'

async function ttsViaFree(text: string, voice: string, speed: number, outPath: string): Promise<void> {
  const edgeVoice = EDGE_VOICE_MAP[voice] || DEFAULT_FREE_VOICE
  const chunks = splitForTTS(text)
  const buffers: Buffer[] = []
  for (const chunk of chunks) {
    // 1) Edge neural voices
    let buf = await tryEdgeChunk(edgeVoice, chunk, speed)
    // 2) Google Translate TTS fallback for this chunk
    if (!buf) buf = await tryGoogleChunk(chunk)
    if (!buf) {
      throw new Error(
        'Voiceover failed: both free TTS providers (Edge neural + Google Translate) are unreachable ' +
        'or rate-limiting. Retry shortly, or set TTS_API_URL + TTS_API_KEY to any OpenAI-style voice ' +
        'endpoint for dedicated premium voices.'
      )
    }
    buffers.push(buf)
  }
  const final = buffers.length === 1 ? buffers[0] : concatWavBuffers(buffers)
  fs.writeFileSync(outPath, final)
}

async function tryEdgeChunk(voiceName: string, chunk: string, speed = 1.0, attempts = 3): Promise<Buffer | null> {
  let lastErr: unknown
  for (let i = 1; i <= attempts; i++) {
    try {
      const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts')
      const tts = new MsEdgeTTS()
      await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
      const { audioStream } = tts.toStream(chunk, { rate: speedToRate(speed) })
      const parts: Buffer[] = []
      for await (const c of audioStream) parts.push(Buffer.from(c as Buffer))
      const mp3 = Buffer.concat(parts)
      if (mp3.length < 1000) throw new Error('edge TTS returned empty audio')
      return await toWav24k(mp3)
    } catch (e) {
      lastErr = e
      if (i < attempts) await new Promise(r => setTimeout(r, 1200 * i))
    }
  }
  console.warn(`[tts] edge voice failed (will try google): ${lastErr}`)
  return null
}

function speedToRate(speed: number): string {
  const pct = Math.round((speed - 1) * 100)
  return pct >= 0 ? `+${pct}%` : `${pct}%`
}

async function tryGoogleChunk(chunk: string, attempts = 3): Promise<Buffer | null> {
  // google translate_tts accepts ≤200 chars per request
  const subChunks: string[] = []
  if (chunk.length <= 200) subChunks.push(chunk)
  else {
    const sentences = chunk.match(/[^.!?]+[.!?]+["']?\s*/g) || [chunk]
    let cur = ''
    for (const s of sentences) {
      if ((cur + s).length <= 200) cur += s
      else {
        if (cur) subChunks.push(cur.trim())
        cur = s.length > 200 ? s.slice(0, 200) : s
      }
    }
    if (cur) subChunks.push(cur.trim())
  }
  const buffers: Buffer[] = []
  for (const sub of subChunks) {
    let lastErr: unknown
    let wav: Buffer | null = null
    for (let i = 1; i <= attempts && !wav; i++) {
      try {
        const url =
          `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=${encodeURIComponent(sub)}`
        const res = await fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            Referer: 'https://translate.google.com/',
          },
          signal: AbortSignal.timeout(30_000),
        })
        if (!res.ok) throw new Error(`google TTS responded ${res.status}`)
        const mp3 = Buffer.from(new Uint8Array(await res.arrayBuffer()))
        if (mp3.length < 500) throw new Error('google TTS returned empty audio')
        wav = await toWav24k(mp3)
      } catch (e) {
        lastErr = e
        if (i < attempts) await new Promise(r => setTimeout(r, 1200 * i))
      }
    }
    if (!wav) {
      console.warn(`[tts] google voice failed: ${lastErr}`)
      return null
    }
    buffers.push(wav)
  }
  return buffers.length === 1 ? buffers[0] : concatWavBuffers(buffers)
}

/** Normalize any audio bytes (mp3 etc.) into 24 kHz mono WAV via ffmpeg. */
async function toWav24k(audio: Buffer): Promise<Buffer> {
  const { run, ffmpegBin } = await import('./media')
  const tmp = path.join(os.tmpdir(), `tf-tts-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const inPath = `${tmp}.bin`
  const wavPath = `${tmp}.wav`
  try {
    fs.writeFileSync(inPath, audio)
    await run(ffmpegBin(), ['-y', '-i', inPath, '-ar', '24000', '-ac', '1', wavPath])
    return fs.readFileSync(wavPath)
  } finally {
    try { fs.rmSync(inPath, { force: true }) } catch { /* ignore */ }
    try { fs.rmSync(wavPath, { force: true }) } catch { /* ignore */ }
  }
}

/** Concatenate identical-format WAV buffers by stitching PCM data (same header layout). */
function concatWavBuffers(buffers: Buffer[]): Buffer {
  // Parse RIFF headers: assume same fmt for all (24kHz 16-bit mono from TTS)
  const view0 = new DataView(buffers[0].buffer, buffers[0].byteOffset, buffers[0].byteLength)
  void view0
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
// 100% FREE by default:
//   1. Cloudflare Workers AI flux-1-schnell (opt-in: own free account,
//      10,000 neurons/day ≈ 35 images, no credit card, ~2s per image).
//   2. Pollinations.ai (Flux) — no key at all; anonymous tier paces at
//      ~1 image / 45s per IP (server tells us the exact wait on 402).
//   3. Z.ai images — PAID on the public API. The sandbox credential
//      (internal-api.z.ai) is quota-bound to sandbox-origin traffic, so on
//      Render it always dies with billing error 1113 — a circuit breaker
//      disables it after the first balance error instead of wasting
//      minutes of retries per scene.
//   4. Procedural gradient — guarantees the pipeline never dies.

const GRADIENT_FALLBACKS = ['0x0f172a:0x334155', '0x1c1917:0x57534e', '0x14532d:0x4ade80', '0x450a0a:0xf87171']

/** Billing/quota rejection (Z.ai code 1113 and friends). Not transient —
 *  retrying can never succeed, so we trip a circuit breaker instead. */
function isBalanceError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e)
  return /1113|insufficient balance|no resource package|please recharge/i.test(m)
}

let _zaiImageDeadUntil = 0
function zaiImageAlive(): boolean {
  return Date.now() >= _zaiImageDeadUntil
}
function killZaiImages(reason: string): void {
  if (Date.now() < _zaiImageDeadUntil) return
  _zaiImageDeadUntil = Date.now() + 6 * 3600_000
  console.warn(`[image] Z.ai image engine disabled for 6h — ${reason}`)
  console.warn('[image] Falling back to the 100% free engine (videos stay $0).')
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/** Pollinations likes big-ish canvases; 1024/1792 is its sweet spot and the
 *  Ken Burns zoom gently upscales anyway. Keep it 16:9 or 9:16. */
function pollinationsSize(size: string): { w: number; h: number } {
  const [w, h] = size.split('x').map(Number)
  if (h > w) return { w: 1024, h: 1792 }
  if (w > h) return { w: 1792, h: 1024 }
  return { w: 1024, h: 1024 }
}

/** Free image engine — Pollinations.ai. No key, no account, $0.
 *
 *  Anonymous tier limits: 1 image / 45s per IP, answered with HTTP 402
 *  ("FREE_LIMIT ... Retry after Ns"). So we:
 *    - pace every request ≥ IMAGE_FREE_GAP_MS after the previous one,
 *    - cycle models flux → turbo → flux → turbo (whichever is open),
 *    - honor the server's "Retry after" hint on 402.
 *  Worst case is a few minutes per image on a heavily shared IP — still free.
 */
let _lastPollinationsAt = 0

function parseRetryAfterMs(body: string): number | null {
  const m = body.match(/retry after (\d+(?:\.\d+)?)s/i)
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : null
}

async function generateImagePollinations(prompt: string, size: string, outPath: string, seed?: number): Promise<void> {
  const { w, h } = pollinationsSize(size)
  const configured = process.env.IMAGE_FREE_MODEL // pin one model only if explicitly set
  const models = configured ? [configured] : ['flux', 'flux', 'flux', 'turbo']
  const gapMs = Math.max(1000, Number(process.env.IMAGE_FREE_GAP_MS) || 46_000)
  const pollen = process.env.POLLINATIONS_TOKEN?.trim() // optional free token = higher limits
  let lastErr: unknown

  for (let i = 0; i < models.length; i++) {
    try {
      // pace: never fire more than one pollinations request per gap window
      const since = Date.now() - _lastPollinationsAt
      if (since < gapMs) await sleep(gapMs - since)
      _lastPollinationsAt = Date.now()

      const u = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 1900))}`)
      u.searchParams.set('width', String(w))
      u.searchParams.set('height', String(h))
      u.searchParams.set('model', models[i])
      u.searchParams.set('nologo', 'true')
      // LOCKED seed across scenes of one video = consistent character look
      u.searchParams.set('seed', String(seed ?? Math.floor(Math.random() * 1e9)))
      if (pollen) u.searchParams.set('token', pollen)
      const res = await fetch(u, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TubeForge/1.0)' },
        signal: AbortSignal.timeout(180_000),
      })
      if (res.status === 402) {
        const body = await res.text().catch(() => '')
        const wait = parseRetryAfterMs(body) ?? 30_000
        throw Object.assign(new Error(`pollinations free-limit (402), retrying in ${Math.round(wait / 1000)}s`), { retryAfterMs: wait })
      }
      if (!res.ok) throw new Error(`pollinations responded ${res.status}`)
      const ct = res.headers.get('content-type') || ''
      const buf = Buffer.from(new Uint8Array(await res.arrayBuffer()))
      if (!ct.startsWith('image/') || buf.length < 5000) {
        throw new Error(`pollinations returned no image (${ct || 'unknown type'}, ${buf.length}B)`)
      }
      fs.writeFileSync(outPath, buf)
      return
    } catch (e) {
      lastErr = e
      const retryAfter = (e as { retryAfterMs?: number }).retryAfterMs
      if (i < models.length - 1) await sleep(retryAfter ?? 8000 * (i + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('pollinations failed')
}

/** Cloudflare Workers AI (flux-1-schnell) — opt-in free premium engine.
 *  Free plan: 10,000 neurons/day (≈35 images), no credit card. Enable with
 *  CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (Workers AI permission).
 *  Fast (~2-5s) and reliable from Render — perfect for Auto-Pilot.
 *  The model outputs a fixed square, so we cover-crop to the target aspect
 *  (attention-aware) and upscale with lanczos. */
async function generateImageCloudflare(prompt: string, size: string, outPath: string): Promise<void> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim()
  if (!account || !token) throw new Error('cloudflare: CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set')
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt.slice(0, 2040), steps: 4 }),
      signal: AbortSignal.timeout(180_000),
    }
  )
  const j = (await res.json().catch(() => null)) as {
    success?: boolean; result?: { image?: string }; errors?: unknown
  } | null
  const b64 = j?.result?.image
  if (!res.ok || !j?.success || !b64) {
    const detail = j?.errors ? JSON.stringify(j.errors).slice(0, 140) : res.statusText
    throw new Error(`cloudflare responded ${res.status}: ${detail}`)
  }
  const buf = Buffer.from(b64, 'base64')
  if (buf.length < 5000) throw new Error('cloudflare returned no image')
  const [w, h] = size.split('x').map(Number)
  if (!w || !h || (w === 1024 && h === 1024)) {
    fs.writeFileSync(outPath, buf)
    return
  }
  const sharp = (await import('sharp')).default
  await sharp(buf)
    .resize(w, h, { fit: 'cover', position: sharp.strategy.attention, kernel: 'lanczos3' })
    .png()
    .toFile(outPath)
}

/** Z.ai image API — PAID (needs balance/resource package). Opt-in upgrade.
 *  Balance/quota errors (1113) abort instantly and trip the circuit breaker. */
async function generateImageZai(prompt: string, size: string, outPath: string, attempts: number): Promise<void> {
  let lastErr: unknown
  for (let i = 1; i <= attempts; i++) {
    try {
      const zai = await getZAI()
      const body: Record<string, unknown> = { prompt }
      if (isPublicApi()) {
        // public api.z.ai: model is required and both sides must be 1024–2048px
        body.model = IMAGE_MODEL
        const [w, h] = size.split('x').map(Number)
        body.size = w > h ? '1728x960' : w < h ? '960x1728' : '1280x1280'
      } else {
        body.size = size
      }
      const response = await zai.images.generations.create(
        body as unknown as Parameters<typeof zai.images.generations.create>[0]
      )
      const data = (
        response as unknown as {
          data?: Array<{ url?: string; b64_json?: string; base64?: string }>
        }
      ).data?.[0]
      let buf: Buffer | null = null
      if (data?.b64_json || data?.base64) {
        buf = Buffer.from(data.b64_json || data.base64 || '', 'base64')
      } else if (data?.url) {
        // public api.z.ai returns a hosted URL (valid 30 days) — download it
        const imgRes = await fetch(data.url, { signal: AbortSignal.timeout(120_000) })
        if (!imgRes.ok) throw new Error(`image download failed (${imgRes.status})`)
        buf = Buffer.from(new Uint8Array(await imgRes.arrayBuffer()))
      }
      if (!buf || buf.length < 5000) throw new Error('No image data')
      fs.writeFileSync(outPath, buf)
      return
    } catch (e) {
      lastErr = e
      // Billing rejections are permanent — never burn attempts/backoffs on them.
      if (isBalanceError(e)) {
        killZaiImages(e instanceof Error ? e.message : String(e))
        break
      }
      if (i < attempts) await sleep(isRateLimit(e) ? 30_000 * i : 2500 * i)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Z.ai image generation failed')
}

export async function generateImage(
  prompt: string,
  size: string,
  outPath: string,
  sceneIdx: number,
  opts: { preferZai?: boolean; seed?: number } = {}
): Promise<void> {
  const provider = (process.env.IMAGE_PROVIDER || 'auto').toLowerCase()
  const errors: string[] = []
  const cfWanted = provider === 'auto' || provider === 'cloudflare'
  const cfConfigured = !!(process.env.CLOUDFLARE_ACCOUNT_ID?.trim() && process.env.CLOUDFLARE_API_TOKEN?.trim())

  async function gradient(): Promise<void> {
    const [w, h] = size.split('x')
    const pal = GRADIENT_FALLBACKS[sceneIdx % GRADIENT_FALLBACKS.length]
    const [c0, c1] = pal.split(':')
    const { run, ffmpegBin } = await import('./media')
    await run(ffmpegBin(), [
      '-y', '-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${w}:y1=${h}`,
      '-frames:v', '1', outPath,
    ])
  }

  if (provider === 'gradient') {
    await gradient()
    return
  }

  if (provider === 'zai') {
    if (zaiConfig()) {
      try {
        await generateImageZai(prompt, size, outPath, 4)
        return
      } catch (e) {
        errors.push(`z.ai: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    await gradient()
    console.warn(`[image] gradient used for scene ${sceneIdx}: ${errors.join(' | ')}`)
    return
  }

  // ── auto / cloudflare / pollinations chain ──

  // 0) Story format: the Z.ai engine draws expressive cartoon characters far
  //    better than the free engines — use it FIRST only when a config exists
  //    AND it actually has quota (sandbox/internal deployments). On Render the
  //    circuit breaker makes this skip instantly instead of retrying for minutes.
  if (opts.preferZai && provider === 'auto' && zaiConfig() && zaiImageAlive()) {
    try {
      await generateImageZai(prompt, size, outPath, 3)
      return
    } catch (e) {
      errors.push(`z.ai: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 1) FREE premium: Cloudflare Workers AI (own free account, 10k neurons/day)
  if (cfWanted && cfConfigured) {
    try {
      await generateImageCloudflare(prompt, size, outPath)
      return
    } catch (e) {
      errors.push(`cloudflare: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 2) FREE keyless: Pollinations flux (locked seed = consistent character)
  if (provider === 'auto' || provider === 'pollinations' || provider === 'cloudflare') {
    try {
      await generateImagePollinations(prompt, size, outPath, opts.seed)
      return
    } catch (e) {
      errors.push(`pollinations: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 3) Backup: Z.ai only when the breaker hasn't tripped (1 quick attempt)
  if (provider === 'auto' && zaiConfig() && zaiImageAlive()) {
    try {
      await generateImageZai(prompt, size, outPath, 2)
      return
    } catch (e) {
      errors.push(`z.ai: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 4) Fallback: procedural gradient so the pipeline never dies
  await gradient()
  console.warn(`[image] fallback gradient used for scene ${sceneIdx}: ${errors.join(' | ') || 'no provider available'}`)
}

export function sanitizeImagePrompt(p: string): string {
  return `${p.replace(/["\n]/g, ' ').slice(0, 420)}, cinematic film still, dramatic volumetric lighting, vivid saturated colors, high contrast, ultra detailed, photorealistic, eye-catching composition, no text, no watermark`
}

/** Story scenes use the locked cartoon art direction instead of photorealism. */
export function sanitizeStoryPrompt(p: string, style: string): string {
  return `${p.replace(/["\n]/g, ' ').slice(0, 520)}, ${style}`
}

/** How-To illustrations: flat vector look, no photorealism. */
export function sanitizeHowtoPrompt(p: string): string {
  return `${p.replace(/["\n]/g, ' ').slice(0, 420)}, flat modern vector illustration, minimal clean composition, dark navy background with amber accents, high detail, no text, no watermark`
}

export function scriptDir(videoId: string): string {
  return path.join(MEDIA_ROOT, videoId)
}
