<script setup>
import { ref } from 'vue'
import ImageGenerator from './components/ImageGenerator.vue'
import ImageGallery from './components/ImageGallery.vue'

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
      <ImageGenerator @image-generated="handleImageGenerated" />
      <ImageGallery :images="images" @delete="handleDelete" />
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
}

header {
  padding: 2rem;
  text-align: center;
  background: rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(10px);
}

header h1 {
  margin: 0;
  font-size: 2.5rem;
  font-weight: bold;
}

main {
  padding: 2rem;
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 3rem;
}
</style>
