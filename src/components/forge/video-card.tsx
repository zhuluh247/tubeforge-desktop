'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Play, Download, UploadCloud, RotateCcw, Trash2, Clock, Film, Smartphone,
  AlertTriangle, Bot, User, Loader2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { assetUrl, fmtDuration, readJsonSafe, STATUS_LABEL, type VideoRow } from '@/lib/yt/client-types'
import { formatDistanceToNow } from 'date-fns'

interface Props {
  video: VideoRow
  onOpen: (v: VideoRow) => void
  onChanged: () => void
}

export function VideoCard({ video, onOpen, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const meta = STATUS_LABEL[video.status] || STATUS_LABEL.queued
  const isActive = ['scripting', 'voicing', 'visualizing', 'rendering', 'thumbnailing', 'uploading'].includes(video.status)
  const thumb = video.thumbPath ? assetUrl(video.id, 'thumb.jpg') : null

  async function doUpload() {
    setBusy('upload')
    try {
      const res = await fetch(`/api/videos/${video.id}/upload`, { method: 'POST' })
      const json = await readJsonSafe(res)
      if (!res.ok) throw new Error((json.error as string) || 'Upload failed')
      toast.success('Published to YouTube!', { description: `Video ID: ${json.youtubeId}` })
      onChanged()
    } catch (e) {
      toast.error('Upload failed', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
      onChanged()
    }
  }

  async function doRetry() {
    setBusy('retry')
    try {
      const res = await fetch(`/api/videos/${video.id}/retry`, { method: 'POST' })
      if (!res.ok) {
        const j = await readJsonSafe(res)
        throw new Error((j.error as string) || 'Retry failed')
      }
      toast.success('Re-queued for production')
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Retry failed')
    } finally {
      setBusy(null)
    }
  }

  async function doDelete() {
    setBusy('delete')
    try {
      const res = await fetch(`/api/videos/${video.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      toast.success('Video deleted')
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(null)
    }
  }

  const vertical = video.format === 'short'

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      className="group rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden hover:border-zinc-700 hover:bg-zinc-900 transition-colors"
    >
      <div className="flex gap-3 p-3">
        {/* thumb */}
        <button
          onClick={() => onOpen(video)}
          className={`relative shrink-0 overflow-hidden rounded-lg bg-zinc-950 border border-zinc-800 cursor-pointer ${vertical ? 'w-16 h-28' : 'w-36 h-[5.2rem]'}`}
          aria-label={`Open ${video.title || video.topic}`}
        >
          {thumb ? (
            <img src={thumb} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-950">
              {vertical ? <Smartphone className="w-5 h-5 text-zinc-600" /> : <Film className="w-6 h-6 text-zinc-600" />}
            </div>
          )}
          {video.status === 'uploaded' && (
            <span className="absolute bottom-1 right-1 bg-red-600 text-white text-[9px] font-bold px-1 py-0.5 rounded-sm uppercase">YT</span>
          )}
          <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Play className="w-6 h-6 text-white fill-white" />
          </span>
        </button>

        {/* info */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-start gap-2">
            <button onClick={() => onOpen(video)} className="text-left flex-1 min-w-0 cursor-pointer">
              <p className="text-sm font-semibold text-zinc-100 leading-snug line-clamp-2">
                {video.title || video.topic || 'Picking a topic…'}
              </p>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-200 shrink-0">
                  <span className="text-lg leading-none">⋯</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800 text-zinc-200">
                <DropdownMenuItem onClick={() => onOpen(video)} className="cursor-pointer">
                  <Play className="w-4 h-4 mr-2" /> Open studio
                </DropdownMenuItem>
                {video.videoPath && (
                  <DropdownMenuItem asChild>
                    <a
                      href={assetUrl(video.id, 'video.mp4', true, `${(video.title || 'video').replace(/[^\w\-. ]+/g, '_').slice(0, 60)}.mp4`)}
                      className="cursor-pointer flex items-center"
                    >
                      <Download className="w-4 h-4 mr-2" /> Download MP4
                    </a>
                  </DropdownMenuItem>
                )}
                {video.status === 'ready' && (
                  <DropdownMenuItem onClick={doUpload} className="cursor-pointer">
                    <UploadCloud className="w-4 h-4 mr-2" /> Publish to YouTube
                  </DropdownMenuItem>
                )}
                {(video.status === 'failed' || video.status === 'ready') && (
                  <DropdownMenuItem onClick={doRetry} className="cursor-pointer">
                    <RotateCcw className="w-4 h-4 mr-2" /> Re-run pipeline
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={doDelete} className="cursor-pointer text-red-400 focus:text-red-300">
                  <Trash2 className="w-4 h-4 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${meta.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full mr-1 ${meta.dot} ${isActive ? 'animate-pulse' : ''}`} />
              {meta.label}
            </Badge>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-zinc-700 text-zinc-400">
              {vertical ? <Smartphone className="w-2.5 h-2.5 mr-1" /> : <Film className="w-2.5 h-2.5 mr-1" />}
              {vertical ? 'Short' : 'Long-form'}
            </Badge>
            {video.source === 'auto' && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-zinc-700 text-zinc-400">
                <Bot className="w-2.5 h-2.5 mr-1" /> Auto
              </Badge>
            )}
            <span className="text-[10px] text-zinc-500 flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              {fmtDuration(video.durationSec)} · {formatDistanceToNow(new Date(video.createdAt), { addSuffix: true })}
            </span>
          </div>

          {isActive && (
            <div className="mt-2">
              <Progress value={video.progress} className="h-1.5 bg-zinc-800 [&>div]:bg-red-500" />
              <p className="text-[10px] text-zinc-500 mt-1">{video.stage} · {video.progress}%</p>
            </div>
          )}
          {video.status === 'queued' && (
            <p className="text-[11px] text-zinc-500 mt-2 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Waiting for a free worker…
            </p>
          )}
          {video.status === 'failed' && (
            <p className="text-[11px] text-red-400/90 mt-2 flex items-start gap-1.5 line-clamp-2">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {video.error || 'Pipeline failed'}
            </p>
          )}
          {video.status === 'ready' && (
            <div className="mt-auto pt-2 flex gap-1.5">
              <Button size="sm" className="h-7 text-xs bg-red-600 hover:bg-red-500 text-white" onClick={doUpload} disabled={busy === 'upload'}>
                {busy === 'upload' ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <UploadCloud className="w-3 h-3 mr-1" />}
                Publish
              </Button>
              <Button
                size="sm" variant="outline" className="h-7 text-xs border-zinc-700 text-zinc-300 hover:text-white"
                onClick={() => onOpen(video)}
              >
                <Play className="w-3 h-3 mr-1" /> Preview
              </Button>
            </div>
          )}
          {video.status === 'uploaded' && video.youtubeId && (
            <a
              href={`https://youtube.com/watch?v=${video.youtubeId}`}
              target="_blank" rel="noreferrer"
              className="mt-auto pt-2 text-[11px] text-red-400 hover:text-red-300 flex items-center gap-1"
            >
              <User className="w-3 h-3" /> Watch on YouTube →
            </a>
          )}
        </div>
      </div>
    </motion.div>
  )
}
