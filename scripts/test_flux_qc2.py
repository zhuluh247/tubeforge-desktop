#!/usr/bin/env python3
"""Get 2 flux QC images strictly honoring the 45s/IP window."""
import urllib.parse, urllib.request, urllib.error, time, os, json, re

OUT = '/home/z/my-project/scripts/sample/assets/flux_qc'
os.makedirs(OUT, exist_ok=True)

CHARACTER = ("a 12-year-old Nigerian boy, slim, short black kinky hair, big brown eyes, "
             "wearing a bright yellow t-shirt, blue shorts and worn blue-white sneakers")
STYLE = ("3D Pixar-style cartoon, vibrant saturated colors, dramatic cinematic lighting, "
         "ultra detailed, high quality render, expressive character, no text, no watermark")
SEED = 424242

def fetch(model, prompt, w, h, seed, out):
    url = ("https://image.pollinations.ai/prompt/" + urllib.parse.quote(prompt[:1000], safe='')
           + f"?width={w}&height={h}&model={model}&nologo=true&seed={seed}")
    for attempt in range(5):
        t0 = time.time()
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; TubeForge/1.0)'})
        try:
            with urllib.request.urlopen(req, timeout=240) as r:
                data = r.read()
            ct = r.headers.get('content-type', '')
            if ct.startswith('image/') and len(data) > 5000:
                with open(out, 'wb') as f:
                    f.write(data)
                print(f"OK {len(data)//1024}KB in {time.time()-t0:.0f}s -> {out}")
                return True
            print(f"bad content {ct} {len(data)}B")
        except urllib.error.HTTPError as e:
            body = e.read()[:300].decode('utf-8', 'replace')
            m = re.search(r'[Rr]etry after (\d+(?:\.\d+)?)s', body)
            wait = float(m.group(1)) + 2 if m else 45
            print(f"HTTP {e.code}, waiting {wait:.0f}s: {body[:120]}")
            time.sleep(wait)
        except Exception as e:
            print(f"{type(e).__name__}: {str(e)[:120]}; waiting 20s")
            time.sleep(20)
    return False

s1 = f"{CHARACTER}. A narrow Lagos street at night in the rain, glowing streetlights, the boy holds a phone whose screen lights his shocked face. Depict exactly this moment. {STYLE}"
s3 = f"{CHARACTER}. The boy standing brave in front of a big yellow danfo minibus in bright Lagos morning traffic, determined face. Depict exactly this moment. {STYLE}"

ok1 = fetch('flux', s1, 1024, 1792, SEED, os.path.join(OUT, 'qc_s1.png'))
time.sleep(46)
ok2 = fetch('flux', s3, 1024, 1792, SEED, os.path.join(OUT, 'qc_s3.png'))
print("done", ok1, ok2)
