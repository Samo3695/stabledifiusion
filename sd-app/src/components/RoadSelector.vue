<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  roadBuildingMode: {
    type: Boolean,
    default: false
  },
  roadDeleteMode: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['road-mode-toggled', 'road-delete-mode-toggled'])

const toggleRoadMode = () => {
  emit('road-mode-toggled', !props.roadBuildingMode)
}

const toggleRoadDeleteMode = () => {
  emit('road-delete-mode-toggled', !props.roadDeleteMode)
}
</script>

<template>
  <div class="road-selector">
    <div class="section-header">
      <h3>🛣️ Roads</h3>
    </div>
    
    <div class="road-content">
      <div
        :class="['road-item', { active: roadBuildingMode }]"
        @click="toggleRoadMode"
        title="Road Building Mode"
      >
        <div class="road-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12h18M3 6h18M3 18h18"/>
            <circle cx="7" cy="12" r="1" fill="currentColor"/>
            <circle cx="12" cy="12" r="1" fill="currentColor"/>
            <circle cx="17" cy="12" r="1" fill="currentColor"/>
          </svg>
        </div>
        <div class="road-info">
          <span class="road-label">Build Road</span>
          <span class="road-hint">Click to {{ roadBuildingMode ? 'disable' : 'enable' }}</span>
        </div>
        <div v-if="roadBuildingMode" class="active-indicator">✓</div>
      </div>
      
      <div
        :class="['road-item', { active: roadDeleteMode }]"
        @click="toggleRoadDeleteMode"
        title="Bulldozer Mode - Delete buildings and roads"
      >
        <div class="road-icon bulldozer">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="12" width="8" height="6" rx="1"/>
            <path d="M10 18h6"/>
            <circle cx="19" cy="18" r="2"/>
            <circle cx="7" cy="18" r="2"/>
            <path d="M2 12V8a2 2 0 0 1 2-2h6"/>
            <path d="M10 8h6"/>
            <path d="M16 8V6a2 2 0 0 1 2-2h2"/>
          </svg>
        </div>
        <div class="road-info">
          <span class="road-label">Bulldozer</span>
          <span class="road-hint">Delete buildings & roads</span>
        </div>
        <div v-if="roadDeleteMode" class="active-indicator">✓</div>
      </div>
      
      <div v-if="roadBuildingMode" class="instruction-text build">
        Click cells on the map to build roads
      </div>
      
      <div v-if="roadDeleteMode" class="instruction-text delete">
        Click on buildings or roads to delete them
      </div>
    </div>
  </div>
</template>

<style scoped>
.road-selector {
  background: white;
  border-radius: 12px;
  padding: 1rem;
  margin-top: 1rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #f0f0f0;
}

.section-header h3 {
  margin: 0;
  font-size: 1.1rem;
  color: #333;
}

.road-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.road-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid #e5e7eb;
  background: #f8f9fa;
}

.road-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border-color: #667eea;
}

.road-item.active {
  border-color: #10b981;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.1) 100%);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
}

.road-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 8px;
  color: white;
  flex-shrink: 0;
}

.road-item.active .road-icon {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
}

.road-icon.bulldozer {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
}

.road-item.active .road-icon.bulldozer {
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
}

.road-icon svg {
  width: 24px;
  height: 24px;
}

.road-info {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}

.road-label {
  font-weight: 600;
  color: #333;
  font-size: 0.9rem;
}

.road-hint {
  font-size: 0.75rem;
  color: #666;
}

.active-indicator {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  font-weight: bold;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
}

.instruction-text {
  padding: 0.75rem;
  border-radius: 6px;
  font-size: 0.85rem;
  text-align: center;
  font-weight: 500;
}

.instruction-text.build {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.05) 100%);
  color: #059669;
  border: 1px dashed #10b981;
}

.instruction-text.delete {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(220, 38, 38, 0.05) 100%);
  color: #dc2626;
  border: 1px dashed #ef4444;
}
</style>
