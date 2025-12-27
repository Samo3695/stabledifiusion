<script setup>
import { ref } from 'vue'
import BuildingGenerator from './components/BuildingGenerator.vue'
import EnvironmentGenerator from './components/EnvironmentGenerator.vue'
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
const showNumbering = ref(false)
const showGallery = ref(false)
const showGrid = ref(true)
const activeGenerator = ref('building') // 'building' alebo 'environment'
const deleteMode = ref(false) // Režim mazania buildingov

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

const handleGridSizeChanged = ({ cellsX, cellsY }) => {
  lastImageCellsX.value = cellsX
  lastImageCellsY.value = cellsY
  console.log(`🔳 App.vue: Grid size zmenéný na ${cellsX}x${cellsY} políčok`)
}

const handleDeleteModeChanged = (isDeleteMode) => {
  deleteMode.value = isDeleteMode
  console.log(`🗑️ App.vue: Delete mode ${isDeleteMode ? 'zapnutý' : 'vypnutý'}`)
  // Zruš výber obrázku z galérie v delete mode
  if (isDeleteMode) {
    selectedImageId.value = null
  }
}

const handlePlaceOnBoard = (image) => {
  console.log('📌 App.vue: Prijatý place-on-board event pre obrázok:', image.id)
  
  if (canvasRef.value && selectedCell.value.row !== -1 && selectedCell.value.col !== -1) {
    // Ak je vybraté políčko, vlož obrázok tam
    const cellsX = image.cellsX || lastImageCellsX.value
    const cellsY = image.cellsY || lastImageCellsY.value
    console.log('🎯 Vkladám obrázok na políčko:', selectedCell.value, `s veľkosťou ${cellsX}x${cellsY}`)
    canvasRef.value.placeImageAtSelectedCell(image.url, cellsX, cellsY)
  } else if (canvasRef.value) {
    // Inak vlož obrázok na prvé voľné políčko
    console.log('🎯 Vkladám obrázok na prvé voľné políčko')
    const cellsX = image.cellsX || lastImageCellsX.value
    const cellsY = image.cellsY || lastImageCellsY.value
    // Vyber prvé políčko ako fallback
    selectedCell.value = { row: 0, col: 0 }
    canvasRef.value.placeImageAtSelectedCell(image.url, cellsX, cellsY)
  } else {
    console.warn('⚠️ Canvas ref neexistuje - nemôžem vložiť obrázok')
  }
}

const handleTemplateSelected = (isSelected) => {
  templateSelected.value = isSelected
  // Zruš výber obrázku z galérie keď sa vyberie template
  if (isSelected) {
    selectedImageId.value = null
    console.log('🎨 App.vue: Template vybraný, zrušený výber obrázku z galérie')
  }
}

const handleTabChanged = ({ cellsX, cellsY }) => {
  lastImageCellsX.value = cellsX
  lastImageCellsY.value = cellsY
}

const handleCellSelected = ({ row, col }) => {
  selectedCell.value = { row, col }
  console.log(`App.vue: Políčko vybrané [${row}, ${col}]`)
  
  // Ak je aktualívny režim mazania, vymaž building na políčku
  if (deleteMode.value && canvasRef.value) {
    console.log(`🗑️ App.vue: Režim mazania - vymazanie buildingu na [${row}, ${col}]`)
    canvasRef.value.deleteImageAtCell(row, col)
    return // Nevykonaj generovanie ani umiestnovanie
  }
  
  // Ak je vybraný obrázok z galérie, vlož ho na toto políčko
  if (selectedImageId.value && canvasRef.value) {
    const selectedImage = images.value.find(img => img.id === selectedImageId.value)
    if (selectedImage) {
      console.log(`🖼️ App.vue: Vkladám vybraný obrázok z galérie (${selectedImageId.value})`)
      const cellsX = selectedImage.cellsX || lastImageCellsX.value
      const cellsY = selectedImage.cellsY || lastImageCellsY.value
      canvasRef.value.placeImageAtSelectedCell(selectedImage.url, cellsX, cellsY)
      return // Nevykonaj generovanie
    }
  }
  
  // Inak spusti automatické generovanie
  console.log(`🚀 App.vue: Spúšťam automatické generovanie...`)
  if (imageGeneratorRef.value) {
    imageGeneratorRef.value.startGeneration()
  }
}

const handleImagePlaced = ({ row, col }) => {
  selectedCell.value = { row: -1, col: -1 }
  console.log(`App.vue: Obrázok vložený na [${row}, ${col}]`)
}

const handleNumberingChanged = (value) => {
  showNumbering.value = value
  console.log(`App.vue: Číslovanie šachovnice ${value ? 'zapnuté' : 'vypnuté'}`)
}

const handleToggleNumbering = (value) => {
  showNumbering.value = value
  console.log(`App.vue: Číslovanie prepnuté z canvas: ${value ? 'zapnuté' : 'vypnuté'}`)
}

const handleToggleGallery = (value) => {
  showGallery.value = value
  console.log(`App.vue: Galéria prepnutá z canvas: ${value ? 'zobrazená' : 'skrytá'}`)
}

const handleToggleGrid = (value) => {
  showGrid.value = value
  console.log(`App.vue: Mriežka prepnutá z canvas: ${value ? 'zobrazená' : 'skrytá'}`)
}

const handleEnvironmentGenerated = (envData) => {
  console.log('🌍 App.vue: Prijaté environment-generated event')
  console.log('   Počet obrázkov:', envData.images.length)
  console.log('   Počet prvkov na rozmiestniť:', envData.count)
  console.log('   Canvas ref existuje?', canvasRef.value ? 'ÁNO' : 'NIE')
  
  // Náhodne rozmiestni prvky na šachovnici
  if (canvasRef.value && canvasRef.value.placeEnvironmentElements) {
    canvasRef.value.placeEnvironmentElements(envData.images, envData.count)
    console.log('✅ Prvky prostredia rozmiestnené')
  }
}

const handleTilesGenerated = (tilesData) => {
  console.log('🎨 App.vue: Prijaté tiles-generated event')
  console.log('   Počet tile-ov:', tilesData.tiles.length)
  console.log('   Tiles per image:', tilesData.tilesPerImage)
  console.log('   Canvas ref existuje?', canvasRef.value ? 'ÁNO' : 'NIE')
  
  // Pošli tile-y do CheckerboardCanvas
  if (canvasRef.value && canvasRef.value.setBackgroundTiles) {
    canvasRef.value.setBackgroundTiles(tilesData.tiles, tilesData.tilesPerImage || 1)
    console.log('✅ Tile-y aplikované na šachovnicu')
  }
}
</script>

<template>
  <div id="app">
    <!-- Canvas na pozadí (celá obrazovka) -->
    <CheckerboardCanvas
      ref="canvasRef"
      :images="images" 
      :selectedImageId="selectedImageId"
      :lastImageCellsX="lastImageCellsX"
      :lastImageCellsY="lastImageCellsY"
      :templateSelected="templateSelected"
      :showNumbering="showNumbering"
      :showGallery="showGallery"
      :showGrid="showGrid"
      :deleteMode="deleteMode"
      @cell-selected="handleCellSelected"
      @image-placed="handleImagePlaced"
      @toggle-numbering="handleToggleNumbering"
      @toggle-gallery="handleToggleGallery"
      @toggle-grid="handleToggleGrid"
    />
    
    <!-- Header (absolútne pozicionovaný) -->

    
    <!-- Pravý sidebar s nástrojmi (absolútne pozicionovaný) -->
    <aside class="sidebar">
      <!-- Switcher -->
      <div class="generator-switcher">
        <button 
          :class="{ active: activeGenerator === 'building' }"
          @click="activeGenerator = 'building'"
        >
          🏗️ Building
        </button>
        <button 
          :class="{ active: activeGenerator === 'environment' }"
          @click="activeGenerator = 'environment'"
        >
          🌍 Environment
        </button>
      </div>
      
      <!-- Building Generator -->
      <BuildingGenerator
        v-if="activeGenerator === 'building'"
        ref="imageGeneratorRef"
        @image-generated="handleImageGenerated" 
        @template-selected="handleTemplateSelected"
        @tab-changed="handleTabChanged"
        @numbering-changed="handleNumberingChanged"
      />
      
      <!-- Environment Generator -->
      <EnvironmentGenerator
        v-if="activeGenerator === 'environment'"
        @environment-generated="handleEnvironmentGenerated"
        @tiles-generated="handleTilesGenerated"
      />
    </aside>
    
    <!-- Galéria dole (absolútne pozicionovaná) -->
    <div v-if="showGallery" class="gallery-container">
      <ImageGallery 
        :images="images" 
        :selectedImageId="selectedImageId"
        @delete="handleDelete" 
        @select="handleSelectImage"
        @place-on-board="handlePlaceOnBoard"
        @grid-size-changed="handleGridSizeChanged"
        @delete-mode-changed="handleDeleteModeChanged"
      />
    </div>
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
  overflow: hidden;
}

#app {
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
  padding: 0;
}

header {
  position: absolute;
  top: 0;
  left: 0;
  right: 380px;
  padding: 1rem 2rem;
  text-align: center;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
  z-index: 10;
  pointer-events: none;
}

header h1 {
  margin: 0;
  font-size: 1.8rem;
  font-weight: bold;
  color: white;
}

.sidebar {
  position: absolute;
  top: 0;
  right: 0;
  width: 230px;
  height: 100vh;
  background: white;
  overflow-y: auto;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.3);
  z-index: 20;
}

.gallery-container {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 380px;
  height: 125px;
  z-index: 10;
  overflow-x: auto;
  overflow-y: hidden;
}

.generator-switcher {
  display: flex;
  gap: 0;
  background: #f0f0f0;
  padding: 0.5rem;
  border-bottom: 2px solid #e0e0e0;
}

.generator-switcher button {
  flex: 1;
  padding: 0.75rem 1rem;
  border: none;
  background: transparent;
  color: #666;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
  border-radius: 6px;
}

.generator-switcher button:hover {
  background: rgba(102, 126, 234, 0.1);
  color: #667eea;
}

.generator-switcher button.active {
  background: #667eea;
  color: white;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
}
</style>
