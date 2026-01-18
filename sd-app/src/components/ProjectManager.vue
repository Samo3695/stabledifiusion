<script setup>
import { ref } from 'vue'

const props = defineProps({
  images: {
    type: Array,
    required: true
  },
  showNumbering: {
    type: Boolean,
    default: false
  },
  showGallery: {
    type: Boolean,
    default: false
  },
  showGrid: {
    type: Boolean,
    default: true
  },
  canvasRef: {
    type: Object,
    default: null
  },
  environmentColors: {
    type: Object,
    default: () => ({ hue: 0, saturation: 100, brightness: 100 })
  },
  personSpawnSettings: {
    type: Object,
    default: () => ({ enabled: false, count: 3 })
  }
})

const emit = defineEmits(['load-project', 'update:showNumbering', 'update:showGallery', 'update:showGrid'])

const fileInput = ref(null)

// Uloží projekt do JSON súboru
const saveProject = () => {
  if (props.images.length === 0) {
    alert('Žiadne obrázky na uloženie!')
    return
  }

  try {
    // Získaj umiestnené obrázky zo šachovnice
    const placedImages = {}
    let backgroundTiles = []
    
    // Mapa pre deduplikáciu obrázkov - url -> id
    const uniqueImages = new Map()
    let imageIdCounter = 1
    
    if (props.canvasRef && typeof props.canvasRef.cellImages === 'function') {
      const cellImagesData = props.canvasRef.cellImages()
      
      Object.entries(cellImagesData).forEach(([key, imageData]) => {
        const [row, col] = key.split('-').map(Number)
        const url = imageData.url
        
        // Skontroluj či tento obrázok už máme
        let imageId
        if (uniqueImages.has(url)) {
          imageId = uniqueImages.get(url)
        } else {
          // Nový unikátny obrázok
          imageId = `img_${imageIdCounter++}`
          uniqueImages.set(url, imageId)
        }
        
        // Ulož len referenciu na obrázok (nie celé base64!) + všetky metadáta
        placedImages[key] = {
          row,
          col,
          imageId,  // referencia namiesto url
          cellsX: imageData.cellsX || 1,
          cellsY: imageData.cellsY || 1,
          isBackground: imageData.isBackground || false,
          isRoadTile: imageData.isRoadTile || false,
          templateName: imageData.templateName || '',
          tileMetadata: imageData.tileMetadata || null
        }
      })
    }
    
    // Získaj background tiles zo šachovnice
    if (props.canvasRef && typeof props.canvasRef.backgroundTiles === 'function') {
      backgroundTiles = props.canvasRef.backgroundTiles() || []
    }
    
    // Konvertuj uniqueImages mapu na pole objektov
    const imageLibrary = []
    uniqueImages.forEach((id, url) => {
      imageLibrary.push({ id, url })
    })

    // Priprav dáta pre export
    const projectData = {
      version: '1.4',  // Nová verzia s deduplikáciou
      timestamp: new Date().toISOString(),
      imageCount: props.images.length,
      placedImageCount: Object.keys(placedImages).length,
      uniqueImageCount: imageLibrary.length,  // Počet unikátnych obrázkov
      images: props.images.map(img => ({
        id: img.id,
        url: img.url,
        prompt: img.prompt || '',
        negativePrompt: img.negativePrompt || '',
        cellsX: img.cellsX || 1,
        cellsY: img.cellsY || 1,
        view: img.view || '',
        timestamp: img.timestamp || new Date().toISOString()
      })),
      imageLibrary,  // Unikátne obrázky pre placedImages
      placedImages,
      environmentColors: props.environmentColors,
      backgroundTiles: backgroundTiles
    }

    // Konvertuj na JSON string
    const jsonString = JSON.stringify(projectData, null, 2)
    
    // Vytvor blob a stiahni súbor
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `isometric-project-${Date.now()}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    console.log('✅ Projekt uložený:', projectData.imageCount, 'obrázkov v galérii,', projectData.placedImageCount, 'umiestnených na šachovnici')
    console.log('   📦 Unikátnych obrázkov:', imageLibrary.length, '(deduplikované z', Object.keys(placedImages).length, ')')
  } catch (error) {
    console.error('❌ Chyba pri ukladaní projektu:', error)
    alert('Chyba pri ukladaní projektu: ' + error.message)
  }
}

// Načíta projekt z JSON súboru
const loadProject = () => {
  fileInput.value?.click()
}

const handleFileUpload = async (event) => {
  const file = event.target.files[0]
  if (!file) return

  try {
    const text = await file.text()
    const projectData = JSON.parse(text)

    // Validácia
    if (!projectData.images || !Array.isArray(projectData.images)) {
      throw new Error('Neplatný formát projektu')
    }

    console.log('📂 Načítavam projekt:', projectData.imageCount, 'obrázkov v galérii')
    console.log('   Verzia:', projectData.version)
    console.log('   Dátum vytvorenia:', projectData.timestamp)
    if (projectData.placedImages) {
      console.log('   Umiestnené obrázky na šachovnici:', Object.keys(projectData.placedImages).length)
    }
    
    // Spracuj placedImages - zrekonštruuj URL z imageLibrary (verzia 1.4+)
    let processedPlacedImages = projectData.placedImages || {}
    
    if (projectData.version >= '1.4' && projectData.imageLibrary) {
      // Nový formát s deduplikáciou - vytvor mapu id -> url
      const imageMap = new Map()
      projectData.imageLibrary.forEach(img => {
        imageMap.set(img.id, img.url)
      })
      
      console.log('   📦 Unikátnych obrázkov v knižnici:', projectData.imageLibrary.length)
      
      // Zrekonštruuj plné URL pre každý placedImage + všetky metadáta
      processedPlacedImages = {}
      Object.entries(projectData.placedImages).forEach(([key, data]) => {
        processedPlacedImages[key] = {
          row: data.row,
          col: data.col,
          url: imageMap.get(data.imageId) || data.url,  // fallback na url ak existuje
          cellsX: data.cellsX || 1,
          cellsY: data.cellsY || 1,
          isBackground: data.isBackground || false,
          isRoadTile: data.isRoadTile || false,
          templateName: data.templateName || '',
          tileMetadata: data.tileMetadata || null
        }
      })
    }
    // Pre staršie verzie (1.3 a menej) - url je priamo v placedImages

    // Emituj event do App.vue s načítanými obrázkami a placement dátami
    emit('load-project', {
      images: projectData.images,
      placedImages: processedPlacedImages,
      environmentColors: projectData.environmentColors || { hue: 0, saturation: 100, brightness: 100 },
      backgroundTiles: projectData.backgroundTiles || []
    })

    // Resetuj file input
    event.target.value = ''

    console.log('✅ Projekt načítaný!')
  } catch (error) {
    console.error('❌ Chyba pri načítavaní projektu:', error)
    alert('Chyba pri načítavaní projektu: ' + error.message)
  }
}

// Vyčisti všetky obrázky
const clearProject = () => {
  if (props.images.length === 0) {
    alert('Galéria je už prázdna!')
    return
  }

  if (confirm(`Naozaj chcete vymazať všetkých ${props.images.length} obrázkov z galérie?`)) {
    emit('load-project', {
      images: [],
      placedImages: {}
    })
    console.log('🗑️ Projekt vyčistený')
  }
}
</script>

<template>
  <div class="project-manager">
    <div class="button-group">
      <button @click="saveProject" class="btn btn-save" title="Uložiť projekt do JSON súboru">
        💾 Save
      </button>
      
      <button @click="loadProject" class="btn btn-load" title="Načítať projekt z JSON súboru">
        📂 Load
      </button>
      
      <button @click="clearProject" class="btn btn-clear" title="Vymazať všetky obrázky">
        🗑️ Clear
      </button>
      
      <span class="image-count" v-if="images.length > 0">
        {{ images.length }} {{ images.length === 1 ? 'obrázok' : images.length < 5 ? 'obrázky' : 'obrázkov' }}
      </span>
    </div>

    <!-- Checkboxy pre zobrazenie -->
    <div class="toggle-group">
      <label class="toggle-label" title="Zobraziť/skryť číslovanie políčok">
        <input 
          type="checkbox" 
          :checked="showNumbering"
          @change="$emit('update:showNumbering', $event.target.checked)"
        />
        <span>🔢 Číslovanie</span>
      </label>
      
      <label class="toggle-label" title="Zobraziť/skryť galériu obrázkov">
        <input 
          type="checkbox" 
          :checked="showGallery"
          @change="$emit('update:showGallery', $event.target.checked)"
        />
        <span>🖼️ Galéria</span>
      </label>
      
      <label class="toggle-label" title="Zobraziť/skryť mriežku šachovnice">
        <input 
          type="checkbox" 
          :checked="showGrid"
          @change="$emit('update:showGrid', $event.target.checked)"
        />
        <span>⊞ Mriežka</span>
      </label>
    </div>

    <!-- Skrytý file input -->
    <input
      ref="fileInput"
      type="file"
      accept=".json"
      @change="handleFileUpload"
      style="display: none"
    />
  </div>
</template>

<style scoped>
.project-manager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 1rem;
  width: 100%;
}

.button-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.toggle-group {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  color: white;
  font-weight: 600;
  font-size: 0.9rem;
  user-select: none;
  transition: opacity 0.2s;
}

.toggle-label:hover {
  opacity: 0.8;
}

.toggle-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #10b981;
}

.btn {
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}

.btn:active {
  transform: translateY(0);
}

.btn-save {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
}

.btn-save:hover {
  background: linear-gradient(135deg, #059669 0%, #047857 100%);
}

.btn-load {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
}

.btn-load:hover {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
}

.btn-clear {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: white;
}

.btn-clear:hover {
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
}

.image-count {
  padding: 0.6rem 1rem;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 8px;
  font-weight: 600;
  color: #667eea;
  font-size: 0.9rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
</style>
