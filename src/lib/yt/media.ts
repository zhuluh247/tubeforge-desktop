// ─── FFmpeg media engine: clips, audio, subtitles, thumbnail, final mux ──
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { FORMATS, type VideoFormat } from './constants'

const FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

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
  // 24 fps: filmic, and 20% fewer frames to encode than 30 — big win on
  // weak CPUs (Render free tier). Ken Burns pans still look smooth.
  const fps = 24
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

  if (format === 'short') {
    scale = `scale=${cw}:${ch}:force_original_aspect_ratio=increase,crop=${cw}:${ch},setsar=1`
    if (sceneIdx === 0)
      zoompan = `zoompan=z='min(1+0.16*on/${N},1.16)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${N}:s=${s}:fps=${fps}`
    else if (sceneIdx === 1)
      zoompan = `zoompan=z='1.16-0.16*on/${N}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${N}:s=${s}:fps=${fps}`
    else if (sceneIdx === 2)
      zoompan = `zoompan=z='1.12':x='(iw-iw/zoom)*on/${N}':y='ih/2-(ih/zoom/2)':d=${N}:s=${s}:fps=${fps}`
    else
      zoompan = `zoompan=z='1.12':x='(iw-iw/zoom)*(1-on/${N})':y='ih/2-(ih/zoom/2)':d=${N}:s=${s}:fps=${fps}`
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
  const upper = format === 'short'
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${res.x}
PlayResY: ${res.y}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,DejaVu Sans,${f.captionFontSize},&H00FFFFFF,&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,${f.captionOutline},2,2,90,90,${f.captionMarginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const lines: string[] = []
  for (const sc of scenes) {
    const cards = buildCaptionCards(sc.narration, f.captionWordsPerCard)
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
}): Promise<void> {
  const { concatVideo, narrationWav, assPath, outPath } = opts
  const vf = assPath ? `ass=${assPath},format=yuv420p` : 'format=yuv420p'
  // Voice + very subtle brown-noise bed for polish (low level, free & royalty-proof)
  const args = [
    '-y', '-i', concatVideo, '-i', narrationWav,
    '-f', 'lavfi', '-i', 'anoisesrc=colour=brown:sample_rate=24000:amplitude=0.9,lowpass=f=240,volume=0.035',
    '-filter_complex',
    `[0:v]${vf}[v];[1:a]aresample=24000[voice];[2:a]apad[bed];[voice][bed]amix=inputs=2:duration=first:normalize=0[a]`,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'superfast', '-crf', '22', '-threads', '2',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '24000',
    '-shortest', '-movflags', '+faststart',
    outPath,
  ]
  await run(ffmpegBin(), args)
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
