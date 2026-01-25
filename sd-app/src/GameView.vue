<script setup>
import { ref, watch, nextTick } from 'vue'
import ImageGallery from './components/ImageGallery.vue'
import PhaserCanvas from './components/PhaserCanvas.vue'
import ProjectManager from './components/ProjectManager.vue'
import ResourceDisplay from './components/ResourceDisplay.vue'
import { buildRoad, regenerateRoadTilesOnCanvas } from './utils/roadBuilder.js'

const images = ref([])
const lastImageCellsX = ref(1)
const lastImageCellsY = ref(1)
const selectedImageId = ref(null)
const selectedImageData = ref(null)
const templateSelected = ref(false)
const selectedCell = ref({ row: -1, col: -1 })
const canvasRef = ref(null)
const showNumbering = ref(false)
const showGallery = ref(true)
const showGrid = ref(true)
const deleteMode = ref(false)
const environmentColors = ref({ hue: 0, saturation: 100, brightness: 100 })
const textureSettings = ref({ tilesPerImage: 1, tileResolution: 512, customTexture: null })
const roadBuildingMode = ref(false)
const roadTiles = ref([])
const imageGalleryRef = ref(null)
const isLoading = ref(false)
const loadingProgress = ref(0)
const loadingStatus = ref('')
const personSpawnEnabled = ref(false)
const personSpawnCount = ref(0)
const resources = ref([])
const workforce = ref([])
const roadSpriteUrl = ref('/templates/roads/sprites/pastroad.png')
const roadOpacity = ref(100)

const handleDelete = (id) => {
  images.value = images.value.filter(img => img.id !== id)
  if (selectedImageId.value === id) {
    selectedImageId.value = images.value.length > 0 ? images.value[0].id : null
  }
}

const handleSelectImage = ({ id, imageData }) => {
  selectedImageId.value = id
  selectedImageData.value = imageData
  console.log(`🖼️ GameView: Vybraný obrázok ID: ${id}`)
}

const handleGridSizeChanged = ({ cellsX, cellsY }) => {
  lastImageCellsX.value = cellsX
  lastImageCellsY.value = cellsY
}

const handleDeleteModeChanged = (isDeleteMode) => {
  deleteMode.value = isDeleteMode
  if (isDeleteMode) {
    selectedImageId.value = null
  }
}

const handleRoadBuildingModeChanged = (isRoadMode) => {
  roadBuildingMode.value = isRoadMode
}

const handleRoadTilesReady = (tiles) => {
  roadTiles.value = tiles
}

const handlePersonSpawnSettingsChanged = ({ enabled, count }) => {
  personSpawnEnabled.value = !!enabled
  const parsed = Number.isFinite(count) ? count : 0
  personSpawnCount.value = Math.max(0, Math.min(500, Math.round(parsed)))
}

watch(roadTiles, (newTiles, oldTiles) => {
  if (oldTiles && oldTiles.length > 0 && newTiles.length > 0) {
    const oldOpacity = oldTiles[0]?.opacity || 100
    const newOpacity = newTiles[0]?.opacity || 100
    
    if (oldOpacity !== newOpacity && canvasRef.value) {
      regenerateRoadTilesOnCanvas(canvasRef.value, newTiles)
    }
  }
}, { deep: true })

const handleRoadOpacityChanged = (newOpacity) => {
  roadOpacity.value = newOpacity
}

const handleRoadPlaced = ({ path }) => {
  buildRoad(canvasRef.value, roadTiles.value, path)
}

const handlePlaceOnBoard = (image) => {
  if (canvasRef.value && selectedCell.value.row !== -1 && selectedCell.value.col !== -1) {
    const cellsX = image.cellsX || lastImageCellsX.value
    const cellsY = image.cellsY || lastImageCellsY.value
    const isRoadTile = image.id?.startsWith('road_tile_')
    
    const tileMetadata = isRoadTile ? {
      name: image.name,
      tileIndex: image.tileIndex,
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height,
      rotation: image.rotation
    } : null
    
    if (isRoadTile && canvasRef.value.placeImageAtCell) {
      canvasRef.value.placeImageAtCell(
        selectedCell.value.row,
        selectedCell.value.col,
        image.url,
        cellsX,
        cellsY,
        false,
        true,
        image.bitmap || null,
        image.name || '',
        tileMetadata
      )
    } else {
      canvasRef.value.placeImageAtSelectedCell(image.url, cellsX, cellsY, image)
    }
  } else if (canvasRef.value) {
    const cellsX = image.cellsX || lastImageCellsX.value
    const cellsY = image.cellsY || lastImageCellsY.value
    selectedCell.value = { row: 0, col: 0 }
    canvasRef.value.placeImageAtSelectedCell(image.url, cellsX, cellsY, image)
  }
}

const handleCellSelected = ({ row, col }) => {
  selectedCell.value = { row, col }
  
  if (deleteMode.value && canvasRef.value) {
    canvasRef.value.deleteImageAtCell(row, col)
    selectedImageId.value = null
    selectedImageData.value = null
    return
  }
  
  if (selectedImageId.value && canvasRef.value) {
    let selectedImage = images.value.find(img => img.id === selectedImageId.value)
    
    if (!selectedImage && selectedImageData.value) {
      selectedImage = selectedImageData.value
    }
    
    if (selectedImage) {
      const isRoadTile = selectedImageId.value.startsWith('road_tile_')
      
      if (isRoadTile && canvasRef.value.placeImageAtCell) {
        const tileMetadata = {
          name: selectedImage.name,
          tileIndex: selectedImage.tileIndex,
          x: selectedImage.x,
          y: selectedImage.y,
          width: selectedImage.width,
          height: selectedImage.height,
          rotation: selectedImage.rotation
        }
        canvasRef.value.placeImageAtCell(
          row,
          col,
          selectedImage.url,
          lastImageCellsX.value,
          lastImageCellsY.value,
          false,
          true,
          selectedImage.bitmap || null,
          selectedImage.name || '',
          tileMetadata
        )
      } else {
        canvasRef.value.placeImageAtSelectedCell(
          selectedImage.url, 
          lastImageCellsX.value, 
          lastImageCellsY.value, 
          selectedImage.isBackground || false, 
          selectedImage.templateName || '',
          isRoadTile
        )
      }
      return
    }
  }
}

const handleImagePlaced = ({ row, col }) => {
  selectedCell.value = { row: -1, col: -1 }
}

const handleToggleNumbering = (value) => {
  showNumbering.value = value
}

const handleToggleGallery = (value) => {
  showGallery.value = value
}

const handleToggleGrid = (value) => {
  showGrid.value = value
}

const handleLoadProject = (projectData) => {
  const loadedImages = projectData.images || []
  const placedImages = projectData.placedImages || {}
  const loadedColors = projectData.environmentColors || { hue: 0, saturation: 100, brightness: 100 }
  const loadedTiles = projectData.backgroundTiles || []
  const loadedTextureSettings = projectData.textureSettings || { tilesPerImage: 1, tileResolution: 512, customTexture: null }
  const loadedResources = projectData.resources || []
  const loadedWorkforce = projectData.workforce || []
  const loadedRoadSpriteUrl = projectData.roadSpriteUrl || '/templates/roads/sprites/pastroad.png'
  const loadedRoadOpacity = projectData.roadOpacity || 100
  
  environmentColors.value = loadedColors
  textureSettings.value = loadedTextureSettings
  resources.value = loadedResources
  workforce.value = loadedWorkforce
  roadSpriteUrl.value = loadedRoadSpriteUrl
  roadOpacity.value = loadedRoadOpacity
  
  if (loadedTextureSettings.customTexture && canvasRef.value) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = async () => {
      const canvas = document.createElement('canvas')
      const resolution = loadedTextureSettings.tileResolution || 512
      canvas.width = resolution
      canvas.height = resolution
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, resolution, resolution)
      const processedTexture = canvas.toDataURL('image/jpeg', 0.9)
      
      await canvasRef.value.setBackgroundTiles([processedTexture], loadedTextureSettings.tilesPerImage || 1)
    }
    img.src = loadedTextureSettings.customTexture
  }
  
  if (loadedTiles.length > 0 && canvasRef.value && canvasRef.value.setBackgroundTiles) {
    canvasRef.value.setBackgroundTiles(loadedTiles, 1)
  }
  
  if (loadedImages.length === 0) {
    images.value = []
    selectedImageId.value = null
    if (canvasRef.value && canvasRef.value.clearAll) {
      canvasRef.value.clearAll()
    }
    return
  }
  
  images.value = loadedImages.map(img => ({
    id: img.id || Date.now().toString() + Math.random(),
    url: img.url,
    prompt: img.prompt || '',
    negativePrompt: img.negativePrompt || '',
    cellsX: img.cellsX || 1,
    cellsY: img.cellsY || 1,
    view: img.view || '',
    timestamp: img.timestamp ? new Date(img.timestamp) : new Date(),
    buildingData: img.buildingData || null
  }))
  
  if (images.value.length > 0) {
    selectedImageId.value = images.value[0].id
  } else {
    selectedImageId.value = null
  }
  
  if (canvasRef.value && Object.keys(placedImages).length > 0) {
    if (typeof canvasRef.value.clearAll === 'function') {
      canvasRef.value.clearAll()
    }
    
    const totalObjects = Object.keys(placedImages).length
    
    isLoading.value = true
    loadingProgress.value = 0
    loadingStatus.value = `Načítavam mapu (0/${totalObjects})...`
    
    if (typeof canvasRef.value.startBatchLoading === 'function') {
      canvasRef.value.startBatchLoading()
    }
    
    const objectsToLoad = Object.entries(placedImages)
    const BATCH_SIZE = 10
    let currentIndex = 0
    let successCount = 0
    
    const loadBatch = async () => {
      const batchEnd = Math.min(currentIndex + BATCH_SIZE, totalObjects)
      
      for (let i = currentIndex; i < batchEnd; i++) {
        const [key, imageData] = objectsToLoad[i]
        const { row, col, url, cellsX, cellsY, isBackground, isRoadTile, templateName, tileMetadata } = imageData
        
        let finalUrl = url
        let finalBitmap = null
        if (isRoadTile && tileMetadata && roadTiles.value.length > 0) {
          const tile = roadTiles.value.find(t => t.tileIndex === tileMetadata.tileIndex)
          if (tile) {
            finalUrl = tile.url
            finalBitmap = tile.bitmap
          }
        }
        
        if (canvasRef.value && typeof canvasRef.value.placeImageAtCell === 'function') {
          try {
            canvasRef.value.placeImageAtCell(
              row, 
              col, 
              finalUrl, 
              cellsX, 
              cellsY, 
              isBackground || false, 
              isRoadTile || false, 
              finalBitmap,
              templateName || '',
              tileMetadata || null
            )
            successCount++
          } catch (error) {
            console.error(`❌ Chyba pri umiestnení objektu na [${row}, ${col}]:`, error)
          }
        }
      }
      
      currentIndex = batchEnd
      loadingProgress.value = Math.round((currentIndex / totalObjects) * 100)
      loadingStatus.value = `Načítavam mapu (${currentIndex}/${totalObjects})...`
      
      if (currentIndex < totalObjects) {
        requestAnimationFrame(loadBatch)
      } else {
        loadingStatus.value = 'Finalizujem tiene a postavy...'
        
        setTimeout(() => {
          if (canvasRef.value && typeof canvasRef.value.finishBatchLoading === 'function') {
            canvasRef.value.finishBatchLoading()
          }
          
          setTimeout(() => {
            isLoading.value = false
            loadingProgress.value = 100
            loadingStatus.value = 'Hotovo!'
          }, 500)
        }, 100)
      }
    }
    
    const applyRoadSprite = async (retryCount = 0) => {
      const MAX_RETRIES = 20
      
      if (imageGalleryRef.value && imageGalleryRef.value.updateRoadSprite) {
        if (imageGalleryRef.value.roadOpacity !== undefined) {
          imageGalleryRef.value.roadOpacity = loadedRoadOpacity
        }
        
        await new Promise(resolve => setTimeout(resolve, 50))
        await nextTick()
        await imageGalleryRef.value.updateRoadSprite(loadedRoadSpriteUrl)
        await new Promise(resolve => setTimeout(resolve, 300))
        return true
      } else if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 100))
        return await applyRoadSprite(retryCount + 1)
      } else {
        return false
      }
    }
    
    const startLoadingWithDelay = async () => {
      const spriteLoaded = await applyRoadSprite()
      
      if (spriteLoaded) {
        let waitCount = 0
        while (roadTiles.value.length === 0 && waitCount < 20) {
          await new Promise(resolve => setTimeout(resolve, 100))
          waitCount++
        }
      }
      
      requestAnimationFrame(loadBatch)
    }
    
    startLoadingWithDelay()
  }
}

const handleUpdateResources = (data) => {
  resources.value = data.resources || []
  workforce.value = data.workforce || []
}

const handleUpdateBuildingData = ({ imageId, buildingData }) => {
  const image = images.value.find(img => img.id === imageId)
  if (image) {
    image.buildingData = {
      isBuilding: buildingData.isBuilding,
      buildCost: buildingData.buildCost,
      operationalCost: buildingData.operationalCost,
      production: buildingData.production
    }
  }
}
</script>

<template>
  <div id="game-view">
    <!-- Loading overlay -->
    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-content">
        <div class="loading-spinner"></div>
        <h2>{{ loadingStatus }}</h2>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: loadingProgress + '%' }"></div>
        </div>
        <p class="progress-text">{{ loadingProgress }}%</p>
      </div>
    </div>
    
    <!-- Canvas na pozadí -->
    <PhaserCanvas
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
      :roadBuildingMode="roadBuildingMode"
      :roadTiles="roadTiles"
      :personSpawnEnabled="personSpawnEnabled"
      :personSpawnCount="personSpawnCount"
      @cell-selected="handleCellSelected"
      @image-placed="handleImagePlaced"
      @toggle-numbering="handleToggleNumbering"
      @toggle-gallery="handleToggleGallery"
      @toggle-grid="handleToggleGrid"
      @road-placed="handleRoadPlaced"
    />
    
    <!-- Header -->
    <header>
      <ProjectManager 
        :images="images"
        :showNumbering="showNumbering"
        :showGallery="showGallery"
        :showGrid="showGrid"
        :canvasRef="canvasRef"
        :environmentColors="environmentColors"
        :textureSettings="textureSettings"
        :personSpawnSettings="{ enabled: personSpawnEnabled, count: personSpawnCount }"
        :resources="resources"
        :workforce="workforce"
        :roadSpriteUrl="roadSpriteUrl"
        :roadOpacity="roadOpacity"
        @load-project="handleLoadProject"
        @update:showNumbering="showNumbering = $event"
        @update:showGallery="showGallery = $event"
        @update:showGrid="showGrid = $event"
        @update-resources="handleUpdateResources"
      />
    </header>
    
    <!-- Pravý sidebar s Resources -->
    <aside class="sidebar">
      <ResourceDisplay :resources="resources" />
    </aside>
    
    <!-- Galéria dole -->
    <div v-if="showGallery" class="gallery-container">
      <ImageGallery 
        ref="imageGalleryRef"
        :images="images" 
        :selectedImageId="selectedImageId"
        :personSpawnEnabled="personSpawnEnabled"
        :personSpawnCount="personSpawnCount"
        :resources="resources"
        :workforce="workforce"
        :roadSpriteUrl="roadSpriteUrl"
        @delete="handleDelete" 
        @select="handleSelectImage"
        @place-on-board="handlePlaceOnBoard"
        @grid-size-changed="handleGridSizeChanged"
        @delete-mode-changed="handleDeleteModeChanged"
        @road-building-mode-changed="handleRoadBuildingModeChanged"
        @road-tiles-ready="handleRoadTilesReady"
        @road-opacity-changed="handleRoadOpacityChanged"
        @person-spawn-settings-changed="handlePersonSpawnSettingsChanged"
        @update-building-data="handleUpdateBuildingData"
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

#game-view {
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
  right: 250px;
  padding: 0.75rem 2rem;
  text-align: center;
  background: rgba(102, 126, 234, 0.95);
  backdrop-filter: blur(10px);
  z-index: 10;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
}

.sidebar {
  position: absolute;
  top: 0;
  right: 0;
  width: 250px;
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
  right: 250px;
  height: 210px;
  z-index: 10;
  overflow-x: auto;
  overflow-y: hidden;
}

/* Loading overlay styles */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(5px);
}

.loading-content {
  text-align: center;
  color: white;
  max-width: 400px;
  padding: 2rem;
}

.loading-spinner {
  width: 60px;
  height: 60px;
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-top-color: #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 1.5rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-content h2 {
  margin: 0 0 1rem 0;
  font-size: 1.5rem;
  font-weight: 600;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea, #764ba2);
  transition: width 0.3s ease;
  border-radius: 4px;
}

.progress-text {
  margin: 0.5rem 0 0 0;
  font-size: 1.1rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
}
</style>
