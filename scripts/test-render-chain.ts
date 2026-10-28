// Render-chain smoke test: exercises the EXACT functions the pipeline uses,
// without any network. Verifies dimensions at RENDER_SCALE=720 and 1080.
import fs from 'fs'
import path from 'path'
import { FORMATS } from '../src/lib/yt/constants'
import {
  makeSceneClip, concatClips, concatVoices, buildAssFile, finalRender,
  probeDuration, ffmpegBin, ffprobeBin,
} from '../src/lib/yt/media'
import { execFileSync } from 'child_process'

const DIR = '/home/z/my-project/.tmp/render-test'

async function main() {
  fs.rmSync(DIR, { recursive: true, force: true })
  fs.mkdirSync(DIR, { recursive: true })
  const scale = process.env.RENDER_SCALE || '1080'
  const f = FORMATS.short
  console.log(`RENDER_SCALE=${scale} → short resolution ${f.resolution.w}x${f.resolution.h}, assPlayRes ${f.assPlayRes.x}x${f.assPlayRes.y}, captionFont ${f.captionFontSize}px`)

  // 1) two synthetic 9:16 scene images (ffmpeg gradients)
  const imgA = path.join(DIR, 'scene_00.png')
  const imgB = path.join(DIR, 'scene_01.png')
  execFileSync(ffmpegBin(), ['-y', '-f', 'lavfi', '-i',
    `gradients=s=${f.genImageSize.replace('x', 'x')}:c0=0x0f172a:c1=0x334155`, '-frames:v', '1', imgA])
  execFileSync(ffmpegBin(), ['-y', '-f', 'lavfi', '-i',
    'gradients=s=768x1344:c0=0x14532d:c1=0x4ade80', '-frames:v', '1', imgB])

  // 2) two synthetic voice WAVs (sine tone, 2s each, 24kHz mono)
  const wavA = path.join(DIR, 'voice_00.wav')
  const wavB = path.join(DIR, 'voice_01.wav')
  execFileSync(ffmpegBin(), ['-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2:sample_rate=24000', '-ac', '1', wavA])
  execFileSync(ffmpegBin(), ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2:sample_rate=24000', '-ac', '1', wavB])

  // 3) scene clips with Ken Burns (the changed code path)
  const clipA = path.join(DIR, 'clip_00.mp4')
  const clipB = path.join(DIR, 'clip_01.mp4')
  await makeSceneClip(imgA, clipA, 2, 'short', 0)
  await makeSceneClip(imgB, clipB, 2, 'short', 1)

  // 4) concat + voice mix + captions + final render
  const concat = path.join(DIR, 'concat.mp4')
  await concatClips([clipA, clipB], concat)
  const narration = path.join(DIR, 'narration.wav')
  await concatVoices([wavA, wavB], 0.22, narration)
  const ass = path.join(DIR, 'captions.ass')
  buildAssFile([
    { narration: 'This is the first test scene with captions.', dur: 2, start: 0 },
    { narration: 'Second scene checks the caption burn too.', dur: 2, start: 2.22 },
  ], 'short', ass)
  const out = path.join(DIR, 'video.mp4')
  await finalRender({ concatVideo: concat, narrationWav: narration, assPath: ass, outPath: out })

  // 5) verify dimensions + duration
  const dimOut = execFileSync(ffprobeBin(), [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height', '-of', 'csv=p=0', out]).toString().trim()
  const dur = await probeDuration(out)
  const sizeMB = (fs.statSync(out).size / 1e6).toFixed(2)
  console.log(`OUTPUT: ${dimOut}, ${dur.toFixed(2)}s, ${sizeMB}MB`)

  const [w, h] = dimOut.split(',').map(Number)
  if (w !== f.resolution.w || h !== f.resolution.h) {
    throw new Error(`DIMENSION MISMATCH: got ${w}x${h}, expected ${f.resolution.w}x${f.resolution.h}`)
  }
  if (dur < 3.9 || dur > 5.0) throw new Error(`BAD DURATION: ${dur}`)
  console.log(`RENDER TEST PASSED at scale ${scale}`)
}

main().then(
  () => process.exit(0),
  e => { console.error('RENDER TEST FAILED:', e); process.exit(1) }
)
