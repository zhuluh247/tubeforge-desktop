// Live test: free TTS fallback (StreamElements) + ffmpeg WAV normalization
import fs from 'fs'
import path from 'path'
import os from 'os'

const VOICES = ['Brian', 'Joanna', 'Matthew']

async function testVoice(voice: string, text: string): Promise<void> {
  const url =
    `https://api.streamelements.com/kappa/v2/speech` +
    `?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
  console.log(voice, '-> HTTP', res.status, res.headers.get('content-type'))
  if (!res.ok) return
  const mp3 = Buffer.from(new Uint8Array(await res.arrayBuffer()))
  console.log('  mp3 bytes:', mp3.length)
  const tmp = path.join(os.tmpdir(), `tftest-${voice}`)
  fs.writeFileSync(tmp + '.bin', mp3)
  const { execFileSync } = await import('child_process')
  execFileSync('/usr/bin/ffmpeg', ['-y', '-i', tmp + '.bin', '-ar', '24000', '-ac', '1', tmp + '.wav'], { stdio: 'pipe' })
  const wav = fs.readFileSync(tmp + '.wav')
  console.log('  wav bytes:', wav.length, '| RIFF ok:', wav.toString('ascii', 0, 4) === 'RIFF')
  fs.rmSync(tmp + '.bin', { force: true })
  fs.rmSync(tmp + '.wav', { force: true })
}

for (const v of VOICES) {
  await testVoice(v, 'Five facts about the ocean that scientists still cannot fully explain.')
}
console.log('DONE')
