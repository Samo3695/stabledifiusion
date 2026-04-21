/**
 * WebGPU Stable Diffusion Pipeline
 * Uses @huggingface/transformers for tokenization and model loading
 * Uses onnxruntime-web with WebGPU for inference
 * 
 * Supports SD Turbo (1-4 step generation) for fast in-browser inference.
 */

import { AutoTokenizer } from '@huggingface/transformers'
import * as ort from 'onnxruntime-web/webgpu'

// HuggingFace Hub CDN base
const HF_CDN = 'https://huggingface.co'

// Default model repo - SD Turbo ONNX (FP16, optimized for web)
export const DEFAULT_MODEL_REPO = 'schmuell/sd-turbo-ort-web'
const DEFAULT_TOKENIZER_REPO = 'openai/clip-vit-base-patch32'

// Isometric merged UNet models on HuggingFace (LoRA-merged, no local server needed)
export const REMOTE_ISOMETRIC_UNET_URL = 'https://huggingface.co/Samo629/sd-turbo-isometric-onnx/resolve/main/fp16/unet/model.onnx'
export const REMOTE_ISOMETRIC_QUANTIZED_UNET_URL = 'https://huggingface.co/Samo629/sd-turbo-isometric-onnx/resolve/main/quantized/unet/model.onnx'

// Local ONNX model servers (served by serve_onnx.py)
export const LOCAL_ISOMETRIC_UNET_URL = 'http://localhost:8766/unet/model.onnx'
export const LOCAL_ISOMETRIC_QUANTIZED_UNET_URL = 'http://localhost:8767/unet/model.onnx'

// Auto-detect: use local model URLs when running on localhost
export const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

export const ISOMETRIC_UNET_URL = isLocal ? LOCAL_ISOMETRIC_UNET_URL : REMOTE_ISOMETRIC_UNET_URL
export const ISOMETRIC_QUANTIZED_UNET_URL = isLocal ? LOCAL_ISOMETRIC_QUANTIZED_UNET_URL : REMOTE_ISOMETRIC_QUANTIZED_UNET_URL

// Remote CLIP text encoder API (avoids downloading ~600MB text encoder in browser)
export const DEFAULT_CLIP_API_URL = 'https://samo629-clip-api.hf.space'

// Model variant identifiers
export const MODEL_VARIANTS = {
  STANDARD: 'standard',
  ISOMETRIC_FP16: 'isometric-fp16',
  ISOMETRIC_QUANTIZED: 'isometric-quantized',
}

/**
 * Download a file from a direct URL with progress tracking
 */
async function downloadFromUrl(url, onProgress) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }

  const contentLength = response.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength, 10) : 0
  const reader = response.body.getReader()
  const chunks = []
  let loaded = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    if (onProgress && total > 0) {
      onProgress(loaded / total)
    }
  }

  const buffer = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.length
  }

  return buffer.buffer
}

/**
 * Download a file from HuggingFace Hub with progress tracking
 */
async function downloadModel(repo, filepath, onProgress) {
  const url = `${HF_CDN}/${repo}/resolve/main/${filepath}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to download ${filepath}: ${response.status} ${response.statusText}`)
  }

  const contentLength = response.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength, 10) : 0
  const reader = response.body.getReader()
  const chunks = []
  let loaded = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    if (onProgress && total > 0) {
      onProgress(loaded / total)
    }
  }

  const buffer = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.length
  }

  return buffer.buffer
}

/**
 * Cache model in IndexedDB for faster subsequent loads
 */
const MODEL_CACHE_DB = 'webgpu-sd-model-cache'
const MODEL_CACHE_STORE = 'models'

async function openCacheDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MODEL_CACHE_DB, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(MODEL_CACHE_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function getCachedModel(key) {
  try {
    const db = await openCacheDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MODEL_CACHE_STORE, 'readonly')
      const req = tx.objectStore(MODEL_CACHE_STORE).get(key)
      req.onsuccess = () => { db.close(); resolve(req.result || null) }
      req.onerror = () => { db.close(); reject(req.error) }
    })
  } catch {
    return null
  }
}

async function setCachedModel(key, data) {
  try {
    const db = await openCacheDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MODEL_CACHE_STORE, 'readwrite')
      tx.objectStore(MODEL_CACHE_STORE).put(data, key)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    })
  } catch {
    // Cache write failure is non-fatal
  }
}

/**
 * Load an ONNX model with caching and WebGPU/WASM execution
 */
let _selectedProvider = null

async function loadOnnxModel(repo, filepath, onProgress) {
  const cacheKey = `${repo}/${filepath}`

  // Try cache first
  let buffer = await getCachedModel(cacheKey)
  if (buffer) {
    console.log(`[SD] Cache hit: ${filepath}`)
    if (onProgress) onProgress(1)
  } else {
    console.log(`[SD] Downloading: ${filepath}`)
    buffer = await downloadModel(repo, filepath, onProgress)
    await setCachedModel(cacheKey, buffer)
    console.log(`[SD] Downloaded & cached: ${filepath}`)
  }

  // Pick provider on first model load
  if (!_selectedProvider) {
    _selectedProvider = await pickProvider(buffer)
    console.log(`[SD] Selected provider: ${_selectedProvider}`)
  }

  console.log(`[SD] Creating session for ${filepath} with ${_selectedProvider}...`)
  try {
    const session = await ort.InferenceSession.create(buffer, {
      executionProviders: [_selectedProvider],
      graphOptimizationLevel: 'disabled',
    })
    console.log(`[SD] Session created for ${filepath}`)
    return session
  } catch (e) {
    // If webgpu failed for this specific model, try wasm
    if (_selectedProvider === 'webgpu') {
      console.warn(`[SD] WebGPU session failed for ${filepath}, trying wasm:`, e.message)
      _selectedProvider = 'wasm'
      const session = await ort.InferenceSession.create(buffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'disabled',
      })
      console.log(`[SD] Session created for ${filepath} with wasm fallback`)
      return session
    }
    throw e
  }
}

async function pickProvider(testBuffer) {
  // Try WebGPU with actual session creation
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) {
        console.log('[SD] WebGPU adapter found, testing session creation...')
        try {
          const testSession = await ort.InferenceSession.create(testBuffer, {
            executionProviders: ['webgpu'],
            graphOptimizationLevel: 'disabled',
          })
          await testSession.release()
          console.log('[SD] WebGPU session test passed')
          return 'webgpu'
        } catch (e) {
          console.warn('[SD] WebGPU session test failed:', e.message)
        }
      }
    } catch (e) {
      console.warn('[SD] WebGPU adapter request failed:', e)
    }
  }
  console.log('[SD] Using wasm provider')
  return 'wasm'
}

// ─── Float16 conversion ───

const _f32 = new Float32Array(1)
const _u32 = new Uint32Array(_f32.buffer)

function float32ToFloat16(val) {
  _f32[0] = val
  const f = _u32[0]
  const sign = (f >> 16) & 0x8000
  const exp = ((f >> 23) & 0xff) - 127 + 15
  const frac = (f >> 13) & 0x3ff
  if (exp <= 0) return sign // flush to zero for subnormals
  if (exp >= 31) return sign | 0x7c00 // infinity
  return sign | (exp << 10) | frac
}

function float32ArrayToFloat16(f32arr) {
  const u16 = new Uint16Array(f32arr.length)
  for (let i = 0; i < f32arr.length; i++) {
    u16[i] = float32ToFloat16(f32arr[i])
  }
  return u16
}

// Release an ort.Tensor's underlying GPU buffer (WebGPU EP).
// Safe: only disposes if the tensor still has a live GPU buffer.
// IMPORTANT: always read tensor.data FIRST (triggers GPU→CPU download),
// then call this — otherwise the download will fail.
function disposeTensor(t) {
  if (!t) return
  try {
    // Skip CPU-only tensors (no GPU buffer to free)
    const loc = t.location
    if (loc && loc !== 'gpu-buffer' && loc !== 'ml-tensor') {
      // CPU tensor — dispose is cheap no-op but still wrap in try
    }
    if (typeof t.dispose === 'function') t.dispose()
  } catch (e) {
    // best-effort; ignore (some ORT versions throw on re-dispose)
  }
}

// Read all data out of an output tensor into a plain typed array,
// then release the tensor's GPU buffer. Prevents VRAM leaks between runs.
async function drainAndDispose(t) {
  if (!t) return null
  let data
  try {
    // .data on WebGPU tensors is async-backed via getData() in newer ORT,
    // but usually a sync getter that returns the already-downloaded buffer.
    // Using getData() explicitly if present forces the download.
    if (typeof t.getData === 'function') {
      data = await t.getData(true) // true = release buffer after download
    } else {
      data = t.data
      // Copy into a plain typed array so we don't hold reference to tensor storage
      if (data instanceof Float32Array) data = new Float32Array(data)
      else if (data instanceof Uint16Array) data = new Uint16Array(data)
      else if (data && data.BYTES_PER_ELEMENT) data = data.slice()
    }
  } catch (e) {
    // fall back to sync .data
    try { data = t.data } catch {}
  }
  disposeTensor(t)
  return data
}

function float16ToFloat32(h) {
  const sign = (h & 0x8000) << 16
  const exp = (h >> 10) & 0x1f
  const frac = h & 0x3ff
  if (exp === 0) { _u32[0] = sign; return _f32[0] } // zero/subnormal
  if (exp === 31) { _u32[0] = sign | 0x7f800000 | (frac << 13); return _f32[0] } // inf/nan
  _u32[0] = sign | ((exp - 15 + 127) << 23) | (frac << 13)
  return _f32[0]
}

function float16ArrayToFloat32(u16arr) {
  const f32 = new Float32Array(u16arr.length)
  for (let i = 0; i < u16arr.length; i++) {
    f32[i] = float16ToFloat32(u16arr[i])
  }
  return f32
}

// ─── SD Turbo Scheduler (EulerDiscrete, trailing spacing) ───

const NUM_TRAIN_TIMESTEPS = 1000
const BETA_START = 0.00085
const BETA_END = 0.012

function computeAlphasCumprod() {
  // scaled_linear beta schedule
  const betas = new Float64Array(NUM_TRAIN_TIMESTEPS)
  const sqrtStart = Math.sqrt(BETA_START)
  const sqrtEnd = Math.sqrt(BETA_END)
  for (let i = 0; i < NUM_TRAIN_TIMESTEPS; i++) {
    const b = sqrtStart + (sqrtEnd - sqrtStart) * i / (NUM_TRAIN_TIMESTEPS - 1)
    betas[i] = b * b
  }

  const alphasCumprod = new Float64Array(NUM_TRAIN_TIMESTEPS)
  alphasCumprod[0] = 1.0 - betas[0]
  for (let i = 1; i < NUM_TRAIN_TIMESTEPS; i++) {
    alphasCumprod[i] = alphasCumprod[i - 1] * (1.0 - betas[i])
  }
  return alphasCumprod
}

const ALPHAS_CUMPROD = computeAlphasCumprod()

function getTimesteps(numSteps) {
  // trailing timestep spacing (as used by SD Turbo)
  const stepRatio = Math.floor(NUM_TRAIN_TIMESTEPS / numSteps)
  const timesteps = []
  for (let i = numSteps; i > 0; i--) {
    timesteps.push(i * stepRatio - 1)
  }
  return timesteps
}

function getSigma(timestep) {
  const alphaProd = ALPHAS_CUMPROD[timestep]
  return Math.sqrt((1 - alphaProd) / alphaProd)
}

function gaussianRandom() {
  const u1 = Math.random()
  const u2 = Math.random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function generateLatentNoise(batchSize, channels, height, width) {
  const size = batchSize * channels * height * width
  const noise = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    noise[i] = gaussianRandom()
  }
  return noise
}

function eulerStep(modelOutput, sample, sigma, sigmaNext) {
  // Euler discrete step with epsilon prediction
  // pred_original_sample = sample - sigma * model_output
  // derivative (d) = (sample - pred_original) / sigma = model_output
  // dt = sigma_next - sigma
  // output = sample + d * dt

  const dt = sigmaNext - sigma
  const result = new Float32Array(sample.length)
  for (let i = 0; i < sample.length; i++) {
    result[i] = sample[i] + modelOutput[i] * dt
  }
  return result
}

/**
 * Convert latent tensor to RGB image (post-VAE decode)
 * @param {Float32Array|number[]} decodedData - decoded VAE output
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array|null} alphaMask - optional alpha mask to apply (width*height)
 */
function latentsToImage(decodedData, width, height, alphaMask = null) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const imageData = ctx.createImageData(width, height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = y * width + x
      const dstIdx = (y * width + x) * 4

      // Decoded latents come as NCHW: [1, 3, H, W]
      // Values typically in [-1, 1], map to [0, 255]
      const r = Math.min(255, Math.max(0, Math.round((decodedData[0 * height * width + srcIdx] / 2 + 0.5) * 255)))
      const g = Math.min(255, Math.max(0, Math.round((decodedData[1 * height * width + srcIdx] / 2 + 0.5) * 255)))
      const b = Math.min(255, Math.max(0, Math.round((decodedData[2 * height * width + srcIdx] / 2 + 0.5) * 255)))

      imageData.data[dstIdx] = r
      imageData.data[dstIdx + 1] = g
      imageData.data[dstIdx + 2] = b
      // Apply alpha mask if provided, otherwise fully opaque
      imageData.data[dstIdx + 3] = alphaMask ? alphaMask[srcIdx] : 255
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * Extract alpha mask from source image (transparent pixels).
 * Returns Uint8Array of size width*height with alpha values [0-255].
 * The mask is eroded (shrunk) slightly so any bleeding fill at the edge is cut off,
 * then feathered for smooth blending.
 */
function extractAlphaMask(imageSource, width, height, erode = 1, feather = 1) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(imageSource, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)
  const pixels = imageData.data

  const size = width * height
  const binary = new Uint8Array(size) // 1 = opaque (foreground), 0 = transparent (background)
  let hasTransparency = false
  for (let i = 0; i < size; i++) {
    const a = pixels[i * 4 + 3]
    if (a < 128) {
      binary[i] = 0
      hasTransparency = true
    } else {
      binary[i] = 1
    }
  }

  // If the input has no transparency at all, return null (no mask to apply)
  if (!hasTransparency) return null

  // Erode the foreground mask by `erode` pixels to eliminate any bleed at edges
  let eroded = binary
  for (let d = 0; d < erode; d++) {
    const next = new Uint8Array(size)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x
        if (!eroded[idx]) { next[idx] = 0; continue }
        // Keep only if all 4-neighbors are also foreground
        if ((x > 0 && !eroded[idx - 1]) ||
            (x < width - 1 && !eroded[idx + 1]) ||
            (y > 0 && !eroded[idx - width]) ||
            (y < height - 1 && !eroded[idx + width])) {
          next[idx] = 0
        } else {
          next[idx] = 1
        }
      }
    }
    eroded = next
  }

  const alpha = new Uint8Array(size)
  for (let i = 0; i < size; i++) alpha[i] = eroded[i] ? 255 : 0

  // Feathering: blur alpha with a simple box blur `feather` times for smooth edges
  if (feather > 0) {
    let src = alpha
    for (let pass = 0; pass < feather; pass++) {
      const next = new Uint8Array(size)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x
          let sum = src[idx]
          let count = 1
          if (x > 0) { sum += src[idx - 1]; count++ }
          if (x < width - 1) { sum += src[idx + 1]; count++ }
          if (y > 0) { sum += src[idx - width]; count++ }
          if (y < height - 1) { sum += src[idx + width]; count++ }
          next[idx] = Math.round(sum / count)
        }
      }
      src = next
    }
    return src
  }

  return alpha
}

/**
 * Main Stable Diffusion Pipeline
 */
export class StableDiffusionPipeline {
  constructor(options = {}) {
    this.modelRepo = options.modelRepo || DEFAULT_MODEL_REPO
    this.tokenizerRepo = options.tokenizerRepo || DEFAULT_TOKENIZER_REPO
    this.unetUrl = options.unetUrl || null // Direct URL override for UNet
    this.unetFp16 = options.unetFp16 !== undefined ? options.unetFp16 : false // Whether UNet expects float16 inputs
    this.clipApiUrl = options.clipApiUrl || DEFAULT_CLIP_API_URL // Remote CLIP API URL (skips local text encoder download)
    this.tokenizer = null
    this.textEncoder = null
    this.unet = null
    this.vaeDecoder = null
    this.vaeEncoder = null
    this.loaded = false
  }

  async load(onProgress) {
    // When using remote CLIP API, we skip tokenizer + text encoder (2 fewer models to download)
    let useRemoteClip = !!this.clipApiUrl

    if (useRemoteClip) {
      // Verify remote CLIP API is reachable
      try {
        const res = await fetch(`${this.clipApiUrl}/health`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const info = await res.json()
        console.log('[SD] Remote CLIP API connected:', info)
      } catch (e) {
        console.warn('[SD] Remote CLIP API unreachable, falling back to local text encoder:', e.message)
        this.clipApiUrl = null
        useRemoteClip = false
      }
    }

    const totalModels = useRemoteClip ? 3 : 4
    let completedModels = 0

    const reportProgress = (modelProgress) => {
      const overall = (completedModels + modelProgress) / totalModels
      if (onProgress) onProgress(overall, completedModels)
    }

    if (!useRemoteClip) {
      // Load tokenizer (local)
      try {
        this.tokenizer = await AutoTokenizer.from_pretrained(this.tokenizerRepo, {
          progress_callback: (p) => {
            if (p.progress !== undefined) reportProgress(p.progress / 100)
          }
        })
      } catch (e) {
        console.warn('AutoTokenizer failed, will use basic tokenization:', e)
        this.tokenizer = null
      }
      completedModels = 1
      reportProgress(0)

      // Load text encoder ONNX (local)
      this.textEncoder = await loadOnnxModel(
        this.modelRepo,
        'text_encoder/model.onnx',
        (p) => reportProgress(p)
      )
      completedModels = 2
      reportProgress(0)

      // Log text encoder inputs/outputs for debugging
      console.log('[SD] Text encoder inputs:', this.textEncoder.inputNames)
      console.log('[SD] Text encoder outputs:', this.textEncoder.outputNames)
    } else {
      console.log(`[SD] Using remote CLIP API: ${this.clipApiUrl} (skipping tokenizer + text encoder download)`)
      completedModels = 0
    }

    // When using remote CLIP, offset completedModels so stage indices align to 0-based UNet/VAE stages
    const stageOffset = useRemoteClip ? 0 : 2

    // Load UNet ONNX (from custom URL or default repo)
    if (this.unetUrl) {
      console.log(`[SD] Loading UNet from custom URL: ${this.unetUrl}`)
      const cacheKey = this.unetUrl
      let buffer = await getCachedModel(cacheKey)
      if (buffer) {
        console.log('[SD] Cache hit: custom UNet')
        reportProgress(1)
      } else {
        console.log('[SD] Downloading custom UNet...')
        buffer = await downloadFromUrl(this.unetUrl, (p) => reportProgress(p))
        await setCachedModel(cacheKey, buffer)
        console.log('[SD] Downloaded & cached custom UNet')
      }
      if (!_selectedProvider) {
        _selectedProvider = await pickProvider(buffer)
        console.log(`[SD] Selected provider: ${_selectedProvider}`)
      }
      this.unet = await ort.InferenceSession.create(buffer, {
        executionProviders: [_selectedProvider],
        graphOptimizationLevel: 'disabled',
      })
      // unetFp16 is already set from constructor options
    } else {
      this.unet = await loadOnnxModel(
        this.modelRepo,
        'unet/model.onnx',
        (p) => reportProgress(p)
      )
    }
    completedModels = stageOffset + 0.5
    reportProgress(0)

    console.log('[SD] UNet inputs:', this.unet.inputNames)
    console.log('[SD] UNet outputs:', this.unet.outputNames)

    // Load VAE decoder ONNX
    this.vaeDecoder = await loadOnnxModel(
      this.modelRepo,
      'vae_decoder/model.onnx',
      (p) => reportProgress(p)
    )
    completedModels = stageOffset + 1
    reportProgress(0)

    console.log('[SD] VAE decoder inputs:', this.vaeDecoder.inputNames)
    console.log('[SD] VAE decoder outputs:', this.vaeDecoder.outputNames)

    // Load VAE encoder ONNX (for img2img)
    this.vaeEncoder = await loadOnnxModel(
      this.modelRepo,
      'vae_encoder/model.onnx',
      (p) => reportProgress(p)
    )
    completedModels = totalModels
    if (onProgress) onProgress(1, completedModels)

    console.log('[SD] VAE encoder inputs:', this.vaeEncoder.inputNames)
    console.log('[SD] VAE encoder outputs:', this.vaeEncoder.outputNames)

    this.loaded = true
  }

  /**
   * Get text embeddings for a prompt, either from remote CLIP API or local ONNX text encoder.
   * Returns an ort.Tensor with shape [1, 77, 768].
   */
  async getTextEmbeddings(prompt) {
    if (this.clipApiUrl) {
      // Remote CLIP API: send prompt, get back raw Float32 bytes [1, 77, 768]
      console.log('[SD] Fetching embeddings from remote CLIP API...')
      const res = await fetch(`${this.clipApiUrl}/encode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      if (!res.ok) {
        throw new Error(`CLIP API error: ${res.status} ${res.statusText}`)
      }
      const buffer = await res.arrayBuffer()
      const float32Data = new Float32Array(buffer)
      const embDim = float32Data.length / 77 // auto-detect: 768 or 1024
      console.log(`[SD] Remote embeddings received: ${float32Data.length} floats, dim=${embDim}`)
      return new ort.Tensor('float32', float32Data, [1, 77, embDim])
    }

    // Local: tokenize + run text encoder ONNX
    let inputIds
    if (this.tokenizer) {
      const encoded = await this.tokenizer(prompt, {
        padding: 'max_length',
        max_length: 77,
        truncation: true,
      })
      let raw = encoded.input_ids
      if (raw && raw.data) raw = raw.data
      if (raw && raw.flat) raw = raw.flat()
      const arr = new Int32Array(77)
      for (let i = 0; i < 77 && i < raw.length; i++) {
        arr[i] = Number(raw[i])
      }
      inputIds = arr
      console.log('[SD] Token IDs (first 10):', Array.from(inputIds.slice(0, 10)))
    } else {
      inputIds = new Int32Array(77).fill(49407)
      inputIds[0] = 49406
      console.warn('[SD] Using fallback tokenizer')
    }

    const textInputTensor = new ort.Tensor('int32', inputIds, [1, 77])
    const textOutput = await this.textEncoder.run({ input_ids: textInputTensor })
    const textEmbeddings = Object.values(textOutput)[0]
    console.log('[SD] Text embeddings shape:', textEmbeddings.dims, 'dtype:', textEmbeddings.type)
    // Release only the input tensor we created (CPU-backed int32).
    disposeTensor(textInputTensor)
    return textEmbeddings
  }

  async _flushGpuQueue() {
    try {
      const dev = ort?.env?.webgpu?.device
      if (dev && dev.queue && dev.queue.onSubmittedWorkDone) {
        await dev.queue.onSubmittedWorkDone()
      }
    } catch (e) {
      // best-effort flush; ignore errors
    }
  }

  async generate(prompt, options = {}) {
    if (!this.loaded) throw new Error('Pipeline not loaded. Call load() first.')

    const {
      numSteps = 1,
      width = 512,
      height = 512,
      onStep = null,
    } = options

    const latentHeight = height / 8
    const latentWidth = width / 8
    const latentChannels = 4

    // 1. Get text embeddings (remote CLIP API or local)
    const textEmbeddings = await this.getTextEmbeddings(prompt)

    // 2. Generate initial noise
    let latents = generateLatentNoise(1, latentChannels, latentHeight, latentWidth)

    // 3. Compute timesteps and sigmas
    const timesteps = getTimesteps(numSteps)
    const sigmas = timesteps.map(t => getSigma(t))
    sigmas.push(0) // final sigma = 0

    console.log('[SD] Timesteps:', timesteps, 'Sigmas:', sigmas)

    // 5. Scale initial latents by first sigma
    // model input = sample / sqrt(sigma^2 + 1)  (scaled model input)
    const initSigma = sigmas[0]
    for (let i = 0; i < latents.length; i++) {
      latents[i] *= initSigma
    }

    // Precompute hiddenStates ONCE outside the loop (was recreated every step → GPU buffer leak)
    let hiddenStates = textEmbeddings
    let hiddenStatesOwned = false
    if (this.unetFp16 && textEmbeddings.type !== 'float16') {
      hiddenStates = new ort.Tensor('float16', float32ArrayToFloat16(textEmbeddings.data), textEmbeddings.dims)
      hiddenStatesOwned = true
    }

    // 6. Denoising loop
    for (let step = 0; step < numSteps; step++) {
      if (onStep) onStep(step, numSteps)

      const sigma = sigmas[step]
      const sigmaNext = sigmas[step + 1]
      const timestep = timesteps[step]

      // Scale model input: sample / sqrt(sigma^2 + 1)
      const scaleFactor = 1.0 / Math.sqrt(sigma * sigma + 1)
      const scaledLatents = new Float32Array(latents.length)
      for (let i = 0; i < latents.length; i++) {
        scaledLatents[i] = latents[i] * scaleFactor
      }

      const latentTensor = this.unetFp16
        ? new ort.Tensor('float16', float32ArrayToFloat16(scaledLatents), [1, latentChannels, latentHeight, latentWidth])
        : new ort.Tensor('float32', scaledLatents, [1, latentChannels, latentHeight, latentWidth])
      const timestepTensor = new ort.Tensor('int64', new BigInt64Array([BigInt(timestep)]), [1])

      console.log(`[SD] Step ${step + 1}/${numSteps}: timestep=${timestep}, sigma=${sigma.toFixed(4)}, sigmaNext=${sigmaNext.toFixed(4)}`)

      const unetOutput = await this.unet.run({
        sample: latentTensor,
        timestep: timestepTensor,
        encoder_hidden_states: hiddenStates,
      })
      const rawOutput = Object.values(unetOutput)[0]
      console.log(`[SD] UNet output type: ${rawOutput.type}, dims: ${rawOutput.dims}, data length: ${rawOutput.data.length}`)
      console.log(`[SD] UNet raw output sample (first 5):`, Array.from(rawOutput.data.slice(0, 5)))
      // Handle float16 output: if data is Float16Array (browser native), just cast to Float32Array
      // If data is Uint16Array (raw bits), use manual conversion
      let noisePred
      if (rawOutput.type === 'float16') {
        const firstVal = rawOutput.data[0]
        if (typeof firstVal === 'number' && (firstVal % 1 !== 0 || firstVal === 0)) {
          // Float16Array — values are already floats, just copy to Float32Array
          noisePred = Float32Array.from(rawOutput.data)
        } else {
          noisePred = float16ArrayToFloat32(rawOutput.data)
        }
      } else {
        noisePred = rawOutput.data instanceof Float32Array ? rawOutput.data : new Float32Array(rawOutput.data)
      }
      console.log(`[SD] noisePred sample (first 5):`, Array.from(noisePred.slice(0, 5)))

      // Euler step
      latents = eulerStep(noisePred, latents, sigma, sigmaNext)
      console.log(`[SD] latents after euler step (first 5):`, Array.from(latents.slice(0, 5)))

      // Free GPU buffers of this step's transient INPUT tensors only.
      // Do NOT dispose rawOutput — it's owned by ORT session and disposing it
      // corrupts internal state → next run throws "destroy of undefined".
      disposeTensor(latentTensor)
      disposeTensor(timestepTensor)
    }

    // Free hiddenStates if we created it (fp16 conversion copy).
    // Do NOT dispose textEmbeddings — it came from textEncoder.run() and is ORT-owned.
    if (hiddenStatesOwned) disposeTensor(hiddenStates)

    // 7. VAE decode — scale latents by 1/0.18215
    const scaledLatents = new Float32Array(latents.length)
    for (let i = 0; i < latents.length; i++) {
      scaledLatents[i] = latents[i] / 0.18215
    }
    console.log('[SD] VAE input (first 5):', Array.from(scaledLatents.slice(0, 5)))

    const latentTensor = new ort.Tensor('float32', scaledLatents, [1, latentChannels, latentHeight, latentWidth])
    const decoded = await this.vaeDecoder.run({ latent_sample: latentTensor })
    const decodedTensor = Object.values(decoded)[0]
    // Copy data out of the output tensor (triggers GPU→CPU download).
    const decodedData = decodedTensor.data instanceof Float32Array
      ? new Float32Array(decodedTensor.data)
      : Float32Array.from(decodedTensor.data)

    console.log('[SD] Decoded output shape:', decodedTensor.dims)
    console.log('[SD] Decoded values (first 10):', Array.from(decodedData.slice(0, 10)))
    console.log('[SD] Decoded range:', Math.min(...Array.from(decodedData.slice(0, 1000))), 'to', Math.max(...Array.from(decodedData.slice(0, 1000))))

    // Only dispose the input we created. decodedTensor is ORT-owned.
    disposeTensor(latentTensor)
    await this._flushGpuQueue()

    // 8. Convert to image
    return latentsToImage(decodedData, width, height)
  }

  /**
   * Encode an image (HTMLImageElement, HTMLCanvasElement, or ImageBitmap) to latent space
   */
  async encodeImage(imageSource, width = 512, height = 512) {
    // Draw to canvas at target size
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(imageSource, 0, 0, width, height)
    const imageData = ctx.getImageData(0, 0, width, height)
    const pixels = imageData.data

    // Convert RGBA HWC [0,255] to RGB NCHW [-1,1]
    const size = width * height
    const input = new Float32Array(1 * 3 * height * width)
    for (let i = 0; i < size; i++) {
      const r = pixels[i * 4] / 255.0 * 2 - 1
      const g = pixels[i * 4 + 1] / 255.0 * 2 - 1
      const b = pixels[i * 4 + 2] / 255.0 * 2 - 1
      input[0 * size + i] = r
      input[1 * size + i] = g
      input[2 * size + i] = b
    }

    // VAE encoder expects float16
    const inputF16 = float32ArrayToFloat16(input)
    const inputTensor = new ort.Tensor('float16', inputF16, [1, 3, height, width])
    const result = await this.vaeEncoder.run({ sample: inputTensor })
    const latentDist = Object.values(result)[0]
    // Only dispose our own input tensor. latentDist is ORT-owned.
    disposeTensor(inputTensor)

    console.log('[SD] VAE encoder output shape:', latentDist.dims, 'dtype:', latentDist.type)

    // VAE encoder outputs mean (and logvar concatenated in channel dim)
    // latent_dist shape is [1, 8, H/8, W/8] — first 4 channels = mean, last 4 = logvar
    const latentH = height / 8
    const latentW = width / 8
    let latentData = latentDist.data
    // Convert float16 output to float32 if needed
    if (latentDist.type === 'float16') {
      const f32 = new Float32Array(latentData.length)
      const dv = new DataView(latentData.buffer, latentData.byteOffset, latentData.byteLength)
      for (let i = 0; i < latentData.length; i++) {
        const h = dv.getUint16(i * 2, true)
        const sign = (h >> 15) & 1
        const exp = (h >> 10) & 0x1f
        const frac = h & 0x3ff
        if (exp === 0) {
          f32[i] = (sign ? -1 : 1) * (frac / 1024) * Math.pow(2, -14)
        } else if (exp === 31) {
          f32[i] = frac === 0 ? (sign ? -Infinity : Infinity) : NaN
        } else {
          f32[i] = (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024)
        }
      }
      latentData = f32
    }
    const mean = new Float32Array(1 * 4 * latentH * latentW)
    const planeSize = latentH * latentW

    for (let c = 0; c < 4; c++) {
      for (let i = 0; i < planeSize; i++) {
        mean[c * planeSize + i] = latentData[c * planeSize + i]
      }
    }

    // Scale by VAE scaling factor
    for (let i = 0; i < mean.length; i++) {
      mean[i] *= 0.18215
    }

    // latentDist is ORT-owned, do not dispose explicitly.

    return mean
  }

  /**
   * Image-to-image generation
   * @param {string} prompt - Text prompt
   * @param {HTMLImageElement|HTMLCanvasElement} inputImage - Source image
   * @param {object} options - Generation options including strength (0-1)
   */
  async generateImg2Img(prompt, inputImage, options = {}) {
    if (!this.loaded) throw new Error('Pipeline not loaded. Call load() first.')

    const {
      numSteps = 2,
      strength = 0.7,
      width = 512,
      height = 512,
      onStep = null,
    } = options

    const latentHeight = height / 8
    const latentWidth = width / 8
    const latentChannels = 4

    // 1. Encode input image to latent space
    console.log('[SD img2img] Encoding input image...')
    const imageLatents = await this.encodeImage(inputImage, width, height)

    // 2. Get text embeddings (remote CLIP API or local)
    const textEmbeddings = await this.getTextEmbeddings(prompt)

    // 3. Compute timesteps based on strength
    // For img2img, strength controls the noise level / starting timestep
    // strength=1.0 → max noise (like txt2img), strength=0.1 → minimal change
    // We pick a starting timestep proportional to strength, then denoise from there
    const maxTimestep = NUM_TRAIN_TIMESTEPS - 1
    const startTimestep = Math.max(1, Math.round(maxTimestep * strength))

    // Build timestep schedule from startTimestep down to near 0
    const stepSize = Math.max(1, Math.floor(startTimestep / numSteps))
    const timesteps = []
    for (let i = 0; i < numSteps; i++) {
      const t = startTimestep - i * stepSize
      if (t > 0) timesteps.push(t)
    }
    const actualSteps = timesteps.length

    if (actualSteps === 0) {
      // strength too low, just decode the image latents back
      const scaledLatents = new Float32Array(imageLatents.length)
      for (let i = 0; i < imageLatents.length; i++) {
        scaledLatents[i] = imageLatents[i] / 0.18215
      }
      const latentTensor = new ort.Tensor('float32', scaledLatents, [1, latentChannels, latentHeight, latentWidth])
      const decoded = await this.vaeDecoder.run({ latent_sample: latentTensor })
      const decodedTensor = Object.values(decoded)[0]
      const decodedData = decodedTensor.data instanceof Float32Array
        ? new Float32Array(decodedTensor.data)
        : Float32Array.from(decodedTensor.data)
      disposeTensor(latentTensor)
      await this._flushGpuQueue()
      return latentsToImage(decodedData, width, height)
    }

    // 5. Compute sigmas for the schedule
    const sigmas = timesteps.map(t => getSigma(t))
    sigmas.push(0) // denoise to zero

    console.log('[SD img2img] startTimestep:', startTimestep, 'Timesteps:', timesteps, 'Sigmas:', sigmas, 'Strength:', strength)

    // 6. Add noise to image latents based on first sigma (noise schedule)
    const initSigma = sigmas[0]
    const noise = generateLatentNoise(1, latentChannels, latentHeight, latentWidth)
    const latents = new Float32Array(imageLatents.length)
    for (let i = 0; i < latents.length; i++) {
      // latent = image_latent + sigma * noise
      latents[i] = imageLatents[i] + initSigma * noise[i]
    }

    // Precompute hiddenStates ONCE outside the loop (was recreated every step → GPU buffer leak)
    let hiddenStates = textEmbeddings
    let hiddenStatesOwned = false
    if (this.unetFp16 && textEmbeddings.type !== 'float16') {
      hiddenStates = new ort.Tensor('float16', float32ArrayToFloat16(textEmbeddings.data), textEmbeddings.dims)
      hiddenStatesOwned = true
    }

    // 7. Denoising loop (same as txt2img)
    let currentLatents = latents
    for (let step = 0; step < actualSteps; step++) {
      if (onStep) onStep(step, actualSteps)

      const sigma = sigmas[step]
      const sigmaNext = sigmas[step + 1]
      const timestep = timesteps[step]

      const scaleFactor = 1.0 / Math.sqrt(sigma * sigma + 1)
      const scaledLatents = new Float32Array(currentLatents.length)
      for (let i = 0; i < currentLatents.length; i++) {
        scaledLatents[i] = currentLatents[i] * scaleFactor
      }

      const latentTensor = this.unetFp16
        ? new ort.Tensor('float16', float32ArrayToFloat16(scaledLatents), [1, latentChannels, latentHeight, latentWidth])
        : new ort.Tensor('float32', scaledLatents, [1, latentChannels, latentHeight, latentWidth])
      const timestepTensor = new ort.Tensor('int64', new BigInt64Array([BigInt(timestep)]), [1])

      console.log(`[SD img2img] Step ${step + 1}/${actualSteps}: timestep=${timestep}, sigma=${sigma.toFixed(4)}, sigmaNext=${sigmaNext.toFixed(4)}`)

      const unetOutput = await this.unet.run({
        sample: latentTensor,
        timestep: timestepTensor,
        encoder_hidden_states: hiddenStates,
      })
      const rawOutput = Object.values(unetOutput)[0]
      let noisePred
      if (rawOutput.type === 'float16') {
        const firstVal = rawOutput.data[0]
        if (typeof firstVal === 'number' && (firstVal % 1 !== 0 || firstVal === 0)) {
          noisePred = Float32Array.from(rawOutput.data)
        } else {
          noisePred = float16ArrayToFloat32(rawOutput.data)
        }
      } else {
        noisePred = rawOutput.data instanceof Float32Array ? rawOutput.data : new Float32Array(rawOutput.data)
      }

      currentLatents = eulerStep(noisePred, currentLatents, sigma, sigmaNext)

      // Free only inputs we created. Don't dispose rawOutput (ORT-owned).
      disposeTensor(latentTensor)
      disposeTensor(timestepTensor)
    }

    if (hiddenStatesOwned) disposeTensor(hiddenStates)
    // textEmbeddings is ORT-owned (from textEncoder.run); do not dispose.

    // 8. VAE decode
    const finalScaled = new Float32Array(currentLatents.length)
    for (let i = 0; i < currentLatents.length; i++) {
      finalScaled[i] = currentLatents[i] / 0.18215
    }

    const latentTensor = new ort.Tensor('float32', finalScaled, [1, latentChannels, latentHeight, latentWidth])
    const decoded = await this.vaeDecoder.run({ latent_sample: latentTensor })
    const decodedTensor = Object.values(decoded)[0]
    const decodedData = decodedTensor.data instanceof Float32Array
      ? new Float32Array(decodedTensor.data)
      : Float32Array.from(decodedTensor.data)

    // Only dispose the input we created.
    disposeTensor(latentTensor)
    await this._flushGpuQueue()

    console.log('[SD img2img] Done!')
    return latentsToImage(decodedData, width, height)
  }

  async dispose() {
    if (this.textEncoder) await this.textEncoder.release()
    if (this.unet) await this.unet.release()
    if (this.vaeDecoder) await this.vaeDecoder.release()
    if (this.vaeEncoder) await this.vaeEncoder.release()
    this.loaded = false
  }
}

/**
 * Check WebGPU availability and return adapter info
 */
export async function checkWebGPU() {
  if (!navigator.gpu) {
    return { supported: true, webgpu: false, reason: 'WebGPU not available — will use WASM backend (slower)' }
  }

  try {
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      return { supported: true, webgpu: false, reason: 'No WebGPU adapter — will use WASM backend (slower)' }
    }

    const info = await adapter.requestAdapterInfo?.() || {}
    return {
      supported: true,
      webgpu: true,
      adapter: {
        vendor: info.vendor || 'Unknown',
        architecture: info.architecture || 'Unknown',
        device: info.device || 'Unknown',
        description: info.description || 'Unknown',
      }
    }
  } catch (e) {
    return { supported: true, webgpu: false, reason: `WebGPU check failed: ${e.message} — will use WASM backend` }
  }
}

/**
 * Get which execution provider was selected after model load
 */
export function getSelectedProvider() {
  return _selectedProvider || 'not loaded'
}
