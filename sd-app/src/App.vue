<script setup>
import { ref } from 'vue'
import ImageGenerator from './components/ImageGenerator.vue'
import ImageGallery from './components/ImageGallery.vue'
import CheckerboardCanvas from './components/CheckerboardCanvas.vue'

const images = ref([])

const handleImageGenerated = (image) => {
  images.value.unshift(image)
}

const handleDelete = (id) => {
  images.value = images.value.filter(img => img.id !== id)
}
</script>

<template>
  <div id="app">
    <header>
      <h1>🎨 Stable Diffusion Generator</h1>
    </header>
    <main>
      <!-- Ľavá plocha pre obsah -->
      <div class="content-area">
        <CheckerboardCanvas />
        <ImageGallery :images="images" @delete="handleDelete" />
      </div>
      
      <!-- Pravý sidebar s nástrojmi -->
      <aside class="sidebar">
        <ImageGenerator @image-generated="handleImageGenerated" />
      </aside>
    </main>
  </div>
</template>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell,
    'Helvetica Neue', sans-serif;
}

#app {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  display: flex;
  flex-direction: column;
  width: 100%;
}

header {
  padding: 1.5rem 2rem;
  text-align: center;
  background: rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(10px);
}

header h1 {
  margin: 0;
  font-size: 2rem;
  font-weight: bold;
}

main {
  flex: 1;
  display: flex;
  gap: 0;
  height: calc(100vh - 80px);
  overflow: hidden;
}

.content-area {
  flex: 1;
  padding: 2rem;
  overflow-y: auto;
  background: rgba(255, 255, 255, 0.05);
}

.sidebar {
  width: 350px;
  background: white;
  overflow-y: auto;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.2);
}
</style>
