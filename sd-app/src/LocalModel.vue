<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import PhaserCanvas from './components/PhaserCanvas.vue'
import BuildingSelector from './components/BuildingSelector.vue'
import Modal from './components/Modal.vue'
import { loadProject } from './utils/projectLoader.js'
import { buildRoad } from './utils/roadBuilder.js'

const BASE_URL = import.meta.env.BASE_URL

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
const strength = ref(0.85)

// Phaser canvas state
const canvasRef = ref(null)
const selectedCell = ref({ row: -1, col: -1 })
const images = ref([]) // generated images gallery
const selectedImageId = ref(null)
const panelCollapsed = ref(false)
const buildingSize = ref(1) // 1=1x1, 2=2x2, 3=3x3, 4=4x4, 5=5x5
const genWidth = ref(512)
const genHeight = ref(512)

// Project loading state
const isProjectLoading = ref(false)
const projectLoadProgress = ref(0)
const projectLoadStatus = ref('')

// Left panel - buildings & tools
const leftPanelCollapsed = ref(false)
const projectImages = ref([]) // all images from loaded project
const selectedBuildingId = ref(null)
const roadBuildingMode = ref(false)
const roadDeleteMode = ref(false)
const deleteMode = ref(false)
const recycleMode = ref(false)
const roadTiles = ref([])

// === STAVANIE NOVEJ ŠTVRTE (New District Building) ===
// Flow: 1) User picks generator type+size (e.g. House 2x2)
//       2) Enters buildingPlacementMode → draws NxN path on canvas (orange)
//       3) After path drawn → right panel auto-fills (img2img + template + prompt)
//       4) User clicks Generate in right panel
//       5) User clicks "Place on N tiles" → building placed on every path tile
const expandedGenerator = ref(null) // null, 'house', 'shop', 'factory'
const selectedGeneratorSize = ref(null) // { type, size }
const buildingPlacementMode = ref(false)
const buildingPath = ref([]) // path drawn on canvas for building placement

// House categories with price levels
const houseCategories = {
  'family-house': {
    label: 'Family House',
    size: 1,
    strength: 0.85,
    prompt: 'isometric, two-story family house, complete building with roof, closed top, exterior view',
    prices: [
      { price: 100000, label: '$100k', template: '0x1', extra: 'simple' },
      { price: 150000, label: '$150k', template: '0x2', extra: 'simple' },
      { price: 200000, label: '$200k', template: '0x3', extra: 'simple' },
      { price: 250000, label: '$250k', template: '0x2', extra: 'middle class' },
      { price: 300000, label: '$300k', template: '0x3', extra: 'middle class' },
      { price: 500000, label: '$500k', template: '0x3', extra: 'deluxe' },
    ]
  },
  'apartment': {
    label: 'Apartment',
    size: 1,
    strength: 0.85,
    prompt: 'isometric, apartment building, visible rooftop, closed building, exterior view from above',
    prices: [
      { price: 400000, label: '$400k', template: '4x1', extra: 'two-story simple' },
      { price: 500000, label: '$500k', template: '4x2-2', extra: 'four-story simple' },
      { price: 600000, label: '$600k', template: '4x2-1', extra: 'four-story simple' },
      { price: 700000, label: '$700k', template: '1', extra: 'four-story simple' },
      { price: 800000, label: '$800k', template: '4x2-1', extra: 'four-story middle class' },
      { price: 1000000, label: '$1M', template: '1', extra: 'four-story middle class' },
      { price: 1500000, label: '$1.5M', template: '1', extra: 'four-story deluxe' },
    ]
  },
  'residential': {
    label: 'Residential',
    size: 2,
    strength: 0.80,
    prompt: 'isometric, residential building, complete rooftop, sealed top, bird eye isometric view',
    prices: [
      { price: 5000000, label: '$5M', template: '4x1', extra: '4-story building simple' },
      { price: 7000000, label: '$7M', template: '4x2-2', extra: '10-story building simple' },
      { price: 8000000, label: '$8M', template: '4x2-1', extra: '10-story building simple' },
      { price: 10000000, label: '$10M', template: '4x2-2', extra: '10-story building simple glass building' },
      { price: 12000000, label: '$12M', template: '4x2-1', extra: '10-story building middle class glass building garden' },

    ]
  }
}

// Shop categories with price levels
const shopCategories = {
  'small-shop': {
    label: 'Small Shop',
    size: 1,
    strength: 0.85,
    prompt: 'isometric, residential building',
    prices: [
      { price: 500000, label: '$500k', template: '0x2', extra: '2-story building simple small cheap restaurant' },
      { price: 700000, label: '$700k', template: '4x1', extra: '2-story building simple small cheap market' },
      { price: 1000000, label: '$1M', template: '4x2-2', extra: '3-story building offices' },
      { price: 1500000, label: '$1.5M', template: '4x2-1', extra: '3-story building department store' },
      { price: 2500000, label: '$2.5M', template: '1', extra: '3-story building offices and markets' },
      { price: 4000000, label: '$4M', template: '4x3-2', extra: '4-story building price expensive deluxe bank' },
    ]
  },
  'medium-shop': {
    label: 'Medium Shop',
    size: 2,
    strength: 0.85,
    prompt: 'isometric, residential building',
    prices: [
      { price: 3000000, label: '$3M', template: '0x1', extra: '4-story building hypermarket parking' },
      { price: 3000000, label: '$3M', template: '0x2', extra: '4-story building hypermarket parking' },
      { price: 5000000, label: '$5M', template: '4x1', extra: '4-story building hypermarket parking' },
      { price: 7500000, label: '$7.5M', template: '4x3-2', extra: '10-story building offices bank' },
      { price: 10000000, label: '$10M', template: '4x3-1', extra: '10-story building office bank' },
    ]
  },
}

// Factory categories with price levels
const factoryCategories = {
  'small-factory': {
    label: 'Small Factory',
    size: 1,
    strength: 0.85,
    prompt: 'isometric, industrial factory building',
    prices: [
      { price: 500000, label: '$500k', template: '0x2', extra: '2-story building simple small cheap workshop' },
      { price: 700000, label: '$700k', template: '4x1', extra: '2-story building simple small cheap warehouse' },
      { price: 1000000, label: '$1M', template: '4x2-2', extra: '3-story building factory workshop' },
      { price: 1500000, label: '$1.5M', template: '4x2-1', extra: '3-story building manufacturing plant' },
      { price: 2500000, label: '$2.5M', template: '1', extra: '3-story building factory and warehouse' },
      { price: 4000000, label: '$4M', template: '4x3-2', extra: '4-story building expensive industrial complex' },
    ]
  },
  'medium-factory': {
    label: 'Medium Factory',
    size: 2,
    strength: 0.85,
    prompt: 'isometric, industrial factory building',
    prices: [
      { price: 3000000, label: '$3M', template: '0x1', extra: '4-story building factory warehouse parking' },
      { price: 3000000, label: '$3M', template: '0x2', extra: '4-story building factory warehouse parking' },
      { price: 5000000, label: '$5M', template: '4x1', extra: '4-story building manufacturing plant parking' },
      { price: 7500000, label: '$7.5M', template: '4x3-2', extra: '10-story building heavy industrial complex' },
      { price: 10000000, label: '$10M', template: '4x3-1', extra: '10-story building industrial complex' },
    ]
  },
}

// Legacy building configs for shop & factory
const buildingConfigs = {
  shop: {
    1: { templates: ['0x1', '0x2', '0x3'], prompt: 'isometric, small corner shop, complete building with roof, closed top, exterior view' },
    2: { templates: ['1', '4x2-1', '4x2-2'], prompt: 'isometric, shopping center, complete building with roof, closed top, exterior view' },
    3: { templates: ['4x3-1', '4x3-2', '4x3-3'], prompt: 'isometric, large shopping mall, complete rooftop, sealed top, exterior view from above' },
    4: { templates: ['4x3-1', '4x3-2', '4x3-3'], prompt: 'isometric, mega shopping complex, complete rooftop, sealed top, exterior view from above' },
    5: { templates: ['4x3-1', '4x3-2', '4x3-3'], prompt: 'isometric, giant commercial plaza, complete rooftop, sealed top, bird eye isometric view' },
  },
  factory: {
    1: { templates: ['0x1', '0x2', '0x3'], prompt: 'isometric, small workshop factory, complete building with roof, closed top, exterior view' },
    2: { templates: ['1', '4x2-1', '4x2-2'], prompt: 'isometric, industrial factory building, complete building with roof, closed top, exterior view' },
    3: { templates: ['4x3-1', '4x3-2', '4x3-3'], prompt: 'isometric, large manufacturing plant, complete rooftop, sealed top, exterior view from above' },
    4: { templates: ['4x3-1', '4x3-2', '4x3-3'], prompt: 'isometric, heavy industrial complex, complete rooftop, sealed top, exterior view from above' },
    5: { templates: ['4x3-1', '4x3-2', '4x3-3'], prompt: 'isometric, mega industrial zone, complete rooftop, sealed top, bird eye isometric view' },
  }
}

// Generator modal state
const showGeneratorModal = ref(false)
const generatorModalType = ref(null) // 'house', 'shop', 'factory'
const generatorModalSize = ref(1)
const generatorTemplates = ref([]) // [{name, url}]
const selectedTemplateIndex = ref(0)
const generatorPrompt = ref('')
const generatorIsGenerating = ref(false)
const generatorResult = ref(null) // data URL of generated image
const generatorStatus = ref('')
const tempBuildingSpriteUrl = ref(null)

// Right-panel template picker (shown after building path drawn)
const activeTemplates = ref([]) // [{name, url}]
const activeTemplateIndex = ref(0)

// Price-based generator state
const selectedCategory = ref(null) // 'family-house', 'apartment', 'residential'
const activePriceLevels = ref([]) // price levels array for current category
const selectedPriceIndex = ref(0) // index into activePriceLevels
const activeCategoryConfig = ref(null) // current houseCategories entry

const toggleGenerator = (type) => {
  expandedGenerator.value = expandedGenerator.value === type ? null : type
}

const selectGeneratorSize = (type, size) => {
  selectedGeneratorSize.value = { type, size }
  selectedCategory.value = null
  // Enter building placement draw mode instead of opening modal immediately
  buildingPlacementMode.value = true
  roadBuildingMode.value = false
  roadDeleteMode.value = false
  deleteMode.value = false
  recycleMode.value = false
  selectedBuildingId.value = null
  selectedImageId.value = null
}

const selectHouseCategory = (catKey) => {
  const cat = houseCategories[catKey]
  if (!cat) return
  selectedCategory.value = catKey
  selectedGeneratorSize.value = { type: 'house', size: cat.size, category: catKey }
  // Enter building placement draw mode
  buildingPlacementMode.value = true
  roadBuildingMode.value = false
  roadDeleteMode.value = false
  deleteMode.value = false
  recycleMode.value = false
  selectedBuildingId.value = null
  selectedImageId.value = null
}

const selectShopCategory = (catKey) => {
  const cat = shopCategories[catKey]
  if (!cat) return
  selectedCategory.value = catKey
  selectedGeneratorSize.value = { type: 'shop', size: cat.size, category: catKey }
  // Enter building placement draw mode
  buildingPlacementMode.value = true
  roadBuildingMode.value = false
  roadDeleteMode.value = false
  deleteMode.value = false
  recycleMode.value = false
  selectedBuildingId.value = null
  selectedImageId.value = null
}

const selectFactoryCategory = (catKey) => {
  const cat = factoryCategories[catKey]
  if (!cat) return
  selectedCategory.value = catKey
  selectedGeneratorSize.value = { type: 'factory', size: cat.size, category: catKey }
  // Enter building placement draw mode
  buildingPlacementMode.value = true
  roadBuildingMode.value = false
  roadDeleteMode.value = false
  deleteMode.value = false
  recycleMode.value = false
  selectedBuildingId.value = null
  selectedImageId.value = null
}

const openGeneratorModal = (type, size) => {
  generatorModalType.value = type
  generatorModalSize.value = size
  generatorResult.value = null
  generatorStatus.value = ''
  generatorIsGenerating.value = false

  const config = buildingConfigs[type]?.[size]
  if (config) {
    generatorPrompt.value = config.prompt
    generatorTemplates.value = config.templates.map(name => ({
      name,
      url: BASE_URL + 'templates/buildings/' + name + '.png'
    }))
    selectedTemplateIndex.value = 0
  }
  showGeneratorModal.value = true
}

const closeGeneratorModal = () => {
  showGeneratorModal.value = false
  generatorResult.value = null
}

const generateBuilding = async () => {
  if (!pipeline) {
    generatorStatus.value = 'Model not loaded. Load a model first from the right panel.'
    return
  }
  const template = generatorTemplates.value[selectedTemplateIndex.value]
  if (!template) return

  generatorIsGenerating.value = true
  generatorResult.value = null
  generatorStatus.value = 'Generating...'

  try {
    // Load template image as HTMLImageElement for img2img
    const templateImg = await new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Failed to load template image'))
      img.src = template.url
    })

    // Use template image dimensions for generation
    const genW = templateImg.naturalWidth || 512
    const genH = templateImg.naturalHeight || 512

    const imageDataUrl = await pipeline.generateImg2Img(generatorPrompt.value, templateImg, {
      numSteps: numSteps.value,
      strength: 0.7,
      width: genW,
      height: genH,
      onStep: (step, total) => {
        generatorStatus.value = `Denoising step ${step + 1}/${total}...`
      }
    })

    // Remove black background
    const cleanedUrl = await removeBgFromDataUrl(imageDataUrl)
    generatorResult.value = cleanedUrl
    generatorStatus.value = 'Done! Click Build to place on canvas.'
  } catch (e) {
    generatorStatus.value = `Generation failed: ${e.message}`
    console.error('Generator error:', e)
  } finally {
    generatorIsGenerating.value = false
  }
}

// Remove background helper (returns promise with cleaned data URL)
const removeBgFromDataUrl = (dataUrl) => {
  return new Promise((resolve) => {
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
        if (data[i] <= 40 && data[i + 1] <= 40 && data[i + 2] <= 40) {
          data[i + 3] = 0
        }
      }
      ctx.putImageData(imageData, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.src = dataUrl
  })
}

const buildGeneratedBuilding = () => {
  if (!generatorResult.value || !canvasRef.value) return
  const size = generatorModalSize.value
  const anchors = buildingPath.value
  if (anchors.length > 0) {
    // Place one image per NxN block anchor
    for (const cell of anchors) {
      canvasRef.value.placeImageAtCell(cell.row, cell.col, generatorResult.value, size, size, false)
    }
    buildingPath.value = []
  } else if (selectedCell.value.row !== -1) {
    canvasRef.value.placeImageAtSelectedCell(generatorResult.value, size, size, false)
  }
  closeGeneratorModal()
}

// Computed buildings from project images
const buildings = computed(() => {
  return projectImages.value
    .filter(img => img.buildingData?.isBuilding === true)
    .sort((a, b) => (a.buildingData?.buildingOrder ?? 9999) - (b.buildingData?.buildingOrder ?? 9999))
})

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

  // Auto-load default project (begin.json)
  setTimeout(async () => {
    try {
      isProjectLoading.value = true
      projectLoadStatus.value = 'Loading map...'
      const response = await fetch(BASE_URL + 'templates/all/begin.json')
      if (!response.ok) throw new Error('Failed to load begin.json')
      const projectData = await response.json()
      const loadedData = await loadProject(
        projectData,
        canvasRef.value,
        (progress, status) => {
          projectLoadProgress.value = progress
          projectLoadStatus.value = status
        }
      )
      // Load images/buildings from project
      const loadedImages = projectData.images || []
      images.value = loadedImages.map(img => ({
        id: img.id || `gen-${Date.now()}-${Math.random()}`,
        url: img.url,
        prompt: img.prompt || '',
        date: img.date || new Date().toISOString(),
        cellsX: img.cellsX || 1,
        cellsY: img.cellsY || 1,
        genWidth: img.genWidth || 512,
        genHeight: img.genHeight || 512,
        strength: img.strength || 0.85,
        mode: img.mode || 'txt2img',
        generatorType: img.generatorType || null,
        templateName: img.templateName || null,
        numSteps: img.numSteps || 1,
        buildingData: img.buildingData || null
      }))
      projectImages.value = loadedImages.filter(img => img.buildingData?.isBuilding).map(img => ({
        id: img.id || Date.now().toString() + Math.random(),
        url: img.url,
        prompt: img.prompt || '',
        cellsX: img.cellsX || 1,
        cellsY: img.cellsY || 1,
        buildingData: img.buildingData || null
      }))
      roadTiles.value = loadedData.roadTiles || []
      tempBuildingSpriteUrl.value = loadedData.tempBuildingSpriteUrl || null
      console.log('✅ LocalModel: Default project loaded')
    } catch (error) {
      console.error('Failed to load default project:', error)
    } finally {
      isProjectLoading.value = false
    }
  }, 500)
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
    const { StableDiffusionPipeline, ISOMETRIC_UNET_URL, ISOMETRIC_QUANTIZED_UNET_URL, DEFAULT_CLIP_API_URL, isLocal } = await import('./utils/webgpuDiffusion.js')
    const pipelineOptions = {}
    if (useRemoteClip.value) {
      pipelineOptions.clipApiUrl = DEFAULT_CLIP_API_URL
    }
    if (modelVariant.value === 'isometric-fp16') {
      pipelineOptions.unetUrl = ISOMETRIC_UNET_URL
      pipelineOptions.unetFp16 = true
    } else if (modelVariant.value === 'isometric-quantized') {
      pipelineOptions.unetUrl = ISOMETRIC_QUANTIZED_UNET_URL
      pipelineOptions.unetFp16 = false // quantized model uses FP32
    }
    if (isLocal) {
      console.log('[SD] Running locally — using local ONNX model servers')
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
        width: genWidth.value,
        height: genHeight.value,
        onStep: (step, total) => {
          status.value = `Denoising step ${step + 1}/${total}...`
        }
      })
      // Resize output to match input image dimensions
      if (inputImageSize.value && (inputImageSize.value.width !== genWidth.value || inputImageSize.value.height !== genHeight.value)) {
        imageDataUrl = await resizeDataUrl(imageDataUrl, inputImageSize.value.width, inputImageSize.value.height)
      }
    } else {
      imageDataUrl = await pipeline.generate(prompt.value, {
        numSteps: numSteps.value,
        width: genWidth.value,
        height: genHeight.value,
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
    const w = img.width
    const h = img.height
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const imageData = ctx.getImageData(0, 0, w, h)
    const data = imageData.data
    const size = w * h

    // Step 1: mark all near-black pixels as "candidate background"
    // isDark[i] = 1 if pixel is dark (would be removed)
    const isDark = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
      const r = data[i * 4]
      const g = data[i * 4 + 1]
      const b = data[i * 4 + 2]
      if (r <= 40 && g <= 40 && b <= 40) {
        isDark[i] = 1
      }
    }

    // Step 2: flood-fill from all edges to mark only EXTERIOR dark pixels
    // Only these become transparent; interior dark pixels (holes inside silhouette)
    // stay opaque black - so grass underneath never shows through holes
    const isExterior = new Uint8Array(size)
    const stack = []
    // Seed with all edge pixels that are dark
    for (let x = 0; x < w; x++) {
      const topIdx = x
      const botIdx = (h - 1) * w + x
      if (isDark[topIdx] && !isExterior[topIdx]) { isExterior[topIdx] = 1; stack.push(topIdx) }
      if (isDark[botIdx] && !isExterior[botIdx]) { isExterior[botIdx] = 1; stack.push(botIdx) }
    }
    for (let y = 0; y < h; y++) {
      const leftIdx = y * w
      const rightIdx = y * w + w - 1
      if (isDark[leftIdx] && !isExterior[leftIdx]) { isExterior[leftIdx] = 1; stack.push(leftIdx) }
      if (isDark[rightIdx] && !isExterior[rightIdx]) { isExterior[rightIdx] = 1; stack.push(rightIdx) }
    }
    // 4-neighbor flood-fill
    while (stack.length > 0) {
      const idx = stack.pop()
      const x = idx % w
      const y = (idx / w) | 0
      if (x > 0) {
        const n = idx - 1
        if (isDark[n] && !isExterior[n]) { isExterior[n] = 1; stack.push(n) }
      }
      if (x < w - 1) {
        const n = idx + 1
        if (isDark[n] && !isExterior[n]) { isExterior[n] = 1; stack.push(n) }
      }
      if (y > 0) {
        const n = idx - w
        if (isDark[n] && !isExterior[n]) { isExterior[n] = 1; stack.push(n) }
      }
      if (y < h - 1) {
        const n = idx + w
        if (isDark[n] && !isExterior[n]) { isExterior[n] = 1; stack.push(n) }
      }
    }

    // Step 3: apply result
    // - exterior dark pixels → transparent
    // - interior dark pixels → opaque black (preserved)
    for (let i = 0; i < size; i++) {
      if (isExterior[i]) {
        data[i * 4 + 3] = 0
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

const handleRoadPlaced = ({ path }) => {
  buildRoad(canvasRef.value, roadTiles.value, path)
}

const loadTemplateAsInput = (templateUrl) => {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    inputImage.value = canvas.toDataURL('image/png')
    inputImageEl.value = img
    inputImageSize.value = { width: img.naturalWidth, height: img.naturalHeight }
  }
  img.src = templateUrl
}

const selectActiveTemplate = (idx) => {
  activeTemplateIndex.value = idx
  const tpl = activeTemplates.value[idx]
  if (tpl) loadTemplateAsInput(tpl.url)
}

const applyPriceLevel = (index) => {
  selectedPriceIndex.value = index
  const level = activePriceLevels.value[index]
  const cat = activeCategoryConfig.value
  if (!level || !cat) return
  // Update template
  const tplIdx = activeTemplates.value.findIndex(t => t.name === level.template)
  if (tplIdx !== -1) {
    activeTemplateIndex.value = tplIdx
    loadTemplateAsInput(activeTemplates.value[tplIdx].url)
  }
  // Update prompt with extra
  prompt.value = cat.prompt + ', ' + level.extra
  // Update strength
  strength.value = cat.strength
}

const handleBuildingPathPlaced = ({ path, anchors }) => {
  buildingPath.value = anchors || path
  buildingPlacementMode.value = false

  if (selectedGeneratorSize.value) {
    const { type, size, category } = selectedGeneratorSize.value

    // House category-based flow
    if (type === 'house' && category && houseCategories[category]) {
      const cat = houseCategories[category]
      activeCategoryConfig.value = cat
      buildingSize.value = cat.size
      mode.value = 'img2img'
      strength.value = cat.strength
      // Build unique templates from price levels
      const uniqueTemplates = [...new Set(cat.prices.map(p => p.template))]
      activeTemplates.value = uniqueTemplates.map(name => ({
        name,
        url: BASE_URL + 'templates/buildings/' + name + '.png'
      }))
      activePriceLevels.value = cat.prices
      selectedPriceIndex.value = 0
      // Apply first price level
      const firstLevel = cat.prices[0]
      prompt.value = cat.prompt + ', ' + firstLevel.extra
      activeTemplateIndex.value = 0
      loadTemplateAsInput(activeTemplates.value[0].url)
      panelCollapsed.value = false
      return
    }

    // Shop category-based flow
    if (type === 'shop' && category && shopCategories[category]) {
      const cat = shopCategories[category]
      activeCategoryConfig.value = cat
      buildingSize.value = cat.size
      mode.value = 'img2img'
      strength.value = cat.strength
      // Build unique templates from price levels
      const uniqueTemplates = [...new Set(cat.prices.map(p => p.template))]
      activeTemplates.value = uniqueTemplates.map(name => ({
        name,
        url: BASE_URL + 'templates/buildings/' + name + '.png'
      }))
      activePriceLevels.value = cat.prices
      selectedPriceIndex.value = 0
      // Apply first price level
      const firstLevel = cat.prices[0]
      prompt.value = cat.prompt + ', ' + firstLevel.extra
      activeTemplateIndex.value = 0
      loadTemplateAsInput(activeTemplates.value[0].url)
      panelCollapsed.value = false
      return
    }

    // Factory category-based flow
    if (type === 'factory' && category && factoryCategories[category]) {
      const cat = factoryCategories[category]
      activeCategoryConfig.value = cat
      buildingSize.value = cat.size
      mode.value = 'img2img'
      strength.value = cat.strength
      // Build unique templates from price levels
      const uniqueTemplates = [...new Set(cat.prices.map(p => p.template))]
      activeTemplates.value = uniqueTemplates.map(name => ({
        name,
        url: BASE_URL + 'templates/buildings/' + name + '.png'
      }))
      activePriceLevels.value = cat.prices
      selectedPriceIndex.value = 0
      // Apply first price level
      const firstLevel = cat.prices[0]
      prompt.value = cat.prompt + ', ' + firstLevel.extra
      activeTemplateIndex.value = 0
      loadTemplateAsInput(activeTemplates.value[0].url)
      panelCollapsed.value = false
      return
    }

    // Legacy flow for shop/factory
    const config = buildingConfigs[type]?.[size]
    if (config) {
      buildingSize.value = size
      prompt.value = config.prompt
      mode.value = 'img2img'
      activeTemplates.value = config.templates.map(name => ({
        name,
        url: BASE_URL + 'templates/buildings/' + name + '.png'
      }))
      activeTemplateIndex.value = 0
      activePriceLevels.value = []
      activeCategoryConfig.value = null
      loadTemplateAsInput(activeTemplates.value[0].url)
      panelCollapsed.value = false
    }
  }
}

const placeOnGrid = () => {
  if (!generatedImage.value || !canvasRef.value) return
  const anchors = buildingPath.value
  if (anchors.length > 0) {
    // Place one image per NxN block anchor (top-left corner)
    for (const cell of anchors) {
      canvasRef.value.placeImageAtCell(cell.row, cell.col, generatedImage.value, buildingSize.value, buildingSize.value, false)
    }
    buildingPath.value = []
  } else if (selectedCell.value.row !== -1) {
    canvasRef.value.placeImageAtSelectedCell(generatedImage.value, buildingSize.value, buildingSize.value, false)
  }
  // Reset generator state
  expandedGenerator.value = null
  selectedGeneratorSize.value = null
  buildingPlacementMode.value = false
}

const addToGallery = () => {
  if (!generatedImage.value) return
  const id = `gen-${Date.now()}`
  images.value.push({
    id,
    url: generatedImage.value,
    prompt: prompt.value,
    date: new Date().toISOString(),
    cellsX: buildingSize.value,
    cellsY: buildingSize.value,
    genWidth: genWidth.value,
    genHeight: genHeight.value,
    strength: strength.value,
    mode: mode.value,
    generatorType: selectedGeneratorSize.value?.type || null,
    templateName: inputImage.value ? 'custom' : null,
    numSteps: numSteps.value
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

// Building selection handler
const handleBuildingSelected = (data) => {
  if (data === null) {
    selectedBuildingId.value = null
    return
  }
  const { building, cellsX, cellsY } = data
  selectedBuildingId.value = building.id
  selectedImageId.value = building.id
  buildingSize.value = cellsX
  roadBuildingMode.value = false
  roadDeleteMode.value = false
  deleteMode.value = false
  recycleMode.value = false
  buildingPlacementMode.value = false
  expandedGenerator.value = null
  selectedGeneratorSize.value = null
}

// Road/delete mode toggles
const handleRoadModeToggled = (isEnabled) => {
  roadBuildingMode.value = isEnabled
  if (isEnabled) {
    selectedBuildingId.value = null
    selectedImageId.value = null
    roadDeleteMode.value = false
    recycleMode.value = false
    deleteMode.value = false
    buildingPlacementMode.value = false
    expandedGenerator.value = null
    selectedGeneratorSize.value = null
  }
}

const handleRoadDeleteModeToggled = (isEnabled) => {
  roadDeleteMode.value = isEnabled
  if (isEnabled) {
    selectedBuildingId.value = null
    selectedImageId.value = null
    roadBuildingMode.value = false
    recycleMode.value = false
    buildingPlacementMode.value = false
    expandedGenerator.value = null
    selectedGeneratorSize.value = null
  }
}

const handleRecycleModeToggled = (isEnabled) => {
  recycleMode.value = isEnabled
  if (isEnabled) {
    selectedBuildingId.value = null
    selectedImageId.value = null
    roadBuildingMode.value = false
    roadDeleteMode.value = false
    deleteMode.value = false
    buildingPlacementMode.value = false
    expandedGenerator.value = null
    selectedGeneratorSize.value = null
  }
}

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

// === Save / Load project JSON ===
const saveProjectJSON = async () => {
  const placedImages = {}
  const uniqueImages = new Map()
  let imageIdCounter = 1

  if (canvasRef.value && typeof canvasRef.value.cellImages === 'function') {
    const cellImagesData = canvasRef.value.cellImages()
    Object.entries(cellImagesData).forEach(([key, imageData]) => {
      if (imageData.isSecondary) return
      if (imageData.isBackground) return
      const [row, col] = key.split('-').map(Number)

      if (imageData.isRoadTile && imageData.tileMetadata) {
        placedImages[key] = {
          row, col,
          cellsX: imageData.cellsX || 1, cellsY: imageData.cellsY || 1,
          isBackground: false, isRoadTile: true,
          templateName: imageData.templateName || '',
          tileMetadata: imageData.tileMetadata,
          buildingData: imageData.buildingData || null
        }
        return
      }

      const url = imageData.url
      let imageId
      if (uniqueImages.has(url)) {
        imageId = uniqueImages.get(url)
      } else {
        imageId = `img_${imageIdCounter++}`
        uniqueImages.set(url, imageId)
      }
      placedImages[key] = {
        row, col, imageId,
        libraryImageId: imageData.libraryImageId || null,
        cellsX: imageData.cellsX || 1, cellsY: imageData.cellsY || 1,
        isBackground: false, isRoadTile: false,
        templateName: imageData.templateName || '',
        tileMetadata: imageData.tileMetadata || null,
        buildingData: imageData.buildingData || null
      }
    })
  }

  const imageLibrary = []
  uniqueImages.forEach((id, url) => {
    imageLibrary.push({ id, url })
  })

  const bgTiles = (canvasRef.value && typeof canvasRef.value.backgroundTiles === 'function')
    ? canvasRef.value.backgroundTiles()
    : []

  const saveData = {
    version: '1.9',
    source: 'local-model',
    timestamp: new Date().toISOString(),
    imageCount: images.value.length,
    placedImageCount: Object.keys(placedImages).length,
    uniqueImageCount: imageLibrary.length,
    images: images.value.map(img => ({
      id: img.id,
      url: img.url,
      prompt: img.prompt || '',
      cellsX: img.cellsX || 1,
      cellsY: img.cellsY || 1,
      date: img.date || new Date().toISOString(),
      genWidth: img.genWidth || 512,
      genHeight: img.genHeight || 512,
      strength: img.strength || 0.85,
      mode: img.mode || 'txt2img',
      generatorType: img.generatorType || null,
      templateName: img.templateName || null,
      numSteps: img.numSteps || 1,
      buildingData: img.buildingData || null
    })),
    imageLibrary,
    placedImages,
    backgroundTiles: bgTiles,
    roadSpriteUrl: roadTiles.value.length > 0 ? (BASE_URL + 'templates/roads/sprites/presentroad.png') : null,
    tempBuildingSpriteUrl: tempBuildingSpriteUrl.value
  }

  const jsonString = JSON.stringify(saveData, null, 2)
  const blob = new Blob([jsonString], { type: 'application/json' })
  const filename = `local-model-${Date.now()}.json`

  // Moderný File System Access API - natívny save dialog, Chrome ho neblokuje
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      console.log('💾 Project saved via File System API')
      return
    } catch (err) {
      if (err.name === 'AbortError') return
      console.warn('File System API failed, fallback to download link:', err)
    }
  }

  // Fallback pre staršie prehliadače
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  console.log('💾 Project saved')
}

const loadProjectJSON = () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const projectData = JSON.parse(text)

      isProjectLoading.value = true
      projectLoadStatus.value = 'Loading project...'

      // Clear canvas first
      if (canvasRef.value && typeof canvasRef.value.clearAllImages === 'function') {
        canvasRef.value.clearAllImages()
      }

      const loadedData = await loadProject(
        projectData,
        canvasRef.value,
        (progress, statusText) => {
          projectLoadProgress.value = progress
          projectLoadStatus.value = statusText
        }
      )

      // Load gallery images with metadata
      const loadedImages = projectData.images || []
      images.value = loadedImages.map(img => ({
        id: img.id || `gen-${Date.now()}-${Math.random()}`,
        url: img.url,
        prompt: img.prompt || '',
        date: img.date || new Date().toISOString(),
        cellsX: img.cellsX || 1,
        cellsY: img.cellsY || 1,
        genWidth: img.genWidth || 512,
        genHeight: img.genHeight || 512,
        strength: img.strength || 0.85,
        mode: img.mode || 'txt2img',
        generatorType: img.generatorType || null,
        templateName: img.templateName || null,
        numSteps: img.numSteps || 1,
        buildingData: img.buildingData || null
      }))

      // Load project images for BuildingSelector
      projectImages.value = loadedImages.filter(img => img.buildingData?.isBuilding).map(img => ({
        id: img.id,
        url: img.url,
        prompt: img.prompt || '',
        cellsX: img.cellsX || 1,
        cellsY: img.cellsY || 1,
        buildingData: img.buildingData || null
      }))

      roadTiles.value = loadedData.roadTiles || []
      tempBuildingSpriteUrl.value = loadedData.tempBuildingSpriteUrl || null
      console.log('📂 Project loaded from file')
    } catch (err) {
      console.error('Failed to load project:', err)
      alert('Failed to load project: ' + (err.message || err))
    } finally {
      isProjectLoading.value = false
    }
  }
  input.click()
}
</script>

<template>
  <div class="local-model-page">
    <!-- Full Phaser Canvas Background -->
    <PhaserCanvas
      ref="canvasRef"
      :images="projectImages"
      :selectedImageId="selectedBuildingId || 'local-placer'"
      :lastImageCellsX="buildingSize"
      :lastImageCellsY="buildingSize"
      :showNumbering="false"
      :showGallery="false"
      :showGrid="true"
      :deleteMode="deleteMode"
      :roadBuildingMode="roadBuildingMode"
      :roadDeleteMode="roadDeleteMode"
      :recycleMode="recycleMode"
      :roadTiles="roadTiles"
      :buildingPlacementMode="buildingPlacementMode"
      :buildingPlacementSize="selectedGeneratorSize?.size || 1"
      :showPerson="false"
      :isFullscreen="false"
      @cell-selected="handleCellSelected"
      @image-placed="handleImagePlaced"
      @road-placed="handleRoadPlaced"
      @building-path-placed="handleBuildingPathPlaced"
    />

    <!-- Left Panel - Buildings & Tools -->
    <div class="left-panel" :class="{ collapsed: leftPanelCollapsed }">
      <div class="panel-content" v-show="!leftPanelCollapsed">
        <BuildingSelector
          :buildings="buildings"
          :selectedBuildingId="selectedBuildingId"
          @building-selected="handleBuildingSelected"
        />

        <!-- Road & Delete Toolbar -->
        <div class="tools-toolbar">
          <button
            :class="['tool-btn', { active: roadBuildingMode }]"
            @click="handleRoadModeToggled(!roadBuildingMode)"
            title="Build Road"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12h18M3 6h18M3 18h18"/>
              <circle cx="7" cy="12" r="1" fill="currentColor"/>
              <circle cx="12" cy="12" r="1" fill="currentColor"/>
              <circle cx="17" cy="12" r="1" fill="currentColor"/>
            </svg>
            <span>Road</span>
          </button>

          <button
            :class="['tool-btn recycle', { active: recycleMode }]"
            @click="handleRecycleModeToggled(!recycleMode)"
            title="Recycle building - returns resources"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5"/>
              <path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12"/>
              <path d="m14 16-3 3 3 3"/>
              <path d="M8.293 13.596 4.875 7.97l.927-.535 2.862 4.7"/>
              <path d="M17.5 9.5 14.23 3.804a1.784 1.784 0 0 0-1.573-.886 1.83 1.83 0 0 0-1.557.89L9.875 6.03"/>
              <path d="m9.5 4.5 1-3.5 3.5 1"/>
              <path d="m17.5 9.5 3.5-1-1-3.5"/>
            </svg>
            <span>Recycle</span>
          </button>

          <button
            :class="['tool-btn remove', { active: roadDeleteMode }]"
            @click="handleRoadDeleteModeToggled(!roadDeleteMode)"
            title="Delete buildings &amp; roads"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18"/>
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
            <span>Delete</span>
          </button>
        </div>

        <!-- Generator Buttons -->
        <div class="generator-section">
          <!-- House -->
          <div class="generator-group">
            <button
              :class="['generator-btn', { active: expandedGenerator === 'house' }]"
              @click="toggleGenerator('house')"
              title="House"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              <span>House</span>
            </button>
            <div v-if="expandedGenerator === 'house'" class="size-picker">
              <button
                v-for="cat in [
                  { key: 'family-house', label: 'Family House' },
                  { key: 'apartment', label: 'Apartment' },
                  { key: 'residential', label: 'Residential' }
                ]"
                :key="cat.key"
                :class="['size-pick-btn category-pick-btn', { active: selectedCategory === cat.key }]"
                @click="selectHouseCategory(cat.key)"
              >{{ cat.label }}</button>
            </div>
          </div>

          <!-- Shop -->
          <div class="generator-group">
            <button
              :class="['generator-btn', { active: expandedGenerator === 'shop' }]"
              @click="toggleGenerator('shop')"
              title="Shop"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 3h18v4H3z"/>
                <path d="M3 7v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7"/>
                <path d="M9 21V11h6v10"/>
                <path d="M3 7l2-4h14l2 4"/>
              </svg>
              <span>Shop</span>
            </button>
            <div v-if="expandedGenerator === 'shop'" class="size-picker">
              <button
                v-for="cat in [
                  { key: 'small-shop', label: 'Small Shop' },
                  { key: 'medium-shop', label: 'Medium Shop' }
                ]"
                :key="cat.key"
                :class="['size-pick-btn category-pick-btn', { active: selectedCategory === cat.key }]"
                @click="selectShopCategory(cat.key)"
              >{{ cat.label }}</button>
            </div>
          </div>

          <!-- Factory -->
          <div class="generator-group">
            <button
              :class="['generator-btn', { active: expandedGenerator === 'factory' }]"
              @click="toggleGenerator('factory')"
              title="Factory"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 20h20V8l-6 4V8l-6 4V4H2z"/>
                <rect x="17" y="2" width="3" height="4" rx="0.5"/>
                <rect x="12" y="1" width="2" height="5" rx="0.5"/>
              </svg>
              <span>Factory</span>
            </button>
            <div v-if="expandedGenerator === 'factory'" class="size-picker">
              <button
                v-for="cat in [
                  { key: 'small-factory', label: 'Small Factory' },
                  { key: 'medium-factory', label: 'Medium Factory' }
                ]"
                :key="cat.key"
                :class="['size-pick-btn category-pick-btn', { active: selectedCategory === cat.key }]"
                @click="selectFactoryCategory(cat.key)"
              >{{ cat.label }}</button>
            </div>
          </div>
        </div>
      </div>
      <div class="panel-toggle-left" @click="leftPanelCollapsed = !leftPanelCollapsed">
        <span v-if="leftPanelCollapsed">&#9654;</span>
        <span v-else>&#9664;</span>
      </div>
    </div>

    <!-- Building Generator Modal -->
    <Modal v-if="showGeneratorModal" :title="`Create ${generatorModalType} (${generatorModalSize}x${generatorModalSize})`" width="500px" @close="closeGeneratorModal">
      <div class="gen-modal">
        <!-- Template Picker -->
        <div class="gen-modal-section">
          <label class="gen-label">Template</label>
          <div class="template-picker">
            <div
              v-for="(tpl, idx) in generatorTemplates"
              :key="tpl.name"
              :class="['template-thumb', { selected: selectedTemplateIndex === idx }]"
              @click="selectedTemplateIndex = idx"
            >
              <img :src="tpl.url" :alt="tpl.name" />
              <span class="template-name">{{ tpl.name }}</span>
            </div>
          </div>
        </div>

        <!-- Prompt -->
        <div class="gen-modal-section">
          <label class="gen-label">Prompt</label>
          <textarea v-model="generatorPrompt" rows="2" class="gen-textarea" placeholder="Describe the building..."></textarea>
        </div>

        <!-- Status -->
        <div v-if="generatorStatus" class="gen-status">{{ generatorStatus }}</div>

        <!-- Generate Button -->
        <button
          class="gen-modal-btn create-btn"
          @click="generateBuilding"
          :disabled="generatorIsGenerating || !pipeline"
        >
          {{ generatorIsGenerating ? 'Generating...' : !pipeline ? 'Load model first' : 'Create Building' }}
        </button>

        <!-- Generating spinner -->
        <div v-if="generatorIsGenerating" class="gen-spinner-wrap">
          <div class="spinner"></div>
        </div>

        <!-- Result Preview -->
        <div v-if="generatorResult" class="gen-result">
          <div class="gen-preview">
            <img :src="generatorResult" alt="Generated building" />
          </div>
          <button
            class="gen-modal-btn build-btn"
            @click="buildGeneratedBuilding"
            :disabled="buildingPath.length === 0 && selectedCell.row === -1"
          >
            {{ buildingPath.length > 0 ? `Build on ${buildingPath.length} tiles` : selectedCell.row !== -1 ? 'Build' : 'Select a cell first' }}
          </button>
        </div>
      </div>
    </Modal>

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
          <div class="header-actions">
            <button class="header-icon-btn" @click="saveProjectJSON" title="Save Project">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            </button>
            <button class="header-icon-btn" @click="loadProjectJSON" title="Load Project">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
          </div>
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

          <!-- Template picker (when generator templates available) -->
          <div v-if="mode === 'img2img' && activeTemplates.length > 1" class="input-group">
            <label>Template</label>
            <div class="right-template-picker">
              <div
                v-for="(tpl, idx) in activeTemplates"
                :key="tpl.name"
                :class="['right-template-thumb', { selected: activeTemplateIndex === idx }]"
                @click="selectActiveTemplate(idx)"
              >
                <img :src="tpl.url" :alt="tpl.name" />
              </div>
            </div>
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

          <!-- Price slider (house categories) -->
          <div v-if="activePriceLevels.length > 0" class="input-group price-group">
            <label>Price: <strong>{{ activePriceLevels[selectedPriceIndex]?.label }}</strong></label>
            <input
              type="range"
              v-model.number="selectedPriceIndex"
              :min="0"
              :max="activePriceLevels.length - 1"
              step="1"
              :disabled="isGenerating"
              class="price-slider"
              @input="applyPriceLevel(selectedPriceIndex)"
            />
            <div class="price-labels">
              <span>{{ activePriceLevels[0]?.label }}</span>
              <span>{{ activePriceLevels[activePriceLevels.length - 1]?.label }}</span>
            </div>
            <div class="price-detail">
              {{ activePriceLevels[selectedPriceIndex]?.extra }} &mdash; template: {{ activePriceLevels[selectedPriceIndex]?.template }}
            </div>
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
            <div class="setting size-setting">
              <label>Size</label>
              <div v-if="mode === 'img2img' && inputImageSize" class="fixed-value">
                {{ inputImageSize.width }} &times; {{ inputImageSize.height }}
              </div>
              <div v-else class="size-inputs">
                <input type="number" v-model.number="genWidth" min="64" max="2048" step="64" :disabled="isGenerating" class="size-input" />
                <span class="size-x">&times;</span>
                <input type="number" v-model.number="genHeight" min="64" max="2048" step="64" :disabled="isGenerating" class="size-input" />
              </div>
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
              :disabled="buildingPath.length === 0 && selectedCell.row === -1"
              :title="buildingPath.length > 0 ? `Place on ${buildingPath.length} tiles` : selectedCell.row !== -1 ? `Place at cell [${selectedCell.row}, ${selectedCell.col}]` : 'Click a cell on the canvas first'"
            >{{ buildingPath.length > 0 ? `Place on ${buildingPath.length} tiles` : 'Place on Canvas' }}</button>
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

/* Left panel - buildings & tools */
.left-panel {
  position: fixed;
  top: 0;
  left: 0;
  width: 280px;
  height: 100vh;
  background: rgba(15, 12, 41, 0.92);
  backdrop-filter: blur(12px);
  border-right: 1px solid rgba(255,255,255,0.1);
  z-index: 100;
  display: flex;
  transition: width 0.3s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.left-panel.collapsed {
  width: 32px;
}

.left-panel > .panel-content {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.left-panel > .panel-content::-webkit-scrollbar {
  width: 5px;
}
.left-panel > .panel-content::-webkit-scrollbar-track {
  background: transparent;
}
.left-panel > .panel-content::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.15);
  border-radius: 3px;
}

.panel-toggle-left {
  width: 32px;
  min-width: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: rgba(255,255,255,0.5);
  font-size: 0.9rem;
  background: rgba(255,255,255,0.05);
  border-left: 1px solid rgba(255,255,255,0.08);
  transition: background 0.2s;
}
.panel-toggle-left:hover {
  background: rgba(255,255,255,0.1);
  color: #fff;
}

/* Tools toolbar at bottom of left panel */
.tools-toolbar {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  border-top: 1px solid rgba(255,255,255,0.1);
  background: rgba(0,0,0,0.2);
}

.tool-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 60px;
  padding: 6px 4px;
  border-radius: 8px;
  border: 2px solid rgba(255,255,255,0.15);
  background: rgba(255,255,255,0.05);
  color: rgba(255,255,255,0.6);
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.65rem;
  font-weight: 600;
}

.tool-btn svg {
  width: 20px;
  height: 20px;
}

.tool-btn:hover {
  border-color: #667eea;
  color: #667eea;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}

.tool-btn.active {
  border-color: #10b981;
  background: rgba(16,185,129,0.15);
  color: #10b981;
  box-shadow: 0 0 0 2px rgba(16,185,129,0.25);
}

.tool-btn.remove.active {
  border-color: #ef4444;
  background: rgba(239,68,68,0.15);
  color: #ef4444;
  box-shadow: 0 0 0 2px rgba(239,68,68,0.25);
}

.tool-btn.recycle.active {
  border-color: #f59e0b;
  background: rgba(245,158,11,0.15);
  color: #f59e0b;
  box-shadow: 0 0 0 2px rgba(245,158,11,0.25);
}

/* Generator section */
.generator-section {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.6rem 0.75rem;
  border-top: 1px solid rgba(255,255,255,0.08);
}

.generator-group {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.generator-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.6);
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.8rem;
  font-weight: 600;
  text-align: left;
}

.generator-btn svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.generator-btn:hover {
  border-color: rgba(255,255,255,0.3);
  color: #fff;
  background: rgba(255,255,255,0.08);
}

.generator-btn.active {
  border-color: #667eea;
  color: #667eea;
  background: rgba(102,126,234,0.1);
}

.size-picker {
  display: flex;
  gap: 4px;
  padding: 6px 4px 6px 28px;
  animation: slideDown 0.15s ease;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.size-pick-btn {
  flex: 1;
  padding: 4px 0;
  border-radius: 5px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.05);
  color: rgba(255,255,255,0.5);
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
}

.size-pick-btn:hover {
  border-color: rgba(255,255,255,0.3);
  color: #fff;
  background: rgba(255,255,255,0.1);
}

.size-pick-btn.active {
  border-color: #667eea;
  background: rgba(102,126,234,0.25);
  color: #fff;
}

/* Generator Modal */
.gen-modal {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.gen-modal-section {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.gen-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #ccc;
}

.template-picker {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 4px 0;
}

.template-thumb {
  flex-shrink: 0;
  width: 90px;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid rgba(255,255,255,0.1);
  cursor: pointer;
  transition: all 0.2s;
  background: rgba(0,0,0,0.3);
  text-align: center;
}

.template-thumb:hover {
  border-color: rgba(255,255,255,0.3);
}

.template-thumb.selected {
  border-color: #667eea;
  box-shadow: 0 0 0 2px rgba(102,126,234,0.3);
}

.template-thumb img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  display: block;
  background: #1a1a2e;
}

.template-name {
  display: block;
  font-size: 0.65rem;
  color: rgba(255,255,255,0.5);
  padding: 2px 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Right-panel template picker */
.right-template-picker {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 4px 0;
}

.right-template-thumb {
  flex-shrink: 0;
  width: 72px;
  height: 72px;
  border-radius: 6px;
  overflow: hidden;
  border: 2px solid rgba(255,255,255,0.1);
  cursor: pointer;
  transition: all 0.2s;
  background: rgba(0,0,0,0.3);
}

.right-template-thumb:hover {
  border-color: rgba(255,255,255,0.3);
}

.right-template-thumb.selected {
  border-color: #4fc3f7;
  box-shadow: 0 0 6px rgba(79,195,247,0.4);
}

.right-template-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Category pick buttons (wider than size buttons) */
.category-pick-btn {
  font-size: 0.7rem !important;
  padding: 4px 8px !important;
  white-space: nowrap;
}

/* Price slider */
.price-group {
  margin-bottom: 0.25rem;
}

.price-slider {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255,255,255,0.15);
  border-radius: 3px;
  outline: none;
  margin: 6px 0 4px;
}

.price-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #66bb6a;
  cursor: pointer;
  border: 2px solid #fff;
}

.price-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #66bb6a;
  cursor: pointer;
  border: 2px solid #fff;
}

.price-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: rgba(255,255,255,0.5);
}

.price-detail {
  font-size: 0.75rem;
  color: rgba(255,255,255,0.7);
  margin-top: 4px;
  text-align: center;
  font-style: italic;
}

.gen-textarea {
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
  box-sizing: border-box;
}

.gen-textarea:focus {
  border-color: rgba(102,126,234,0.6);
}

.gen-status {
  font-size: 0.8rem;
  color: rgba(255,255,255,0.6);
  padding: 0.3rem 0.5rem;
  background: rgba(255,255,255,0.05);
  border-radius: 5px;
}

.gen-modal-btn {
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  width: 100%;
}

.gen-modal-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.create-btn {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
}

.create-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(102,126,234,0.4);
}

.build-btn {
  background: linear-gradient(135deg, #ff9800, #f57c00);
  color: #fff;
  margin-top: 0.5rem;
}

.build-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(255,152,0,0.4);
}

.gen-spinner-wrap {
  display: flex;
  justify-content: center;
  padding: 0.5rem 0;
}

.gen-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.gen-preview {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(0,0,0,0.3);
  max-width: 300px;
}

.gen-preview img {
  width: 100%;
  display: block;
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

.header-actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.header-icon-btn {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  color: rgba(255,255,255,0.6);
  width: 32px;
  height: 32px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  padding: 0;
}

.header-icon-btn svg {
  width: 16px;
  height: 16px;
}

.header-icon-btn:hover {
  background: rgba(255,255,255,0.15);
  color: #fff;
  border-color: rgba(255,255,255,0.3);
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

.size-inputs {
  display: flex;
  align-items: center;
  gap: 4px;
}

.size-input {
  width: 60px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 5px;
  color: #fff;
  padding: 0.35rem 0.3rem;
  font-size: 0.8rem;
  outline: none;
  text-align: center;
  -moz-appearance: textfield;
}

.size-input::-webkit-inner-spin-button,
.size-input::-webkit-outer-spin-button {
  opacity: 1;
}

.size-input:focus {
  border-color: rgba(102,126,234,0.6);
}

.size-x {
  color: rgba(255,255,255,0.4);
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
