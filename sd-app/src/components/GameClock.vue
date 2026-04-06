<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  // Celkový herný čas v milisekundách (uložený/načítaný z projektu)
  initialTime: {
    type: Number,
    default: 0
  },
  // Či je hra pozastavená
  paused: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:gameTime'])

// Celkový herný čas v milisekundách
const gameTimeMs = ref(props.initialTime || 0)
let intervalId = null
let lastTick = null

// 1 herný deň = 1 reálna minúta (60 000 ms)
// 1 herná hodina = 60 000 / 24 = 2 500 ms
const MS_PER_GAME_DAY = 60000
const MS_PER_GAME_HOUR = MS_PER_GAME_DAY / 24

// Vypočítané herné dni a hodiny
const gameDays = computed(() => {
  return Math.floor(gameTimeMs.value / MS_PER_GAME_DAY) + 1  // Začíname od dňa 1
})

const gameHours = computed(() => {
  const remainingMs = gameTimeMs.value % MS_PER_GAME_DAY
  return Math.floor(remainingMs / MS_PER_GAME_HOUR)
})

const gameMinutes = computed(() => {
  const remainingMs = gameTimeMs.value % MS_PER_GAME_HOUR
  return Math.floor(remainingMs / (MS_PER_GAME_HOUR / 60))
})

// Formátovaný čas
const formattedTime = computed(() => {
  const h = String(gameHours.value).padStart(2, '0')
  const m = String(gameMinutes.value).padStart(2, '0')
  return `${h}:${m}`
})

// Denná/nočná fáza
const dayPhase = computed(() => {
  const hour = gameHours.value
  if (hour >= 6 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 21) return 'evening'
  return 'night'
})

const dayPhaseIcon = computed(() => {
  switch (dayPhase.value) {
    case 'morning': return '🌅'
    case 'afternoon': return '☀️'
    case 'evening': return '🌇'
    case 'night': return '🌙'
    default: return '☀️'
  }
})

// Spusti ticker
const startClock = () => {
  if (intervalId) return
  lastTick = Date.now()
  intervalId = setInterval(() => {
    if (!props.paused) {
      const now = Date.now()
      const delta = now - lastTick
      gameTimeMs.value += delta
      emit('update:gameTime', gameTimeMs.value)
    }
    lastTick = Date.now()
  }, 250) // Update 4x za sekundu pre plynulý progress
}

const stopClock = () => {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
    lastTick = null
  }
}

// Watch na zmeny initialTime (pri načítaní projektu)
watch(() => props.initialTime, (newVal) => {
  gameTimeMs.value = newVal || 0
})

onMounted(() => {
  startClock()
})

onUnmounted(() => {
  stopClock()
})
</script>

<template>
  <div class="game-clock">
    <div class="clock-display">
      <div class="clock-day">
        <span class="day-label">Day</span>
        <span class="day-value">{{ gameDays }}</span>
      </div>
      <div class="clock-divider"></div>
      <div class="clock-time">
        <span class="time-icon">{{ dayPhaseIcon }}</span>
        <span class="time-value">{{ formattedTime }}</span>
      </div>
    </div>
    <!-- Progress bar pre aktuálny deň -->
    <div class="day-progress">
      <div 
        class="day-progress-fill" 
        :class="dayPhase"
        :style="{ width: ((gameTimeMs % MS_PER_GAME_DAY) / MS_PER_GAME_DAY * 100) + '%' }"
      ></div>
    </div>
  </div>
</template>

<style scoped>
.game-clock {
  width: 210px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-bottom: 2px solid #0f3460;
  padding: 0.5rem 0.75rem;
  color: white;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
}

.clock-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.4rem;
}

.clock-icon {
  font-size: 0.85rem;
}

.clock-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.8;
}

.clock-display {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}

.clock-day {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.day-label {
  font-size: 0.6rem;
  text-transform: uppercase;
  opacity: 0.6;
  letter-spacing: 1px;
}

.day-value {
  font-size: 1.4rem;
  font-weight: 700;
  background: linear-gradient(135deg, #f59e0b, #f97316);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  line-height: 1.2;
}

.clock-divider {
  width: 1px;
  height: 30px;
  background: rgba(255, 255, 255, 0.2);
}

.clock-time {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.time-icon {
  font-size: 1.1rem;
}

.time-value {
  font-size: 1.3rem;
  font-weight: 600;
  font-family: 'Courier New', monospace;
  letter-spacing: 1px;
}

.day-progress {
  margin-top: 0.4rem;
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.day-progress-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.25s linear;
}

.day-progress-fill.morning {
  background: linear-gradient(90deg, #f59e0b, #fbbf24);
}

.day-progress-fill.afternoon {
  background: linear-gradient(90deg, #fbbf24, #f97316);
}

.day-progress-fill.evening {
  background: linear-gradient(90deg, #f97316, #7c3aed);
}

.day-progress-fill.night {
  background: linear-gradient(90deg, #7c3aed, #3b82f6);
}
</style>
