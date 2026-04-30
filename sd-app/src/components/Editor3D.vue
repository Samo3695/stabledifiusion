<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const props = defineProps({
  gridSize: { type: Number, default: 10 },
  cellSize: { type: Number, default: 1 },
  // Extra textures (data URLs or URLs) passed from parent — e.g. begin.json textureSettings.customTexture
  customTextures: { type: Array, default: () => [] },
  // When true, expose a 'Noise Mask' tool in the toolbar that lets the user
  // paint a 2D mask (camera-aligned) on top of the 3D canvas.
  enableNoisePaint: { type: Boolean, default: false },
  // When true, captureScreenshot adds two extra passes on top of the textured
  // screenshot, both purely additive (original textures + plane tile pattern
  // stay untouched):
  //   1. Face grid — every mesh re-rendered with a transparent grid texture
  //      so the grid lines bend on cylinders/cones/spheres but stay straight
  //      on cubes/pyramids — this is the signal SD uses to tell curved vs
  //      faceted geometry apart.
  //   2. Intersection edges — ID-pass + boundary detection draws thick lines
  //      where two objects (or an object and the plane) meet on screen.
  gridOverlay: { type: Boolean, default: false },
  // Intersection-line thickness in output pixels (1–30).
  gridThickness: { type: Number, default: 6 },
  // Face-grid line thickness in texture pixels (1–20). Drawn into a 256×256
  // CanvasTexture and tiled per object — bigger = chunkier seams on faces.
  faceGridThickness: { type: Number, default: 4 }
})

const container = ref(null)
const objectCount = ref(0)
const volumeM3 = ref(0)
const activeTool = ref('cube')
const activeSize = ref(1)
const includeGround = ref(true)
const paintColor = ref('#e07a3a')
const paintMode = ref('color') // 'color' | 'texture'
const paintTexture = ref(null) // resolved URL/dataURL when mode=texture
const paintPopupOpen = ref(false)
const BASE_URL = import.meta.env.BASE_URL
const PAINT_TEXTURE_FILES = ['concrate.jpg', 'concratedark.jpg', 'grass.jpg', 'water.jpg']
const paintTextures = computed(() => {
  const builtin = PAINT_TEXTURE_FILES.map(f => ({ url: `${BASE_URL}templates/textures/${f}`, label: f }))
  const custom = (props.customTextures || []).map((u, i) => ({ url: u, label: `custom-${i + 1}` }))
  return [...builtin, ...custom]
})
const loadedPaintTextures = {} // cache THREE.Texture by URL
const apexHeight = ref(1) // height multiplier for pyramid/cone/roof (0.3–2.5)
const paintSize = ref('fill') // 1 | 2 | 3 | 4 | 'fill'
const PAINT_SIZES = [1, 2, 3, 4, 'fill']
// Per-tool orientation/variant toggles (small corner buttons on tool tiles).
const roofRotated = ref(false)
const cylinderSide = ref(false)
const cylinderSideRight = ref(false)
const archRotated = ref(false)
const sphereDome = ref(false)

const SIZES = [1, 2, 3, 4, 5, 6, 7, 8]
const BASE_TOOLS = [
  { id: 'cube',     label: 'Cube'    },
  { id: 'pyramid',  label: 'Pyramid' },
  { id: 'roof',     label: 'Roof'    },
  { id: 'cone',     label: 'Cone'    },
  { id: 'cylinder', label: 'Cylinder'},
  { id: 'arch',     label: 'Arch'    },
  { id: 'sphere',   label: 'Sphere'  },
  { id: 'paint',    label: 'Paint'   },
  { id: 'erase',    label: 'Erase'   }
]
// Tool list is reactive so the optional 'noisepaint' tool can be toggled via prop.
const TOOLS = computed(() => props.enableNoisePaint
  ? [...BASE_TOOLS, { id: 'noisepaint', label: 'Noise Mask' }]
  : BASE_TOOLS)

// Brush sizes (in pixels) for the noise-mask painter overlay.
const NOISE_BRUSH_SIZES = [10, 20, 40, 80, 150]
const NOISE_BRUSH_LABELS = ['XS', 'S', 'M', 'L', 'XL']
const noiseBrushSize = ref(40)
const noiseCanvas = ref(null)
let noisePainting = false
// Cache of the noise mask aligned to the latest screenshot's camera transform
// and crop. Refreshed every captureScreenshot() call so getNoiseMask() returns
// pixels that match the image actually sent to SD.
let alignedNoiseMaskDataUrl = null

// Footprint in grid cells (width on X, depth on Z) for each tool at the current size.
function footprint(tool, n) {
  return { w: n, d: n }
}

let scene, camera, renderer, raycaster, pointer
let plane, gridHelper
let placed = []
let rollover
let paintOverlay // small plane shown on hover during tile-paint mode
let hoverTarget = null
let hoverOriginalColor = null
let resizeObserver
let animId
let needsRender = true
let stoneTexture = null

const faceGridTexCache = new Map() // key: thickness px → THREE.CanvasTexture

// Procedural face-grid texture: transparent base + dark seams on top + left
// edge of the tile. RepeatWrapping turns it into a full grid when tiled.
// Cached per thickness so repeated screenshots reuse the same canvas.
function getFaceGridTexture(thicknessPx) {
  const t = Math.max(1, Math.min(20, thicknessPx | 0))
  const cached = faceGridTexCache.get(t)
  if (cached) return cached
  const size = 256
  const c = document.createElement('canvas')
  c.width = size; c.height = size
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, size, size)
  ctx.strokeStyle = 'rgba(15, 15, 22, 0.92)'
  ctx.lineWidth = t
  ctx.beginPath()
  ctx.moveTo(0, 0); ctx.lineTo(size, 0)
  ctx.moveTo(0, 0); ctx.lineTo(0, size)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  faceGridTexCache.set(t, tex)
  return tex
}

// Composite a face-aligned grid pattern over the textured screenshot. Each
// placed object + plane is briefly re-rendered with a transparent grid
// material that follows the geometry's UVs — so the grid bends on curved
// surfaces (cylinder, cone, sphere) and stays straight on faceted geometry
// (cube, pyramid). That curvature signal is what SD reads to distinguish
// shapes that share a silhouette.
function drawFaceGrid(octx, outW, outH, minX, minY, cw, ch, thicknessPx) {
  if (!placed || placed.length === 0) return
  const baseTex = getFaceGridTexture(thicknessPx)
  const restorers = []
  const _bbox = new THREE.Box3()
  const _sz = new THREE.Vector3()
  const swap = (mesh, fallbackRepeat) => {
    if (!mesh) return
    const orig = mesh.material
    _bbox.setFromObject(mesh)
    _bbox.getSize(_sz)
    // ~2 grid cells per world unit so a 1m cube gets a 2×2 grid per face.
    const rx = fallbackRepeat ?? Math.max(1, Math.round(Math.max(_sz.x, _sz.z) * 2))
    const ry = fallbackRepeat ?? Math.max(1, Math.round(Math.max(_sz.y, _sz.z) * 2))
    const t = baseTex.clone()
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(rx, ry)
    t.needsUpdate = true
    mesh.material = new THREE.MeshBasicMaterial({
      map: t, transparent: true, color: 0xffffff
    })
    restorers.push(() => {
      mesh.material.map?.dispose()
      mesh.material.dispose()
      mesh.material = orig
    })
  }
  for (const o of placed) swap(o)
  // Plane gets a denser grid so the floor reads as tiled.
  if (plane && plane.visible) swap(plane, 20)

  renderer.render(scene, camera)
  const src = renderer.domElement
  octx.save()
  octx.imageSmoothingEnabled = true
  octx.drawImage(src, minX, minY, cw, ch, 0, 0, outW, outH)
  octx.restore()

  for (const r of restorers) r()
}

// Composite thick dark lines onto an output canvas at the screen-space
// boundaries where placed objects meet each other or meet the plane. Works by
// rendering an "ID pass" (each mesh = unique flat hue, plane = its own dark
// hue), reading pixels back, finding 4-neighbour colour discontinuities, and
// then dilating that 1-pixel mask up to the requested thickness via repeated
// offset draws (cheap morphological dilation in canvas).
//
// The original textures + colours stay untouched — this is purely additive
// composite over the already-rendered screenshot.
function drawInterObjectEdges(octx, outW, outH, minX, minY, cw, ch, thicknessPx) {
  if (!placed || placed.length === 0) return
  const thick = Math.max(1, Math.min(30, thicknessPx | 0))

  // --- ID pass: unique flat colour per mesh + a distinct colour for the plane ---
  const restorers = []
  const _col = new THREE.Color()
  const swap = (mesh, hex) => {
    if (!mesh) return
    const orig = mesh.material
    mesh.material = new THREE.MeshBasicMaterial({ color: hex })
    restorers.push(() => {
      mesh.material.dispose()
      mesh.material = orig
    })
  }
  for (let i = 0; i < placed.length; i++) {
    // Spread hues so neighbouring objects always have very different RGB.
    const hue = ((i * 73) % 360) / 360
    const hex = _col.setHSL(hue, 0.95, 0.55).getHex()
    swap(placed[i], hex)
  }
  if (plane && plane.visible) swap(plane, 0x101820)
  renderer.render(scene, camera)

  const src = renderer.domElement
  const tmp = document.createElement('canvas')
  tmp.width = cw; tmp.height = ch
  tmp.getContext('2d').drawImage(src, minX, minY, cw, ch, 0, 0, cw, ch)
  const id = tmp.getContext('2d').getImageData(0, 0, cw, ch)
  const px = id.data

  // Restore materials before any further rendering uses them.
  for (const r of restorers) r()

  // --- Build 1-pixel edge mask (where 4-neighbour RGB differs significantly) ---
  // Skip background→object boundaries (alpha discontinuity) so we don't stroke
  // the whole silhouette — we only want intra-scene intersection lines.
  const mask = new ImageData(cw, ch)
  const m = mask.data
  const W = cw
  const ALPHA_MIN = 16
  const RGB_THRESH = 24
  const diff = (i, j) =>
    Math.abs(px[i] - px[j]) +
    Math.abs(px[i + 1] - px[j + 1]) +
    Math.abs(px[i + 2] - px[j + 2])
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      if (px[i + 3] < ALPHA_MIN) continue
      let isEdge = false
      if (x + 1 < W) {
        const j = i + 4
        if (px[j + 3] >= ALPHA_MIN && diff(i, j) > RGB_THRESH) isEdge = true
      }
      if (!isEdge && y + 1 < ch) {
        const j = i + W * 4
        if (px[j + 3] >= ALPHA_MIN && diff(i, j) > RGB_THRESH) isEdge = true
      }
      if (isEdge) {
        m[i] = 0; m[i + 1] = 0; m[i + 2] = 0; m[i + 3] = 255
      }
    }
  }
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = cw; maskCanvas.height = ch
  maskCanvas.getContext('2d').putImageData(mask, 0, 0)

  // --- Dilate to requested thickness via offset draws ---
  // Scale the destination radius from input crop pixels to output pixels so
  // thickness reads consistently regardless of crop resize.
  const scale = outW / cw
  const r = Math.max(1, Math.round((thick / 2) * scale))
  octx.save()
  octx.imageSmoothingEnabled = true
  // Center pass:
  octx.drawImage(maskCanvas, 0, 0, outW, outH)
  // Disc-shaped offset passes for thickening:
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0) continue
      if (dx * dx + dy * dy > r * r) continue
      octx.drawImage(maskCanvas, 0, 0, cw, ch, dx, dy, outW, outH)
    }
  }
  octx.restore()
}

const OBJECT_COLOR = 0x9999a8
const ROLLOVER_COLOR = 0x66aaff
const ERASE_HIGHLIGHT = 0xff4444

// Canvas-painted tile texture: clean light tiles with dark seams. Repeats per grid cell.
function makeTileTexture(cells, tileSize) {
  const c = document.createElement('canvas')
  c.width = tileSize; c.height = tileSize
  const ctx = c.getContext('2d')
  // Base tile fill with slight gradient for depth
  const g = ctx.createLinearGradient(0, 0, tileSize, tileSize)
  g.addColorStop(0, '#d6d6df')
  g.addColorStop(1, '#b8b8c4')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, tileSize, tileSize)
  // Subtle noise for texture
  const img = ctx.getImageData(0, 0, tileSize, tileSize)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18
    img.data[i]   = Math.max(0, Math.min(255, img.data[i]   + n))
    img.data[i+1] = Math.max(0, Math.min(255, img.data[i+1] + n))
    img.data[i+2] = Math.max(0, Math.min(255, img.data[i+2] + n))
  }
  ctx.putImageData(img, 0, 0)
  // Dark seam
  ctx.strokeStyle = '#3a3a48'
  ctx.lineWidth = Math.max(2, tileSize * 0.04)
  ctx.strokeRect(0, 0, tileSize, tileSize)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(cells, cells)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.anisotropy = 4
  return tex
}

// Apply stone texture to a placed object, tiled per cell-size so scale stays consistent.
function applyStoneMaterial(mesh) {
  if (!stoneTexture) return
  const n = mesh.userData.size || 1
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  for (const m of mats) {
    const tex = stoneTexture.clone()
    tex.needsUpdate = true
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.colorSpace = THREE.SRGBColorSpace
    tex.repeat.set(n, n)
    m.map = tex
    if (!m.userData || !m.userData.painted) m.color.setHex(0xffffff)
    m.needsUpdate = true
  }
}

// Triangular-prism (house roof): width w on X, depth d on Z, ridge along Z at height h.
// 5 material groups: 0=bottom, 1=back-triangle, 2=front-triangle, 3=left-slope, 4=right-slope.
function makeRoofGeometry(w, d, h, baseY = -h / 2) {
  const hw = w / 2, hd = d / 2
  const y0 = baseY, y1 = baseY + h
  const positions = new Float32Array([
    // bottom quad, normal -Y
    -hw, y0, -hd,   hw, y0, -hd,   hw, y0, hd,  -hw, y0, hd,
    // back triangle (z=-hd), normal -Z
    -hw, y0, -hd,   hw, y0, -hd,   0, y1, -hd,
    // front triangle (z=+hd), normal +Z
     hw, y0,  hd,  -hw, y0,  hd,   0, y1,  hd,
    // left slope
    -hw, y0, -hd,  -hw, y0,  hd,   0, y1,  hd,   0, y1, -hd,
    // right slope
     hw, y0,  hd,   hw, y0, -hd,   0, y1, -hd,   0, y1,  hd,
  ])
  const indices = [
    // bottom (normal -Y)
    0, 1, 2,  0, 2, 3,
    // back triangle (normal -Z)
    4, 6, 5,
    // front triangle (normal +Z)
    7, 9, 8,
    // left slope
    10, 11, 12,  10, 12, 13,
    // right slope
    14, 15, 16,  14, 16, 17,
  ]
  const uvs = new Float32Array([
    // bottom
    0,0, 1,0, 1,1, 0,1,
    // back tri
    0,0, 1,0, 0.5,1,
    // front tri
    0,0, 1,0, 0.5,1,
    // left slope (quad)
    0,0, 1,0, 1,1, 0,1,
    // right slope
    0,0, 1,0, 1,1, 0,1,
  ])
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  // Groups (index ranges, per triangle count * 3)
  geo.addGroup(0, 6, 0)   // bottom: 2 tris
  geo.addGroup(6, 3, 1)   // back tri
  geo.addGroup(9, 3, 2)   // front tri
  geo.addGroup(12, 6, 3)  // left slope
  geo.addGroup(18, 6, 4)  // right slope
  return geo
}

// Half-cylinder ("arch"): flat bottom on -Y, curved top, length along Z.
// Width = s on X, length = s on Z, arch height = s/2 (radius).
function makeArchGeometry(s) {
  const r = s / 2
  const shape = new THREE.Shape()
  shape.moveTo(-r, 0)
  shape.lineTo(r, 0)
  shape.absarc(0, 0, r, 0, Math.PI, false)
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: s,
    bevelEnabled: false,
    curveSegments: 32,
  })
  // Default extrude: x in [-r,r], y in [0,r], z in [0,s]. Center on Z, lower base to -s/2.
  geo.translate(0, -s / 2, -s / 2)
  return geo
}

function applyDefaultGroundTexture() {
  if (!plane) return
  // Drop any previous tile-paint canvas state so re-paint re-initialises a fresh canvas.
  if (plane.material.userData) {
    plane.material.userData.canvas = null
    plane.material.userData.ctx = null
    plane.material.userData.painted = false
  }
  new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}templates/icons/texture-bottom.png`,
    (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.anisotropy = 4
      tex.colorSpace = THREE.SRGBColorSpace
      tex.repeat.set(props.gridSize, props.gridSize)
      plane.material.map = tex
      plane.material.color.setHex(0xffffff)
      plane.material.needsUpdate = true
      needsRender = true
    },
    undefined,
    () => { /* missing texture: keep tiled fallback */ }
  )
}

function makeGeometry(tool, cs, n) {
  const s = cs * n
  const ah = apexHeight.value // apex-height multiplier for pyramid/cone/roof
  const h = s * ah
  // Keep base of variable-height shapes fixed at -s/2 so they sit flush regardless of ah.
  switch (tool) {
    case 'cube':     return new THREE.BoxGeometry(s, s, s)
    case 'pyramid': {
      const geo = new THREE.ConeGeometry(s / Math.SQRT2, h, 4, 1)
      geo.rotateY(Math.PI / 4)
      geo.translate(0, (h - s) / 2, 0)
      return geo
    }
    case 'roof':     return makeRoofGeometry(s, s, h, -s / 2)
    case 'sphere': {
      const r = s / 2
      if (sphereDome.value) {
        const geo = new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2)
        geo.translate(0, -s / 2, 0) // base flat at -s/2
        return geo
      }
      return new THREE.SphereGeometry(r, 32, 16)
    }
    case 'cone': {
      const geo = new THREE.ConeGeometry(s * 0.5, h, 32)
      geo.translate(0, (h - s) / 2, 0)
      return geo
    }
    case 'cylinder': {
      const geo = new THREE.CylinderGeometry(s * 0.5, s * 0.5, h, 32)
      geo.translate(0, (h - s) / 2, 0)
      return geo
    }
    case 'arch':     return makeArchGeometry(s)
    default:         return new THREE.BoxGeometry(s, s, s)
  }
}

function init() {
  const el = container.value
  const w = el.clientWidth || 400
  const h = el.clientHeight || 400

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1a2e)

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000)
  const iso = props.gridSize * props.cellSize
  // Phaser-style 2:1 dimetric: camera Y = iso * sqrt(2/3) → exact 2:1 tile ratio on screen.
  camera.position.set(iso, iso * Math.sqrt(2 / 3), iso)
  camera.lookAt(0, 0, 0)
  fitCamera(w, h)

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(w, h)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  el.appendChild(renderer.domElement)

  // Lighting: low ambient + strong key light (casts shadow) + soft fill from opposite side.
  scene.add(new THREE.AmbientLight(0xffffff, 0.55))
  const key = new THREE.DirectionalLight(0xffffff, 1.1)
  // Lower sun angle → longer, softer shadows cast toward lower-left.
  key.position.set(7, 7, -13.5)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  const shadowRange = props.gridSize * props.cellSize
  const cam = key.shadow.camera
  cam.left = -shadowRange; cam.right = shadowRange
  cam.top = shadowRange; cam.bottom = -shadowRange
  cam.near = 0.5; cam.far = shadowRange * 4
  key.shadow.bias = -0.0005
  key.shadow.radius = 4
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x8aa0ff, 0.25)
  // Fill from opposite side (lower-left) to soften shadows without killing them.
  fill.position.set(-6, 5, 6)
  scene.add(fill)

  const total = props.gridSize * props.cellSize
  const planeGeo = new THREE.PlaneGeometry(total, total)
  planeGeo.rotateX(-Math.PI / 2)
  // Tiled texture for the ground so SD latches onto a clean "tiled floor" pattern.
  const tileTex = makeTileTexture(props.gridSize, 128)
  plane = new THREE.Mesh(
    planeGeo,
    new THREE.MeshStandardMaterial({ map: tileTex, color: 0xcfcfd8, roughness: 0.85, metalness: 0.05 })
  )
  plane.receiveShadow = true
  plane.name = 'ground'
  scene.add(plane)

  function applyStoneToGround() {
    if (!stoneTexture || !plane) return
    const tex = stoneTexture.clone()
    tex.needsUpdate = true
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.colorSpace = THREE.SRGBColorSpace
    tex.repeat.set(props.gridSize, props.gridSize)
    plane.material.map = tex
    plane.material.color.setHex(0xffffff)
    plane.material.needsUpdate = true
  }

  // Grid covers only the inner placement zone; the outer half-cell ring is a non-buildable border.
  const placementExtent = total - props.cellSize
  gridHelper = new THREE.GridHelper(placementExtent, props.gridSize - 1, 0x99a0b8, 0x5a607a)
  gridHelper.material.transparent = true
  gridHelper.material.opacity = 0.35
  gridHelper.position.y = 0.002
  scene.add(gridHelper)

  // Load stone texture for placed objects (user-supplied file in public/textures/).
  new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}templates/icons/texture.png`,
    (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.anisotropy = 4
      tex.colorSpace = THREE.SRGBColorSpace
      stoneTexture = tex
      for (const o of placed) applyStoneMaterial(o)
      needsRender = true
    },
    undefined,
    () => { /* missing texture: objects stay flat grey */ }
  )

  // Load separate ground texture.
  applyDefaultGroundTexture()

  rebuildRollover()

  raycaster = new THREE.Raycaster()
  pointer = new THREE.Vector2()

  const dom = renderer.domElement
  dom.addEventListener('pointermove', onPointerMove)
  dom.addEventListener('pointerleave', onPointerLeave)
  dom.addEventListener('pointerdown', onPointerDown)
  dom.addEventListener('contextmenu', (e) => e.preventDefault())

  resizeObserver = new ResizeObserver(() => { onResize(); syncNoiseCanvas(); needsRender = true })
  resizeObserver.observe(el)

  animate()
}

function rebuildRollover() {
  if (rollover) {
    scene.remove(rollover)
    rollover.geometry.dispose()
    rollover.material.dispose()
    rollover = null
  }
  if (activeTool.value === 'erase' || activeTool.value === 'paint' || activeTool.value === 'noisepaint') return
  const geo = makeGeometry(activeTool.value, props.cellSize, activeSize.value)
  const mat = new THREE.MeshBasicMaterial({ color: ROLLOVER_COLOR, opacity: 0.45, transparent: true, depthWrite: false })
  rollover = new THREE.Mesh(geo, mat)
  if (activeTool.value === 'roof' && roofRotated.value) rollover.rotation.y = Math.PI / 2
  if (activeTool.value === 'cylinder' && cylinderSide.value) rollover.rotation.x = Math.PI / 2
  if (activeTool.value === 'cylinder' && cylinderSideRight.value) rollover.rotation.z = Math.PI / 2
  if (activeTool.value === 'arch' && archRotated.value) rollover.rotation.y = Math.PI / 2
  rollover.visible = false
  scene.add(rollover)
  needsRender = true
}

function ensurePaintOverlay() {
  if (paintOverlay) return
  const geo = new THREE.PlaneGeometry(1, 1)
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  })
  paintOverlay = new THREE.Mesh(geo, mat)
  paintOverlay.visible = false
  paintOverlay.renderOrder = 999
  scene.add(paintOverlay)
}

// Position paintOverlay on the hovered face at the would-be-painted region.
// Works best for axis-aligned faces (cubes, ground); falls back to face-center quad otherwise.
function updatePaintOverlay(hit) {
  ensurePaintOverlay()
  const obj = hit.object
  if (!hit.uv || !hit.face) {
    paintOverlay.visible = false
    return
  }
  const isGround = obj === plane
  const N = isGround ? props.gridSize : (obj.userData && obj.userData.size ? obj.userData.size : 1)
  const ps = paintSize.value === 'fill' ? N : Math.min(paintSize.value, N)
  if (ps <= 0) { paintOverlay.visible = false; return }

  // Compute world-space face frame.
  const normalLocal = hit.face.normal.clone()
  const normalMat = new THREE.Matrix3().getNormalMatrix(obj.matrixWorld)
  const normalWorld = normalLocal.applyMatrix3(normalMat).normalize()
  // Tangent / bitangent: pick a stable up-vector that isn't parallel to normal.
  const isHorizontal = Math.abs(normalWorld.y) > 0.9
  const up = isHorizontal ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
  const tangent = new THREE.Vector3().crossVectors(up, normalWorld).normalize()
  const bitangent = new THREE.Vector3().crossVectors(normalWorld, tangent).normalize()
  // Horizontal faces (top of cube, ground) have UV axes opposite of cross-product result.
  if (isHorizontal) {
    tangent.negate()
    bitangent.negate()
  }

  // Estimate face size from object bounding box (approx for boxes/cubes).
  obj.geometry.computeBoundingBox()
  const bb = obj.geometry.boundingBox
  const size = new THREE.Vector3(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z)
  // Use the two largest extents that are perpendicular to local normal as face dims.
  const ax = Math.abs(normalLocal.x), ay = Math.abs(normalLocal.y), az = Math.abs(normalLocal.z)
  let faceW, faceH
  if (ax > 0.5) { faceW = size.z; faceH = size.y }
  else if (ay > 0.5) { faceW = size.x; faceH = size.z }
  else { faceW = size.x; faceH = size.y }
  // Account for object scale.
  const sx = obj.scale.x, sy = obj.scale.y, sz = obj.scale.z
  if (ax > 0.5) { faceW *= sz; faceH *= sy }
  else if (ay > 0.5) { faceW *= sx; faceH *= sz }
  else { faceW *= sx; faceH *= sy }

  const tileW = faceW / N
  const tileH = faceH / N

  // Tile origin on UV grid.
  const tu = Math.max(0, Math.min(N - 1, Math.floor(hit.uv.x * N)))
  const tv = Math.max(0, Math.min(N - 1, Math.floor(hit.uv.y * N)))
  const tu0 = Math.max(0, Math.min(N - ps, tu - Math.floor((ps - 1) / 2)))
  const tv0 = Math.max(0, Math.min(N - ps, tv - Math.floor((ps - 1) / 2)))

  // Center of overlay region in UV space, relative to face center.
  const uCenter = (tu0 + ps / 2) / N - 0.5
  const vCenter = (tv0 + ps / 2) / N - 0.5

  // Face center in world: project hit.point onto the face plane through the bounding-box center.
  const objCenterLocal = new THREE.Vector3(
    (bb.max.x + bb.min.x) / 2,
    (bb.max.y + bb.min.y) / 2,
    (bb.max.z + bb.min.z) / 2,
  )
  const objCenterWorld = objCenterLocal.clone().applyMatrix4(obj.matrixWorld)
  // Distance from object center to face plane along normal: half of size component along normal.
  const halfAlongNormal = (ax > 0.5 ? size.x * sx : ay > 0.5 ? size.y * sy : size.z * sz) / 2
  const faceCenter = objCenterWorld.clone().addScaledVector(normalWorld, halfAlongNormal)

  const offset = tangent.clone().multiplyScalar(uCenter * faceW).add(bitangent.clone().multiplyScalar(vCenter * faceH))
  const pos = faceCenter.add(offset)
  // Lift slightly along normal to avoid z-fighting.
  pos.addScaledVector(normalWorld, 0.002)

  paintOverlay.position.copy(pos)
  // Build a matrix to align plane with face: plane local +Z toward normal, +X toward tangent, +Y toward bitangent.
  const m = new THREE.Matrix4().makeBasis(tangent, bitangent, normalWorld)
  paintOverlay.quaternion.setFromRotationMatrix(m)
  paintOverlay.scale.set(ps * tileW, ps * tileH, 1)
  paintOverlay.material.color.set(paintMode.value === 'texture' ? '#66aaff' : paintColor.value)
  paintOverlay.visible = true
}

function animate() {
  animId = requestAnimationFrame(animate)
  if (needsRender) {
    renderer.render(scene, camera)
    needsRender = false
  }
}

// Fit the orthographic camera so the ground diamond fills the width,
// and the plane sits near the bottom (leaving vertical room above for tall objects).
function fitCamera(w, h, zoomOverride = null) {
  const total = props.gridSize * props.cellSize
  // 2:1 dimetric projection: horizontal half = total/sqrt(2), vertical half = horizontal/2.
  const halfX = total / Math.SQRT2
  const halfPlaneY = halfX / 2
  const zoom = zoomOverride !== null ? zoomOverride : 0.92  // slightly zoomed-out live view
  const frustHalfW = halfX / zoom
  const aspect = w / h
  const frustH = (frustHalfW * 2) / aspect  // view-space height of frustum
  const bottomMargin = props.cellSize * 0.15
  const bottom = -halfPlaneY - bottomMargin
  const top = bottom + frustH
  camera.left = -frustHalfW
  camera.right = frustHalfW
  camera.top = top
  camera.bottom = bottom
  camera.updateProjectionMatrix()
}

function onResize() {
  if (!container.value || !renderer) return
  const w = container.value.clientWidth
  const h = container.value.clientHeight
  if (!w || !h) return
  fitCamera(w, h)
  renderer.setSize(w, h)
}

function updatePointer(e) {
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
}

function pickAll() {
  raycaster.setFromCamera(pointer, camera)
  return raycaster.intersectObjects([plane, ...placed], false)
}

// Compute grid-snapped placement position on top of a hit surface.
function snapPlacement(hit, tool, n) {
  const cs = props.cellSize
  const fp = footprint(tool, n)
  const height = cs * n
  const target = hit.object
  let baseY
  if (target === plane) {
    baseY = 0
  } else {
    target.geometry.computeBoundingBox()
    const bb = target.geometry.boundingBox
    baseY = target.position.y + bb.max.y
  }
  // Snap center so the footprint aligns to grid cells.
  // Even footprint -> center on grid line; odd -> center on cell center.
  const offX = (fp.w % 2 === 0) ? 0 : cs / 2
  const offZ = (fp.d % 2 === 0) ? 0 : cs / 2
  let x = Math.round((hit.point.x - offX) / cs) * cs + offX
  let z = Math.round((hit.point.z - offZ) / cs) * cs + offZ
  // Clamp so footprint stays within the buildable inner area (half-cell border around the plane).
  const half = ((props.gridSize - 1) * cs) / 2
  const halfW = (fp.w * cs) / 2
  const halfD = (fp.d * cs) / 2
  x = Math.max(-half + halfW, Math.min(half - halfW, x))
  z = Math.max(-half + halfD, Math.min(half - halfD, z))
  return new THREE.Vector3(x, baseY + height / 2, z)
}

function clearHoverHighlight() {
  if (hoverTarget && hoverOriginalColor !== null) {
    const mats = Array.isArray(hoverTarget.material) ? hoverTarget.material : [hoverTarget.material]
    for (let i = 0; i < mats.length; i++) {
      const c = Array.isArray(hoverOriginalColor) ? hoverOriginalColor[i] : hoverOriginalColor
      mats[i].color.setHex(c)
    }
  }
  hoverTarget = null
  hoverOriginalColor = null
}

function setHoverHighlight(target, color, faceIndex = null) {
  const mats = Array.isArray(target.material) ? target.material : [target.material]
  hoverTarget = target
  if (faceIndex !== null && Array.isArray(target.material)) {
    const orig = mats.map(m => m.color.getHex())
    hoverOriginalColor = orig
    mats[faceIndex].color.setHex(color)
  } else {
    hoverOriginalColor = Array.isArray(target.material) ? mats.map(m => m.color.getHex()) : mats[0].color.getHex()
    for (const m of mats) m.color.setHex(color)
  }
}

function getPaintTexture(url) {
  if (loadedPaintTextures[url]) return loadedPaintTextures[url]
  const tex = new THREE.TextureLoader().load(url, () => { needsRender = true })
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  loadedPaintTextures[url] = tex
  return tex
}

function ensureFaceCanvas(mat, N) {
  if (mat.userData && mat.userData.canvas) return
  const tile = 64
  const c = document.createElement('canvas')
  c.width = N * tile
  c.height = N * tile
  const ctx = c.getContext('2d')
  // Initialize from current map's image, tiled NxN. Falls back to flat color.
  const srcImg = mat.map && mat.map.image
  if (srcImg && (srcImg.complete === undefined || srcImg.complete)) {
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++)
      ctx.drawImage(srcImg, i * tile, j * tile, tile, tile)
  } else {
    ctx.fillStyle = '#999'
    ctx.fillRect(0, 0, c.width, c.height)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.repeat.set(1, 1)
  mat.map = tex
  mat.color.setHex(0xffffff)
  mat.userData = mat.userData || {}
  mat.userData.canvas = c
  mat.userData.ctx = ctx
  mat.userData.tilePx = tile
  mat.userData.gridN = N
  mat.userData.painted = true
  mat.needsUpdate = true
}

function paintFace(hit) {
  const obj = hit.object
  const idx = hit.face && hit.face.materialIndex != null ? hit.face.materialIndex : 0
  let mat
  if (Array.isArray(obj.material)) {
    mat = obj.material[idx] || obj.material[0]
  } else {
    mat = obj.material
  }

  // Tile-paint only on flat-faced surfaces: cube and ground plane. Everything else fills.
  const isCube = obj.userData && obj.userData.tool === 'cube'
  const isGround = obj === plane
  const N = isGround ? props.gridSize : (obj.userData && obj.userData.size ? obj.userData.size : 1)
  const ps = paintSize.value
  const canTilePaint = ps !== 'fill' && hit.uv && (isCube || isGround)
  if (canTilePaint) {
    ensureFaceCanvas(mat, N)
    const ctx = mat.userData.ctx
    const tile = mat.userData.tilePx
    const tu = Math.max(0, Math.min(N - 1, Math.floor(hit.uv.x * N)))
    const tv = Math.max(0, Math.min(N - 1, Math.floor(hit.uv.y * N)))
    const psv = Math.min(ps, N)
    // Center-ish: top-left tile = (tu, tv), but clamp to face bounds.
    const tu0 = Math.max(0, Math.min(N - psv, tu - Math.floor((psv - 1) / 2)))
    const tv0 = Math.max(0, Math.min(N - psv, tv - Math.floor((psv - 1) / 2)))
    // Canvas is Y-flipped vs UV.
    const px = tu0 * tile
    const py = (N - tv0 - psv) * tile
    const w = psv * tile
    const h = psv * tile
    if (paintMode.value === 'texture' && paintTexture.value) {
      const srcTex = getPaintTexture(paintTexture.value)
      const img = srcTex.image
      if (img && (img.complete === undefined || img.complete)) {
        // Fill area by tiling the source texture once per tile cell.
        for (let i = 0; i < psv; i++) for (let j = 0; j < psv; j++)
          ctx.drawImage(img, px + i * tile, py + j * tile, tile, tile)
      } else {
        ctx.fillStyle = paintColor.value
        ctx.fillRect(px, py, w, h)
      }
    } else {
      ctx.fillStyle = paintColor.value
      ctx.fillRect(px, py, w, h)
    }
    mat.map.needsUpdate = true
    mat.needsUpdate = true
    needsRender = true
    return
  }

  // Fill mode (or non-tile-able face): replace whole-face material color/map.
  if (paintMode.value === 'texture' && paintTexture.value) {
    const srcTex = getPaintTexture(paintTexture.value)
    const tex = srcTex.clone()
    tex.needsUpdate = true
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.colorSpace = THREE.SRGBColorSpace
    tex.repeat.set(N, N)
    mat.map = tex
    mat.color.setHex(0xffffff)
    if (mat.userData) { mat.userData.canvas = null; mat.userData.ctx = null }
  } else {
    mat.color.set(paintColor.value)
  }
  mat.userData = mat.userData || {}
  mat.userData.painted = true
  mat.needsUpdate = true
  // If this face is the currently-hovered one, update the stored original
  // so the hover-restore doesn't revert our new paint on next pointermove.
  if (hoverTarget === obj) {
    const newHex = mat.color.getHex()
    if (Array.isArray(hoverOriginalColor)) hoverOriginalColor[idx] = newHex
    else hoverOriginalColor = newHex
  }
  needsRender = true
}

function onPointerMove(e) {
  updatePointer(e)
  const hits = pickAll()

  if (activeTool.value === 'erase') {
    if (rollover) rollover.visible = false
    clearHoverHighlight()
    const target = hits.find(h => h.object !== plane)?.object
    if (target) setHoverHighlight(target, ERASE_HIGHLIGHT)
    needsRender = true
    return
  }

  if (activeTool.value === 'paint') {
    if (rollover) rollover.visible = false
    clearHoverHighlight()
    const hit = hits[0]
    if (hit) {
      const obj = hit.object
      const isFlat = (obj.userData && obj.userData.tool === 'cube') || obj === plane
      if (paintSize.value === 'fill' || !isFlat) {
        if (paintOverlay) paintOverlay.visible = false
        const fi = hit.face && hit.face.materialIndex != null ? hit.face.materialIndex : 0
        const hex = paintMode.value === 'texture' ? ROLLOVER_COLOR : new THREE.Color(paintColor.value).getHex()
        setHoverHighlight(obj, hex, fi)
      } else {
        updatePaintOverlay(hit)
      }
    } else if (paintOverlay) {
      paintOverlay.visible = false
    }
    needsRender = true
    return
  }
  if (paintOverlay) paintOverlay.visible = false

  clearHoverHighlight()
  if (!rollover) return

  if (hits.length === 0) {
    if (rollover.visible) { rollover.visible = false; needsRender = true }
    return
  }
  const pos = snapPlacement(hits[0], activeTool.value, activeSize.value)
  rollover.visible = true
  rollover.position.copy(pos)
  needsRender = true
}

function onPointerLeave() {
  if (rollover) rollover.visible = false
  if (paintOverlay) paintOverlay.visible = false
  clearHoverHighlight()
  needsRender = true
}

function onPointerDown(e) {
  if (e.button !== 0) return
  updatePointer(e)
  const hits = pickAll()
  if (hits.length === 0) return

  if (activeTool.value === 'erase') {
    const target = hits.find(h => h.object !== plane)?.object
    if (target) removeObject(target)
    return
  }

  if (activeTool.value === 'paint') {
    if (hits[0]) paintFace(hits[0])
    return
  }

  const pos = snapPlacement(hits[0], activeTool.value, activeSize.value)
  const geo = makeGeometry(activeTool.value, props.cellSize, activeSize.value)
  // Size material array by max materialIndex + 1 (cone skips index 1 because it has no top cap).
  let maxIdx = -1
  if (geo.groups && geo.groups.length) {
    for (const g of geo.groups) if (g.materialIndex > maxIdx) maxIdx = g.materialIndex
  }
  const matOpts = { color: OBJECT_COLOR, roughness: 0.75, metalness: 0.0 }
  const mat = maxIdx >= 1
    ? Array.from({ length: maxIdx + 1 }, () => new THREE.MeshStandardMaterial(matOpts))
    : new THREE.MeshStandardMaterial(matOpts)
  const mesh = new THREE.Mesh(geo, mat)
  if (activeTool.value === 'roof' && roofRotated.value) mesh.rotation.y = Math.PI / 2
  if (activeTool.value === 'cylinder' && cylinderSide.value) mesh.rotation.x = Math.PI / 2
  if (activeTool.value === 'cylinder' && cylinderSideRight.value) mesh.rotation.z = Math.PI / 2
  if (activeTool.value === 'arch' && archRotated.value) mesh.rotation.y = Math.PI / 2
  if (activeTool.value === 'sphere') mesh.userData.dome = sphereDome.value
  mesh.position.copy(pos)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.tool = activeTool.value
  mesh.userData.size = activeSize.value
  // Dark edge outline so SD picks up crisp silhouettes.
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 20),
    new THREE.LineBasicMaterial({ color: 0x1a1a22, linewidth: 1 })
  )
  mesh.add(edges)
  applyStoneMaterial(mesh)
  scene.add(mesh)
  placed.push(mesh)
  objectCount.value = placed.length
  recomputeVolume()
  needsRender = true
}

function removeObject(obj) {
  clearHoverHighlight()
  scene.remove(obj)
  placed = placed.filter(o => o !== obj)
  obj.geometry.dispose()
  if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose())
  else obj.material.dispose()
  objectCount.value = placed.length
  recomputeVolume()
  needsRender = true
}

function selectTool(id) {
  if (activeTool.value === id) return
  clearHoverHighlight()
  activeTool.value = id
  rebuildRollover()
}

function selectSize(n) {
  if (activeSize.value === n) return
  activeSize.value = n
  rebuildRollover()
}

function onApexHeightChange(v) {
  apexHeight.value = parseFloat(v)
  rebuildRollover()
}

function hasApex(tool) {
  return tool === 'pyramid' || tool === 'cone' || tool === 'roof' || tool === 'cylinder'
}

// Bake a repeating texture into a single, pre-tiled canvas so the exported GLB
// does not depend on KHR_texture_transform for correct tiling in external viewers.
function bakeTiledTexture(srcTex, repeatX, repeatY, maxSize = 2048) {
  const img = srcTex && srcTex.image
  if (!img || !img.width || !img.height) return null
  const tileW = img.width, tileH = img.height
  let outW = tileW * repeatX
  let outH = tileH * repeatY
  const scale = Math.min(1, maxSize / Math.max(outW, outH))
  outW = Math.max(1, Math.round(outW * scale))
  outH = Math.max(1, Math.round(outH * scale))
  const c = document.createElement('canvas')
  c.width = outW; c.height = outH
  const ctx = c.getContext('2d')
  const stepW = outW / repeatX
  const stepH = outH / repeatY
  for (let y = 0; y < repeatY; y++) {
    for (let x = 0; x < repeatX; x++) {
      ctx.drawImage(img, x * stepW, y * stepH, stepW, stepH)
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

function downloadModel() {
  if (placed.length === 0) return
  const group = new THREE.Group()
  for (const o of placed) group.add(o.clone(true))
  if (includeGround.value && plane) {
    const gClone = plane.clone()
    const src = plane.material
    const baked = bakeTiledTexture(src.map, src.map?.repeat.x || 1, src.map?.repeat.y || 1)
    gClone.material = new THREE.MeshStandardMaterial({
      map: baked || src.map,
      color: 0xffffff,
      roughness: src.roughness ?? 0.85,
      metalness: src.metalness ?? 0.05,
    })
    gClone.name = 'ground'
    group.add(gClone)
  }
  const exporter = new GLTFExporter()
  exporter.parse(
    group,
    (result) => {
      const blob = result instanceof ArrayBuffer
        ? new Blob([result], { type: 'model/gltf-binary' })
        : new Blob([JSON.stringify(result)], { type: 'model/gltf+json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `model-${Date.now()}.${result instanceof ArrayBuffer ? 'glb' : 'gltf'}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
    (err) => console.error('GLTF export failed', err),
    { binary: true }
  )
}

function loadModelFile(file) {
  if (!file) return
  clearAll()
  const reader = new FileReader()
  reader.onload = () => {
    const loader = new GLTFLoader()
    loader.parse(
      reader.result,
      '',
      (gltf) => {
        gltf.scene.traverse((obj) => {
          if (obj.isMesh) {
            // Skip loaded ground plane (named 'ground' in export).
            if (obj.name === 'ground' || (obj.parent && obj.parent.name === 'ground')) return
            obj.castShadow = true
            obj.receiveShadow = true
          }
        })
        gltf.scene.updateMatrixWorld(true)
        const toAdd = []
        let groundMesh = null
        gltf.scene.traverse((obj) => {
          if (!obj.isMesh) return
          if (obj.name === 'ground') groundMesh = obj
          else toAdd.push(obj)
        })
        // Apply loaded ground texture/material onto the existing plane instead of adding a new one.
        if (groundMesh && plane) {
          const srcMat = Array.isArray(groundMesh.material) ? groundMesh.material[0] : groundMesh.material
          if (srcMat && srcMat.map) {
            const tex = srcMat.map
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping
            tex.colorSpace = THREE.SRGBColorSpace
            // Baked texture is already pre-tiled, so render at 1:1 on the plane.
            tex.repeat.set(1, 1)
            tex.offset.set(0, 0)
            tex.needsUpdate = true
            plane.material.map = tex
            plane.material.color.setHex(0xffffff)
            plane.material.needsUpdate = true
          }
        }
        for (const m of toAdd) {
          scene.attach(m)
          placed.push(m)
        }
        objectCount.value = placed.length
        recomputeVolume()
        needsRender = true
      },
      (err) => console.error('GLTF load failed', err)
    )
  }
  reader.readAsArrayBuffer(file)
}

// ----- Volume of placed objects (union of voxels — overlaps counted once) -----
const VOXEL_STEP = 0.25
const VOXEL_VOL = VOXEL_STEP * VOXEL_STEP * VOXEL_STEP

function pointInLocalShape(p, tool, bb) {
  if (p.y < bb.min.y - 1e-6 || p.y > bb.max.y + 1e-6) return false
  const halfX = (bb.max.x - bb.min.x) / 2
  const halfZ = (bb.max.z - bb.min.z) / 2
  const ySpan = bb.max.y - bb.min.y || 1
  const t = (bb.max.y - p.y) / ySpan // 1 at base, 0 at apex
  if (tool === 'cube') {
    return p.x >= bb.min.x - 1e-6 && p.x <= bb.max.x + 1e-6 &&
           p.z >= bb.min.z - 1e-6 && p.z <= bb.max.z + 1e-6
  }
  if (tool === 'cylinder') {
    return p.x * p.x + p.z * p.z <= halfX * halfX + 1e-6
  }
  if (tool === 'cone') {
    const r = halfX * t
    return p.x * p.x + p.z * p.z <= r * r + 1e-6
  }
  if (tool === 'pyramid') {
    return Math.abs(p.x) <= halfX * t + 1e-6 && Math.abs(p.z) <= halfZ * t + 1e-6
  }
  if (tool === 'arch') {
    const r = halfX
    const cy = bb.min.y
    return p.x * p.x + (p.y - cy) * (p.y - cy) <= r * r + 1e-6 &&
           p.z >= bb.min.z - 1e-6 && p.z <= bb.max.z + 1e-6
  }
  if (tool === 'sphere') {
    const r = halfX
    const ySpan = bb.max.y - bb.min.y
    if (ySpan > 1.5 * r) {
      // Full sphere centered on midY.
      const cy = (bb.max.y + bb.min.y) / 2
      return p.x * p.x + (p.y - cy) * (p.y - cy) + p.z * p.z <= r * r + 1e-6
    }
    // Dome: sphere center at flat (bottom) face.
    const cy = bb.min.y
    return p.x * p.x + (p.y - cy) * (p.y - cy) + p.z * p.z <= r * r + 1e-6
  }
  if (tool === 'roof') {
    return Math.abs(p.x) <= halfX * t + 1e-6 && Math.abs(p.z) <= halfZ + 1e-6
  }
  // Unknown (e.g. loaded GLB) — bbox fallback
  return p.x >= bb.min.x && p.x <= bb.max.x && p.z >= bb.min.z && p.z <= bb.max.z
}

function recomputeVolume() {
  const occupied = new Set()
  const inv = new THREE.Matrix4()
  const tmp = new THREE.Vector3()
  for (const mesh of placed) {
    mesh.updateMatrixWorld()
    mesh.geometry.computeBoundingBox()
    const localBB = mesh.geometry.boundingBox
    const worldBB = localBB.clone().applyMatrix4(mesh.matrixWorld)
    const minX = Math.floor(worldBB.min.x / VOXEL_STEP)
    const maxX = Math.ceil(worldBB.max.x / VOXEL_STEP)
    const minY = Math.floor(worldBB.min.y / VOXEL_STEP)
    const maxY = Math.ceil(worldBB.max.y / VOXEL_STEP)
    const minZ = Math.floor(worldBB.min.z / VOXEL_STEP)
    const maxZ = Math.ceil(worldBB.max.z / VOXEL_STEP)
    inv.copy(mesh.matrixWorld).invert()
    const tool = mesh.userData && mesh.userData.tool
    for (let ix = minX; ix < maxX; ix++) {
      for (let iy = minY; iy < maxY; iy++) {
        for (let iz = minZ; iz < maxZ; iz++) {
          tmp.set((ix + 0.5) * VOXEL_STEP, (iy + 0.5) * VOXEL_STEP, (iz + 0.5) * VOXEL_STEP)
          tmp.applyMatrix4(inv)
          if (pointInLocalShape(tmp, tool, localBB)) {
            occupied.add(ix + ',' + iy + ',' + iz)
          }
        }
      }
    }
  }
  volumeM3.value = occupied.size * VOXEL_VOL
}

function clearAll() {
  clearHoverHighlight()
  for (const o of placed) {
    scene.remove(o)
    o.geometry.dispose()
    if (Array.isArray(o.material)) o.material.forEach(m => m.dispose())
    else o.material.dispose()
  }
  placed = []
  objectCount.value = 0
  volumeM3.value = 0
  applyDefaultGroundTexture()
  needsRender = true
}

function captureScreenshot(maxSize = 512) {
  // Render with extra vertical room so tall objects don't get clipped.
  const extraH = 285
  const width = maxSize
  const height = maxSize + extraH
  const rollVis = rollover ? rollover.visible : false
  if (rollover) rollover.visible = false
  const gridVis = gridHelper.visible
  gridHelper.visible = false
  const planeStartVis = plane.visible
  clearHoverHighlight()

  // Transparent background for export
  const prevBg = scene.background
  scene.background = null
  const prevClear = new THREE.Color()
  const prevClearAlpha = renderer.getClearAlpha()
  renderer.getClearColor(prevClear)
  renderer.setClearColor(0x000000, 0)

  const prevSize = new THREE.Vector2()
  renderer.getSize(prevSize)
  const prevPR = renderer.getPixelRatio()
  // Snapshot live-view frustum + canvas size BEFORE we resize/refit the camera.
  // We need this to map noise-mask pixels (painted in the live canvas) into
  // the screenshot's camera/pixel space.
  const liveFrustum = { l: camera.left, r: camera.right, t: camera.top, b: camera.bottom }
  const liveSize = { w: prevSize.x * prevPR, h: prevSize.y * prevPR }

  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  const prev = { l: camera.left, r: camera.right, t: camera.top, b: camera.bottom }
  // Use tight zoom (1.0) for screenshot so plane tips touch the canvas edges -> clean crop
  // and output exactly fills a phaser tile. Live view zoom is separate.
  fitCamera(width, height, 1.0)

  // Helper: scan alpha buffer of current renderer output to find opaque bbox.
  const scanBbox = () => {
    const c = renderer.domElement
    const tmp = document.createElement('canvas')
    tmp.width = c.width; tmp.height = c.height
    tmp.getContext('2d').drawImage(c, 0, 0)
    const data = tmp.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let nX = c.width, mX = -1, nY = c.height, mY = -1
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (data[(y * c.width + x) * 4 + 3] > 8) {
          if (x < nX) nX = x
          if (x > mX) mX = x
          if (y < nY) nY = y
          if (y > mY) mY = y
        }
      }
    }
    return { minX: nX, maxX: mX, minY: nY, maxY: mY }
  }

  // Pass 1: plane + grid only (objects hidden). Gives left/right/bottom bbox.
  const placedPrevVis = placed.map(o => o.visible)
  for (const o of placed) o.visible = false
  renderer.render(scene, camera)
  const planeBbox = scanBbox()
  for (let i = 0; i < placed.length; i++) placed[i].visible = placedPrevVis[i]

  // Pass 2: objects only (plane + grid hidden). Gives top Y.
  const planePrevVis = plane.visible
  plane.visible = false
  const gridStillVis = gridHelper.visible // already false from earlier
  renderer.render(scene, camera)
  const objBbox = scanBbox()
  plane.visible = planePrevVis
  gridHelper.visible = gridStillVis

  // Final pass: hide plane if user opted out, but crop bbox stays plane-sized.
  if (!includeGround.value) plane.visible = false
  renderer.render(scene, camera)

  const srcCanvas = renderer.domElement
  let minX, maxX, minY, maxY
  if (planeBbox.maxX >= 0) {
    minX = planeBbox.minX; maxX = planeBbox.maxX
    minY = planeBbox.minY; maxY = planeBbox.maxY
    if (objBbox.maxX >= 0 && objBbox.minY < minY) minY = objBbox.minY
  } else if (objBbox.maxX >= 0) {
    minX = objBbox.minX; maxX = objBbox.maxX
    minY = objBbox.minY; maxY = objBbox.maxY
  } else {
    minX = 0; maxX = srcCanvas.width - 1; minY = 0; maxY = srcCanvas.height - 1
  }
  minX = Math.max(0, Math.floor(minX))
  minY = Math.max(0, Math.floor(minY))
  maxX = Math.min(srcCanvas.width - 1, Math.ceil(maxX))
  maxY = Math.min(srcCanvas.height - 1, Math.ceil(maxY))
  const cw = maxX - minX + 1
  const ch = maxY - minY + 1

  // Output: width capped at maxSize, height capped at maxSize+extraH.
  const scale = Math.min(maxSize / cw, (maxSize + extraH) / ch)
  const outW = Math.max(1, Math.round(cw * scale))
  const outH = Math.max(1, Math.round(ch * scale))
  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const octx = out.getContext('2d')
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(srcCanvas, minX, minY, cw, ch, 0, 0, outW, outH)

  // Two additive overlays composed on top of the textured screenshot — both
  // preserve original textures because we draw on top of an already-finalised
  // image of the scene:
  //   1) Face grid first (follows UVs; signals curved vs flat surfaces).
  //   2) Intersection edges last so they sit visually on top of the grid.
  if (props.gridOverlay) {
    drawFaceGrid(octx, outW, outH, minX, minY, cw, ch, props.faceGridThickness)
    drawInterObjectEdges(octx, outW, outH, minX, minY, cw, ch, props.gridThickness)
  }

  const dataUrl = out.toDataURL('image/png')

  // ----- Build aligned noise mask matching this screenshot's view + crop -----
  // Both cameras (live + screenshot) are orthographic, share position/orientation,
  // and only differ in frustum bounds + viewport size, so the live→screenshot
  // pixel mapping is a uniform scale+translate. Project the screenshot crop
  // rect back to live-canvas pixels, sample the noise canvas there, and resize
  // to outW × outH so it perfectly aligns with the returned image.
  alignedNoiseMaskDataUrl = null
  const nc = noiseCanvas.value
  if (nc && nc.width > 0 && nc.height > 0 && hasNoiseMask()) {
    try {
      const shotL = camera.left, shotR = camera.right, shotT = camera.top, shotB = camera.bottom
      const shotW = width, shotH = height
      // Screenshot pixel → world (camera-space):
      const worldX = (px) => shotL + (px / shotW) * (shotR - shotL)
      const worldY = (py) => shotT - (py / shotH) * (shotT - shotB)
      // World → live pixel:
      const liveLW = liveFrustum.r - liveFrustum.l
      const liveLH = liveFrustum.t - liveFrustum.b
      const liveX = (wx) => ((wx - liveFrustum.l) / liveLW) * liveSize.w
      const liveY = (wy) => ((liveFrustum.t - wy) / liveLH) * liveSize.h
      const lx0 = liveX(worldX(minX))
      const lx1 = liveX(worldX(maxX + 1))
      const ly0 = liveY(worldY(minY))
      const ly1 = liveY(worldY(maxY + 1))
      const sx = Math.min(lx0, lx1)
      const sy = Math.min(ly0, ly1)
      const sw = Math.abs(lx1 - lx0)
      const sh = Math.abs(ly1 - ly0)
      // Render mask aligned + cropped to the same outW × outH as the image.
      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = outW
      maskCanvas.height = outH
      const mctx = maskCanvas.getContext('2d')
      mctx.imageSmoothingEnabled = true
      mctx.imageSmoothingQuality = 'high'
      mctx.drawImage(nc, sx, sy, sw, sh, 0, 0, outW, outH)
      // Convert RGBA-with-pink-alpha into a grayscale (alpha→luma) mask so the
      // backend can use it as a per-pixel weight.
      const md = mctx.getImageData(0, 0, outW, outH)
      let any = false
      for (let i = 0; i < md.data.length; i += 4) {
        const a = md.data[i + 3]
        if (a > 8) any = true
        md.data[i] = a; md.data[i + 1] = a; md.data[i + 2] = a; md.data[i + 3] = 255
      }
      if (any) {
        mctx.putImageData(md, 0, 0)
        alignedNoiseMaskDataUrl = maskCanvas.toDataURL('image/png')
      }
    } catch (e) {
      console.warn('Failed to align noise mask to screenshot:', e)
      alignedNoiseMaskDataUrl = null
    }
  }

  camera.left = prev.l; camera.right = prev.r; camera.top = prev.t; camera.bottom = prev.b
  camera.updateProjectionMatrix()
  renderer.setPixelRatio(prevPR)
  renderer.setSize(prevSize.x, prevSize.y, false)
  if (rollover) rollover.visible = rollVis
  gridHelper.visible = gridVis
  plane.visible = planeStartVis
  scene.background = prevBg
  renderer.setClearColor(prevClear, prevClearAlpha)
  needsRender = true
  renderer.render(scene, camera)
  return dataUrl
}

defineExpose({ captureScreenshot, clearAll, getNoiseMask, clearNoiseMask, hasNoiseMask })

// ----- Noise mask painting overlay -----
// A 2D canvas the same size as the WebGL canvas. When the 'noisepaint' tool is
// active, pointer events are captured by this overlay and the user paints a
// soft mask. The mask can be exported as a binary PNG (white = noise area).
function syncNoiseCanvas() {
  if (!noiseCanvas.value || !renderer) return
  const w = renderer.domElement.width
  const h = renderer.domElement.height
  const c = noiseCanvas.value
  if (c.width === w && c.height === h) return
  const tmp = document.createElement('canvas')
  tmp.width = c.width || 1; tmp.height = c.height || 1
  if (c.width && c.height) tmp.getContext('2d').drawImage(c, 0, 0)
  c.width = w; c.height = h
  if (tmp.width > 1 && tmp.height > 1) {
    c.getContext('2d').drawImage(tmp, 0, 0, w, h)
  }
}

function noisePointerToCanvas(e) {
  const c = noiseCanvas.value
  const rect = c.getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * c.width
  const y = ((e.clientY - rect.top) / rect.height) * c.height
  return { x, y }
}

function paintNoiseAt(p) {
  const c = noiseCanvas.value
  if (!c) return
  const ctx = c.getContext('2d')
  // Soft brush: radial gradient so multiple strokes blend like a paint can.
  const r = noiseBrushSize.value
  const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r)
  grad.addColorStop(0, 'rgba(255, 80, 200, 0.55)')
  grad.addColorStop(1, 'rgba(255, 80, 200, 0)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  ctx.fill()
}

function onNoisePointerDown(e) {
  if (activeTool.value !== 'noisepaint' || e.button !== 0) return
  noisePainting = true
  syncNoiseCanvas()
  paintNoiseAt(noisePointerToCanvas(e))
  try { noiseCanvas.value.setPointerCapture(e.pointerId) } catch (_) {}
}
function onNoisePointerMove(e) {
  if (!noisePainting) return
  paintNoiseAt(noisePointerToCanvas(e))
}
function onNoisePointerUp(e) {
  if (!noisePainting) return
  noisePainting = false
  try { noiseCanvas.value.releasePointerCapture(e.pointerId) } catch (_) {}
}

function hasNoiseMask() {
  const c = noiseCanvas.value
  if (!c || !c.width || !c.height) return false
  const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 8) return true
  }
  return false
}

function clearNoiseMask() {
  const c = noiseCanvas.value
  if (!c) return
  c.getContext('2d').clearRect(0, 0, c.width, c.height)
}

// Return a binary mask data URL (white = paint, black = no paint), or null if empty.
// Threshold on alpha so soft brush edges feather gracefully.
function getNoiseMask() {
  // Prefer the version aligned to the most recent screenshot (correct pixel
  // coordinates for img2img). Fall back to raw canvas if no screenshot was
  // taken yet.
  if (alignedNoiseMaskDataUrl) return alignedNoiseMaskDataUrl
  const c = noiseCanvas.value
  if (!c || !c.width || !c.height) return null
  const src = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let any = false
  const out = document.createElement('canvas')
  out.width = c.width; out.height = c.height
  const octx = out.getContext('2d')
  const idata = octx.createImageData(c.width, c.height)
  for (let i = 0; i < src.length; i += 4) {
    // Map alpha 0..255 to grayscale value (preserves brush softness).
    const v = src[i + 3]
    if (v > 8) any = true
    idata.data[i] = v
    idata.data[i + 1] = v
    idata.data[i + 2] = v
    idata.data[i + 3] = 255
  }
  if (!any) return null
  octx.putImageData(idata, 0, 0)
  return out.toDataURL('image/png')
}

onMounted(() => {
  init()
  // Wire pointer handlers to the noise overlay canvas (CSS controls when it's
  // interactive via pointer-events). Sync size to match WebGL canvas.
  if (noiseCanvas.value) {
    syncNoiseCanvas()
    noiseCanvas.value.addEventListener('pointerdown', onNoisePointerDown)
    noiseCanvas.value.addEventListener('pointermove', onNoisePointerMove)
    noiseCanvas.value.addEventListener('pointerup', onNoisePointerUp)
    noiseCanvas.value.addEventListener('pointercancel', onNoisePointerUp)
    noiseCanvas.value.addEventListener('contextmenu', (e) => e.preventDefault())
  }
})
onBeforeUnmount(() => {
  if (animId) cancelAnimationFrame(animId)
  if (resizeObserver) resizeObserver.disconnect()
  if (renderer) {
    const dom = renderer.domElement
    dom.removeEventListener('pointermove', onPointerMove)
    dom.removeEventListener('pointerleave', onPointerLeave)
    dom.removeEventListener('pointerdown', onPointerDown)
    renderer.dispose()
    if (dom.parentNode) dom.parentNode.removeChild(dom)
  }
})
</script>

<template>
  <div class="editor3d-wrap">
    <div class="editor3d-sidebar">
      <div
        v-for="t in TOOLS"
        :key="t.id"
        class="tool-cell"
      >
        <div v-if="['roof','cylinder','sphere','arch'].includes(t.id)" class="corner-row">
          <button
            v-if="t.id === 'roof'"
            type="button"
            class="corner-btn"
            :class="{ active: roofRotated }"
            title="Otočiť strechu"
            @click.stop="roofRotated = !roofRotated; rebuildRollover()"
          >↻</button>
          <button
            v-if="t.id === 'cylinder'"
            type="button"
            class="corner-btn"
            :class="{ active: cylinderSide }"
            title="Položiť dopredu"
            @click.stop="cylinderSide = !cylinderSide; rebuildRollover()"
          >⤿</button>
          <button
            v-if="t.id === 'cylinder'"
            type="button"
            class="corner-btn"
            :class="{ active: cylinderSideRight }"
            title="Položiť doprava"
            @click.stop="cylinderSideRight = !cylinderSideRight; rebuildRollover()"
          >⤾</button>
          <button
            v-if="t.id === 'arch'"
            type="button"
            class="corner-btn"
            :class="{ active: archRotated }"
            title="Otočiť oblúk"
            @click.stop="archRotated = !archRotated; rebuildRollover()"
          >↻</button>
          <button
            v-if="t.id === 'sphere'"
            type="button"
            class="corner-btn"
            :class="{ active: sphereDome }"
            title="Polovica gule (kupola)"
            @click.stop="sphereDome = !sphereDome; rebuildRollover()"
          >◐</button>
        </div>
      <button
        :class="['tool-btn', { active: activeTool === t.id, erase: t.id === 'erase' }]"
        @click="selectTool(t.id)"
        type="button"
        :title="t.label"
      >
        <svg v-if="t.id === 'cube'" viewBox="0 0 40 40" class="tool-ico">
          <polygon points="20,6 34,14 34,30 20,38 6,30 6,14" fill="none" stroke="currentColor" stroke-width="2"/>
          <line x1="20" y1="6" x2="20" y2="22" stroke="currentColor" stroke-width="2"/>
          <line x1="20" y1="22" x2="6" y2="14" stroke="currentColor" stroke-width="2"/>
          <line x1="20" y1="22" x2="34" y2="14" stroke="currentColor" stroke-width="2"/>
        </svg>
        <svg v-else-if="t.id === 'pyramid'" viewBox="0 0 40 40" class="tool-ico">
          <polygon points="20,6 34,30 6,30" fill="none" stroke="currentColor" stroke-width="2"/>
          <line x1="20" y1="6" x2="20" y2="30" stroke="currentColor" stroke-width="2"/>
          <ellipse cx="20" cy="30" rx="14" ry="4" fill="none" stroke="currentColor" stroke-width="2"/>
        </svg>
        <svg v-else-if="t.id === 'roof'" viewBox="0 0 40 40" class="tool-ico">
          <polygon points="6,26 20,10 34,26 34,32 20,16 6,32" fill="none" stroke="currentColor" stroke-width="2"/>
          <line x1="6" y1="26" x2="6" y2="32" stroke="currentColor" stroke-width="2"/>
          <line x1="34" y1="26" x2="34" y2="32" stroke="currentColor" stroke-width="2"/>
        </svg>
        <svg v-else-if="t.id === 'cone'" viewBox="0 0 40 40" class="tool-ico">
          <path d="M20 6 L34 32 Q20 38 6 32 Z" fill="none" stroke="currentColor" stroke-width="2"/>
          <ellipse cx="20" cy="32" rx="14" ry="4" fill="none" stroke="currentColor" stroke-width="2"/>
        </svg>
        <svg v-else-if="t.id === 'cylinder'" viewBox="0 0 40 40" class="tool-ico">
          <ellipse cx="20" cy="10" rx="12" ry="4" fill="none" stroke="currentColor" stroke-width="2"/>
          <path d="M8 10 L8 30 Q8 34 20 34 Q32 34 32 30 L32 10" fill="none" stroke="currentColor" stroke-width="2"/>
        </svg>
        <svg v-else-if="t.id === 'arch'" viewBox="0 0 40 40" class="tool-ico">
          <path d="M6 30 Q6 12 20 12 Q34 12 34 30 L34 32 L6 32 Z" fill="none" stroke="currentColor" stroke-width="2"/>
          <ellipse cx="20" cy="12" rx="14" ry="3" fill="none" stroke="currentColor" stroke-width="1.5"/>
        </svg>
        <svg v-else-if="t.id === 'sphere'" viewBox="0 0 40 40" class="tool-ico">
          <circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" stroke-width="2"/>
          <ellipse cx="20" cy="20" rx="14" ry="5" fill="none" stroke="currentColor" stroke-width="1.5"/>
          <ellipse cx="20" cy="20" rx="5" ry="14" fill="none" stroke="currentColor" stroke-width="1.5"/>
        </svg>
        <svg v-else-if="t.id === 'paint'" viewBox="0 0 40 40" class="tool-ico">
          <path d="M8 14 L24 6 L34 14 L18 22 Z" fill="none" stroke="currentColor" stroke-width="2"/>
          <path d="M18 22 L18 32 Q26 36 34 32 L34 14" fill="none" stroke="currentColor" stroke-width="2"/>
          <path d="M34 20 Q38 26 34 30 Q30 26 34 20 Z" :fill="activeTool === 'paint' ? paintColor : 'none'" stroke="currentColor" stroke-width="2"/>
        </svg>
        <svg v-else-if="t.id === 'erase'" viewBox="0 0 40 40" class="tool-ico">
          <path d="M6 28 L22 12 L32 22 L16 38 L6 38 Z" fill="none" stroke="currentColor" stroke-width="2"/>
          <line x1="16" y1="38" x2="32" y2="22" stroke="currentColor" stroke-width="2"/>
        </svg>
        <svg v-else-if="t.id === 'noisepaint'" viewBox="0 0 40 40" class="tool-ico">
          <circle cx="20" cy="20" r="13" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/>
          <circle cx="14" cy="16" r="1.6" fill="currentColor"/>
          <circle cx="24" cy="14" r="1.6" fill="currentColor"/>
          <circle cx="18" cy="22" r="1.6" fill="currentColor"/>
          <circle cx="26" cy="24" r="1.6" fill="currentColor"/>
          <circle cx="14" cy="26" r="1.6" fill="currentColor"/>
        </svg>
      </button>
      </div>
      <div v-if="activeTool === 'paint'" class="paint-wrap">
        <button
          type="button"
          class="paint-swatch-btn"
          :title="'Paint fill'"
          @click="paintPopupOpen = !paintPopupOpen"
        >
          <span
            v-if="paintMode === 'color'"
            class="swatch-fill"
            :style="{ background: paintColor }"
          ></span>
          <img
            v-else-if="paintMode === 'texture' && paintTexture"
            class="swatch-fill"
            :src="paintTexture"
            alt=""
          />
        </button>
        <div v-if="paintPopupOpen" class="paint-popup" @click.stop>
          <label class="paint-popup-color">
            <input
              type="color"
              :value="paintColor"
              @change="paintColor = $event.target.value; paintMode = 'color'; paintPopupOpen = false"
              @input="paintColor = $event.target.value; paintMode = 'color'"
            />
            <span>Farba</span>
          </label>
          <div class="paint-popup-tex-grid">
            <button
              v-for="t in paintTextures"
              :key="t.url"
              type="button"
              :class="['paint-tex', { active: paintMode === 'texture' && paintTexture === t.url }]"
              :title="t.label"
              @click="paintMode = 'texture'; paintTexture = t.url; paintPopupOpen = false"
            >
              <img :src="t.url" alt="" @error="(e) => e.target.style.opacity = 0.2" />
            </button>
          </div>
        </div>
      </div>
      <button class="tool-btn download-btn" @click="$refs.loadInput.click()" type="button" title="Load .glb/.gltf">
        <svg viewBox="0 0 40 40" class="tool-ico">
          <path d="M20 30 L20 10" stroke="currentColor" stroke-width="2" fill="none"/>
          <path d="M12 18 L20 10 L28 18" stroke="currentColor" stroke-width="2" fill="none"/>
          <path d="M8 32 L32 32" stroke="currentColor" stroke-width="2" fill="none"/>
        </svg>
      </button>
      <input
        ref="loadInput"
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        style="display:none"
        @change="(e) => { loadModelFile(e.target.files[0]); e.target.value = '' }"
      />
      <button class="tool-btn download-btn" @click="downloadModel" type="button" title="Download .glb">
        <svg viewBox="0 0 40 40" class="tool-ico">
          <path d="M20 6 L20 26" stroke="currentColor" stroke-width="2" fill="none"/>
          <path d="M12 20 L20 28 L28 20" stroke="currentColor" stroke-width="2" fill="none"/>
          <path d="M8 32 L32 32" stroke="currentColor" stroke-width="2" fill="none"/>
        </svg>
      </button>
      <button class="tool-btn clear-btn" @click="clearAll" type="button" title="Clear all">
        <span class="tool-label">Clear</span>
      </button>
    </div>
    <div class="editor3d-stage">
      <div class="editor3d-sizebar">
        <template v-if="activeTool === 'paint'">
          <button
            v-for="ps in PAINT_SIZES"
            :key="ps"
            :class="['size-btn', { active: paintSize === ps }]"
            @click="paintSize = ps"
            type="button"
          >{{ typeof ps === 'number' ? `${ps}×${ps}` : 'Fill' }}</button>
        </template>
        <template v-else-if="activeTool === 'noisepaint'">
          <button
            v-for="(s, i) in NOISE_BRUSH_SIZES"
            :key="s"
            :class="['size-btn', { active: noiseBrushSize === s }]"
            @click="noiseBrushSize = s"
            type="button"
            :title="`Brush ${s}px`"
          >{{ NOISE_BRUSH_LABELS[i] }}</button>
          <button class="size-btn" @click="clearNoiseMask" type="button" title="Clear noise mask">Clear</button>
        </template>
        <template v-else>
          <button
            v-for="n in SIZES"
            :key="n"
            :class="['size-btn', { active: activeSize === n }]"
            :disabled="activeTool === 'erase'"
            @click="selectSize(n)"
            type="button"
          >{{ n }}×{{ n }}</button>
        </template>
      </div>
      <div class="editor3d-canvas-wrap">
        <div ref="container" class="editor3d-canvas"></div>
        <canvas
          ref="noiseCanvas"
          class="noise-overlay"
          :class="{ active: activeTool === 'noisepaint' }"
        ></canvas>
        <div v-if="hasApex(activeTool)" class="apex-slider" :title="'Apex height: ' + apexHeight.toFixed(2) + '×'">
          <input
            type="range"
            min="0.3"
            max="2.5"
            step="0.05"
            :value="apexHeight"
            @input="onApexHeightChange($event.target.value)"
            class="apex-range"
          />
          <span class="apex-val">{{ apexHeight.toFixed(2) }}×</span>
        </div>
      </div>
      <div class="editor3d-hint">
        <span>Tool: <strong>{{ TOOLS.find(t => t.id === activeTool)?.label }}</strong> &middot; Size: <strong>{{ activeSize }}×{{ activeSize }}</strong></span>
        <label class="ground-toggle">
          <input type="checkbox" v-model="includeGround" />
          <span>Podklad v preview</span>
        </label>

        <span>Volume: {{ volumeM3.toFixed(2) }} m³</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor3d-wrap {
  display: flex;
  width: 100%;
  height: 100%;
  gap: 0.5rem;
}
.editor3d-sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  width: 68px;
  flex-shrink: 0;
}
.tool-cell {
  position: relative;
  display: block;
}
.corner-row {
  position: absolute;
  top: -2px;
  left: -2px;
  right: -2px;
  z-index: 2;
  display: flex;
  justify-content: space-between;
  pointer-events: none;
}
.corner-btn {
  pointer-events: auto;
  width: 18px;
  height: 18px;
  padding: 0;
  font-size: 11px;
  line-height: 1;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.3);
  background: rgba(20,20,40,0.9);
  color: rgba(255,255,255,0.85);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.corner-btn:hover { background: rgba(102,126,234,0.45); }
.corner-btn.active {
  background: rgba(102,126,234,0.7);
  border-color: rgba(102,126,234,0.9);
  color: #fff;
}
.tool-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  gap: 2px;
  padding: 6px 4px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  color: rgba(255,255,255,0.7);
  cursor: pointer;
  transition: all 0.15s;
}
.tool-btn:hover {
  background: rgba(102,126,234,0.2);
  color: #fff;
}
.tool-btn.active {
  background: rgba(102,126,234,0.4);
  border-color: rgba(102,126,234,0.7);
  color: #fff;
}
.tool-btn.erase.active {
  background: rgba(255,68,68,0.35);
  border-color: rgba(255,68,68,0.7);
}
.tool-ico {
  width: 28px;
  height: 28px;
}
.tool-label {
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.clear-btn {
  margin-top: auto;
  padding: 8px 4px;
  color: rgba(255,255,255,0.55);
}
.editor3d-stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}
.editor3d-sizebar {
  display: flex;
  gap: 0.35rem;
}
.size-btn {
  flex: 1;
  padding: 0.35rem 0.4rem;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 5px;
  color: rgba(255,255,255,0.7);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.size-btn:hover:not(:disabled) {
  background: rgba(102,126,234,0.2);
  color: #fff;
}
.size-btn.active {
  background: rgba(102,126,234,0.4);
  border-color: rgba(102,126,234,0.7);
  color: #fff;
}
.size-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.editor3d-canvas-wrap {
  position: relative;
  flex: 1;
  display: flex;
  min-height: 260px;
}
.editor3d-canvas {
  flex: 1;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.15);
  background: #1a1a2e;
}
.apex-slider {
  position: absolute;
  right: 8px;
  top: 12px;
  bottom: 12px;
  width: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 6px 4px;
  background: rgba(20,20,40,0.7);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 6px;
}
.apex-range {
  flex: 1;
  writing-mode: vertical-lr;
  direction: rtl;
  -webkit-appearance: slider-vertical;
  appearance: slider-vertical;
  width: 20px;
  cursor: pointer;
}
.apex-val {
  font-size: 0.62rem;
  color: rgba(255,255,255,0.8);
  font-weight: 600;
}
.noise-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 5;
  cursor: crosshair;
  /* Mask preview tint when active */
}
.noise-overlay.active {
  pointer-events: auto;
  outline: 2px dashed rgba(255, 80, 200, 0.6);
  outline-offset: -4px;
}
.editor3d-canvas :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
.editor3d-hint {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: rgba(255,255,255,0.55);
  padding: 0 0.2rem;
}
.editor3d-hint strong { color: #fff; }
.ground-toggle {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  cursor: pointer;
  user-select: none;
}
.ground-toggle input { cursor: pointer; }
.paint-wrap {
  position: relative;
}
.paint-swatch-btn {
  width: 100%;
  height: 44px;
  padding: 4px;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 6px;
  background: rgba(255,255,255,0.05);
  cursor: pointer;
  overflow: hidden;
}
.paint-swatch-btn .swatch-fill {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 4px;
  object-fit: cover;
}
.paint-popup {
  position: absolute;
  left: calc(100% + 6px);
  top: 0;
  z-index: 10;
  width: 220px;
  padding: 8px;
  background: rgba(20,20,40,0.96);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
}
.paint-popup-color {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(255,255,255,0.8);
  font-size: 0.75rem;
  cursor: pointer;
}
.paint-popup-color input[type="color"] {
  width: 44px;
  height: 32px;
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  padding: 2px;
}
.paint-popup-tex-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}
.paint-tex {
  padding: 0;
  width: 100%;
  aspect-ratio: 1;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  background: rgba(255,255,255,0.05);
}
.paint-tex img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.paint-tex.active {
  border-color: rgba(102,126,234,0.9);
  box-shadow: 0 0 0 1px rgba(102,126,234,0.5);
}
</style>
