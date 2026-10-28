// Quick check: binary resolution order (env → PATH → static fallback)
import { resolveMediaBin } from '../src/lib/yt/media'

console.log('ffmpeg  →', resolveMediaBin('ffmpeg'))
console.log('ffprobe →', resolveMediaBin('ffprobe'))
