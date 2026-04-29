# RunPod Serverless deploy guide

Deploys the Stable Diffusion backend (`app.py`) as a **RunPod Serverless**
endpoint — pay per second of GPU execution, no idle cost. Ideal for
sporadic iteration sessions where a 24/7 GPU pod would be wasteful.

The handler ([rp_handler.py](rp_handler.py)) dispatches every serverless
job to the existing Flask routes via Flask's test client, so the same
`app.py` code runs locally and on RunPod — no logic duplication.

## 1. Repo & build

GitHub repo is wired into RunPod (Serverless → New Endpoint → Deploy from
GitHub). RunPod auto-builds the image from the root [Dockerfile](../Dockerfile)
on every push to the configured branch.

The Dockerfile:

- starts from `nvidia/cuda:12.1.0-runtime-ubuntu22.04`
- installs `sd-backend/requirements.txt` (includes `runpod==1.7.0`)
- copies `sd-backend/` into the image
- `CMD ["python3", "-u", "rp_handler.py"]` — runs the serverless worker

Models are NOT baked into the image — they download lazily on first request.
**That's why a network volume is mandatory** (next section).

## 2. Endpoint configuration

Serverless → New Endpoint → after the GitHub deploy succeeds:

- **GPU**: 24 GB GPU class (RTX 4090, A5000, L4) — required for SDXL Lightning
- **Active workers**: `0` (start) / `1` (if you want zero cold-start)
- **Max workers**: `1` for personal use; raise if multiple devs hit it
- **Idle timeout**: `30` s — how long a warm worker waits before shutting down
- **Execution timeout**: `300` s — caps a single generation (5 min ceiling)
- **Network volume**: **MANDATORY** — create a `30 GB` network volume in the
  same region as the endpoint, mount at `/workspace`. Without it every cold
  start re-downloads SDXL base + Lightning LoRA + ControlNet (~9 GB).
- **Container disk**: `20 GB` (for the OS + diffusers code, no model weights)
- **Environment variables**:
  - `HF_HOME=/workspace/.cache/huggingface`
  - `TRANSFORMERS_CACHE=/workspace/.cache/huggingface`
  - `TORCH_HOME=/workspace/.cache/torch`

Click **Deploy**.

## 3. First test

Endpoint detail page → **Requests** tab → fire a test job:

```json
{
  "input": {
    "endpoint": "/health"
  }
}
```

Should return:

```json
{
  "status": "ok",
  "models_loaded": [],
  "device": "cuda",
  "vram_total_mb": 24576,
  ...
}
```

If the request fails with "container build failed", check the build logs
on the GitHub deploy in RunPod — most common cause is a torch wheel
version mismatch with the CUDA image. Bump `requirements.txt` and push.

## 4. Generate request format

Every backend route is reachable by passing its path in `input.endpoint`
and the original Flask body in `input.data`:

```json
{
  "input": {
    "endpoint": "/generate-with-controlnet",
    "data": {
      "prompt": "isometric house, stone walls, tile roof",
      "model": "sdxl-lightning-4",
      "image": "data:image/png;base64,iVBORw...",
      "controlnet": "tile_sd15",
      "controlnet_conditioning_scale": 0.7,
      "controlnet_guidance_end": 0.85,
      "strength": 0.55,
      "transparent_background": true,
      "use_img2img": true
    }
  }
}
```

The handler unwraps Flask's JSON response and returns it directly as the
job output. On HTTP errors (400/500 from a route) the response is shaped:

```json
{ "error": "<message from app.py>", "status": 400 }
```

## 5. Endpoints exposed

All Flask routes work — most useful ones:

| Endpoint | Purpose |
|---|---|
| `/health` | sanity check, returns VRAM stats |
| `/generate-with-controlnet` | main path: 3D render + ControlNet (depth/canny/tile) + optional IP-Adapter |
| `/generate-with-adapter` | T2I-Adapter variant |
| `/generate` | plain txt2img / img2img |
| `/clear-gpu` | drop cached pipelines, free VRAM |
| `/list-controlnets` | introspection |

## 6. First-request cold start

When the network volume is empty:
- SDXL base 1.0: ~6.5 GB, ~90 s to download on RunPod's network
- SDXL Lightning LoRA: ~400 MB, ~5 s
- xinsir/controlnet-tile-sdxl-1.0: ~2.5 GB, ~30 s
- IP-Adapter SDXL weights: ~150 MB, ~2 s

**Expect 2–3 minutes for the very first generation.** Subsequent requests
on a warm worker take ~3–8 s on RTX 4090.

If the worker idle-timeouts and a new cold start picks up, model load
from the volume takes ~10–15 s (re-mmap from local disk, no re-download).

## 7. Frontend wiring

In `sd-app/.env.development` (gitignored):

```
VITE_RUNPOD_ENDPOINT_ID=<your-endpoint-id>
VITE_RUNPOD_API_KEY=<your-runpod-api-key>
```

The frontend wraps the existing fetch calls so each Flask path becomes:

```js
fetch(`https://api.runpod.ai/v2/${ENDPOINT_ID}/runsync`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    input: { endpoint: '/generate-with-controlnet', data: { ...originalBody } }
  })
})
```

The response unwrap: `response.json().then(r => r.output)` (RunPod wraps
handler return in an `output` field for sync jobs).

## 8. Cost reality check

- RTX 4090 serverless: ~$0.00044 / second = **$0.026 per generation** at 60 s
- 100 generations / day ≈ $2.60 / day
- Idle: $0 (no active workers)
- Network volume: ~$0.07 / GB / month → 30 GB ≈ **$2.10 / month flat**

vs. on-demand pod ($0.69/h × 8 h work day = $5.52/day **even when idle**).

For 50–200 generations a day, serverless is ~3–5× cheaper than a pod.

## 9. Rebuilds

Push to `main` → RunPod sees the GitHub webhook → rebuilds the image →
draining warm workers swap to the new image on next request. No manual
step beyond `git push`.

## 10. Local dev still works

The Dockerfile only changes the default CMD. To run the Flask server
locally for debugging:

```bash
cd sd-backend
python app.py
```

…and ignore the serverless wrapper entirely. The frontend has a toggle
that picks remote (RunPod) or local (`http://localhost:5000`).
