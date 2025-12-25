<script setup>
import { ref } from 'vue'

const emit = defineEmits(['environment-generated'])

const skyType = ref('clear')
const timeOfDay = ref('day')
const weather = ref('sunny')
const isGenerating = ref(false)
const error = ref('')

const generateEnvironment = () => {
  console.log('🌍 EnvironmentGenerator: Generujem prostredie...')
  console.log('   Sky:', skyType.value)
  console.log('   Time:', timeOfDay.value)
  console.log('   Weather:', weather.value)
  
  isGenerating.value = true
  error.value = ''
  
  // TODO: Implementovať skutočné generovanie prostredia
  setTimeout(() => {
    const envData = {
      id: Date.now().toString(),
      skyType: skyType.value,
      timeOfDay: timeOfDay.value,
      weather: weather.value,
      timestamp: new Date()
    }
    
    emit('environment-generated', envData)
    isGenerating.value = false
  }, 1000)
}
</script>

<template>
  <div class="generator-card">
    <div class="form">
      <h3>🌍 Environment Generator</h3>
      
      <div class="input-group">
        <label for="sky-type">Typ oblohy</label>
        <select id="sky-type" v-model="skyType" :disabled="isGenerating">
          <option value="clear">☀️ Jasná</option>
          <option value="cloudy">☁️ Oblačná</option>
          <option value="overcast">🌫️ Zamračená</option>
          <option value="night">🌙 Nočná</option>
        </select>
      </div>

      <div class="input-group">
        <label for="time-of-day">Čas dňa</label>
        <select id="time-of-day" v-model="timeOfDay" :disabled="isGenerating">
          <option value="sunrise">🌅 Úsvit</option>
          <option value="day">☀️ Deň</option>
          <option value="sunset">🌇 Západ</option>
          <option value="night">🌃 Noc</option>
        </select>
      </div>

      <div class="input-group">
        <label for="weather">Počasie</label>
        <select id="weather" v-model="weather" :disabled="isGenerating">
          <option value="sunny">☀️ Slnečno</option>
          <option value="rainy">🌧️ Dážď</option>
          <option value="snowy">❄️ Sneh</option>
          <option value="foggy">🌫️ Hmla</option>
        </select>
      </div>

      <div v-if="error" class="error-message">
        ⚠️ {{ error }}
      </div>

      <button 
        @click="generateEnvironment" 
        :disabled="isGenerating"
        class="btn-primary"
      >
        <span v-if="isGenerating">⏳ Generujem...</span>
        <span v-else>🌍 Generovať prostredie</span>
      </button>

      <div class="info-box">
        <p><strong>💡 Environment Generator:</strong></p>
        <p>Vygeneruje atmosféru a prostredie pre vašu scénu.</p>
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

select {
  width: 100%;
  padding: 0.75rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 1rem;
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
</style>
