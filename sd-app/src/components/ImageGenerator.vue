<script setup>
import { ref } from 'vue'

const emit = defineEmits(['image-generated'])

const prompt = ref('')
const negativePrompt = ref('')
const isGenerating = ref(false)
const error = ref('')
const inputImage = ref(null)
const inputImagePreview = ref('')
const strength = ref(0.75) // Ako moc zmeniť obrázok (0.0 - 1.0)
const model = ref('lite') // 'lite' or 'full'
const lastGeneratedImage = ref('') // Posledný vygenerovaný obrázok
const isRemovingBackground = ref(false)
const hueShift = ref(0) // Posun odtieňa (-180 až +180)
const isAdjustingHue = ref(false)

// LoRA podpora
const availableLoras = ref([])
const selectedLora = ref('')
const loraScale = ref(0.9) // Sila LoRA (0.0 - 1.0)

// Rozmery obrázka - fixné rozmery
const imageDimensions = ref('400x400') // '200x200', '200x300', '400x400', '400x600'

// Funkcia na získanie šírky a výšky z reťazca
const getImageDimensions = () => {
  const [width, height] = imageDimensions.value.split('x').map(Number)
  return { width, height }
}

// RGB farebné kanály (1.0 = normálne, 0.0 = bez farby, 2.0 = zdvojnásobenie)


// Konfigurácia pre Python backend z environment premenných
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'
const API_URL = `${API_BASE_URL}/generate`
const HEALTH_URL = `${API_BASE_URL}/health`

// Načítaj dostupné LoRA z backendu
const fetchAvailableLoras = async () => {
  try {
    const response = await fetch(HEALTH_URL)
    if (response.ok) {
      const data = await response.json()
      availableLoras.value = data.loras_available || []
    }
  } catch (err) {
    console.error('Nepodarilo sa načítať LoRA:', err)
  }
}

// Načítaj LoRA pri štarte
fetchAvailableLoras()

const handleImageUpload = (event) => {
  const file = event.target.files[0]
  if (file) {
    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      error.value = 'Obrázok je príliš veľký (max 10MB)'
      return
    }
    
    const reader = new FileReader()
    reader.onload = (e) => {
      inputImage.value = e.target.result
      inputImagePreview.value = e.target.result
      error.value = ''
    }
    reader.readAsDataURL(file)
  }
}

const removeInputImage = () => {
  inputImage.value = null
  inputImagePreview.value = ''
  const fileInput = document.getElementById('image-upload')
  if (fileInput) fileInput.value = ''
}

const generateImage = async () => {
  if (!prompt.value.trim()) {
    error.value = 'Zadajte prosím popis obrázka'
    return
  }

  isGenerating.value = true
  error.value = ''

  try {
    const dimensions = getImageDimensions()
    
    const requestBody = {
      prompt: prompt.value,
      negative_prompt: negativePrompt.value,
      model: model.value,
      num_inference_steps: 50,
      guidance_scale: 7.5,
      width: dimensions.width,
      height: dimensions.height,
    }
    
    // Pridaj LoRA ak je vybraná
    if (selectedLora.value) {
      requestBody.lora = selectedLora.value
      requestBody.lora_scale = loraScale.value
    }
    
    // Pridaj obrázok ak je nahraný
    if (inputImage.value) {
      requestBody.input_image = inputImage.value
      requestBody.strength = strength.value
    }
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Chyba pri generovaní obrázka')
    }

    const data = await response.json()

    const generatedImage = {
      id: Date.now().toString(),
      url: data.image,
      prompt: prompt.value,
      negativePrompt: negativePrompt.value,
      timestamp: new Date(),
    }

    // Ulož posledný vygenerovaný obrázok
    lastGeneratedImage.value = data.image

    emit('image-generated', generatedImage)
    prompt.value = ''
    negativePrompt.value = ''
  // Keep the uploaded input image by default so the user can re-run
  // image-to-image generations. The user can remove it manually
  // using the ❌ Odstrániť button in the UI.
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

// Odstráň čierne pozadie
const removeBackground = async () => {
  if (!lastGeneratedImage.value) {
    error.value = 'Najprv vygenerujte obrázok'
    return
  }

  isRemovingBackground.value = true
  error.value = ''

  try {
    const response = await fetch(`${API_BASE_URL}/remove-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: lastGeneratedImage.value,
        threshold: 30
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Chyba pri odstraňovaní pozadia')
    }

    const data = await response.json()

    const cleanedImage = {
      id: Date.now().toString(),
      url: data.image,
      prompt: 'Odstránené čierne pozadie',
      negativePrompt: '',
      timestamp: new Date(),
    }

    // Aktualizuj posledný obrázok
    lastGeneratedImage.value = data.image

    emit('image-generated', cleanedImage)
  } catch (err) {
    error.value = err.message || 'Chyba pri odstraňovaní pozadia'
  } finally {
    isRemovingBackground.value = false
  }
}

// Zmena farebného odtieňa
const adjustHue = async () => {
  if (!lastGeneratedImage.value) {
    error.value = 'Najprv vygenerujte obrázok'
    return
  }

  isAdjustingHue.value = true
  error.value = ''

  try {
    const response = await fetch(`${API_BASE_URL}/adjust-hue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: lastGeneratedImage.value,
        hue_shift: hueShift.value
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Chyba pri zmene odtieňa')
    }

    const data = await response.json()

    const adjustedImage = {
      id: Date.now().toString(),
      url: data.image,
      prompt: `Zmenený odtieň (${hueShift.value}°)`,
      negativePrompt: '',
      timestamp: new Date(),
    }

    // Aktualizuj posledný obrázok
    lastGeneratedImage.value = data.image

    emit('image-generated', adjustedImage)
  } catch (err) {
    error.value = err.message || 'Chyba pri zmene odtieňa'
  } finally {
    isAdjustingHue.value = false
  }
}

// Demo funkcia
const generateDemo = () => {
  const demoImage = {
    id: Date.now().toString(),
    url: `https://picsum.photos/512/512?random=${Date.now()}`,
    prompt: prompt.value || 'Demo obrázok',
    negativePrompt: negativePrompt.value,
    timestamp: new Date(),
  }
  emit('image-generated', demoImage)
  prompt.value = ''
  negativePrompt.value = ''
}
</script>

<template>
  <div class="generator-card">
    <h2>Generovať nový obrázok</h2>
    
    <div class="form">
      <!-- Nahranie obrázka -->
      <div class="input-group">
        <label>🖼️ Vstupný obrázok (voliteľné - pre Image-to-Image)</label>
        <div class="image-upload-area">
          <input
            id="image-upload"
            type="file"
            accept="image/*"
            @change="handleImageUpload"
            :disabled="isGenerating"
            style="display: none"
          />
          
          <div v-if="!inputImagePreview" class="upload-placeholder">
            <label for="image-upload" class="upload-label">
              📁 Kliknite alebo presuňte obrázok sem
              <br>
              <small>Ak chcete len text-to-image, nechajte prázdne</small>
            </label>
          </div>
          
          <div v-else class="image-preview">
            <img :src="inputImagePreview" alt="Nahraný obrázok" />
            <button @click="removeInputImage" class="remove-btn" :disabled="isGenerating">
              ❌ Odstrániť
            </button>
          </div>
        </div>
        
        <div v-if="inputImagePreview" class="slider-group">
          <label for="strength">
            Sila zmeny ({{ (strength * 100).toFixed(0) }}%)
            <small>- nižšia hodnota = bližšie k originálu</small>
          </label>
          <input
            id="strength"
            type="range"
            v-model.number="strength"
            min="0.3"
            max="1.0"
            step="0.05"
            :disabled="isGenerating"
          />
        </div>
      </div>

      <div class="input-group">
        <label for="prompt">Popis obrázka (Prompt)</label>
        <textarea
          id="prompt"
          v-model="prompt"
          placeholder="Napríklad: Beautiful sunset over mountains, highly detailed, 8k"
          rows="3"
          :disabled="isGenerating"
        />
      </div>

      <div class="input-group">
        <label for="model-select">Model</label>
        <select id="model-select" v-model="model" :disabled="isGenerating">
          <option value="lite">Lite (rýchlejší, menej VRAM)</option>
          <option value="dreamshaper">🏆 DreamShaper 8 (univerzálny, najlepší mix)</option>
          <option value="absolutereality">⭐ Absolute Reality (podobný DreamShaper)</option>
          <option value="epicrealism">🎨 Epic Realism (reality + concept art)</option>
          <option value="majicmix">✨ MajicMix Realistic (reality & fantasy blend)</option>
          <option value="realistic">📷 Realistic Vision V5.1 (čistý fotorealizmus)</option>
          <option value="full">Full SD v1.5 (základný kvalitnejší)</option>
        </select>
      </div>

      <!-- Rozmery obrázka -->
      <div class="input-group size-section">
        <label for="image-dimensions">📏 Rozmery obrázka</label>
        <select id="image-dimensions" v-model="imageDimensions" :disabled="isGenerating">
          <option value="200x200">200×200 px (štvorcový, mini)</option>
          <option value="200x300">200×300 px (portrét, mini)</option>
          <option value="400x400">400×400 px (štvorcový, malý)</option>
          <option value="400x600">400×600 px (portrét, malý)</option>
        </select>
      </div>

      <!-- LoRA výber -->
      <div v-if="availableLoras.length > 0" class="input-group lora-section">
        <label for="lora-select">🎨 LoRA Model (vlastný štýl)</label>
        <select id="lora-select" v-model="selectedLora" :disabled="isGenerating">
          <option value="">Žiadny (base model)</option>
          <option v-for="lora in availableLoras" :key="lora" :value="lora">
            {{ lora }}
          </option>
        </select>
        
        <div v-if="selectedLora" class="slider-group">
          <label for="lora-scale">
            Sila LoRA ({{ (loraScale * 100).toFixed(0) }}%)
            <small>- vyššia hodnota = výraznejší štýl</small>
          </label>
          <input
            id="lora-scale"
            type="range"
            v-model.number="loraScale"
            min="0.0"
            max="1.0"
            step="0.1"
            :disabled="isGenerating"
          />
        </div>
      </div>

      <div class="input-group">
        <label for="negative-prompt">Negatívny prompt (voliteľné)</label>
        <textarea
          id="negative-prompt"
          v-model="negativePrompt"
          placeholder="Napríklad: blurry, low quality, distorted"
          rows="2"
          :disabled="isGenerating"
        />
      </div>

      <div v-if="error" class="error-message">
        ⚠️ {{ error }}
      </div>

      <div class="button-group">
        <button 
          @click="generateImage" 
          :disabled="isGenerating || !prompt.trim()"
          class="btn-primary"
        >
          <span v-if="isGenerating">⏳ Generujem...</span>
          <span v-else-if="inputImagePreview">🎨 Upraviť obrázok</span>
          <span v-else>🎨 Generovať obrázok</span>
        </button>

        <button 
          @click="removeBackground" 
          :disabled="isRemovingBackground || !lastGeneratedImage"
          class="btn-remove-bg"
          title="Odstráni čierne pozadie z posledného vygenerovaného obrázka"
        >
          <span v-if="isRemovingBackground">⏳ Odstraňujem pozadie...</span>
          <span v-else>🧹 Odstrániť čierne pozadie</span>
        </button>

        <button 
          @click="generateDemo" 
          :disabled="isGenerating"
          class="btn-secondary"
        >
          🎲 Demo (náhodný obrázok)
        </button>
      </div>

      <!-- Farebné úpravy -->
      <div v-if="lastGeneratedImage" class="color-adjust-section">
        <h3>🎨 Úprava farebného odtieňa</h3>
        <div class="slider-group">
          <label>
            Posun odtieňa: <strong>{{ hueShift }}°</strong>
            <span class="hint">(-180° až +180°)</span>
          </label>
          <input
            type="range"
            v-model.number="hueShift"
            min="-180"
            max="180"
            step="5"
            :disabled="isAdjustingHue"
            class="slider"
          />
          <div class="hue-preview">
            <span v-if="hueShift < -120">🔵 Modrá/Fialová</span>
            <span v-else-if="hueShift < -60">💜 Fialová/Ružová</span>
            <span v-else-if="hueShift < 0">🌸 Ružová/Červená</span>
            <span v-else-if="hueShift === 0">⚪ Pôvodná</span>
            <span v-else-if="hueShift < 60">🟡 Žltá/Oranžová</span>
            <span v-else-if="hueShift < 120">🟢 Zelená/Žltá</span>
            <span v-else>🔵 Tyrkysová/Modrá</span>
          </div>
          <button 
            @click="adjustHue" 
            :disabled="isAdjustingHue || hueShift === 0"
            class="btn-hue"
          >
            <span v-if="isAdjustingHue">⏳ Mením odtieň...</span>
            <span v-else>🎨 Zmeniť odtieň</span>
          </button>
        </div>
      </div>

      <div class="info-box">
        <p><strong>💡 Tri režimy generovania:</strong></p>
        <ul>
          <li><strong>Text-to-Image:</strong> Nechajte pole pre obrázok prázdne</li>
          <li><strong>Image-to-Image:</strong> Nahrajte obrázok a AI ho upraví podľa promptu</li>
          <li><strong>Odstrániť pozadie:</strong> Po vygenerovaní použite tlačidlo 🧹 na odstránenie čierneho pozadia</li>
        </ul>
        <p><strong>⚡ GPU generovanie trvá 10-30 sekúnd</strong></p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.generator-card {
  background: white;
  color: #333;
  border-radius: 0;
  padding: 1.5rem;
  height: 100%;
  display: flex;
  flex-direction: column;
}

h2 {
  margin-top: 0;
  margin-bottom: 1.5rem;
  color: #667eea;
  font-size: 1.5rem;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  flex: 1;
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

label small {
  font-weight: normal;
  color: #888;
  font-size: 0.85em;
}

textarea {
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

/* Image upload area */
.image-upload-area {
  border: 2px dashed #ccc;
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.3s;
}

.image-upload-area:hover {
  border-color: #667eea;
}

.upload-placeholder {
  padding: 3rem 2rem;
  text-align: center;
  background: #f9f9f9;
}

.upload-label {
  cursor: pointer;
  color: #667eea;
  font-weight: 600;
  display: block;
}

.upload-label:hover {
  color: #764ba2;
}

.image-preview {
  position: relative;
  padding: 1rem;
  background: #f0f0f0;
}

.image-preview img {
  width: 100%;
  max-height: 300px;
  object-fit: contain;
  border-radius: 8px;
}

.remove-btn {
  position: absolute;
  top: 1.5rem;
  right: 1.5rem;
  background: rgba(255, 0, 0, 0.8);
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: background 0.3s;
}

.remove-btn:hover:not(:disabled) {
  background: rgba(255, 0, 0, 1);
}

.remove-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Slider */
.slider-group {
  margin-top: 1rem;
}

.slider-group label {
  display: block;
  margin-bottom: 0.5rem;
}

input[type="range"] {
  width: 100%;
  height: 8px;
  border-radius: 4px;
  background: #e0e0e0;
  outline: none;
  -webkit-appearance: none;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
}

input[type="range"]::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
  border: none;
}

input[type="range"]:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.button-group {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

button {
  padding: 1rem 2rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  flex: 1;
  min-width: 200px;
}

.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
}

.btn-secondary {
  background: #f0f0f0;
  color: #333;
}

.btn-secondary:hover:not(:disabled) {
  background: #e0e0e0;
}

.btn-remove-bg {
  padding: 1rem;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

.btn-remove-bg:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
}

.btn-remove-bg:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.btn-hue {
  padding: 0.8rem 1.5rem;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%);
  color: white;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba(236, 72, 153, 0.3);
  margin-top: 1rem;
  width: 100%;
}

.btn-hue:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(236, 72, 153, 0.4);
}

.btn-hue:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.color-adjust-section {
  margin-top: 1.5rem;
  padding: 1.5rem;
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.color-adjust-section h3 {
  margin-top: 0;
  margin-bottom: 1rem;
  color: #92400e;
}

.hue-preview {
  text-align: center;
  font-size: 1.2rem;
  font-weight: 600;
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 8px;
}

.hint {
  font-size: 0.85rem;
  color: #92400e;
  font-weight: normal;
  margin-left: 0.5rem;
}

.btn-reset {
  background: #ff9800;
  color: white;
  padding: 0.5rem 1rem;
  margin-top: 0.5rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: background 0.3s;
}

.btn-reset:hover:not(:disabled) {
  background: #f57c00;
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
  padding: 1.5rem;
  border-radius: 8px;
  border-left: 4px solid #667eea;
  font-size: 0.9rem;
}

.info-box p, .info-box ul {
  margin: 0.5rem 0;
}

.info-box ul {
  padding-left: 1.5rem;
}

.info-box code {
  background: white;
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  color: #764ba2;
}

/* Color controls section */
.color-controls {
  padding: 1rem;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  border-radius: 8px;
  margin-top: 1rem;
}

.color-controls h4 {
  margin-top: 0;
  margin-bottom: 1rem;
  color: #667eea;
}

.color-picker-group {
  margin-bottom: 1rem;
}

.color-picker-container {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.5rem;
}

.color-picker-input {
  width: 80px;
  height: 50px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.3s;
}

.color-picker-input:hover {
  border-color: #667eea;
}

.color-picker-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.color-hex {
  font-family: 'Courier New', monospace;
  font-weight: 600;
  color: #667eea;
  font-size: 1.1rem;
}

.reset-color-btn {
  padding: 0.5rem 1rem;
  background: #f0f0f0;
  border: 2px solid #e0e0e0;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s;
}

.reset-color-btn:hover:not(:disabled) {
  background: #e0e0e0;
  border-color: #667eea;
}

.reset-color-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.color-hint {
  margin: 1rem 0 0;
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.5);
  border-left: 4px solid #667eea;
  border-radius: 4px;
  font-size: 0.9rem;
  color: #555;
}

/* LoRA section */
.lora-section {
  background: linear-gradient(135deg, #fff5f8 0%, #e9d5ff 100%);
  padding: 1.5rem;
  border-radius: 12px;
  border: 2px solid #764ba2;
}

.lora-section label {
  color: #764ba2;
}

/* Size section */
.size-section {
  background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%);
  padding: 1.5rem;
  border-radius: 12px;
  border: 2px solid #0ea5e9;
}

.size-section label {
  color: #0369a1;
  font-weight: 600;
}

select {
  width: 100%;
  padding: 0.75rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 1rem;
  font-family: inherit;
  background: white;
  cursor: pointer;
  transition: border-color 0.3s;
}

select:focus {
  outline: none;
  border-color: #667eea;
}

select:disabled {
  background: #f5f5f5;
  cursor: not-allowed;
}
</style>
