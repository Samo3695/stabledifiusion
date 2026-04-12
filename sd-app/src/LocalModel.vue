<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import PhaserCanvas from './components/PhaserCanvas.vue'

const router = useRouter()

// State
const webgpuStatus = ref(null) // null=checking, object with supported + info
const backendProvider = ref('')
const status = ref('Checking WebGPU support...')
const statusType = ref('info') // info, success, error, warning
const prompt = ref('a cute cat astronaut in space, pixel art, isometric')
const negativePrompt = ref('')
const isLoading = ref(false)
const isGenerating = ref(false)
const loadProgress = ref(0)
const loadStage = ref('')
const generatedImage = ref(null)
const modelLoaded = ref(false)
const numSteps = ref(1)
const generationTime = ref(null)
const modelVariant = ref('standard') // 'standard', 'isometric-fp16', 'isometric-quantized'
const useRemoteClip = ref(true) // use remote CLIP API to avoid downloading text encoder (~600MB saved)

// img2img state
const mode = ref('txt2img') // 'txt2img' or 'img2img'
const inputImage = ref(null) // data URL for preview
const inputImageEl = ref(null) // HTMLImageElement for pipeline
const inputImageSize = ref(null) // { width, height } of original image
const strength = ref(0.7)

// Phaser canvas state
const canvasRef = ref(null)
const selectedCell = ref({ row: -1, col: -1 })
const images = ref([]) // generated images gallery
const selectedImageId = ref(null)
const panelCollapsed = ref(false)
const buildingSize = ref(1) // 1=1x1, 2=2x2, 3=3x3, 4=4x4, 5=5x5

// Pipeline instance
let pipeline = null

onMounted(async () => {
  const { checkWebGPU } = await import('./utils/webgpuDiffusion.js')
  const result = await checkWebGPU()
  webgpuStatus.value = result

  if (result.supported) {
    if (result.webgpu) {
      status.value = 'WebGPU available! Load a model to start generating.'
      statusType.value = 'success'
    } else {
      status.value = (result.reason || 'WebGPU not available') + ' — WASM backend will be used instead.'
      statusType.value = 'warning'
    }
  } else {
    status.value = result.reason
    statusType.value = 'error'
  }
})

onUnmounted(async () => {
  if (pipeline) {
    await pipeline.dispose()
    pipeline = null
  }
})

const loadModel = async () => {
  isLoading.value = true
  loadProgress.value = 0
  status.value = 'Downloading model files... This may take a few minutes on first load.'
  statusType.value = 'info'
  loadStage.value = 'Starting...'

  try {
    const { StableDiffusionPipeline, LOCAL_ISOMETRIC_UNET_URL, LOCAL_ISOMETRIC_QUANTIZED_UNET_URL, DEFAULT_CLIP_API_URL } = await import('./utils/webgpuDiffusion.js')
    const pipelineOptions = {}
    if (useRemoteClip.value) {
      pipelineOptions.clipApiUrl = DEFAULT_CLIP_API_URL
    }
    if (modelVariant.value === 'isometric-fp16') {
      pipelineOptions.unetUrl = LOCAL_ISOMETRIC_UNET_URL
      pipelineOptions.unetFp16 = true
    } else if (modelVariant.value === 'isometric-quantized') {
      pipelineOptions.unetUrl = LOCAL_ISOMETRIC_QUANTIZED_UNET_URL
      pipelineOptions.unetFp16 = false // quantized model uses FP32
    }
    pipeline = new StableDiffusionPipeline(pipelineOptions)

    await pipeline.load((progress, stage) => {
      loadProgress.value = progress
      const stageNames = pipeline.clipApiUrl
        ? ['UNet', 'VAE Decoder', 'VAE Encoder']
        : ['Tokenizer', 'Text Encoder', 'UNet', 'VAE Decoder', 'VAE Encoder']
      loadStage.value = stageNames[stage] || `Step ${stage + 1}`
      status.value = `Loading ${loadStage.value}... ${Math.round(progress * 100)}%`
    })

    const { getSelectedProvider } = await import('./utils/webgpuDiffusion.js')
    backendProvider.value = getSelectedProvider()
    modelLoaded.value = true
    const variantNames = { 'standard': 'Standard', 'isometric-fp16': 'Isometric FP16', 'isometric-quantized': 'Isometric INT8' }
    const modelName = variantNames[modelVariant.value] || 'Standard'
    status.value = `${modelName} model loaded (${backendProvider.value.toUpperCase()} backend)! Enter a prompt and click Generate.`
    statusType.value = 'success'
  } catch (e) {
    const msg = e?.message || e?.toString?.() || JSON.stringify(e) || 'Unknown error'
    status.value = `Failed to load model: ${msg}`
    statusType.value = 'error'
    console.error('Model load error:', e)
    console.error('Error stack:', e?.stack)
  } finally {
    isLoading.value = false
  }
}

const generate = async () => {
  if (!pipeline || !prompt.value.trim()) return
  if (mode.value === 'img2img' && !inputImageEl.value) return

  isGenerating.value = true
  generatedImage.value = null
  generationTime.value = null
  status.value = 'Generating image...'
  statusType.value = 'info'

  const startTime = performance.now()

  try {
    let imageDataUrl

    if (mode.value === 'img2img') {
      imageDataUrl = await pipeline.generateImg2Img(prompt.value, inputImageEl.value, {
        numSteps: numSteps.value,
        strength: strength.value,
        width: 512,
        height: 512,
        onStep: (step, total) => {
          status.value = `Denoising step ${step + 1}/${total}...`
        }
      })
      // Resize output to match input image dimensions
      if (inputImageSize.value && (inputImageSize.value.width !== 512 || inputImageSize.value.height !== 512)) {
        imageDataUrl = await resizeDataUrl(imageDataUrl, inputImageSize.value.width, inputImageSize.value.height)
      }
    } else {
      imageDataUrl = await pipeline.generate(prompt.value, {
        numSteps: numSteps.value,
        width: 512,
        height: 512,
        onStep: (step, total) => {
          status.value = `Denoising step ${step + 1}/${total}...`
        }
      })
    }

    generatedImage.value = imageDataUrl
    generationTime.value = ((performance.now() - startTime) / 1000).toFixed(1)
    status.value = `Done! Generated in ${generationTime.value}s`
    statusType.value = 'success'
    // Auto remove black background
    removeBackground()
  } catch (e) {
    status.value = `Generation failed: ${e.message}`
    statusType.value = 'error'
    console.error('Generation error:', e)
  } finally {
    isGenerating.value = false
  }
}

const handleImageUpload = (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  loadInputImage(file)
}

const handleDrop = (event) => {
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (!file || !file.type.startsWith('image/')) return
  loadInputImage(file)
}

const handleDragOver = (event) => {
  event.preventDefault()
}

const loadInputImage = (file) => {
  const reader = new FileReader()
  reader.onload = (e) => {
    inputImage.value = e.target.result
    const img = new Image()
    img.onload = () => {
      inputImageEl.value = img
      inputImageSize.value = { width: img.naturalWidth, height: img.naturalHeight }
    }
    img.src = e.target.result
  }
  reader.readAsDataURL(file)
}

const clearInputImage = () => {
  inputImage.value = null
  inputImageEl.value = null
  inputImageSize.value = null
}

const resizeDataUrl = (dataUrl, targetWidth, targetHeight) => {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = targetWidth
      canvas.height = targetHeight
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
      resolve(canvas.toDataURL('image/png'))
    }
    img.src = dataUrl
  })
}

const removeBackground = () => {
  if (!generatedImage.value) return
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] <= 10 && data[i + 1] <= 10 && data[i + 2] <= 10) {
        data[i + 3] = 0
      }
    }
    ctx.putImageData(imageData, 0, 0)
    generatedImage.value = canvas.toDataURL('image/png')
  }
  img.src = generatedImage.value
}

const downloadImage = () => {
  if (!generatedImage.value) return
  const link = document.createElement('a')
  link.download = `sd-webgpu-${Date.now()}.png`
  link.href = generatedImage.value
  link.click()
}

const handleCellSelected = ({ row, col }) => {
  selectedCell.value = { row, col }
}

const handleImagePlaced = ({ row, col }) => {
  console.log(`Image placed at [${row}, ${col}]`)
}

const placeOnGrid = () => {
  if (!generatedImage.value || !canvasRef.value || selectedCell.value.row === -1) return
  canvasRef.value.placeImageAtSelectedCell(generatedImage.value, buildingSize.value, buildingSize.value, false)
}

const addToGallery = () => {
  if (!generatedImage.value) return
  const id = `gen-${Date.now()}`
  images.value.push({
    id,
    url: generatedImage.value,
    prompt: prompt.value,
    date: new Date(),
    cellsX: buildingSize.value,
    cellsY: buildingSize.value
  })
  selectedImageId.value = id
}

const selectGalleryImage = (id) => {
  selectedImageId.value = selectedImageId.value === id ? null : id
}

const placeGalleryImage = (image) => {
  if (!canvasRef.value || selectedCell.value.row === -1) return
  canvasRef.value.placeImageAtSelectedCell(image.url, image.cellsX || 1, image.cellsY || 1, false)
}

const deleteGalleryImage = (id) => {
  images.value = images.value.filter(img => img.id !== id)
  if (selectedImageId.value === id) selectedImageId.value = null
}

const goHome = () => router.push('/')

const clearCache = async () => {
  try {
    const dbs = await indexedDB.databases()
    for (const db of dbs) {
      if (db.name && db.name.includes('webgpu-sd')) {
        indexedDB.deleteDatabase(db.name)
      }
    }
    status.value = 'Model cache cleared. You can reload the model now.'
    statusType.value = 'info'
  } catch (e) {
    status.value = 'Failed to clear cache: ' + (e.message || e)
    statusType.value = 'error'
  }
}
</script>

<template>
  <div class="local-model-page">
    <!-- Full Phaser Canvas Background -->
    <PhaserCanvas
      ref="canvasRef"
      :images="[]"
      selectedImageId="local-placer"
      :lastImageCellsX="buildingSize"
      :lastImageCellsY="buildingSize"
      :showNumbering="false"
      :showGallery="false"
      :showGrid="true"
      :deleteMode="false"
      :roadBuildingMode="false"
      :roadDeleteMode="false"
      :recycleMode="false"
      :showPerson="false"
      :isFullscreen="false"
      @cell-selected="handleCellSelected"
      @image-placed="handleImagePlaced"
    />

    <!-- Floating Control Panel -->
    <div class="control-panel" :class="{ collapsed: panelCollapsed }">
      <div class="panel-toggle" @click="panelCollapsed = !panelCollapsed">
        <span v-if="panelCollapsed">&#9654;</span>
        <span v-else>&#9664;</span>
      </div>

      <div class="panel-content" v-show="!panelCollapsed">
        <!-- Header -->
        <div class="header">
          <button class="back-btn" @click="goHome" title="Back to Home">&larr;</button>
          <h1>Local Model <span class="badge">WebGPU</span></h1>
        </div>

        <!-- WebGPU Status -->
        <div class="status-bar" :class="statusType">
          <span class="status-icon">
            <template v-if="statusType === 'success'">&#10003;</template>
            <template v-else-if="statusType === 'error'">&#10007;</template>
            <template v-else-if="statusType === 'warning'">&#9888;</template>
            <template v-else>&#8987;</template>
          </span>
          {{ status }}
        </div>

        <!-- GPU Info -->
        <div v-if="webgpuStatus?.supported && webgpuStatus.adapter" class="gpu-info">
          <span><strong>GPU:</strong> {{ webgpuStatus.adapter.vendor }} {{ webgpuStatus.adapter.description }}</span>
        </div>

        <!-- Load Model -->
        <div v-if="!modelLoaded" class="load-section">
          <div class="model-info">
            <h3>SD Turbo (ONNX WebGPU)</h3>
            <p>Single-step Stable Diffusion model optimized for browser inference.</p>
            <p class="note">First load downloads {{ useRemoteClip ? '~1.4 GB' : '~2 GB' }} of model files. Subsequent loads use cached data.{{ useRemoteClip ? ' Text encoder runs on remote server.' : '' }}</p>
            <!-- Model variant selector -->
            <div class="model-variant-toggle">
              <label class="variant-radio">
                <input type="radio" value="standard" v-model="modelVariant" :disabled="isLoading" />
                <span class="variant-text">Standard</span>
                <span class="variant-hint">(original SD Turbo)</span>
              </label>
              <label class="variant-radio">
                <input type="radio" value="isometric-fp16" v-model="modelVariant" :disabled="isLoading" />
                <span class="variant-text">Isometric FP16</span>
                <span class="variant-hint">(merged LoRA, ~1.65 GB UNet)</span>
              </label>
              <label class="variant-radio">
                <input type="radio" value="isometric-quantized" v-model="modelVariant" :disabled="isLoading" />
                <span class="variant-text">Isometric INT8</span>
                <span class="variant-hint">(quantized, ~0.83 GB UNet)</span>
              </label>
            </div>
            <!-- Remote CLIP toggle -->
            <div class="clip-toggle">
              <label class="variant-radio">
                <input type="checkbox" v-model="useRemoteClip" :disabled="isLoading" />
                <span class="variant-text">Remote Text Encoder</span>
                <span class="variant-hint">(saves ~600 MB download, uses server API)</span>
              </label>
            </div>
            <button class="action-btn secondary clear-cache-btn" @click="clearCache">Clear Model Cache</button>
          </div>

          <button
            class="action-btn load-btn"
            @click="loadModel"
            :disabled="isLoading"
          >
            {{ isLoading ? 'Loading...' : 'Load Model' }}
          </button>

          <div v-if="isLoading" class="progress-container">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: (loadProgress * 100) + '%' }"></div>
            </div>
            <span class="progress-text">{{ loadStage }} &mdash; {{ Math.round(loadProgress * 100) }}%</span>
          </div>
        </div>

        <!-- Generate Section -->
        <div v-else class="generate-section">
          <!-- Mode Toggle -->
          <div class="mode-toggle">
            <button
              :class="['mode-btn', { active: mode === 'txt2img' }]"
              @click="mode = 'txt2img'"
              :disabled="isGenerating"
            >Text to Image</button>
            <button
              :class="['mode-btn', { active: mode === 'img2img' }]"
              @click="mode = 'img2img'"
              :disabled="isGenerating"
            >Image to Image</button>
          </div>

          <!-- Image Upload (img2img only) -->
          <div v-if="mode === 'img2img'" class="input-group">
            <label>Input Image</label>
            <div
              v-if="!inputImage"
              class="drop-zone"
              @drop="handleDrop"
              @dragover="handleDragOver"
              @click="$refs.fileInput.click()"
            >
              <span class="drop-icon">&#128247;</span>
              <p>Drop an image here or click to upload</p>
              <p class="note">Will be resized to 512 &times; 512</p>
            </div>
            <div v-else class="image-preview-container">
              <img :src="inputImage" alt="Input image" class="image-preview" />
              <button class="remove-image-btn" @click="clearInputImage" title="Remove image">&times;</button>
            </div>
            <input
              ref="fileInput"
              type="file"
              accept="image/*"
              style="display: none;"
              @change="handleImageUpload"
            />
          </div>

          <div class="input-group">
            <label>Prompt</label>
            <textarea
              v-model="prompt"
              rows="3"
              placeholder="Describe the image you want to generate..."
              :disabled="isGenerating"
            ></textarea>
          </div>

          <div class="settings-row">
            <div class="setting">
              <label>Steps</label>
              <select v-model.number="numSteps" :disabled="isGenerating">
                <option :value="1">1 (Fastest)</option>
                <option :value="2">2</option>
                <option :value="4">4 (Best Quality)</option>
              </select>
            </div>
            <div v-if="mode === 'img2img'" class="setting">
              <label>Strength: {{ strength.toFixed(2) }}</label>
              <input
                type="range"
                v-model.number="strength"
                min="0.1"
                max="1.0"
                step="0.05"
                :disabled="isGenerating"
                class="strength-slider"
              />
            </div>
            <div class="setting">
              <label>Size</label>
              <span class="fixed-value" v-if="mode === 'img2img' && inputImageSize">
                {{ inputImageSize.width }} &times; {{ inputImageSize.height }}
              </span>
              <span class="fixed-value" v-else>512 &times; 512</span>
            </div>
          </div>

          <button
            class="action-btn generate-btn"
            @click="generate"
            :disabled="isGenerating || !prompt.trim() || (mode === 'img2img' && !inputImage)"
          >
            {{ isGenerating ? 'Generating...' : 'Generate' }}
          </button>
        </div>

        <!-- Result -->
        <div v-if="generatedImage" class="result-section">
          <div class="image-container">
            <img :src="generatedImage" alt="Generated image" />
          </div>
          <div class="result-actions">
            <button class="action-btn secondary" @click="downloadImage">Download</button>
            <button class="action-btn remove-bg-btn" @click="removeBackground">Remove Black BG</button>
            <button class="action-btn add-gallery-btn" @click="addToGallery">Add to Gallery</button>
            <button
              class="action-btn place-btn"
              @click="placeOnGrid"
              :disabled="selectedCell.row === -1"
              :title="selectedCell.row !== -1 ? `Place at cell [${selectedCell.row}, ${selectedCell.col}]` : 'Click a cell on the canvas first'"
            >Place on Canvas</button>
            <span v-if="generationTime" class="gen-time">{{ generationTime }}s</span>
          </div>
          <!-- Building size selector -->
          <div class="size-selector">
            <label>Building Size</label>
            <div class="size-options">
              <button v-for="s in [1,2,3,4,5]" :key="s" :class="['size-btn', { active: buildingSize === s }]" @click="buildingSize = s">{{ s }}&times;{{ s }}</button>
            </div>
          </div>
        </div>

        <!-- Placeholder when generating -->
        <div v-else-if="isGenerating" class="result-placeholder">
          <div class="spinner"></div>
          <p>Running inference on GPU...</p>
        </div>

        <!-- Generated Images Gallery -->
        <div v-if="images.length > 0" class="gallery-section">
          <h3>Generated Images</h3>
          <div class="gallery-grid">
            <div
              v-for="img in images"
              :key="img.id"
              class="gallery-item"
              :class="{ selected: selectedImageId === img.id }"
              @click="selectGalleryImage(img.id)"
            >
              <img :src="img.url" :alt="img.prompt" />
              <div class="gallery-item-actions">
                <button class="gallery-place-btn" @click.stop="placeGalleryImage(img)" :disabled="selectedCell.row === -1" title="Place on canvas">&#10010;</button>
                <button class="gallery-delete-btn" @click.stop="deleteGalleryImage(img.id)" title="Delete">&#10005;</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Selected cell info -->
        <div class="cell-info">
          <span v-if="selectedCell.row !== -1" class="selected-cell-label">
            Selected cell: [{{ selectedCell.row }}, {{ selectedCell.col }}]
          </span>
          <span v-else class="selected-cell-label dim">Click a cell on the canvas to select</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.local-model-page {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

/* Floating control panel on the right */
.control-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 380px;
  height: 100vh;
  background: rgba(15, 12, 41, 0.92);
  backdrop-filter: blur(12px);
  border-left: 1px solid rgba(255,255,255,0.1);
  z-index: 100;
  display: flex;
  transition: width 0.3s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.control-panel.collapsed {
  width: 32px;
}

.panel-toggle {
  width: 32px;
  min-width: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: rgba(255,255,255,0.5);
  font-size: 0.9rem;
  background: rgba(255,255,255,0.05);
  border-right: 1px solid rgba(255,255,255,0.08);
  transition: background 0.2s;
}
.panel-toggle:hover {
  background: rgba(255,255,255,0.1);
  color: #fff;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.2rem;
  color: #e0e0e0;
}

.panel-content::-webkit-scrollbar {
  width: 5px;
}
.panel-content::-webkit-scrollbar-track {
  background: transparent;
}
.panel-content::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.15);
  border-radius: 3px;
}

.header {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin-bottom: 0.8rem;
}

.header h1 {
  margin: 0;
  font-size: 1.3rem;
  color: #fff;
}

.badge {
  font-size: 0.6rem;
  background: linear-gradient(135deg, #76b852, #3aafa9);
  color: #fff;
  padding: 2px 8px;
  border-radius: 10px;
  vertical-align: middle;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.back-btn {
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.2);
  color: #fff;
  font-size: 1.2rem;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}
.back-btn:hover {
  background: rgba(255,255,255,0.2);
}

/* Status bar */
.status-bar {
  padding: 0.5rem 0.8rem;
  border-radius: 6px;
  margin-bottom: 0.8rem;
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.status-bar.info { background: rgba(33,150,243,0.15); border: 1px solid rgba(33,150,243,0.3); }
.status-bar.success { background: rgba(76,175,80,0.15); border: 1px solid rgba(76,175,80,0.3); }
.status-bar.error { background: rgba(244,67,54,0.15); border: 1px solid rgba(244,67,54,0.3); color: #ef9a9a; }
.status-bar.warning { background: rgba(255,152,0,0.15); border: 1px solid rgba(255,152,0,0.3); }

.status-icon {
  font-size: 1rem;
}

.gpu-info {
  font-size: 0.75rem;
  color: rgba(255,255,255,0.5);
  margin-bottom: 0.8rem;
  padding: 0.3rem 0.6rem;
  background: rgba(255,255,255,0.05);
  border-radius: 5px;
}

/* Load section */
.load-section {
  margin-bottom: 1rem;
}

.model-info h3 {
  margin: 0 0 0.3rem;
  color: #fff;
  font-size: 1rem;
}
.model-info p {
  margin: 0 0 0.2rem;
  color: rgba(255,255,255,0.6);
  font-size: 0.8rem;
}
.model-info .note {
  color: rgba(255,193,7,0.8);
  font-size: 0.75rem;
}

.model-variant-toggle {
  margin: 0.5rem 0;
  padding: 0.4rem 0.6rem;
  background: rgba(255,255,255,0.05);
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.1);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.variant-radio {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0.2rem 0;
}

.variant-radio input[type="radio"] {
  accent-color: #76b852;
  width: 14px;
  height: 14px;
}

.variant-text {
  color: #fff;
  font-weight: 600;
}

.variant-hint {
  color: rgba(255,255,255,0.4);
  font-size: 0.7rem;
}

.clip-toggle {
  margin: 0.3rem 0;
  padding: 0.3rem 0.6rem;
  background: rgba(118, 184, 82, 0.08);
  border-radius: 6px;
  border: 1px solid rgba(118, 184, 82, 0.2);
}

.clip-toggle input[type="checkbox"] {
  accent-color: #76b852;
  width: 14px;
  height: 14px;
}

/* Action buttons */
.action-btn {
  padding: 0.5rem 1.2rem;
  border: none;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 0.6rem;
}

.load-btn {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
}
.load-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(102,126,234,0.4);
}

.generate-btn {
  background: linear-gradient(135deg, #4caf50, #2e7d32);
  color: #fff;
  width: 100%;
  padding: 0.7rem;
  font-size: 0.95rem;
}
.generate-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(76,175,80,0.4);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.action-btn.secondary {
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.2);
  color: #fff;
}
.action-btn.secondary:hover {
  background: rgba(255,255,255,0.2);
}

/* Progress */
.progress-container {
  margin-top: 0.6rem;
}

.progress-bar {
  width: 100%;
  height: 6px;
  background: rgba(255,255,255,0.1);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea, #764ba2);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 0.75rem;
  color: rgba(255,255,255,0.5);
  margin-top: 0.2rem;
  display: block;
}

/* Generate section */
.generate-section {
  margin-bottom: 1rem;
}

.input-group {
  margin-bottom: 0.8rem;
}

.input-group label {
  display: block;
  font-size: 0.8rem;
  color: rgba(255,255,255,0.7);
  margin-bottom: 0.2rem;
  font-weight: 600;
}

.input-group textarea {
  width: 100%;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 6px;
  color: #fff;
  padding: 0.5rem;
  font-size: 0.85rem;
  font-family: inherit;
  resize: vertical;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}
.input-group textarea:focus {
  border-color: rgba(102,126,234,0.6);
}

.settings-row {
  display: flex;
  gap: 0.8rem;
  margin-bottom: 0.8rem;
}

.setting {
  flex: 1;
}

.setting label {
  display: block;
  font-size: 0.75rem;
  color: rgba(255,255,255,0.6);
  margin-bottom: 0.2rem;
}

.setting select {
  width: 100%;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 5px;
  color: #fff;
  padding: 0.4rem;
  font-size: 0.8rem;
  outline: none;
}

.fixed-value {
  display: block;
  padding: 0.4rem;
  color: rgba(255,255,255,0.5);
  font-size: 0.8rem;
}

/* Result */
.result-section {
  margin-top: 1rem;
}

.image-container {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(0,0,0,0.3);
}

.image-container img {
  width: 100%;
  display: block;
}

.result-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}

.gen-time {
  font-size: 0.8rem;
  color: rgba(255,255,255,0.4);
}

/* Placeholder spinner */
.result-placeholder {
  text-align: center;
  padding: 2rem 0;
  color: rgba(255,255,255,0.5);
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255,255,255,0.1);
  border-top: 3px solid #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 0.8rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Mode toggle */
.mode-toggle {
  display: flex;
  gap: 0;
  margin-bottom: 0.8rem;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.15);
}

.mode-btn {
  flex: 1;
  padding: 0.5rem 0.8rem;
  background: rgba(255,255,255,0.05);
  border: none;
  color: rgba(255,255,255,0.5);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-btn.active {
  background: rgba(102,126,234,0.3);
  color: #fff;
}

.mode-btn:hover:not(.active):not(:disabled) {
  background: rgba(255,255,255,0.1);
}

.mode-btn:disabled {
  cursor: not-allowed;
}

/* Drop zone */
.drop-zone {
  border: 2px dashed rgba(255,255,255,0.2);
  border-radius: 8px;
  padding: 1.2rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  color: rgba(255,255,255,0.5);
}

.drop-zone:hover {
  border-color: rgba(102,126,234,0.5);
  background: rgba(102,126,234,0.05);
}

.drop-icon {
  font-size: 1.5rem;
  display: block;
  margin-bottom: 0.3rem;
}

.drop-zone p {
  margin: 0.1rem 0;
  font-size: 0.8rem;
}

.drop-zone .note {
  font-size: 0.7rem;
  color: rgba(255,255,255,0.3);
}

/* Image preview */
.image-preview-container {
  position: relative;
  display: inline-block;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.15);
}

.image-preview {
  max-width: 100%;
  max-height: 150px;
  display: block;
}

.remove-image-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: rgba(0,0,0,0.7);
  color: #fff;
  font-size: 1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  transition: background 0.2s;
}

.remove-image-btn:hover {
  background: rgba(244,67,54,0.8);
}

/* Place on canvas button */
.place-btn {
  background: linear-gradient(135deg, #ff9800, #f57c00) !important;
  border: none !important;
  color: #fff !important;
}
.place-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(255,152,0,0.4);
}
.place-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Add to gallery button */
.add-gallery-btn {
  background: linear-gradient(135deg, #2196f3, #1565c0) !important;
  border: none !important;
  color: #fff !important;
}
.add-gallery-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(33,150,243,0.4);
}

/* Remove BG button */
.remove-bg-btn {
  background: linear-gradient(135deg, #e91e63, #9c27b0) !important;
  border: none !important;
  color: #fff !important;
}
.remove-bg-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(233,30,99,0.4);
}

/* Gallery section */
.gallery-section {
  margin-top: 1rem;
  padding-top: 0.8rem;
  border-top: 1px solid rgba(255,255,255,0.1);
}

.gallery-section h3 {
  margin: 0 0 0.5rem;
  font-size: 0.9rem;
  color: rgba(255,255,255,0.8);
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.gallery-item {
  position: relative;
  border-radius: 6px;
  overflow: hidden;
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.2s;
  aspect-ratio: 1;
}

.gallery-item:hover {
  border-color: rgba(255,255,255,0.3);
}

.gallery-item.selected {
  border-color: #667eea;
}

.gallery-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.gallery-item-actions {
  position: absolute;
  top: 3px;
  right: 3px;
  display: flex;
  gap: 3px;
  opacity: 0;
  transition: opacity 0.2s;
}

.gallery-item:hover .gallery-item-actions {
  opacity: 1;
}

.gallery-place-btn,
.gallery-delete-btn {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  color: #fff;
  transition: background 0.2s;
}

.gallery-place-btn {
  background: rgba(76,175,80,0.8);
}
.gallery-place-btn:hover:not(:disabled) {
  background: rgba(76,175,80,1);
}
.gallery-place-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.gallery-delete-btn {
  background: rgba(244,67,54,0.8);
}
.gallery-delete-btn:hover {
  background: rgba(244,67,54,1);
}

/* Cell info */
.cell-info {
  margin-top: 0.8rem;
  padding-top: 0.6rem;
  border-top: 1px solid rgba(255,255,255,0.08);
}

/* Size selector */
.size-selector {
  margin-top: 0.6rem;
}

.size-selector label {
  display: block;
  font-size: 0.8rem;
  color: rgba(255,255,255,0.7);
  margin-bottom: 0.3rem;
  font-weight: 600;
}

.size-options {
  display: flex;
  gap: 4px;
}

.size-btn {
  flex: 1;
  padding: 0.4rem 0;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 5px;
  color: rgba(255,255,255,0.5);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.size-btn:hover {
  background: rgba(255,255,255,0.12);
  color: rgba(255,255,255,0.8);
}

.size-btn.active {
  background: rgba(255,152,0,0.3);
  border-color: rgba(255,152,0,0.6);
  color: #ffcc80;
}

.selected-cell-label {
  font-size: 0.8rem;
  color: #66aaff;
  font-weight: 600;
}
.selected-cell-label.dim {
  color: rgba(255,255,255,0.3);
  font-weight: 400;
}

/* Strength slider */
.strength-slider {
  width: 100%;
  -webkit-appearance: none;
  appearance: none;
  height: 5px;
  border-radius: 3px;
  background: rgba(255,255,255,0.15);
  outline: none;
  margin-top: 0.3rem;
}

.strength-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
}

.strength-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
  border: none;
}
</style>
