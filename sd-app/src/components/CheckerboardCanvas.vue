<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  images: Array,
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
  
  // Funkcia na kontrolu kolízie - či dané políčko alebo jeho okolie má už obrázok
  const checkCollision = (row, col, cellsX, cellsY) => {
    // Získame všetky políčka ktoré by boli ovplyvnené novým obrázkom
    const affectedCells = []
    
    if (cellsX === 1 && cellsY === 1) {
      // 1size: len jedno políčko
      affectedCells.push(`${row}-${col}`)
    } else if (cellsX === 1 && cellsY === 2) {
      // 2size: dve políčka nad sebou + vedľajšie kvôli šírke 1.5×
      affectedCells.push(`${row}-${col}`)
      affectedCells.push(`${row + 1}-${col}`)
      affectedCells.push(`${row}-${col - 1}`)
      affectedCells.push(`${row}-${col + 1}`)
      affectedCells.push(`${row + 1}-${col - 1}`)
      affectedCells.push(`${row + 1}-${col + 1}`)
    } else if (cellsX === 2 && cellsY === 2) {
      // 4size: štyri políčka v bloku
      affectedCells.push(`${row}-${col}`)
      affectedCells.push(`${row}-${col + 1}`)
      affectedCells.push(`${row + 1}-${col}`)
      affectedCells.push(`${row + 1}-${col + 1}`)
    }
    
    // Skontrolujeme či niektoré z týchto políčok už má obrázok
    for (const cellKey of affectedCells) {
      if (cellImages[cellKey]) {
        return true // Kolízia!
      }
    }
    
    return false // Žiadna kolízia
  }
  
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
      
      // Skontrolujeme či políčko obsahuje obrázok alebo je ovplyvnené obrázkom zo susedného políčka
      const cellKey = `${row}-${col}`
      let hasImage = cellImages[cellKey]
      let imageOriginRow = row
      let imageOriginCol = col
      
      // Ak aktuálne políčko nemá obrázok, skontrolujeme susedné políčka
      if (!hasImage) {
        // Pre 2size (1x2): kontrola políčka nad aktuálnym a vľavo/vpravo
        const checkPositions = [
          { r: row - 1, c: col },     // políčko nad
          { r: row, c: col - 1 },     // políčko vľavo
          { r: row, c: col + 1 },     // políčko vpravo
          { r: row - 1, c: col - 1 }, // diagonálne ľavé horné
          { r: row - 1, c: col + 1 }, // diagonálne pravé horné
        ]
        
        for (const pos of checkPositions) {
          const checkKey = `${pos.r}-${pos.c}`
          const checkImage = cellImages[checkKey]
          if (checkImage) {
            const cellsX = checkImage.cellsX || 1
            const cellsY = checkImage.cellsY || 1
            
            // Kontrola či obrázok zasahuje do aktuálneho políčka
            if (cellsX === 1 && cellsY === 2) {
              // 2size: zasahuje do políčka pod ním a vedľajších kvôli šírke 1.5×
              if ((pos.r === row - 1 && pos.c === col) ||     // obrázok nad
                  (pos.r === row && Math.abs(pos.c - col) === 1) || // obrázok vľavo/vpravo
                  (pos.r === row - 1 && Math.abs(pos.c - col) === 1)) { // obrázok diagonálne
                hasImage = checkImage
                imageOriginRow = pos.r
                imageOriginCol = pos.c
                break
              }
            }
          }
        }
      }
      
      if (hasImage) {
        // Nakresliť obrázok do políčka (roztiahnutý cez viacero políčok)
        const originKey = `${imageOriginRow}-${imageOriginCol}`
        const img = loadedImages[originKey]
        
        // Kreslíme len raz z origin políčka aby sa obrázok neduplikoval
        if (img && img.complete && row === imageOriginRow && col === imageOriginCol) {
          ctx.save()
          
          const cellsX = hasImage.cellsX || 1
          const cellsY = hasImage.cellsY || 1
          
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
            // 4 políčka v bloku 2x2 (4size) - centrujeme a posunieme dole
            offsetXForCells = tileWidth / 2
            offsetYForCells = tileHeight
          }
          
          // Nakresliť obrázok (spodok na spodku bloku políčok, môže presahovať hore)
          ctx.drawImage(
            img, 
            x - drawWidth / 2 + offsetXForCells, 
            y + tileHeight - drawHeight + offsetYForCells,  // Spodok obrázka na spodku políčka
            drawWidth, 
            drawHeight
          )
          
          ctx.restore()
        }
        
        // Okraj políčka - len ak je highlighted (hover) - kreslíme aj na ovplyvnených políčkach
        if (isHighlighted) {
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.lineTo(x + tileWidth / 2, y + tileHeight / 2)
            ctx.lineTo(x, y + tileHeight)
            ctx.lineTo(x - tileWidth / 2, y + tileHeight / 2)
            ctx.closePath()
            // Červený okraj pri kolízii, modrý inak
            ctx.strokeStyle = hasCollision ? '#ff0000' : '#667eea'
            ctx.lineWidth = 3 / scale
            ctx.stroke()
          }
      } else {
        // Normálne políčko bez obrázka
        if (isHighlighted) {
          // Červená výplň pri kolízii, modrá inak
          ctx.fillStyle = hasCollision ? 'rgba(255, 0, 0, 0.3)' : '#667eea'
        } else if (isEven) {
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
    // Použijeme prvý obrázok z galérie
    const imageToPlace = props.images && props.images.length > 0 ? props.images[0] : null
    
    if (imageToPlace) {
      const rect = canvas.value.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      
      const scaleX = canvas.value.width / rect.width
      const scaleY = canvas.value.height / rect.height
      
      const cell = getGridCell(x * scaleX, y * scaleY, canvas.value.width, canvas.value.height)
      
      if (cell.row !== -1 && cell.col !== -1) {
        // Kontrola kolízie pred umiestnením
        const cellsX = props.lastImageCellsX || 1
        const cellsY = props.lastImageCellsY || 1
        
        // Získame všetky políčka ktoré by boli ovplyvnené
        const affectedCells = []
        if (cellsX === 1 && cellsY === 1) {
          affectedCells.push(`${cell.row}-${cell.col}`)
        } else if (cellsX === 1 && cellsY === 2) {
          affectedCells.push(`${cell.row}-${cell.col}`)
          affectedCells.push(`${cell.row + 1}-${cell.col}`)
          affectedCells.push(`${cell.row}-${cell.col - 1}`)
          affectedCells.push(`${cell.row}-${cell.col + 1}`)
          affectedCells.push(`${cell.row + 1}-${cell.col - 1}`)
          affectedCells.push(`${cell.row + 1}-${cell.col + 1}`)
        } else if (cellsX === 2 && cellsY === 2) {
          affectedCells.push(`${cell.row}-${cell.col}`)
          affectedCells.push(`${cell.row}-${cell.col + 1}`)
          affectedCells.push(`${cell.row + 1}-${cell.col}`)
          affectedCells.push(`${cell.row + 1}-${cell.col + 1}`)
        }
        
        // Kontrola kolízie
        let hasCollision = false
        for (const checkKey of affectedCells) {
          if (cellImages[checkKey]) {
            hasCollision = true
            break
          }
        }
        
        if (hasCollision) {
          console.log('❌ Kolízia! Na týchto súradniciach už je obrázok.')
          return
        }
        
        const cellKey = `${cell.row}-${cell.col}`
        
        // Ulož obrázok s informáciou o rozmeroch v políčkach
        cellImages[cellKey] = {
          url: imageToPlace.url,
          cellsX: props.lastImageCellsX || 1,
          cellsY: props.lastImageCellsY || 1
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
        
        console.log(`Obrázok vložený do políčka [${cell.row}, ${cell.col}], rozmery: ${props.lastImageCellsX}x${props.lastImageCellsY} políčok`)
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
