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
import { 
  calculateResourceUsage,
  calculateStoredResources,
  checkBuildingResources as checkResources,
  deductBuildCost as deductCost,
  returnBuildWorkforce,
  refundBuildCostOnDelete,
  canStartProduction as checkProductionResources,
  executeProduction,
  getMissingOperationalResources,
  canStoreProduction
} from './utils/resourceCalculator.js'

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
const buildingProductionStates = ref({}) // Mapa stavov auto produkcie pre každú budovu: { 'row-col': { enabled: boolean, interval: number, buildingData: {...}, progress: 0, progressInterval: null } }
const allocatedResources = ref({}) // Tracking alokovaných work force resources { resourceId: amount }
const workforceAllocations = ref({}) // Detailný tracking alokácií { resourceId: [{row, col, amount, type: 'build'|'production', buildingName}] }
const productionProgress = ref({}) // Progress pre každú budovu { 'row-col': 0-100 }
const animatingBuildings = ref(new Map()) // Budovy aktuálne v stavebnej animácii: Map<'row-col', 'waiting'|'building'>
const BUILDING_ANIMATION_DURATION = 10000 // ms - musí byť rovnaká ako v buildingAnimationService.js
const pendingBuildAllocations = ref({}) // Čakajúce alokácie work-force pre budovy v animácii: { 'row-col': allocatedWorkItems }
const buildingWorkerCount = ref({}) // Počet pracovníkov na stavbe: { 'row-col': count }
const selectedBuildingId = ref(null) // Vybraná budova z BuildingSelector
const selectedBuildingDestinationTiles = ref([]) // Destination tiles pre vybranú budovu
const selectedBuildingCanBuildOnlyInDestination = ref(false) // Či vybraná budova môže byť postavená len na destination tiles
const showBuildingModal = ref(false) // Či sa má zobraziť modal s metadátami budovy
const clickedBuilding = ref(null) // Údaje o kliknutej budove
const portPayload = ref([]) // Payload pre port budovu: [{resourceId, resourceName, amount}]
const selectedPayloadResource = ref('') // Vybraná resource pre payload
const payloadAmount = ref(1) // Množstvo pre payload
const showInsufficientResourcesModal = ref(false) // Modal pre nedostatok resources
const insufficientResourcesData = ref({ 
  buildingName: '',
  missingBuildResources: [],
  missingOperationalResources: []
})
const ignoreResourceCheck = ref(false) // Checkbox pre ignorovanie kontroly resources

// Filtrované budovy z galérie
const buildings = computed(() => {
  return images.value.filter(img => img.buildingData?.isBuilding === true)
})

// Computed property pre zistenie či má aktuálna budova zapnutú auto produkciu
const currentBuildingAutoEnabled = computed(() => {
  if (!clickedBuilding.value) return false
  const key = `${clickedBuilding.value.row}-${clickedBuilding.value.col}`
  return buildingProductionStates.value[key]?.enabled || false
})

// Computed property pre progress aktuálnej budovy
const currentBuildingProgress = computed(() => {
  if (!clickedBuilding.value) return 0
  const key = `${clickedBuilding.value.row}-${clickedBuilding.value.col}`
  return productionProgress.value[key] || 0
})

// Computed property pre zistenie či sa kliknutá budova práve stavia (animácia)
const currentBuildingIsAnimating = computed(() => {
  if (!clickedBuilding.value) return false
  const key = `${clickedBuilding.value.row}-${clickedBuilding.value.col}`
  return animatingBuildings.value.has(key)
})

// Computed property pre stav animácie kliknutej budovy: 'waiting' | 'building' | null
const currentBuildingAnimState = computed(() => {
  if (!clickedBuilding.value) return null
  const key = `${clickedBuilding.value.row}-${clickedBuilding.value.col}`
  return animatingBuildings.value.get(key) || null
})

// Computed property pre počet pracovníkov na aktuálne kliknutej budove
const currentBuildingWorkers = computed(() => {
  if (!clickedBuilding.value) return 1
  const key = `${clickedBuilding.value.row}-${clickedBuilding.value.col}`
  return buildingWorkerCount.value[key] || 1
})

// Computed property pre maximálny počet pracovníkov (dostupné + aktuálne alokované)
const maxBuildingWorkers = computed(() => {
  const vehicleRes = resources.value.find(r => r.vehicleAnimation)
  if (!vehicleRes) return 1
  if (!clickedBuilding.value) return 1
  const key = `${clickedBuilding.value.row}-${clickedBuilding.value.col}`
  const currentWorkers = buildingWorkerCount.value[key] || 1
  return currentWorkers + vehicleRes.amount // dostupné + už alokované
})

// Computed property pre aktuálnu váhu payloadu v porte (súčet weight * amount)
const currentPortWeight = computed(() => {
  let totalWeight = 0
  for (const item of portPayload.value) {
    const res = resources.value.find(r => r.id === item.resourceId)
    const weight = res ? (Number(res.weight) || 0) : 0
    totalWeight += weight * item.amount
  }
  return totalWeight
})

// Computed property pre maximálnu kapacitu portu
const portMaxCapacity = computed(() => {
  if (!clickedBuilding.value) return 0
  return Number(clickedBuilding.value.portCapacity) || 0
})

// Computed property pre percentuálne naplnenie portu
const portFillPercent = computed(() => {
  if (portMaxCapacity.value <= 0) return 0
  return Math.min(100, (currentPortWeight.value / portMaxCapacity.value) * 100)
})

// Computed properties pre usedResources a producedResources - používa resourceCalculator service
const usedResources = computed(() => {
  const { usedResources } = calculateResourceUsage(canvasImagesMap.value, images.value)
  return usedResources
})

const producedResources = computed(() => {
  const { producedResources } = calculateResourceUsage(canvasImagesMap.value, images.value)
  return producedResources
})

// Aggregované skladované resources z budov umiestnených na canvase (preskočí budovy v stavebnej animácii)
const storedResources = computed(() => {
  return calculateStoredResources(canvasImagesMap.value, images.value, buildingProductionStates.value, animatingBuildings.value)
})

// Funkcia na kontrolu dostupnosti resources pre budovu - používa resourceCalculator service
const checkBuildingResources = (buildingData) => {
  return checkResources(buildingData, resources.value)
}

// Funkcia na odpočítanie build cost resources - používa resourceCalculator service
const deductBuildCost = (buildingData, row = 0, col = 0) => {
  return deductCost(buildingData, resources.value, allocatedResources.value, workforceAllocations.value, row, col)
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
    const cellImages = canvasRef.value.cellImages ? canvasRef.value.cellImages() : {}
    const directKey = `${row}-${col}`
    let targetData = cellImages[directKey]

    if (targetData?.isSecondary && targetData.originRow !== undefined && targetData.originCol !== undefined) {
      const originKey = `${targetData.originRow}-${targetData.originCol}`
      targetData = cellImages[originKey] || targetData
    }

    if (targetData?.buildingData?.isBuilding && !targetData.isRoadTile) {
      refundBuildCostOnDelete(targetData.buildingData, resources.value)
    }

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
      // Kontrola resources pre budovy - len ak nie je zapnutý ignore checkbox
      if (!ignoreResourceCheck.value && selectedImage.buildingData && selectedImage.buildingData.isBuilding) {
        const resourceCheck = checkBuildingResources(selectedImage.buildingData)
        
        // === Kontrola vehicleAnimation resources (cars) ===
        const hasVehicleResources = resources.value.some(r => r.vehicleAnimation)
        const availableVehicle = hasVehicleResources ? resources.value.find(r => r.vehicleAnimation && r.amount > 0) : null
        const missingVehicle = hasVehicleResources && !availableVehicle
        
        if (!resourceCheck.hasEnough || missingVehicle) {
          // Zobraz modal s chýbajúcimi resources
          const missingBuild = [...resourceCheck.missingBuild]
          if (missingVehicle) {
            const vehicleRes = resources.value.find(r => r.vehicleAnimation)
            missingBuild.push({
              name: vehicleRes.name + ' (vozidlo)',
              needed: 1,
              available: 0,
              isWorkResource: true
            })
          }
          insufficientResourcesData.value = {
            buildingName: selectedImage.buildingData.buildingName || 'Budova',
            missingBuildResources: missingBuild,
            missingOperationalResources: resourceCheck.missingOperational
          }
          showInsufficientResourcesModal.value = true
          console.log('⛔ GameView: Nedostatok resources:', resourceCheck, missingVehicle ? '(žiadne dostupné vozidlo)' : '')
          return // Nezakladať budovu
        }
        
        // Odpočítaj build cost resources
        const row = canvasRef.value ? selectedCell.value.row : 0
        const col = canvasRef.value ? selectedCell.value.col : 0
        const allocatedWorkItems = deductBuildCost(selectedImage.buildingData, row, col)
        
        // === Alokácia vehicleAnimation resource (car) pre stavbu ===
        if (availableVehicle) {
          availableVehicle.amount -= 1
          if (!allocatedResources.value[availableVehicle.id]) {
            allocatedResources.value[availableVehicle.id] = 0
          }
          allocatedResources.value[availableVehicle.id] += 1
          if (!workforceAllocations.value[availableVehicle.id]) {
            workforceAllocations.value[availableVehicle.id] = []
          }
          workforceAllocations.value[availableVehicle.id].push({
            row, col, amount: 1, type: 'build',
            buildingName: selectedImage.buildingData.buildingName || 'Budova'
          })
          allocatedWorkItems.push({
            resourceId: availableVehicle.id,
            amount: 1,
            resourceName: availableVehicle.name
          })
          console.log(`🚗 Alokované vozidlo (build): 1x ${availableVehicle.name} na [${row},${col}], zostatok: ${availableVehicle.amount}`)
        }
        
        // Označ budovu ako animujúcu (stav sa upresní cez building-state-changed event)
        const animKey = `${row}-${col}`
        animatingBuildings.value.set(animKey, 'building')
        buildingWorkerCount.value[animKey] = 1 // Štart s 1 pracovníkom
        console.log(`🏗️ Budova ${animKey} začína stavebnú animáciu`)
        
        // Uložíme alokované work items - budú vrátené keď animácia skutočne dokončí (cez event)
        if (allocatedWorkItems && allocatedWorkItems.length > 0) {
          pendingBuildAllocations.value[animKey] = allocatedWorkItems
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
      
      console.log('🔍 DEBUG: Kontrolujem buildingProductionStates...', loadedData.buildingProductionStates)
      console.log('🔍 DEBUG: loadedData typ:', typeof loadedData.buildingProductionStates)
      console.log('🔍 DEBUG: loadedData keys:', loadedData.buildingProductionStates ? Object.keys(loadedData.buildingProductionStates) : 'undefined')
      
      // Obnov production states pre budovy
      if (loadedData.buildingProductionStates && Object.keys(loadedData.buildingProductionStates).length > 0) {
        console.log('🔄 GameView: Obnovovanie auto-production states...', Object.keys(loadedData.buildingProductionStates).length, 'budov')
        
        Object.entries(loadedData.buildingProductionStates).forEach(([key, state]) => {
          console.log(`  🔍 Spracovávam key: ${key}, enabled: ${state.enabled}, buildingData:`, state.buildingData)
          
          if (state.enabled && state.buildingData) {
            const [row, col] = key.split('-').map(Number)
            
            // Skontroluj či budova existuje na canvase
            const cellImages = canvasRef.value?.cellImages()
            console.log(`  🔍 Canvas cellImages pre ${key}:`, cellImages?.[key] ? 'EXISTS' : 'NEEXISTUJE')
            
            if (cellImages && cellImages[key]) {
              console.log(`  ✅ Obnovovanie auto-production pre budovu na [${row}, ${col}]:`, state.buildingData.buildingName)
              
              // Alokuj work force resources (rovnako ako v toggleAutoProduction)
              const operationalCost = state.buildingData.operationalCost || []
              let hasEnoughWorkforce = true
              operationalCost.forEach(cost => {
                const resource = resources.value.find(r => r.id === cost.resourceId)
                if (resource && resource.workResource && resource.amount < cost.amount) {
                  hasEnoughWorkforce = false
                }
              })
              
              if (!hasEnoughWorkforce) {
                console.log(`  ⚠️ Nedostatok work-force pre obnovenie produkcie na [${row}, ${col}]`)
                return
              }
              
              operationalCost.forEach(cost => {
                const resource = resources.value.find(r => r.id === cost.resourceId)
                if (resource && resource.workResource) {
                  resource.amount -= cost.amount
                  if (!allocatedResources.value[cost.resourceId]) {
                    allocatedResources.value[cost.resourceId] = 0
                  }
                  allocatedResources.value[cost.resourceId] += cost.amount
                  
                  if (!workforceAllocations.value[cost.resourceId]) {
                    workforceAllocations.value[cost.resourceId] = []
                  }
                  workforceAllocations.value[cost.resourceId].push({
                    row, col, amount: cost.amount, type: 'production',
                    buildingName: state.buildingData.buildingName || 'Budova'
                  })
                  
                  console.log(`  👷 Obnovené work force (production): ${cost.amount}x ${resource.name} na [${row},${col}], total allocated: ${allocatedResources.value[cost.resourceId]}`)
                }
              })
              
              // Zobraz auto-production indikátor
              canvasRef.value?.showAutoProductionIndicator(row, col)
              // Zapni produkčné efekty len počas produkcie
              canvasRef.value?.showProductionEffects(row, col)
              
              // Vytvor interval pre túto budovu
              const interval = setInterval(() => {
                // Reset progress
                productionProgress.value[key] = 0
                
                // Skontroluj či má dosť resources na produkciu
                if (checkProductionResources(state.buildingData, resources.value)) {
                  // Vykonaj produkciu
                  executeProduction(state.buildingData, resources.value, storedResources.value)
                  
                  // Skry warning indikátor ak existuje
                  canvasRef.value?.hideWarningIndicator(row, col)
                } else {
                  // Nedostatok resources - zobraz warning s chýbajúcimi surovinami
                  const missingResources = []
                  if (state.buildingData?.operationalCost) {
                    state.buildingData.operationalCost.forEach(cost => {
                      const resource = resources.value.find(r => r.id === cost.resourceId)
                      if (!resource || resource.amount < cost.amount) {
                        missingResources.push({
                          id: cost.resourceId,
                          name: cost.resourceName || resource?.name || 'Unknown',
                          icon: resource?.icon || '',
                          needed: cost.amount,
                          available: resource?.amount || 0
                        })
                      }
                    })
                  }
                  
                  if (missingResources.length > 0) {
                    canvasRef.value?.showWarningIndicator(row, col, 'resources', missingResources)
                  }
                  // Vypni produkčné efekty ak nie sú resources
                  canvasRef.value?.hideProductionEffects(row, col)
                  console.log(`⚠️ Nedostatok resources pre auto-produkciu: ${state.buildingData.buildingName} na [${row}, ${col}]`, missingResources)
                  
                  // Vráť work-force resources pri zastavení
                  if (state.buildingData?.operationalCost) {
                    state.buildingData.operationalCost.forEach(cost => {
                      const resource = resources.value.find(r => r.id === cost.resourceId)
                      if (resource && resource.workResource) {
                        resource.amount += cost.amount
                        if (allocatedResources.value[cost.resourceId]) {
                          allocatedResources.value[cost.resourceId] -= cost.amount
                          if (allocatedResources.value[cost.resourceId] <= 0) {
                            delete allocatedResources.value[cost.resourceId]
                          }
                        }
                        if (workforceAllocations.value[cost.resourceId]) {
                          const idx = workforceAllocations.value[cost.resourceId].findIndex(
                            a => a.row === row && a.col === col && a.type === 'production'
                          )
                          if (idx !== -1) {
                            workforceAllocations.value[cost.resourceId].splice(idx, 1)
                            if (workforceAllocations.value[cost.resourceId].length === 0) {
                              delete workforceAllocations.value[cost.resourceId]
                            }
                          }
                        }
                        console.log(`  👷 Dealokované work force (restore stop): ${cost.amount}x ${resource.name} na [${row},${col}]`)
                      }
                    })
                  }
                  
                  // Zastavenie intervalov
                  clearInterval(interval)
                  if (buildingProductionStates.value[key]?.progressInterval) {
                    clearInterval(buildingProductionStates.value[key].progressInterval)
                  }
                  delete buildingProductionStates.value[key]
                  canvasRef.value?.hideAutoProductionIndicator(row, col)
                }
              }, 5000)
              
              // Vytvor progress interval
              productionProgress.value[key] = 0
              const progressInterval = setInterval(() => {
                if (productionProgress.value[key] !== undefined) {
                  productionProgress.value[key] = (productionProgress.value[key] + 2) % 100
                }
              }, 100)
              
              // Uložiť stav
              buildingProductionStates.value[key] = {
                enabled: true,
                interval: interval,
                progressInterval: progressInterval,
                buildingData: state.buildingData
              }
              
              console.log(`  ✅ Auto-production interval vytvorený pre ${key}`)
            } else {
              console.warn(`⚠️ Budova na [${row}, ${col}] neexistuje na canvase, preskakujem auto-production`)
            }
          } else {
            console.log(`  ⏭️ Preskakujem ${key} - enabled: ${state.enabled}, má buildingData: ${!!state.buildingData}`)
          }
        })
      } else {
        console.log('⚠️ GameView: Žiadne buildingProductionStates na obnovenie')
        console.log('   - buildingProductionStates existuje:', !!loadedData.buildingProductionStates)
        console.log('   - počet kľúčov:', loadedData.buildingProductionStates ? Object.keys(loadedData.buildingProductionStates).length : 0)
      }
      
      // Spawn cars a persons podľa resources s vehicleAnimation/personAnimation
      setTimeout(() => {
        if (canvasRef.value && resources.value.length > 0) {
          // Spawn cars pre resources s vehicleAnimation: true
          resources.value.forEach(resource => {
            if (resource.vehicleAnimation && resource.amount > 0) {
              console.log(`🚗 Spawning ${resource.amount} cars pre resource '${resource.name}'`)
              canvasRef.value.spawnCarsOnAllRoads(resource.amount)
            }
          })
          // Spawn persons pre resources s personAnimation: true
          resources.value.forEach(resource => {
            if (resource.personAnimation && resource.amount > 0) {
              console.log(`🚶 Spawning ${resource.amount} persons pre resource '${resource.name}'`)
              canvasRef.value.spawnPersonsOnAllRoads(resource.amount)
            }
          })
        }
      }, 800)

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
      isPort: buildingData.isPort,
      canBuildOnlyInDestination: buildingData.canBuildOnlyInDestination,
      destinationTiles: buildingData.destinationTiles,
      buildingName: buildingData.buildingName,
      buildingSize: buildingData.buildingSize,
      dontDropShadow: buildingData.dontDropShadow,
      buildCost: buildingData.buildCost,
      operationalCost: buildingData.operationalCost,
      production: buildingData.production,
      stored: buildingData.stored,
      allowedResources: buildingData.allowedResources,
      portCapacity: buildingData.portCapacity,
      hasSmokeEffect: buildingData.hasSmokeEffect,
      smokeSpeed: buildingData.smokeSpeed,
      smokeScale: buildingData.smokeScale,
      smokeAlpha: buildingData.smokeAlpha,
      smokeTint: buildingData.smokeTint,
      hasLightEffect: buildingData.hasLightEffect,
      hasFlyAwayEffect: buildingData.hasFlyAwayEffect,
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

// Spusti auto produkciu pre konkrétnu budovu (volaná po dokončení stavebnej animácie)
const startAutoProductionForBuilding = (row, col) => {
  const key = `${row}-${col}`
  
  // Skontroluj či budova ešte existuje na canvase a nemá zapnutú produkciu
  const mapData = canvasImagesMap.value[key]
  if (!mapData) {
    console.log(`⚠️ Budova na [${row}, ${col}] už neexistuje na canvase`)
    return
  }
  
  if (buildingProductionStates.value[key]?.enabled) {
    console.log(`⚠️ Budova na [${row}, ${col}] už má zapnutú produkciu`)
    return
  }
  
  const matchingImage = images.value.find(img => img.id === mapData.imageId)
  const bd = mapData.buildingData || matchingImage?.buildingData
  
  if (!bd?.isBuilding) return
  
  console.log(`🏗️ Post-animácia: Spúšťam produkciu pre budovu: ${bd.buildingName} na [${row}, ${col}]`)
  
  const buildingDataForProduction = {
    row, col,
    buildingName: bd.buildingName,
    isCommandCenter: bd.isCommandCenter || false,
    isPort: bd.isPort || false,
    operationalCost: bd.operationalCost || [],
    production: bd.production || [],
    stored: bd.stored || []
  }
  
  // Skontroluj či je dosť surovín
  if (!checkProductionResources(buildingDataForProduction, resources.value)) {
    console.log(`⚠️ Nedostatok surovín pre produkciu budovy na [${row}, ${col}]`)
    return
  }
  
  // Alokuj work force resources
  const operationalCost = buildingDataForProduction.operationalCost || []
  let hasEnoughWorkforce = true
  operationalCost.forEach(cost => {
    const resource = resources.value.find(r => r.id === cost.resourceId)
    if (resource && resource.workResource && resource.amount < cost.amount) {
      hasEnoughWorkforce = false
    }
  })
  
  if (!hasEnoughWorkforce) {
    console.log(`⚠️ Nedostatok work-force pre produkciu budovy na [${row}, ${col}]`)
    return
  }
  
  operationalCost.forEach(cost => {
    const resource = resources.value.find(r => r.id === cost.resourceId)
    if (resource && resource.workResource) {
      resource.amount -= cost.amount
      if (!allocatedResources.value[cost.resourceId]) {
        allocatedResources.value[cost.resourceId] = 0
      }
      allocatedResources.value[cost.resourceId] += cost.amount
      if (!workforceAllocations.value[cost.resourceId]) {
        workforceAllocations.value[cost.resourceId] = []
      }
      workforceAllocations.value[cost.resourceId].push({
        row, col, amount: cost.amount, type: 'production',
        buildingName: buildingDataForProduction.buildingName || 'Budova'
      })
      console.log(`👷 Post-animácia alokované work force: ${cost.amount}x ${resource.name} na [${row},${col}]`)
    }
  })
  
  // Zobraz auto-production indikátor
  canvasRef.value?.showAutoProductionIndicator(row, col)
  canvasRef.value?.showProductionEffects(row, col)
  
  // Vytvor interval pre auto produkciu
  const interval = setInterval(() => {
    productionProgress.value[key] = 0
    
    if (checkProductionResources(buildingDataForProduction, resources.value)) {
      canvasRef.value?.hideWarningIndicator(row, col)
      const storageCheck = canStoreProduction(buildingDataForProduction, resources.value, storedResources.value)
      if (!storageCheck.hasSpace) {
        canvasRef.value?.showWarningIndicator(row, col, 'storage')
      }
      executeProduction(buildingDataForProduction, resources.value, storedResources.value)
    } else {
      const missingResources = []
      if (buildingDataForProduction?.operationalCost) {
        buildingDataForProduction.operationalCost.forEach(cost => {
          const resource = resources.value.find(r => r.id === cost.resourceId)
          if (!resource || resource.amount < cost.amount) {
            missingResources.push({
              id: cost.resourceId, name: cost.resourceName || resource?.name || 'Unknown',
              icon: resource?.icon || '', needed: cost.amount, available: resource?.amount || 0
            })
          }
        })
      }
      if (missingResources.length > 0) {
        canvasRef.value?.showWarningIndicator(row, col, 'resources', missingResources)
      }
      canvasRef.value?.hideProductionEffects(row, col)
      console.log(`⛔ Post-animácia produkcia zastavená na [${row}, ${col}]`, missingResources)
      
      // Vráť work-force
      if (buildingDataForProduction?.operationalCost) {
        buildingDataForProduction.operationalCost.forEach(cost => {
          const resource = resources.value.find(r => r.id === cost.resourceId)
          if (resource && resource.workResource) {
            resource.amount += cost.amount
            if (allocatedResources.value[cost.resourceId]) {
              allocatedResources.value[cost.resourceId] -= cost.amount
              if (allocatedResources.value[cost.resourceId] <= 0) delete allocatedResources.value[cost.resourceId]
            }
            if (workforceAllocations.value[cost.resourceId]) {
              const idx = workforceAllocations.value[cost.resourceId].findIndex(a => a.row === row && a.col === col && a.type === 'production')
              if (idx !== -1) {
                workforceAllocations.value[cost.resourceId].splice(idx, 1)
                if (workforceAllocations.value[cost.resourceId].length === 0) delete workforceAllocations.value[cost.resourceId]
              }
            }
          }
        })
      }
      
      clearInterval(interval)
      if (buildingProductionStates.value[key]?.progressInterval) {
        clearInterval(buildingProductionStates.value[key].progressInterval)
      }
      delete buildingProductionStates.value[key]
      canvasRef.value?.hideAutoProductionIndicator(row, col)
    }
  }, 5000)
  
  productionProgress.value[key] = 0
  const progressInterval = setInterval(() => {
    if (productionProgress.value[key] !== undefined) {
      productionProgress.value[key] = (productionProgress.value[key] + 2) % 100
    }
  }, 100)
  
  buildingProductionStates.value[key] = {
    enabled: true, interval, progressInterval,
    buildingData: buildingDataForProduction
  }
  
  console.log(`✅ Post-animácia: Auto-produkcia spustená pre ${bd.buildingName} na [${row}, ${col}]`)
}

// Aktualizuj mapu budov na canvase
const handleCanvasUpdated = () => {
  if (canvasRef.value && canvasRef.value.cellImages) {
    const cellImages = canvasRef.value.cellImages()
    const newMap = {}
    
    // Získaj staré kľúče pred aktualizáciou
    const oldKeys = new Set(Object.keys(canvasImagesMap.value))
    
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
      
      // Použij buildingData z canvas položky (má prednosť) alebo z image library
      const buildingData = data.buildingData || matchingImage?.buildingData || null
      
      if (matchingImage || buildingData) {
        newMap[key] = {
          imageId: matchingImage?.id || null,
          url: data.url,
          templateName: data.templateName,
          isSecondary: false,
          buildingData: buildingData
        }
      }
    })
    
    // Skontroluj či sa niektoré budovy vymazali a zastav ich auto-produkciu + skry warning indikátory
    const newKeys = new Set(Object.keys(newMap))
    oldKeys.forEach(oldKey => {
      if (!newKeys.has(oldKey)) {
        // Budova bola vymazaná
        const [row, col] = oldKey.split('-').map(Number)
        
        // Zastavenie auto-produkcie (ak bežala)
        const state = buildingProductionStates.value[oldKey]
        if (state && state.interval) {
          clearInterval(state.interval)
          delete buildingProductionStates.value[oldKey]
          console.log(`⏹️ Auto-produkcia zastavená pre vymazanú budovu na [${row}, ${col}]`)
        }
        
        // Vrátenie pending build alokácií (vrátane vehicleAnimation resources)
        const pendingAlloc = pendingBuildAllocations.value[oldKey]
        if (pendingAlloc && pendingAlloc.length > 0) {
          returnBuildWorkforce(pendingAlloc, resources.value, allocatedResources.value, workforceAllocations.value, row, col)
          delete pendingBuildAllocations.value[oldKey]
          console.log(`🚗 Vrátené pending build alokácie pre vymazanú budovu na [${row}, ${col}]`)
        }
        
        // Odstráň z animujúcich budov
        animatingBuildings.value.delete(oldKey)
        delete buildingWorkerCount.value[oldKey] // Vyčisti worker count
        
        // Skrytie warning indikátora
        canvasRef.value?.hideWarningIndicator(row, col)
        
        // Skrytie auto-production indikátora
        canvasRef.value?.hideAutoProductionIndicator(row, col)
      }
    })
    
    canvasImagesMap.value = newMap
    console.log('🔄 GameView: Canvas aktualizovaný, budov na canvase:', Object.keys(newMap).length)
    
    // Automaticky spusti auto produkciu pre všetky nové budovy ktoré majú produkciu
    nextTick(() => {
      Object.entries(newMap).forEach(([key, mapData]) => {
        const [row, col] = key.split('-').map(Number)
        const matchingImage = images.value.find(img => img.id === mapData.imageId)
        
        // Použi buildingData z mapy (má prednosť) alebo z image library
        const bd = mapData.buildingData || matchingImage?.buildingData
        
        // Ak budova je building a ešte nemá zapnutú auto produkciu (produkcia môže byť aj prázdna)
        // Preskočíme budovy ktoré sú ešte v stavebnej animácii
        if (bd?.isBuilding && 
            !buildingProductionStates.value[key]?.enabled &&
            !animatingBuildings.value.has(key)) {
          
          console.log(`🏗️ Auto-spúšťam produkciu pre budovu: ${bd.buildingName} na [${row}, ${col}]`)
          
          // Priprav buildingData pre auto produkciu
          const buildingDataForProduction = {
            row,
            col,
            buildingName: bd.buildingName,
            isCommandCenter: bd.isCommandCenter || false,
            isPort: bd.isPort || false,
            operationalCost: bd.operationalCost || [],
            production: bd.production || [],
            stored: bd.stored || []
          }
          
          // Skontroluj či je dosť surovín
          if (!checkProductionResources(buildingDataForProduction, resources.value)) {
            console.log(`⚠️ Nedostatok surovín pre auto produkciu budovy na [${row}, ${col}]`)
            return // Nespúšťaj auto produkciu ak nie sú suroviny
          }
          
          // Alokuj work force resources pre operationalCost (rovnako ako v toggleAutoProduction)
          const operationalCost = buildingDataForProduction.operationalCost || []
          let hasEnoughWorkforce = true
          operationalCost.forEach(cost => {
            const resource = resources.value.find(r => r.id === cost.resourceId)
            if (resource && resource.workResource && resource.amount < cost.amount) {
              hasEnoughWorkforce = false
            }
          })
          
          if (!hasEnoughWorkforce) {
            console.log(`⚠️ Nedostatok work-force pre auto produkciu budovy na [${row}, ${col}]`)
            return
          }
          
          operationalCost.forEach(cost => {
            const resource = resources.value.find(r => r.id === cost.resourceId)
            if (resource && resource.workResource) {
              // Odčítaj z dostupných
              resource.amount -= cost.amount
              
              if (!allocatedResources.value[cost.resourceId]) {
                allocatedResources.value[cost.resourceId] = 0
              }
              allocatedResources.value[cost.resourceId] += cost.amount
              
              // Pridaj detailný záznam alokácie
              if (!workforceAllocations.value[cost.resourceId]) {
                workforceAllocations.value[cost.resourceId] = []
              }
              workforceAllocations.value[cost.resourceId].push({
                row, col, amount: cost.amount, type: 'production',
                buildingName: buildingDataForProduction.buildingName || 'Budova'
              })
              
              console.log(`👷 Auto-alokované work force (production): ${cost.amount}x ${resource.name} na [${row},${col}], total allocated: ${allocatedResources.value[cost.resourceId]}`)
            }
          })
          
          // Zobraz auto-production indikátor
          canvasRef.value?.showAutoProductionIndicator(row, col)
          // Zapni produkčné efekty len počas produkcie
          canvasRef.value?.showProductionEffects(row, col)
          
          // Vytvor interval pre auto produkciu (produkcia sa vykoná na konci 5s)
          const interval = setInterval(() => {
            // Reset progress
            productionProgress.value[key] = 0
            
            if (checkProductionResources(buildingDataForProduction, resources.value)) {
              canvasRef.value?.hideWarningIndicator(row, col)
              
              const storageCheck = canStoreProduction(buildingDataForProduction, resources.value, storedResources.value)
              if (!storageCheck.hasSpace) {
                canvasRef.value?.showWarningIndicator(row, col, 'storage')
              }
              
              executeProduction(buildingDataForProduction, resources.value, storedResources.value)
            } else {
              // Zastav auto produkciu ak nie sú suroviny
              // Získaj zoznam chýbajúcich surovín
              const missingResources = []
              if (buildingDataForProduction?.operationalCost) {
                buildingDataForProduction.operationalCost.forEach(cost => {
                  const resource = resources.value.find(r => r.id === cost.resourceId)
                  if (!resource || resource.amount < cost.amount) {
                    missingResources.push({
                      id: cost.resourceId,
                      name: cost.resourceName || resource?.name || 'Unknown',
                      icon: resource?.icon || '',
                      needed: cost.amount,
                      available: resource?.amount || 0
                    })
                  }
                })
              }
              
              if (missingResources.length > 0) {
                canvasRef.value?.showWarningIndicator(row, col, 'resources', missingResources)
              }
              // Vypni produkčné efekty ak nie sú resources
              canvasRef.value?.hideProductionEffects(row, col)
              console.log(`⛔ Auto-produkcia zastavená pre budovu na [${row}, ${col}] - nedostatok resources`, missingResources)
              
              // Vráť work-force resources pri zastavení
              if (buildingDataForProduction?.operationalCost) {
                buildingDataForProduction.operationalCost.forEach(cost => {
                  const resource = resources.value.find(r => r.id === cost.resourceId)
                  if (resource && resource.workResource) {
                    resource.amount += cost.amount
                    if (allocatedResources.value[cost.resourceId]) {
                      allocatedResources.value[cost.resourceId] -= cost.amount
                      if (allocatedResources.value[cost.resourceId] <= 0) {
                        delete allocatedResources.value[cost.resourceId]
                      }
                    }
                    if (workforceAllocations.value[cost.resourceId]) {
                      const idx = workforceAllocations.value[cost.resourceId].findIndex(
                        a => a.row === row && a.col === col && a.type === 'production'
                      )
                      if (idx !== -1) {
                        workforceAllocations.value[cost.resourceId].splice(idx, 1)
                        if (workforceAllocations.value[cost.resourceId].length === 0) {
                          delete workforceAllocations.value[cost.resourceId]
                        }
                      }
                    }
                    console.log(`👷 Auto-dealokované work force: ${cost.amount}x ${resource.name} na [${row},${col}]`)
                  }
                })
              }
              
              // Vymaž interval
              if (buildingProductionStates.value[key]?.interval) {
                clearInterval(buildingProductionStates.value[key].interval)
              }
              if (buildingProductionStates.value[key]?.progressInterval) {
                clearInterval(buildingProductionStates.value[key].progressInterval)
              }
              delete buildingProductionStates.value[key]
              canvasRef.value?.hideAutoProductionIndicator(row, col)
            }
          }, 5000)
          
          // Vytvor progress interval
          productionProgress.value[key] = 0
          const progressInterval = setInterval(() => {
            if (productionProgress.value[key] !== undefined) {
              productionProgress.value[key] = (productionProgress.value[key] + 2) % 100
            }
          }, 100)
          
          // Ulož stav
          buildingProductionStates.value[key] = {
            enabled: true,
            interval: interval,
            progressInterval: progressInterval,
            buildingData: buildingDataForProduction
          }
        }
      })
    })
  }
}

// Handler pre výber budovy z BuildingSelector
const handleBuildingSelected = (data) => {
  // Ak je data null, odznač budovu
  if (data === null) {
    selectedBuildingId.value = null
    selectedImageId.value = null
    selectedImageData.value = null
    selectedBuildingDestinationTiles.value = []
    selectedBuildingCanBuildOnlyInDestination.value = false
    console.log('🏗️ GameView: Budova odznačená')
    return
  }
  
  const { building, cellsX, cellsY } = data
  selectedBuildingId.value = building.id
  selectedImageId.value = building.id
  selectedImageData.value = building
  lastImageCellsX.value = cellsX
  lastImageCellsY.value = cellsY
  
  // Extrahuj destination tiles ak má budova toto obmedzenie
  if (building.buildingData?.canBuildOnlyInDestination && building.buildingData?.destinationTiles) {
    selectedBuildingCanBuildOnlyInDestination.value = true
    selectedBuildingDestinationTiles.value = building.buildingData.destinationTiles
    console.log('🎯 GameView: Budova má destination restriction:', selectedBuildingDestinationTiles.value.length, 'tiles')
  } else {
    selectedBuildingCanBuildOnlyInDestination.value = false
    selectedBuildingDestinationTiles.value = []
  }
  
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
    // Normálne na origin súradnice pre multi-cell budovy
    let originRow = row
    let originCol = col
    
    if (buildingData.isSecondary) {
      originRow = buildingData.originRow
      originCol = buildingData.originCol
      console.log(`🔄 Sekundárna bunka - používam origin: [${originRow}, ${originCol}]`)
    }
    
    clickedBuilding.value = {
      row: originRow,
      col: originCol,
      ...buildingData.buildingData,
      imageUrl: buildingData.url
    }
    showBuildingModal.value = true
    console.log('📋 Zobrazujem metadata budovy:', clickedBuilding.value)
  } else {
    console.warn('⚠️ Budova nemá metadata:', buildingData)
  }
}

// Handler pre zmazanie budovy (bulldozer/road delete mode)
const handleBuildingDeleted = ({ row, col, buildingData }) => {
  if (buildingData?.isBuilding) {
    refundBuildCostOnDelete(buildingData, resources.value)
  }
  
  // Vrátenie pending build alokácií (vrátane vehicleAnimation resources) ak bola budova v stavbe
  if (row !== undefined && col !== undefined) {
    const key = `${row}-${col}`
    const pendingAlloc = pendingBuildAllocations.value[key]
    if (pendingAlloc && pendingAlloc.length > 0) {
      returnBuildWorkforce(pendingAlloc, resources.value, allocatedResources.value, workforceAllocations.value, row, col)
      delete pendingBuildAllocations.value[key]
      console.log(`🚗 Vrátené pending build alokácie pre zmazanú budovu na [${row}, ${col}]`)
    }
    // Odstráň z animujúcich budov
    animatingBuildings.value.delete(key)
    delete buildingWorkerCount.value[key] // Vyčisti worker count
  }
}

// Handler pre zmenu stavu stavby budovy (waiting/building)
const handleBuildingStateChanged = ({ row, col, state }) => {
  const key = `${row}-${col}`
  animatingBuildings.value.set(key, state)
  console.log(`🏗️ Budova [${row}, ${col}] stav: ${state}`)
}

// Handler pre dokončenie stavebnej animácie budovy (skutočné dokončenie, rešpektuje pauzy)
const handleBuildingConstructionComplete = ({ row, col }) => {
  const key = `${row}-${col}`
  
  // Vráť work-force ak boli alokované
  const allocatedWorkItems = pendingBuildAllocations.value[key]
  if (allocatedWorkItems && allocatedWorkItems.length > 0) {
    returnBuildWorkforce(allocatedWorkItems, resources.value, allocatedResources.value, workforceAllocations.value, row, col)
    delete pendingBuildAllocations.value[key]
  }
  
  // Odstráň z animujúcich
  animatingBuildings.value.delete(key)
  delete buildingWorkerCount.value[key] // Vyčisti worker count
  console.log(`✅ Budova ${key} skutočne dokončená, spúšťam auto produkciu`)
  
  // Spusti auto produkciu pre túto budovu
  startAutoProductionForBuilding(row, col)
}

// Handler pre zmenu počtu pracovníkov na stavbe
const changeConstructionWorkers = (newCount) => {
  if (!clickedBuilding.value) return
  const { row, col } = clickedBuilding.value
  const key = `${row}-${col}`
  const currentCount = buildingWorkerCount.value[key] || 1
  newCount = Math.max(1, Math.round(newCount))
  
  if (newCount === currentCount) return
  
  const vehicleRes = resources.value.find(r => r.vehicleAnimation)
  if (!vehicleRes) return
  
  const diff = newCount - currentCount
  
  if (diff > 0) {
    // Pridávame pracovníkov - kontrola dostupnosti
    if (vehicleRes.amount < diff) {
      console.log(`⛔ Nedostatok vozidiel: potreba ${diff}, dostupné ${vehicleRes.amount}`)
      return
    }
    
    // Alokuj ďalšie vozidlá
    vehicleRes.amount -= diff
    if (!allocatedResources.value[vehicleRes.id]) {
      allocatedResources.value[vehicleRes.id] = 0
    }
    allocatedResources.value[vehicleRes.id] += diff
    
    // Pridaj do workforce alokácií
    if (!workforceAllocations.value[vehicleRes.id]) {
      workforceAllocations.value[vehicleRes.id] = []
    }
    // Aktualizuj existujúcu alokáciu alebo pridaj novú
    const existingAlloc = workforceAllocations.value[vehicleRes.id].find(
      a => a.row === row && a.col === col && a.type === 'build'
    )
    if (existingAlloc) {
      existingAlloc.amount += diff
    } else {
      workforceAllocations.value[vehicleRes.id].push({
        row, col, amount: diff, type: 'build',
        buildingName: clickedBuilding.value.buildingName || 'Budova'
      })
    }
    
    // Pridaj do pending build alokácií (pre návrat pri dokončení/zmazaní)
    if (!pendingBuildAllocations.value[key]) {
      pendingBuildAllocations.value[key] = []
    }
    const existingPending = pendingBuildAllocations.value[key].find(a => a.resourceId === vehicleRes.id)
    if (existingPending) {
      existingPending.amount += diff
    } else {
      pendingBuildAllocations.value[key].push({
        resourceId: vehicleRes.id,
        amount: diff,
        resourceName: vehicleRes.name
      })
    }
    
    // Dispatch extra cars k budove
    for (let i = 0; i < diff; i++) {
      if (canvasRef.value?.dispatchExtraCarToBuilding) {
        canvasRef.value.dispatchExtraCarToBuilding(row, col)
      }
    }
    
    console.log(`👷 Pridaní ${diff} pracovníci na [${row},${col}], celkom: ${newCount}, zostatok vozidiel: ${vehicleRes.amount}`)
  } else {
    // Odoberáme pracovníkov - vrátime vozidlá
    const returnCount = Math.abs(diff)
    vehicleRes.amount += returnCount
    if (allocatedResources.value[vehicleRes.id]) {
      allocatedResources.value[vehicleRes.id] -= returnCount
      if (allocatedResources.value[vehicleRes.id] <= 0) {
        delete allocatedResources.value[vehicleRes.id]
      }
    }
    
    // Aktualizuj workforce alokácie
    if (workforceAllocations.value[vehicleRes.id]) {
      const alloc = workforceAllocations.value[vehicleRes.id].find(
        a => a.row === row && a.col === col && a.type === 'build'
      )
      if (alloc) {
        alloc.amount -= returnCount
        if (alloc.amount <= 0) {
          const idx = workforceAllocations.value[vehicleRes.id].indexOf(alloc)
          workforceAllocations.value[vehicleRes.id].splice(idx, 1)
        }
      }
    }
    
    // Aktualizuj pending build alokácie
    if (pendingBuildAllocations.value[key]) {
      const pendingAlloc = pendingBuildAllocations.value[key].find(a => a.resourceId === vehicleRes.id)
      if (pendingAlloc) {
        pendingAlloc.amount -= returnCount
        if (pendingAlloc.amount <= 0) {
          const idx = pendingBuildAllocations.value[key].indexOf(pendingAlloc)
          pendingBuildAllocations.value[key].splice(idx, 1)
        }
      }
    }
    
    console.log(`👷 Odobratí ${returnCount} pracovníci z [${row},${col}], celkom: ${newCount}, zostatok vozidiel: ${vehicleRes.amount}`)
  }
  
  // Aktualizuj worker count
  buildingWorkerCount.value[key] = newCount
  
  // Nastav animation speed
  if (canvasRef.value?.setConstructionWorkers) {
    canvasRef.value.setConstructionWorkers(row, col, newCount)
  }
}

// Zatvorenie modalu
const closeBuildingModal = () => {
  showBuildingModal.value = false
  clickedBuilding.value = null
  portPayload.value = []
  selectedPayloadResource.value = ''
  payloadAmount.value = 1
}

// Pridanie resource do payloadu portu
const addPortPayload = () => {
  if (!selectedPayloadResource.value || payloadAmount.value <= 0) return
  
  const res = resources.value.find(r => r.id === selectedPayloadResource.value)
  if (!res) return
  
  const weight = Number(res.weight) || 0
  const addedWeight = weight * payloadAmount.value
  
  // Kontrola či sa zmestí do kapacity
  if (currentPortWeight.value + addedWeight > portMaxCapacity.value) {
    console.log(`⚠️ Port payload: nedostatok kapacity. Aktuálne: ${currentPortWeight.value}, pridávam: ${addedWeight}, max: ${portMaxCapacity.value}`)
    return
  }
  
  // Kontrola či existuje v allowedResources
  const allowed = clickedBuilding.value.allowedResources || []
  if (!allowed.some(a => a.resourceId === selectedPayloadResource.value)) return
  
  // Ak už existuje v payload, pridaj k existujúcemu
  const existing = portPayload.value.find(p => p.resourceId === selectedPayloadResource.value)
  if (existing) {
    existing.amount += payloadAmount.value
  } else {
    portPayload.value.push({
      resourceId: selectedPayloadResource.value,
      resourceName: res.name,
      amount: payloadAmount.value
    })
  }
  
  // Reset
  payloadAmount.value = 1
}

// Odobranie resource z payloadu portu
const removePortPayload = (index) => {
  portPayload.value.splice(index, 1)
}

// Zastaviť auto produkciu pre konkrétnu budovu
const stopAutoProduction = (row, col, reason = 'manual') => {
  const key = `${row}-${col}`
  const state = buildingProductionStates.value[key]
  
  // Ak state neexistuje, budova už bola zastavená - return
  if (!state) {
    console.log(`⏭️ stopAutoProduction - state neexistuje pre [${row}, ${col}], preskakujem`)
    return
  }
  
  // Vyčisti hlavný interval
  if (state.interval) {
    clearInterval(state.interval)
  }
  
  // Vyčisti progress interval
  if (state.progressInterval) {
    clearInterval(state.progressInterval)
  }
  
  console.log(`⏹️ Auto-produkcia zastavená pre budovu na [${row}, ${col}], dôvod: ${reason}`)
  
  // Dealokuj work force resources - vráť späť do dostupných
  const buildingData = state.buildingData
  if (buildingData && buildingData.operationalCost) {
    buildingData.operationalCost.forEach(cost => {
      const resource = resources.value.find(r => r.id === cost.resourceId)
      if (resource && resource.workResource) {
        // Vráť amount späť do dostupných
        resource.amount += cost.amount
        
        if (allocatedResources.value[cost.resourceId]) {
          allocatedResources.value[cost.resourceId] -= cost.amount
          if (allocatedResources.value[cost.resourceId] <= 0) {
            delete allocatedResources.value[cost.resourceId]
          }
        }
        
        // Odstráň detailný záznam alokácie
        if (workforceAllocations.value[cost.resourceId]) {
          const idx = workforceAllocations.value[cost.resourceId].findIndex(
            a => a.row === row && a.col === col && a.type === 'production'
          )
          if (idx !== -1) {
            workforceAllocations.value[cost.resourceId].splice(idx, 1)
            if (workforceAllocations.value[cost.resourceId].length === 0) {
              delete workforceAllocations.value[cost.resourceId]
            }
          }
        }
        
        console.log(`👷 Dealokované work force: ${cost.amount}x ${resource.name}, vrátené: ${cost.amount}, total allocated: ${allocatedResources.value[cost.resourceId] || 0}`)
      }
    })
  }
  
  // Reset progress
  productionProgress.value[key] = 0
  
  // Zobraz warning indikátor podľa dôvodu zastavenia
  if (reason === 'resources') {
    // Získaj zoznam chýbajúcich surovín
    const missingResources = []
    
    if (buildingData && buildingData.operationalCost) {
      buildingData.operationalCost.forEach(cost => {
        const resource = resources.value.find(r => r.id === cost.resourceId)
        if (!resource || resource.amount < cost.amount) {
          missingResources.push({
            id: cost.resourceId,
            name: cost.resourceName || resource?.name || 'Unknown',
            icon: resource?.icon || '',
            needed: cost.amount,
            available: resource?.amount || 0
          })
        }
      })
    }
    
    console.log('🔍 Chýbajúce suroviny pre warning indikátor:', missingResources)
    
    // Zobraz indikátor LEN ak máme missing resources
    if (missingResources.length > 0) {
      canvasRef.value?.showWarningIndicator(row, col, 'resources', missingResources)
    }
  } else {
    // Manuálne zastavenie - skry indikátor
    canvasRef.value?.hideWarningIndicator(row, col)
  }
  
  // Vymazať stav budovy
  delete buildingProductionStates.value[key]
  
  // Skry auto-production indikátor
  canvasRef.value?.hideAutoProductionIndicator(row, col)
  // Skry produkčné efekty
  canvasRef.value?.hideProductionEffects(row, col)
}

// Toggle auto produkcie pre konkrétnu budovu
const toggleAutoProduction = () => {
  if (!clickedBuilding.value) return
  
  const row = clickedBuilding.value.row
  const col = clickedBuilding.value.col
  const key = `${row}-${col}`
  const buildingData = clickedBuilding.value
  
  // Ak je to command center, nedovolíme vypnúť auto produkciu
  if (buildingData.isCommandCenter) {
    console.log('🏛️ Command Center má vždy zapnutú auto produkciu - nedá sa vypnúť')
    return
  }
  
  // Skontrolovať aktuálny stav
  const currentState = buildingProductionStates.value[key]
  
  if (currentState?.enabled) {
    // Vypnúť auto produkciu - skry warning indikátor
    stopAutoProduction(row, col, 'manual')
  } else {
    // Zapnúť auto produkciu
    console.log(`🔄 Auto-produkcia zapnutá pre: ${buildingData.buildingName} na [${row}, ${col}]`)
    
    // Skry prípadný existujúci warning indikátor
    canvasRef.value?.hideWarningIndicator(row, col)
    
    // Zobraz zelený auto-production indikátor
    canvasRef.value?.showAutoProductionIndicator(row, col)
    // Zapni produkčné efekty len počas produkcie
    canvasRef.value?.showProductionEffects(row, col)
    
    // Alokuj work force resources pre operationalCost
    const operationalCost = buildingData.operationalCost || []
    
    // Skontroluj či je dosť work-force pred alokáciou
    let hasEnoughWorkforce = true
    operationalCost.forEach(cost => {
      const resource = resources.value.find(r => r.id === cost.resourceId)
      if (resource && resource.workResource && resource.amount < cost.amount) {
        hasEnoughWorkforce = false
      }
    })
    
    if (!hasEnoughWorkforce) {
      console.log('⛔ Nedostatok work-force pre spustenie produkcie')
      // Zobraz warning
      const missingResources = operationalCost
        .filter(cost => {
          const r = resources.value.find(res => res.id === cost.resourceId)
          return r && r.workResource && r.amount < cost.amount
        })
        .map(cost => {
          const r = resources.value.find(res => res.id === cost.resourceId)
          return { id: cost.resourceId, name: r?.name || 'Unknown', icon: r?.icon || '', needed: cost.amount, available: r?.amount || 0 }
        })
      canvasRef.value?.showWarningIndicator(row, col, 'resources', missingResources)
      return
    }
    
    operationalCost.forEach(cost => {
      const resource = resources.value.find(r => r.id === cost.resourceId)
      if (resource && resource.workResource) {
        // Odčítaj z dostupných
        resource.amount -= cost.amount
        
        if (!allocatedResources.value[cost.resourceId]) {
          allocatedResources.value[cost.resourceId] = 0
        }
        allocatedResources.value[cost.resourceId] += cost.amount
        
        // Pridaj detailný záznam alokácie
        if (!workforceAllocations.value[cost.resourceId]) {
          workforceAllocations.value[cost.resourceId] = []
        }
        workforceAllocations.value[cost.resourceId].push({
          row, col, amount: cost.amount, type: 'production',
          buildingName: buildingData.buildingName || 'Budova'
        })
        
        console.log(`👷 Alokované work force (production): ${cost.amount}x ${resource.name}, total allocated: ${allocatedResources.value[cost.resourceId]}`)
      }
    })
    
    // Vytvo riť interval pre túto budovu (produkcia sa vykoná na konci 5s)
    const interval = setInterval(() => {
      // Reset progress
      productionProgress.value[key] = 0
      
      // Skontrolovať či je dosť resources
      if (checkProductionResources(buildingData, resources.value)) {
        // Skry žltý indikátor ak bol zobrazený (máme dosť surovín)
        canvasRef.value?.hideWarningIndicator(row, col)
        
        // Skontrolovať či je dosť miesta na uskladnenie
        const storageCheck = canStoreProduction(buildingData, resources.value, storedResources.value)
        if (!storageCheck.hasSpace) {
          // Zobraz červený indikátor - plný sklad, ale pokračuj v produkcii
          canvasRef.value?.showWarningIndicator(row, col, 'storage')
          console.log(`⚠️ Sklad plný pre: ${storageCheck.fullResources.map(r => r.resourceName).join(', ')} - produkcia pokračuje, ale surovina sa nepridá`)
        }
        
        // Spusti produkciu (executeProduction samo kontroluje kapacitu skladu)
        executeProduction(buildingData, resources.value, storedResources.value)
      } else {
        // Zastaviť ak nie je dosť resources - žltý indikátor
        stopAutoProduction(row, col, 'resources')
        console.log(`⛔ Auto-produkcia zastavená pre budovu na [${row}, ${col}] - nedostatok resources`)
      }
    }, 5000)
    
    // Vytvor progress interval (aktualizuje sa každých 100ms)
    productionProgress.value[key] = 0
    const progressInterval = setInterval(() => {
      if (productionProgress.value[key] !== undefined) {
        productionProgress.value[key] = (productionProgress.value[key] + 2) % 100 // +2% každých 100ms = 5s na 100%
      }
    }, 100)
    
    // Uložiť stav
    buildingProductionStates.value[key] = {
      enabled: true,
      interval: interval,
      progressInterval: progressInterval,
      buildingData: buildingData
    }
  }
}

// Kontrola či je dosť resources na spustenie produkcie - používa resourceCalculator service
const canStartProduction = () => {
  if (!clickedBuilding.value) return false
  return checkProductionResources(clickedBuilding.value, resources.value)
}

// Computed property pre zistenie chýbajúcich operational resources
const missingOperationalResources = computed(() => {
  if (!clickedBuilding.value) return new Set()
  return getMissingOperationalResources(clickedBuilding.value, resources.value)
})

// Spustenie produkcie - používa resourceCalculator service
const startProduction = () => {
  if (!clickedBuilding.value) return
  executeProduction(clickedBuilding.value, resources.value, storedResources.value)
}

// Spustenie port produkcie - odpočíta operational cost a pridá payload resources do hráčových zdrojov
const startPortProduction = () => {
  if (!clickedBuilding.value) return
  if (!checkProductionResources(clickedBuilding.value, resources.value)) return
  if (portPayload.value.length === 0) {
    console.log('⚠️ Port payload je prázdny, nie je čo produkovať')
    return
  }

  // Odpočítaj operational cost (work-force sa preskakuje)
  const operationalCost = clickedBuilding.value.operationalCost || []
  operationalCost.forEach(cost => {
    const resource = resources.value.find(r => r.id === cost.resourceId)
    if (resource) {
      if (resource.workResource) {
        console.log(`👷 Work force ${resource.name} preskočená - je alokovaná na úrovni produkcie`)
        return
      }
      resource.amount -= cost.amount
      console.log(`⚙️ Port: Odpočítané prevádzkové náklady: ${cost.amount}x ${resource.name}, zostatok: ${resource.amount}`)
    }
  })

  // Pridaj payload resources do hráčových zdrojov
  portPayload.value.forEach(item => {
    const resource = resources.value.find(r => r.id === item.resourceId)
    if (resource) {
      resource.amount += item.amount
      console.log(`🚢 Port produkcia: +${item.amount}x ${resource.name}, nový zostatok: ${resource.amount}`)
    } else {
      console.warn(`⚠️ Resource ${item.resourceName} (${item.resourceId}) neexistuje v zozname resources`)
    }
  })

  console.log('✅ Port produkcia dokončená! Payload vyčistený.')

  // Ulož spawn dáta z payloadu pred vyčistením
  const spawnData = { cars: 0, persons: 0 }
  portPayload.value.forEach(item => {
    const res = resources.value.find(r => r.id === item.resourceId)
    if (res) {
      if (res.vehicleAnimation) spawnData.cars += item.amount
      if (res.personAnimation) spawnData.persons += item.amount
    }
  })

  // Vyčisti payload po produkcii
  portPayload.value = []

  // Spusti efekty budovy
  const row = clickedBuilding.value.row
  const col = clickedBuilding.value.col
  const hasFlyAway = !!clickedBuilding.value.hasFlyAwayEffect
  const cellsX = clickedBuilding.value.buildingSize?.x || 1
  const cellsY = clickedBuilding.value.buildingSize?.y || 1

  // Najprv vyčisti existujúce efekty
  canvasRef.value?.hideProductionEffects(row, col)

  // Po krátkom oneskorení spusti všetky efekty nanovo
  setTimeout(() => {
    // Fly-away efekt (ak ho budova má)
    if (hasFlyAway) {
      canvasRef.value?.triggerFlyAwayEffect(row, col)
      // Smoke efekty - fly-away onComplete ich sám vyčistí po návrate
      canvasRef.value?.showProductionEffects(row, col)

      // Po dokončení fly-away animácie (5s + 600ms buffer) spawn cars/persons
      setTimeout(() => {
        if (spawnData.cars > 0) {
          console.log(`🚗 Port: Spawning ${spawnData.cars} cars po fly-away`)
          canvasRef.value?.spawnCarsOnAdjacentRoads(row, col, spawnData.cars, cellsX, cellsY)
        }
        if (spawnData.persons > 0) {
          console.log(`🚶 Port: Spawning ${spawnData.persons} persons po fly-away`)
          canvasRef.value?.spawnPersonsAtBuilding(row, col, spawnData.persons, cellsX, cellsY)
        }
      }, 5600)
    } else {
      // Bez fly-away - dočasný smoke/light flash na 3 sekundy
      canvasRef.value?.showProductionEffects(row, col)
      setTimeout(() => {
        canvasRef.value?.hideProductionEffects(row, col)

        // Spawn cars/persons po skončení efektu
        if (spawnData.cars > 0) {
          console.log(`🚗 Port: Spawning ${spawnData.cars} cars po produkcii`)
          canvasRef.value?.spawnCarsOnAdjacentRoads(row, col, spawnData.cars, cellsX, cellsY)
        }
        if (spawnData.persons > 0) {
          console.log(`🚶 Port: Spawning ${spawnData.persons} persons po produkcii`)
          canvasRef.value?.spawnPersonsAtBuilding(row, col, spawnData.persons, cellsX, cellsY)
        }
      }, 3000)
    }
  }, 100)

  // Zatvor modálne okno pri port budovách
  closeBuildingModal()
}

// Handler pre zníženie resource na kapacitu po odpočítavaní
const handleReduceToCapacity = (resourceId) => {
  const resource = resources.value.find(r => r.id === resourceId)
  if (!resource) return
  
  const capacity = storedResources.value[resourceId]
  const capacityNum = capacity !== undefined ? Number(capacity) : 0
  
  // Ak je capacity 0 (alebo undefined ale zobrazuje sa /0), dáme surovinu na 0
  if (capacityNum <= 0 && resource.amount > 0) {
    console.log(`📉 Znižujem ${resource.name} z ${resource.amount} na 0 (bez skladu)`)
    resource.amount = 0
  }
  // Ak je capacity väčšia ako 0 a resource je nad kapacitou
  else if (capacityNum > 0 && resource.amount > capacityNum) {
    console.log(`📉 Znižujem ${resource.name} z ${resource.amount} na kapacitu ${capacityNum}`)
    resource.amount = capacityNum
  }
}

// Handler pre kliknutie na alokovanú work force - zobrazí ikony na canvase
let allocationHighlightTimeout = null
const handleShowAllocations = (resourceId) => {
  const allocations = workforceAllocations.value[resourceId]
  if (!allocations || allocations.length === 0) {
    console.log(`👷 Žiadne alokácie pre resource ${resourceId}`)
    return
  }
  
  console.log(`👷 Zobrazujem alokácie pre ${resourceId}:`, allocations)
  
  // Zobraz ikony na canvase
  const positions = allocations.map(a => ({
    row: a.row,
    col: a.col,
    amount: a.amount,
    type: a.type,
    buildingName: a.buildingName
  }))
  
  canvasRef.value?.showWorkforceAllocations(positions)
  
  // Automaticky skry po 4 sekundách
  if (allocationHighlightTimeout) clearTimeout(allocationHighlightTimeout)
  allocationHighlightTimeout = setTimeout(() => {
    canvasRef.value?.hideWorkforceAllocations()
  }, 4000)
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
      :selectedBuildingDestinationTiles="selectedBuildingDestinationTiles"
      :selectedBuildingCanBuildOnlyInDestination="selectedBuildingCanBuildOnlyInDestination"
      @cell-selected="handleCellSelected"
      @image-placed="handleImagePlaced"
      @toggle-numbering="handleToggleNumbering"
      @toggle-gallery="handleToggleGallery"
      @toggle-grid="handleToggleGrid"
      @road-placed="handleRoadPlaced"
      @building-clicked="handleBuildingClicked"
      @building-deleted="handleBuildingDeleted"
      @building-state-changed="handleBuildingStateChanged"
      @building-construction-complete="handleBuildingConstructionComplete"
    />
    
    <!-- Header -->
    <header>
      <div class="header-left">
        <label class="resource-check-toggle">
          <input type="checkbox" v-model="ignoreResourceCheck" />
          <span>🚫 Vypnúť kontrolu resources</span>
        </label>
      </div>
      
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
        :buildingProductionStates="buildingProductionStates"
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
        :storedResources="storedResources"
        :allocatedResources="allocatedResources"
        @reduce-to-capacity="handleReduceToCapacity"
        @show-allocations="handleShowAllocations"
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
          <div v-if="clickedBuilding.isPort" class="info-row">
            <span class="info-label">Typ:</span>
            <span class="info-value port-badge">🚢 Port</span>
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
            <div 
              v-for="(cost, index) in clickedBuilding.operationalCost" 
              :key="index" 
              class="resource-item"
              :class="{ 'insufficient': missingOperationalResources.has(cost.resourceId) }"
            >
              <span class="resource-name">{{ cost.resourceName }}</span>
              <span class="resource-amount">{{ cost.amount }}</span>
            </div>
          </div>
        </div>
        
        <!-- PORT: Payload a Capacity -->
        <template v-if="clickedBuilding.isPort">
          <!-- Capacity Progress Bar -->
          <div class="building-info-section">
            <h3>📊 Kapacita portu</h3>
            <div class="port-capacity-section">
              <div class="port-capacity-bar-container">
                <div 
                  class="port-capacity-bar-fill" 
                  :style="{ width: portFillPercent + '%' }"
                  :class="{ 'near-full': portFillPercent > 80, 'full': portFillPercent >= 100 }"
                ></div>
              </div>
              <div class="port-capacity-text">
                {{ currentPortWeight }} / {{ portMaxCapacity }} ({{ Math.round(portFillPercent) }}%)
              </div>
            </div>
          </div>
          
          <!-- Payload sekcia -->
          <div class="building-info-section">
            <h3>📦 Payload</h3>
            
            <!-- Pridanie do payloadu -->
            <div class="payload-add-section">
              <select v-model="selectedPayloadResource" class="payload-select">
                <option value="" disabled>Vyber resource...</option>
                <option 
                  v-for="ar in (clickedBuilding.allowedResources || [])" 
                  :key="ar.resourceId" 
                  :value="ar.resourceId"
                >
                  {{ ar.resourceName }}
                </option>
              </select>
              <input 
                type="number" 
                v-model.number="payloadAmount" 
                min="1" 
                class="payload-amount-input"
                placeholder="Množstvo"
              />
              <button 
                class="payload-add-button" 
                @click="addPortPayload"
                :disabled="!selectedPayloadResource || payloadAmount <= 0 || portFillPercent >= 100"
              >
                ➕ Pridať
              </button>
            </div>
            
            <!-- Zoznam payloadu -->
            <div v-if="portPayload.length > 0" class="payload-list">
              <div v-for="(item, index) in portPayload" :key="index" class="payload-item">
                <span class="payload-resource-name">{{ item.resourceName }}</span>
                <span class="payload-resource-amount">× {{ item.amount }}</span>
                <span class="payload-resource-weight">
                  (⚖️ {{ (resources.find(r => r.id === item.resourceId)?.weight || 0) * item.amount }})
                </span>
                <button class="payload-remove-button" @click="removePortPayload(index)">✕</button>
              </div>
            </div>
            <p v-else class="payload-empty">Žiadny náklad</p>
          </div>
          
          <!-- Port Production Controls - len jednorázový cyklus, bez auto -->
          <div v-if="(clickedBuilding.production && clickedBuilding.production.length > 0) || (clickedBuilding.operationalCost && clickedBuilding.operationalCost.length > 0)" class="building-info-section">
            <template v-if="currentBuildingAnimState === 'waiting'">
              <h3>🚚 Čaká na pracovnú silu...</h3>
              <div class="build-in-progress">
                <div class="build-progress-animation waiting">
                  <div class="build-progress-bar waiting-bar"></div>
                </div>
                <p class="build-progress-text">Čaká sa na príchod pracovnej sily.</p>
                <div class="worker-count-section">
                  <label>👷 Pracovníci:</label>
                  <div class="worker-count-controls">
                    <button class="worker-btn" :disabled="currentBuildingWorkers <= 1" @click="changeConstructionWorkers(currentBuildingWorkers - 1)">−</button>
                    <span class="worker-count-value">{{ currentBuildingWorkers }}</span>
                    <button class="worker-btn" :disabled="currentBuildingWorkers >= maxBuildingWorkers" @click="changeConstructionWorkers(currentBuildingWorkers + 1)">+</button>
                  </div>
                  <span class="worker-speed-info">{{ currentBuildingWorkers }}× rýchlosť</span>
                </div>
              </div>
            </template>
            <template v-else-if="currentBuildingAnimState === 'building'">
              <h3>🏗️ Stavba prebieha...</h3>
              <div class="build-in-progress">
                <div class="build-progress-animation">
                  <div class="build-progress-bar"></div>
                </div>
                <p class="build-progress-text">Budova sa stavia.</p>
                <div class="worker-count-section">
                  <label>👷 Pracovníci:</label>
                  <div class="worker-count-controls">
                    <button class="worker-btn" :disabled="currentBuildingWorkers <= 1" @click="changeConstructionWorkers(currentBuildingWorkers - 1)">−</button>
                    <span class="worker-count-value">{{ currentBuildingWorkers }}</span>
                    <button class="worker-btn" :disabled="currentBuildingWorkers >= maxBuildingWorkers" @click="changeConstructionWorkers(currentBuildingWorkers + 1)">+</button>
                  </div>
                  <span class="worker-speed-info">{{ currentBuildingWorkers }}× rýchlosť</span>
                </div>
              </div>
            </template>
            <template v-else>
              <h3>⚙️ Ovládanie portu</h3>
              <div class="production-controls">
                <button 
                  class="production-button"
                  :class="{ disabled: !canStartProduction() || portPayload.length === 0 }"
                  :disabled="!canStartProduction() || portPayload.length === 0"
                  @click="startPortProduction"
                >
                  <span v-if="!canStartProduction()">⛔ Nedostatok resources</span>
                  <span v-else-if="portPayload.length === 0">📦 Prázdny payload</span>
                  <span v-else>▶️ Štart</span>
                </button>
              </div>
              <p v-if="!canStartProduction()" class="production-warning">
                ⚠️ Nemáte dostatok resources na prevádzku!
              </p>
              <p v-else-if="portPayload.length === 0" class="production-warning">
                📦 Pridajte resources do payloadu pred spustením.
              </p>
            </template>
          </div>
        </template>
        
        <!-- NORMÁLNA BUDOVA: Stored, Production, Production Controls -->
        <template v-else>
        <!-- Stored (Sklad) -->
        <div v-if="clickedBuilding.stored && clickedBuilding.stored.length > 0" class="building-info-section">
          <h3>🏪 Skladovacia kapacita</h3>
          <div class="resource-list">
            <div v-for="(store, index) in clickedBuilding.stored" :key="index" class="resource-item stored">
              <span class="resource-name">{{ store.resourceName }}</span>
              <span class="resource-amount">{{ store.amount }}</span>
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
        
        <!-- Production Controls - zobrazí sa aj pre budovy bez produkcie, ak majú operationalCost -->
        <div v-if="(clickedBuilding.production && clickedBuilding.production.length > 0) || (clickedBuilding.operationalCost && clickedBuilding.operationalCost.length > 0)" class="building-info-section">
          
          <!-- Čaká na pracovnú silu -->
          <template v-if="currentBuildingAnimState === 'waiting'">
            <h3>🚚 Čaká na pracovnú silu...</h3>
            <div class="build-in-progress">
              <div class="build-progress-animation waiting">
                <div class="build-progress-bar waiting-bar"></div>
              </div>
              <p class="build-progress-text">Čaká sa na príchod pracovnej sily. Stavba začne po príchode auta.</p>
              <div class="worker-count-section">
                <label>👷 Pracovníci:</label>
                <div class="worker-count-controls">
                  <button class="worker-btn" :disabled="currentBuildingWorkers <= 1" @click="changeConstructionWorkers(currentBuildingWorkers - 1)">−</button>
                  <span class="worker-count-value">{{ currentBuildingWorkers }}</span>
                  <button class="worker-btn" :disabled="currentBuildingWorkers >= maxBuildingWorkers" @click="changeConstructionWorkers(currentBuildingWorkers + 1)">+</button>
                </div>
                <span class="worker-speed-info">{{ currentBuildingWorkers }}× rýchlosť</span>
              </div>
            </div>
          </template>
          
          <!-- Stavba prebieha -->
          <template v-else-if="currentBuildingAnimState === 'building'">
            <h3>🏗️ Stavba prebieha...</h3>
            <div class="build-in-progress">
              <div class="build-progress-animation">
                <div class="build-progress-bar"></div>
              </div>
              <p class="build-progress-text">Budova sa stavia. Produkcia sa spustí automaticky po dokončení stavby.</p>
              <div class="worker-count-section">
                <label>👷 Pracovníci:</label>
                <div class="worker-count-controls">
                  <button class="worker-btn" :disabled="currentBuildingWorkers <= 1" @click="changeConstructionWorkers(currentBuildingWorkers - 1)">−</button>
                  <span class="worker-count-value">{{ currentBuildingWorkers }}</span>
                  <button class="worker-btn" :disabled="currentBuildingWorkers >= maxBuildingWorkers" @click="changeConstructionWorkers(currentBuildingWorkers + 1)">+</button>
                </div>
                <span class="worker-speed-info">{{ currentBuildingWorkers }}× rýchlosť</span>
              </div>
            </div>
          </template>
          
          <!-- Normálne ovládanie produkcie -->
          <template v-else>
            <h3 v-if="clickedBuilding.production && clickedBuilding.production.length > 0">⚙️ Ovládanie produkcie</h3>
            <h3 v-else>⚙️ Ovládanie prevádzky</h3>
            
            <!-- Tlačidlo na spustenie produkcie -->
            <div class="production-controls">
              <button 
                v-if="clickedBuilding.production && clickedBuilding.production.length > 0"
                class="production-button"
                :class="{ disabled: !canStartProduction() || currentBuildingAutoEnabled }"
                :disabled="!canStartProduction() || currentBuildingAutoEnabled"
                @click="startProduction"
              >
                <span v-if="canStartProduction()">▶️ Spustiť produkciu</span>
                <span v-else>⛔ Nedostatok resources</span>
              </button>
              
              <label class="auto-production-toggle" :class="{ 'with-progress': currentBuildingAutoEnabled }">
                <input 
                  type="checkbox" 
                  :checked="currentBuildingAutoEnabled"
                  @change="toggleAutoProduction"
                  :disabled="!canStartProduction()"
                />
                <span class="toggle-content">
                  <span class="toggle-text">🔄 Auto (5s)</span>
                  <div v-if="currentBuildingAutoEnabled" class="progress-bar-container">
                    <div class="progress-bar-fill" :style="{ width: currentBuildingProgress + '%' }"></div>
                  </div>
                </span>
              </label>
            </div>
            
            <p v-if="!canStartProduction()" class="production-warning">
              ⚠️ Nemáte dostatok resources na prevádzku!
            </p>
          </template>
        </div>
        </template>
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
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

.header-left {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
}

.resource-check-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: white;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  color: #667eea;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: all 0.2s;
  user-select: none;
}

.resource-check-toggle:hover {
  background: #f0f0f0;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.resource-check-toggle input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #667eea;
  margin: 0;
}

.resource-check-toggle span {
  font-size: 0.9rem;
  white-space: nowrap;
}

.header-controls {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
}

.resource-check-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: white;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  color: #667eea;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: all 0.2s;
  user-select: none;
}

.resource-check-toggle:hover {
  background: #f0f0f0;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.resource-check-toggle input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #667eea;
}

.resource-check-toggle span {
  font-size: 0.9rem;
  white-space: nowrap;
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

.port-badge {
  background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%);
  color: white;
  padding: 0.35rem 0.75rem;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 600;
}

/* Port Capacity Bar */
.port-capacity-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.port-capacity-bar-container {
  width: 100%;
  height: 20px;
  background: #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #d1d5db;
}

.port-capacity-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #22c55e, #16a34a);
  border-radius: 10px;
  transition: width 0.3s ease;
}

.port-capacity-bar-fill.near-full {
  background: linear-gradient(90deg, #f59e0b, #d97706);
}

.port-capacity-bar-fill.full {
  background: linear-gradient(90deg, #ef4444, #dc2626);
}

.port-capacity-text {
  text-align: center;
  font-size: 0.85rem;
  color: #6b7280;
  font-weight: 600;
}

/* Payload Section */
.payload-add-section {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  align-items: center;
}

.payload-select {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.85rem;
  background: white;
}

.payload-amount-input {
  width: 70px;
  padding: 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.85rem;
  text-align: center;
}

.payload-add-button {
  padding: 0.5rem 0.75rem;
  background: #2563eb;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  transition: background 0.2s;
}

.payload-add-button:hover:not(:disabled) {
  background: #1d4ed8;
}

.payload-add-button:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.payload-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.payload-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 6px;
  font-size: 0.85rem;
}

.payload-resource-name {
  flex: 1;
  font-weight: 600;
  color: #1e40af;
}

.payload-resource-amount {
  color: #475569;
  font-weight: 500;
}

.payload-resource-weight {
  color: #64748b;
  font-size: 0.8rem;
}

.payload-remove-button {
  background: #fee2e2;
  color: #dc2626;
  border: 1px solid #fca5a5;
  border-radius: 4px;
  cursor: pointer;
  padding: 0.15rem 0.4rem;
  font-size: 0.8rem;
  transition: background 0.2s;
}

.payload-remove-button:hover {
  background: #fecaca;
}

.payload-empty {
  text-align: center;
  color: #9ca3af;
  font-style: italic;
  font-size: 0.85rem;
  padding: 0.5rem 0;
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

.resource-item.stored .resource-amount {
  color: #2196f3;
  background: rgba(33, 150, 243, 0.1);
  font-weight: 600;
}

.resource-item.insufficient {
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.05);
}

.resource-item.insufficient .resource-name {
  color: #dc2626;
  font-weight: 600;
}

.resource-item.insufficient .resource-amount {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.15);
  font-weight: 700;
}

/* Production button */
.production-button {
  width: 100%;
  padding: 1rem 1.5rem;
  margin-top: 1rem;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  font-size: 1.1rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);
}

.production-button:hover:not(.disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
}

.production-button:active:not(.disabled) {
  transform: translateY(0);
}

.production-button.disabled {
  background: linear-gradient(135deg, #9ca3af 0%, #6b7280 100%);
  cursor: not-allowed;
  box-shadow: none;
}

.production-controls {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 1rem;
}

.auto-production-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: #f0f9ff;
  border: 2px solid #3b82f6;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  color: #3b82f6;
  transition: all 0.2s;
  user-select: none;
  position: relative;
  overflow: hidden;
}

.auto-production-toggle:hover {
  background: #dbeafe;
}

.auto-production-toggle:has(input:checked) {
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  color: white;
  animation: pulse-auto 2s infinite;
}

.auto-production-toggle.with-progress {
  padding-bottom: 1.5rem;
}

.toggle-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  z-index: 1;
}

.toggle-text {
  white-space: nowrap;
}

.progress-bar-container {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 6px;
  background: rgba(255, 255, 255, 0.3);
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #10b981 0%, #059669 100%);
  transition: width 0.1s linear;
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.5);
}

@keyframes pulse-auto {
  0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
  50% { box-shadow: 0 0 0 8px rgba(59, 130, 246, 0); }
}

.auto-production-toggle input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #3b82f6;
}

.auto-production-toggle:has(input:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}

.auto-production-toggle input:disabled {
  cursor: not-allowed;
}

.production-warning {
  margin: 0.75rem 0 0 0;
  padding: 0.75rem;
  background: rgba(245, 158, 11, 0.1);
  border-left: 4px solid #f59e0b;
  border-radius: 4px;
  color: #b45309;
  font-size: 0.9rem;
  font-weight: 500;
}

/* Build in progress */
.build-in-progress {
  text-align: center;
  padding: 1rem;
}

.build-progress-animation {
  width: 100%;
  height: 8px;
  background: #e5e7eb;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 0.75rem;
}

.build-progress-bar {
  width: 30%;
  height: 100%;
  background: linear-gradient(90deg, #667eea, #764ba2, #667eea);
  background-size: 200% 100%;
  border-radius: 4px;
  animation: build-progress-slide 1.5s ease-in-out infinite;
}

@keyframes build-progress-slide {
  0% { margin-left: -30%; }
  100% { margin-left: 100%; }
}

.build-progress-animation.waiting {
  background: #fef3c7;
}

.build-progress-bar.waiting-bar {
  background: linear-gradient(90deg, #f59e0b, #d97706, #f59e0b);
  background-size: 200% 100%;
  animation: build-progress-pulse 2s ease-in-out infinite;
}

@keyframes build-progress-pulse {
  0% { opacity: 0.4; margin-left: 0; width: 100%; }
  50% { opacity: 1; margin-left: 0; width: 100%; }
  100% { opacity: 0.4; margin-left: 0; width: 100%; }
}

.build-progress-text {
  margin: 0;
  color: #6b7280;
  font-size: 0.85rem;
  font-style: italic;
}

.worker-count-section {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: rgba(102, 126, 234, 0.08);
  border-radius: 8px;
  border: 1px solid rgba(102, 126, 234, 0.15);
}

.worker-count-section label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #4b5563;
  white-space: nowrap;
}

.worker-count-controls {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.worker-btn {
  width: 28px;
  height: 28px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  font-size: 1rem;
  font-weight: bold;
  color: #374151;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.worker-btn:hover:not(:disabled) {
  background: #667eea;
  color: white;
  border-color: #667eea;
}

.worker-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.worker-count-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: #1f2937;
  min-width: 24px;
  text-align: center;
}

.worker-speed-info {
  font-size: 0.8rem;
  color: #667eea;
  font-weight: 600;
  margin-left: auto;
  white-space: nowrap;
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
