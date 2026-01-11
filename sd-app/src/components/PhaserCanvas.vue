<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import Phaser from 'phaser'

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
  },
  templateSelected: {
    type: Boolean,
    default: false
  },
  showNumbering: {
    type: Boolean,
    default: true
  },
  showGallery: {
    type: Boolean,
    default: true
  },
  showGrid: {
    type: Boolean,
    default: true
  },
  deleteMode: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['cell-selected', 'image-placed', 'toggle-numbering', 'toggle-gallery', 'toggle-grid'])

const gameContainer = ref(null)
let game = null
let mainScene = null

// Dáta pre uložené obrázky
let cellImages = {}
let backgroundTiles = []

// Grid parametre
const GRID_SIZE = 50
const TILE_WIDTH = 64
const TILE_HEIGHT = 32

// Hlavná Phaser scéna
class IsoScene extends Phaser.Scene {
  constructor() {
    super({ key: 'IsoScene' })
    this.hoveredCell = { row: -1, col: -1 }
    this.selectedCell = { row: -1, col: -1 }
    this.gridGraphics = null
    this.hoverGraphics = null
    this.selectedGraphics = null
    this.buildingSprites = {}
    this.shadowSprites = {}
    this.tileSprites = []
    this.numberTexts = []
    this.isDragging = false
    this.lastPointer = { x: 0, y: 0 }
    this.cameraOffset = { x: 0, y: 0 }
    this.backgroundTileKey = null
    this.groundRenderTexture = null
    this.groundMask = null
    this.groundMaskGraphics = null
  }

  preload() {
    // Vytvoríme placeholder textúru pre tiene
    this.createShadowTexture()
  }

  create() {
    mainScene = this
    
    // Nastavenie kamery
    this.cameras.main.setBackgroundColor(0x667eea)
    this.cameras.main.centerOn(0, GRID_SIZE * TILE_HEIGHT / 2)
    
    // Vytvoríme kontajnery pre vrstvy
    this.groundContainer = this.add.container(0, 0)
    this.groundContainer.setDepth(0)
    
    // RenderTexture pre tiene - všetky tiene sa nakreslia sem ako jedna vrstva
    // Toto zabezpečí že sa tiene neprekrývajú (majú vždy rovnakú farbu)
    this.shadowRenderTexture = this.add.renderTexture(0, 0, 4000, 4000)
    this.shadowRenderTexture.setOrigin(0.5, 0.5)
    this.shadowRenderTexture.setPosition(0, GRID_SIZE * TILE_HEIGHT / 2)
    this.shadowRenderTexture.setAlpha(0.35) // Celková priehľadnosť tieňa
    this.shadowRenderTexture.setDepth(1)
    
    this.buildingContainer = this.add.container(0, 0)
    this.buildingContainer.setDepth(2)
    
    this.uiContainer = this.add.container(0, 0)
    this.uiContainer.setDepth(3)
    
    // Nakreslíme mriežku
    this.drawGrid()
    
    // Input handling
    this.input.on('pointermove', this.handlePointerMove, this)
    this.input.on('pointerdown', this.handlePointerDown, this)
    this.input.on('pointerup', this.handlePointerUp, this)
    this.input.on('wheel', this.handleWheel, this)
    
    // Pravé tlačidlo pre dragging
    this.input.mouse.disableContextMenu()
  }

  createShadowTexture() {
    // Vytvoríme gradient textúru pre tieň
    const graphics = this.make.graphics({ x: 0, y: 0, add: false })
    graphics.fillStyle(0x000000, 0.4)
    graphics.fillRect(0, 0, 128, 64)
    graphics.generateTexture('shadow', 128, 64)
    graphics.destroy()
  }

  // Konverzia grid súradníc na izometrické
  gridToIso(row, col) {
    const x = (col - row) * (TILE_WIDTH / 2)
    const y = (col + row) * (TILE_HEIGHT / 2)
    return { x, y }
  }

  // Konverzia izometrických súradníc na grid
  isoToGrid(x, y) {
    const col = (x / (TILE_WIDTH / 2) + y / (TILE_HEIGHT / 2)) / 2
    const row = (y / (TILE_HEIGHT / 2) - x / (TILE_WIDTH / 2)) / 2
    return { row: Math.floor(row), col: Math.floor(col) }
  }

  drawGrid() {
    // Vyčistíme existujúcu mriežku
    if (this.gridGraphics) {
      this.gridGraphics.destroy()
    }
    this.numberTexts.forEach(t => t.destroy())
    this.numberTexts = []
    
    if (!props.showGrid) return
    
    this.gridGraphics = this.add.graphics()
    this.groundContainer.add(this.gridGraphics)
    
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const { x, y } = this.gridToIso(row, col)
        
        // Farba políčka
        const isEven = (row + col) % 2 === 0
        this.gridGraphics.fillStyle(isEven ? 0xe8e8e8 : 0xf8f8f8, 1)
        
        // Nakreslíme kosoštvorcové políčko
        this.gridGraphics.beginPath()
        this.gridGraphics.moveTo(x, y)
        this.gridGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
        this.gridGraphics.lineTo(x, y + TILE_HEIGHT)
        this.gridGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
        this.gridGraphics.closePath()
        this.gridGraphics.fillPath()
        
        // Okraj
        this.gridGraphics.lineStyle(1, 0x999999, 0.5)
        this.gridGraphics.strokePath()
        
        // Číslovanie
        if (props.showNumbering) {
          const text = this.add.text(x, y + TILE_HEIGHT / 2, `${row},${col}`, {
            fontSize: '10px',
            color: '#ff0000',
            fontStyle: 'bold'
          })
          text.setOrigin(0.5, 0.5)
          this.uiContainer.add(text)
          this.numberTexts.push(text)
        }
      }
    }
  }

  // Nakreslí grid s textúrou pozadia
  drawGridWithTexture() {
    // Vyčistíme existujúcu mriežku
    if (this.gridGraphics) {
      this.gridGraphics.destroy()
    }
    
    // Vyčistíme existujúce tile sprite-y
    if (this.tileSprites && this.tileSprites.length > 0) {
      this.tileSprites.forEach(sprite => sprite.destroy())
      this.tileSprites = []
    }
    
    // Vyčistíme groundRenderTexture
    if (this.groundRenderTexture) {
      this.groundRenderTexture.destroy()
      this.groundRenderTexture = null
    }
    
    // Vyčistíme masku
    if (this.groundMask) {
      this.groundMask.destroy()
      this.groundMask = null
    }
    if (this.groundMaskGraphics) {
      this.groundMaskGraphics.destroy()
      this.groundMaskGraphics = null
    }
    
    this.numberTexts.forEach(t => t.destroy())
    this.numberTexts = []
    
    if (!props.showGrid) return
    
    // Skontroluj či máme textúru
    const hasTexture = this.backgroundTileKey && this.textures.exists(this.backgroundTileKey)
    
    if (hasTexture) {
      // Veľkosť bloku textúry (5x5 políčka)
      const blockSize = 5
      
      // Vytvor RenderTexture pre textúrované políčka
      this.groundRenderTexture = this.add.renderTexture(0, 0, 4000, 4000)
      this.groundRenderTexture.setOrigin(0.5, 0.5)
      this.groundRenderTexture.setPosition(0, GRID_SIZE * TILE_HEIGHT / 2)
      this.groundRenderTexture.setDepth(0)
      
      // Offset pre RenderTexture
      const rtOffsetX = 2000
      const rtOffsetY = 2000 - GRID_SIZE * TILE_HEIGHT / 2
      
      // Získame textúru
      const texture = this.textures.get(this.backgroundTileKey)
      const frame = texture.get()
      
      // Kreslíme textúru po blokoch 5x5
      for (let blockRow = 0; blockRow < GRID_SIZE; blockRow += blockSize) {
        for (let blockCol = 0; blockCol < GRID_SIZE; blockCol += blockSize) {
          // Pozícia ľavého horného rohu bloku
          const { x: startX, y: startY } = this.gridToIso(blockRow, blockCol)
          
          // Vytvoríme dočasný sprite s textúrou
          const tempSprite = this.make.sprite({
            key: this.backgroundTileKey,
            add: false
          })
          
          // Scale aby pokryl 5x5 políčok
          const scaleX = (TILE_WIDTH * blockSize) / frame.width
          const scaleY = (TILE_HEIGHT * blockSize) / frame.height
          tempSprite.setScale(scaleX, scaleY)
          tempSprite.setOrigin(0.5, 0)
          
          // Pozícia stredu bloku
          const centerX = startX
          const centerY = startY
          
          // Nakreslíme do RenderTexture
          this.groundRenderTexture.draw(tempSprite, centerX + rtOffsetX, centerY + rtOffsetY)
          
          tempSprite.destroy()
        }
      }
      
      // Vytvoríme masku v tvare izometrického diamantu
      this.groundMaskGraphics = this.make.graphics()
      
      // Vypočítame rohy izometrickej plochy
      const topCorner = this.gridToIso(0, 0)           // Horný roh
      const rightCorner = this.gridToIso(0, GRID_SIZE) // Pravý roh
      const bottomCorner = this.gridToIso(GRID_SIZE, GRID_SIZE) // Spodný roh
      const leftCorner = this.gridToIso(GRID_SIZE, 0)  // Ľavý roh
      
      // Nakreslíme diamantový tvar pre masku
      this.groundMaskGraphics.fillStyle(0xffffff)
      this.groundMaskGraphics.beginPath()
      this.groundMaskGraphics.moveTo(topCorner.x, topCorner.y)
      this.groundMaskGraphics.lineTo(rightCorner.x, rightCorner.y)
      this.groundMaskGraphics.lineTo(bottomCorner.x, bottomCorner.y)
      this.groundMaskGraphics.lineTo(leftCorner.x, leftCorner.y)
      this.groundMaskGraphics.closePath()
      this.groundMaskGraphics.fillPath()
      
      // Aplikujeme masku na groundRenderTexture
      this.groundMask = this.groundMaskGraphics.createGeometryMask()
      this.groundRenderTexture.setMask(this.groundMask)
      
      // Pridáme okraje a číslovanie pomocou Graphics
      this.gridGraphics = this.add.graphics()
      this.groundContainer.add(this.gridGraphics)
      
      for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
          const { x, y } = this.gridToIso(row, col)
          
          // Okraj
          this.gridGraphics.lineStyle(1, 0x666666, 0.3)
          this.gridGraphics.beginPath()
          this.gridGraphics.moveTo(x, y)
          this.gridGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
          this.gridGraphics.lineTo(x, y + TILE_HEIGHT)
          this.gridGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
          this.gridGraphics.closePath()
          this.gridGraphics.strokePath()
          
          // Číslovanie
          if (props.showNumbering) {
            const text = this.add.text(x, y + TILE_HEIGHT / 2, `${row},${col}`, {
              fontSize: '10px',
              color: '#ff0000',
              fontStyle: 'bold'
            })
            text.setOrigin(0.5, 0.5)
            this.uiContainer.add(text)
            this.numberTexts.push(text)
          }
        }
      }
    } else {
      // Fallback na pôvodné kreslenie bez textúry
      this.drawGrid()
    }
  }

  drawHover() {
    if (this.hoverGraphics) {
      this.hoverGraphics.destroy()
    }
    
    const canInteract = props.templateSelected || props.deleteMode || props.selectedImageId
    if (!canInteract || this.hoveredCell.row === -1) return
    
    this.hoverGraphics = this.add.graphics()
    this.uiContainer.add(this.hoverGraphics)
    
    const cellsX = props.lastImageCellsX || 1
    const cellsY = props.lastImageCellsY || 1
    
    // Skontrolujeme kolíziu
    const hasCollision = this.checkCollision(this.hoveredCell.row, this.hoveredCell.col, cellsX, cellsY)
    
    // Určíme farbu
    let fillColor = props.deleteMode ? 0xff0000 : (hasCollision ? 0xff0000 : 0x667eea)
    let alpha = props.deleteMode ? 0.5 : (hasCollision ? 0.3 : 0.5)
    
    // Nakreslíme hover pre všetky políčka
    const cells = this.getAffectedCells(this.hoveredCell.row, this.hoveredCell.col, cellsX, cellsY)
    
    for (const cell of cells) {
      const { x, y } = this.gridToIso(cell.row, cell.col)
      
      this.hoverGraphics.fillStyle(fillColor, alpha)
      this.hoverGraphics.beginPath()
      this.hoverGraphics.moveTo(x, y)
      this.hoverGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.hoverGraphics.lineTo(x, y + TILE_HEIGHT)
      this.hoverGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.hoverGraphics.closePath()
      this.hoverGraphics.fillPath()
      
      this.hoverGraphics.lineStyle(3, hasCollision ? 0xff0000 : 0x667eea, 1)
      this.hoverGraphics.strokePath()
    }
  }

  drawSelected() {
    if (this.selectedGraphics) {
      this.selectedGraphics.destroy()
    }
    
    if (this.selectedCell.row === -1) return
    
    this.selectedGraphics = this.add.graphics()
    this.uiContainer.add(this.selectedGraphics)
    
    const cellsX = props.lastImageCellsX || 1
    const cellsY = props.lastImageCellsY || 1
    const cells = this.getAffectedCells(this.selectedCell.row, this.selectedCell.col, cellsX, cellsY)
    
    for (const cell of cells) {
      const { x, y } = this.gridToIso(cell.row, cell.col)
      
      this.selectedGraphics.fillStyle(0x22c55e, 0.6)
      this.selectedGraphics.beginPath()
      this.selectedGraphics.moveTo(x, y)
      this.selectedGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.selectedGraphics.lineTo(x, y + TILE_HEIGHT)
      this.selectedGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.selectedGraphics.closePath()
      this.selectedGraphics.fillPath()
      
      this.selectedGraphics.lineStyle(4, 0x22c55e, 1)
      this.selectedGraphics.strokePath()
    }
  }

  getAffectedCells(row, col, cellsX, cellsY) {
    const cells = []
    
    if (cellsX === 1 && cellsY === 1) {
      cells.push({ row, col })
    } else if (cellsX === 1 && cellsY === 2) {
      cells.push({ row, col })
      cells.push({ row: row + 1, col })
    } else if (cellsX === 2 && cellsY === 2) {
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 2; c++) {
          cells.push({ row: row + r, col: col + c })
        }
      }
    } else if (cellsX === 3 && cellsY === 3) {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          cells.push({ row: row + r, col: col + c })
        }
      }
    } else if (cellsX === 4 && cellsY === 4) {
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          cells.push({ row: row + r, col: col + c })
        }
      }
    } else if (cellsX === 5 && cellsY === 5) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          cells.push({ row: row + r, col: col + c })
        }
      }
    }
    
    return cells
  }

  checkCollision(row, col, cellsX, cellsY) {
    const newCells = this.getAffectedCells(row, col, cellsX, cellsY)
      .map(c => `${c.row}-${c.col}`)
    
    for (const key in cellImages) {
      const existing = cellImages[key]
      if (existing.isBackground) continue
      
      const [existingRow, existingCol] = key.split('-').map(Number)
      const existingCells = this.getAffectedCells(existingRow, existingCol, existing.cellsX || 1, existing.cellsY || 1)
        .map(c => `${c.row}-${c.col}`)
      
      for (const cell of newCells) {
        if (existingCells.includes(cell)) {
          return true
        }
      }
    }
    
    return false
  }

  handlePointerMove(pointer) {
    if (this.isDragging && pointer.rightButtonDown()) {
      // Posun kamery
      const dx = pointer.x - this.lastPointer.x
      const dy = pointer.y - this.lastPointer.y
      
      this.cameras.main.scrollX -= dx
      this.cameras.main.scrollY -= dy
      
      this.lastPointer.x = pointer.x
      this.lastPointer.y = pointer.y
      return
    }
    
    // Hover detekcia
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
    const cell = this.isoToGrid(worldPoint.x, worldPoint.y)
    
    if (cell.row >= 0 && cell.row < GRID_SIZE && cell.col >= 0 && cell.col < GRID_SIZE) {
      if (this.hoveredCell.row !== cell.row || this.hoveredCell.col !== cell.col) {
        this.hoveredCell = cell
        this.drawHover()
      }
    } else {
      if (this.hoveredCell.row !== -1) {
        this.hoveredCell = { row: -1, col: -1 }
        this.drawHover()
      }
    }
  }

  handlePointerDown(pointer) {
    if (pointer.rightButtonDown()) {
      this.isDragging = true
      this.lastPointer.x = pointer.x
      this.lastPointer.y = pointer.y
      return
    }
    
    if (pointer.leftButtonDown()) {
      const canSelect = props.templateSelected || props.deleteMode || props.selectedImageId
      if (!canSelect) return
      
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const cell = this.isoToGrid(worldPoint.x, worldPoint.y)
      
      if (cell.row >= 0 && cell.row < GRID_SIZE && cell.col >= 0 && cell.col < GRID_SIZE) {
        if (!props.deleteMode) {
          const cellsX = props.lastImageCellsX || 1
          const cellsY = props.lastImageCellsY || 1
          
          if (this.checkCollision(cell.row, cell.col, cellsX, cellsY)) {
            console.log('❌ Kolízia!')
            return
          }
        }
        
        this.selectedCell = { row: cell.row, col: cell.col }
        this.drawSelected()
        
        emit('cell-selected', { row: cell.row, col: cell.col })
        console.log(`✅ Políčko vybrané: [${cell.row}, ${cell.col}]`)
      }
    }
  }

  handlePointerUp(pointer) {
    this.isDragging = false
  }

  handleWheel(pointer, gameObjects, deltaX, deltaY, deltaZ) {
    const zoomChange = deltaY > 0 ? 0.9 : 1.1
    const newZoom = Phaser.Math.Clamp(this.cameras.main.zoom * zoomChange, 0.3, 3)
    this.cameras.main.setZoom(newZoom)
  }

  // Pridanie obrázka s tieňom
  addBuildingWithShadow(key, imageUrl, row, col, cellsX, cellsY, isBackground = false, templateName = '', isRoadTile = false) {
    const textureKey = `building_${key}`
    
    // Načítame obrázok ako textúru
    this.load.image(textureKey, imageUrl)
    this.load.once('complete', () => {
      const { x, y } = this.gridToIso(row, col)
      
      // Vypočítame offset pre multi-cell objekty
      let offsetX = 0
      let offsetY = 0
      
      if (cellsX === 1 && cellsY === 2) {
        offsetX = -TILE_WIDTH / 4
        offsetY = TILE_HEIGHT / 2
      } else if (cellsX === 2 && cellsY === 2) {
        offsetY = TILE_HEIGHT
      } else if (cellsX >= 3) {
        offsetY = TILE_HEIGHT * (cellsX - 1)
      }
      
      // Pre road tiles - iné umiestnenie (priamo na políčko)
      if (isRoadTile) {
        // Vytvoríme sprite pre road tile
        const roadSprite = this.add.sprite(x, y + TILE_HEIGHT / 2, textureKey)
        
        // Nechaj pôvodnú veľkosť - len vycentruj
        roadSprite.setOrigin(0.5, 0.5) // Stred
        
        // Vytvor izometrickú masku pre políčko
        const maskGraphics = this.make.graphics({ x: 0, y: 0, add: false })
        maskGraphics.fillStyle(0xffffff)
        
        // Izometrický diamant pre masku
        const maskX = x
        const maskY = y + TILE_HEIGHT / 2
        maskGraphics.beginPath()
        maskGraphics.moveTo(maskX, maskY - TILE_HEIGHT / 2) // Hore
        maskGraphics.lineTo(maskX + TILE_WIDTH / 2, maskY) // Vpravo
        maskGraphics.lineTo(maskX, maskY + TILE_HEIGHT / 2) // Dole
        maskGraphics.lineTo(maskX - TILE_WIDTH / 2, maskY) // Vľavo
        maskGraphics.closePath()
        maskGraphics.fillPath()
        
        // Aplikuj masku
        const mask = maskGraphics.createGeometryMask()
        roadSprite.setMask(mask)
        
        // Uložíme referencie
        this.buildingSprites[key] = roadSprite
        this.shadowSprites[key] = null // Road tiles nemajú tieň
        
        // Zoradíme budovy podľa depth (row + col)
        this.sortBuildings()
        return
      }
      
      // Vytvoríme sprite pre budovu (normálny flow)
      const buildingSprite = this.add.sprite(x + offsetX, y + TILE_HEIGHT + offsetY, textureKey)
      
      // Nastavíme veľkosť - zmenšená pre správne rozmery
      const targetWidth = TILE_WIDTH * cellsX * 0.9
      const scale = targetWidth / buildingSprite.width
      buildingSprite.setScale(scale)
      buildingSprite.setOrigin(0.5, 1) // Spodný stred
      
      // Uložíme info o tieni pre renderovanie
      // Fixný offset založený na veľkosti bunky, nie na rozmeroch obrázka
      const baseShadowOffset = TILE_WIDTH * cellsX * 0.4
      
      // Zistíme či je to tree šablóna z názvu šablóny
      const isTreeTemplate = templateName.toLowerCase().includes('tree')
      console.log('🌳 isTree:', isTreeTemplate, 'templateName:', templateName)
      
      const shadowInfo = {
        textureKey,
        x: x + offsetX,
        y: y + TILE_HEIGHT + offsetY,
        scale,
        cellsX, // Veľkosť pre výber správneho offsetu
        isTree: isTreeTemplate, // Špeciálny flag pre stromy
        offsetX: -baseShadowOffset,
        offsetY: baseShadowOffset * 0.375
      }
      
      // Pridáme priamo do scény (nie do kontajnera) aby depth fungoval správne
      // this.buildingContainer.add(buildingSprite)
      
      // Uložíme referencie
      this.buildingSprites[key] = buildingSprite
      this.shadowSprites[key] = shadowInfo // Uložíme info pre RenderTexture
      
      // Zoradíme budovy podľa depth (row + col)
      this.sortBuildings()
      
      // Prekreslíme všetky tiene do RenderTexture
      this.redrawAllShadows()
    })
    
    this.load.start()
  }

  createShadowForBuilding(buildingSprite, x, y) {
    // Táto funkcia už nie je potrebná - tieň sa vytvára v addBuildingWithShadow
    // Ponechávam prázdnu pre spätná kompatibilita
    return null
  }

  // Prekreslí všetky tiene do RenderTexture - zabezpečí že sa neprekrývajú
  redrawAllShadows() {
    // Vyčistíme RenderTexture
    this.shadowRenderTexture.clear()
    
    // Offset pre RenderTexture (stred je na 2000, 2000)
    const rtOffsetX = 2000
    const rtOffsetY = 2000 - GRID_SIZE * TILE_HEIGHT / 2
    
    // Nakreslíme všetky tiene do RenderTexture
    for (const key in this.shadowSprites) {
      const shadowInfo = this.shadowSprites[key]
      if (!shadowInfo || !shadowInfo.textureKey) continue
      
      // Skontrolujeme či textúra existuje
      if (!this.textures.exists(shadowInfo.textureKey)) continue
      
      // Vypočítame pozíciu tieňa v RenderTexture koordinátoch
      const drawX = shadowInfo.x + shadowInfo.offsetX + rtOffsetX
      const drawY = shadowInfo.y + shadowInfo.offsetY + rtOffsetY
      
      // Vytvoríme dočasný sprite pre kreslenie
      const tempSprite = this.make.sprite({
        key: shadowInfo.textureKey,
        add: false
      })
      
      // Získame rozmery textúry
      const texture = this.textures.get(shadowInfo.textureKey)
      const frame = texture.get()
      
      // Nastavíme scale pre tieň
      const shadowScaleX = shadowInfo.scale * 0.45
      const shadowScaleY = shadowInfo.scale * 1.3
      
      tempSprite.setScale(shadowScaleX, shadowScaleY)
      // Origin na spodný stred - rovnaký ako budova
      tempSprite.setOrigin(0.5, 1)
      tempSprite.setAngle(-90)
      tempSprite.setTint(0x000000)
      tempSprite.setAlpha(1)
      
      // Po rotácii o -90° sa výška obrázka stane šírkou tieňa
      // Kompenzujeme pozíciu tak, aby tieň bol vždy rovnako ďaleko od spodku budovy
      // Výška obrázka * scale určuje, ako ďaleko je stred obrázka od spodku
      const imageHeight = frame.height * shadowInfo.scale
      
      // Offset tieňa pre rôzne veľkosti - dolaď tieto hodnoty
      const shadowOffsets = {
        '1x1': { x: 44, y: -23 },
        '2x2': { x: 89 , y: -45 },
        '3x3': { x: 138, y: -68 },
        '4x4': { x: 180, y: -89 },
        '5x5': { x: 219, y: -112 },
        // Špeciálne offsety pre stromy (tree šablóna)
        'tree1x1': { x: 26, y: -11 },
        'tree2x2': { x: 44, y: -19 },
        'tree3x3': { x: 75, y: -32 },
        'tree4x4': { x: 100, y: -45 },
        'tree5x5': { x: 125, y: -58 }
      }
      
      // Získame veľkosť z shadowInfo (zatiaľ len cellsX, predpokladáme štvorcové)
      const cellsX = shadowInfo.cellsX || 1
      const isTree = shadowInfo.isTree || false
      const sizeKey = isTree ? `tree${cellsX}x${cellsX}` : `${cellsX}x${cellsX}`
      const offsets = shadowOffsets[sizeKey] || shadowOffsets[`${cellsX}x${cellsX}`] || shadowOffsets['1x1']
      
      const fixedOffsetX = offsets.x
      const fixedOffsetY = offsets.y
      
      // Nakreslíme do RenderTexture
      this.shadowRenderTexture.draw(tempSprite, drawX + fixedOffsetX, drawY + fixedOffsetY)
      
      tempSprite.destroy()
    }
  }

  sortBuildings() {
    // Zoradíme budovy podľa ich pozície pre správny z-index
    // Pre multi-cell budovy použijeme spodný roh (najvyšší row + col)
    for (const key in this.buildingSprites) {
      const [row, col] = key.split('-').map(Number)
      
      // Získame veľkosť budovy z cellImages
      const imageData = cellImages[key]
      const cellsX = imageData?.cellsX || 1
      const cellsY = imageData?.cellsY || 1
      
      // Spodný roh budovy je na row + cellsX - 1, col + cellsY - 1
      const bottomRow = row + cellsX - 1
      const bottomCol = col + cellsY - 1
      
      // Depth je z spodného rohu - vyššia hodnota = budova je vpredu
      // Base depth 100 aby boli nad tieňmi (depth 1) a mriežkou (depth 0)
      const depth = 100 + (bottomRow + bottomCol)
      this.buildingSprites[key].setDepth(depth)
      
      console.log(`🏠 Building ${key}: row=${row}, col=${col}, bottomRow=${bottomRow}, bottomCol=${bottomCol}, depth=${depth}`)
    }
  }

  removeBuilding(key) {
    if (this.buildingSprites[key]) {
      this.buildingSprites[key].destroy()
      delete this.buildingSprites[key]
    }
    if (this.shadowSprites[key]) {
      delete this.shadowSprites[key]
      // Prekreslíme tiene
      this.redrawAllShadows()
    }
  }

  clearSelection() {
    this.selectedCell = { row: -1, col: -1 }
    this.drawSelected()
  }

  refreshGrid() {
    // Ak máme textúru, použijeme drawGridWithTexture, inak štandardné drawGrid
    if (this.backgroundTileKey && this.textures.exists(this.backgroundTileKey)) {
      this.drawGridWithTexture()
    } else {
      this.drawGrid()
    }
    this.drawHover()
    this.drawSelected()
  }
}

// Funkcia na vloženie obrázka
const placeImageAtSelectedCell = (imageUrl, cellsX, cellsY, isBackground = false, templateName = '', isRoadTile = false) => {
  console.log('🖼️ PhaserCanvas.placeImageAtSelectedCell()')
  console.log('   templateName:', templateName)
  console.log('   isRoadTile:', isRoadTile)
  
  if (!mainScene || mainScene.selectedCell.row === -1) {
    console.log('❌ Žiadne políčko nie je vybrané')
    return false
  }
  
  const row = mainScene.selectedCell.row
  const col = mainScene.selectedCell.col
  const key = `${row}-${col}`
  
  // Ulož do cellImages
  cellImages[key] = {
    url: imageUrl,
    cellsX,
    cellsY,
    isBackground,
    templateName,
    isRoadTile
  }
  
  // Pridaj budovu s tieňom
  mainScene.addBuildingWithShadow(key, imageUrl, row, col, cellsX, cellsY, isBackground, templateName, isRoadTile)
  
  // Vyčisti výber
  mainScene.clearSelection()
  
  emit('image-placed', { row, col })
  
  return true
}

// Funkcia na nastavenie pozadia
const setBackgroundTiles = (tiles, tileSize = 1) => {
  console.log('🎨 PhaserCanvas.setBackgroundTiles()')
  console.log('   Počet tile-ov:', tiles.length)
  console.log('   Tile size:', tileSize)
  
  backgroundTiles = tiles
  
  if (!mainScene || !tiles || tiles.length === 0) {
    console.log('⚠️ PhaserCanvas: Žiadne tiles alebo scéna neexistuje')
    return
  }
  
  // Načítaj tile textúry a prekresli grid
  const tileKey = 'background_tile_0'
  
  // Ak už existuje stará textúra, odstrániť
  if (mainScene.textures.exists(tileKey)) {
    mainScene.textures.remove(tileKey)
  }
  
  // Načítame prvý tile ako textúru
  mainScene.load.image(tileKey, tiles[0])
  mainScene.load.once('complete', () => {
    console.log('✅ Tile textúra načítaná, prekresľujem grid s textúrou')
    mainScene.backgroundTileKey = tileKey
    mainScene.drawGridWithTexture()
  })
  mainScene.load.start()
}

// Funkcia na náhodné rozmiestnenie prvkov
const placeEnvironmentElements = (images, count = 10, gridSize = 50) => {
  console.log('🌲 PhaserCanvas.placeEnvironmentElements()')
  // TODO: Implementovať
}

// Funkcia na vymazanie obrázka
const deleteImageAtCell = (row, col) => {
  console.log(`🗑️ PhaserCanvas: Vymazanie obrázka na [${row}, ${col}]`)
  
  for (const key in cellImages) {
    const [imgRow, imgCol] = key.split('-').map(Number)
    const img = cellImages[key]
    const cells = mainScene.getAffectedCells(imgRow, imgCol, img.cellsX || 1, img.cellsY || 1)
    
    if (cells.some(c => c.row === row && c.col === col)) {
      mainScene.removeBuilding(key)
      delete cellImages[key]
      return true
    }
  }
  
  return false
}

// Expose funkcie
defineExpose({
  placeImageAtSelectedCell,
  setBackgroundTiles,
  placeEnvironmentElements,
  deleteImageAtCell,
  cellImages: () => cellImages,
  backgroundTiles: () => backgroundTiles,
  clearAll: () => {
    Object.keys(cellImages).forEach(key => {
      mainScene?.removeBuilding(key)
    })
    cellImages = {}
  },
  placeImageAtCell: (row, col, url, cellsX = 1, cellsY = 1, isBackground = false) => {
    const key = `${row}-${col}`
    cellImages[key] = { url, cellsX, cellsY, isBackground }
    mainScene?.addBuildingWithShadow(key, url, row, col, cellsX, cellsY, isBackground)
  }
})

// Watch pre zmeny props
watch(() => props.showGrid, () => {
  mainScene?.refreshGrid()
})

watch(() => props.showNumbering, () => {
  mainScene?.refreshGrid()
})

onMounted(() => {
  const config = {
    type: Phaser.AUTO,
    parent: gameContainer.value,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#667eea',
    scene: IsoScene,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    input: {
      mouse: {
        preventDefaultWheel: true
      }
    }
  }
  
  game = new Phaser.Game(config)
  
  // Resize handler
  window.addEventListener('resize', () => {
    if (game) {
      game.scale.resize(window.innerWidth, window.innerHeight)
    }
  })
})

onUnmounted(() => {
  if (game) {
    game.destroy(true)
    game = null
    mainScene = null
  }
})
</script>

<template>
  <div class="phaser-container">
    <div ref="gameContainer" class="game-container"></div>
    
    <!-- Ovládacie prvky -->
    <div class="controls-toggle">
      <label class="checkbox-label">
        <input 
          type="checkbox" 
          :checked="props.showNumbering"
          @change="$emit('toggle-numbering', $event.target.checked)"
        />
        <span>🔢 Číslovanie</span>
      </label>
      <label class="checkbox-label">
        <input 
          type="checkbox" 
          :checked="props.showGallery"
          @change="$emit('toggle-gallery', $event.target.checked)"
        />
        <span>🖼️ Galéria</span>
      </label>
      <label class="checkbox-label">
        <input 
          type="checkbox" 
          :checked="props.showGrid"
          @change="$emit('toggle-grid', $event.target.checked)"
        />
        <span>☰ Mriežka</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.phaser-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  z-index: 1;
}

.game-container {
  width: 100%;
  height: 100%;
}

.game-container canvas {
  display: block;
}

/* Overlay checkboxy pre ovládanie */
.controls-toggle {
  position: absolute;
  top: 20px;
  left: 20px;
  background: rgba(255, 255, 255, 0.95);
  padding: 0.75rem 1rem;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 10;
  backdrop-filter: blur(10px);
  display: flex;
  gap: 1.5rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-weight: 600;
  color: #333;
  user-select: none;
  margin: 0;
}

.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #667eea;
}

.checkbox-label span {
  font-size: 0.9rem;
  white-space: nowrap;
}
</style>
