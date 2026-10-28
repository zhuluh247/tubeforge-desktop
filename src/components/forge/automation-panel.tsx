'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Bot, Settings2, Timer, Zap } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type { AutomationConfigUI } from '@/lib/yt/client-types'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

export function AutomationPanel({
  config, nextAutoRunAt, onSaved, disabled,
}: {
  config: AutomationConfigUI
  nextAutoRunAt: number | null
  onSaved: () => void
  disabled: boolean
}) {
  const [local, setLocal] = useState(config)
  const [saving, setSaving] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => setLocal(config), [config])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  async function save(patch: Partial<AutomationConfigUI>) {
    const next = { ...local, ...patch }
    setLocal(next)
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automation: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Save failed')
      if (patch.enabled !== undefined) {
        toast.success(patch.enabled ? 'Auto-pilot ENABLED — first video starts within ~45s' : 'Auto-pilot disabled')
      } else {
        toast.success('Automation settings saved')
      }
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const countdown = (() => {
    if (!local.enabled || !nextAutoRunAt) return null
    const diff = Math.max(0, nextAutoRunAt - now)
    const h = Math.floor(diff / 3600000)
    const m = Math.floor(diff % 3600000 / 60000)
    const s = Math.floor(diff % 60000 / 1000)
    if (h >= 1) return `${h}h ${m}m`
    if (m >= 1) return `${m}m ${s}s`
    return `${s}s`
  })()

  // spacing preview — same math as the server: window ÷ per-day, max 3h gap
  const spacing = (() => {
    const win = local.endHour > local.startHour ? local.endHour - local.startHour : 24
    const mins = Math.min(180, Math.max(30, (win * 60) / Math.max(1, local.videosPerDay)))
    return mins >= 60 ? `${(mins / 60).toFixed(mins % 60 === 0 ? 0 : 1)}h` : `${Math.round(mins)}m`
  })()

  return (
    <Card className="bg-zinc-900/60 border-zinc-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-zinc-200 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-red-500" /> Auto-Pilot
          </span>
          <Switch
            checked={local.enabled}
            disabled={disabled || saving}
            onCheckedChange={v => save({ enabled: v })}
            aria-label="Toggle auto-pilot"
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          {local.enabled
            ? 'The factory picks topics riding live Google Trends, produces full videos, and publishes them to YouTube by itself — hands off.'
            : 'Flip the switch and the factory produces videos around the clock with zero clicks.'}
        </p>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] text-zinc-400">Videos per day</Label>
            <span className="text-xs font-semibold text-red-400">{local.videosPerDay}</span>
          </div>
          <Slider
            value={[local.videosPerDay]}
            min={1} max={12} step={1}
            onValueCommit={([v]) => save({ videosPerDay: v })}
            onValueChange={([v]) => setLocal(p => ({ ...p, videosPerDay: v }))}
            className="[&_[data-slot=slider-thumb]]:bg-red-500 [&_[data-slot=slider-range]]:bg-red-500"
            disabled={disabled}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label className="text-[11px] text-zinc-400">Video type</Label>
            <Select value={local.formats} onValueChange={v => save({ formats: v as AutomationConfigUI['formats'] })} disabled={disabled}>
              <SelectTrigger className="h-8 text-xs bg-zinc-950 border-zinc-800"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200">
                <SelectItem value="mixed" className="text-xs">Mixed (balanced)</SelectItem>
                <SelectItem value="short" className="text-xs">Shorts only (9:16)</SelectItem>
                <SelectItem value="long" className="text-xs">Long-form only (16:9)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-zinc-400">Active window</Label>
            <div className="flex items-center gap-1">
              <Select value={String(local.startHour)} onValueChange={v => save({ startHour: Number(v) })} disabled={disabled}>
                <SelectTrigger className="h-8 text-xs bg-zinc-950 border-zinc-800"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200 max-h-56">
                  {HOURS.map(h => <SelectItem key={h} value={String(h)} className="text-xs">{String(h).padStart(2, '0')}:00</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-zinc-600 text-xs">–</span>
              <Select value={String(local.endHour)} onValueChange={v => save({ endHour: Number(v) })} disabled={disabled}>
                <SelectTrigger className="h-8 text-xs bg-zinc-950 border-zinc-800"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200 max-h-56">
                  {HOURS.map(h => <SelectItem key={h} value={String(h)} className="text-xs">{String(h).padStart(2, '0')}:00</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] text-zinc-400">Niche</Label>
          <Input
            value={local.niche}
            onChange={e => setLocal(p => ({ ...p, niche: e.target.value }))}
            onBlur={() => local.niche !== config.niche && save({ niche: local.niche })}
            className="h-8 text-xs bg-zinc-950 border-zinc-800"
            placeholder="Facts & Curiosities"
            disabled={disabled}
          />
        </div>

        <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
          <div className="min-w-0">
            <Label className="text-[11px] text-zinc-300">Auto-publish to YouTube</Label>
            <p className="text-[10px] text-zinc-500 leading-snug">
              Ready videos upload themselves — no publish clicks.
            </p>
          </div>
          <Switch
            checked={local.autoUpload}
            disabled={disabled || saving}
            onCheckedChange={v => save({ autoUpload: v })}
            aria-label="Toggle auto-publish"
            className="shrink-0"
          />
        </div>

        <div className={`rounded-lg border p-2.5 flex items-center gap-2.5 ${local.enabled ? 'border-emerald-900/60 bg-emerald-950/30' : 'border-zinc-800 bg-zinc-950/60'}`}>
          {local.enabled ? (
            <>
              <Zap className="w-4 h-4 text-emerald-400 shrink-0" />
              <p className="text-[11px] text-emerald-300">
                Live — next video in <span className="font-bold tabular-nums">{countdown || '…'}</span>
                <span className="text-emerald-500/80"> · one every ~{spacing}</span>
              </p>
            </>
          ) : (
            <>
              <Timer className="w-4 h-4 text-zinc-500 shrink-0" />
              <p className="text-[11px] text-zinc-500">Auto-pilot is off — videos only run when you click Generate.</p>
            </>
          )}
        </div>
        <p className="text-[10px] text-zinc-600 flex items-center gap-1">
          <Settings2 className="w-3 h-3" /> Runs server-side — works even with the browser tab closed (while the app is running). Schedule hours follow the server timezone (Africa/Lagos on Render).
        </p>
      </CardContent>
    </Card>
  )
}
