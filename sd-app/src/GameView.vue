<script setup>
import { ref, watch, nextTick, computed } from 'vue'
import PhaserCanvas from './components/PhaserCanvas.vue'
import ProjectManager from './components/ProjectManager.vue'
import ResourceDisplay from './components/ResourceDisplay.vue'
import BuildingSelector from './components/BuildingSelector.vue'
import RoadSelector from './components/RoadSelector.vue'
import Modal from './components/Modal.vue'
import { buildRoad, regenerateRoadTilesOnCanvas } from './utils/roadBuilder.js'
import { loadProject } from './utils/projectLoader.js'

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
const roadDeleteMode = ref(false)
const roadTiles = ref([])
const isLoading = ref(false)
const loadingProgress = ref(0)
const loadingStatus = ref('')
const personSpawnEnabled = ref(false)
const personSpawnCount = ref(0)
const resources = ref([])
const workforce = ref([])
const roadSpriteUrl = ref('/templates/roads/sprites/pastroad.png')
const roadOpacity = ref(100)
const canvasImagesMap = ref({}) // Mapa budov na canvase (pre vypočítanie použitých resources)
const selectedBuildingId = ref(null) // Vybraná budova z BuildingSelector
const showBuildingModal = ref(false) // Či sa má zobraziť modal s metadátami budovy
const clickedBuilding = ref(null) // Údaje o kliknutej budove
const showInsufficientResourcesModal = ref(false) // Modal pre nedostatok resources
const insufficientResourcesData = ref({ 
  buildingName: '',
  missingBuildResources: [],
  missingOperationalResources: []
})

// Filtrované budovy z galérie
const buildings = computed(() => {
  return images.value.filter(img => img.buildingData?.isBuilding === true)
})

// Computed property: Spočítaj použité resources zo všetkých budov na canvase
const usedResources = computed(() => {
  const used = {}
  
  // Bezpečnostná kontrola
  if (!canvasImagesMap.value || typeof canvasImagesMap.value !== 'object') {
    return used
  }
  
  // Prejdi všetky obrázky na canvase
  Object.values(canvasImagesMap.value).forEach(cellData => {
    if (!cellData) return
    
    // Preskočíme sekundárne bunky multi-cell budov
    if (cellData.isSecondary) return
    
    const imageId = cellData.imageId
    if (!imageId) return
    
    // Nájdi obrázok v images array
    const image = images.value.find(img => img.id === imageId)
    if (!image || !image.buildingData || !image.buildingData.isBuilding) return
    
    // Sčítaj operational costs (potrebné na prevádzku)
    const operationalCost = image.buildingData.operationalCost || []
    operationalCost.forEach(cost => {
      if (!cost || !cost.resourceId) return
      if (!used[cost.resourceId]) {
        used[cost.resourceId] = 0
      }
      used[cost.resourceId] += cost.amount || 0
    })
  })
  
  return used
})

// Computed property: Spočítaj produkované resources zo všetkých budov na canvase
const producedResources = computed(() => {
  const produced = {}
  
  // Bezpečnostná kontrola
  if (!canvasImagesMap.value || typeof canvasImagesMap.value !== 'object') {
    return produced
  }
  
  // Prejdi všetky obrázky na canvase
  Object.values(canvasImagesMap.value).forEach(cellData => {
    if (!cellData) return
    
    // Preskočíme sekundárne bunky multi-cell budov
    if (cellData.isSecondary) return
    
    const imageId = cellData.imageId
    if (!imageId) return
    
    // Nájdi obrázok v images array
    const image = images.value.find(img => img.id === imageId)
    if (!image || !image.buildingData || !image.buildingData.isBuilding) return
    
    // Sčítaj production (čo budova produkuje)
    const production = image.buildingData.production || []
    production.forEach(prod => {
      if (!prod || !prod.resourceId) return
      if (!produced[prod.resourceId]) {
        produced[prod.resourceId] = 0
      }
      produced[prod.resourceId] += prod.amount || 0
    })
  })
  
  return produced
})

// Funkcia na kontrolu dostupnosti resources pre budovu
const checkBuildingResources = (buildingData) => {
  if (!buildingData || !buildingData.isBuilding) {
    return { hasEnough: true, missingBuild: [], missingOperational: [] }
  }
  
  const missingBuild = []
  const missingOperational = []
  
  // Kontrola build cost (potrebné na stavbu)
  const buildCost = buildingData.buildCost || []
  buildCost.forEach(cost => {
    const resource = resources.value.find(r => r.id === cost.resourceId)
    if (!resource) {
      missingBuild.push({
        name: cost.resourceName,
        needed: cost.amount,
        available: 0
      })
      return
    }
    
    // Pre build cost kontrolujeme dostupné (base + production - used)
    const produced = producedResources.value[cost.resourceId] || 0
    const used = usedResources.value[cost.resourceId] || 0
    const available = resource.amount + produced - used
    
    if (available < cost.amount) {
      missingBuild.push({
        name: cost.resourceName,
        needed: cost.amount,
        available: available
      })
    }
  })
  
  // Kontrola operational cost (potrebné na prevádzku)
  const operationalCost = buildingData.operationalCost || []
  operationalCost.forEach(cost => {
    const resource = resources.value.find(r => r.id === cost.resourceId)
    if (!resource) {
      missingOperational.push({
        name: cost.resourceName,
        needed: cost.amount,
        available: 0
      })
      return
    }
    
    // Spočítaj dostupné (base + production - used)
    const produced = producedResources.value[cost.resourceId] || 0
    const used = usedResources.value[cost.resourceId] || 0
    const available = resource.amount + produced - used
    
    if (available < cost.amount) {
      missingOperational.push({
        name: cost.resourceName,
        needed: cost.amount,
        available: available
      })
    }
  })
  
  return {
    hasEnough: missingBuild.length === 0 && missingOperational.length === 0,
    missingBuild,
    missingOperational
  }
}

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
    // Aktualizuj canvas mapu pre prepočítanie resources
    handleCanvasUpdated()
    return
  }
  
  if (selectedImageId.value && canvasRef.value) {
    let selectedImage = images.value.find(img => img.id === selectedImageId.value)
    
    if (!selectedImage && selectedImageData.value) {
      selectedImage = selectedImageData.value
    }
    
    if (selectedImage) {
      // Kontrola resources pre budovy
      if (selectedImage.buildingData && selectedImage.buildingData.isBuilding) {
        const resourceCheck = checkBuildingResources(selectedImage.buildingData)
        if (!resourceCheck.hasEnough) {
          // Zobraz modal s chýbajúcimi resources
          insufficientResourcesData.value = {
            buildingName: selectedImage.buildingData.buildingName || 'Budova',
            missingBuildResources: resourceCheck.missingBuild,
            missingOperationalResources: resourceCheck.missingOperational
          }
          showInsufficientResourcesModal.value = true
          console.log('⛔ GameView: Nedostatok resources:', resourceCheck)
          return // Nezakladať budovu
        }
      }
      
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
          selectedImage, // Pošli cel\u00fd objekt aby sa ulo\u017eili buildingData
          selectedImage.templateName || '',
          isRoadTile
        )
      }
      return
    }
  }
}

const handleImagePlaced = (data) => {
  if (data && data.row !== undefined && data.col !== undefined) {
    selectedCell.value = { row: -1, col: -1 }
  }
  handleCanvasUpdated()
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

const handleLoadProject = async (projectData) => {
  console.log('📂 GameView: Začínam načítavať projekt')
  
  // Nastav loading state
  isLoading.value = true
  loadingProgress.value = 0
  loadingStatus.value = 'Načítavam projekt...'
  
  try {
    // Použiť projectLoader service
    const loadedData = await loadProject(
      projectData,
      canvasRef.value,
      (progress, status) => {
        loadingProgress.value = progress
        loadingStatus.value = status
      }
    )
    
    // Aplikuj načítané dáta
    roadTiles.value = loadedData.roadTiles
    environmentColors.value = loadedData.environmentColors
    textureSettings.value = loadedData.textureSettings
    resources.value = loadedData.resources
    workforce.value = loadedData.workforce
    roadSpriteUrl.value = loadedData.roadSpriteUrl
    roadOpacity.value = loadedData.roadOpacity
    
    // Načítaj images
    const loadedImages = loadedData.images || []
    
    if (loadedImages.length === 0) {
      images.value = []
      selectedImageId.value = null
    } else {
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
      }
    }
    
    // Aktualizuj canvas mapu
    setTimeout(() => {
      handleCanvasUpdated()
      
      // Ukončenie loading state
      setTimeout(() => {
        isLoading.value = false
        loadingProgress.value = 100
        loadingStatus.value = 'Projekt načítaný!'
        console.log('✅ GameView: Projekt úspešne načítaný')
      }, 500)
    }, 500)
    
  } catch (error) {
    console.error('❌ GameView: Chyba pri načítaní projektu:', error)
    isLoading.value = false
    loadingStatus.value = 'Chyba pri načítaní projektu'
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
      isCommandCenter: buildingData.isCommandCenter,
      buildingName: buildingData.buildingName,
      buildingSize: buildingData.buildingSize,
      dontDropShadow: buildingData.dontDropShadow,
      buildCost: buildingData.buildCost,
      operationalCost: buildingData.operationalCost,
      production: buildingData.production,
      hasSmokeEffect: buildingData.hasSmokeEffect,
      smokeSpeed: buildingData.smokeSpeed,
      smokeScale: buildingData.smokeScale,
      smokeAlpha: buildingData.smokeAlpha,
      smokeTint: buildingData.smokeTint,
      hasLightEffect: buildingData.hasLightEffect,
      lightBlinkSpeed: buildingData.lightBlinkSpeed,
      lightColor: buildingData.lightColor,
      lightSize: buildingData.lightSize
    }
  }
}

// Handler pre command center selection - command center môže byť len jeden
const handleCommandCenterSelected = (selectedImageId) => {
  // Prejdi všetky obrázky a zruš command center na všetkých okrem aktuálneho
  images.value.forEach(img => {
    if (img.id !== selectedImageId && img.buildingData?.isCommandCenter) {
      img.buildingData.isCommandCenter = false
      console.log('❌ GameView: Command center zrušený na obrázku:', img.id)
    }
  })
  console.log('🏛️ GameView: Command center nastavený na:', selectedImageId)
}

// Aktualizuj mapu budov na canvase
const handleCanvasUpdated = () => {
  if (canvasRef.value && canvasRef.value.cellImages) {
    const cellImages = canvasRef.value.cellImages()
    const newMap = {}
    
    Object.entries(cellImages).forEach(([key, data]) => {
      // Preskočíme sekundárne bunky multi-cell budov
      if (data.isSecondary) {
        return
      }
      
      // Nájdi imageId z URL alebo templateName
      const matchingImage = images.value.find(img => 
        img.url === data.url || 
        (data.templateName && img.templateName === data.templateName)
      )
      
      if (matchingImage) {
        newMap[key] = {
          imageId: matchingImage.id,
          url: data.url,
          templateName: data.templateName,
          isSecondary: false
        }
      }
    })
    
    canvasImagesMap.value = newMap
    console.log('🔄 GameView: Canvas aktualizovaný, budov na canvase:', Object.keys(newMap).length)
  }
}

// Handler pre výber budovy z BuildingSelector
const handleBuildingSelected = (data) => {
  // Ak je data null, odznač budovu
  if (data === null) {
    selectedBuildingId.value = null
    selectedImageId.value = null
    selectedImageData.value = null
    console.log('🏗️ GameView: Budova odznačená')
    return
  }
  
  const { building, cellsX, cellsY } = data
  selectedBuildingId.value = building.id
  selectedImageId.value = building.id
  selectedImageData.value = building
  lastImageCellsX.value = cellsX
  lastImageCellsY.value = cellsY
  
  // Zruš road building mode a bulldozer mode pri výbere budovy
  roadBuildingMode.value = false
  roadDeleteMode.value = false
  deleteMode.value = false
  
  console.log(`🏗️ GameView: Vybraná budova: ${building.buildingData?.buildingName} (${cellsX}x${cellsY})`)
}

// Handler pre prepnutie road building mode z RoadSelector
const handleRoadModeToggled = (isEnabled) => {
  roadBuildingMode.value = isEnabled
  if (isEnabled) {
    // Zrušiť výber budovy a delete mode pri zapnutí road mode
    selectedBuildingId.value = null
    selectedImageId.value = null
    roadDeleteMode.value = false
  }
  console.log(`🛣️ GameView: Road building mode: ${isEnabled ? 'ON' : 'OFF'}`)
}

// Handler pre prepnutie road delete mode z RoadSelector
const handleRoadDeleteModeToggled = (isEnabled) => {
  roadDeleteMode.value = isEnabled
  if (isEnabled) {
    // Zrušiť výber budovy a building mode pri zapnutí delete mode
    selectedBuildingId.value = null
    selectedImageId.value = null
    roadBuildingMode.value = false
  }
  console.log(`🚜 GameView: Road delete mode: ${isEnabled ? 'ON' : 'OFF'}`)
}

// Handler pre kliknutie na budovu na canvase
const handleBuildingClicked = ({ row, col, buildingData }) => {
  console.log('🏗️ GameView: Kliknuté na budovu na pozícii:', row, col, buildingData)
  
  // buildingData z canvasu už obsahuje všetky potrebné údaje vrátane buildingData
  if (buildingData && buildingData.buildingData) {
    clickedBuilding.value = {
      row,
      col,
      ...buildingData.buildingData,
      imageUrl: buildingData.url
    }
    showBuildingModal.value = true
    console.log('📋 Zobrazujem metadata budovy:', clickedBuilding.value)
  } else {
    console.warn('⚠️ Budova nemá metadata:', buildingData)
  }
}

// Zatvorenie modalu
const closeBuildingModal = () => {
  showBuildingModal.value = false
  clickedBuilding.value = null
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
      :roadDeleteMode="roadDeleteMode"
      :roadTiles="roadTiles"
      :personSpawnEnabled="personSpawnEnabled"
      :personSpawnCount="personSpawnCount"
      @cell-selected="handleCellSelected"
      @image-placed="handleImagePlaced"
      @toggle-numbering="handleToggleNumbering"
      @toggle-gallery="handleToggleGallery"
      @toggle-grid="handleToggleGrid"
      @road-placed="handleRoadPlaced"
      @building-clicked="handleBuildingClicked"
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
      <ResourceDisplay 
        :resources="resources" 
        :usedResources="usedResources" 
        :producedResources="producedResources" 
      />
      <BuildingSelector 
        :buildings="buildings"
        :selectedBuildingId="selectedBuildingId"
        @building-selected="handleBuildingSelected"
      />
      <RoadSelector 
        :roadBuildingMode="roadBuildingMode"
        :roadDeleteMode="roadDeleteMode"
        @road-mode-toggled="handleRoadModeToggled"
        @road-delete-mode-toggled="handleRoadDeleteModeToggled"
      />
    </aside>
    
    <!-- Modal s metadátami budovy -->
    <Modal 
      v-if="showBuildingModal && clickedBuilding"
      :title="clickedBuilding.buildingName || 'Budova'"
      @close="closeBuildingModal"
    >
      <div class="building-modal-content">
        <!-- Obrázok budovy -->
        <div class="building-image-preview">
          <img :src="clickedBuilding.imageUrl" alt="Budova" />
        </div>
        
        <!-- Základné info -->
        <div class="building-info-section">
          <h3>Základné informácie</h3>
          <div class="info-row">
            <span class="info-label">Názov:</span>
            <span class="info-value">{{ clickedBuilding.buildingName || 'Bez názvu' }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Veľkosť:</span>
            <span class="info-value">{{ clickedBuilding.buildingSize || 'default' }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Pozícia:</span>
            <span class="info-value">[{{ clickedBuilding.row }}, {{ clickedBuilding.col }}]</span>
          </div>
          <div v-if="clickedBuilding.isCommandCenter" class="info-row">
            <span class="info-label">Typ:</span>
            <span class="info-value command-center-badge">🏛️ Command Center</span>
          </div>
        </div>
        
        <!-- Build Cost -->
        <div v-if="clickedBuilding.buildCost && clickedBuilding.buildCost.length > 0" class="building-info-section">
          <h3>💰 Náklady na stavbu</h3>
          <div class="resource-list">
            <div v-for="(cost, index) in clickedBuilding.buildCost" :key="index" class="resource-item">
              <span class="resource-name">{{ cost.resourceName }}</span>
              <span class="resource-amount">{{ cost.amount }}</span>
            </div>
          </div>
        </div>
        
        <!-- Operational Cost -->
        <div v-if="clickedBuilding.operationalCost && clickedBuilding.operationalCost.length > 0" class="building-info-section">
          <h3>⚙️ Prevádzkové náklady</h3>
          <div class="resource-list">
            <div v-for="(cost, index) in clickedBuilding.operationalCost" :key="index" class="resource-item">
              <span class="resource-name">{{ cost.resourceName }}</span>
              <span class="resource-amount">{{ cost.amount }}</span>
            </div>
          </div>
        </div>
        
        <!-- Production -->
        <div v-if="clickedBuilding.production && clickedBuilding.production.length > 0" class="building-info-section">
          <h3>📦 Produkcia</h3>
          <div class="resource-list">
            <div v-for="(prod, index) in clickedBuilding.production" :key="index" class="resource-item production">
              <span class="resource-name">{{ prod.resourceName }}</span>
              <span class="resource-amount">+{{ prod.amount }}</span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
    
    <!-- Insufficient Resources Modal -->
    <Modal 
      v-if="showInsufficientResourcesModal" 
      title="⚠️ Nedostatok resources"
      @close="showInsufficientResourcesModal = false"
    >
      <div class="insufficient-resources-content">
        <h3>🏗️ {{ insufficientResourcesData.buildingName }}</h3>
        
        <!-- Chýbajúce resources na stavbu -->
        <div v-if="insufficientResourcesData.missingBuildResources.length > 0" class="missing-section">
          <p class="warning-text">
            🔨 Nemôžete postaviť túto budovu, pretože nemáte dostatok resources potrebných na stavbu:
          </p>
          <div class="missing-resources-list">
            <div 
              v-for="(resource, index) in insufficientResourcesData.missingBuildResources" 
              :key="'build-' + index"
              class="missing-resource-item build-cost"
            >
              <span class="resource-name">📦 {{ resource.name }}</span>
              <span class="resource-amounts">
                <span class="needed">✏️ Potrebné: {{ resource.needed }}</span>
                <span class="available">✅ Dostupné: {{ resource.available }}</span>
                <span class="deficit">❌ Chýba: {{ resource.needed - resource.available }}</span>
              </span>
            </div>
          </div>
        </div>
        
        <!-- Chýbajúce resources na prevádzku -->
        <div v-if="insufficientResourcesData.missingOperationalResources.length > 0" class="missing-section">
          <p class="warning-text">
            ⚙️ Nemôžete postaviť túto budovu, pretože nemáte dostatok resources potrebných na prevádzku:
          </p>
          <div class="missing-resources-list">
            <div 
              v-for="(resource, index) in insufficientResourcesData.missingOperationalResources" 
              :key="'operational-' + index"
              class="missing-resource-item operational-cost"
            >
              <span class="resource-name">📦 {{ resource.name }}</span>
              <span class="resource-amounts">
                <span class="needed">✏️ Potrebné: {{ resource.needed }}</span>
                <span class="available">✅ Dostupné: {{ resource.available }}</span>
                <span class="deficit">❌ Chýba: {{ resource.needed - resource.available }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
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

/* Header navigation */
.header-nav {
  position: absolute;
  right: 1rem;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
}

.nav-button {
  padding: 0.5rem 1rem;
  background: white;
  color: #667eea;
  text-decoration: none;
  border-radius: 8px;
  font-weight: 600;
  transition: all 0.2s;
  display: inline-block;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.nav-button:hover {
  background: #f0f0f0;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* Building modal styles */
.building-modal-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.building-image-preview {
  width: 100%;
  max-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f8f9fa;
  border-radius: 12px;
  padding: 1rem;
  overflow: hidden;
}

.building-image-preview img {
  max-width: 100%;
  max-height: 180px;
  object-fit: contain;
  border-radius: 8px;
}

.building-info-section {
  background: #f8f9fa;
  border-radius: 12px;
  padding: 1.25rem;
  border: 1px solid #e0e0e0;
}

.building-info-section h3 {
  margin: 0 0 1rem 0;
  color: #667eea;
  font-size: 1.1rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
  border-bottom: 1px solid #e0e0e0;
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  font-weight: 600;
  color: #555;
  font-size: 0.95rem;
}

.info-value {
  font-weight: 500;
  color: #333;
  font-size: 0.95rem;
}

.command-center-badge {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 0.35rem 0.75rem;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 600;
}

.resource-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.resource-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  background: white;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  transition: all 0.2s;
}

.resource-item:hover {
  border-color: #667eea;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.1);
}

.resource-name {
  font-weight: 500;
  color: #333;
  font-size: 0.95rem;
}

.resource-amount {
  color: #667eea;
  font-weight: 600;
  font-size: 1rem;
  padding: 0.25rem 0.75rem;
  background: rgba(102, 126, 234, 0.1);
  border-radius: 12px;
}

.resource-item.production .resource-amount {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
}

/* Insufficient Resources Modal */
.insufficient-resources-content {
  padding: 1rem;
  max-width: 600px;
}

.insufficient-resources-content h3 {
  margin: 0 0 1.5rem 0;
  font-size: 1.5rem;
  color: #667eea;
  text-align: center;
}

.missing-section {
  margin-bottom: 2rem;
}

.missing-section:last-child {
  margin-bottom: 0;
}

.warning-text {
  font-size: 1rem;
  color: #f59e0b;
  margin-bottom: 1rem;
  padding: 0.75rem;
  background: rgba(245, 158, 11, 0.1);
  border-left: 4px solid #f59e0b;
  border-radius: 4px;
}

.missing-resources-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.missing-resource-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 8px;
  border-left: 4px solid #ef4444;
}

.missing-resource-item.build-cost {
  border-left-color: #f59e0b;
}

.missing-resource-item.operational-cost {
  border-left-color: #ef4444;
}

.missing-resource-item .resource-name {
  font-weight: 600;
  font-size: 1rem;
  color: #1f2937;
}

.missing-resource-item .resource-amounts {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.9rem;
}

.missing-resource-item .resource-amounts span {
  display: flex;
  justify-content: space-between;
}

.missing-resource-item .needed {
  color: #6b7280;
}

.missing-resource-item .available {
  color: #10b981;
}

.missing-resource-item .deficit {
  color: #ef4444;
  font-weight: 600;
}
</style>
