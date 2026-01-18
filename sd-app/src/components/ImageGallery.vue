<script setup>
import { ref, watch, onMounted } from 'vue'

const props = defineProps({
  images: Array,
  selectedImageId: String,
  canvas: Object // Referencia na canvas pre regeneráciu road tiles
})

const emit = defineEmits(['delete', 'select', 'place-on-board', 'grid-size-changed', 'delete-mode-changed', 'road-building-mode-changed', 'road-tiles-ready', 'road-opacity-changed'])

const selectedImage = ref(null)
const selectedGridSize = ref(1) // 1, 4, 9, 16, 25, alebo -1 pre režim mazania
const activeGalleryTab = ref('roads') // 'gallery' alebo 'roads'
const roadTiles = ref([]) // Vyrezané road tiles zo sprite
const roadTilesOriginal = ref([]) // Originálne road tiles bez opacity zmeny
const roadBuildingMode = ref(true) // Režim stavby ciest - automatický výber tiles
const roadOpacity = ref(100) // Opacity pre road tiles (0-100)
const roadSpriteUrl = ref('/templates/roads/sprites/pastroad.png') // Aktuálny sprite URL

// Načítaj a rozrež road sprite na 12 tiles (4 stĺpce x 3 riadky) s izometrickou maskou
const loadRoadSprite = async () => {
  const spritePath = roadSpriteUrl.value
  const img = new Image()
  img.crossOrigin = 'anonymous'
  
  img.onload = async () => {
    // ═══════════════════════════════════════════════════════════════════
    // MANUÁLNA DEFINÍCIA POZÍCIÍ ROAD TILES V SPRITE (presentroad.png)
    // 
    // Každý tile má vlastné súradnice:
    //   x, y     = pozícia ľavého horného rohu v sprite (v pixeloch)
    //   width    = šírka výrezu v sprite (v pixeloch)
    //   height   = výška výrezu v sprite (v pixeloch)
    //   name     = názov tile pre zobrazenie v galérii
    //
    // Cieľová veľkosť po vyrezaní: 64×32 px (izometrické políčko)
    // ═══════════════════════════════════════════════════════════════════
    const tileDefinitions = [
      // { name: 'Názov', x: 0, y: 0, width: 100, height: 50 },
      
      { name: 'Rovná ↘', x: 570, y: 266, width: 205, height: 105, rotation: 10 },
      { name: 'Rovná ↙', x: 20, y: 152, width: 205, height: 105, rotation: 0 },
      
      // Rohy
      { name: 'Roh ↙', x: 580, y: 413, width: 205, height: 105, rotation: 0},
      { name: 'Roh ↘', x: 727, y: 342, width: 205, height: 105, rotation: 0 },
      { name: 'Roh ↖', x: 309, y: 275, width: 205, height: 105, rotation: 0  },
      { name: 'Roh ↗', x: 437, y: 78, width: 205, height: 105, rotation: 0  }, //nastavené ručne
      
      // T-križovatky
      { name: 'T ↖', x: 576, y: 146, width: 205, height: 105, rotation: 0 },
      { name: 'T ↘', x: 176, y: 73, width: 205, height: 105, rotation: 0 },
      { name: 'T ↗', x: 313, y: 141, width: 205, height: 105, rotation: 1 },
      { name: 'T ↙', x: 726, y: 74, width: 205, height: 105, rotation: 0 },
      
      // Križovatka a koniec
      { name: 'Križovatka +', x: 449, y: 206, width: 205, height: 105, rotation: 0 }, //vyladane super
      { name: 'Koniec', x: 768, y: 384, width: 256, height: 128, rotation: 0 },
    ]
    
    // Cieľová veľkosť políčka (rovnaká ako v PhaserCanvas)
    // Zväčši tieto hodnoty pre väčšie priblíženie v galérii
    const TILE_WIDTH = 80
    const TILE_HEIGHT = 40
    
    const tiles = []
    
    for (let i = 0; i < tileDefinitions.length; i++) {
      const def = tileDefinitions[i]
      
      // Vytvor canvas s veľkosťou políčka
      const canvas = document.createElement('canvas')
      canvas.width = TILE_WIDTH
      canvas.height = TILE_HEIGHT
      const ctx = canvas.getContext('2d')
      
      // Škáluj obrázok aby šírka zodpovedala TILE_WIDTH
      const scale = TILE_WIDTH / def.width
      const scaledHeight = def.height * scale
      
      // Najprv vytvor izometrickú masku (diamant)
      ctx.beginPath()
      ctx.moveTo(TILE_WIDTH / 2, 0) // Hore
      ctx.lineTo(TILE_WIDTH, TILE_HEIGHT / 2) // Vpravo
      ctx.lineTo(TILE_WIDTH / 2, TILE_HEIGHT) // Dole
      ctx.lineTo(0, TILE_HEIGHT / 2) // Vľavo
      ctx.closePath()
      ctx.clip() // Aplikuj masku
      
      // Potom nakresli tile (vycentrovaný a škálovaný)
      const offsetY = (TILE_HEIGHT - scaledHeight) / 2
      ctx.drawImage(
        img,
        def.x, def.y, def.width, def.height,  // Zdrojová oblasť v sprite
        0, offsetY, TILE_WIDTH, scaledHeight   // Cieľová oblasť na canvas
      )
      
      let bitmap = null
      try {
        bitmap = await createImageBitmap(canvas)
      } catch (e) {
        console.warn('createImageBitmap zlyhalo, fallback na dataURL', e)
      }
      
      tiles.push({
        id: `road_tile_${i}`,
        url: canvas.toDataURL('image/png'),
        bitmap, // pripravené na rýchle kreslenie
        name: def.name,
        index: i
      })
    }
    
    roadTiles.value = tiles
    roadTilesOriginal.value = JSON.parse(JSON.stringify(tiles)) // Ulož originály
    console.log(`🛣️ Načítaných ${tiles.length} road tiles zo sprite (manuálne pozície)`)
  }
  
  img.onerror = () => {
    console.error('Nepodarilo sa načítať road sprite')
  }
  
  img.src = spritePath
}

// Funkcia na aktualizáciu sprite URL a reloadnutie tiles
const updateRoadSprite = async (newSpriteUrl) => {
  console.log('🔄 Aktualizujem road sprite na:', newSpriteUrl)
  roadSpriteUrl.value = newSpriteUrl
  await loadRoadSprite()
}

// Načítaj sprite pri štarte
onMounted(() => {
  loadRoadSprite()
})

// Watch pre zmenu tabu - aktivuj road building mode keď je roads tab
watch(activeGalleryTab, (newTab) => {
  const isRoadTab = newTab === 'roads'
  emit('road-building-mode-changed', isRoadTab && roadBuildingMode.value)
  console.log(`🛣️ Road building mode: ${isRoadTab && roadBuildingMode.value ? 'AKTÍVNY' : 'NEAKTÍVNY'}`)
})

// Watch pre roadTiles - keď sú načítané, pošli ich do parent komponentu
watch(roadTiles, (tiles) => {
  if (tiles.length > 0) {
    emit('road-tiles-ready', tiles)
    // Aktivuj road building mode ak sme na roads tabe
    if (activeGalleryTab.value === 'roads') {
      emit('road-building-mode-changed', roadBuildingMode.value)
    }
  }
}, { immediate: true })

// Funkcia na regenerovanie road tiles s novou opacity
const regenerateRoadTilesWithOpacity = async () => {
  if (roadTilesOriginal.value.length === 0) {
    console.warn('⚠️ Originálne tiles nie sú dostupné')
    return
  }
  
  const opacityValue = roadOpacity.value / 100 // Konvertuj na 0-1
  const newTiles = []
  
  for (const originalTile of roadTilesOriginal.value) {
    // Vytvor canvas z originálneho URL
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    await new Promise((resolve, reject) => {
      img.onload = async () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        
        // Nastav opacity a nakresli obrázok
        ctx.globalAlpha = opacityValue
        ctx.drawImage(img, 0, 0)
        
        let bitmap = null
        try {
          bitmap = await createImageBitmap(canvas)
        } catch (e) {
          console.warn('createImageBitmap zlyhalo, fallback na dataURL', e)
        }
        
        newTiles.push({
          ...originalTile,
          url: canvas.toDataURL('image/png'),
          bitmap,
          opacity: roadOpacity.value
        })
        
        resolve()
      }
      img.onerror = reject
      img.src = originalTile.url
    })
  }
  
  roadTiles.value = newTiles
  console.log(`🎨 Road tiles regenerované s opacity ${roadOpacity.value}%`)
  
  // Emitni event s novými tiles pre parent komponent aby regeneroval canvas
  emit('road-opacity-changed', roadOpacity.value)
}

// Watch pre zmenu opacity
watch(roadOpacity, async (newOpacity) => {
  await regenerateRoadTilesWithOpacity()
})

// Funkcia na získanie road tile podľa smeru
const getRoadTileByDirection = (direction) => {
  // direction: 'horizontal' (↘) alebo 'vertical' (↙)
  const tileName = direction === 'horizontal' ? 'Rovná ↘' : 'Rovná ↙'
  return roadTiles.value.find(t => t.name === tileName)
}

// Expose pre parent komponent
defineExpose({
  getRoadTileByDirection,
  roadTiles,
  updateRoadSprite,
  activeGalleryTab
})

const copyToClipboard = async (text, label = 'text') => {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch (err) {
    console.error(`Kopírovanie ${label} zlyhalo:`, err)
  }
}

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
  // Najprv skús nájsť v images, potom v roadTiles
  let selected = props.images.find(img => img.id === props.selectedImageId)
  
  if (!selected) {
    selected = roadTiles.value.find(tile => tile.id === props.selectedImageId)
  }
  
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
  
  <!-- Gallery/Roads tabs -->
  <div class="gallery-tabs">
    <button 
      @click="activeGalleryTab = 'gallery'" 
      :class="{ active: activeGalleryTab === 'gallery' }"
      class="gallery-tab-btn"
    >
      🖼️ Galéria
    </button>
    <button 
      @click="activeGalleryTab = 'roads'" 
      :class="{ active: activeGalleryTab === 'roads' }"
      class="gallery-tab-btn"
    >
      🛣️ Roads
    </button>
  </div>
  
  <!-- Opacity control for roads -->
  <div v-if="activeGalleryTab === 'roads'" class="opacity-control">
    <label for="road-opacity">Priehľadnosť (Opacity):</label>
    <div class="opacity-input-group">
      <input 
        id="road-opacity"
        v-model.number="roadOpacity" 
        type="range" 
        min="0" 
        max="100" 
        step="5"
        class="opacity-slider"
      />
      <span class="opacity-value">{{ roadOpacity }}%</span>
    </div>
  </div>
  
  <div class="gallery">
    
    <!-- Gallery tab content -->
    <template v-if="activeGalleryTab === 'gallery'">
      <div v-if="images.length === 0" class="empty-state">
        <p>📷 Zatiaľ nemáte žiadne vygenerované obrázky</p>
        <p>Začnite generovaním svojho prvého obrázka!</p>
      </div>

      <div v-else class="gallery-grid">
        <div 
          v-for="image in images" 
          :key="image.id" 
          :class="['gallery-item', { 'selected': image.id === selectedImageId }]"
          @click="emit('select', { id: image.id, imageData: image })"
          @dblclick="openModal(image)"
        >
          <img :src="image.url" :alt="image.prompt" />
          <div class="image-overlay">
            <p class="prompt-preview">{{ image.prompt }}</p>
          </div>
          <div v-if="image.id === selectedImageId" class="selected-badge">✓</div>
        </div>
      </div>
    </template>
    
    <!-- Roads tab content -->
    <template v-else-if="activeGalleryTab === 'roads'">
      <div v-if="roadTiles.length === 0" class="empty-state">
        <p>⏳ Načítavam road tiles...</p>
      </div>
      
      <div v-else class="roads-grid">
        <div 
          v-for="tile in roadTiles" 
          :key="tile.id" 
          :class="['road-tile-item', { 'selected': tile.id === selectedImageId }]"
          @click="emit('select', { id: tile.id, imageData: tile })"
        >
          <img :src="tile.url" :alt="tile.name" />
          <div class="tile-label">{{ tile.name }}</div>
          <div v-if="tile.id === selectedImageId" class="selected-badge">✓</div>
        </div>
      </div>
    </template>

    <!-- Modal -->
    <Teleport to="body">
      <div v-if="selectedImage" class="modal-overlay" @click="closeModal">
        <div class="modal-content" @click.stop>
          <button class="close-btn" @click="closeModal">✕</button>
          
          <img :src="selectedImage.url" :alt="selectedImage.prompt" class="modal-image" />
          
          <div class="modal-info">
            <div class="info-section">
              <div class="info-header">
                <h3>Prompt:</h3>
                <button 
                  class="copy-btn"
                  @click="copyToClipboard(selectedImage.prompt || '', 'prompt')"
                  type="button"
                  :disabled="!selectedImage.prompt"
                >
                  Copy
                </button>
              </div>
              <p class="prompt-text">{{ selectedImage.prompt || '—' }}</p>
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

/* Gallery/Roads tabs */
.gallery-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 0.5rem;
  margin-top: 0.5rem;
}

.gallery-tab-btn {
  flex: 1;
  padding: 0.5rem 1rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  background: #f8f9fa;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
  color: #666;
}

.gallery-tab-btn:hover {
  border-color: #667eea;
  background: rgba(102, 126, 234, 0.05);
}

.gallery-tab-btn.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-color: #667eea;
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

.info-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.copy-btn {
  padding: 0.35rem 0.65rem;
  border: 1px solid #d0d7de;
  background: #f8f9fa;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.copy-btn:hover:not(:disabled) {
  background: #eef2ff;
  border-color: #667eea;
}

.copy-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.prompt-text {
  white-space: pre-wrap;
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

/* Opacity control */
.opacity-control {
  padding: 0.75rem;
  background: #f8f9fa;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.opacity-control label {
  font-weight: 600;
  color: #333;
  margin: 0;
  white-space: nowrap;
  font-size: 0.9rem;
}

.opacity-input-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
  max-width: 300px;
}

.opacity-slider {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, rgba(102, 126, 234, 0.2), rgba(102, 126, 234, 1));
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

.opacity-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(102, 126, 234, 0.4);
  border: 2px solid white;
}

.opacity-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(102, 126, 234, 0.4);
  border: 2px solid white;
}

.opacity-value {
  font-weight: 600;
  color: #667eea;
  min-width: 50px;
  text-align: right;
  font-size: 0.9rem;
}

/* Roads grid */
.roads-grid {
  display: flex;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 0.5rem;
}

.road-tile-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  border: 2px solid transparent;
  background: #f5f5f5;
}

.road-tile-item:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  border-color: #667eea;
}

.road-tile-item.selected {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.3);
}

.road-tile-item img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.tile-label {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  font-size: 0.65rem;
  padding: 2px 4px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.road-tile-item .selected-badge {
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  font-size: 0.8rem;
}
</style>
