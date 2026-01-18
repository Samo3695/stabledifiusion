<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import Phaser from 'phaser'
import { PersonManager } from '../utils/personManager.js'

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
  },
  roadBuildingMode: {
    type: Boolean,
    default: false
  },
  roadTiles: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['cell-selected', 'image-placed', 'toggle-numbering', 'toggle-gallery', 'toggle-grid', 'road-placed'])

const gameContainer = ref(null)
let game = null
let mainScene = null
const showPerson = ref(true) // Či zobrazovať pohyblivú osobu

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
    this.batchLoading = false
    this.tileSprites = []
    this.numberTexts = []
    this.isDragging = false
    this.lastPointer = { x: 0, y: 0 }
    this.cameraOffset = { x: 0, y: 0 }
    this.backgroundTileKey = null
    this.groundRenderTexture = null
    this.groundMask = null
    this.groundMaskGraphics = null
    
    // Road building mode
    this.roadStartCell = null // Začiatočný bod cesty
    this.roadPath = [] // Aktuálna cesta (pole bunk)
    this.roadPathGraphics = null // Grafika pre preview cesty
    
    // PersonManager pre správu postáv
    this.personManager = null
  }

  preload() {
    // Vytvoríme placeholder textúru pre tiene
    this.createShadowTexture()
    
    // Načítame sprite osoby
    this.load.image('person', '/templates/roads/sprites/person.png')
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
    
    // Inicializujeme PersonManager
    this.personManager = new PersonManager(this, cellImages, {
      personCount: 200,
      TILE_WIDTH,
      TILE_HEIGHT,
      moveDuration: 2400,
      initialDelayRange: [0, 4000]
    })
  }

  createPerson() {
    if (this.personManager) {
      this.personManager.createPersons()
    }
  }
  
  togglePerson(visible) {
    if (this.personManager) {
      this.personManager.togglePersons(visible)
    }
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
    
    // Pre road building mode zobraz hover aj keď ešte nekreslím
    if (props.roadBuildingMode && this.hoveredCell.row !== -1) {
      this.hoverGraphics = this.add.graphics()
      this.uiContainer.add(this.hoverGraphics)
      
      const { x, y } = this.gridToIso(this.hoveredCell.row, this.hoveredCell.col)
      
      // Semi-transparent modrý hover pre road building
      this.hoverGraphics.fillStyle(0x3b82f6, 0.4)
      this.hoverGraphics.beginPath()
      this.hoverGraphics.moveTo(x, y)
      this.hoverGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.hoverGraphics.lineTo(x, y + TILE_HEIGHT)
      this.hoverGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.hoverGraphics.closePath()
      this.hoverGraphics.fillPath()
      
      this.hoverGraphics.lineStyle(2, 0x3b82f6, 0.8)
      this.hoverGraphics.strokePath()
      
      return
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
      
      // Políčka s cestou (road tiles) sú vždy blokované na stavanie
      if (existing.isRoadTile) {
        const [existingRow, existingCol] = key.split('-').map(Number)
        const existingCells = this.getAffectedCells(existingRow, existingCol, existing.cellsX || 1, existing.cellsY || 1)
          .map(c => `${c.row}-${c.col}`)
        
        for (const cell of newCells) {
          if (existingCells.includes(cell)) {
            return true // Kolízia - político má cestu
          }
        }
      } else {
        // Normálne obrázky/budovy
        const [existingRow, existingCol] = key.split('-').map(Number)
        const existingCells = this.getAffectedCells(existingRow, existingCol, existing.cellsX || 1, existing.cellsY || 1)
          .map(c => `${c.row}-${c.col}`)
        
        for (const cell of newCells) {
          if (existingCells.includes(cell)) {
            return true
          }
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
        
        // Road building mode - aktualizuj cestu
        if (props.roadBuildingMode && this.roadStartCell) {
          this.updateRoadPath(cell)
        }
        
        this.drawHover()
      }
    } else {
      if (this.hoveredCell.row !== -1) {
        this.hoveredCell = { row: -1, col: -1 }
        this.drawHover()
      }
    }
  }
  
  // Vypočítaj cestu od štartu po aktuálnu bunku (len rovné čiary - vertikálne alebo horizontálne)
  updateRoadPath(endCell) {
    if (!this.roadStartCell) return
    
    const path = []
    const startRow = this.roadStartCell.row
    const startCol = this.roadStartCell.col
    const endRow = endCell.row
    const endCol = endCell.col
    
    // Zisti vzdialenosti v oboch smeroch
    const rowDiff = Math.abs(endRow - startRow)
    const colDiff = Math.abs(endCol - startCol)
    
    // 🛣️ Určíme orientáciu cesty podľa toho, kde je väčší posun
    const isVertical = rowDiff >= colDiff
    const direction = isVertical ? 'vertical' : 'horizontal'
    const pathType = isVertical ? '📏 ROVNÁ ČIARA (vertikálne)' : '📏 ROVNÁ ČIARA (horizontálne)'
    
    console.log(`🛣️ ${pathType}: [${startRow}, ${startCol}] → [${endRow}, ${endCol}]`)
    
    if (isVertical) {
      // Vertikálna cesta - mení sa row, col zostáva konštantný
      const rowDirection = endRow > startRow ? 1 : (endRow < startRow ? -1 : 0)
      if (rowDirection !== 0) {
        for (let row = startRow; row !== endRow + rowDirection; row += rowDirection) {
          path.push({ 
            row: row, 
            col: startCol, 
            direction: 'vertical',
            fromDir: null,
            toDir: null
          })
        }
      } else {
        // Len jeden bod
        path.push({ 
          row: startRow, 
          col: startCol, 
          direction: 'vertical',
          fromDir: null,
          toDir: null
        })
      }
    } else {
      // Horizontálna cesta - mení sa col, row zostáva konštantný
      const colDirection = endCol > startCol ? 1 : (endCol < startCol ? -1 : 0)
      if (colDirection !== 0) {
        for (let col = startCol; col !== endCol + colDirection; col += colDirection) {
          path.push({ 
            row: startRow, 
            col: col, 
            direction: 'horizontal',
            fromDir: null,
            toDir: null
          })
        }
      } else {
        // Len jeden bod
        path.push({ 
          row: startRow, 
          col: startCol, 
          direction: 'horizontal',
          fromDir: null,
          toDir: null
        })
      }
    }
    
    // Určíme smery pre každý segment (pre rohy)
    for (let i = 0; i < path.length; i++) {
      const prev = path[i - 1]
      const curr = path[i]
      const next = path[i + 1]
      
      // Odkiaľ prichádza
      if (prev) {
        if (prev.row < curr.row) curr.fromDir = 'N' // z hora (nižší row)
        else if (prev.row > curr.row) curr.fromDir = 'S' // z dola (vyšší row)
        else if (prev.col < curr.col) curr.fromDir = 'W' // z ľava (nižší col)
        else if (prev.col > curr.col) curr.fromDir = 'E' // z prava (vyšší col)
      }
      
      // Kam odchádza
      if (next) {
        if (next.row < curr.row) curr.toDir = 'N'
        else if (next.row > curr.row) curr.toDir = 'S'
        else if (next.col < curr.col) curr.toDir = 'W'
        else if (next.col > curr.col) curr.toDir = 'E'
      }
      
      // Určíme typ tile
      curr.tileType = this.determineTileType(curr.fromDir, curr.toDir, curr.direction)
    }
    
    this.roadPath = path
    this.drawRoadPath()
  }
  
  // Určí typ tile podľa smeru odkiaľ a kam
  determineTileType(fromDir, toDir, defaultDirection) {
    // Ak nemáme oba smery, použijeme rovnú cestu
    if (!fromDir && !toDir) {
      return defaultDirection === 'horizontal' ? 'straight_h' : 'straight_v'
    }
    
    // Len začiatok alebo koniec
    if (!fromDir || !toDir) {
      // Určíme smer podľa toho čo máme
      const dir = fromDir || toDir
      if (dir === 'N' || dir === 'S') return 'straight_v'
      return 'straight_h'
    }
    
    // Máme oba smery - môže byť roh
    const combo = fromDir + toDir
    
    // Rovné cesty
    if (combo === 'NS' || combo === 'SN') return 'straight_v'
    if (combo === 'WE' || combo === 'EW') return 'straight_h'
    
    // Rohy - mapovanie na naše tile názvy
    // V izometrii: N=hore-vpravo, S=dole-vľavo, W=hore-vľavo, E=dole-vpravo
    if (combo === 'NE' || combo === 'EN') return 'corner_SW' // Roh ↙
    if (combo === 'NW' || combo === 'WN') return 'corner_SE' // Roh ↘
    if (combo === 'SE' || combo === 'ES') return 'corner_NW' // Roh ↖
    if (combo === 'SW' || combo === 'WS') return 'corner_NE' // Roh ↗
    
    return defaultDirection === 'horizontal' ? 'straight_h' : 'straight_v'
  }
  
  // Nakresli preview cesty
  drawRoadPath() {
    if (this.roadPathGraphics) {
      this.roadPathGraphics.destroy()
    }
    
    if (this.roadPath.length === 0) return
    
    this.roadPathGraphics = this.add.graphics()
    this.uiContainer.add(this.roadPathGraphics)
    
    for (const cell of this.roadPath) {
      const { x, y } = this.gridToIso(cell.row, cell.col)
      
      // Modrá farba pre preview
      this.roadPathGraphics.fillStyle(0x667eea, 0.5)
      this.roadPathGraphics.beginPath()
      this.roadPathGraphics.moveTo(x, y)
      this.roadPathGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.roadPathGraphics.lineTo(x, y + TILE_HEIGHT)
      this.roadPathGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.roadPathGraphics.closePath()
      this.roadPathGraphics.fillPath()
      
      this.roadPathGraphics.lineStyle(3, 0x667eea, 1)
      this.roadPathGraphics.strokePath()
    }
  }
  
  // Vyčisti road building stav
  clearRoadBuilding() {
    this.roadStartCell = null
    this.roadPath = []
    if (this.roadPathGraphics) {
      this.roadPathGraphics.destroy()
      this.roadPathGraphics = null
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
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const cell = this.isoToGrid(worldPoint.x, worldPoint.y)
      
      if (cell.row >= 0 && cell.row < GRID_SIZE && cell.col >= 0 && cell.col < GRID_SIZE) {
        
        // Road building mode
        if (props.roadBuildingMode) {
          if (!this.roadStartCell) {
            // Prvý klik - nastav štartovací bod
            this.roadStartCell = { row: cell.row, col: cell.col }
            this.roadPath = [{ row: cell.row, col: cell.col, direction: 'horizontal' }]
            this.drawRoadPath()
            console.log(`🛣️ Začiatok cesty: [${cell.row}, ${cell.col}]`)
          } else {
            // Druhý klik - postav cestu
            if (this.roadPath.length > 0) {
              console.log(`🛣️ Staviam cestu s ${this.roadPath.length} segmentami`)
              emit('road-placed', { path: [...this.roadPath] })
            }
            this.clearRoadBuilding()
          }
          return
        }
        
        // Normálny režim
        const canSelect = props.templateSelected || props.deleteMode || props.selectedImageId
        if (!canSelect) return
        
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
  addBuildingWithShadow(key, imageUrl, row, col, cellsX, cellsY, isBackground = false, templateName = '', isRoadTile = false, bitmap = null, skipShadows = false) {
    // Pre road tiles - jednoduchá logika bez cache
    if (isRoadTile) {
      // Unikátny kľúč s timestampom aby sa vždy načítala nová textúra
      const roadTextureKey = `road_${key}_${Date.now()}`
      
      // Asynchrónne načítanie aby neblokoval hlavné vlákno
      this.load.image(roadTextureKey, imageUrl)
      
      // Použijeme once namiesto on aby sa callback zavolal len raz
      this.load.once('complete', () => {
        // Zabezpečíme že load je dokončený v nasledujúcom frame
        this.time.delayedCall(0, () => {
          const { x, y } = this.gridToIso(row, col)
          
          // Vytvoríme sprite pre road tile
          const roadSprite = this.add.sprite(x, y + TILE_HEIGHT / 2, roadTextureKey)
          
          // Škáluj obrázok aby jeho šírka zodpovedala šírke políčka
          const scale = TILE_WIDTH / roadSprite.width
          roadSprite.setScale(scale)
          roadSprite.setOrigin(0.5, 0.5)
          
          // Road tiles sú nad mriežkou ale pod budovami
          roadSprite.setDepth(0.5)
          
          // Vytvor izometrickú masku pre políčko
          const maskGraphics = this.make.graphics({ x: 0, y: 0, add: false })
          maskGraphics.fillStyle(0xffffff)
          
          const maskX = x
          const maskY = y + TILE_HEIGHT / 2
          maskGraphics.beginPath()
          maskGraphics.moveTo(maskX, maskY - TILE_HEIGHT / 2)
          maskGraphics.lineTo(maskX + TILE_WIDTH / 2, maskY)
          maskGraphics.lineTo(maskX, maskY + TILE_HEIGHT / 2)
          maskGraphics.lineTo(maskX - TILE_WIDTH / 2, maskY)
          maskGraphics.closePath()
          maskGraphics.fillPath()
          
          const mask = maskGraphics.createGeometryMask()
          roadSprite.setMask(mask)
          
          // Uložíme referenciu (bez tieňa)
          this.buildingSprites[key] = roadSprite
          
          console.log(`🛣️ Road tile umiestnený: ${key}`)
        })
      })
      
      // Spustíme loading asynchrónne (neblokuje)
      this.load.start()
      return
    }
    
    const textureKey = `building_${key}`
    
    // Asynchrónne načítanie textúry
    this.load.image(textureKey, imageUrl)
    this.load.once('complete', () => {
      // Odložíme vykreslenie do nasledujúceho frame
      this.time.delayedCall(0, () => {
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
        
        // Uložíme referencie
        this.buildingSprites[key] = buildingSprite
        this.shadowSprites[key] = shadowInfo // Uložíme info pre RenderTexture
        
        // Zoradíme budovy podľa depth (row + col)
        this.sortBuildings()
        
        // Prekreslíme tiene len ak nie sme v batch loading mode
        if (!skipShadows && !this.batchLoading) {
          this.redrawShadowsAround(row, col)
        }
      })
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
    // Odložíme prekreslenie do nasledujúceho frame aby sme neblokovali animácie
    requestAnimationFrame(() => {
      this.performShadowRedraw()
    })
  }

  // Prekreslí tiene len pre budovu a jej susedov (optimalizované)
  redrawShadowsAround(centerRow, centerCol) {
    // Susediace bunky podľa príkladu: (r,c), (r,c-1), (r+1,c-1), (r+1,c)
    const offsets = [
      { dr: 0, dc: 0 },
      { dr: 0, dc: -1 },
      { dr: 1, dc: -1 },
      { dr: 1, dc: 0 }
    ]

    const keys = offsets
      .map(({ dr, dc }) => `${centerRow + dr}-${centerCol + dc}`)
      .filter(key => this.shadowSprites[key])

    if (keys.length === 0) return

    requestAnimationFrame(() => {
      this.performShadowRedrawForKeys(keys)
    })
  }
  
  // Skutočné prekreslenie tieňov
  performShadowRedraw() {
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

  // Skutočné prekreslenie tieňov len pre vybrané kľúče (bez čistenia celej RT)
  performShadowRedrawForKeys(keys) {
    const rtOffsetX = 2000
    const rtOffsetY = 2000 - GRID_SIZE * TILE_HEIGHT / 2

    keys.forEach(key => {
      const shadowInfo = this.shadowSprites[key]
      if (!shadowInfo || !shadowInfo.textureKey) return
      if (!this.textures.exists(shadowInfo.textureKey)) return

      const drawX = shadowInfo.x + shadowInfo.offsetX + rtOffsetX
      const drawY = shadowInfo.y + shadowInfo.offsetY + rtOffsetY

      const tempSprite = this.make.sprite({
        key: shadowInfo.textureKey,
        add: false
      })

      const texture = this.textures.get(shadowInfo.textureKey)
      const frame = texture.get()

      const shadowScaleX = shadowInfo.scale * 0.45
      const shadowScaleY = shadowInfo.scale * 1.3
      tempSprite.setScale(shadowScaleX, shadowScaleY)
      tempSprite.setOrigin(0.5, 1)
      tempSprite.setAngle(-90)
      tempSprite.setTint(0x000000)
      tempSprite.setAlpha(1)

      const shadowOffsets = {
        '1x1': { x: 44, y: -23 },
        '2x2': { x: 89 , y: -45 },
        '3x3': { x: 138, y: -68 },
        '4x4': { x: 180, y: -89 },
        '5x5': { x: 219, y: -112 },
        'tree1x1': { x: 26, y: -11 },
        'tree2x2': { x: 44, y: -19 },
        'tree3x3': { x: 75, y: -32 },
        'tree4x4': { x: 100, y: -45 },
        'tree5x5': { x: 125, y: -58 }
      }

      const cellsX = shadowInfo.cellsX || 1
      const isTree = shadowInfo.isTree || false
      const sizeKey = isTree ? `tree${cellsX}x${cellsX}` : `${cellsX}x${cellsX}`
      const offsets = shadowOffsets[sizeKey] || shadowOffsets[`${cellsX}x${cellsX}`] || shadowOffsets['1x1']

      const fixedOffsetX = offsets.x
      const fixedOffsetY = offsets.y

      // Najprv sa pokús vymazať starý tieň ak engine podporuje erase
      if (typeof this.shadowRenderTexture.erase === 'function') {
        this.shadowRenderTexture.erase(tempSprite, drawX + fixedOffsetX, drawY + fixedOffsetY)
      }

      this.shadowRenderTexture.draw(tempSprite, drawX + fixedOffsetX, drawY + fixedOffsetY)
      tempSprite.destroy()
    })
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
      
      // Preskočíme road tiles - tie majú fixný depth 0.5
      if (imageData?.isRoadTile) {
        continue
      }
      
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
    console.log(`🗑️ removeBuilding: key=${key}, existuje v buildingSprites=${!!this.buildingSprites[key]}`)
    console.log(`🗑️ Všetky kľúče v buildingSprites:`, Object.keys(this.buildingSprites))
    if (this.buildingSprites[key]) {
      this.buildingSprites[key].destroy()
      delete this.buildingSprites[key]
      console.log(`✅ Sprite ${key} zmazaný`)
    } else {
      console.log(`⚠️ Sprite ${key} neexistuje v buildingSprites!`)
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
const placeImageAtSelectedCell = (imageUrl, cellsX, cellsY, imageDataOrIsBackground = false, templateName = '', isRoadTile = false, imageBitmap = null) => {
  console.log('🖼️ PhaserCanvas.placeImageAtSelectedCell()')
  console.log('   imageDataOrIsBackground:', imageDataOrIsBackground)
  
  // Parsuj parametre - ak je 4. parameter objekt, je to imageData s metaúdajmi
  let isBackground = false
  let imageData = imageDataOrIsBackground
  
  if (typeof imageDataOrIsBackground === 'boolean') {
    // Staré volanie s boolean parametrom
    isBackground = imageDataOrIsBackground
    imageData = null
  } else if (typeof imageDataOrIsBackground === 'object' && imageDataOrIsBackground !== null) {
    // Nové volanie s image objektom - extrahuj metaúdaje
    isBackground = imageDataOrIsBackground.isBackground || false
    if (!templateName && imageDataOrIsBackground.name) {
      templateName = imageDataOrIsBackground.name
    }
    if (imageDataOrIsBackground.isRoadTile !== undefined) {
      isRoadTile = imageDataOrIsBackground.isRoadTile
    }
    console.log('   📍 Road tile metaúdaje:', { name: imageDataOrIsBackground.name, x: imageDataOrIsBackground.x, y: imageDataOrIsBackground.y, width: imageDataOrIsBackground.width, height: imageDataOrIsBackground.height, rotation: imageDataOrIsBackground.rotation })
  }
  
  if (!mainScene || mainScene.selectedCell.row === -1) {
    console.log('❌ Žiadne políčko nie je vybrané')
    return false
  }
  
  const row = mainScene.selectedCell.row
  const col = mainScene.selectedCell.col
  const key = `${row}-${col}`
  
  // Ulož do cellImages s metaúdajmi
  cellImages[key] = {
    url: imageUrl,
    bitmap: imageBitmap,  // Priamo bitmap pre rýchle kreslenie
    cellsX,
    cellsY,
    isBackground,
    templateName,
    isRoadTile,
    // Ulož aj metaúdaje road tile-u
    tileMetadata: imageData && typeof imageData === 'object' ? {
      name: imageData.name,
      x: imageData.x,
      y: imageData.y,
      width: imageData.width,
      height: imageData.height,
      rotation: imageData.rotation
    } : null
  }
  
  // Pridaj budovu s tieňom
  mainScene.addBuildingWithShadow(key, imageUrl, row, col, cellsX, cellsY, isBackground, templateName, isRoadTile, imageBitmap)
  
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
  const key = `${row}-${col}`
  console.log(`🗑️ PhaserCanvas: Vymazanie obrázka na [${row}, ${col}], key=${key}`)
  
  // Najprv skús priamo podľa kľúča (pre 1x1 tiles ako roads)
  if (cellImages[key]) {
    console.log(`🗑️ Nájdený priamy kľúč ${key}, mažem...`)
    mainScene.removeBuilding(key)
    delete cellImages[key]
    return true
  }
  
  // Ak nie je priamy kľúč, hľadaj obrázok ktorý zaberá túto bunku
  for (const imgKey in cellImages) {
    const [imgRow, imgCol] = imgKey.split('-').map(Number)
    const img = cellImages[imgKey]
    const cells = mainScene.getAffectedCells(imgRow, imgCol, img.cellsX || 1, img.cellsY || 1)
    
    if (cells.some(c => c.row === row && c.col === col)) {
      console.log(`🗑️ Nájdený obrázok ${imgKey} zaberajúci [${row}, ${col}], mažem...`)
      mainScene.removeBuilding(imgKey)
      delete cellImages[imgKey]
      return true
    }
  }
  
  console.log(`⚠️ Žiadny obrázok na [${row}, ${col}] nebol nájdený`)
  return false
}

// Expose funkcie
let isBatchLoading = false // Flag pre batch loading

defineExpose({
  placeImageAtSelectedCell,
  setBackgroundTiles,
  placeEnvironmentElements,
  deleteImageAtCell,
  cellImages: () => cellImages,
  backgroundTiles: () => backgroundTiles,
  // Zapne batch loading mode - preskakuje tiene a osoby
  startBatchLoading: () => {
    isBatchLoading = true
    if (mainScene) {
      mainScene.batchLoading = true
    }
    console.log('📦 Batch loading ZAČATÝ')
  },
  // Ukončí batch loading a vykoná všetky odložené operácie
  finishBatchLoading: () => {
    isBatchLoading = false
    if (mainScene) {
      mainScene.batchLoading = false
      // Teraz prekresli tiene RAZ
      console.log('🌓 Prekreslenie všetkých tieňov...')
      mainScene.redrawAllShadows()
      // Vytvor osoby ak sú road tiles
      if (mainScene.personManager) {
        mainScene.personManager.updateWorkerRoadTiles()
        if (mainScene.personManager.getPersonCount() === 0) {
          const hasRoadTiles = Object.values(cellImages).some(img => img.isRoadTile)
          if (hasRoadTiles) {
            console.log('🚶 Vytváram osoby...')
            mainScene.createPerson()
          }
        }
      }
    }
    console.log('📦 Batch loading DOKONČENÝ')
  },
  clearAll: () => {
    Object.keys(cellImages).forEach(key => {
      mainScene?.removeBuilding(key)
    })
    cellImages = {}
  },
  placeImageAtCell: (row, col, url, cellsX = 1, cellsY = 1, isBackground = false, isRoadTile = false, bitmap = null, tileName = '') => {
    const key = `${row}-${col}`
    // Najprv vymaž existujúci obrázok ak tam je
    if (cellImages[key]) {
      mainScene?.removeBuilding(key)
      delete cellImages[key]
    }
    cellImages[key] = { 
      url, 
      cellsX, 
      cellsY, 
      isBackground, 
      isRoadTile,
      bitmap,
      templateName: tileName,
      tileMetadata: isRoadTile && tileName ? { name: tileName } : null
    }
    // Počas batch loadingu preskočíme tiene (vykonajú sa na konci)
    mainScene?.addBuildingWithShadow(key, url, row, col, cellsX, cellsY, isBackground, tileName, isRoadTile, bitmap, isBatchLoading)
    
    // Počas batch loadingu preskočíme vytváranie osôb a aktualizciu workera
    if (!isBatchLoading) {
      // Ak sme pridali road tile a osoby ešte neexistujú, vytvoríme ich
      if (isRoadTile && mainScene && mainScene.personManager && mainScene.personManager.getPersonCount() === 0) {
        mainScene.createPerson()
      }
      
      // Ak sme pridali/odobrali road tile, aktualizujeme worker
      if (mainScene && mainScene.personManager) {
        mainScene.personManager.updateWorkerRoadTiles()
      }
    }
  },
  clearRoadBuilding: () => {
    mainScene?.clearRoadBuilding()
  },
  togglePerson: (visible) => {
    mainScene?.togglePerson(visible)
  }
})

// Watch pre zmeny props
watch(() => props.showGrid, () => {
  mainScene?.refreshGrid()
})

watch(() => props.showNumbering, () => {
  mainScene?.refreshGrid()
})

// Watch pre zobrazenie osoby
watch(showPerson, (newVal) => {
  mainScene?.togglePerson(newVal)
})

// Watch pre road building mode - vyčisti stav keď sa vypne
watch(() => props.roadBuildingMode, (newVal) => {
  if (!newVal && mainScene) {
    mainScene.clearRoadBuilding()
  }
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
      <label class="checkbox-label">
        <input 
          type="checkbox" 
          v-model="showPerson"
        />
        <span>🚶 Osoba</span>
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
