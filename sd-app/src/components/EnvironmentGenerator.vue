<script setup>
import { ref, watch, onMounted } from 'vue'
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
</style>