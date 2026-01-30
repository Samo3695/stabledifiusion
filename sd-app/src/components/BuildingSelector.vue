<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  buildings: {
    type: Array,
    default: () => []
  },
  selectedBuildingId: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['building-selected'])

// Mapovanie buildingSize na počet políčok
const getSizeFromBuildingSize = (buildingSize) => {
  switch (buildingSize) {
    case '1x1': return { cellsX: 1, cellsY: 1 }
    case '2x2': return { cellsX: 2, cellsY: 2 }
    case '3x3': return { cellsX: 3, cellsY: 3 }
    case '4x4': return { cellsX: 4, cellsY: 4 }
    case '5x5': return { cellsX: 5, cellsY: 5 }
    default: return { cellsX: 1, cellsY: 1 } // default veľkosť
  }
}

const selectBuilding = (building) => {
  // Ak je budova už vybraná, odznač ju
  if (building.id === props.selectedBuildingId) {
    emit('building-selected', null)
    return
  }
  
  const size = getSizeFromBuildingSize(building.buildingData?.buildingSize || 'default')
  emit('building-selected', {
    building,
    cellsX: size.cellsX,
    cellsY: size.cellsY
  })
}

// Počet budov
const buildingCount = computed(() => props.buildings.length)
</script>

<template>
  <div class="building-selector">
    <div class="section-header">
      <h3>🏗️ Buildings</h3>
      <span class="building-count">{{ buildingCount }}</span>
    </div>
    
    <div v-if="buildingCount === 0" class="empty-state">
      <p>Žiadne budovy</p>
      <p class="hint">Načítajte projekt s budovami</p>
    </div>
    
    <div v-else class="building-grid">
      <div
        v-for="building in buildings"
        :key="building.id"
        :class="['building-item', { selected: building.id === selectedBuildingId }]"
        @click="selectBuilding(building)"
        :title="building.buildingData?.buildingName || 'Building'"
      >
        <img :src="building.url" :alt="building.buildingData?.buildingName || 'Building'" />
        <div class="building-info">
          <span class="building-name">{{ building.buildingData?.buildingName || 'Building' }}</span>
          <span class="building-size">{{ building.buildingData?.buildingSize || '1x1' }}</span>
        </div>
        <div v-if="building.id === selectedBuildingId" class="selected-indicator">✓</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.building-selector {
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

.building-count {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.85rem;
  font-weight: 600;
}

.empty-state {
  text-align: center;
  padding: 2rem 1rem;
  color: #999;
}

.empty-state p {
  margin: 0.5rem 0;
}

.hint {
  font-size: 0.85rem;
  color: #bbb;
}

.building-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 0.75rem;
}

.building-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;
  background: #f8f9fa;
}

.building-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border-color: #667eea;
}

.building-item.selected {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
}

.building-item img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 0.25rem;
}

.building-info {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent);
  padding: 0.5rem 0.25rem 0.25rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.building-item:hover .building-info {
  opacity: 1;
}

.building-name {
  color: white;
  font-size: 0.7rem;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.building-size {
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.65rem;
  font-weight: 500;
}

.selected-indicator {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: bold;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}
</style>
