<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const canvas = ref(null)
let hoveredCell = { row: -1, col: -1 }
let offsetX = 0
let offsetY = 0
let scale = 1
let isDragging = false
let lastMouseX = 0
let lastMouseY = 0

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
      const isHighlighted = row === highlightRow && col === highlightCol
      
      if (isHighlighted) {
        ctx.fillStyle = '#667eea'
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
  isDragging = true
  lastMouseX = event.clientX
  lastMouseY = event.clientY
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
