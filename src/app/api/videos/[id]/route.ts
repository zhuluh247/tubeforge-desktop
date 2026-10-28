import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { db } from '@/lib/db'
import { scriptDir } from '@/lib/yt/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const video = await db.video.findUnique({
    where: { id },
    include: { logs: { orderBy: { createdAt: 'asc' } } },
  })
  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ video })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const video = await db.video.findUnique({ where: { id } })
  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    fs.rmSync(scriptDir(id), { recursive: true, force: true })
  } catch { /* best effort */ }
  await db.video.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
