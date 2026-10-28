// Sanity checks: AI SDK, Google reachability, ffprobe spawn
import ZAI from 'z-ai-web-dev-sdk'
import { spawn } from 'child_process'

async function main() {
  // 1) ffprobe spawn
  await new Promise<void>((res, rej) => {
    const p = spawn('ffprobe', ['-version'])
    let o = ''
    p.stdout.on('data', d => (o += d))
    p.on('error', rej)
    p.on('close', c => c === 0 ? res() : rej(new Error('ffprobe exit ' + c)))
  })
  console.log('1) ffprobe spawn: OK')

  // 2) Google OAuth token endpoint reachability (expect 400 invalid_request JSON, NOT HTML)
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=authorization_code&code=dummy&client_id=dummy&client_secret=dummy&redirect_uri=http://localhost:1',
  })
  const t = await r.text()
  console.log('2) googleapis token endpoint:', r.status, t.slice(0, 120))

  // 3) YouTube API endpoint reachability
  const y = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true')
  console.log('3) youtube api endpoint:', y.status, (await y.text()).slice(0, 100))

  // 4) AI chat
  const zai = await ZAI.create()
  const c = await zai.chat.completions.create({
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
  })
  console.log('4) AI chat:', c.choices[0]?.message?.content?.slice(0, 50))

  // 5) TTS
  const tts = await zai.audio.tts.create({ input: 'Testing one two three.', voice: 'jam', response_format: 'wav', stream: false })
  const ab = await tts.arrayBuffer()
  console.log('5) TTS bytes:', ab.byteLength)

  console.log('ALL CHECKS DONE')
}

main().catch(e => { console.error('CHECK FAILED:', e instanceof Error ? e.message : e); process.exit(1) })
