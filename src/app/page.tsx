'use client'

import { useMemo, useState } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import {
  Clapperboard, Film, Layers, PackageCheck, PenLine, Smartphone, Sparkles,
  UploadCloud, Video, Wand2, Loader2, Factory, CheckCircle2, Image as ImageIcon,
  Captions, Rocket, Bot,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Toaster } from '@/components/ui/sonner'
import { VideoCard } from '@/components/forge/video-card'
import { DetailDialog } from '@/components/forge/detail-dialog'
import { SettingsDialog } from '@/components/forge/settings-dialog'
import { AutomationPanel } from '@/components/forge/automation-panel'
import {
  VOICE_OPTIONS, type SettingsPayload, type Stats, type VideoRow,
} from '@/lib/yt/client-types'

const PIPELINE_STEPS = [
  { icon: PenLine, label: 'Script + SEO', desc: 'Hook, scenes, title, tags, description' },
  { icon: Captions, label: 'Voiceover', desc: 'Narrator TTS per scene, paced cuts' },
  { icon: ImageIcon, label: 'AI visuals', desc: 'A fresh cinematic image per scene' },
  { icon: Film, label: 'Render', desc: 'Ken Burns motion + burned captions + audio mix' },
  { icon: PackageCheck, label: 'Thumbnail', desc: 'AI key art with bold title overlay' },
  { icon: UploadCloud, label: 'Publish', desc: 'YouTube Data API upload + custom thumb' },
]

export default function Page() {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
      <Toaster position="bottom-right" richColors theme="dark" />
    </QueryClientProvider>
  )
}

function Dashboard() {
  const qc = useQueryClient()
  const [detail, setDetail] = useState<VideoRow | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [filter, setFilter] = useState('all')

  const statsQ = useQuery<Stats>({
    queryKey: ['stats'],
    queryFn: async () => (await fetch('/api/stats')).json(),
    refetchInterval: q => (q.state.data?.active ? 2500 : 10_000),
  })

  const healthQ = useQuery<{ build: string; ffmpeg: string; ffprobe: string; startedAt: string }>({
    queryKey: ['health'],
    queryFn: async () => (await fetch('/api/health')).json(),
    staleTime: 60_000,
  })
  const videosQ = useQuery<{ videos: VideoRow[] }>({
    queryKey: ['videos'],
    queryFn: async () => (await fetch('/api/videos')).json(),
    refetchInterval: q => (q.state.data?.videos?.some(v =>
      ['queued', 'scripting', 'voicing', 'visualizing', 'rendering', 'thumbnailing', 'uploading'].includes(v.status)
    ) ? 2500 : 12_000),
  })
  const settingsQ = useQuery<SettingsPayload>({
    queryKey: ['settings'],
    queryFn: async () => (await fetch('/api/settings')).json(),
  })

  const videos = videosQ.data?.videos || []
  const stats = statsQ.data

  const filtered = useMemo(() => {
    if (filter === 'active') return videos.filter(v => ['queued', 'scripting', 'voicing', 'visualizing', 'rendering', 'thumbnailing', 'uploading'].includes(v.status))
    if (filter === 'ready') return videos.filter(v => v.status === 'ready')
    if (filter === 'uploaded') return videos.filter(v => v.status === 'uploaded')
    return videos
  }, [videos, filter])

  function openDetail(v: VideoRow) {
    setDetail(v)
    setDetailOpen(true)
  }

  function refreshAll() {
    qc.invalidateQueries({ queryKey: ['videos'] })
    qc.invalidateQueries({ queryKey: ['stats'] })
    qc.invalidateQueries({ queryKey: ['settings'] })
  }

  const activeCount = stats?.active ?? 0

  return (
    <div className="min-h-screen flex flex-col bg-[#09090b] text-zinc-100">
      {/* header */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-[#09090b]/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center shadow-[0_0_18px_rgba(239,68,68,0.4)]">
              <Clapperboard className="w-4.5 h-4.5 w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight leading-none">
                Tube<span className="text-red-500">Forge</span>
              </h1>
              <p className="text-[10px] text-zinc-500 leading-none mt-0.5">YouTube automation factory</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {stats && (
              <div className="hidden sm:flex items-center gap-1.5 mr-1">
                <HeaderPill icon={<Video className="w-3 h-3" />} label={`${stats.total}`} title="Total videos" />
                <HeaderPill icon={<Loader2 className={`w-3 h-3 ${activeCount ? 'animate-spin text-yellow-400' : ''}`} />} label={`${stats.active}`} title="In the pipeline" highlight={!!activeCount} />
                <HeaderPill icon={<CheckCircle2 className="w-3 h-3 text-emerald-400" />} label={`${stats.ready + stats.uploaded}`} title="Ready + published" />
              </div>
            )}
            {stats?.automation.enabled && (
              <Badge variant="outline" className="border-emerald-800 bg-emerald-950/40 text-emerald-300 text-[10px] gap-1.5 animate-pulse">
                <Bot className="w-3 h-3" /> AUTO
              </Badge>
            )}
            {healthQ.data && (
              <span
                className="hidden md:inline text-[9px] text-zinc-600 border border-zinc-800 rounded px-1.5 py-0.5 whitespace-nowrap"
                title={`ffmpeg: ${healthQ.data.ffmpeg} · ffprobe: ${healthQ.data.ffprobe} · started ${healthQ.data.startedAt}`}
              >
                {healthQ.data.build}
              </span>
            )}
            <Button variant="outline" size="sm" className="h-8 border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500"
              onClick={() => setSettingsOpen(true)}>
              Settings
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* hero */}
        <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-900/80 to-zinc-950 p-5 sm:p-6">
          <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
            <div className="space-y-1.5 max-w-xl">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
                The full YouTube factory. <span className="text-red-500">Zero hands on deck.</span>
              </h2>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Drop a topic — or flip Auto-Pilot and walk away. TubeForge writes the script, records the narrator,
                paints every scene, animates, burns captions, designs the thumbnail and uploads to YouTube.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <StatTile label="Produced" value={stats?.total ?? '—'} icon={<Video className="w-3.5 h-3.5 text-zinc-400" />} />
              <StatTile label="In pipeline" value={activeCount} icon={<Layers className="w-3.5 h-3.5 text-yellow-400" />} />
              <StatTile label="Published" value={stats?.uploaded ?? '—'} icon={<Rocket className="w-3.5 h-3.5 text-emerald-400" />} />
            </div>
          </div>
        </motion.section>

        <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
          {/* left column */}
          <div className="space-y-6 min-w-0">
            <CreatePanel onCreated={refreshAll} disabled={false} />

            <Card className="bg-zinc-900/60 border-zinc-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-zinc-200 flex items-center justify-between">
                  <span className="flex items-center gap-2"><Film className="w-4 h-4 text-red-500" /> Production line</span>
                  <Tabs value={filter} onValueChange={setFilter}>
                    <TabsList className="bg-zinc-950 border border-zinc-800 h-7">
                      <TabsTrigger value="all" className="text-[11px] h-6 px-2.5 data-[state=active]:bg-zinc-800">All</TabsTrigger>
                      <TabsTrigger value="active" className="text-[11px] h-6 px-2.5 data-[state=active]:bg-zinc-800">Active</TabsTrigger>
                      <TabsTrigger value="ready" className="text-[11px] h-6 px-2.5 data-[state=active]:bg-zinc-800">Ready</TabsTrigger>
                      <TabsTrigger value="uploaded" className="text-[11px] h-6 px-2.5 data-[state=active]:bg-zinc-800">Published</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 max-h-[560px] overflow-y-auto">
                {videosQ.isLoading ? (
                  <div className="py-10 text-center text-sm text-zinc-500">Loading production line…</div>
                ) : filtered.length === 0 ? (
                  <div className="py-12 text-center space-y-2">
                    <p className="text-3xl">🏭</p>
                    <p className="text-sm text-zinc-400 font-medium">
                      {filter === 'all' ? 'The factory floor is quiet' : 'Nothing here yet'}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {filter === 'all'
                        ? 'Feed it a topic above — or switch on Auto-Pilot and let it cook.'
                        : `No videos match "${filter}".`}
                    </p>
                  </div>
                ) : (
                  filtered.map(v => (
                    <VideoCard key={v.id} video={v} onOpen={openDetail} onChanged={refreshAll} />
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* right column */}
          <div className="space-y-6 lg:sticky lg:top-20">
            {settingsQ.data?.automation && (
              <AutomationPanel
                config={settingsQ.data.automation}
                nextAutoRunAt={settingsQ.data.nextAutoRunAt}
                onSaved={refreshAll}
                disabled={false}
              />
            )}

            <Card className="bg-zinc-900/60 border-zinc-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-red-500" /> How every video gets made
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-3">
                  {PIPELINE_STEPS.map((s, i) => (
                    <li key={s.label} className="flex gap-3">
                      <div className="relative flex flex-col items-center">
                        <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                          <s.icon className="w-3.5 h-3.5 text-red-400" />
                        </div>
                        {i < PIPELINE_STEPS.length - 1 && <div className="w-px flex-1 bg-zinc-800 mt-1" />}
                      </div>
                      <div className="pb-1">
                        <p className="text-xs font-semibold text-zinc-200 leading-none pt-1">
                          {i + 1}. {s.label}
                        </p>
                        <p className="text-[11px] text-zinc-500 mt-1">{s.desc}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <footer className="mt-auto border-t border-zinc-800/80">
        <div className="max-w-6xl mx-auto px-4 h-12 flex items-center justify-between text-[11px] text-zinc-600">
          <span>TubeForge — AI-powered faceless channel factory</span>
          <span>Script · Voice · Visuals · Captions · Thumbnail · Upload</span>
        </div>
      </footer>

      <DetailDialog video={detail} open={detailOpen} onOpenChange={setDetailOpen} />
      <SettingsDialog settings={settingsQ.data || null} open={settingsOpen} onOpenChange={setSettingsOpen} onSaved={refreshAll} />
    </div>
  )
}

function HeaderPill({ icon, label, title, highlight }: { icon: React.ReactNode; label: string; title: string; highlight?: boolean }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-md border px-2 py-1 ${
        highlight ? 'border-yellow-800/60 bg-yellow-950/30 text-yellow-300' : 'border-zinc-800 bg-zinc-900 text-zinc-300'
      }`}
    >
      {icon}{label}
    </span>
  )
}

function StatTile({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3.5 py-2.5 min-w-[86px]">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500 flex items-center gap-1">{icon}{label}</p>
      <p className="text-xl font-bold mt-0.5 tabular-nums">{value}</p>
    </div>
  )
}

function CreatePanel({ onCreated, disabled }: { onCreated: () => void; disabled: boolean }) {
  const [topic, setTopic] = useState('')
  const [format, setFormat] = useState<'short' | 'long' | 'story' | 'howto'>('story')
  const [voice, setVoice] = useState('')
  const [count, setCount] = useState('1')
  const [creating, setCreating] = useState(false)
  const isAuto = topic.trim() === ''

  async function create() {
    setCreating(true)
    try {
      const res = await fetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: isAuto ? '__auto__' : topic.trim(), format, voice, count: Number(count) }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to queue video')
      toast.success(
        count === '1' ? 'Video queued — the factory is on it!' : `${count} videos queued — batch production started`,
        { description: isAuto ? 'AI is picking a viral topic right now.' : `Topic: ${topic.trim().slice(0, 60)}` }
      )
      setTopic('')
      onCreated()
    } catch (e) {
      toast.error('Could not queue video', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Card className="bg-zinc-900/60 border-zinc-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-red-500" /> Create a video
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="topic" className="text-xs text-zinc-400">Topic <span className="text-zinc-600">(leave empty and the AI picks a viral one)</span></Label>
          <div className="flex gap-2">
            <Input
              id="topic"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="e.g. 5 space facts that sound fake but are real"
              className="h-10 bg-zinc-950 border-zinc-800 text-sm placeholder:text-zinc-600"
              maxLength={200}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">Format</Label>
            <Select value={format} onValueChange={(v: 'short' | 'long' | 'story' | 'howto') => setFormat(v)}>
              <SelectTrigger className="h-10 text-xs bg-zinc-950 border-zinc-800"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200">
                <SelectItem value="story" className="text-xs">
                  <Smartphone className="w-3 h-3 mr-1.5 inline" /> Story Short (9:16)
                </SelectItem>
                <SelectItem value="howto" className="text-xs">
                  <Film className="w-3 h-3 mr-1.5 inline" /> How-To (16:9)
                </SelectItem>
                <SelectItem value="short" className="text-xs">
                  <Smartphone className="w-3 h-3 mr-1.5 inline" /> Facts Short (9:16)
                </SelectItem>
                <SelectItem value="long" className="text-xs">
                  <Film className="w-3 h-3 mr-1.5 inline" /> Facts Long (16:9)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">Voice</Label>
            <Select value={voice} onValueChange={setVoice}>
              <SelectTrigger className="h-10 text-xs bg-zinc-950 border-zinc-800"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200 max-h-64">
                <SelectItem value="" className="text-xs">Auto — best voice per format</SelectItem>
                {VOICE_OPTIONS.map(v => (
                  <SelectItem key={v.id} value={v.id} className="text-xs">{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">Batch</Label>
            <Select value={count} onValueChange={setCount}>
              <SelectTrigger className="h-10 text-xs bg-zinc-950 border-zinc-800"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200">
                {['1', '2', '3', '5'].map(c => (
                  <SelectItem key={c} value={c} className="text-xs">{c} video{c !== '1' ? 's' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          onClick={create}
          disabled={creating || disabled}
          className="w-full h-11 bg-red-600 hover:bg-red-500 text-white font-semibold shadow-[0_0_20px_rgba(239,68,68,0.25)]"
        >
          {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Factory className="w-4 h-4 mr-2" />}
          {isAuto ? 'Roll the dice — auto topic' : 'Send to factory'}
        </Button>
        <p className="text-[10px] text-zinc-600 text-center">
          Script → voiceover → AI scene art → render with captions → thumbnail → ready to publish
        </p>
      </CardContent>
    </Card>
  )
}
