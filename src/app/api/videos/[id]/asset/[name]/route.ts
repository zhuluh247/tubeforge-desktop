import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { scriptDir } from '@/lib/yt/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.wav': 'audio/wav',
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> }
) {
  const { id, name } = await params
  // path-traversal guard
  if (id.includes('..') || name.includes('..') || name.includes('/') || name.includes('\\')) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  const filePath = path.join(scriptDir(id), name)
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const ext = path.extname(name).toLowerCase()
  const type = MIME[ext] || 'application/octet-stream'
  const size = fs.statSync(filePath).size
  const download = req.nextUrl.searchParams.get('download') === '1'
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  }
  if (download) {
    const outName = `${(req.nextUrl.searchParams.get('as') || name).replace(/[^\w\-. ]+/g, '_')}`
    headers['Content-Disposition'] = `attachment; filename="${outName}"`
  }

  const range = req.headers.get('range')
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/)
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0
      let end = m[2] ? parseInt(m[2], 10) : size - 1
      if (isNaN(start) || start >= size) start = 0
      if (isNaN(end) || end >= size - 1) end = size - 1
      if (start > end) [start, end] = [0, size - 1]
      // Stream ONLY the requested byte range — never read the whole file
      // into memory (a video preview fires many small range requests, and
      // buffering the full MP4 each time OOMs the 512MB Render free tier).
      const rangeStream = Readable.toWeb(
        fs.createReadStream(filePath, { start, end })
      ) as unknown as ReadableStream
      return new NextResponse(rangeStream, {
        status: 206,
        headers: {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1),
        },
      })
    }
  }

  const stream = Readable.toWeb(fs.createReadStream(filePath)) as unknown as ReadableStream
  return new NextResponse(stream, { headers: { ...headers, 'Content-Length': String(size) } })
}
