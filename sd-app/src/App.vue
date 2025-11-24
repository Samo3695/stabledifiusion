<script setup>
import { ref } from 'vue'
import ImageGenerator from './components/ImageGenerator.vue'
import ImageGallery from './components/ImageGallery.vue'
import CheckerboardCanvas from './components/CheckerboardCanvas.vue'

const images = ref([])
const lastImageCellsX = ref(1)
const lastImageCellsY = ref(1)
const selectedImageId = ref(null)
const templateSelected = ref(false)
const selectedCell = ref({ row: -1, col: -1 })
const canvasRef = ref(null)
const imageGeneratorRef = ref(null)

const handleImageGenerated = (image, cellsX = 1, cellsY = 1) => {
  console.log('📥 App.vue: Prijatý image-generated event')
  console.log('   Image ID:', image.id)
  console.log('   CellsX x CellsY:', cellsX, 'x', cellsY)
  console.log('   Vybrané políčko:', selectedCell.value)
  console.log('   Canvas ref existuje?', canvasRef.value ? 'ÁNO' : 'NIE')
  
  images.value.unshift(image)
  lastImageCellsX.value = cellsX
  lastImageCellsY.value = cellsY
  // Automaticky vyberieme nový obrázok
  selectedImageId.value = image.id
  
  // Ak je vybrané políčko, vlož obrázok tam
  if (selectedCell.value.row !== -1 && selectedCell.value.col !== -1 && canvasRef.value) {
    console.log('🎯 App.vue: Volám placeImageAtSelectedCell()')
    console.log('   URL:', image.url.substring(0, 50) + '...')
    const result = canvasRef.value.placeImageAtSelectedCell(image.url, cellsX, cellsY)
    console.log('   Výsledok vloženia:', result ? 'ÚSPECH' : 'ZLYHALO')
  } else {
    console.log('⚠️ App.vue: Nevkladám obrázok - políčko nie je vybrané alebo canvas neexistuje')
  }
}

const handleDelete = (id) => {
  images.value = images.value.filter(img => img.id !== id)
  // Ak sme vymazali vybraný obrázok, zrušíme výber
  if (selectedImageId.value === id) {
    selectedImageId.value = images.value.length > 0 ? images.value[0].id : null
  }
}

const handleSelectImage = (id) => {
  selectedImageId.value = id
}

const handleTemplateSelected = (isSelected) => {
  templateSelected.value = isSelected
}

const handleTabChanged = ({ cellsX, cellsY }) => {
  lastImageCellsX.value = cellsX
  lastImageCellsY.value = cellsY
}

const handleCellSelected = ({ row, col }) => {
  selectedCell.value = { row, col }
  console.log(`App.vue: Políčko vybrané [${row}, ${col}]`)
  console.log(`🚀 App.vue: Spúšťam automatické generovanie...`)
  // Spusti generovanie automaticky
  if (imageGeneratorRef.value) {
    imageGeneratorRef.value.startGeneration()
  }
}

const handleImagePlaced = ({ row, col }) => {
  selectedCell.value = { row: -1, col: -1 }
  console.log(`App.vue: Obrázok vložený na [${row}, ${col}]`)
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
        <CheckerboardCanvas
          ref="canvasRef"
          :images="images" 
          :selectedImageId="selectedImageId"
          :lastImageCellsX="lastImageCellsX"
          :lastImageCellsY="lastImageCellsY"
          :templateSelected="templateSelected"
          @cell-selected="handleCellSelected"
          @image-placed="handleImagePlaced"
        />
        <ImageGallery 
          :images="images" 
          :selectedImageId="selectedImageId"
          @delete="handleDelete" 
          @select="handleSelectImage"
        />
      </div>
      
      <!-- Pravý sidebar s nástrojmi -->
      <aside class="sidebar">
        <ImageGenerator
          ref="imageGeneratorRef"
          @image-generated="handleImageGenerated" 
          @template-selected="handleTemplateSelected"
          @tab-changed="handleTabChanged"
        />
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
