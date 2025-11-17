<script setup>
import { ref } from 'vue'

const props = defineProps({
  images: Array
})

const emit = defineEmits(['delete'])

const selectedImage = ref(null)

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

const formatDate = (date) => {
  return new Date(date).toLocaleString('sk-SK')
}
</script>

<template>
  <div class="gallery">
    <h2>Galéria obrázkov ({{ images.length }})</h2>
    
    <div v-if="images.length === 0" class="empty-state">
      <p>📷 Zatiaľ nemáte žiadne vygenerované obrázky</p>
      <p>Začnite generovaním svojho prvého obrázka!</p>
    </div>

    <div v-else class="gallery-grid">
      <div 
        v-for="image in images" 
        :key="image.id" 
        class="gallery-item"
        @click="openModal(image)"
      >
        <img :src="image.url" :alt="image.prompt" />
        <div class="image-overlay">
          <p class="prompt-preview">{{ image.prompt }}</p>
        </div>
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
  border-radius: 16px;
  padding: 2rem;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
}

h2 {
  margin-top: 0;
  color: #667eea;
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
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1.5rem;
  margin-top: 1.5rem;
}

.gallery-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.3s;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.gallery-item:hover {
  transform: translateY(-5px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.gallery-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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

.info-section {
  margin-bottom: 1.5rem;
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
  margin-top: 2rem;
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
