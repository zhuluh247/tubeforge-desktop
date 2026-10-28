// Live test: msedge-tts (Edge neural voices, no API key) — run with node
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import fs from 'fs'
import path from 'path'
import os from 'os'

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-test-'))
const tts = new MsEdgeTTS()
await tts.setMetadata('en-US-ChristopherNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
await tts.toFile(outDir, 'Five facts about the ocean that scientists still cannot fully explain.')
const produced = fs.readdirSync(outDir)
console.log('files produced:', produced)
const mp3Path = path.join(outDir, produced.find(f => f.endsWith('.mp3')) || produced[0])
const mp3 = fs.readFileSync(mp3Path)
console.log('mp3 bytes:', mp3.length, '| ID3/MPEG ok:', mp3.toString('ascii', 0, 3) === 'ID3' || mp3[0] === 0xff)

// also verify our 24k mono wav normalization works on it
const { execFileSync } = await import('child_process')
const wavPath = mp3Path.replace(/\.mp3$/, '.wav')
execFileSync('/usr/bin/ffmpeg', ['-y', '-i', mp3Path, '-ar', '24000', '-ac', '1', wavPath], { stdio: 'pipe' })
const wav = fs.readFileSync(wavPath)
console.log('wav bytes:', wav.length, '| RIFF ok:', wav.toString('ascii', 0, 4) === 'RIFF')
fs.rmSync(outDir, { recursive: true, force: true })
console.log('EDGE TTS: WORKS')

