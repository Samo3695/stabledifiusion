<script setup>
import { ref, watch, nextTick, computed } from 'vue'
import BuildingGenerator from './components/BuildingGenerator.vue'
import EnvironmentGenerator from './components/EnvironmentGenerator.vue'
import CharacterGenerator from './components/CharacterGenerator.vue'
import ImageGallery from './components/ImageGallery.vue'
import PhaserCanvas from './components/PhaserCanvas.vue'
import ProjectManager from './components/ProjectManager.vue'
import ResourceDisplay from './components/ResourceDisplay.vue'
import Modal from './components/Modal.vue'
import { buildRoad, regenerateRoadTilesOnCanvas } from './utils/roadBuilder.js'

const images = ref([])
const lastImageCellsX = ref(1)
const lastImageCellsY = ref(1)
const selectedImageId = ref(null)
const selectedImageData = ref(null) // Celý objekt vybraného obrázka (aj road tiles)
const templateSelected = ref(false)
const selectedCell = ref({ row: -1, col: -1 })
const canvasRef = ref(null)
const imageGeneratorRef = ref(null)
const showNumbering = ref(false)
const showGallery = ref(true)
const showGrid = ref(true)
const activeGenerator = ref('building') // 'building', 'environment' alebo 'character'
const deleteMode = ref(false) // Režim mazania buildingov
const environmentColors = ref({ hue: 0, saturation: 100, brightness: 100 }) // Farby prostredia
const textureSettings = ref({ tilesPerImage: 1, tileResolution: 512, customTexture: null }) // Textúrové nastavenia
const roadBuildingMode = ref(false) // Režim stavby ciest
const roadTiles = ref([]) // Road tiles z ImageGallery
const imageGalleryRef = ref(null) // Referencia na ImageGallery
const isLoading = ref(false) // Loading state
const loadingProgress = ref(0) // Loading progress (0-100)
const loadingStatus = ref('') // Loading status text
const personSpawnEnabled = ref(false)
const personSpawnCount = ref(0)
const resources = ref([]) // Resources list
const workforce = ref([]) // Workforce list
const roadSpriteUrl = ref('/templates/roads/sprites/pastroad.png') // Aktuálny road sprite URL
const roadOpacity = ref(100) // Aktuálna opacity pre road tiles
const viewMode = ref('editor') // 'editor' alebo 'gameplay'
const canvasImagesMap = ref({}) // Mapa budov na canvase (pre vypočítanie použitých resources)
const showInsufficientResourcesModal = ref(false)
const insufficientResourcesData = ref({ 
  buildingName: '', 
  missingBuildResources: [], 
  missingOperationalResources: [] 
})

const handleImageGenerated = async (image, cellsX = 1, cellsY = 1) => {
  console.log('📥 App.vue: Prijatý image-generated event')
  console.log('   Image ID:', image.id)
  console.log('   CellsX x CellsY:', cellsX, 'x', cellsY)
  console.log('   Template name:', image.templateName)
  console.log('   Vybrané políčko:', selectedCell.value)
  console.log('   Canvas ref existuje?', canvasRef.value ? 'ÁNO' : 'NIE')
  
  // Ak ide o road sprite, aktualizuj sprite namiesto pridania do galérie
  if (image.isRoadSprite) {
    const spriteInfo = image.url.startsWith('data:') 
      ? `data URL (${Math.round(image.url.length / 1024)}KB)` 
      : image.url
    console.log('🛣️ App.vue: Detekovaný Road Sprite - aktualizujem sprite namiesto pridania do galérie')
    console.log('   Template name:', image.templateName)
    console.log('   Sprite typ:', spriteInfo)
    roadSpriteUrl.value = image.url // Ulož pre uloženie do projektu
    console.log('   roadSpriteUrl.value uložené (dĺžka):', image.url.length, 'znakov')
    
    // Počkaj na Vue reactivity aby sa prop aktualizoval
    await nextTick()
    
    if (imageGalleryRef.value && imageGalleryRef.value.updateRoadSprite) {
      await imageGalleryRef.value.updateRoadSprite(image.url)
      console.log('✅ Road sprite úspešne aktualizovaný v ImageGallery')
      
      // Počkaj kým sa nové tiles načítajú a propagujú cez road-tiles-ready event
      await new Promise(resolve => setTimeout(resolve, 400))
      
      // Pregeneruj všetky existujúce road tiles na canvase s novým sprite
      // Použi tiles priamo z ImageGallery ref aby sme mali garantovane nové tiles
      if (canvasRef.value && imageGalleryRef.value.roadTiles?.value?.length > 0) {
        const newTiles = imageGalleryRef.value.roadTiles.value
        console.log('🔄 Regenerujem existujúce road tiles na canvas s novým sprite...', newTiles.length, 'tiles')
        regenerateRoadTilesOnCanvas(canvasRef.value, newTiles)
        console.log('✅ Road tiles na canvas pregenerované s novým sprite')
        
        // Aktualizuj aj App.vue roadTiles (pre nové kreslenie)
        roadTiles.value = newTiles
        console.log('✅ App.vue roadTiles aktualizované pre nové kreslenie')
      }
    } else {
      console.warn('⚠️ ImageGallery ref alebo updateRoadSprite funkcia nie je dostupná')
    }
    return // Skonči tu, nepridávaj do galérie
  }
  
  // Pre ostatné taby - normálne pridaj do galérie
  images.value.unshift(image)
  lastImageCellsX.value = cellsX
  lastImageCellsY.value = cellsY
  // Automaticky vyberieme nový obrázok
  selectedImageId.value = image.id
  
  // Ak je vybrané políčko, vlož obrázok tam
  if (selectedCell.value.row !== -1 && selectedCell.value.col !== -1 && canvasRef.value) {
    console.log('🎯 App.vue: Volám placeImageAtSelectedCell()')
    console.log('   URL:', image.url.substring(0, 50) + '...')
    console.log('   isBackground:', image.isBackground || false)
    console.log('   templateName:', image.templateName || '')
    const result = canvasRef.value.placeImageAtSelectedCell(image.url, cellsX, cellsY, image.isBackground || false, image.templateName || '')
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

const handleSelectImage = ({ id, imageData }) => {
  selectedImageId.value = id
  selectedImageData.value = imageData
  console.log(`🖼️ App.vue: Vybraný obrázok ID: ${id}`, imageData ? '(s dátami)' : '(bez dát)')
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

const handleRoadBuildingModeChanged = (isRoadMode) => {
  roadBuildingMode.value = isRoadMode
  console.log(`🛣️ App.vue: Road building mode ${isRoadMode ? 'zapnutý' : 'vypnutý'}`)
}

const handleRoadTilesReady = (tiles) => {
  roadTiles.value = tiles
  console.log(`🛣️ App.vue: Road tiles načítané: ${tiles.length} tiles`)
}

const handlePersonSpawnSettingsChanged = ({ enabled, count }) => {
  personSpawnEnabled.value = !!enabled
  const parsed = Number.isFinite(count) ? count : 0
  personSpawnCount.value = Math.max(0, Math.min(500, Math.round(parsed)))
  console.log(`🚶 App.vue: Person spawn ${personSpawnEnabled.value ? 'ON' : 'OFF'}, count=${personSpawnCount.value}`)
}

// Watch pre zmenu roadTiles - keď sa zmení opacity, regeneruj canvas
watch(roadTiles, (newTiles, oldTiles) => {
  // Kontrola či sa zmenila opacity (nie len prvé načítanie)
  if (oldTiles && oldTiles.length > 0 && newTiles.length > 0) {
    const oldOpacity = oldTiles[0]?.opacity || 100
    const newOpacity = newTiles[0]?.opacity || 100
    
    if (oldOpacity !== newOpacity && canvasRef.value) {
      console.log(`🎨 App.vue: Detekovaná zmena opacity ${oldOpacity}% → ${newOpacity}%, regenerujem canvas`)
      regenerateRoadTilesOnCanvas(canvasRef.value, newTiles)
    }
  }
}, { deep: true })

const handleRoadOpacityChanged = (newOpacity) => {
  roadOpacity.value = newOpacity // Ulož do state pre uloženie projektu
  console.log(`🎨 App.vue: Road opacity event prijatý: ${newOpacity}%`)
  

}

const handleTextureSettingsChange = (settings) => {
  textureSettings.value = settings
  console.log('📐 App.vue: Textúrové nastavenia zmenené:', settings)
}

const handleRoadPlaced = ({ path }) => {
  buildRoad(canvasRef.value, roadTiles.value, path)
}

const handlePlaceOnBoard = (image) => {
  console.log('📌 App.vue: Prijatý place-on-board event pre obrázok:', image.id, image)
  
  // Kontrola operational resources pre budovy - LEN V GAMEPLAY MODE
  if (viewMode.value === 'gameplay' && image.buildingData && image.buildingData.isBuilding) {
    const resourceCheck = checkBuildingResources(image.buildingData)
    if (!resourceCheck.hasEnough) {
      // Zobraz modal s chýbajúcimi resources
      insufficientResourcesData.value = {
        buildingName: image.buildingData.buildingName || 'Budova',
        missingBuildResources: resourceCheck.missingBuild,
        missingOperationalResources: resourceCheck.missingOperational
      }
      showInsufficientResourcesModal.value = true
      console.log('⛔ App.vue: Nedostatok resources:', resourceCheck)
      return // Nezakladať budovu
    }
  }
  
  if (canvasRef.value && selectedCell.value.row !== -1 && selectedCell.value.col !== -1) {
    // Ak je vybraté políčko, vlož obrázok tam
    const cellsX = image.cellsX || lastImageCellsX.value
    const cellsY = image.cellsY || lastImageCellsY.value
    const isRoadTile = image.id?.startsWith('road_tile_')
    
    // Pre road tiles vytvor tileMetadata
    const tileMetadata = isRoadTile ? {
      name: image.name,
      tileIndex: image.tileIndex,
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height,
      rotation: image.rotation
    } : null
    
    console.log('🎯 Vkladám obrázok na políčko:', selectedCell.value, `s veľkosťou ${cellsX}x${cellsY}`)
    if (isRoadTile) {
      console.log('   🛣️ Road tile metadata:', tileMetadata)
    }
    
    // Použij placeImageAtCell pre road tiles aby sme posielali všetky parametre
    if (isRoadTile && canvasRef.value.placeImageAtCell) {
      canvasRef.value.placeImageAtCell(
        selectedCell.value.row,
        selectedCell.value.col,
        image.url,
        cellsX,
        cellsY,
        false, // isBackground
        true, // isRoadTile
        image.bitmap || null,
        image.name || '',
        tileMetadata
      )
    } else {
      canvasRef.value.placeImageAtSelectedCell(image.url, cellsX, cellsY, image)
    }
  } else if (canvasRef.value) {
    // Inak vlož obrázok na prvé voľné políčko
    console.log('🎯 Vkladám obrázok na prvé voľné políčko')
    const cellsX = image.cellsX || lastImageCellsX.value
    const cellsY = image.cellsY || lastImageCellsY.value
    // Vyber prvé políčko ako fallback
    selectedCell.value = { row: 0, col: 0 }
    canvasRef.value.placeImageAtSelectedCell(image.url, cellsX, cellsY, image)
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

const handleRoadSpriteSelected = async (spriteUrl) => {
  console.log('🛣️ App.vue: Prijatý road-sprite-selected event:', spriteUrl)
  roadSpriteUrl.value = spriteUrl // Ulož pre uloženie do projektu
  if (imageGalleryRef.value && imageGalleryRef.value.updateRoadSprite) {
    await imageGalleryRef.value.updateRoadSprite(spriteUrl)
    console.log('✅ Road sprite úspešne aktualizovaný v ImageGallery')
  } else {
    console.warn('⚠️ ImageGallery ref alebo updateRoadSprite funkcia nie je dostupná')
  }
}

const handleCellSelected = ({ row, col }) => {
  selectedCell.value = { row, col }
  console.log(`App.vue: Políčko vybrané [${row}, ${col}]`)
  
  // Ak je aktualívny režim mazania, vymaž building na políčku
  if (deleteMode.value && canvasRef.value) {
    console.log(`🗑️ App.vue: Režim mazania - vymazanie buildingu na [${row}, ${col}]`)
    canvasRef.value.deleteImageAtCell(row, col)
    // Vyčisti výber obrázku aby sa nestal náhodne vložený na ďalšie políčko
    selectedImageId.value = null
    selectedImageData.value = null
    return
  }
  
  // Ak je vybraný obrázok z galérie, vlož ho na toto políčko
  if (selectedImageId.value && canvasRef.value) {
    // Najprv skús nájsť v images, potom použi selectedImageData (pre road tiles)
    let selectedImage = images.value.find(img => img.id === selectedImageId.value)
    
    if (!selectedImage && selectedImageData.value) {
      selectedImage = selectedImageData.value
    }
    
    if (selectedImage) {
      // Kontrola operational resources pre budovy - LEN V GAMEPLAY MODE
      if (viewMode.value === 'gameplay' && selectedImage.buildingData && selectedImage.buildingData.isBuilding) {
        const resourceCheck = checkBuildingResources(selectedImage.buildingData)
        if (!resourceCheck.hasEnough) {
          // Zobraz modal s chýbajúcimi resources
          insufficientResourcesData.value = {
            buildingName: selectedImage.buildingData.buildingName || 'Budova',
            missingBuildResources: resourceCheck.missingBuild,
            missingOperationalResources: resourceCheck.missingOperational
          }
          showInsufficientResourcesModal.value = true
          console.log('⛔ App.vue: Nedostatok resources:', resourceCheck)
          return // Nezakladať budovu
        }
      }
      
      console.log(`🖼️ App.vue: Vkladám vybraný obrázok z galérie (${selectedImageId.value})`)
      // Vždy použij aktuálnu veľkosť z grid size tabs (lastImageCellsX/Y)
      console.log(`   Aktuálna veľkosť z grid tabs: ${lastImageCellsX.value}x${lastImageCellsY.value}`)
      console.log(`   isBackground: ${selectedImage.isBackground || false}`)
      console.log(`   templateName: ${selectedImage.templateName || ''}`)
      
      // Zisti či je to road tile (ID začína na "road_tile_")
      const isRoadTile = selectedImageId.value.startsWith('road_tile_')
      console.log(`   isRoadTile: ${isRoadTile}`)
      
      // Pre road tiles pošli aj tileMetadata
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
          false, // isBackground
          true, // isRoadTile
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
  
  // Políčko je vybrané, ale obrázok sa nebude automaticky generovať
  // Užívateľ musí kliknúť na tlačidlo "Generovať" v BuildingGenerator
  console.log(`✅ App.vue: Políčko [${row}, ${col}] je označené - pripravené na umiestnenie`)
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

const handleCharacterGenerated = (characterData) => {
  console.log('🎭 App.vue: Prijaté character-generated event')
  console.log('   Počet obrázkov:', characterData.images.length)
  console.log('   Prompt:', characterData.prompt)
  
  // Pridaj vygenerované character obrázky do galérie
  characterData.images.forEach(img => {
    images.value.unshift({
      id: img.id,
      url: img.url,
      cellsX: 1,
      cellsY: 1,
      view: img.view
    })
  })
  
  // Vyber prvý obrázok
  if (characterData.images.length > 0) {
    selectedImageId.value = characterData.images[0].id
  }
  
  console.log('✅ Character obrázky pridané do galérie')
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
  
  // Obnov farby prostredia
  environmentColors.value = loadedColors
  console.log('🎨 App.vue: Farby prostredia načítané:', loadedColors)
  
  // Obnov textúrové nastavenia
  textureSettings.value = loadedTextureSettings
  console.log('📐 App.vue: Textúrové nastavenia načítané:', loadedTextureSettings)
  
  // Ak existuje vlastná textúra, automaticky ju aplikuj na canvas
  if (loadedTextureSettings.customTexture && canvasRef.value) {
    console.log('🎨 App.vue: Detekovaná vlastná textúra, aplikujem na canvas...')
    // Vytvor jednoduchý canvas pre spracovanie textúry
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
      
      // Aplikuj na canvas
      await canvasRef.value.setBackgroundTiles([processedTexture], loadedTextureSettings.tilesPerImage || 1)
      console.log('✅ App.vue: Vlastná textúra automaticky aplikovaná na canvas')
    }
    img.src = loadedTextureSettings.customTexture
  }
  
  // Obnov resources a workforce
  resources.value = loadedResources
  workforce.value = loadedWorkforce
  console.log('📊 App.vue: Resources a workforce načítané:', loadedResources.length, loadedWorkforce.length)
  
  // Obnov road sprite URL a opacity
  roadSpriteUrl.value = loadedRoadSpriteUrl
  roadOpacity.value = loadedRoadOpacity
  const spriteInfo = loadedRoadSpriteUrl.startsWith('data:') 
    ? `data URL (${Math.round(loadedRoadSpriteUrl.length / 1024)}KB)` 
    : loadedRoadSpriteUrl
  console.log('🛣️ App.vue: Road sprite URL načítané:', spriteInfo)
  console.log('🎨 App.vue: Road opacity načítaná:', loadedRoadOpacity + '%')
  
  // Aplikuj background tiles na šachovnicu
  if (loadedTiles.length > 0 && canvasRef.value && canvasRef.value.setBackgroundTiles) {
    canvasRef.value.setBackgroundTiles(loadedTiles, 1)
    console.log('🎨 App.vue: Background tiles aplikované:', loadedTiles.length, 'tile-ov')
  }
  
  if (loadedImages.length === 0) {
    // Vyčisti galériu a šachovnicu
    images.value = []
    selectedImageId.value = null
    if (canvasRef.value && canvasRef.value.clearAll) {
      canvasRef.value.clearAll()
    }
    console.log('🗑️ App.vue: Galéria vyčistená')
    return
  }
  
  console.log('📂 App.vue: Načítavam projekt s', loadedImages.length, 'obrázkami')
  console.log('   Umiestnené obrázky:', Object.keys(placedImages).length)
  
  // Nahraď všetky obrázky novými
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
  
  // Vyber prvý obrázok
  if (images.value.length > 0) {
    selectedImageId.value = images.value[0].id
  } else {
    selectedImageId.value = null
  }
  
  // Obnov umiestnené obrázky na šachovnici - POSTUPNE PO DÁVKACH
  if (canvasRef.value && Object.keys(placedImages).length > 0) {
    // Najprv vyčisti šachovnicu
    if (typeof canvasRef.value.clearAll === 'function') {
      canvasRef.value.clearAll()
      console.log('🧹 Šachovnica vyčistená')
    }
    
    const totalObjects = Object.keys(placedImages).length
    console.log('🎯 Začínam postupné načítavanie', totalObjects, 'objektov...')
    
    // Zapni loading a batch mode
    isLoading.value = true
    loadingProgress.value = 0
    loadingStatus.value = `Načítavam mapu (0/${totalObjects})...`
    
    // Zapni batch loading mode - preskočí tiene a osoby
    if (typeof canvasRef.value.startBatchLoading === 'function') {
      canvasRef.value.startBatchLoading()
    }
    
    // Konvertuj na pole pre jednoduchšie spracovanie
    const objectsToLoad = Object.entries(placedImages)
    
    // Načítavaj po dávkach (10 objektov za frame - menej pre lepšiu plynulosť)
    const BATCH_SIZE = 10
    let currentIndex = 0
    let successCount = 0
    
    const loadBatch = async () => {
      const batchEnd = Math.min(currentIndex + BATCH_SIZE, totalObjects)
      
      for (let i = currentIndex; i < batchEnd; i++) {
        const [key, imageData] = objectsToLoad[i]
        const { row, col, url, cellsX, cellsY, isBackground, isRoadTile, templateName, tileMetadata } = imageData
        
        // Pre road tiles - rekreuj URL z aktuálneho roadTiles (už má správnu opacity)
        let finalUrl = url
        let finalBitmap = null
        if (isRoadTile && tileMetadata && roadTiles.value.length > 0) {
          // Nájdi tile podľa tileIndex z metadata
          const tile = roadTiles.value.find(t => t.tileIndex === tileMetadata.tileIndex)
          if (tile) {
            finalUrl = tile.url
            finalBitmap = tile.bitmap
            console.log(`🛣️ Road tile rekreovaný z metadata: ${tileMetadata.name} (index ${tileMetadata.tileIndex})`)
          } else {
            console.warn(`⚠️ Road tile metadata nenájdený pre index ${tileMetadata.tileIndex}, použijem uložené URL`)
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
              finalBitmap, // bitmap pre rýchle kreslenie
              templateName || '',
              tileMetadata || null // Pošli tileMetadata
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
        // Načítaj ďalšiu dávku v nasledujúcom frame
        requestAnimationFrame(loadBatch)
      } else {
        // Všetky objekty načítané - teraz vykonaj odložené operácie
        loadingStatus.value = 'Finalizujem tiene a postavy...'
        
        // Ukonči batch loading - vykoná tiene a osoby
        setTimeout(() => {
          if (canvasRef.value && typeof canvasRef.value.finishBatchLoading === 'function') {
            canvasRef.value.finishBatchLoading()
          }
          
          setTimeout(() => {
            isLoading.value = false
            loadingProgress.value = 100
            loadingStatus.value = 'Hotovo!'
            console.log(`✅ Načítaných ${successCount}/${totalObjects} objektov na šachovnici`)
            
            // Po dokončení načítania, aktualizuj canvas mapu
            handleCanvasUpdated()
        
          }, 500)
        }, 100)
      }
    }
    
  // Aplikuj road sprite a opacity asynchrónne po načítaní projektu
  const applyRoadSprite = async (retryCount = 0) => {
    const MAX_RETRIES = 20 // Maximálne 20 pokusov (2 sekundy)
    
    if (imageGalleryRef.value && imageGalleryRef.value.updateRoadSprite) {
      console.log('🔧 DEBUG applyRoadSprite:', {
        loadedRoadSpriteUrl: loadedRoadSpriteUrl.substring(0, 50) + '...',
        loadedRoadOpacity,
        hasUpdateMethod: !!imageGalleryRef.value.updateRoadSprite
      })
      
      // Najprv nastav opacity (PRED načítaním sprite!)
      // roadOpacity je ref exposovaný z ImageGallery, pristupujeme k nemu priamo
      if (imageGalleryRef.value.roadOpacity !== undefined) {
        imageGalleryRef.value.roadOpacity = loadedRoadOpacity
        console.log('🎨 Road opacity nastavená na:', loadedRoadOpacity + '%')
      }
      
      // Počkaj kým sa opacity propaguje
      await new Promise(resolve => setTimeout(resolve, 50))
      
      // Počkaj na Vue reactivity aby sa prop aktualizoval
      await nextTick()
      
      // Potom aplikuj sprite (rekreuje tiles s novou opacity)
      console.log('📞 Volám updateRoadSprite s URL:', loadedRoadSpriteUrl.substring(0, 50) + '...')
      await imageGalleryRef.value.updateRoadSprite(loadedRoadSpriteUrl)
      console.log('✅ Road sprite aplikovaný s opacity:', loadedRoadOpacity + '%', spriteInfo)
      
      // Počkaj kým sa tiles načítajú (dôležité!)
      await new Promise(resolve => setTimeout(resolve, 300))
      console.log('✅ applyRoadSprite DOKONČENÝ')
      return true // Úspech
      
    } else if (retryCount < MAX_RETRIES) {
      // Galéria možno nie je zobrazená alebo ešte nie je mounted
      if (retryCount === 0) {
        console.log('⏳ ImageGallery ref nie je dostupný, čakám...')
      }
      await new Promise(resolve => setTimeout(resolve, 100))
      return await applyRoadSprite(retryCount + 1) // Rekurzívne čakaj
    } else {
      console.warn('⚠️ ImageGallery ref nedostupný po', MAX_RETRIES, 'pokusoch - možno je galéria skrytá')
      console.log('💡 Road sprite sa aplikuje automaticky keď zobrazíte galériu')
      return false // Zlyhanie
    }
  }
  
  // Počkaj na načítanie road sprite PRED načítavaním mapy (aby tiles boli dostupné)
  const startLoadingWithDelay = async () => {
    // Počkaj kým sa road sprite načíta (applyRoadSprite MUSÍ byť hotový!)
    console.log('⏳ Čakám na načítanie road sprite...')
    const spriteLoaded = await applyRoadSprite()
    
    if (spriteLoaded) {
      console.log('✅ Road sprite úspešne načítaný, začínam načítavať mapu...')
      
      // Počkaj kým sa roadTiles.value aktualizuje (emitované cez road-tiles-ready event)
      let waitCount = 0
      while (roadTiles.value.length === 0 && waitCount < 20) {
        console.log('⏳ Čakám na roadTiles.value...', waitCount)
        await new Promise(resolve => setTimeout(resolve, 100))
        waitCount++
      }
      
      if (roadTiles.value.length > 0) {
        console.log('✅ roadTiles.value pripravené:', roadTiles.value.length, 'tiles')
      } else {
        console.warn('⚠️ roadTiles.value stále prázdne po 2 sekundách čakania!')
      }
    } else {
      console.warn('⚠️ Road sprite sa nepodarilo načítať, mapu načítavam aj tak...')
    }
    
    // Spusti načítavanie mapy
    requestAnimationFrame(loadBatch)
  }
  
  startLoadingWithDelay()
  } else if (Object.keys(placedImages).length === 0) {
    console.log('ℹ️ Žiadne umiestnené obrázky v projekte')
  } else {
    console.error('❌ Canvas ref neexistuje, nemôžem obnoviť umiestnené obrázky')
  }
  
  console.log('✅ Projekt načítaný, obrázky v galérii:', images.value.length)
}

const handleUpdateResources = (data) => {
  resources.value = data.resources || []
  workforce.value = data.workforce || []
  console.log('📊 App.vue: Resources a workforce aktualizované:', resources.value.length, workforce.value.length)
}

const handleUpdateBuildingData = ({ imageId, buildingData }) => {
  const image = images.value.find(img => img.id === imageId)
  if (image) {
    // Ulož do buildingData objektu (nie priamo do image properties)
    image.buildingData = {
      isBuilding: buildingData.isBuilding,
      buildingName: buildingData.buildingName,
      buildCost: buildingData.buildCost,
      operationalCost: buildingData.operationalCost,
      production: buildingData.production
    }
    console.log('🏗️ App.vue: Building data aktualizované pre obrázok:', imageId, buildingData)
  }
}

const handleModeChanged = (mode) => {
  viewMode.value = mode
  console.log('🔄 App.vue: Režim zmenený na:', mode)
}

// Funkcia na kontrolu dostupnosti resources pre stavbu a prevádzku
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
    
    // Pre build cost kontrolujeme len dostupné (base amount)
    // NEODČÍTAME produkciu ani použité, iba čisté zásoby
    if (resource.amount < cost.amount) {
      missingBuild.push({
        name: cost.resourceName,
        needed: cost.amount,
        available: resource.amount
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

const handleCanvasUpdated = () => {
  // Aktualizuj mapu budov na canvase
  if (canvasRef.value && canvasRef.value.cellImages) {
    const cellImages = canvasRef.value.cellImages()
    const newMap = {}
    
    Object.entries(cellImages).forEach(([key, data]) => {
      // Nájdi imageId z URL alebo templateName
      const matchingImage = images.value.find(img => 
        img.url === data.url || 
        (data.templateName && img.templateName === data.templateName)
      )
      
      if (matchingImage) {
        newMap[key] = {
          imageId: matchingImage.id,
          url: data.url,
          templateName: data.templateName
        }
      }
    })
    
    canvasImagesMap.value = newMap
    console.log('🔄 App.vue: Canvas aktualizovaný, budov na canvase:', Object.keys(newMap).length)
  }
}
</script>

<template>
  <div id="app">
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
    
    <!-- Canvas na pozadí (celá obrazovka) -->
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
      @image-placed="(data) => { handleImagePlaced(data); handleCanvasUpdated(); }"
      @toggle-numbering="handleToggleNumbering"
      @toggle-gallery="handleToggleGallery"
      @toggle-grid="handleToggleGrid"
      @road-placed="handleRoadPlaced"
    />
    
    <!-- Header (absolútne pozicionovaný) -->
    <header>
      <ProjectManager
        :mode="viewMode" 
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
        @mode-changed="handleModeChanged"
      />
    </header>
    
    <!-- Pravý sidebar (absolútne pozicionovaný) -->
    <aside class="sidebar">
      <!-- Editor Mode: Generátory -->
      <template v-if="viewMode === 'editor'">
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
          <button 
            :class="{ active: activeGenerator === 'character' }"
            @click="activeGenerator = 'character'"
          >
            🎭 Character
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
          @road-sprite-selected="handleRoadSpriteSelected"
        />
        
        <!-- Environment Generator -->
        <EnvironmentGenerator
          v-if="activeGenerator === 'environment'"
          :initialColors="environmentColors"
          :initialTextureSettings="textureSettings"
          @tiles-generated="handleTilesGenerated"
          @color-change="environmentColors = $event"
          @texture-settings-change="handleTextureSettingsChange"
        />
        
        <!-- Character Generator -->
        <CharacterGenerator
          v-if="activeGenerator === 'character'"
          @character-generated="handleCharacterGenerated"
        />
      </template>
      
      <!-- Game Play Mode: Resources Display -->
      <template v-else>
        <ResourceDisplay :resources="resources" :usedResources="usedResources" :producedResources="producedResources" />
      </template>
    </aside>
    
    <!-- Galéria dole (absolútne pozicionovaná) -->
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
  right: 230px;
  padding: 0.75rem 2rem;
  text-align: center;
  background: rgba(102, 126, 234, 0.95);
  backdrop-filter: blur(10px);
  z-index: 10;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
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
  right: 230px;
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

/* Insufficient Resources Modal */
.insufficient-resources-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.insufficient-resources-content h3 {
  margin: 0;
  color: #667eea;
  font-size: 1.3rem;
}

.missing-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.warning-text {
  margin: 0;
  color: #d32f2f;
  font-weight: 600;
  font-size: 1rem;
}

.missing-resources-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.missing-resource-item {
  padding: 1rem;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.missing-resource-item.build-cost {
  background: #fff3e0;
  border-left: 4px solid #ff9800;
}

.missing-resource-item.operational-cost {
  background: #ffebee;
  border-left: 4px solid #f44336;
}

.missing-resource-item .resource-name {
  font-weight: 600;
  font-size: 1.1rem;
  color: #333;
}

.missing-resource-item .resource-amounts {
  display: flex;
  gap: 1rem;
  font-size: 0.9rem;
}

.missing-resource-item .needed {
  color: #1976d2;
  font-weight: 600;
}

.missing-resource-item .available {
  color: #4caf50;
  font-weight: 600;
}

.missing-resource-item .deficit {
  color: #d32f2f;
  font-weight: 700;
}
</style>
