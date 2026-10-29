#!/usr/bin/env python3
"""Diagnose Pollinations anonymous tier from this egress IP."""
import urllib.parse, urllib.request, urllib.error, time

prompt = "a 12-year-old Nigerian boy in a yellow t-shirt looking at a glowing phone, 3D Pixar-style cartoon, vibrant colors, dramatic lighting, no text"
models = ['flux', 'turbo']
referrers = [None, 'tubeforge']

def try_one(model, referrer, w=1024, h=1792, seed=424242):
    url = ("https://image.pollinations.ai/prompt/" + urllib.parse.quote(prompt, safe='')
           + f"?width={w}&height={h}&model={model}&nologo=true&seed={seed}")
    if referrer:
        url += "&referrer=" + urllib.parse.quote(referrer)
    t0 = time.time()
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; TubeForge/1.0)'})
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
            data = r.read()
        ct = r.headers.get('content-type', '')
        print(f"  model={model} ref={referrer}: OK {len(data)//1024}KB {ct} in {time.time()-t0:.0f}s")
        return True
    except urllib.error.HTTPError as e:
        body = e.read()[:220].decode('utf-8', 'replace').replace('\n', ' ')
        print(f"  model={model} ref={referrer}: HTTP {e.code} in {time.time()-t0:.0f}s body={body}")
        return False
    except Exception as e:
        print(f"  model={model} ref={referrer}: {type(e).__name__} {str(e)[:120]}")
        return False

print("=== pass 1: quick probe ===")
for m in models:
    try_one(m, None)
    time.sleep(5)

print("=== pass 2: with referrer + 50s gaps ===")
for m in models:
    try_one(m, 'tubeforge')
    time.sleep(50)
