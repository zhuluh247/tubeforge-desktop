#!/usr/bin/env python3
"""QC test: Pollinations FLUX with the production story prompt recipe.
Same character-bible + style-lock technique as the approved samples,
plus a LOCKED SEED across scenes for character consistency."""
import urllib.parse, urllib.request, time, sys, os

OUT = '/home/z/my-project/scripts/sample/assets/flux_qc'
os.makedirs(OUT, exist_ok=True)

# The exact production recipe (pipeline.ts + ai.ts sanitizeStoryPrompt)
CHARACTER = ("a 12-year-old Nigerian boy, slim, short black kinky hair, big brown eyes, "
             "wearing a bright yellow t-shirt, blue shorts and worn blue-white sneakers")
STYLE = ("3D Pixar-style cartoon, vibrant saturated colors, dramatic cinematic lighting, "
         "ultra detailed, high quality render, expressive character, no text, no watermark")

SEED = 424242  # LOCKED across all scenes -> character consistency

scenes = [
    ("A narrow Lagos street at night, glowing streetlights in the rain, a boy looking at a phone screen that lights his shocked face",
     "s1_flux.png"),
    ("Close-up of the boy's shocked face lit by the phone screen, night market bokeh behind him",
     "s2_flux.png"),
    ("The boy standing brave in front of a big yellow danfo bus in Lagos traffic, morning sun",
     "s3_flux.png"),
]

for i, (scene, fname) in enumerate(scenes):
    prompt = f"{CHARACTER}. {scene}. Depict exactly this moment. {STYLE}"
    url = ("https://image.pollinations.ai/prompt/" + urllib.parse.quote(prompt[:1000], safe='')
           + f"?width=1024&height=1792&model=flux&nologo=true&seed={SEED}")
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; TubeForge/1.0)'})
        with urllib.request.urlopen(req, timeout=240) as r:
            data = r.read()
        ct = r.headers.get('content-type', '')
        ok = ct.startswith('image/') and len(data) > 5000
        path = os.path.join(OUT, fname)
        with open(path, 'wb') as f:
            f.write(data)
        print(f"[{i+1}] {'OK ' if ok else 'BAD'} {len(data)//1024}KB {ct} in {time.time()-t0:.0f}s -> {path}")
    except Exception as e:
        print(f"[{i+1}] FAIL in {time.time()-t0:.0f}s: {str(e)[:160]}")
    time.sleep(8)  # polite gap; anonymous tier is 1/45s per IP but flux often allows bursts

print("done")
