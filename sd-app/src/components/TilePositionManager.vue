<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'

const props = defineProps({
  spriteUrl: { type: String, required: true },
  initialDefinitions: { type: Array, required: true },
  exportName: { type: String, default: 'NEW_ROAD_TILE_DEFINITIONS' },
  title: { type: String, default: 'Tile Position Manager' },
})

const emit = defineEmits(['close', 'apply'])

const TILE_W = 200
const TILE_H = 100
const SPRITE_DISPLAY_W = 720

// Iso playground inside the modal — bigger now, with zoom
const BASE_TILE_W = 120
const BASE_TILE_H = 60
const ISO_ROWS = 8
const ISO_COLS = 8
const ISO_PAD = 12
const isoZoom = ref(1.0)

function isoDims() {
  const tw = BASE_TILE_W * isoZoom.value
  const th = BASE_TILE_H * isoZoom.value
  const cw = (ISO_ROWS + ISO_COLS) * (tw / 2) + ISO_PAD * 2
  const ch = (ISO_ROWS + ISO_COLS) * (th / 2) + ISO_PAD * 2 + th
  const ox = ISO_ROWS * (tw / 2) + ISO_PAD
  const oy = ISO_PAD
  return { tw, th, cw, ch, ox, oy }
}

const isoCanvasW = computed(() => isoDims().cw)
const isoCanvasH = computed(() => isoDims().ch)

const definitions = reactive(JSON.parse(JSON.stringify(props.initialDefinitions)))
const selectedIndex = ref(0)
const tileCanvases = ref([])
const spriteImg = ref(null)
const spriteLoaded = ref(false)
const spriteW = ref(1456)
const spriteH = ref(730)
const copyHint = ref('')

// Drawn road cells on the iso playground — keys "row-col"
const roadCells = ref(new Set())
const isoCanvasEl = ref(null)
const isoIsDrawing = ref(false)
const isoDrawMode = ref('add') // 'add' | 'remove'

const selectedDef = computed(() => definitions[selectedIndex.value])
const spriteScale = computed(() => SPRITE_DISPLAY_W / spriteW.value)
const spriteDisplayH = computed(() => spriteH.value * spriteScale.value)

const exportJson = computed(() => {
  const lines = definitions.map(d =>
    `  { name: '${d.name}', x: ${d.x}, y: ${d.y}, width: ${d.width}, height: ${d.height}, rotation: ${d.rotation} },`
  )
  return `export const ${props.exportName} = [\n${lines.join('\n')}\n]`
})

function loadSprite() {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      spriteImg.value = img
      spriteW.value = img.naturalWidth
      spriteH.value = img.naturalHeight
      spriteLoaded.value = true
      resolve()
    }
    img.onerror = reject
    img.src = props.spriteUrl
  })
}

function renderTile(idx) {
  if (!spriteLoaded.value) return
  const canvas = tileCanvases.value[idx]
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const def = definitions[idx]

  ctx.clearRect(0, 0, TILE_W, TILE_H)

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(TILE_W / 2, 0)
  ctx.lineTo(TILE_W, TILE_H / 2)
  ctx.lineTo(TILE_W / 2, TILE_H)
  ctx.lineTo(0, TILE_H / 2)
  ctx.closePath()
  ctx.clip()

  const w = Math.max(1, def.width)
  const h = Math.max(1, def.height)
  const scale = TILE_W / w
  const scaledH = h * scale
  const offsetY = (TILE_H - scaledH) / 2

  try {
    ctx.drawImage(
      spriteImg.value,
      def.x, def.y, w, h,
      0, offsetY, TILE_W, scaledH
    )
  } catch (e) {
    // out-of-bounds source crop — ignore
  }
  ctx.restore()
}

function renderAllTiles() {
  for (let i = 0; i < definitions.length; i++) {
    renderTile(i)
  }
}

// Mirrors selectTileByDirection from utils/roadBuilder.js — same neighbour logic,
// but returns the tile *name* (we don't have placed tiles, just the live defs).
function pickTileName(direction, topLeft, topRight, bottomLeft, bottomRight) {
  if (topLeft && bottomLeft && topRight && bottomRight) return 'Križovatka +'
  if (!topLeft && !bottomRight && bottomLeft && topRight) return 'Rovná ↙'
  if (topLeft && bottomRight && !bottomLeft && !topRight) return 'Rovná ↘'
  if (topLeft && !bottomRight && !bottomLeft && topRight) return 'Roh ↙'
  if (topLeft && !bottomRight && bottomLeft && !topRight) return 'Roh ↘'
  if (!topLeft && bottomRight && !bottomLeft && topRight) return 'Roh ↖'
  if (!topLeft && bottomRight && bottomLeft && !topRight) return 'Roh ↗'
  if (topLeft && !bottomRight && bottomLeft && topRight) return 'T ↖'
  if (!topLeft && bottomRight && bottomLeft && topRight) return 'T ↘'
  if (topLeft && bottomRight && !bottomLeft && topRight) return 'T ↗'
  if (topLeft && bottomRight && bottomLeft && !topRight) return 'T ↙'
  return direction === 'vertical' ? 'Rovná ↙' : 'Rovná ↘'
}

function cellCenter(r, c, d) {
  return {
    x: (c - r) * (d.tw / 2) + d.ox,
    y: (c + r) * (d.th / 2) + d.oy + d.th / 2,
  }
}

function drawDiamond(ctx, cx, cy, w, h) {
  ctx.beginPath()
  ctx.moveTo(cx, cy - h / 2)
  ctx.lineTo(cx + w / 2, cy)
  ctx.lineTo(cx, cy + h / 2)
  ctx.lineTo(cx - w / 2, cy)
  ctx.closePath()
}

function drawTileOnIso(ctx, def, r, c, d) {
  const { x: cx, y: cy } = cellCenter(r, c, d)
  const drawX = cx - d.tw / 2
  const drawY = cy - d.th / 2

  ctx.save()
  drawDiamond(ctx, cx, cy, d.tw, d.th)
  ctx.clip()

  const w = Math.max(1, def.width)
  const h = Math.max(1, def.height)
  const scale = d.tw / w
  const scaledH = h * scale
  const offsetY = (d.th - scaledH) / 2

  try {
    ctx.drawImage(
      spriteImg.value,
      def.x, def.y, w, h,
      drawX, drawY + offsetY, d.tw, scaledH
    )
  } catch (e) { /* ignore out-of-bounds */ }
  ctx.restore()
}

function renderIsoGrid() {
  const canvas = isoCanvasEl.value
  if (!canvas) return
  const d = isoDims()
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, d.cw, d.ch)

  // Background
  ctx.fillStyle = '#14141a'
  ctx.fillRect(0, 0, d.cw, d.ch)

  // Faint grid diamonds
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  for (let r = 0; r < ISO_ROWS; r++) {
    for (let c = 0; c < ISO_COLS; c++) {
      const { x, y } = cellCenter(r, c, d)
      drawDiamond(ctx, x, y, d.tw, d.th)
      ctx.stroke()
    }
  }

  if (!spriteLoaded.value) return

  // Draw tile for each road cell, picking the right tile by neighbour pattern
  const has = (r, c) => roadCells.value.has(`${r}-${c}`)
  const cells = Array.from(roadCells.value).map(k => {
    const [r, c] = k.split('-').map(Number)
    return { r, c }
  })
  // Paint back-to-front so closer tiles render on top
  cells.sort((a, b) => (a.r + a.c) - (b.r + b.c))

  for (const { r, c } of cells) {
    // Same neighbour mapping as roadBuilder.js:
    //   topleft = (row, col-1), topright = (row-1, col),
    //   bottomleft = (row+1, col), bottomright = (row, col+1)
    const topLeft = has(r, c - 1)
    const topRight = has(r - 1, c)
    const bottomLeft = has(r + 1, c)
    const bottomRight = has(r, c + 1)
    const name = pickTileName('horizontal', topLeft, topRight, bottomLeft, bottomRight)
    const def = definitions.find(x => x.name === name) || definitions[0]
    drawTileOnIso(ctx, def, r, c, d)
  }
}

function pointToCell(px, py) {
  const d = isoDims()
  const dx = px - d.ox
  const dy = py - d.oy - d.th / 2
  const sumCR = dy / (d.th / 2)   // (c + r)
  const diffCR = dx / (d.tw / 2)  // (c - r)
  const c = Math.round((sumCR + diffCR) / 2)
  const r = Math.round((sumCR - diffCR) / 2)
  if (r < 0 || r >= ISO_ROWS || c < 0 || c >= ISO_COLS) return null
  return { r, c }
}

function isoEventToCell(e) {
  const canvas = isoCanvasEl.value
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const px = (e.clientX - rect.left) * (canvas.width / rect.width)
  const py = (e.clientY - rect.top) * (canvas.height / rect.height)
  return pointToCell(px, py)
}

function onIsoDown(e) {
  const cell = isoEventToCell(e)
  if (!cell) return
  const key = `${cell.r}-${cell.c}`
  isoIsDrawing.value = true
  isoDrawMode.value = roadCells.value.has(key) ? 'remove' : 'add'
  applyIsoCell(cell)
}

function onIsoMove(e) {
  if (!isoIsDrawing.value) return
  const cell = isoEventToCell(e)
  if (!cell) return
  applyIsoCell(cell)
}

function onIsoUp() { isoIsDrawing.value = false }

function applyIsoCell(cell) {
  const key = `${cell.r}-${cell.c}`
  const next = new Set(roadCells.value)
  if (isoDrawMode.value === 'add') next.add(key)
  else next.delete(key)
  if (next.size === roadCells.value.size && Array.from(next).every(k => roadCells.value.has(k))) return
  roadCells.value = next
  renderIsoGrid()
}

function clearIso() {
  roadCells.value = new Set()
  renderIsoGrid()
}

function setZoom(z) {
  isoZoom.value = Math.max(0.5, Math.min(4, Number(z.toFixed(2))))
}
function zoomIn() { setZoom(isoZoom.value * 1.25) }
function zoomOut() { setZoom(isoZoom.value / 1.25) }
function zoomReset() { setZoom(1.0) }

function onIsoWheel(e) {
  e.preventDefault()
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
  setZoom(isoZoom.value * factor)
}

watch(isoZoom, async () => {
  await nextTick()
  renderIsoGrid()
})

function fillDemoIso() {
  // A small + with a corner branch — exercises straight, corner and T tiles
  const demo = [
    '2-1','2-2','2-3','2-4',
    '1-3','3-3','4-3',
    '4-2','4-1',
  ]
  roadCells.value = new Set(demo)
  renderIsoGrid()
}

function onFieldChange() {
  renderTile(selectedIndex.value)
  renderIsoGrid()
}

function nudge(field, delta) {
  selectedDef.value[field] = (selectedDef.value[field] || 0) + delta
  renderTile(selectedIndex.value)
  renderIsoGrid()
}

async function copyJson() {
  try {
    await navigator.clipboard.writeText(exportJson.value)
    copyHint.value = 'Copied!'
    setTimeout(() => { copyHint.value = '' }, 1500)
  } catch (e) {
    copyHint.value = 'Copy failed'
    setTimeout(() => { copyHint.value = '' }, 1500)
  }
}

function resetAll() {
  const fresh = JSON.parse(JSON.stringify(props.initialDefinitions))
  for (let i = 0; i < definitions.length; i++) {
    Object.assign(definitions[i], fresh[i])
  }
  renderAllTiles()
  renderIsoGrid()
}

function resetSelected() {
  const fresh = JSON.parse(JSON.stringify(props.initialDefinitions[selectedIndex.value]))
  Object.assign(selectedDef.value, fresh)
  renderTile(selectedIndex.value)
  renderIsoGrid()
}

function handleEsc(e) {
  if (e.key === 'Escape') emit('close')
}

watch(selectedIndex, async () => {
  await nextTick()
  renderTile(selectedIndex.value)
})

onMounted(async () => {
  document.addEventListener('keydown', handleEsc)
  try {
    await loadSprite()
  } catch (e) {
    console.error('TilePositionManager: failed to load sprite', e)
    return
  }
  await nextTick()
  renderAllTiles()
  fillDemoIso()
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleEsc)
})
</script>

<template>
  <Teleport to="body">
    <div class="tpm-overlay" @click="$emit('close')">
      <div class="tpm-modal" @click.stop>
        <div class="tpm-header">
          <h2>{{ title }} — {{ exportName }}</h2>
          <button class="tpm-close" @click="$emit('close')" title="Close">✕</button>
        </div>

        <div class="tpm-body">
          <!-- Tile grid (12 iso-rendered tiles, like canvas) -->
          <div class="tpm-section">
            <div class="tpm-section-title">Tiles preview ({{ definitions.length }})</div>
            <div class="tpm-tiles-grid">
              <div
                v-for="(def, idx) in definitions"
                :key="idx"
                :class="['tpm-tile', { selected: selectedIndex === idx }]"
                @click="selectedIndex = idx"
              >
                <canvas
                  :ref="el => tileCanvases[idx] = el"
                  :width="TILE_W"
                  :height="TILE_H"
                  class="tpm-tile-canvas"
                ></canvas>
                <div class="tpm-tile-name">
                  <span class="tpm-tile-idx">#{{ idx }}</span> {{ def.name }}
                </div>
              </div>
            </div>
          </div>

          <!-- Editor for selected tile -->
          <div class="tpm-section" v-if="selectedDef">
            <div class="tpm-section-title">
              Editing: <strong>{{ selectedDef.name }}</strong> (#{{ selectedIndex }})
              <button class="tpm-mini-btn" @click="resetSelected" title="Reset this tile to original">↺ Reset tile</button>
            </div>

            <div class="tpm-editor">
              <div class="tpm-editor-controls">
                <div class="tpm-input-row" v-for="field in ['x','y','width','height']" :key="field">
                  <label>{{ field }}</label>
                  <button class="tpm-step-btn" @click="nudge(field, -1)">−1</button>
                  <button class="tpm-step-btn" @click="nudge(field, -10)">−10</button>
                  <input
                    type="number"
                    class="tpm-num"
                    :value="selectedDef[field]"
                    @input="e => { selectedDef[field] = Number(e.target.value); onFieldChange() }"
                  />
                  <button class="tpm-step-btn" @click="nudge(field, 1)">+1</button>
                  <button class="tpm-step-btn" @click="nudge(field, 10)">+10</button>
                  <input
                    type="range"
                    class="tpm-range"
                    :min="0"
                    :max="field === 'x' || field === 'width' ? spriteW : spriteH"
                    :value="selectedDef[field]"
                    @input="e => { selectedDef[field] = Number(e.target.value); onFieldChange() }"
                  />
                </div>
                <div class="tpm-input-row">
                  <label>rotation</label>
                  <input
                    type="number"
                    class="tpm-num"
                    :value="selectedDef.rotation"
                    @input="e => selectedDef.rotation = Number(e.target.value)"
                  />
                  <span class="tpm-hint">(metadata only — not applied to preview)</span>
                </div>
                <div class="tpm-input-row">
                  <label>name</label>
                  <input
                    type="text"
                    class="tpm-text"
                    :value="selectedDef.name"
                    @input="e => selectedDef.name = e.target.value"
                  />
                </div>
              </div>

              <!-- Sprite preview with overlay rectangles -->
              <div class="tpm-sprite-wrap">
                <div class="tpm-section-subtitle">Sprite (click rectangles to switch tile)</div>
                <div
                  class="tpm-sprite-box"
                  :style="{ width: SPRITE_DISPLAY_W + 'px', height: spriteDisplayH + 'px' }"
                >
                  <img
                    v-if="spriteLoaded"
                    :src="spriteUrl"
                    class="tpm-sprite-img"
                    :style="{ width: SPRITE_DISPLAY_W + 'px', height: spriteDisplayH + 'px' }"
                  />
                  <div
                    v-for="(def, idx) in definitions"
                    :key="idx"
                    :class="['tpm-rect', { selected: selectedIndex === idx }]"
                    :style="{
                      left: (def.x * spriteScale) + 'px',
                      top: (def.y * spriteScale) + 'px',
                      width: (def.width * spriteScale) + 'px',
                      height: (def.height * spriteScale) + 'px',
                    }"
                    @click="selectedIndex = idx"
                    :title="`#${idx} ${def.name}`"
                  >
                    <span class="tpm-rect-label">#{{ idx }}</span>
                  </div>
                </div>
                <div class="tpm-sprite-info">
                  Sprite: {{ spriteW }} × {{ spriteH }} px (display scale: {{ spriteScale.toFixed(3) }}×)
                </div>
              </div>
            </div>
          </div>

          <!-- Iso playground — draw roads, see them update live -->
          <div class="tpm-section">
            <div class="tpm-section-title">
              Iso playground
              <span class="tpm-hint">Click / drag cells to draw roads. Mouse-wheel = zoom.</span>
              <button class="tpm-mini-btn" @click="fillDemoIso" title="Demo road that uses straight + corner + T tiles">Demo</button>
              <button class="tpm-mini-btn" @click="clearIso">Clear</button>
            </div>
            <div class="tpm-iso-zoombar">
              <button class="tpm-step-btn" @click="zoomOut" title="Zoom out">−</button>
              <input
                type="range"
                class="tpm-range"
                min="0.5" max="4" step="0.05"
                :value="isoZoom"
                @input="e => setZoom(Number(e.target.value))"
              />
              <button class="tpm-step-btn" @click="zoomIn" title="Zoom in">+</button>
              <button class="tpm-step-btn" @click="zoomReset" title="Reset zoom">1×</button>
              <span class="tpm-hint">{{ isoZoom.toFixed(2) }}×</span>
            </div>
            <div class="tpm-iso-wrap">
              <canvas
                ref="isoCanvasEl"
                :width="isoCanvasW"
                :height="isoCanvasH"
                class="tpm-iso-canvas"
                @mousedown="onIsoDown"
                @mousemove="onIsoMove"
                @mouseup="onIsoUp"
                @mouseleave="onIsoUp"
                @wheel.prevent="onIsoWheel"
              ></canvas>
            </div>
          </div>

          <!-- Export -->
          <div class="tpm-section">
            <div class="tpm-section-title">
              Export
              <button class="tpm-mini-btn" @click="copyJson">📋 Copy</button>
              <button class="tpm-mini-btn" @click="resetAll" title="Reset all tiles to original">↺ Reset all</button>
              <span class="tpm-copy-hint" v-if="copyHint">{{ copyHint }}</span>
            </div>
            <textarea class="tpm-export" readonly :value="exportJson" rows="15"></textarea>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tpm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.78);
  z-index: 10001;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  animation: tpm-fade 0.18s;
}
@keyframes tpm-fade { from { opacity: 0 } to { opacity: 1 } }

.tpm-modal {
  background: #1e1e24;
  color: #e8e8ee;
  border-radius: 12px;
  width: min(1200px, 100%);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}

.tpm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1.2rem;
  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
}
.tpm-header h2 { margin: 0; font-size: 1.05rem; font-weight: 600; color: white }

.tpm-close {
  width: 32px; height: 32px;
  border: none; border-radius: 50%;
  background: rgba(255,255,255,0.15);
  color: white; font-size: 1.1rem; cursor: pointer;
  line-height: 1;
}
.tpm-close:hover { background: rgba(255,255,255,0.3) }

.tpm-body {
  padding: 1rem 1.2rem;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

.tpm-section {
  background: #2a2a32;
  border-radius: 8px;
  padding: 0.8rem 1rem;
  border: 1px solid #3a3a44;
}

.tpm-section-title {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.92rem;
  font-weight: 600;
  color: #c9c9d4;
  margin-bottom: 0.7rem;
}
.tpm-section-subtitle {
  font-size: 0.8rem;
  color: #9999a6;
  margin-bottom: 0.4rem;
}

.tpm-mini-btn {
  background: #3b3b48;
  color: #e8e8ee;
  border: 1px solid #4a4a58;
  border-radius: 5px;
  padding: 0.25rem 0.6rem;
  font-size: 0.78rem;
  cursor: pointer;
  margin-left: 0.4rem;
}
.tpm-mini-btn:hover { background: #4a4a58 }
.tpm-copy-hint { color: #4ade80; font-size: 0.8rem; margin-left: 0.5rem }

.tpm-tiles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 0.6rem;
}
.tpm-tile {
  background: #14141a;
  border: 2px solid #3a3a44;
  border-radius: 6px;
  padding: 0.4rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: border-color 0.15s, transform 0.15s;
}
.tpm-tile:hover { border-color: #6b6b7c; transform: translateY(-1px) }
.tpm-tile.selected { border-color: #7c3aed; background: #20202a }
.tpm-tile-canvas {
  width: 200px; height: 100px;
  background-image:
    linear-gradient(45deg, #2a2a32 25%, transparent 25%),
    linear-gradient(-45deg, #2a2a32 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #2a2a32 75%),
    linear-gradient(-45deg, transparent 75%, #2a2a32 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
  background-color: #1a1a22;
  image-rendering: pixelated;
}
.tpm-tile-name {
  font-size: 0.78rem;
  color: #c9c9d4;
  margin-top: 0.35rem;
  text-align: center;
}
.tpm-tile-idx { color: #7c3aed; font-weight: 700; margin-right: 0.3rem }

.tpm-editor {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 1rem;
  align-items: start;
}
@media (max-width: 1100px) {
  .tpm-editor { grid-template-columns: 1fr }
}

.tpm-editor-controls { display: flex; flex-direction: column; gap: 0.45rem }
.tpm-input-row {
  display: grid;
  grid-template-columns: 70px auto auto 90px auto auto 1fr;
  gap: 0.4rem;
  align-items: center;
}
.tpm-input-row label {
  font-size: 0.85rem;
  color: #c9c9d4;
  font-weight: 600;
  text-transform: lowercase;
}
.tpm-num, .tpm-text {
  background: #14141a;
  color: #e8e8ee;
  border: 1px solid #3a3a44;
  border-radius: 4px;
  padding: 0.25rem 0.5rem;
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 0.85rem;
}
.tpm-text { grid-column: 2 / -1 }
.tpm-step-btn {
  background: #3b3b48;
  color: #e8e8ee;
  border: 1px solid #4a4a58;
  border-radius: 4px;
  padding: 0.2rem 0.45rem;
  font-size: 0.75rem;
  cursor: pointer;
  font-family: 'SF Mono', Consolas, monospace;
}
.tpm-step-btn:hover { background: #4a4a58 }
.tpm-range { width: 100% }
.tpm-hint { font-size: 0.75rem; color: #8a8a98; grid-column: 2 / -1 }

.tpm-sprite-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.tpm-sprite-box {
  position: relative;
  background: #14141a;
  border: 1px solid #3a3a44;
  border-radius: 4px;
  overflow: hidden;
}
.tpm-sprite-img {
  display: block;
  pointer-events: none;
  user-select: none;
}
.tpm-rect {
  position: absolute;
  border: 1.5px solid rgba(124, 58, 237, 0.6);
  background: rgba(124, 58, 237, 0.08);
  cursor: pointer;
  box-sizing: border-box;
}
.tpm-rect:hover {
  border-color: rgba(167, 139, 250, 0.95);
  background: rgba(167, 139, 250, 0.18);
}
.tpm-rect.selected {
  border: 2px solid #fbbf24;
  background: rgba(251, 191, 36, 0.2);
  box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.35);
}
.tpm-rect-label {
  position: absolute;
  top: -2px; left: 2px;
  font-size: 10px;
  color: #fbbf24;
  font-weight: 700;
  text-shadow: 0 0 3px black, 0 0 3px black;
  pointer-events: none;
}
.tpm-sprite-info {
  font-size: 0.75rem;
  color: #8a8a98;
}

.tpm-iso-zoombar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}
.tpm-iso-zoombar .tpm-range { flex: 1; max-width: 280px }

.tpm-iso-wrap {
  background: #0e0e14;
  border: 1px solid #3a3a44;
  border-radius: 6px;
  padding: 8px;
  max-height: 70vh;
  overflow: auto;
}
.tpm-iso-canvas {
  cursor: crosshair;
  user-select: none;
  display: block;
  image-rendering: pixelated;
  margin: 0 auto;
}

.tpm-export {
  width: 100%;
  background: #14141a;
  color: #c9c9d4;
  border: 1px solid #3a3a44;
  border-radius: 4px;
  padding: 0.5rem;
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 0.8rem;
  resize: vertical;
}
</style>
