<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  images: Array,
  selectedImageId: String,
  lastImageCellsX: {
    type: Number,
    default: 1
  },
  lastImageCellsY: {
    type: Number,
    default: 1
  }
})

const canvas = ref(null)
let hoveredCell = { row: -1, col: -1 }
let offsetX = 0
let offsetY = 0
let scale = 1
let isDragging = false
let lastMouseX = 0
let lastMouseY = 0
let cellImages = {} // { 'row-col': { url: imageUrl, cellsX: number, cellsY: number } }
let loadedImages = {} // cache pre načítané Image objekty

// Funkcia na kontrolu kolízie - či dané políčko alebo jeho okolie má už obrázok
const checkCollision = (row, col, cellsX, cellsY) => {
  // Získame všetky políčka ktoré by boli REÁLNE obsadené novým obrázkom
  const affectedCells = []
  
  if (cellsX === 1 && cellsY === 1) {
    // 1size: len jedno políčko
    affectedCells.push(`${row}-${col}`)
  } else if (cellsX === 1 && cellsY === 2) {
    // 2size: len dve políčka nad sebou (bez vedľajších, šírka 1.5× je len vizuálna)
    affectedCells.push(`${row}-${col}`)
    affectedCells.push(`${row + 1}-${col}`)
  } else if (cellsX === 2 && cellsY === 2) {
    // 4size: štyri políčka v bloku
    affectedCells.push(`${row}-${col}`)
    affectedCells.push(`${row}-${col + 1}`)
    affectedCells.push(`${row + 1}-${col}`)
    affectedCells.push(`${row + 1}-${col + 1}`)
  }
  
  // Skontrolujeme kolíziu s každým existujúcim obrázkom
  for (const existingKey in cellImages) {
    const existing = cellImages[existingKey]
    const [existingRow, existingCol] = existingKey.split('-').map(Number)
    
    // Získame políčka obsadené existujúcim obrázkom
    const existingCells = []
    const exCellsX = existing.cellsX || 1
    const exCellsY = existing.cellsY || 1
    
    if (exCellsX === 1 && exCellsY === 1) {
      existingCells.push(`${existingRow}-${existingCol}`)
    } else if (exCellsX === 1 && exCellsY === 2) {
      existingCells.push(`${existingRow}-${existingCol}`)
      existingCells.push(`${existingRow + 1}-${existingCol}`)
    } else if (exCellsX === 2 && exCellsY === 2) {
      existingCells.push(`${existingRow}-${existingCol}`)
      existingCells.push(`${existingRow}-${existingCol + 1}`)
      existingCells.push(`${existingRow + 1}-${existingCol}`)
      existingCells.push(`${existingRow + 1}-${existingCol + 1}`)
    }
    
    // Kontrola prekrytia
    for (const newCell of affectedCells) {
      if (existingCells.includes(newCell)) {
        return true // Kolízia!
      }
    }
  }
  
  return false // Žiadna kolízia
}

const drawCheckerboard = (ctx, width, height, highlightRow = -1, highlightCol = -1) => {
  ctx.clearRect(0, 0, width, height)
  
  ctx.save()
  ctx.translate(offsetX, offsetY)
  ctx.scale(scale, scale)
  
  const rows = 50
  const cols = 50
  
  // Isometrické parametre
  const tileWidth = 50
  const tileHeight = 25
  const startX = width / 2
  const startY = 50
  
  // Vypočítame viditeľnú oblasť
  const viewMinX = (-offsetX / scale) - 100
  const viewMaxX = (-offsetX / scale) + width / scale + 100
  const viewMinY = (-offsetY / scale) - 100
  const viewMaxY = (-offsetY / scale) + height / scale + 100
  
  // Určíme koľko políčok má byť zvýraznených na hover (podľa posledného obrázka)
  const hoverCellsX = props.lastImageCellsX || 1
  const hoverCellsY = props.lastImageCellsY || 1
  
  // Skontrolujeme kolíziu pre hover pozíciu
  let hasCollision = false
  if (highlightRow !== -1 && highlightCol !== -1) {
    hasCollision = checkCollision(highlightRow, highlightCol, hoverCellsX, hoverCellsY)
  }
  
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Isometrické súradnice
      const isoX = (col - row) * (tileWidth / 2)
      const isoY = (col + row) * (tileHeight / 2)
      
      const x = startX + isoX
      const y = startY + isoY
      
      // Preskočiť políčka mimo viditeľnej oblasti
      if (x + tileWidth / 2 < viewMinX || x - tileWidth / 2 > viewMaxX ||
          y + tileHeight < viewMinY || y > viewMaxY) {
        continue
      }
      
      // Farba políčka
      const isEven = (row + col) % 2 === 0
      
      // Skontroluj či políčko je súčasťou hover bloku
      let isHighlighted = false
      if (highlightRow !== -1 && highlightCol !== -1) {
        // Pre 1size: len jedno políčko
        if (hoverCellsX === 1 && hoverCellsY === 1) {
          isHighlighted = row === highlightRow && col === highlightCol
        }
        // Pre 2size (1x2): dve políčka nad sebou
        else if (hoverCellsX === 1 && hoverCellsY === 2) {
          isHighlighted = (row === highlightRow && col === highlightCol) ||
                         (row === highlightRow + 1 && col === highlightCol)
        }
        // Pre 4size (2x2): štyri políčka v bloku
        else if (hoverCellsX === 2 && hoverCellsY === 2) {
          isHighlighted = (row === highlightRow && col === highlightCol) ||
                         (row === highlightRow && col === highlightCol + 1) ||
                         (row === highlightRow + 1 && col === highlightCol) ||
                         (row === highlightRow + 1 && col === highlightCol + 1)
        }
      }
      
      // Skontrolujeme či políčko obsahuje obrázok (len priamo, nie cez susedov)
      const cellKey = `${row}-${col}`
      const hasDirectImage = cellImages[cellKey]
      
      // Nakreslíme políčko
      if (isEven) {
        ctx.fillStyle = '#e8e8e8'
      } else {
        ctx.fillStyle = '#f8f8f8'
      }
      
      // Kreslenie kosoštvorca (diamantu)
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + tileWidth / 2, y + tileHeight / 2)
      ctx.lineTo(x, y + tileHeight)
      ctx.lineTo(x - tileWidth / 2, y + tileHeight / 2)
      ctx.closePath()
      ctx.fill()
      
      // Okraj
      ctx.strokeStyle = '#999'
      ctx.lineWidth = 1 / scale
      ctx.stroke()
    }
  }
  
  // FÁZA 2: Renderovanie buildingov v správnom z-index poradí
  // Pre isometrické zobrazenie: čím vyššie (row + col), tým bližšie ku kamere
  // Pre multi-cell buildingy použijeme maximálnu sumu zo všetkých obsadených políčok
  const buildingsToRender = Object.entries(cellImages)
    .map(([key, building]) => {
      const [row, col] = key.split('-').map(Number)
      const cellsX = building.cellsX || 1
      const cellsY = building.cellsY || 1
      
      // Vypočítame maximálnu sumu (row + col) zo všetkých obsadených políčok
      // a zároveň maximálny col pre sekundárne zoradenie
      let maxSum = row + col
      let maxCol = col
      let maxRow = row
      
      if (cellsX === 1 && cellsY === 2) {
        // 2size: dve políčka nad sebou
        const sum1 = row + col
        const sum2 = (row + 1) + col
        maxSum = Math.max(sum1, sum2)
        maxRow = row + 1  // spodné políčko
        maxCol = col
      } else if (cellsX === 2 && cellsY === 2) {
        // 4size: štyri políčka v bloku
        const sum1 = row + col
        const sum2 = row + (col + 1)
        const sum3 = (row + 1) + col
        const sum4 = (row + 1) + (col + 1)
        maxSum = Math.max(sum1, sum2, sum3, sum4)
        maxRow = row + 1  // spodný riadok
        maxCol = col + 1  // pravý stĺpec
      }
      
      return { key, row, col, maxSum, maxCol, maxRow, ...building }
    })
    .sort((a, b) => {
      // Primárne: podľa maximálnej sumy
      if (a.maxSum !== b.maxSum) return a.maxSum - b.maxSum
      // Sekundárne: pri rovnakej sume preferujeme vyšší col (pravejšie políčko)
      if (a.maxCol !== b.maxCol) return a.maxCol - b.maxCol
      // Terciárne: pri rovnakom col preferujeme vyšší row (spodnejšie políčko)
      return a.maxRow - b.maxRow
    })
  
  // Renderujeme každý building
  for (const building of buildingsToRender) {
    const { key, row, col, url, cellsX, cellsY } = building
    const img = loadedImages[key]
    
    if (img && img.complete) {
      ctx.save()
      
      // Vypočítame origin súradnice
      const originIsoX = (col - row) * (tileWidth / 2)
      const originIsoY = (col + row) * (tileHeight / 2)
      const originX = startX + originIsoX
      const originY = startY + originIsoY
      
      // Vypočítame pomer strán obrázka
      const imgAspect = img.width / img.height
      
      // Šírka obrázka - pre 2size (1x2) použijeme 1.5× šírku políčka
      let drawWidth
      if (cellsX === 1 && cellsY === 2) {
        drawWidth = tileWidth * 1.5  // 2size: 1.5× šírka pre lepšiu viditeľnosť
      } else {
        drawWidth = tileWidth * cellsX  // 1size a 4size: normálna šírka
      }
      const drawHeight = drawWidth / imgAspect
      
      // Vypočítame posun pre viacero políčok
      let offsetXForCells = 0
      let offsetYForCells = 0
      
      if (cellsX === 1 && cellsY === 2) {
        // 2 políčka nad sebou (2size)
        // Posunieme vľavo aby bol viditeľný v oboch políčkach
        offsetXForCells = -tileWidth / 4
        offsetYForCells = tileHeight / 2
      } else if (cellsX === 2 && cellsY === 2) {
        // 4 políčka v bloku 2x2 (4size) - posunieme vľavo o pol políčka
        offsetXForCells = 0  // posun vľavo o pol políčka
        offsetYForCells = tileHeight
      }
      
      // Nakresliť obrázok (spodok na spodku bloku políčok, môže presahovať hore)
      ctx.drawImage(
        img, 
        originX - drawWidth / 2 + offsetXForCells, 
        originY + tileHeight - drawHeight + offsetYForCells,  // Spodok obrázka na spodku políčka
        drawWidth, 
        drawHeight
      )
      
      ctx.restore()
    }
  }
  
  // FÁZA 3: Číslovanie políčok NAD všetkým (najvyšší z-index)
  // Kreslíme čísla až po všetkých buildingoch aby boli vždy viditeľné
  if (scale > 0.7) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const isoX = (col - row) * (tileWidth / 2)
        const isoY = (col + row) * (tileHeight / 2)
        const x = startX + isoX
        const y = startY + isoY
        
        // Preskočiť políčka mimo viditeľnej oblasti
        if (x + tileWidth / 2 < viewMinX || x - tileWidth / 2 > viewMaxX ||
            y + tileHeight < viewMinY || y > viewMaxY) {
          continue
        }
        
        ctx.fillStyle = '#ff0000'  // Červená farba
        ctx.font = `bold ${10 / scale}px Arial`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        
        // Pridáme tieň pre lepšiu čitateľnosť
        ctx.shadowColor = 'rgba(255, 255, 255, 0.8)'
        ctx.shadowBlur = 3 / scale
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 0
        
        ctx.fillText(`${row},${col}`, x, y + tileHeight / 2)
        
        // Zrušíme tieň
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
      }
    }
  }
  
  // FÁZA 4: Hover označenie NAD všetkým (najvyšší z-index)
  if (highlightRow !== -1 && highlightCol !== -1) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Zistíme či toto políčko patrí do hover bloku
        let isHighlighted = false
        
        // Pre 1size (1x1): len jedno políčko
        if (hoverCellsX === 1 && hoverCellsY === 1) {
          isHighlighted = row === highlightRow && col === highlightCol
        }
        // Pre 2size (1x2): dve políčka nad sebou
        else if (hoverCellsX === 1 && hoverCellsY === 2) {
          isHighlighted = (row === highlightRow && col === highlightCol) ||
                         (row === highlightRow + 1 && col === highlightCol)
        }
        // Pre 4size (2x2): štyri políčka v bloku
        else if (hoverCellsX === 2 && hoverCellsY === 2) {
          isHighlighted = (row === highlightRow && col === highlightCol) ||
                         (row === highlightRow && col === highlightCol + 1) ||
                         (row === highlightRow + 1 && col === highlightCol) ||
                         (row === highlightRow + 1 && col === highlightCol + 1)
        }
        
        if (isHighlighted) {
          const isoX = (col - row) * (tileWidth / 2)
          const isoY = (col + row) * (tileHeight / 2)
          const x = startX + isoX
          const y = startY + isoY
          
          // Červená výplň pri kolízii, modrá inak
          ctx.fillStyle = hasCollision ? 'rgba(255, 0, 0, 0.3)' : 'rgba(102, 126, 234, 0.5)'
          
          // Kreslenie kosoštvorca (diamantu)
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x + tileWidth / 2, y + tileHeight / 2)
          ctx.lineTo(x, y + tileHeight)
          ctx.lineTo(x - tileWidth / 2, y + tileHeight / 2)
          ctx.closePath()
          ctx.fill()
          
          // Zvýraznený okraj
          ctx.strokeStyle = hasCollision ? '#ff0000' : '#667eea'
          ctx.lineWidth = 3 / scale
          ctx.stroke()
        }
      }
    }
  }
  
  ctx.restore()
}


const getGridCell = (mouseX, mouseY, width, height) => {
  const rows = 50
  const cols = 50
  const tileWidth = 50
  const tileHeight = 25
  const startX = width / 2
  const startY = 50
  
  // Transformácia súradníc myši
  const transformedX = (mouseX - offsetX) / scale
  const transformedY = (mouseY - offsetY) / scale
  
  // Testovanie každého políčka (len v okolí)
  for (let row = rows - 1; row >= 0; row--) {
    for (let col = cols - 1; col >= 0; col--) {
      const isoX = (col - row) * (tileWidth / 2)
      const isoY = (col + row) * (tileHeight / 2)
      
      const x = startX + isoX
      const y = startY + isoY
      
      // Test či je bod vnútri kosoštvorca
      const dx = transformedX - x
      const dy = transformedY - y
      
      if (Math.abs(dx) / (tileWidth / 2) + Math.abs(dy) / (tileHeight / 2) <= 1) {
        return { row, col }
      }
    }
  }
  return { row: -1, col: -1 }
}

const handleMouseDown = (event) => {
  event.preventDefault()
  
  // Ľavé tlačidlo (0) = vložiť obrázok
  if (event.button === 0) {
    // Použijeme vybraný obrázok, ak nie je vybraný tak prvý z galérie
    let imageToPlace = null
    if (props.selectedImageId) {
      imageToPlace = props.images?.find(img => img.id === props.selectedImageId)
    }
    if (!imageToPlace && props.images && props.images.length > 0) {
      imageToPlace = props.images[0]
    }
    
    if (imageToPlace) {
      const rect = canvas.value.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      
      const scaleX = canvas.value.width / rect.width
      const scaleY = canvas.value.height / rect.height
      
      const cell = getGridCell(x * scaleX, y * scaleY, canvas.value.width, canvas.value.height)
      
      if (cell.row !== -1 && cell.col !== -1) {
        // Kontrola kolízie pred umiestnením pomocou checkCollision funkcie
        const cellsX = props.lastImageCellsX || 1
        const cellsY = props.lastImageCellsY || 1
        
        if (checkCollision(cell.row, cell.col, cellsX, cellsY)) {
          console.log('❌ Kolízia! Obrázok by sa prekrýval s existujúcim obrázkom.')
          console.log(`   Pokus o umiestnenie na: [${cell.row}, ${cell.col}]`)
          console.log(`   Rozmery: ${cellsX}x${cellsY} políčok`)
          return
        }
        
        const cellKey = `${cell.row}-${cell.col}`
        
        // Ulož obrázok s informáciou o rozmeroch v políčkach
        cellImages[cellKey] = {
          url: imageToPlace.url,
          cellsX: props.lastImageCellsX || 1,
          cellsY: props.lastImageCellsY || 1
        }
        
        // Získame všetky políčka ktoré sú ovplyvnené pre console.log
        const affectedCells = []
        if (cellsX === 1 && cellsY === 1) {
          affectedCells.push(`${cell.row}-${cell.col}`)
        } else if (cellsX === 1 && cellsY === 2) {
          affectedCells.push(`${cell.row}-${cell.col}`)
          affectedCells.push(`${cell.row + 1}-${cell.col}`)
        } else if (cellsX === 2 && cellsY === 2) {
          affectedCells.push(`${cell.row}-${cell.col}`)
          affectedCells.push(`${cell.row}-${cell.col + 1}`)
          affectedCells.push(`${cell.row + 1}-${cell.col}`)
          affectedCells.push(`${cell.row + 1}-${cell.col + 1}`)
        }
        
        // Načítať obrázok
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          loadedImages[cellKey] = img
          const ctx = canvas.value.getContext('2d')
          drawCheckerboard(ctx, canvas.value.width, canvas.value.height, hoveredCell.row, hoveredCell.col)
        }
        img.src = imageToPlace.url
        
        console.log(`✅ Obrázok vložený!`)
        console.log(`   Hlavné políčko: [${cell.row}, ${cell.col}]`)
        console.log(`   Rozmery: ${cellsX}x${cellsY} políčok`)
        console.log(`   Všetky ovplyvnené políčka:`, affectedCells)
      }
    } else {
      console.log('Žiadne obrázky v galérii')
    }
    return
  }
  
  // Pravé tlačidlo (2) = dragovanie
  if (event.button === 2) {
    isDragging = true
    lastMouseX = event.clientX
    lastMouseY = event.clientY
  }
}

const handleContextMenu = (event) => {
  event.preventDefault()
}

const handleMouseMove = (event) => {
  if (!canvas.value) return
  
  if (isDragging) {
    const dx = event.clientX - lastMouseX
    const dy = event.clientY - lastMouseY
    
    offsetX += dx
    offsetY += dy
    
    lastMouseX = event.clientX
    lastMouseY = event.clientY
    
    const ctx = canvas.value.getContext('2d')
    drawCheckerboard(ctx, canvas.value.width, canvas.value.height, hoveredCell.row, hoveredCell.col)
  } else {
    const rect = canvas.value.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    
    const scaleX = canvas.value.width / rect.width
    const scaleY = canvas.value.height / rect.height
    
    const cell = getGridCell(x * scaleX, y * scaleY, canvas.value.width, canvas.value.height)
    
    if (hoveredCell.row !== cell.row || hoveredCell.col !== cell.col) {
      hoveredCell.row = cell.row
      hoveredCell.col = cell.col
      
      const ctx = canvas.value.getContext('2d')
      drawCheckerboard(ctx, canvas.value.width, canvas.value.height, cell.row, cell.col)
    }
  }
}

const handleMouseUp = () => {
  isDragging = false
}

const handleWheel = (event) => {
  event.preventDefault()
  
  if (!canvas.value) return
  
  const rect = canvas.value.getBoundingClientRect()
  const mouseX = event.clientX - rect.left
  const mouseY = event.clientY - rect.top
  
  const scaleX = canvas.value.width / rect.width
  const scaleY = canvas.value.height / rect.height
  
  const canvasX = mouseX * scaleX
  const canvasY = mouseY * scaleY
  
  // Zoom
  const delta = event.deltaY > 0 ? 0.9 : 1.1
  const newScale = Math.max(0.3, Math.min(3, scale * delta))
  
  // Zoom k pozícii myši
  offsetX = canvasX - (canvasX - offsetX) * (newScale / scale)
  offsetY = canvasY - (canvasY - offsetY) * (newScale / scale)
  
  scale = newScale
  
  const ctx = canvas.value.getContext('2d')
  drawCheckerboard(ctx, canvas.value.width, canvas.value.height, hoveredCell.row, hoveredCell.col)
}

const handleMouseLeave = () => {
  hoveredCell.row = -1
  hoveredCell.col = -1
  
  if (canvas.value) {
    const ctx = canvas.value.getContext('2d')
    drawCheckerboard(ctx, canvas.value.width, canvas.value.height)
  }
}

onMounted(() => {
  if (canvas.value) {
    const ctx = canvas.value.getContext('2d')
    canvas.value.width = 800
    canvas.value.height = 400
    drawCheckerboard(ctx, canvas.value.width, canvas.value.height)
    
    // Event listenery
    window.addEventListener('mouseup', handleMouseUp)
  }
})

onUnmounted(() => {
  window.removeEventListener('mouseup', handleMouseUp)
})
</script>

<template>
  <div class="canvas-container">
    <canvas
      ref="canvas"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseleave="handleMouseLeave"
      @wheel="handleWheel"
      @contextmenu="handleContextMenu"
    ></canvas>
  </div>
</template>

<style scoped>
.canvas-container {
  width: 100%;
  max-width: 800px;
  background: white;
  border-radius: 8px;
  margin-bottom: 2rem;
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
  perspective: 1000px;
  overflow: hidden;
  position: relative;
}

canvas {
  display: block;
  width: 100%;
  cursor: grab;
  border-radius: 8px;
  user-select: none;
}

canvas:active {
  cursor: grabbing;
}
</style>
