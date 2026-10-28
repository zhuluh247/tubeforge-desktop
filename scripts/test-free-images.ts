// E2E test: the exact generateImage() used by the pipeline, forced to the
// FREE provider. Generates a 9:16 Short scene image + a 16:9 thumbnail base.
import fs from 'fs'

process.env.IMAGE_PROVIDER = 'pollinations' // force the free path for the test

async function main() {
  const { generateImage } = await import('../src/lib/yt/ai')
  const out1 = '/home/z/my-project/.tmp/test-scene.png'
  const out2 = '/home/z/my-project/.tmp/test-thumb-base.png'

  const t0 = Date.now()
  await generateImage(
    'a vast underwater mariana trench scene, sunken ship silhouette, dramatic god rays, photorealistic',
    '768x1344', out1, 0
  )
  console.log(`scene image OK in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${(fs.statSync(out1).size / 1024).toFixed(0)}KB`)

  const t1 = Date.now()
  await generateImage(
    'dramatic ocean mystery thumbnail background, high contrast, one focal subject',
    '1344x768', out2, 1
  )
  console.log(`thumbnail base OK in ${((Date.now() - t1) / 1000).toFixed(1)}s — ${(fs.statSync(out2).size / 1024).toFixed(0)}KB`)
}

main().then(
  () => { console.log('ALL FREE-IMAGE TESTS PASSED'); process.exit(0) },
  e => { console.error('TEST FAILED:', e); process.exit(1) }
)
