export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  await materializeZaiConfig()
  try {
    const { bootScheduler } = await import('./lib/yt/scheduler')
    bootScheduler()
  } catch (e) {
    console.warn('[instrumentation] scheduler boot failed:', e)
  }
}

/**
 * z-ai-web-dev-sdk reads its credentials from a `.z-ai-config` FILE
 * (JSON: { baseUrl, apiKey, ... }) in cwd, home or /etc — never from env vars.
 * Hosted deploys (Render, Docker, VPS) can't ship secret files through git,
 * so the entire config can be pasted into ONE env var (ZAI_CONFIG_JSON);
 * it gets materialized to disk at boot, before any AI call is made.
 */
async function materializeZaiConfig() {
  const raw = process.env.ZAI_CONFIG_JSON?.trim()
  if (!raw) return
  try {
    const fs = await import('fs')
    const path = await import('path')
    const target = path.join(process.cwd(), '.z-ai-config')
    const cfg = JSON.parse(raw) as { baseUrl?: string; apiKey?: string }
    if (!cfg.baseUrl || !cfg.apiKey) {
      console.warn(
        '[instrumentation] ZAI_CONFIG_JSON ignored: JSON needs at least { "baseUrl", "apiKey" }'
      )
      return
    }
    const current = fs.existsSync(target)
      ? fs.readFileSync(target, 'utf-8')
      : ''
    if (current.trim() === raw) return
    fs.writeFileSync(target, JSON.stringify(cfg, null, 2), { mode: 0o600 })
    console.log('[instrumentation] wrote .z-ai-config from ZAI_CONFIG_JSON env var')
  } catch (e) {
    console.warn('[instrumentation] could not write .z-ai-config from env:', e)
  }
}
