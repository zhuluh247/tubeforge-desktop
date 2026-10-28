import { NextResponse } from 'next/server'
import { ffmpegBin, ffprobeBin } from '@/lib/yt/media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Deployment stamp + binary diagnostics. Bump BUILD_TAG with every release
 *  so it's instantly obvious which build a tab is connected to. */
const BUILD_TAG = 'v0.3.0-ffstatic'

export async function GET() {
  let ffmpeg = 'MISSING'
  let ffprobe = 'MISSING'
  try { ffmpeg = ffmpegBin() } catch { /* stays MISSING */ }
  try { ffprobe = ffprobeBin() } catch { /* stays MISSING */ }

  return NextResponse.json({
    ok: true,
    name: 'TubeForge',
    build: BUILD_TAG,
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    ffmpeg: ffmpeg.split('/').slice(-2).join('/'),
    ffprobe: ffprobe.split('/').slice(-2).join('/'),
  })
}
