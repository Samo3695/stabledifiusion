<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import TextureColorPicker from './TextureColorPicker.vue'

const props = defineProps({
  initialColors: {
    type: Object,
    default: () => ({ hue: 0, saturation: 100, brightness: 100 })
  },
  initialTextureSettings: {
    type: Object,
    default: () => ({ tilesPerImage: 1, tileResolution: 512, customTexture: null })
  }
})

const emit = defineEmits(['tiles-generated', 'color-change', 'texture-settings-change'])

const textureFileInput = ref(null)
const customTexture = ref(null) // Nahratá vlastná textúra

// Farebné hodnoty z TextureColorPicker
const textureColors = ref({
  hue: 0,
  saturation: 100,
  brightness: 100
})
const tilesPerImage = ref(1) // Cez koľko políčok pôjde jeden obrázok
const tileResolution = ref(512) // Rozlíšenie tile

// AI generovanie textúr
const generationPrompt = ref('')
const imageSize = ref('512x512')
const selectedLoraModel = ref('') // Žiadna LoRA pre texture model
const selectedBaseModel = ref('texture')
const isGenerating = ref(false)
const generatedTexturePreview = ref(null) // Náhľad vygenerovanej textúry

const imageSizeOptions = [
  { label: '500 x 500', value: '500x500' },
  { label: '512 x 512', value: '512x512' },
  { label: '1000 x 1000', value: '1000x1000' },
  { label: '1500 x 1500', value: '1500x1500' },
  { label: '2000 x 2000', value: '2000x2000' }
]

const loraModels = [
  { label: '❌ Žiadna LoRA', value: '' },
  { label: 'DiffuseTexture v11 (SD 1.5)', value: 'DiffuseTexture_v11.safetensors' }
]

const baseModels = [
  { label: 'LITE (SD v1.4) - rýchly', value: 'lite' },
  { label: 'Full (SD v1.5) - kvalitný', value: 'full' },
  { label: 'Texture Diffusion - 🎯 textúry', value: 'texture' },
  { label: 'DreamShaper 8', value: 'dreamshaper' },
  { label: 'Realistic Vision V5.1', value: 'realistic' },
  { label: 'SDXL - 🌟 najvyššia kvalita', value: 'sdxl' },
  { label: 'Absolute Reality 1.81', value: 'absolutereality' },
  { label: 'Epic Realism', value: 'epicrealism' },
  { label: 'MajicMix Realistic v7', value: 'majicmix' }
]

// Kontrola kompatibility LoRA s modelom
const loraCompatibilityWarning = computed(() => {
  if (!selectedLoraModel.value) return null
  
  const lora = selectedLoraModel.value
  const model = selectedBaseModel.value
  
  // DiffuseTexture v11 je pre SD 1.5 modely
  if (lora.includes('DiffuseTexture')) {
    const compatibleModels = ['lite', 'full', 'dreamshaper', 'realistic', 'absolutereality', 'epicrealism', 'majicmix']
    if (!compatibleModels.includes(model)) {
      return `⚠️ DiffuseTexture v11 je kompatibilný len s SD 1.5 modelmi (lite, full, dreamshaper, realistic, atd.). Pre model "${model}" vypnite LoRA.`
    }
  }
  
  // Seamless Texture je pre SDXL
  if (lora.includes('seamless')) {
    if (model !== 'sdxl') {
      return `⚠️ Seamless Texture je kompatibilný len s SDXL modelom. Zvoľte SDXL model alebo vypnite LoRA.`
    }
  }
  
  return null
})

// Nahratie vlastnej textúry
const handleTextureUpload = (event) => {
  const file = event.target.files?.[0]
  if (!file || !file.type.startsWith('image/')) return
  
  const reader = new FileReader()
  reader.onload = (e) => {
    customTexture.value = e.target.result
    emitTextureSettings()
  }
  reader.readAsDataURL(file)
}

// Vymazať nahratú textúru
const clearCustomTexture = () => {
  customTexture.value = null
  if (textureFileInput.value) {
    textureFileInput.value.value = ''
  }
  emitTextureSettings()
}

// Handler pre TextureColorPicker
const handleTextureApply = (adjustedImage, tiles) => {
  emit('tiles-generated', {
    tiles: [adjustedImage],
    tilesPerImage: tiles || tilesPerImage.value,
    prompt: 'Predvolená textúra',
    timestamp: new Date()
  })
}

// Handler pre zmenu farieb z TextureColorPicker
const handleColorChange = (colors) => {
  textureColors.value = colors
  // Emituj zmenu farieb do App.vue pre ukladanie projektu
  emit('color-change', colors)
}

// Handler pre zmenu počtu políčok z TextureColorPicker
const handleTilesChange = (tiles) => {
  tilesPerImage.value = tiles
  emitTextureSettings()
}

// Handler pre zmenu rozlíšenia z TextureColorPicker
const handleResolutionChange = (resolution) => {
  tileResolution.value = resolution
  emitTextureSettings()
}

// Emituj textúrové nastavenia
const emitTextureSettings = () => {
  emit('texture-settings-change', {
    tilesPerImage: tilesPerImage.value,
    tileResolution: tileResolution.value,
    customTexture: customTexture.value
  })
}

// Generuj textúru pomocou AI
const generateTexture = async () => {
  if (!generationPrompt.value.trim()) {
    alert('Prosím zadajte prompt pre generovanie textúry')
    return
  }

  isGenerating.value = true
  
  try {
    const [width, height] = imageSize.value.split('x').map(Number)
    
    const response = await fetch('http://localhost:5000/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: generationPrompt.value,
        width: width,
        height: height,
        lora: selectedLoraModel.value.replace('.safetensors', ''),
        model: selectedBaseModel.value
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    
    // Kontrola chyby z backendu
    if (data.error) {
      alert(`❌ ${data.error}`)
      isGenerating.value = false
      return
    }
    
    if (data.image) {
      // Použite vygenerovaný obrázok ako vlastnú textúru
      const imageData = data.image.includes('base64,') ? data.image : `data:image/png;base64,${data.image}`
      customTexture.value = imageData
      generatedTexturePreview.value = imageData // Uložiť pre náhľad
      emitTextureSettings()
      
      // Emituj vygenerovanú textúru
      emit('tiles-generated', {
        tiles: [customTexture.value],
        tilesPerImage: tilesPerImage.value,
        prompt: generationPrompt.value,
        timestamp: new Date()
      })
    }
  } catch (error) {
    console.error('Chyba pri generovaní textúry:', error)
    alert('Chyba pri generovaní textúry. Skontrolujte či beží backend server.')
  } finally {
    isGenerating.value = false
  }
}

// Stiahnuť vygenerovaný obrázok
const downloadTexture = () => {
  if (!generatedTexturePreview.value) return
  
  // Vytvor link element
  const link = document.createElement('a')
  link.href = generatedTexturePreview.value
  link.download = `texture-${Date.now()}.png`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// Inicializuj farby z props pri načítaní
onMounted(() => {
  if (props.initialColors) {
    textureColors.value = { ...props.initialColors }
  }
  if (props.initialTextureSettings) {
    tilesPerImage.value = props.initialTextureSettings.tilesPerImage || 1
    tileResolution.value = props.initialTextureSettings.tileResolution || 512
    if (props.initialTextureSettings.customTexture) {
      customTexture.value = props.initialTextureSettings.customTexture
    }
  }
})

// Watch na zmenu initialColors (pri načítaní projektu)
watch(() => props.initialColors, (newColors) => {
  if (newColors) {
    textureColors.value = { ...newColors }
  }
}, { deep: true })

// Watch na zmenu initialTextureSettings (pri načítaní projektu)
watch(() => props.initialTextureSettings, (newSettings) => {
  if (newSettings) {
    tilesPerImage.value = newSettings.tilesPerImage || 1
    tileResolution.value = newSettings.tileResolution || 512
    if (newSettings.customTexture) {
      customTexture.value = newSettings.customTexture
    }
  }
}, { deep: true })
</script>

<template>
  <div class="generator-card">
    <div class="form">
      <h3>� Texture Manager</h3>
      
      <!-- Predvolená textúra s farebnými úpravami -->
      <div class="texture-section">
        <label>🎨 Základná textúra</label>
        
        <div class="texture-upload">
          <input
            ref="textureFileInput"
            type="file"
            accept="image/*"
            @change="handleTextureUpload"
            class="file-input"
          />
          <div v-if="customTexture" class="upload-info">
            <span>✅ Vlastná textúra nahratá</span>
            <button 
              @click="clearCustomTexture" 
              class="btn-clear"
            >
              🗑️
            </button>
          </div>
        </div>
        
        <TextureColorPicker 
          :texture-path="customTexture || '/enviroment/grass.jpg'"
          :initial-colors="textureColors"
          :initial-tiles-per-image="tilesPerImage"
          :initial-tile-resolution="tileResolution"
          @apply-texture="handleTextureApply"
          @color-change="handleColorChange"
          @tiles-change="handleTilesChange"
          @resolution-change="handleResolutionChange"
        />
      </div>

      <div class="info-box">
        <p><strong>💡 Texture Manager:</strong></p>
        <p>Nastavte textúru pozadia, farebné úpravy a rozlíšenie pre mapu.</p>
      </div>

      <!-- AI generovanie textúr -->
      <div class="generation-section">
        <h4>🤖 AI Generovanie textúr</h4>
        
        <div class="input-group">
          <label>📝 Prompt pre generovanie</label>
          <input
            v-model="generationPrompt"
            type="text"
            placeholder="napr. seamless grass texture, top view, tileable..."
            class="text-input"
          />
        </div>

        <div class="input-group">
          <label>📐 Veľkosť obrázka</label>
          <select v-model="imageSize" class="select-input">
            <option 
              v-for="size in imageSizeOptions" 
              :key="size.value" 
              :value="size.value"
            >
              {{ size.label }}
            </option>
          </select>
        </div>

        <div class="input-group">
          <label>🎨 LoRA Model</label>
          <select v-model="selectedLoraModel" class="select-input">
            <option 
              v-for="lora in loraModels" 
              :key="lora.value" 
              :value="lora.value"
            >
              {{ lora.label }}
            </option>
          </select>
        </div>

        <div class="input-group">
          <label>🖼️ Základný Model</label>
          <select v-model="selectedBaseModel" class="select-input">
            <option 
              v-for="model in baseModels" 
              :key="model.value" 
              :value="model.value"
            >
              {{ model.label }}
            </option>
          </select>
        </div>
        <!-- Varovanie o kompatibilite LoRA -->
        <div v-if="loraCompatibilityWarning" class="compatibility-warning">
          {{ loraCompatibilityWarning }}
        </div>
        <button 
          @click="generateTexture" 
          :disabled="isGenerating || !generationPrompt.trim()"
          class="btn-generate"
        >
          {{ isGenerating ? '⏳ Generujem...' : '✨ Vygenerovať textúru' }}
        </button>

        <!-- Náhľad vygenerovanej textúry -->
        <div v-if="generatedTexturePreview" class="texture-preview">
          <div class="preview-header">
            <label>👁️ Náhľad súvislosti textúry</label>
            <button @click="downloadTexture" class="btn-download" title="Stiahnuť obrázok">
              💾 Stiahnuť
            </button>
          </div>
          <div 
            class="tiled-preview"
            :style="{
              backgroundImage: `url(${generatedTexturePreview})`,
              backgroundRepeat: 'repeat',
              backgroundSize: 'auto'
            }"
          >
          </div>
          <p class="preview-hint">Textúra zopakovaná 3x3 - skontrolujte súvislé prechody</p>
        </div>
      </div>
    </div>
  </div>
</template>


<style scoped>
.generator-card {
  background: white;
  color: #333;
  padding: 1.5rem;
  height: 100%;
  display: flex;
  flex-direction: column;
}

h3 {
  margin-top: 0;
  margin-bottom: 1.5rem;
  color: #667eea;
  font-size: 1.3rem;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

label {
  font-weight: 600;
  font-size: 0.9rem;
  color: #555;
}
input[type="range"] {
  width: 100%;
  height: 8px;
  border-radius: 4px;
  background: #e0e0e0;
  outline: none;
  cursor: pointer;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
  transition: all 0.3s;
}

input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  background: #764ba2;
}

input[type="range"]::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
  border: none;
  transition: all 0.3s;
}

input[type="range"]::-moz-range-thumb:hover {
  transform: scale(1.2);
  background: #764ba2;
}

input[type="range"]:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hint {
  font-size: 0.75rem;
  color: #999;
  font-weight: normal;
}







.file-input {
  padding: 0.5rem;
  border: 2px dashed #e0e0e0;
  border-radius: 8px;
  background: #fafafa;
  cursor: pointer;
  transition: all 0.3s;
}

.file-input:hover {
  border-color: #667eea;
  background: #f0f0ff;
}

.upload-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: #e8f5e9;
  border-radius: 8px;
  font-size: 0.85rem;
}

.upload-info span {
  flex: 1;
  color: #2e7d32;
}

.btn-clear {
  background: #dc3545;
  padding: 0.25rem 0.4rem;
  border: none;
  border-radius: 4px;
  color: white;
  cursor: pointer;
  font-size: 0.85rem;
}

.btn-clear:hover:not(:disabled) {
  background: #c82333;
}

.texture-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.texture-section > label {
  font-weight: 600;
  font-size: 0.9rem;
  color: #555;
}

.texture-upload {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

button {
  padding: 1rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  width: 100%;
}

button {
  background: #dc3545;
  color: white;
  padding: 0.25rem 0.5rem;
  font-size: 0.85rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s;
}

button:hover:not(:disabled) {
  background: #c82333;
  transform: translateY(-2px);
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none !important;
}

.info-box {
  background: #f8f9fa;
  padding: 1rem;
  border-radius: 8px;
  border-left: 4px solid #667eea;
  font-size: 0.85rem;
}

.info-box p {
  margin: 0.25rem 0;
}

.generation-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-top: 1rem;
  border-top: 2px solid #e0e0e0;
  margin-top: 1rem;
}

.generation-section h4 {
  margin: 0;
  color: #667eea;
  font-size: 1.1rem;
}

.text-input {
  width: 100%;
  padding: 0.75rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 0.9rem;
  transition: all 0.3s;
  box-sizing: border-box;
}

.text-input:focus {
  outline: none;
  border-color: #667eea;
  background: #f0f0ff;
}

.select-input {
  width: 100%;
  padding: 0.75rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 0.9rem;
  background: white;
  cursor: pointer;
  transition: all 0.3s;
  box-sizing: border-box;
}

.select-input:focus {
  outline: none;
  border-color: #667eea;
  background: #f0f0ff;
}

.select-input:hover {
  border-color: #667eea;
}

.btn-generate {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 1rem;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
  width: 100%;
}

.btn-generate:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-generate:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none !important;
}

.compatibility-warning {
  padding: 0.75rem;
  background: #fff3cd;
  border: 2px solid #ffc107;
  border-radius: 8px;
  color: #856404;
  font-size: 0.85rem;
  font-weight: 500;
  line-height: 1.4;
}

.texture-preview {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 1rem;
  border-top: 2px solid #e0e0e0;
  margin-top: 1rem;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.texture-preview > label,
.preview-header > label {
  font-weight: 600;
  font-size: 0.9rem;
  color: #555;
}

.btn-download {
  background: linear-gradient(135deg, #4caf50 0%, #66bb6a 100%);
  color: white;
  padding: 0.4rem 0.8rem;
  font-size: 0.8rem;
  font-weight: 600;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s;
  white-space: nowrap;
}

.btn-download:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4);
}

.tiled-preview {
  width: 100%;
  height: 300px;
  border: 2px solid #667eea;
  border-radius: 8px;
  background-color: #f0f0f0;
  image-rendering: pixelated;
  image-rendering: -moz-crisp-edges;
  image-rendering: crisp-edges;
}

.preview-hint {
  font-size: 0.75rem;
  color: #999;
  margin: 0;
  text-align: center;
}
</style>