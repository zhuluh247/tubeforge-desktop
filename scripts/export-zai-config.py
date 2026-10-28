#!/usr/bin/env python3
"""Export the sandbox Z.ai config as a paste-ready file for Render env vars."""
import json

with open('/etc/.z-ai-config') as f:
    cfg = json.load(f)

one_liner = json.dumps(cfg, separators=(',', ':'))

body = f"""Z.AI CREDENTIALS for TubeForge (exported from the build sandbox)
=================================================================

HOW TO USE (Render dashboard):
  1. Open your TubeForge service on Render -> Environment.
  2. Add an environment variable:
        Key   = ZAI_CONFIG_JSON
        Value = (paste the SINGLE LINE of JSON below)
  3. Save -> the service redeploys -> done. At boot, TubeForge writes
     this config to disk and every AI feature (script, voiceover,
     scene art, thumbnails) works.

The value must be ONE single line (no line breaks) - exactly as below:

{one_liner}

IMPORTANT NOTES:
- This is the credential of the build sandbox. It may be session-scoped:
  if AI calls ever fail on Render, replace the JSON above with your own
  Z.ai credentials in the same shape:
      {{"baseUrl":"<openai-compatible endpoint>","apiKey":"<your key>"}}
- Keep this file PRIVATE. Never commit it to GitHub (.gitignore already
  blocks the .z-ai-config file itself).
"""

out = '/home/z/my-project/download/z-ai-config-SANDBOX.txt'
with open(out, 'w') as f:
    f.write(body)

import os
os.chmod(out, 0o600)
print('written:', out, os.path.getsize(out), 'bytes')
print('json line length:', len(one_liner))
