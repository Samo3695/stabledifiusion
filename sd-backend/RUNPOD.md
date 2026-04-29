# RunPod deploy guide

This deploys the Flask backend (`app.py`) to a RunPod GPU pod for fast remote
iteration. Local dev is unaffected — same `app.py` runs in both places, only
the URL the frontend talks to changes.

## How the image gets built

The Docker image is built **automatically by GitHub Actions** on every push
to `main` ([.github/workflows/docker-build.yml](../.github/workflows/docker-build.yml)).
It builds the root [Dockerfile](../Dockerfile), which:

- starts from `nvidia/cuda:12.1.0-runtime-ubuntu22.04`
- installs `sd-backend/requirements.txt`
- copies `sd-backend/` into the image
- exposes port `5000`
- runs `python3 app.py`

Pushed image:
```
ghcr.io/samo3695/stabledifiusion:latest
```

(image name is lowercase of GitHub `<owner>/<repo>`).

Models are NOT baked in — they download lazily on first request into
`HF_HOME=/workspace/.cache/huggingface`, which lives on the pod's persistent
volume so they survive restarts.

## 1. Trigger a build

Push any commit to `main`, or manually run the workflow:

GitHub repo → **Actions** → **Build and Push Docker Image** → **Run workflow**.

After ~5–10 minutes the image is at
`ghcr.io/samo3695/stabledifiusion:latest`.

## 2. Make the package public (one-time)

GHCR images are private by default — RunPod can't pull them without a token.

GitHub profile → **Packages** → `stabledifiusion` → **Package settings** →
**Change visibility** → **Public**.

Alternatively keep it private and add a registry credential in RunPod
(Settings → Container Registry Auth) using a Personal Access Token with
`read:packages` scope.

## 3. Deploy a pod on RunPod

Pods → **Deploy** → GPU Pod:

- **GPU**: RTX 4090 (24 GB) — best $/perf for SDXL Lightning + ControlNet
- **Pod template** → **Edit** to override:
  - Container image: `ghcr.io/samo3695/stabledifiusion:latest`
  - Container disk: **20 GB**
  - Volume disk: **30 GB**
  - Volume mount path: `/workspace`
  - Expose HTTP ports: `5000`
  - Expose TCP ports: `22`
  - Environment variables:
    - `HF_HOME=/workspace/.cache/huggingface`
    - `TRANSFORMERS_CACHE=/workspace/.cache/huggingface`
- Pricing: On-Demand
- ✓ SSH terminal access
- Idle timeout: 10 min (auto-stop when GPU goes idle)

Click **Set overrides** → **Deploy On-Demand**.

## 4. Get the public URL

Pod's detail page → **Connect** → there's an HTTPS proxy URL of the form:

```
https://<pod-id>-5000.proxy.runpod.net
```

Verify it works:

```bash
curl https://<pod-id>-5000.proxy.runpod.net/health
# {"status": "ok", ...}
```

If `/health` returns 502 / connection refused, the container is still
booting — give it ~30 s and retry.

## 5. Point the frontend at it

In `sd-app/.env.development`:

```
VITE_REMOTE_API_URL=https://<pod-id>-5000.proxy.runpod.net
```

Restart `npm run dev`. In the LocalModel page, tick **Use SDXL Lightning**
then **Run on RunPod (remote)**. All generate requests now go to the pod.

## 6. First request notes

The first request after a fresh volume blocks while SDXL base, the Lightning
LoRA and ControlNet weights download — expect **60–180 s** for that one
request. Subsequent requests reuse the cache and take ~1.5 s on RTX 4090.

Switching to a ControlNet kind that hasn't been used (e.g. depth after
canny) also stalls once while its weights stream in.

## 7. Cost reality check

- RTX 4090 pod: $0.69 / hour while running.
- Idle timeout 10 min protects you against forgotten pods. Forgetting
  = ~$16.50 / day if pod runs 24/7.

For sporadic iteration sessions, **stop the pod manually** (Pods → Stop)
the moment you're done. The volume keeps the models, next start is back to
~30 s.

## 8. Rebuilds

Every push to `main` triggers a new image build. To pull the latest on
RunPod: stop the pod, then start it again — it pulls `:latest` on cold
start.
