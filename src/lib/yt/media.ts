// ─── FFmpeg media engine: clips, audio, subtitles, thumbnail, final mux ──
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { FORMATS, type VideoFormat } from './constants'

const FONT_BOLD = (() => {
  const system = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
  if (fs.existsSync(system)) return system
  // bundled fallback (DejaVu is freely redistributable) for hosts without fontconfig
  return path.join(process.cwd(), 'assets', 'fonts', 'DejaVuSans-Bold.ttf')
})()

// ─── FFmpeg / ffprobe binary resolution (portable across machines) ───────
let _ffmpegBin: string | undefined
let _ffprobeBin: string | undefined

function isExecutable(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false
    fs.accessSync(p, fs.constants.X_OK) // throws when not accessible (returns null|undefined on success — never rely on the value: Bun ≠ Node)
    return true
  } catch {
    return false
  }
}

function findInPath(names: string[]): string | null {
  const dirs = [
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean),
    '/usr/local/bin', '/usr/bin', '/bin', '/opt/homebrew/bin', '/usr/local/opt/ffmpeg/bin',
  ]
  for (const dir of dirs) {
    for (const name of names) {
      const p = path.join(dir, name)
      if (isExecutable(p)) return p
    }
  }
  return null
}

/** Bundled fallback binaries from the ffmpeg-static / ffprobe-static npm
 *  packages (downloaded per-OS at install time). Makes TubeForge work on
 *  hosts without a system ffmpeg: Render Node runtime, local Windows, etc. */
function staticBinPath(kind: 'ffmpeg' | 'ffprobe'): string | null {
  const root = path.join(process.cwd(), 'node_modules')
  const exe = process.platform === 'win32' ? '.exe' : ''
  const candidates: string[] = []
  if (kind === 'ffmpeg') {
    candidates.push(path.join(root, 'ffmpeg-static', `ffmpeg${exe}`))
  } else {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    candidates.push(path.join(root, 'ffprobe-static', 'bin', process.platform, arch, `ffprobe${exe}`))
  }
  for (const p of candidates) {
    if (isExecutable(p)) return p
  }
  return null
}

export function resolveMediaBin(kind: 'ffmpeg' | 'ffprobe'): string {
  const cached = kind === 'ffmpeg' ? _ffmpegBin : _ffprobeBin
  if (cached) return cached

  const envPath = kind === 'ffmpeg' ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH
  if (envPath && isExecutable(envPath)) {
    if (kind === 'ffmpeg') _ffmpegBin = envPath
    else _ffprobeBin = envPath
    return envPath
  }

  const found = findInPath([kind, `${kind}.exe`]) ?? staticBinPath(kind)
  if (!found) {
    throw new Error(
      `${kind} could not be found on this machine, so videos cannot be rendered. ` +
      'TubeForge tried, in order: FFMPEG_PATH / FFPROBE_PATH env vars → system PATH → bundled static binaries ' +
      '(re-run "bun install" / "npm install" to download the bundled ones). ' +
      'Manual install: Ubuntu/Debian → sudo apt install -y ffmpeg · macOS → brew install ffmpeg · ' +
      'Windows → winget install Gyan.FFmpeg (then restart the app). ' +
      'On Render, use the Docker runtime (render.yaml) — native Node environments have no ffmpeg and cannot run apt.'
    )
  }
  if (kind === 'ffmpeg') _ffmpegBin = found
  else _ffprobeBin = found
  return found
}

export function ffmpegBin(): string {
  return resolveMediaBin('ffmpeg')
}

export function ffprobeBin(): string {
  return resolveMediaBin('ffprobe')
}

// Default 45 min — Render's free tier (0.1 CPU) encodes slowly, and a Short can
// legitimately take 10-20 min. Override with FFMPEG_TIMEOUT_MS if needed.
const FFMPEG_TIMEOUT_MS = (() => {
  const n = Number(process.env.FFMPEG_TIMEOUT_MS)
  return Number.isFinite(n) && n >= 10_000 ? n : 45 * 60_000
})()

export function run(bin: string, args: string[], timeoutMs = FFMPEG_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    const timer = setTimeout(() => {
      p.kill('SIGKILL')
      reject(new Error(`${bin} timed out after ${timeoutMs / 1000}s`))
    }, timeoutMs)
    p.stderr.on('data', d => {
      err += d.toString()
      if (err.length > 400_000) err = err.slice(-200_000)
    })
    p.on('error', e => {
      clearTimeout(timer)
      reject(e)
    })
    p.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`${bin} exited ${code}: ${err.slice(-1200)}`))
    })
  })
}

export async function probeDuration(file: string): Promise<number> {
  const out = await new Promise<string>((resolve, reject) => {
    const p = spawn(ffprobeBin(), [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ])
    let o = ''
    p.stdout.on('data', d => (o += d.toString()))
    p.on('error', reject)
    p.on('close', () => resolve(o))
  })
  const dur = parseFloat(out.trim())
  if (!isFinite(dur) || dur <= 0) throw new Error(`Could not probe duration of ${file}`)
  return dur
}

// ─── Scene clip with Ken Burns motion ────────────────────────────────────

export async function makeSceneClip(
  imgPath: string,
  outPath: string,
  durationSec: number,
  format: VideoFormat,
  variant: number
): Promise<void> {
  const f = FORMATS[format]
  // Shorts default to 12 fps (half the frames of 24 → roughly half the encode
  // load on Render's free CPU); long-form stays filmic 24. Ken Burns motion
  // still reads smoothly at 12. Tune with FPS_SHORT env var.
  const fps = f.fps
  const N = Math.max(2, Math.round(durationSec * fps))
  const W = f.resolution.w
  const H = f.resolution.h
  const s = `${W}x${H}`
  // Intermediate canvas: 1.2x output — just enough headroom for the max
  // zoom (1.16/1.12). Bigger canvases cost CPU+RAM for zero visible gain.
  const cw = Math.round(W * 1.2 / 2) * 2
  const ch = Math.round(H * 1.2 / 2) * 2

  let scale: string
  let zoompan: string
  const sceneIdx = variant % 4

  if (variant === -1) {
    // howto step cards: static frame (cards carry their own design)
    scale = `scale=${cw}:${ch}:force_original_aspect_ratio=increase,crop=${cw}:${ch},setsar=1`
    zoompan = `zoompan=z='1':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${N}:s=${s}:fps=${fps}`
  } else if (format === 'short' || format === 'story') {
    scale = `scale=${cw}:${ch}:force_original_aspect_ratio=increase,crop=${cw}:${ch},setsar=1`
    if (sceneIdx === 0)
      zoompan = `zoompan=z='min(1+0.16*on/${N},1.16)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${N}:s=${s}:fps=${fps}`
    else if (sceneIdx === 1)
      zoompan = `zoompan=z='1.16-0.16*on/${N}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${N}:s=${s}:fps=${fps}`
    else if (sceneIdx === 2)
      zoompan = `zoompan=z='1.12':x='(iw-iw/zoom)*on/${N}':y='ih/2-(ih/zoom/2)':d=${N}:s=${s}:fps=${fps}`
    else
      zoompan = `zoompan=z='1.12':x='(iw-iw/zoom)*(1-on/${N})':y='ih/2-(ih/zoom/2)':d=${N}:s=${s}:fps=${fps}`
  } else if (format === 'howto') {
    // illustrations: gentle motion so the educational feel stays calm
    scale = `scale=${cw}:${ch}:force_original_aspect_ratio=increase,crop=${cw}:${ch},setsar=1`
    if (sceneIdx % 2 === 0)
      zoompan = `zoompan=z='min(1+0.06*on/${N},1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${N}:s=${s}:fps=${fps}`
    else
      zoompan = `zoompan=z='1.06-0.06*on/${N}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${N}:s=${s}:fps=${fps}`
  } else {
    scale = `scale=${cw}:${ch}:force_original_aspect_ratio=increase,crop=${cw}:${ch},setsar=1`
    if (sceneIdx === 0)
      zoompan = `zoompan=z='min(1+0.12*on/${N},1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${N}:s=${s}:fps=${fps}`
    else if (sceneIdx === 1)
      zoompan = `zoompan=z='1.12-0.12*on/${N}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${N}:s=${s}:fps=${fps}`
    else if (sceneIdx === 2)
      zoompan = `zoompan=z='1.08':x='(iw-iw/zoom)*on/${N}':y='ih/2-(ih/zoom/2)':d=${N}:s=${s}:fps=${fps}`
    else
      zoompan = `zoompan=z='1.08':x='(iw-iw/zoom)*(1-on/${N})':y='ih/2-(ih/zoom/2)':d=${N}:s=${s}:fps=${fps}`
  }

  // Scene clips are INTERMEDIATES (fully re-encoded in finalRender), so we
  // encode them as cheaply as possible: ultrafast + higher tolerance.
  // -threads 2: the host exposes many cores but we only get a fraction of
  // one — extra x264 threads just burn RAM (Render free OOM) for nothing.
  await run(ffmpegBin(), [
    '-y', '-i', imgPath,
    '-filter_complex', `${scale},${zoompan},format=yuv420p`,
    '-frames:v', String(N),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
    '-threads', '2',
    '-r', String(fps),
    outPath,
  ])
}

export async function concatClips(clipPaths: string[], outPath: string): Promise<void> {
  const listFile = outPath.replace(/\.mp4$/, '_list.txt')
  fs.writeFileSync(listFile, clipPaths.map(c => `file '${c}'`).join('\n'))
  try {
    await run(ffmpegBin(), ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outPath])
  } finally {
    fs.rmSync(listFile, { force: true })
  }
}

/** Cinematic crossfade concat (story format): scene i dissolves into scene
 *  i+1 over `xfade` seconds, so the timeline length is Σdur − (n−1)·xfade.
 *  clip durations must be probed beforehand; all clips share size + fps. */
export async function concatClipsXfade(
  clipPaths: string[],
  durations: number[],
  xfade: number,
  fps: number,
  outPath: string
): Promise<void> {
  const inputs: string[] = []
  clipPaths.forEach(c => inputs.push('-i', c))
  const fc: string[] = []
  for (let i = 0; i < clipPaths.length; i++) {
    fc.push(`[${i}:v]setpts=PTS-STARTPTS,fps=${fps},setsar=1,format=yuv420p[v${i}]`)
  }
  let cur = 'v0'
  let acc = 0
  for (let k = 0; k < clipPaths.length; k++) acc += durations[k]
  let offset = durations[0] - xfade
  for (let k = 1; k < clipPaths.length; k++) {
    const next = `x${k}`
    fc.push(`[${cur}][v${k}]xfade=transition=fade:duration=${xfade}:offset=${offset.toFixed(3)}[${next}]`)
    cur = next
    if (k < clipPaths.length - 1) offset += durations[k] - xfade
  }
  fc.push(`[${cur}]format=yuv420p[vout]`)
  await run(ffmpegBin(), [
    '-y', ...inputs,
    '-filter_complex', fc.join(';'),
    '-map', '[vout]', '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '2',
    outPath,
  ])
}

// ─── Narration audio: concat voices with small gaps ──────────────────────

export async function concatVoices(
  voicePaths: string[],
  gapSec: number,
  outPath: string
): Promise<void> {
  const inputs: string[] = []
  voicePaths.forEach(v => inputs.push('-i', v))
  const fc: string[] = []
  const labels: string[] = []
  voicePaths.forEach((_, i) => {
    fc.push(`[${i}:a]aresample=24000,aformat=channel_layouts=mono[a${i}]`)
    labels.push(`[a${i}]`)
  })
  const n = voicePaths.length
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    parts.push(`[a${i}]`)
    if (i < n - 1) {
      fc.push(`anullsrc=r=24000:cl=mono,atrim=0:${gapSec}[g${i}]`)
      parts.push(`[g${i}]`)
    }
  }
  fc.push(`${parts.join('')}concat=n=${n * 2 - 1}:v=0:a=1[out]`)
  await run(ffmpegBin(), [
    '-y', ...inputs,
    '-filter_complex', fc.join(';'),
    '-map', '[out]', '-ar', '24000', '-ac', '1',
    outPath,
  ])
}

/** Timeline-accurate narration mix for crossfaded / segmented formats:
 *  voice i is placed at exactly `start` seconds on the final timeline, so
 *  picture, voice and captions switch together even after crossfade overlaps.
 *  Segments without a wav simply contribute silence (their slot is skipped). */
export async function mixNarrationTimeline(
  items: { wav: string | null; start: number }[],
  totalDur: number,
  outPath: string
): Promise<void> {
  const voices = items.filter(it => it.wav) as { wav: string; start: number }[]
  const inputs: string[] = []
  voices.forEach(v => inputs.push('-i', v.wav))
  const fc: string[] = []
  const labels: string[] = []
  voices.forEach((v, i) => {
    const ms = Math.max(0, Math.round(v.start * 1000))
    fc.push(`[${i}:a]aresample=24000,aformat=channel_layouts=mono,adelay=${ms}[a${i}]`)
    labels.push(`[a${i}]`)
  })
  if (voices.length === 1) {
    fc.push(`[a0]apad=whole_dur=${totalDur.toFixed(3)},atrim=0:${totalDur.toFixed(3)}[out]`)
  } else {
    fc.push(`${labels.join('')}amix=inputs=${voices.length}:normalize=0:duration=longest,`
      + `apad=whole_dur=${totalDur.toFixed(3)},atrim=0:${totalDur.toFixed(3)}[out]`)
  }
  await run(ffmpegBin(), [
    '-y', ...inputs,
    '-filter_complex', fc.join(';'),
    '-map', '[out]', '-ar', '24000', '-ac', '1',
    outPath,
  ])
}

// ─── Music bed: synthesized ambient pad (royalty-proof, $0) ─────────────

const MUSIC_CHORDS = {
  story: { root: [0, -4, 3, -2], chordDur: 6, gain: 0.24 },   // Am F C G — emotional
  howto: { root: [3, -2, 0, -4], chordDur: 5, gain: 0.18 },   // C G Am F — optimistic
} as const

const MUSIC_SR = 44100

function writeWav16(pcm: Int16Array, outPath: string): void {
  const dataLen = pcm.length * 2
  const buf = Buffer.alloc(44 + dataLen)
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + dataLen, 4)
  buf.write('WAVE', 8, 'ascii'); buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)          // PCM
  buf.writeUInt16LE(2, 22)                                     // stereo
  buf.writeUInt32LE(MUSIC_SR, 24); buf.writeUInt32LE(MUSIC_SR * 4, 28)
  buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(dataLen, 40)
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2)
  fs.writeFileSync(outPath, buf)
}

/** Generate an ambient chord-pad bed of exactly durationSec seconds. */
export function makeMusicBed(kind: 'story' | 'howto', durationSec: number, outPath: string): void {
  const cfg = MUSIC_CHORDS[kind]
  const n = Math.floor(durationSec * MUSIC_SR)
  const l = new Float64Array(n)
  const r = new Float64Array(n)
  const f0 = 220 // A3
  let tChord = 0
  let chordIdx = 0
  while (tChord < durationSec) {
    const dur = Math.min(cfg.chordDur, durationSec - tChord)
    const semis = cfg.root[chordIdx % cfg.root.length]
    const freq = f0 * Math.pow(2, semis / 12)
    const partials = [
      { f: freq, a: 1.0 },
      { f: freq * Math.pow(2, 7 / 12), a: 0.55 },   // fifth
      { f: freq * 2, a: 0.35 },                      // octave
      { f: freq * Math.pow(2, 4 / 12), a: 0.30 },    // third color
    ]
    const i0 = Math.floor(tChord * MUSIC_SR)
    const iEnd = Math.min(n, Math.floor((tChord + dur) * MUSIC_SR))
    for (let i = i0; i < iEnd; i++) {
      const t = (i - i0) / MUSIC_SR
      // attack/release envelope per chord
      const a = Math.min(1, Math.min(t / 1.2, (dur - t) / 1.5, 1))
      const lfo = 0.82 + 0.18 * Math.sin(2 * Math.PI * 0.15 * t)
      let v = 0
      for (const p of partials) {
        v += p.a * (Math.sin(2 * Math.PI * p.f * t) + 0.45 * Math.sin(4 * Math.PI * p.f * t) + 0.18 * Math.sin(6 * Math.PI * p.f * t))
      }
      v *= a * lfo
      l[i] += v
    }
    tChord += dur
    chordIdx++
  }
  // gentle stereo widening: right channel is the left delayed by 12 ms
  const dOff = Math.floor(0.012 * MUSIC_SR)
  for (let i = n - 1; i >= dOff; i--) r[i] = l[i - dOff] * 0.96
  // gentle low-pass noise floor for warmth
  let noise = 0
  for (let i = 0; i < n; i++) {
    noise = noise * 0.995 + (Math.random() * 2 - 1) * 0.005
    l[i] += noise
    r[i] += noise
  }
  let peak = 1e-9
  for (let i = 0; i < n; i++) {
    peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]))
  }
  const g = cfg.gain / peak
  const pcm = new Int16Array(n * 2)
  for (let i = 0; i < n; i++) {
    pcm[i * 2] = Math.max(-32767, Math.min(32767, Math.round(l[i] * g * 32767)))
    pcm[i * 2 + 1] = Math.max(-32767, Math.min(32767, Math.round(r[i] * g * 32767)))
  }
  writeWav16(pcm, outPath)
}

// ─── ASS captions ────────────────────────────────────────────────────────

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  const c = cs % 100
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}

function assEscape(text: string): string {
  return text.replace(/[{}]/g, '').replace(/\r?\n/g, '\\N').trim()
}

/** Split narration into caption cards of ≤ N words, proportional timing. */
export function buildCaptionCards(narration: string, wordsPerCard: number): string[] {
  const words = narration.split(/\s+/).filter(Boolean)
  const cards: string[] = []
  for (let i = 0; i < words.length; i += wordsPerCard) {
    cards.push(words.slice(i, i + wordsPerCard).join(' '))
  }
  return cards.length ? cards : [narration]
}

export function buildAssFile(
  scenes: { narration: string; dur: number; start: number }[],
  format: VideoFormat,
  outPath: string
): void {
  const f = FORMATS[format]
  const res = f.assPlayRes
  const upper = f.capsUppercase
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${res.x}
PlayResY: ${res.y}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,DejaVu Sans,${f.captionFontSize},${f.captionColor},&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,${f.captionOutline},2,2,90,90,${f.captionMarginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const lines: string[] = []
  for (const sc of scenes) {
    const cards = buildCaptionCards(sc.narration, f.captionWordsPerCard || 6)
    const totalWords = cards.reduce((a, c) => a + c.split(/\s+/).length, 0) || 1
    let t = sc.start
    for (const card of cards) {
      const w = card.split(/\s+/).length
      const dur = (w / totalWords) * sc.dur
      const text = assEscape(upper ? card.toUpperCase() : card)
      if (text) lines.push(`Dialogue: 0,${assTime(t)},${assTime(Math.min(t + dur, sc.start + sc.dur))},Cap,,0,0,0,,${text}`)
      t += dur
    }
  }
  fs.writeFileSync(outPath, header + lines.join('\n') + '\n')
}

// ─── Final render: mux video + narration + noise bed + burn captions ─────

export async function finalRender(opts: {
  concatVideo: string
  narrationWav: string
  assPath: string | null
  outPath: string
  musicWav?: string
  musicVol?: number
}): Promise<void> {
  const { concatVideo, narrationWav, assPath, outPath, musicWav, musicVol = 0.16 } = opts
  const vf = assPath ? `ass=${assPath},format=yuv420p` : 'format=yuv420p'
  const args = ['-y', '-i', concatVideo, '-i', narrationWav]
  const fc: string[] = [`[0:v]${vf}[v]`, '[1:a]aresample=24000[voice]']
  // Voice + very subtle brown-noise bed for polish (low level, free & royalty-proof)
  // + optional synthesized music pad for the story/howto formats.
  if (musicWav && fs.existsSync(musicWav)) {
    args.push('-i', musicWav)
    args.push('-f', 'lavfi', '-i', 'anoisesrc=colour=brown:sample_rate=24000:amplitude=0.9,lowpass=f=240,volume=0.035')
    fc.push(`[2:a]volume=${musicVol}[mus]`, '[3:a]apad[bed]')
    fc.push('[voice][mus][bed]amix=inputs=3:duration=first:normalize=0[a]')
  } else {
    args.push('-f', 'lavfi', '-i', 'anoisesrc=colour=brown:sample_rate=24000:amplitude=0.9,lowpass=f=240,volume=0.035')
    fc.push('[2:a]apad[bed]')
    fc.push('[voice][bed]amix=inputs=2:duration=first:normalize=0[a]')
  }
  const args2 = [
    ...args,
    '-filter_complex', fc.join(';'),
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'superfast', '-crf', '22', '-threads', '2',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '24000',
    '-shortest', '-movflags', '+faststart',
    outPath,
  ]
  await run(ffmpegBin(), args2)
}

// ─── How-To step cards (clean dark design, ffmpeg drawtext — no deps) ────

const CARD_BG = '0x0F1220'
const CARD_AMBER = '0xFFB020'
const CARD_WHITE = '0xF5F7FF'
const CARD_MUTE = '0x949CB4'
const CARD_GHOST = '0x22283E'

function cardTextFile(dir: string, name: string, text: string): string {
  const p = path.join(dir, `${name}.txt`)
  fs.writeFileSync(p, text)
  return p
}

async function renderCard(drawParts: string[], W: number, H: number, outPath: string): Promise<void> {
  await run(ffmpegBin(), [
    '-y', '-f', 'lavfi', '-i', `color=c=${CARD_BG}:s=${W}x${H}`,
    '-filter_complex', drawParts.join(','),
    '-frames:v', '1', outPath,
  ])
}

function dt(dir: string, id: string, text: string, x: string, y: string, size: number, color: string): string {
  const f = cardTextFile(dir, `card_${id}`, text)
  return `drawtext=fontfile=${FONT_BOLD}:textfile=${f}:fontcolor=${color}:fontsize=${size}:x=${x}:y=${y}`
}

/** Render all step cards for a howto script into dir; returns path per scene index. */
export async function makeHowtoCards(
  cards: { kind: 'title' | 'step' | 'recap' | 'outro'; stepNumber?: number; line1: string; line2?: string }[],
  stepTitles: string[],
  dir: string,
  W: number,
  H: number,
  outPaths: string[]
): Promise<void> {
  const s = W / 1280 // design scale (base design 1280x720)
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]
    const out = outPaths[i]
    if (!c || !out) continue
    const parts: string[] = [`drawbox=x=0:y=0:w=${W}:h=${H}:color=${CARD_BG}:t=fill`]
    // corner ring decorations (subtle)
    parts.push(`drawbox=x=${W - Math.round(120 * s)}:y=${H - Math.round(120 * s)}:w=${Math.round(90 * s)}:h=${Math.round(90 * s)}:color=${CARD_GHOST}:t=fill`)
    if (c.kind === 'title') {
      parts.push(dt(dir, `t1_${i}`, c.line1, '(w-text_w)/2', String(Math.round(190 * s)), Math.round(78 * s), CARD_WHITE))
      parts.push(dt(dir, `t2_${i}`, c.line2 || '', '(w-text_w)/2', String(Math.round(310 * s)), Math.round(58 * s), CARD_AMBER))
      parts.push(`drawbox=x=${Math.round(W / 2 - 140 * s)}:y=${Math.round(396 * s)}:w=${Math.round(280 * s)}:h=${Math.round(5 * s)}:color=${CARD_AMBER}:t=fill`)
    } else if (c.kind === 'step') {
      const num = String(c.stepNumber ?? '')
      parts.push(dt(dir, `g_${i}`, num, String(W - Math.round(360 * s)), String(Math.round(80 * s)), Math.round(360 * s), CARD_GHOST))
      parts.push(dt(dir, `l_${i}`, `STEP ${num}`, String(Math.round(90 * s)), String(Math.round(96 * s)), Math.round(52 * s), CARD_AMBER))
      parts.push(`drawbox=x=${Math.round(92 * s)}:y=${Math.round(178 * s)}:w=${Math.round(120 * s)}:h=${Math.round(5 * s)}:color=${CARD_AMBER}:t=fill`)
      parts.push(dt(dir, `m_${i}`, c.line1, String(Math.round(90 * s)), String(Math.round(250 * s)), Math.round(72 * s), CARD_WHITE))
      if (c.line2) parts.push(dt(dir, `n_${i}`, c.line2, String(Math.round(90 * s)), String(Math.round(390 * s)), Math.round(38 * s), CARD_MUTE))
      parts.push(dt(dir, `f_${i}`, 'faceless · free · 2026', String(Math.round(90 * s)), String(H - Math.round(120 * s)), Math.round(26 * s), '0x5A6482'))
    } else if (c.kind === 'recap') {
      parts.push(dt(dir, `rh_${i}`, 'THE 5 STEPS', String(Math.round(90 * s)), String(Math.round(70 * s)), Math.round(58 * s), CARD_AMBER))
      parts.push(`drawbox=x=${Math.round(92 * s)}:y=${Math.round(158 * s)}:w=${Math.round(130 * s)}:h=${Math.round(5 * s)}:color=${CARD_AMBER}:t=fill`)
      let y = Math.round(215 * s)
      stepTitles.slice(0, 5).forEach((t, j) => {
        parts.push(dt(dir, `rn_${i}_${j}`, String(j + 1), String(Math.round(90 * s)), String(y), Math.round(42 * s), CARD_AMBER))
        parts.push(dt(dir, `rt_${i}_${j}`, t, String(Math.round(150 * s)), String(y + Math.round(4 * s)), Math.round(38 * s), CARD_WHITE))
        y += Math.round(88 * s)
      })
    } else {
      // outro
      parts.push(dt(dir, `o1_${i}`, 'FOLLOW', '(w-text_w)/2', String(Math.round(220 * s)), Math.round(110 * s), CARD_AMBER))
      parts.push(`drawbox=x=${Math.round(W / 2 - 140 * s)}:y=${Math.round(380 * s)}:w=${Math.round(280 * s)}:h=${Math.round(5 * s)}:color=${CARD_AMBER}:t=fill`)
      parts.push(dt(dir, `o2_${i}`, c.line1 || 'Building this from zero', '(w-text_w)/2', String(Math.round(430 * s)), Math.round(40 * s), CARD_WHITE))
      parts.push(dt(dir, `o3_${i}`, c.line2 || 'Watch what happens', '(w-text_w)/2', String(Math.round(500 * s)), Math.round(40 * s), CARD_WHITE))
    }
    await renderCard(parts, W, H, out)
  }
}

// ─── Thumbnail ───────────────────────────────────────────────────────────

export function wrapThumbnailText(text: string, maxChars = 13): string[] {
  const words = text.toUpperCase().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (!cur) cur = w
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  return lines.slice(0, 3)
}

export async function makeThumbnail(
  baseImg: string,
  text: string,
  outPath: string,
  tmpDir: string
): Promise<void> {
  const lines = wrapThumbnailText(text)
  const fontSize = lines.length >= 3 ? 104 : 130
  const lineHeight = Math.round(fontSize * 1.14)
  const blockH = lines.length * lineHeight
  const startY = 720 - blockH - 84

  // write each line to a textfile to dodge drawtext escaping issues
  const lineFiles: string[] = []
  lines.forEach((ln, i) => {
    const p = path.join(tmpDir, `thumb_line_${i}.txt`)
    fs.writeFileSync(p, ln)
    lineFiles.push(p)
  })

  const filters = [
    'scale=1280:720:force_original_aspect_ratio=increase',
    'crop=1280:720',
    'eq=contrast=1.07:saturation=1.18',
  ]
  const draw = lineFiles.map((p, i) => {
    const y = startY + i * lineHeight
    return [
      `drawtext=fontfile=${FONT_BOLD}:textfile=${p}`,
      `fontsize=${fontSize}`,
      'fontcolor=white',
      'borderw=12', 'bordercolor=black',
      'shadowx=5', 'shadowy=5', 'shadowcolor=black@0.7',
      'x=(w-text_w)/2', `y=${y}`,
    ].join(':')
  })

  await run(ffmpegBin(), [
    '-y', '-i', baseImg,
    '-filter_complex', `${filters.join(',')},${draw.join(',')}`,
    '-frames:v', '1', '-q:v', '2',
    outPath,
  ])
  lineFiles.forEach(p => fs.rmSync(p, { force: true }))
}
