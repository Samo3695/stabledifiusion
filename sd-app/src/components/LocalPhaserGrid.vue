<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import Phaser from 'phaser'

const props = defineProps({
  gridCols: { type: Number, default: 2 },
  gridRows: { type: Number, default: 2 },
})

const emit = defineEmits(['cell-click'])

const phaserContainer = ref(null)
let game = null
let mainScene = null

// Grid params — isometric
const TILE_WIDTH = 128
const TILE_HEIGHT = 64

// Cell images: { "row_col": { dataUrl, sprite } }
const cellImages = {}

// iso helpers
function isoToScreen(row, col) {
  const x = (col - row) * (TILE_WIDTH / 2)
  const y = (col + row) * (TILE_HEIGHT / 2)
  return { x, y }
}

function screenToIso(px, py) {
  const col = (px / (TILE_WIDTH / 2) + py / (TILE_HEIGHT / 2)) / 2
  const row = (py / (TILE_HEIGHT / 2) - px / (TILE_WIDTH / 2)) / 2
  return { row: Math.floor(row), col: Math.floor(col) }
}

class GridScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GridScene' })
    this.gridGraphics = null
    this.hoverGraphics = null
    this.hoveredCell = { row: -1, col: -1 }
  }

  create() {
    mainScene = this

    const centerX = 0
    const centerY = (props.gridRows * TILE_HEIGHT) / 2

    this.cameras.main.centerOn(centerX, centerY)

    // Grid lines
    this.gridGraphics = this.add.graphics()
    this.drawGrid()

    // Hover highlight
    this.hoverGraphics = this.add.graphics()
    this.hoverGraphics.setDepth(1000)

    // Input
    this.input.on('pointermove', (pointer) => {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const cell = screenToIso(worldPoint.x, worldPoint.y)
      if (cell.row >= 0 && cell.row < props.gridRows && cell.col >= 0 && cell.col < props.gridCols) {
        this.hoveredCell = cell
        this.drawHover(cell.row, cell.col)
      } else {
        this.hoveredCell = { row: -1, col: -1 }
        this.hoverGraphics.clear()
      }
    })

    this.input.on('pointerdown', (pointer) => {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const cell = screenToIso(worldPoint.x, worldPoint.y)
      if (cell.row >= 0 && cell.row < props.gridRows && cell.col >= 0 && cell.col < props.gridCols) {
        emit('cell-click', { row: cell.row, col: cell.col })
      }
    })
  }

  drawGrid() {
    const g = this.gridGraphics
    g.clear()
    g.lineStyle(1, 0x4466aa, 0.5)

    for (let row = 0; row <= props.gridRows; row++) {
      const start = isoToScreen(row, 0)
      const end = isoToScreen(row, props.gridCols)
      g.beginPath()
      g.moveTo(start.x, start.y)
      g.lineTo(end.x, end.y)
      g.strokePath()
    }

    for (let col = 0; col <= props.gridCols; col++) {
      const start = isoToScreen(0, col)
      const end = isoToScreen(props.gridRows, col)
      g.beginPath()
      g.moveTo(start.x, start.y)
      g.lineTo(end.x, end.y)
      g.strokePath()
    }
  }

  drawHover(row, col) {
    const g = this.hoverGraphics
    g.clear()
    g.lineStyle(2, 0x66aaff, 0.8)
    g.fillStyle(0x66aaff, 0.15)

    const tl = isoToScreen(row, col)
    const tr = isoToScreen(row, col + 1)
    const br = isoToScreen(row + 1, col + 1)
    const bl = isoToScreen(row + 1, col)

    g.beginPath()
    g.moveTo(tl.x, tl.y)
    g.lineTo(tr.x, tr.y)
    g.lineTo(br.x, br.y)
    g.lineTo(bl.x, bl.y)
    g.closePath()
    g.fillPath()
    g.strokePath()
  }
}

onMounted(() => {
  if (!phaserContainer.value) return

  const canvasW = (props.gridCols + props.gridRows) * (TILE_WIDTH / 2) + 40
  const canvasH = (props.gridCols + props.gridRows) * (TILE_HEIGHT / 2) + 40

  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: phaserContainer.value,
    width: canvasW,
    height: canvasH,
    transparent: true,
    scene: [GridScene],
    scale: { mode: Phaser.Scale.NONE },
    audio: { noAudio: true },
  })
})

onUnmounted(() => {
  if (game) {
    game.destroy(true)
    game = null
    mainScene = null
  }
})

/**
 * Place an image on a cell
 * @param {number} row
 * @param {number} col
 * @param {string} dataUrl - image data URL
 */
const placeImage = (row, col, dataUrl) => {
  if (!mainScene) return
  const key = `${row}_${col}`

  // Remove old
  if (cellImages[key]) {
    cellImages[key].sprite.destroy()
    delete cellImages[key]
  }

  // Load texture
  const texKey = `cell_${key}_${Date.now()}`
  const img = new Image()
  img.onload = () => {
    if (!mainScene || !mainScene.textures) return
    mainScene.textures.addImage(texKey, img)

    const center = isoToScreen(row + 0.5, col + 0.5)
    const sprite = mainScene.add.image(center.x, center.y, texKey)

    // Scale to fit the isometric cell
    const scaleX = TILE_WIDTH / img.width
    const scaleY = TILE_HEIGHT / img.height
    const scale = Math.min(scaleX, scaleY)
    sprite.setScale(scale)
    sprite.setDepth(row + col)

    cellImages[key] = { dataUrl, sprite, texKey }
  }
  img.src = dataUrl
}

/**
 * Remove image from a cell
 */
const removeImage = (row, col) => {
  const key = `${row}_${col}`
  if (cellImages[key]) {
    cellImages[key].sprite.destroy()
    if (mainScene?.textures) {
      mainScene.textures.remove(cellImages[key].texKey)
    }
    delete cellImages[key]
  }
}

/**
 * Export the full canvas as a PNG data URL
 */
const exportCanvas = () => {
  if (!game) return null
  return new Promise((resolve) => {
    mainScene.renderer.snapshot((image) => {
      resolve(image.src)
    })
  })
}

defineExpose({ placeImage, removeImage, exportCanvas })
</script>

<template>
  <div class="phaser-grid-wrapper">
    <div ref="phaserContainer" class="phaser-grid-container"></div>
  </div>
</template>

<style scoped>
.phaser-grid-wrapper {
  margin-top: 1.5rem;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(0,0,0,0.3);
}

.phaser-grid-container {
  display: flex;
  justify-content: center;
}

.phaser-grid-container canvas {
  display: block;
}
</style>
