"""
CLIP Text Encoder API for browser-based Stable Diffusion.

Runs the CLIP text encoder on CPU so the browser doesn't need to download it (~600MB saved).
Browser sends prompt → server returns embeddings [1, 77, 768] as binary Float32.

Deploy on Hugging Face Spaces (free, 16GB RAM, Python/FastAPI).
"""

import hashlib
import struct
from collections import OrderedDict
from contextlib import asynccontextmanager

import numpy as np
import torch
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from transformers import CLIPTextModel, CLIPTokenizer

# --- Config ---
MODEL_ID = "stabilityai/sd-turbo"
MAX_CACHE_SIZE = 1024  # cache up to 1024 unique prompts (~231KB each ≈ ~237MB max)


# --- LRU Cache ---
class LRUCache(OrderedDict):
    def __init__(self, maxsize: int):
        super().__init__()
        self.maxsize = maxsize

    def get_cached(self, key):
        if key in self:
            self.move_to_end(key)
            return self[key]
        return None

    def put(self, key, value):
        if key in self:
            self.move_to_end(key)
        else:
            if len(self) >= self.maxsize:
                self.popitem(last=False)
        self[key] = value


# --- Globals ---
tokenizer = None
text_encoder = None
cache = LRUCache(MAX_CACHE_SIZE)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup."""
    global tokenizer, text_encoder
    print(f"[CLIP API] Loading tokenizer from {MODEL_ID}...")
    tokenizer = CLIPTokenizer.from_pretrained(MODEL_ID, subfolder="tokenizer")
    print(f"[CLIP API] Loading text encoder from {MODEL_ID}...")
    text_encoder = CLIPTextModel.from_pretrained(
        MODEL_ID, subfolder="text_encoder", torch_dtype=torch.float32
    )
    text_encoder.eval()
    print("[CLIP API] Ready! Text encoder loaded on CPU.")
    yield
    # Cleanup
    del text_encoder, tokenizer


app = FastAPI(title="CLIP Text Encoder API", lifespan=lifespan)

# Allow all origins for browser access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


class EncodeRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=1000)


@app.post("/encode")
async def encode_prompt(req: EncodeRequest):
    """
    Tokenize + encode prompt → return embeddings as raw Float32 bytes.
    Response: binary [1, 77, 768] Float32Array (236,544 bytes = ~231 KB).
    """
    prompt = req.prompt.strip()
    cache_key = hashlib.sha256(prompt.encode("utf-8")).hexdigest()

    # Check cache
    cached = cache.get_cached(cache_key)
    if cached is not None:
        return Response(content=cached, media_type="application/octet-stream")

    # Tokenize
    tokens = tokenizer(
        prompt,
        padding="max_length",
        max_length=77,
        truncation=True,
        return_tensors="pt",
    )

    # Encode
    with torch.no_grad():
        output = text_encoder(tokens.input_ids)
        embeddings = output.last_hidden_state  # [1, 77, 768]

    # Convert to bytes (little-endian float32)
    embedding_bytes = embeddings.cpu().numpy().astype(np.float32).tobytes()

    # Cache it
    cache.put(cache_key, embedding_bytes)

    return Response(content=embedding_bytes, media_type="application/octet-stream")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": MODEL_ID,
        "cache_size": len(cache),
        "embedding_shape": [1, 77, 1024],
        "embedding_bytes": 1 * 77 * 1024 * 4,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=7860)
