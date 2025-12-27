<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  images: Array,
  selectedImageId: String
})

const emit = defineEmits(['delete', 'select', 'place-on-board', 'grid-size-changed', 'delete-mode-changed'])

const selectedImage = ref(null)
const selectedGridSize = ref(1) // 1, 4, 9, 16, 25, alebo -1 pre režim mazania

// Watch grid size changes and emit to parent
watch(selectedGridSize, (newSize) => {
  if (newSize === -1) {
    // Delete mode: 1x1 hover, but in delete mode
    emit('grid-size-changed', { cellsX: 1, cellsY: 1 })
    emit('delete-mode-changed', true)
  } else {
    const cellsPerSide = Math.sqrt(newSize)
    emit('grid-size-changed', { cellsX: cellsPerSide, cellsY: cellsPerSide })
    emit('delete-mode-changed', false)
  }
})

const openModal = (image) => {
  selectedImage.value = image
}

const closeModal = () => {
  selectedImage.value = null
}

const downloadImage = (image) => {
  const link = document.createElement('a')
  link.href = image.url
  link.download = `stable-diffusion-${image.id}.png`
  link.click()
}

const deleteImage = (id) => {
  if (confirm('Naozaj chcete vymazať tento obrázok?')) {
    emit('delete', id)
    if (selectedImage.value?.id === id) {
      closeModal()
    }
  }
}

const placeOnBoard = () => {
  const selected = images.find(img => img.id === props.selectedImageId)
  if (selected) {
    // Vypočítaj cellsX a cellsY podľa selectedGridSize
    const cellsPerSide = Math.sqrt(selectedGridSize.value)
    emit('place-on-board', {
      ...selected,
      cellsX: cellsPerSide,
      cellsY: cellsPerSide
    })
  }
}

const formatDate = (date) => {
  return new Date(date).toLocaleString('sk-SK')
}
</script>

<template>
  <!-- Grid size tabs -->
  <div class="grid-size-tabs">
    <button 
      @click="selectedGridSize = 1" 
      :class="{ active: selectedGridSize === 1 }"
      class="size-btn"
      title="1 políčko (1x1)"
    >
      1
    </button>
    <button 
      @click="selectedGridSize = 4" 
      :class="{ active: selectedGridSize === 4 }"
      class="size-btn"
      title="4 políčka (2x2)"
    >
      4
    </button>
    <button 
      @click="selectedGridSize = 9" 
      :class="{ active: selectedGridSize === 9 }"
      class="size-btn"
      title="9 políčok (3x3)"
    >
      9
    </button>
    <button 
      @click="selectedGridSize = 16" 
      :class="{ active: selectedGridSize === 16 }"
      class="size-btn"
      title="16 políčok (4x4)"
    >
      16
    </button>
    <button 
      @click="selectedGridSize = 25" 
      :class="{ active: selectedGridSize === 25 }"
      class="size-btn"
      title="25 políčok (5x5)"
    >
      25
    </button>
    <button 
      @click="selectedGridSize = -1" 
      :class="{ active: selectedGridSize === -1, 'delete-btn': true }"
      class="size-btn"
      title="Režim mazania - kliknite na políčko na šachovnici pre vymazanie"
    >
      🗑️
    </button>
  </div>
  
  <div class="gallery">
    
    <div v-if="images.length === 0" class="empty-state">
      <p>📷 Zatiaľ nemáte žiadne vygenerované obrázky</p>
      <p>Začnite generovaním svojho prvého obrázka!</p>
    </div>

    <div v-else class="gallery-grid">
      <div 
        v-for="image in images" 
        :key="image.id" 
        :class="['gallery-item', { 'selected': image.id === selectedImageId }]"
        @click="emit('select', image.id)"
        @dblclick="openModal(image)"
      >
        <img :src="image.url" :alt="image.prompt" />
        <div class="image-overlay">
          <p class="prompt-preview">{{ image.prompt }}</p>
        </div>
        <div v-if="image.id === selectedImageId" class="selected-badge">✓</div>
      </div>
    </div>

    <!-- Modal -->
    <Teleport to="body">
      <div v-if="selectedImage" class="modal-overlay" @click="closeModal">
        <div class="modal-content" @click.stop>
          <button class="close-btn" @click="closeModal">✕</button>
          
          <img :src="selectedImage.url" :alt="selectedImage.prompt" class="modal-image" />
          
          <div class="modal-info">
            <div class="info-section">
              <h3>Prompt:</h3>
              <p>{{ selectedImage.prompt }}</p>
            </div>
            
            <div v-if="selectedImage.negativePrompt" class="info-section">
              <h3>Negatívny prompt:</h3>
              <p>{{ selectedImage.negativePrompt }}</p>
            </div>
            
            <div class="info-section">
              <h3>Vytvorené:</h3>
              <p>{{ formatDate(selectedImage.timestamp) }}</p>
            </div>

            <div class="modal-actions">
              <button @click="downloadImage(selectedImage)" class="btn-download">
                💾 Stiahnuť
              </button>
              <button @click="deleteImage(selectedImage.id)" class="btn-delete">
                🗑️ Vymazať
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.gallery {
  background: white;
  color: #333;
  border-radius: 0 0 16px 16px;
  padding: 0.5rem;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
  border: 1px solid #a2a9b1;
  border-top: none;
}

/* Grid size tabs */
.grid-size-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 0;
  padding: 0;
  border-bottom: 1px solid #a2a9b1;
  max-width: 300px;
}

.size-btn {
  flex: 1;
  padding: 0.5rem 1rem;
  border: 1px solid transparent;
  border-radius: 4px 4px 0 0;
  background: #f8f9fa;
  font-weight: 500;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
  color: #202122;
  position: relative;
  margin-bottom: -1px;
}

.size-btn:hover {
  background: #fff;
  color: #202122;
}

.size-btn.active {
  background: #fff;
  color: #202122;
  border-color: #a2a9b1;
  border-bottom-color: #fff;
  font-weight: 600;
}

.size-btn.delete-btn {
  color: #d32f2f;
}

.size-btn.delete-btn:hover {
  background: #ffebee;
}

.size-btn.delete-btn.active {
  background: #fff;
  color: #d32f2f;
  border-color: #a2a9b1;
  border-bottom-color: #fff;
}

.gallery-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

h2 {
  margin: 0;
  color: #667eea;
}

.btn-place-on-board {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.3s;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.btn-place-on-board:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
}

.btn-place-on-board:active {
  transform: translateY(0);
}

.empty-state {
  text-align: center;
  padding: 3rem;
  color: #999;
}

.empty-state p {
  margin: 0.5rem 0;
  font-size: 1.1rem;
}

.gallery-grid {
  display: flex;
  gap: 5px;
}

.gallery-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  border: 3px solid transparent;
  width: 70px;
}

.gallery-item:hover {
  transform: translateY(-5px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.gallery-item.selected {
  border-color: #10b981;
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.2);
}

.selected-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  font-weight: bold;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.gallery-item img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.image-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent);
  padding: 1rem;
  opacity: 0;
  transition: opacity 0.3s;
}

.gallery-item:hover .image-overlay {
  opacity: 1;
}

.prompt-preview {
  color: white;
  font-size: 0.85rem;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 2rem;
  animation: fadeIn 0.3s;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal-content {
  background: white;
  border-radius: 16px;
  max-width: 900px;
  max-height: 90vh;
  overflow: auto;
  position: relative;
  animation: slideUp 0.3s;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.close-btn {
  position: absolute;
  top: 1rem;
  right: 1rem;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.5);
  color: white;
  font-size: 1.5rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  transition: background 0.3s;
}

.close-btn:hover {
  background: rgba(0, 0, 0, 0.8);
}

.modal-image {
  width: 100%;
  display: block;
  border-radius: 16px 16px 0 0;
}

.modal-info {
  padding: 2rem;
}

.info-section h3 {
  margin: 0 0 0.5rem 0;
  color: #667eea;
  font-size: 1rem;
}

.info-section p {
  margin: 0;
  color: #555;
  line-height: 1.6;
}

.modal-actions {
  display: flex;
  gap: 1rem;
}

.modal-actions button {
  flex: 1;
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.btn-download {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.btn-download:hover {
  transform: translateY(-2px);
  box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
}

.btn-delete {
  background: #fee;
  color: #c33;
}

.btn-delete:hover {
  background: #fdd;
}
</style>
