"""RunPod Serverless handler for the Stable Diffusion backend.

Strategy: keep the Flask app (`app.py`) untouched and dispatch incoming
serverless jobs to its routes via Flask's built-in test client. That way both
deployment modes (local Flask, RunPod Serverless) run the exact same code
paths — no logic duplication, no risk of drift.

Input format (what the frontend POSTs to /v2/{endpoint_id}/runsync):

    {
      "input": {
        "endpoint": "/generate-with-controlnet",   # path of the Flask route
        "data": { "prompt": "...", ... }           # body that route expects
      }
    }

Output format:

    On success → whatever JSON the Flask route returned (passes through).
    On error   → {"error": "<message>", "status": <http_status>}.

Health check pattern (RunPod cold-start ping): if `input.endpoint == "/health"`
or `input` is empty/missing the handler returns immediately without touching
the model code.
"""

import os
import sys
import traceback

import runpod

# Importing app.py loads diffusers / torch / etc. eagerly. We do it at module
# scope so the FIRST request after a worker cold-start absorbs the import time
# (~5–10 s) instead of the user's request. RunPod will hold the worker warm
# for `idleTimeout` seconds after that, so subsequent requests are fast.
print("[rp_handler] importing Flask app...", flush=True)
from app import app  # noqa: E402

# Flask test client lets us call routes in-process without spinning up a
# real HTTP server. Faster, simpler, and avoids port-binding concerns inside
# the serverless container.
_client = app.test_client()
print("[rp_handler] Flask app ready.", flush=True)


def _normalise_endpoint(ep: str) -> str:
    """Accept both "/generate-with-controlnet" and "generate-with-controlnet"."""
    if not ep:
        return ""
    return ep if ep.startswith("/") else "/" + ep


def handler(event):
    """Entry point invoked by runpod.serverless for every job."""
    inp = (event or {}).get("input") or {}

    # Empty input → treat as warm-up ping.
    if not inp:
        return {"status": "ok", "message": "warm"}

    endpoint = _normalise_endpoint(inp.get("endpoint", "/generate"))
    data = inp.get("data") or {}

    try:
        # Flask test client mirrors a real request. Methods other than POST
        # are not used by our routes, so we hard-code POST except for /health.
        if endpoint == "/health":
            response = _client.get(endpoint)
        else:
            response = _client.post(endpoint, json=data)

        status = response.status_code
        # All our generate routes return JSON. If somehow they didn't, fall
        # back to raw text so the user sees what the server actually said.
        try:
            body = response.get_json(force=False, silent=True)
            if body is None:
                body = {"raw": response.data.decode("utf-8", errors="replace")}
        except Exception:
            body = {"raw": response.data.decode("utf-8", errors="replace")}

        if status >= 400:
            # Surface as an error object — RunPod treats non-200 returns from
            # the handler as worker failures, which we don't want for client
            # errors like missing prompt.
            return {
                "error": body.get("error") if isinstance(body, dict) else body,
                "status": status,
            }

        return body

    except Exception as exc:
        # Any uncaught exception from the route — log full traceback so we
        # can see it in the RunPod worker logs, then return a clean message.
        print("[rp_handler] handler exception:", exc, file=sys.stderr, flush=True)
        traceback.print_exc()
        return {"error": str(exc), "status": 500}


if __name__ == "__main__":
    print(
        f"[rp_handler] starting RunPod serverless worker "
        f"(HF_HOME={os.environ.get('HF_HOME', '<unset>')})",
        flush=True,
    )
    runpod.serverless.start({"handler": handler})
