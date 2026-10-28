'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Copy, Download, CheckCircle2, Info, AlertTriangle, XCircle, Smartphone, Film } from 'lucide-react'
import { assetUrl, fmtDuration, STATUS_LABEL, type VideoRow } from '@/lib/yt/client-types'

interface ScriptScene {
  narration: string
  imagePrompt: string
  caption: string
}
interface ResolvedScene {
  narration: string
  caption: string
  dur: number
  start: number
}

export function DetailDialog({
  video, open, onOpenChange,
}: {
  video: VideoRow | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [tab, setTab] = useState('preview')

  const script = useMemo<ScriptScene[] | null>(() => {
    if (!video?.script) return null
    try {
      const s = JSON.parse(video.script)
      return Array.isArray(s.scenes) ? s.scenes : null
    } catch { return null }
  }, [video])

  const resolved = useMemo<ResolvedScene[] | null>(() => {
    if (!video?.scenesJson) return null
    try {
      const s = JSON.parse(video.scenesJson)
      return Array.isArray(s) ? s : null
    } catch { return null }
  }, [video])

  const tags = useMemo<string[]>(() => {
    if (!video?.tags) return []
    try { return JSON.parse(video.tags) } catch { return [] }
  }, [video])

  const meta = STATUS_LABEL[video?.status || 'queued'] || STATUS_LABEL.queued
  const hasVideo = video?.videoPath && (video.status === 'ready' || video.status === 'uploaded' || video.status === 'failed')

  if (!video) return null

  function copy(text: string, what: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${what} copied`),
      () => toast.error('Copy failed')
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-zinc-950 border-zinc-800 text-zinc-100 max-h-[88vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={`text-[10px] ${meta.badge}`}>{meta.label}</Badge>
            <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
              {video.format === 'short' ? <Smartphone className="w-2.5 h-2.5 mr-1 inline" /> : <Film className="w-2.5 h-2.5 mr-1 inline" />}
              {video.format === 'short' ? 'Short (9:16)' : 'Long-form (16:9)'}
            </Badge>
            <span className="text-[11px] text-zinc-500">{fmtDuration(video.durationSec)}</span>
          </div>
          <DialogTitle className="text-lg leading-snug text-left">{video.title || video.topic || 'Picking a topic…'}</DialogTitle>
          <DialogDescription className="text-xs text-zinc-500 text-left">
            Voice: {video.voice} · {video.source === 'auto' ? 'Created by auto-pilot' : 'Created manually'}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="bg-zinc-900 border border-zinc-800 w-fit">
            <TabsTrigger value="preview" className="text-xs data-[state=active]:bg-zinc-800">Preview</TabsTrigger>
            <TabsTrigger value="script" className="text-xs data-[state=active]:bg-zinc-800">Script</TabsTrigger>
            <TabsTrigger value="meta" className="text-xs data-[state=active]:bg-zinc-800">SEO & Metadata</TabsTrigger>
            <TabsTrigger value="logs" className="text-xs data-[state=active]:bg-zinc-800">Logs</TabsTrigger>
          </TabsList>

          <div className="flex-1 min-h-0 mt-3">
            <TabsContent value="preview" className="mt-0 h-full">
              <ScrollArea className="h-[52vh] pr-2">
                {hasVideo ? (
                  <div className="space-y-3">
                    <div className={`mx-auto rounded-xl overflow-hidden border border-zinc-800 bg-black ${video.format === 'short' ? 'max-w-[270px]' : ''}`}>
                      <video
                        src={assetUrl(video.id, 'video.mp4')}
                        controls
                        playsInline
                        className="w-full"
                        poster={video.thumbPath ? assetUrl(video.id, 'thumb.jpg') : undefined}
                      />
                    </div>
                    {video.youtubeId && (
                      <a href={`https://youtube.com/watch?v=${video.youtubeId}`} target="_blank" rel="noreferrer"
                        className="block text-center text-xs text-red-400 hover:text-red-300">
                        ▶ Watch on YouTube
                      </a>
                    )}
                  </div>
                ) : video.thumbPath ? (
                  <img src={assetUrl(video.id, 'thumb.jpg')} alt="thumbnail" className="rounded-xl border border-zinc-800 w-full" />
                ) : (
                  <div className="rounded-xl border border-dashed border-zinc-800 h-48 flex flex-col items-center justify-center text-zinc-500 text-sm gap-2">
                    <span className="text-2xl">🎬</span>
                    {video.status === 'failed' ? 'Render failed — check Logs, then re-run the pipeline.' : 'Video will appear here once rendering finishes.'}
                  </div>
                )}

                {video.status === 'failed' && video.error && (
                  <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 p-3 text-xs text-red-300 flex gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span className="break-words">{video.error}</span>
                  </div>
                )}

                {resolved && resolved.length > 0 && (
                  <>
                    <Separator className="my-4 bg-zinc-800" />
                    <p className="text-xs font-semibold text-zinc-400 mb-2">Scene strip ({resolved.length} scenes)</p>
                    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                      {resolved.map((s, i) => (
                        <div key={i} className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900">
                          <img src={assetUrl(video.id, `scene_${String(i).padStart(2, '0')}.png`)} alt={`scene ${i + 1}`} className="w-full aspect-[9/16] object-cover" />
                          <p className="text-[9px] text-zinc-500 px-1.5 py-1 truncate">{s.caption || `Scene ${i + 1}`}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="script" className="mt-0 h-full">
              <ScrollArea className="h-[52vh] pr-2">
                {!script ? (
                  <p className="text-sm text-zinc-500">Script is being written…</p>
                ) : (
                  <div className="space-y-3">
                    {script.map((s, i) => (
                      <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">Scene {i + 1}</Badge>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] text-zinc-500 hover:text-zinc-200 px-2"
                            onClick={() => copy(s.narration, `Scene ${i + 1} narration`)}>
                            <Copy className="w-3 h-3 mr-1" /> Copy
                          </Button>
                        </div>
                        <p className="text-sm text-zinc-200 leading-relaxed">{s.narration}</p>
                        <p className="text-[10px] text-zinc-500 mt-2 italic">Art: {s.imagePrompt}</p>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="meta" className="mt-0 h-full">
              <ScrollArea className="h-[52vh] pr-2">
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-zinc-400">Title</p>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] text-zinc-500" onClick={() => copy(video.title || '', 'Title')}>
                        <Copy className="w-3 h-3 mr-1" /> Copy
                      </Button>
                    </div>
                    <p className="text-sm text-zinc-200 bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">{video.title || '—'}</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-zinc-400">Description</p>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] text-zinc-500" onClick={() => copy(video.description || '', 'Description')}>
                        <Copy className="w-3 h-3 mr-1" /> Copy
                      </Button>
                    </div>
                    <p className="text-sm text-zinc-300 bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">{video.description || '—'}</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-zinc-400">Tags ({tags.length})</p>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] text-zinc-500" onClick={() => copy(tags.join(', '), 'Tags')}>
                        <Copy className="w-3 h-3 mr-1" /> Copy all
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((t, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">{t}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="logs" className="mt-0 h-full">
              <ScrollArea className="h-[52vh] pr-2">
                <div className="space-y-1.5">
                  {(video.logs || []).map((l) => {
                    const Icon = l.level === 'error' ? XCircle : l.level === 'warn' ? AlertTriangle : l.level === 'success' ? CheckCircle2 : Info
                    const color = l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400' : l.level === 'success' ? 'text-emerald-400' : 'text-zinc-500'
                    return (
                      <div key={l.id} className="flex items-start gap-2 text-xs py-1.5 border-b border-zinc-900">
                        <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${color}`} />
                        <div className="min-w-0">
                          <span className="text-[10px] uppercase tracking-wide text-zinc-600 mr-2">{l.stage}</span>
                          <span className="text-zinc-300 break-words">{l.message}</span>
                        </div>
                      </div>
                    )
                  })}
                  {!video.logs?.length && <p className="text-sm text-zinc-500">No logs yet.</p>}
                </div>
              </ScrollArea>
            </TabsContent>
          </div>
        </Tabs>

        {hasVideo && (
          <div className="pt-2 flex gap-2 justify-end">
            <Button asChild variant="outline" size="sm" className="border-zinc-700 text-zinc-300">
              <a href={assetUrl(video.id, 'video.mp4', true, `${(video.title || 'video').replace(/[^\w\-. ]+/g, '_').slice(0, 60)}.mp4`)}>
                <Download className="w-3.5 h-3.5 mr-1.5" /> Download MP4
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
