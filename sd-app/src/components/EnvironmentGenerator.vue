<script setup>
import { ref, watch, onMounted } from 'vue'
import TextureColorPicker from './TextureColorPicker.vue'

const props = defineProps({
  initialColors: {
    type: Object,
    default: () => ({ hue: 0, saturation: 100, brightness: 100 })
  }
})

const emit = defineEmits(['environment-generated', 'tiles-generated', 'color-change'])

const fileInput = ref(null)
const uploadedImages = ref([]) // Nahrané obrázky
const prompt = ref('')
const negativePrompt = ref('blurry, low quality, distorted, text, watermark, signature, frame, border, person, character')

// Farebné hodnoty z TextureColorPicker
const textureColors = ref({
  hue: 0,
  saturation: 100,
  brightness: 100
})
const isGenerating = ref(false)
const error = ref('')
const generatedTiles = ref([]) // vygenerované tile obrázky
const showModal = ref(false)
const modalImage = ref('')
const tileCount = ref(4) // Počet tile-ov na generovanie
const tilesPerImage = ref(1) // Cez koľko políčok pôjde jeden obrázok
const useSameSeed = ref(false) // Pre textúry lepšie rôzne seed-y = variácie
const baseSeed = ref(Math.floor(Math.random() * 999999999))
const removeBackground = ref(true) // Odstrániť pozadie (PNG)
const bgThreshold = ref(30) // Prah pre odstránenie pozadia
const elementCount = ref(15) // Počet prvkov na rozmiestnenie
const useAiRemoval = ref(true) // Použiť AI pre odstránenie pozadia

// Predvolený prompt pre prvky prostredia (isometric)
const defaultPromptSuffix = ', isometric view, game asset, transparent background, single object, clean edges, high quality, 4k, detailed, no shadow'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'
const API_URL = `${API_BASE_URL}/generate`
const REMOVE_BG_URL = `${API_BASE_URL}/remove-background`

// Generuje jeden tile obrázok - čisté text-to-image
const generateSingleTile = async (index) => {
  // Použij buď rovnaký seed alebo variáciu
  const seed = useSameSeed.value ? baseSeed.value : baseSeed.value + index
  
  // Pridaj suffix pre seamless textúry
  const fullPrompt = prompt.value + defaultPromptSuffix
  
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: fullPrompt,
      negative_prompt: negativePrompt.value,
      model: 'dreamshaper',
      num_inference_steps: 50,
      guidance_scale: 7.5,
      width: 512,
      height: 512,
      seed: seed,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error || `Chyba pri generovaní tile #${index + 1}`)
  }

  const data = await response.json()
  return data.image
}

// Odstráni pozadie z obrázka (pomocou AI alebo fallback)
const removeBackgroundFromImage = async (imageBase64) => {
  const response = await fetch(REMOVE_BG_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image: imageBase64,
      threshold: bgThreshold.value,
      use_ai: useAiRemoval.value
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error || 'Chyba pri odstraňovaní pozadia')
  }

  const data = await response.json()
  return data.image
}

const generateEnvironment = async () => {
  if (!prompt.value.trim()) {
    error.value = 'Zadajte prosím prompt'
    return
  }
  
  console.log('🌍 EnvironmentGenerator: Generujem', tileCount.value, 'textúr...')
  console.log('   Prompt:', prompt.value + defaultPromptSuffix)
  console.log('   Negative:', negativePrompt.value)
  console.log('   Base seed:', baseSeed.value)
  console.log('   Same seed:', useSameSeed.value)
  
  isGenerating.value = true
  error.value = ''
  generatedTiles.value = []
  
  try {
    // Generuj tile-y sekvenčne (kvôli VRAM)
    for (let i = 0; i < tileCount.value; i++) {
      console.log(`   Generujem prvok ${i + 1}/${tileCount.value}...`)
      let tileImage = await generateSingleTile(i)
      
      // Odstráň pozadie ak je zapnuté
      if (removeBackground.value) {
        console.log(`   Odstraňujem pozadie...`)
        tileImage = await removeBackgroundFromImage(tileImage)
      }
      
      // Aplikuj farebné úpravy podľa textúry
      const adjustedImage = await applyColorAdjustments(tileImage)
      generatedTiles.value.push(adjustedImage)
    }
    
    console.log('✅ Všetky prvky prostredia vygenerované!')
    
    // Emit pre náhodné rozmiestnenie prvkov
    emit('environment-generated', {
      images: generatedTiles.value,
      count: elementCount.value,
      prompt: prompt.value,
      timestamp: new Date()
    })
    
  } catch (err) {
    if (err.message.includes('Failed to fetch')) {
      error.value = `Nemôžem sa pripojiť k serveru. Uistite sa, že backend beží na ${API_BASE_URL}`
    } else {
      error.value = err.message || 'Neznáma chyba'
    }
  } finally {
    isGenerating.value = false
  }
}

const openModal = (imageUrl) => {
  modalImage.value = imageUrl
  showModal.value = true
}

const closeModal = () => {
  showModal.value = false
  modalImage.value = ''
}

// Znova rozmiestniť existujúce prvky
const reapplyElements = () => {
  if (generatedTiles.value.length > 0) {
    emit('environment-generated', {
      images: generatedTiles.value,
      count: elementCount.value,
      prompt: prompt.value,
      timestamp: new Date()
    })
  }
}

// Nahratie obrázkov zo súborov
const handleFileUpload = (event) => {
  const files = event.target.files
  if (!files || files.length === 0) return
  
  uploadedImages.value = []
  
  Array.from(files).forEach(file => {
    if (!file.type.startsWith('image/')) return
    
    const reader = new FileReader()
    reader.onload = (e) => {
      uploadedImages.value.push(e.target.result)
    }
    reader.readAsDataURL(file)
  })
}

// Aplikovať nahrané obrázky ako textúry
const applyUploadedTextures = () => {
  if (uploadedImages.value.length === 0) {
    error.value = 'Najprv nahrajte obrázky'
    return
  }
  
  emit('tiles-generated', {
    tiles: uploadedImages.value,
    tilesPerImage: tilesPerImage.value,
    prompt: 'Nahrané obrázky',
    timestamp: new Date()
  })
}

// Vymazať nahrané obrázky
const clearUploadedImages = () => {
  uploadedImages.value = []
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

// Handler pre TextureColorPicker
const handleTextureApply = (adjustedImage) => {
  emit('tiles-generated', {
    tiles: [adjustedImage],
    tilesPerImage: tilesPerImage.value,
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

// Inicializuj farby z props pri načítaní
onMounted(() => {
  if (props.initialColors) {
    textureColors.value = { ...props.initialColors }
  }
})

// Watch na zmenu initialColors (pri načítaní projektu)
watch(() => props.initialColors, (newColors) => {
  if (newColors) {
    textureColors.value = { ...newColors }
  }
}, { deep: true })

// Aplikovať farebné úpravy na obrázok
const applyColorAdjustments = (imageSrc) => {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      
      // Aplikuj rovnaké farebné úpravy ako má textúra
      ctx.filter = `hue-rotate(${textureColors.value.hue}deg) saturate(${textureColors.value.saturation}%) brightness(${textureColors.value.brightness}%)`
      ctx.drawImage(img, 0, 0)
      
      resolve(canvas.toDataURL('image/png', 1.0))
    }
    img.src = imageSrc
  })
}
</script>

<template>
  <div class="generator-card">
    <div class="form">
      <h3>🌍 Environment Generator</h3>
      
      <!-- Predvolená textúra s farebnými úpravami -->
      <TextureColorPicker 
        texture-path="/enviroment/grass.jpg"
        :disabled="isGenerating"
        :initial-colors="textureColors"
        @apply-texture="handleTextureApply"
        @color-change="handleColorChange"
      />

      <div class="divider"><span>generovať prvky prostredia</span></div>

      <div class="input-group">
        <label for="env-prompt">✏️ Prompt pre prvky</label>
        <textarea
          id="env-prompt"
          v-model="prompt"
          placeholder="napr: rock, stone, tree, bush, crater, mushroom, crystal, log, stump..."
          rows="3"
          :disabled="isGenerating"
        />
      </div>

      <div class="input-group">
        <label for="tile-count">
          🔢 Počet variácií: {{ tileCount }}
        </label>
        <input
          id="tile-count"
          type="range"
          v-model.number="tileCount"
          min="1"
          max="8"
          step="1"
          :disabled="isGenerating"
        />
        <span class="hint">Koľko rôznych obrázkov vygenerovať</span>
      </div>

      <div class="input-group">
        <label for="element-count">
          🌲 Počet prvkov na mape: {{ elementCount }}
        </label>
        <input
          id="element-count"
          type="range"
          v-model.number="elementCount"
          min="5"
          max="50"
          step="5"
          :disabled="isGenerating"
        />
        <span class="hint">Koľko prvkov náhodne rozmiestniť</span>
      </div>

      <div class="input-group">
        <label for="neg-prompt">🚫 Negative prompt</label>
        <textarea
          id="neg-prompt"
          v-model="negativePrompt"
          placeholder="Čo nechceš v prvku..."
          rows="2"
          :disabled="isGenerating"
        />
      </div>

      <div class="input-group checkbox-group">
        <label>
          <input
            type="checkbox"
            v-model="useSameSeed"
            :disabled="isGenerating"
          />
          🎲 Rovnaký seed pre všetky (identické prvky)
        </label>
      </div>

      <div class="input-group checkbox-group">
        <label>
          <input
            type="checkbox"
            v-model="removeBackground"
            :disabled="isGenerating"
          />
          🖼️ Odstrániť pozadie (PNG s priehľadnosťou)
        </label>
      </div>

      <div v-if="removeBackground" class="input-group checkbox-group">
        <label>
          <input
            type="checkbox"
            v-model="useAiRemoval"
            :disabled="isGenerating"
          />
          🤖 Použiť AI na odstránenie pozadia (presnejšie)
        </label>
      </div>

      <div class="input-group">
        <label for="seed">
          🎲 Seed: {{ baseSeed }}
          <button class="btn-small" @click="baseSeed = Math.floor(Math.random() * 999999999)" :disabled="isGenerating">
            🔄
          </button>
        </label>
        <input
          id="seed"
          type="number"
          v-model.number="baseSeed"
          :disabled="isGenerating"
        />
      </div>

      <div v-if="error" class="error-message">
        ⚠️ {{ error }}
      </div>

      <button 
        @click="generateEnvironment" 
        :disabled="isGenerating || !prompt.trim()"
        class="btn-primary"
      >
        <span v-if="isGenerating">⏳ Generujem prvok {{ generatedTiles.length + 1 }}/{{ tileCount }}...</span>
        <span v-else>🎨 Generovať a rozmiestniť</span>
      </button>

      <!-- Vygenerované prvky -->
      <div v-if="generatedTiles.length > 0" class="tiles-grid">
        <label>🖼️ Vygenerované prvky (klikni pre zväčšenie):</label>
        <div class="tiles-container">
          <div 
            v-for="(tile, index) in generatedTiles" 
            :key="index"
            class="tile-preview"
            @click="openModal(tile)"
          >
            <img :src="tile" :alt="'Prvok ' + (index + 1)" />
            <span class="tile-number">{{ index + 1 }}</span>
          </div>
        </div>
        
        <button 
          @click="reapplyElements" 
          class="btn-secondary"
        >
          🔄 Rozmiestniť znova ({{ elementCount }} prvkov)
        </button>
      </div>

      <div class="info-box">
        <p><strong>💡 Environment Generator:</strong></p>
        <p>Generuje prvky (kamene, stromy...) s priehľadným pozadím a náhodne ich rozmiesťuje po mape.</p>
      </div>
    </div>

    <!-- Modal pre zobrazenie obrázka -->
    <div v-if="showModal" class="modal" @click="closeModal">
      <div class="modal-content" @click.stop>
        <button class="modal-close" @click="closeModal">✕</button>
        <img :src="modalImage" alt="Generated tile" />
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

.init-image-preview {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.init-image-preview label {
  font-size: 0.85rem;
  color: #667eea;
}

.init-image-preview img {
  width: 100%;
  height: auto;
  border-radius: 8px;
  border: 2px solid #e0e0e0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

/* Tiles grid */
.tiles-grid {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.tiles-grid > label {
  font-size: 0.85rem;
  color: #667eea;
}

.tiles-container {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}

.tile-preview {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.3s;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.tile-preview:hover {
  transform: scale(1.05);
}

.tile-preview img {
  width: 100%;
  height: auto;
  display: block;
}

.tile-number {
  position: absolute;
  top: 4px;
  left: 4px;
  background: rgba(102, 126, 234, 0.9);
  color: white;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: bold;
}

.btn-secondary {
  background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
  color: white;
  margin-top: 0.5rem;
}

.btn-secondary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 5px 20px rgba(40, 167, 69, 0.4);
}

.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-weight: normal;
}

.checkbox-group input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

input[type="number"] {
  width: 100%;
  padding: 0.5rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 0.9rem;
}

input[type="number"]:focus {
  outline: none;
  border-color: #667eea;
}

.btn-small {
  padding: 0.25rem 0.5rem;
  font-size: 0.8rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  margin-left: 0.5rem;
}

.btn-small:hover:not(:disabled) {
  background: #764ba2;
}

.size-buttons {
  display: flex;
  gap: 0.5rem;
}

.size-btn {
  flex: 1;
  padding: 0.5rem;
  font-size: 0.85rem;
  background: #f0f0f0;
  color: #555;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
}

.size-btn:hover:not(:disabled) {
  background: #e0e0e0;
  border-color: #667eea;
}

.size-btn.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-color: #667eea;
}

.size-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Upload sekcia */
.upload-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
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

.btn-apply {
  background: #28a745;
}

.btn-apply:hover:not(:disabled) {
  background: #218838;
}

.btn-clear {
  background: #dc3545;
  padding: 0.25rem 0.4rem;
}

.btn-clear:hover:not(:disabled) {
  background: #c82333;
}

.divider {
  display: flex;
  align-items: center;
  text-align: center;
  margin: 1rem 0;
  color: #999;
  font-size: 0.85rem;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  border-bottom: 1px solid #e0e0e0;
}

.divider span {
  padding: 0 1rem;
}

textarea {
  width: 100%;
  padding: 0.75rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 1rem;
  font-family: inherit;
  resize: vertical;
  transition: border-color 0.3s;
}

textarea:focus {
  outline: none;
  border-color: #667eea;
}

textarea:disabled {
  background: #f5f5f5;
  cursor: not-allowed;
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

.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none !important;
}

.error-message {
  padding: 1rem;
  background: #fee;
  color: #c33;
  border-radius: 8px;
  border-left: 4px solid #c33;
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

/* Preview ikona */
.preview-icon {
  position: relative;
  width: 100%;
  height: 150px;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.3s;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.preview-icon:hover {
  transform: scale(1.02);
}

.preview-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.3s;
}

.preview-icon:hover .preview-overlay {
  background: rgba(0, 0, 0, 0.4);
}

.preview-overlay span {
  font-size: 3rem;
  opacity: 0;
  transition: opacity 0.3s;
}

.preview-icon:hover .preview-overlay span {
  opacity: 1;
}

/* Modal */
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 2rem;
}

.modal-content {
  position: relative;
  max-width: 90vw;
  max-height: 90vh;
  background: white;
  border-radius: 12px;
  padding: 2rem;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.modal-content img {
  max-width: 100%;
  max-height: calc(90vh - 4rem);
  display: block;
  border-radius: 8px;
}

.modal-close {
  position: absolute;
  top: 1rem;
  right: 1rem;
  width: 40px;
  height: 40px;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  font-size: 1.5rem;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-close:hover {
  background: rgba(255, 0, 0, 0.8);
  transform: scale(1.1);
}
</style>
