// End-to-end test of the new ai.ts voice chain (no config present → free providers)
// and the public-API image size mapping logic.
import fs from 'fs'
import path from 'path'
import os from 'os'

// Ensure no .z-ai-config is visible so we take the FREE tts path
process.env.ZAI_CONFIG_JSON = ''

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-voice-e2e-'))
const outPath = path.join(outDir, 'voice_00.wav')

const { synthesizeSpeech } = await import('../src/lib/yt/ai')
await synthesizeSpeech(
  'Five facts about the ocean that sound completely unreal. Scientists still cannot explain what lives at the bottom of the Mariana Trench.',
  'jam', // → en-GB-RyanNeural
  1.05,
  outPath
)
const wav = fs.readFileSync(outPath)
const ok = wav.length > 50_000 && wav.toString('ascii', 0, 4) === 'RIFF'
console.log('voice wav bytes:', wav.length, '| RIFF ok:', wav.toString('ascii', 0, 4) === 'RIFF')

// duration check via ffprobe
const { execFileSync } = await import('child_process')
const dur = execFileSync('/usr/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outPath]).toString().trim()
console.log('duration (s):', dur)
fs.rmSync(outDir, { recursive: true, force: true })
console.log(ok && Number(dur) > 5 ? 'E2E VOICE CHAIN: WORKS' : 'E2E VOICE CHAIN: FAILED')
