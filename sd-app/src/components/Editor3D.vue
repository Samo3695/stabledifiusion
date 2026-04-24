<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'

const props = defineProps({
  gridSize: { type: Number, default: 10 },
  cellSize: { type: Number, default: 1 },
  // Extra textures (data URLs or URLs) passed from parent — e.g. begin.json textureSettings.customTexture
  customTextures: { type: Array, default: () => [] }
})

const container = ref(null)
const objectCount = ref(0)
const activeTool = ref('cube')
const activeSize = ref(1)
const includeGround = ref(true)
const paintColor = ref('#e07a3a')
const paintMode = ref('color') // 'color' | 'texture'
const paintTexture = ref(null) // resolved URL/dataURL when mode=texture
const paintPopupOpen = ref(false)
const BASE_URL = import.meta.env.BASE_URL
const PAINT_TEXTURE_FILES = ['concrate.png', 'concratedark.png', 'grass.jpg', 'grass.png', 'water.png']
const paintTextures = computed(() => {
  const builtin = PAINT_TEXTURE_FILES.map(f => ({ url: `${BASE_URL}templates/textures/${f}`, label: f }))
  const custom = (props.customTextures || []).map((u, i) => ({ url: u, label: `custom-${i + 1}` }))
  return [...builtin, ...custom]
})
const loadedPaintTextures = {} // cache THREE.Texture by URL
const apexHeight = ref(1) // height multiplier for pyramid/cone/roof (0.3–2.5)

const SIZES = [1, 2, 3, 4, 5]
const TOOLS = [
  { id: 'cube',     label: 'Cube'    },
  { id: 'pyramid',  label: 'Pyramid' },
  { id: 'roof',     label: 'Roof'    },
  { id: 'roof90',   label: 'Roof 90' },
  { id: 'cone',     label: 'Cone'    },
  { id: 'cylinder', label: 'Cylinder'},
  { id: 'paint',    label: 'Paint'   },
  { id: 'erase',    label: 'Erase'   }
]

// Footprint in grid cells (width on X, depth on Z) for each tool at the current size.
function footprint(tool, n) {
  return { w: n, d: n }
}

let scene, camera, renderer, raycaster, pointer
let plane, gridHelper
let placed = []
let rollover
let hoverTarget = null
let hoverOriginalColor = null
let resizeObserver
let animId
let needsRender = true
let stoneTexture = null

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
    case 'roof':
    case 'roof90':   return makeRoofGeometry(s, s, h, -s / 2)
    case 'cone': {
      const geo = new THREE.ConeGeometry(s * 0.5, h, 32)
      geo.translate(0, (h - s) / 2, 0)
      return geo
    }
    case 'cylinder': return new THREE.CylinderGeometry(s * 0.5, s * 0.5, s, 32)
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
  scene.add(new THREE.AmbientLight(0xffffff, 0.35))
  const key = new THREE.DirectionalLight(0xffffff, 1.3)
  // Light in upper-right of screen → shadows cast toward lower-left.
  key.position.set(10, 14, -4)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  const shadowRange = props.gridSize * props.cellSize
  const cam = key.shadow.camera
  cam.left = -shadowRange; cam.right = shadowRange
  cam.top = shadowRange; cam.bottom = -shadowRange
  cam.near = 0.5; cam.far = shadowRange * 4
  key.shadow.bias = -0.0005
  key.shadow.radius = 2
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

  rebuildRollover()

  raycaster = new THREE.Raycaster()
  pointer = new THREE.Vector2()

  const dom = renderer.domElement
  dom.addEventListener('pointermove', onPointerMove)
  dom.addEventListener('pointerleave', onPointerLeave)
  dom.addEventListener('pointerdown', onPointerDown)
  dom.addEventListener('contextmenu', (e) => e.preventDefault())

  resizeObserver = new ResizeObserver(() => { onResize(); needsRender = true })
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
  if (activeTool.value === 'erase' || activeTool.value === 'paint') return
  const geo = makeGeometry(activeTool.value, props.cellSize, activeSize.value)
  const mat = new THREE.MeshBasicMaterial({ color: ROLLOVER_COLOR, opacity: 0.45, transparent: true, depthWrite: false })
  rollover = new THREE.Mesh(geo, mat)
  if (activeTool.value === 'roof90') rollover.rotation.y = Math.PI / 2
  rollover.visible = false
  scene.add(rollover)
  needsRender = true
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

function paintFace(hit) {
  const obj = hit.object
  const idx = hit.face && hit.face.materialIndex != null ? hit.face.materialIndex : 0
  let mat
  if (Array.isArray(obj.material)) {
    mat = obj.material[idx] || obj.material[0]
  } else {
    mat = obj.material
  }
  if (paintMode.value === 'texture' && paintTexture.value) {
    const srcTex = getPaintTexture(paintTexture.value)
    const tex = srcTex.clone()
    tex.needsUpdate = true
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.colorSpace = THREE.SRGBColorSpace
    const n = obj.userData && obj.userData.size ? obj.userData.size : 1
    tex.repeat.set(n, n)
    mat.map = tex
    mat.color.setHex(0xffffff)
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
      const fi = hit.face && hit.face.materialIndex != null ? hit.face.materialIndex : 0
      const hex = paintMode.value === 'texture' ? ROLLOVER_COLOR : new THREE.Color(paintColor.value).getHex()
      setHoverHighlight(hit.object, hex, fi)
    }
    needsRender = true
    return
  }

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
  if (activeTool.value === 'roof90') mesh.rotation.y = Math.PI / 2
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
  return tool === 'pyramid' || tool === 'cone' || tool === 'roof' || tool === 'roof90'
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
  needsRender = true
}

function captureScreenshot(maxSize = 512) {
  // Render at a large square internally, then crop + fit to aspect of visible content.
  const width = maxSize
  const height = maxSize
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

  // Output canvas matches the cropped aspect ratio, scaled so the longer side = maxSize.
  const scale = maxSize / Math.max(cw, ch)
  const outW = Math.max(1, Math.round(cw * scale))
  const outH = Math.max(1, Math.round(ch * scale))
  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const octx = out.getContext('2d')
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(srcCanvas, minX, minY, cw, ch, 0, 0, outW, outH)
  const dataUrl = out.toDataURL('image/png')

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

defineExpose({ captureScreenshot, clearAll })

onMounted(() => { init() })
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
      <button
        v-for="t in TOOLS"
        :key="t.id"
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
        <svg v-else-if="t.id === 'roof90'" viewBox="0 0 40 40" class="tool-ico">
          <g transform="rotate(90 20 20)">
            <polygon points="6,26 20,10 34,26 34,32 20,16 6,32" fill="none" stroke="currentColor" stroke-width="2"/>
            <line x1="6" y1="26" x2="6" y2="32" stroke="currentColor" stroke-width="2"/>
            <line x1="34" y1="26" x2="34" y2="32" stroke="currentColor" stroke-width="2"/>
          </g>
        </svg>
        <svg v-else-if="t.id === 'cone'" viewBox="0 0 40 40" class="tool-ico">
          <path d="M20 6 L34 32 Q20 38 6 32 Z" fill="none" stroke="currentColor" stroke-width="2"/>
          <ellipse cx="20" cy="32" rx="14" ry="4" fill="none" stroke="currentColor" stroke-width="2"/>
        </svg>
        <svg v-else-if="t.id === 'cylinder'" viewBox="0 0 40 40" class="tool-ico">
          <ellipse cx="20" cy="10" rx="12" ry="4" fill="none" stroke="currentColor" stroke-width="2"/>
          <path d="M8 10 L8 30 Q8 34 20 34 Q32 34 32 30 L32 10" fill="none" stroke="currentColor" stroke-width="2"/>
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
        <span class="tool-label">{{ t.label }}</span>
      </button>
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
              @click="paintMode = 'texture'; paintTexture = t.url"
            >
              <img :src="t.url" alt="" @error="(e) => e.target.style.opacity = 0.2" />
            </button>
          </div>
        </div>
      </div>
      <button class="tool-btn clear-btn" @click="clearAll" type="button" title="Clear all">
        <span class="tool-label">Clear</span>
      </button>
    </div>
    <div class="editor3d-stage">
      <div class="editor3d-sizebar">
        <button
          v-for="n in SIZES"
          :key="n"
          :class="['size-btn', { active: activeSize === n }]"
          :disabled="activeTool === 'erase' || activeTool === 'paint'"
          @click="selectSize(n)"
          type="button"
        >{{ n }}×{{ n }}</button>
      </div>
      <div class="editor3d-canvas-wrap">
        <div ref="container" class="editor3d-canvas"></div>
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
        <span>Objects: {{ objectCount }}</span>
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
.tool-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
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
