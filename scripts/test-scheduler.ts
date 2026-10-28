// Scheduler slot-math + live trending-topics verification
import { slotIntervalMs, nextSlotMs } from '../src/lib/yt/scheduler'
import { fetchTrendingTopics } from '../src/lib/yt/ai'

// local time helpers (works in whatever TZ the test process has)
function at(dayOffset: number, h: number, m: number): number {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}
function show(t: number): string {
  return new Date(t).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

let failures = 0
function expect(label: string, got: number, wantDay: number, wantH: number, wantM: number) {
  const w = at(wantDay, wantH, wantM)
  const ok = Math.abs(got - w) < 60_000 // 1-minute tolerance
  if (!ok) failures++
  console.log(`${ok ? '✅' : '❌'} ${label}: got ${show(got)}, expected ${show(w)}`)
}

// ── interval math ──
const i6 = slotIntervalMs(6, 8, 23) // 15h window / 6 = 2.5h
console.log(`interval(6/day, 8→23) = ${i6 / 3600000}h (expect 2.5h)`)
if (i6 !== 2.5 * 3600_000) failures++

const i6capped = slotIntervalMs(6, 0, 24) // 24h window / 6 = 4h → capped 3h
console.log(`interval(6/day, 0→24) = ${i6capped / 3600000}h (expect 3h cap)`)
if (i6capped !== 3 * 3600_000) failures++

// ── next-slot selection ──
// 6/day, 8→23 → slots 08:00, 10:30, 13:00, 15:30, 18:00, 20:30
expect('from 09:10 → next slot', nextSlotMs(6, 8, 23, at(0, 9, 10)), 0, 10, 30)
expect('from 02:00 → window start', nextSlotMs(6, 8, 23, at(0, 2, 0)), 0, 8, 0)
expect('from 21:45 → tomorrow first slot', nextSlotMs(6, 8, 23, at(0, 21, 45)), 1, 8, 0)
expect('from 20:30 (exact slot) → same slot', nextSlotMs(6, 8, 23, at(0, 20, 30)), 0, 20, 30)
// 6/day, 8→19 (11h) → interval 110min → slots 08:00, 09:50, 11:40, 13:30, 15:20, 17:10
expect('11h window from 08:00 → first slot', nextSlotMs(6, 8, 19, at(0, 8, 0)), 0, 8, 0)
expect('11h window from 16:00 → 17:10 slot', nextSlotMs(6, 8, 19, at(0, 16, 0)), 0, 17, 10)

// ── full-day grid gaps (≤3h inside the window) ──
let grid = [0, 1, 2, 3, 4, 5].map(k => at(0, 8, 0) + k * i6)
const gaps = grid.slice(1).map((t, idx) => (t - grid[idx]) / 3600000)
console.log(`grid gaps (6/day, 8→23): ${gaps.join('h, ')}h — all ≤3h: ${gaps.every(g => g <= 3.01)}`)
if (!gaps.every(g => g <= 3.01)) failures++

// ── live trending topics (free Google Trends RSS) ──
const trends = await fetchTrendingTopics()
console.log(`trends: ${trends.length} topics — ${trends.slice(0, 4).join(' | ')}`)
if (trends.length === 0) failures++

console.log(failures === 0 ? '\nSCHEDULER + TRENDS TEST PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
