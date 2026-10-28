'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { KeyRound, Loader2, Mic, ShieldCheck, ClipboardCheck, Link2 } from 'lucide-react'
import { VOICE_OPTIONS, readJsonSafe, type SettingsPayload } from '@/lib/yt/client-types'

export function SettingsDialog({
  open, onOpenChange, settings, onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  settings: SettingsPayload | null
  onSaved: () => void
}) {
  const [voice, setVoice] = useState(settings?.defaultVoice || 'jam')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [refreshToken, setRefreshToken] = useState('')
  const [privacy, setPrivacy] = useState(settings?.youtube.privacy || 'public')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [connecting, setConnecting] = useState<'open' | 'finish' | null>(null)
  const [pastedUrl, setPastedUrl] = useState('')

  async function put(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; channel?: string; channelId?: string }> {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await readJsonSafe(res)
    if (!res.ok) return { ok: false, error: (json.error as string) || 'Save failed' }
    return { ok: true, channel: json.channel as string, channelId: json.channelId as string }
  }

  async function saveVoice() {
    setSaving(true)
    const r = await put({ defaultVoice: voice })
    setSaving(false)
    if (r.ok) { toast.success('Default voice saved'); onSaved() }
    else toast.error(r.error)
  }

  /** Persists whatever id/secret are typed, so the OAuth flows can use them. */
  async function persistClient(): Promise<boolean> {
    const r = await put({ youtube: { clientId, clientSecret, privacy } })
    if (!r.ok) { toast.error(r.error); return false }
    if (!clientId && !clientSecret && !settings?.youtube.hasClient) {
      toast.error('Paste your Client ID and Client Secret first (step 1 of the guide below).')
      return false
    }
    return true
  }

  async function saveYouTube() {
    setSaving(true)
    const r = await put({ youtube: { clientId, clientSecret, refreshToken, privacy } })
    setSaving(false)
    if (r.ok) { toast.success('YouTube credentials saved'); onSaved() }
    else toast.error(r.error)
  }

  async function checkConnection() {
    setTesting(true)
    const r = await put({ youtube: { test: true } })
    setTesting(false)
    if (r.ok) {
      toast.success(`Connected as "${r.channel}"`, {
        description: 'Uploads will go to this channel. Re-authorize and pick another channel to switch.',
      })
      onSaved()
    } else {
      toast.error('Connection failed', { description: r.error })
    }
  }

  /** Option A (Desktop-app clients): open Google consent, user pastes the
   *  redirected localhost URL back, we exchange the code server-side. */
  async function startPasteFlow() {
    if (!(await persistClient())) return
    setConnecting('open')
    try {
      const res = await fetch('/api/youtube/connect?mode=url&flow=paste')
      const json = await readJsonSafe(res)
      if (!res.ok) throw new Error((json.error as string) || 'Could not build the Google consent link')
      window.open(json.url as string, '_blank', 'noopener')
      toast.info('Google opened in a new tab', {
        description: 'Pick the channel you want, then copy the URL of the "site can\'t be reached" page and paste it below.',
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the connect flow')
    } finally {
      setConnecting(null)
    }
  }

  async function finishPasteFlow() {
    if (!pastedUrl.trim()) {
      toast.error('Paste the redirected URL first (it starts with http://localhost:1/?code=…)')
      return
    }
    setConnecting('finish')
    try {
      const res = await fetch('/api/youtube/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirectUrl: pastedUrl.trim() }),
      })
      const json = await readJsonSafe(res)
      if (!res.ok) throw new Error((json.error as string) || 'Authorization failed')
      if (json.channel) {
        toast.success(`Connected as "${json.channel}"`, { description: 'This channel will receive your uploads.' })
      } else {
        toast.success('Refresh token saved', { description: (json.warn as string) || 'Use "Check connection" to verify the channel.' })
      }
      setPastedUrl('')
      setRefreshToken('')
      onSaved()
    } catch (e) {
      toast.error('Authorization failed', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setConnecting(null)
    }
  }

  /** Option B (Web-app clients): full round-trip through this app. */
  async function startAutoFlow() {
    if (!(await persistClient())) return
    window.open('/api/youtube/connect', '_blank', 'noopener')
    toast.info('Finish the consent in the new tab', {
      description: 'Come back here and press "Check connection" once Google shows the success page.',
    })
  }

  const callbackUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/youtube/callback` : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-zinc-950 border-zinc-800 text-zinc-100 max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mic className="w-4 h-4 text-red-500" /> Factory Settings</DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">Defaults for new videos and YouTube publishing.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">Default narrator voice</Label>
            <div className="flex gap-2">
              <Select value={voice} onValueChange={setVoice}>
                <SelectTrigger className="h-9 text-xs bg-zinc-900 border-zinc-800 flex-1"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200 max-h-64">
                  {VOICE_OPTIONS.map(v => (
                    <SelectItem key={v.id} value={v.id} className="text-xs">{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={saveVoice} disabled={saving} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-100 h-9">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
              </Button>
            </div>
          </div>

          <Separator className="bg-zinc-800" />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-zinc-400 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-red-500" /> YouTube Data API
              </Label>
              {settings?.youtube.configured ? (
                <Badge variant="outline" className="text-[10px] border-emerald-800 text-emerald-300 bg-emerald-950/40">
                  <ShieldCheck className="w-3 h-3 mr-1" /> Connected{settings.youtube.channelTitle ? `: ${settings.youtube.channelTitle}` : ''}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">Not connected</Badge>
              )}
            </div>

            <div className="space-y-2">
              <Input
                value={clientId} onChange={e => setClientId(e.target.value)}
                placeholder="Client ID (…apps.googleusercontent.com)"
                className="h-9 text-xs bg-zinc-900 border-zinc-800"
              />
              <Input
                value={clientSecret} onChange={e => setClientSecret(e.target.value)} type="password"
                placeholder="Client secret"
                className="h-9 text-xs bg-zinc-900 border-zinc-800"
              />
              <div className="flex gap-2 items-center">
                <Select value={privacy} onValueChange={setPrivacy}>
                  <SelectTrigger className="h-9 text-xs bg-zinc-900 border-zinc-800 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-200">
                    <SelectItem value="public" className="text-xs">Public</SelectItem>
                    <SelectItem value="unlisted" className="text-xs">Unlisted</SelectItem>
                    <SelectItem value="private" className="text-xs">Private</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={saveYouTube} disabled={saving || (!clientId && !refreshToken)}
                  className="border-zinc-700 text-zinc-300 h-9 flex-1">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null} Save values
                </Button>
                <Button size="sm" variant="outline" onClick={checkConnection} disabled={testing}
                  className="border-zinc-700 text-zinc-300 h-9 flex-1">
                  {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <ShieldCheck className="w-3.5 h-3.5 mr-1" />}
                  Check connection
                </Button>
              </div>
            </div>

            {/* ── Guided OAuth connect ─────────────────────────────── */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2.5">
              <p className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-red-500" /> Connect your YouTube channel (guided — no manual token needed)
              </p>
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Paste your Client ID + Secret above first. When Google asks, <span className="text-zinc-300">choose the exact channel</span> you want
                TubeForge to upload to — the connection is bound to that one channel. Two channels? Re-authorize later and pick the other.
              </p>

              <details className="text-[11px] text-zinc-400 group" open={!settings?.youtube.configured}>
                <summary className="cursor-pointer select-none text-zinc-300 hover:text-white font-medium">
                  Option A — OAuth client type “Desktop app” (zero Google Console config)
                </summary>
                <div className="mt-2 space-y-2">
                  <Button size="sm" onClick={startPasteFlow} disabled={connecting !== null}
                    className="w-full bg-red-600 hover:bg-red-500 text-white h-8 text-xs">
                    {connecting === 'open' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Link2 className="w-3.5 h-3.5 mr-1" />}
                    1 · Open Google consent page
                  </Button>
                  <p className="text-[10px] text-zinc-500 leading-relaxed">
                    After consenting, the browser lands on a <span className="text-zinc-400">“This site can’t be reached”</span> page — that is expected.
                    Copy the full address from the browser bar (it looks like <span className="text-zinc-400">http://localhost:1/?code=4/0A…</span>) and paste it here.
                  </p>
                  <Input
                    value={pastedUrl} onChange={e => setPastedUrl(e.target.value)}
                    placeholder="2 · Paste the redirected URL (http://localhost:1/?code=…)"
                    className="h-9 text-xs bg-zinc-900 border-zinc-800"
                  />
                  <Button size="sm" variant="outline" onClick={finishPasteFlow} disabled={connecting !== null}
                    className="w-full border-zinc-700 text-zinc-200 h-8 text-xs">
                    {connecting === 'finish' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <ClipboardCheck className="w-3.5 h-3.5 mr-1" />}
                    3 · Finish connection
                  </Button>
                </div>
              </details>

              <details className="text-[11px] text-zinc-400 group">
                <summary className="cursor-pointer select-none text-zinc-300 hover:text-white font-medium">
                  Option B — OAuth client type “Web application” (one click, needs one redirect URI)
                </summary>
                <div className="mt-2 space-y-2">
                  <p className="text-[10px] text-zinc-500 leading-relaxed">
                    In Google Cloud Console → your OAuth client → <span className="text-zinc-400">Authorized redirect URIs</span>, add exactly:
                  </p>
                  <code className="block break-all rounded bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-[10px] text-emerald-300 select-all">
                    {callbackUrl}
                  </code>
                  <Button size="sm" onClick={startAutoFlow} disabled={connecting !== null}
                    className="w-full bg-red-600 hover:bg-red-500 text-white h-8 text-xs">
                    {connecting === 'open' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Link2 className="w-3.5 h-3.5 mr-1" />}
                    Connect automatically
                  </Button>
                </div>
              </details>

              <details className="text-[11px] text-zinc-500 group">
                <summary className="cursor-pointer select-none text-zinc-400 hover:text-zinc-200">
                  Advanced: I already have a refresh token
                </summary>
                <div className="mt-2 space-y-2">
                  <Input
                    value={refreshToken} onChange={e => setRefreshToken(e.target.value)} type="password"
                    placeholder="Refresh token (offline access)"
                    className="h-9 text-xs bg-zinc-900 border-zinc-800"
                  />
                  <Button size="sm" variant="outline" onClick={saveYouTube} disabled={saving || !refreshToken}
                    className="w-full border-zinc-700 text-zinc-300 h-8 text-xs">
                    Save refresh token
                  </Button>
                </div>
              </details>
            </div>

            <details className="text-[11px] text-zinc-500 group">
              <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200 select-none">
                How to create free YouTube API credentials (2 min)
              </summary>
              <ol className="list-decimal ml-4 mt-2 space-y-1.5 leading-relaxed">
                <li>Go to <span className="text-zinc-300">console.cloud.google.com</span> → create a project (free).</li>
                <li>APIs &amp; Services → Library → enable <span className="text-zinc-300">YouTube Data API v3</span>.</li>
                <li>Google Auth Platform (left menu: Overview / Branding / <span className="text-zinc-300">Audience</span>…) → when asked Internal vs External pick <span className="text-zinc-300">External</span> (Internal is only for company/school Workspace accounts and would block your personal Gmail). On <span className="text-zinc-300">Branding</span> only fill App name + support email — homepage, privacy policy and terms are optional, leave them empty. Then <span className="text-zinc-300">Audience</span> → Test users → <span className="text-zinc-300">+ Add users</span> → add every Gmail you might sign in with (e.g. both channel accounts).</li>
                <li>Same <span className="text-zinc-300">Audience</span> page → press <span className="text-zinc-300">Publish app</span> so status becomes <span className="text-zinc-300">In production</span> — otherwise Google expires your token every 7 days and you&apos;d reconnect weekly. Unverified is fine for personal use: no website, no verification, no privacy policy. If Google shows a &quot;not verified&quot; warning when authorizing, click <span className="text-zinc-300">Advanced → Go to TubeForge (unsafe)</span> — it&apos;s your own app, it&apos;s safe.</li>
                <li><span className="text-zinc-300">Clients</span> (left menu) → <span className="text-zinc-300">+ Create client</span> → type <span className="text-zinc-300">Desktop app</span> → download the JSON.</li>
                <li>Paste the Client ID + Secret above, then use <span className="text-zinc-300">Option A</span> to authorize.</li>
                <li>Note: fresh uploads from new projects can be forced <span className="text-zinc-300">private</span> until Google finishes reviewing the app — set Privacy to Private here if uploads get rejected.</li>
                <li>Free daily quota ≈ 6 uploads/day. Press <span className="text-zinc-300">Check connection</span> anytime to see the active channel.</li>
              </ol>
            </details>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
