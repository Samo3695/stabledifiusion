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

const canvas = ref(null)
let hoveredCell = { row: -1, col: -1 }
let selectedCell = { row: -1, col: -1 } // Vybrané políčko pre generovanie
let offsetX = 0
let offsetY = 0
let scale = 1
let isDragging = false
let lastMouseX = 0
let lastMouseY = 0
let cellImages = {} // { 'row-col': { url: imageUrl, cellsX: number, cellsY: number } }
let loadedImages = {} // cache pre načítané Image objekty
let backgroundTiles = [] // Array base64 tile obrázkov pre pozadie šachovnice
let loadedTiles = [] // Načítané Image objekty pre tile-y
let tilesPerImage = 1 // Cez koľko políčok pôjde jeden obrázok

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
  } else if (cellsX === 3 && cellsY === 3) {
    // 9 políčok: 3x3 blok
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        affectedCells.push(`${row + r}-${col + c}`)
      }
    }
  } else if (cellsX === 4 && cellsY === 4) {
    // 16 políčok: 4x4 blok
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        affectedCells.push(`${row + r}-${col + c}`)
      }
    }
  } else if (cellsX === 5 && cellsY === 5) {
    // 25 políčok: 5x5 blok
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        affectedCells.push(`${row + r}-${col + c}`)
      }
    }
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
    } else if (exCellsX === 3 && exCellsY === 3) {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          existingCells.push(`${existingRow + r}-${existingCol + c}`)
        }
      }
    } else if (exCellsX === 4 && exCellsY === 4) {
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          existingCells.push(`${existingRow + r}-${existingCol + c}`)
        }
      }
    } else if (exCellsX === 5 && exCellsY === 5) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          existingCells.push(`${existingRow + r}-${existingCol + c}`)
        }
      }
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
      
      // Nakreslíme políčko len ak je mriežka zapnutá
      if (props.showGrid) {
        // Skontrolujeme či máme tile obrázky pre pozadie
        const hasTiles = loadedTiles.length > 0
        
        if (hasTiles) {
          // Vypočítame ktorý tile obrázok použiť podľa tilesPerImage
          // Ak tilesPerImage = 4, tak každých 4 políčok (2x2 blok) používa jeden obrázok
          const blockSize = Math.sqrt(tilesPerImage) // 1->1, 4->2, 16->4
          const blockRow = Math.floor(row / blockSize)
          const blockCol = Math.floor(col / blockSize)
          const tileIndex = (blockRow + blockCol) % loadedTiles.length
          const tileImg = loadedTiles[tileIndex]
          
          if (tileImg) {
            // Uložíme context state
            ctx.save()
            
            // Vytvoríme clip path v tvare kosoštvorca - trochu väčší pre prekrytie medzier
            const overlap = 2 // pixely prekrytia
            ctx.beginPath()
            ctx.moveTo(x, y - overlap)
            ctx.lineTo(x + tileWidth / 2 + overlap, y + tileHeight / 2)
            ctx.lineTo(x, y + tileHeight + overlap)
            ctx.lineTo(x - tileWidth / 2 - overlap, y + tileHeight / 2)
            ctx.closePath()
            ctx.clip()
            
            // Pre viac políčok na obrázok - vypočítame offset v rámci bloku
            const inBlockRow = row % blockSize
            const inBlockCol = col % blockSize
            
            // Veľkosť jedného políčka v rámci obrázka
            const srcTileW = tileImg.width / blockSize
            const srcTileH = tileImg.height / blockSize
            
            // Súradnice v zdrojovom obrázku
            const srcX = inBlockCol * srcTileW
            const srcY = inBlockRow * srcTileH
            
            // Nakreslíme časť tile obrázka - rozšírený o overlap
            const bboxX = x - tileWidth / 2 - overlap
            const bboxY = y - overlap
            const bboxW = tileWidth + overlap * 2
            const bboxH = tileHeight + overlap * 2
            
            ctx.drawImage(tileImg, srcX, srcY, srcTileW, srcTileH, bboxX, bboxY, bboxW, bboxH)
            
            // Obnovíme context
            ctx.restore()
          }
        } else {
          // Fallback na farebné políčka
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
        }
        
        // Orámovanie - len ak nemáme tile obrázky (inak by rušilo)
        if (!hasTiles) {
          ctx.strokeStyle = '#999'
          ctx.lineWidth = 1 / scale
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x + tileWidth / 2, y + tileHeight / 2)
          ctx.lineTo(x, y + tileHeight)
          ctx.lineTo(x - tileWidth / 2, y + tileHeight / 2)
          ctx.closePath()
          ctx.stroke()
        }
      } // Koniec if (props.showGrid)
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
      } else if (cellsX === 3 && cellsY === 3) {
        // 9 políčok v bloku 3x3 - posun 2 políčka nižšie
        offsetXForCells = 0
        offsetYForCells = tileHeight * 2
      } else if (cellsX === 4 && cellsY === 4) {
        // 16 políčok v bloku 4x4 - posun 3 políčka nižšie
        offsetXForCells = 0
        offsetYForCells = tileHeight * 3
      } else if (cellsX === 5 && cellsY === 5) {
        // 25 políčok v bloku 5x5 - posun 4 políčka nižšie
        offsetXForCells = 0
        offsetYForCells = tileHeight * 4
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
        
        // Číslovanie sa vykreslí vždy, len s rôznou opacity
        const numberOpacity = props.showNumbering ? 1.0 : 0.0
        
        if (numberOpacity > 0) {
          ctx.globalAlpha = numberOpacity
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
          
          // Zrušíme tieň a vrátime opacity
          ctx.shadowColor = 'transparent'
          ctx.shadowBlur = 0
          ctx.globalAlpha = 1.0
        }
      }
    }
  }
  
  // FÁZA 4: Hover označenie NAD všetkým (najvyšší z-index) - len ak je vybraná šablóna alebo delete mode
  if ((props.templateSelected || props.deleteMode) && highlightRow !== -1 && highlightCol !== -1) {
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
        // Pre 9 políčok (3x3): 3x3 blok
        else if (hoverCellsX === 3 && hoverCellsY === 3) {
          isHighlighted = row >= highlightRow && row < highlightRow + 3 &&
                         col >= highlightCol && col < highlightCol + 3
        }
        // Pre 16 políčok (4x4): 4x4 blok
        else if (hoverCellsX === 4 && hoverCellsY === 4) {
          isHighlighted = row >= highlightRow && row < highlightRow + 4 &&
                         col >= highlightCol && col < highlightCol + 4
        }
        // Pre 25 políčok (5x5): 5x5 blok
        else if (hoverCellsX === 5 && hoverCellsY === 5) {
          isHighlighted = row >= highlightRow && row < highlightRow + 5 &&
                         col >= highlightCol && col < highlightCol + 5
        }
        
        if (isHighlighted) {
          const isoX = (col - row) * (tileWidth / 2)
          const isoY = (col + row) * (tileHeight / 2)
          const x = startX + isoX
          const y = startY + isoY
          
          // Červená výplň pri kolízii alebo delete mode, modrá inak
          if (props.deleteMode) {
            ctx.fillStyle = 'rgba(255, 0, 0, 0.5)' // Červená pre delete mode
          } else {
            ctx.fillStyle = hasCollision ? 'rgba(255, 0, 0, 0.3)' : 'rgba(102, 126, 234, 0.5)'
          }
          
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
  
  // FÁZA 5: Vybrané políčko (zelené) NAD všetkým
  if (selectedCell.row !== -1 && selectedCell.col !== -1) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let isSelected = false
        
        const selCellsX = props.lastImageCellsX || 1
        const selCellsY = props.lastImageCellsY || 1
        
        // Pre 1size (1x1): len jedno políčko
        if (selCellsX === 1 && selCellsY === 1) {
          isSelected = row === selectedCell.row && col === selectedCell.col
        }
        // Pre 2size (1x2): dve políčka nad sebou
        else if (selCellsX === 1 && selCellsY === 2) {
          isSelected = (row === selectedCell.row && col === selectedCell.col) ||
                      (row === selectedCell.row + 1 && col === selectedCell.col)
        }
        // Pre 4size (2x2): štyri políčka v bloku
        else if (selCellsX === 2 && selCellsY === 2) {
          isSelected = (row === selectedCell.row && col === selectedCell.col) ||
                      (row === selectedCell.row && col === selectedCell.col + 1) ||
                      (row === selectedCell.row + 1 && col === selectedCell.col) ||
                      (row === selectedCell.row + 1 && col === selectedCell.col + 1)
        }
        // Pre 9 políčok (3x3): 3x3 blok
        else if (selCellsX === 3 && selCellsY === 3) {
          isSelected = row >= selectedCell.row && row < selectedCell.row + 3 &&
                      col >= selectedCell.col && col < selectedCell.col + 3
        }
        // Pre 16 políčok (4x4): 4x4 blok
        else if (selCellsX === 4 && selCellsY === 4) {
          isSelected = row >= selectedCell.row && row < selectedCell.row + 4 &&
                      col >= selectedCell.col && col < selectedCell.col + 4
        }
        // Pre 25 políčok (5x5): 5x5 blok
        else if (selCellsX === 5 && selCellsY === 5) {
          isSelected = row >= selectedCell.row && row < selectedCell.row + 5 &&
                      col >= selectedCell.col && col < selectedCell.col + 5
        }
        
        if (isSelected) {
          const isoX = (col - row) * (tileWidth / 2)
          const isoY = (col + row) * (tileHeight / 2)
          const x = startX + isoX
          const y = startY + isoY
          
          // Zelená výplň pre vybrané políčko
          ctx.fillStyle = 'rgba(34, 197, 94, 0.6)'
          
          // Kreslenie kosoštvorca (diamantu)
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x + tileWidth / 2, y + tileHeight / 2)
          ctx.lineTo(x, y + tileHeight)
          ctx.lineTo(x - tileWidth / 2, y + tileHeight / 2)
          ctx.closePath()
          ctx.fill()
          
          // Zelený okraj
          ctx.strokeStyle = '#22c55e'
          ctx.lineWidth = 4 / scale
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
  
  // Ľavé tlačidlo (0) = vybrať políčko
  // Funguje ak je vybraná šablóna ALEBO ak je aktualívny delete mode
  if (event.button === 0 && (props.templateSelected || props.deleteMode)) {
    const rect = canvas.value.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    
    const scaleX = canvas.value.width / rect.width
    const scaleY = canvas.value.height / rect.height
    
    const cell = getGridCell(x * scaleX, y * scaleY, canvas.value.width, canvas.value.height)
    
    if (cell.row !== -1 && cell.col !== -1) {
      // V delete mode nekoníčkujeme kolíziu - používateľ kliká na building aby ho zmazal
      if (!props.deleteMode) {
        // Kontrola kolízie pred výberom pomocou checkCollision funkcie
        const cellsX = props.lastImageCellsX || 1
        const cellsY = props.lastImageCellsY || 1
        
        if (checkCollision(cell.row, cell.col, cellsX, cellsY)) {
          console.log('❌ Kolízia! Nemôžete vybrať toto políčko.')
          console.log(`   Pokus o výber: [${cell.row}, ${cell.col}]`)
          console.log(`   Rozmery: ${cellsX}x${cellsY} políčok`)
          return
        }
      }
      
      // Označ políčko
      selectedCell.row = cell.row
      selectedCell.col = cell.col
      
      // Emituj event do App.vue
      emit('cell-selected', { row: cell.row, col: cell.col })
      
      console.log(`✅ Políčko vybrané: [${cell.row}, ${cell.col}]`)
      if (!props.deleteMode) {
        const cellsX = props.lastImageCellsX || 1
        const cellsY = props.lastImageCellsY || 1
        console.log(`   Rozmery: ${cellsX}x${cellsY} políčok`)
      }
      
      // Prekreslí canvas
      const ctx = canvas.value.getContext('2d')
      drawCheckerboard(ctx, canvas.value.width, canvas.value.height, hoveredCell.row, hoveredCell.col)
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

// Funkcia na vloženie obrázka na vybratú pozíciu
const placeImageAtSelectedCell = (imageUrl, cellsX, cellsY) => {
  console.log('🖼️ CheckerboardCanvas.placeImageAtSelectedCell() volaná')
  console.log('   selectedCell:', selectedCell)
  console.log('   cellsX x cellsY:', cellsX, 'x', cellsY)
  console.log('   imageUrl length:', imageUrl.length)
  
  if (selectedCell.row === -1 || selectedCell.col === -1) {
    console.log('❌ Žiadne políčko nie je vybrané')
    return false
  }
  
  // Kontrola kolízie
  if (checkCollision(selectedCell.row, selectedCell.col, cellsX, cellsY)) {
    console.log('❌ Kolízia! Obrázok by sa prekrýval s existujúcim obrázkom.')
    return false
  }
  
  const cellKey = `${selectedCell.row}-${selectedCell.col}`
  
  // Ulož obrázok s informáciou o rozmeroch v políčkach
  cellImages[cellKey] = {
    url: imageUrl,
    cellsX: cellsX,
    cellsY: cellsY
  }
  
  // Načítať obrázok
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    console.log('🖼️ CheckerboardCanvas: Obrázok načítaný, renderujem...')
    loadedImages[cellKey] = img
    const ctx = canvas.value.getContext('2d')
    drawCheckerboard(ctx, canvas.value.width, canvas.value.height, hoveredCell.row, hoveredCell.col)
    console.log('🎨 CheckerboardCanvas: Canvas prekreslený')
    
    // Emituj event že obrázok bol vložený
    emit('image-placed', { row: selectedCell.row, col: selectedCell.col })
    console.log('📤 CheckerboardCanvas: Event image-placed emitovaný')
  }
  img.onerror = (err) => {
    console.error('❌ CheckerboardCanvas: Chyba pri načítaní obrázka:', err)
  }
  console.log('🔄 CheckerboardCanvas: Spúšťam načítanie obrázka...')
  img.src = imageUrl
  
  console.log(`✅ Obrázok vložený!`)
  console.log(`   Hlavné políčko: [${selectedCell.row}, ${selectedCell.col}]`)
  console.log(`   Rozmery: ${cellsX}x${cellsY} políčok`)
  
  // Zruš výber políčka
  selectedCell.row = -1
  selectedCell.col = -1
  
  return true
}

// Funkcia na nastavenie tile obrázkov pre pozadie šachovnice
const setBackgroundTiles = (tiles, tileSize = 1) => {
  console.log('🎨 CheckerboardCanvas.setBackgroundTiles() volaná')
  console.log('   Počet tile-ov:', tiles.length)
  console.log('   Tiles per image:', tileSize)
  
  backgroundTiles = tiles
  tilesPerImage = tileSize
  loadedTiles = []
  
  // Načítaj všetky tile obrázky
  let loadedCount = 0
  tiles.forEach((tileUrl, index) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      loadedTiles[index] = img
      loadedCount++
      console.log(`   Tile ${index + 1}/${tiles.length} načítaný`)
      
      // Keď sú všetky načítané, prekresli canvas
      if (loadedCount === tiles.length) {
        console.log('✅ Všetky tile-y načítané, prekresľujem canvas...')
        if (canvas.value) {
          const ctx = canvas.value.getContext('2d')
          drawCheckerboard(ctx, canvas.value.width, canvas.value.height, hoveredCell.row, hoveredCell.col)
        }
      }
    }
    img.onerror = (err) => {
      console.error(`❌ Chyba pri načítaní tile ${index + 1}:`, err)
    }
    img.src = tileUrl
  })
}

// Funkcia na náhodné rozmiestnenie prvkov prostredia
const placeEnvironmentElements = (images, count = 10, gridSize = 50) => {
  console.log('🌲 CheckerboardCanvas.placeEnvironmentElements() volaná')
  console.log('   Počet obrázkov:', images.length)
  console.log('   Počet prvkov na umiestniť:', count)
  
  // Vymaž existujúce prvky prostredia (ale nie budovy)
  // Budovy majú väčšie rozmery, prvky prostredia sú 1x1
  for (const key in cellImages) {
    const img = cellImages[key]
    if (img.isEnvironment) {
      delete cellImages[key]
      delete loadedImages[key]
    }
  }
  
  // Náhodne umiestni prvky
  const placedPositions = new Set()
  let placed = 0
  let attempts = 0
  const maxAttempts = count * 10
  
  while (placed < count && attempts < maxAttempts) {
    attempts++
    
    // Náhodná pozícia
    const row = Math.floor(Math.random() * gridSize)
    const col = Math.floor(Math.random() * gridSize)
    const cellKey = `${row}-${col}`
    
    // Kontrola či už nie je obsadené
    if (placedPositions.has(cellKey) || cellImages[cellKey]) {
      continue
    }
    
    // Náhodný obrázok z pole
    const randomImage = images[Math.floor(Math.random() * images.length)]
    
    // Ulož prvok
    cellImages[cellKey] = {
      url: randomImage,
      cellsX: 1,
      cellsY: 1,
      isEnvironment: true // Označí že je to prvok prostredia
    }
    
    placedPositions.add(cellKey)
    placed++
    
    // Načítaj obrázok
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      loadedImages[cellKey] = img
      // Prekresli canvas keď je všetko načítané
      if (Object.keys(loadedImages).length >= placed) {
        if (canvas.value) {
          const ctx = canvas.value.getContext('2d')
          drawCheckerboard(ctx, canvas.value.width, canvas.value.height, hoveredCell.row, hoveredCell.col)
        }
      }
    }
    img.src = randomImage
  }
  
  console.log(`✅ Umiestnených ${placed} prvkov prostredia`)
  
  // Prekresli canvas
  if (canvas.value) {
    const ctx = canvas.value.getContext('2d')
    drawCheckerboard(ctx, canvas.value.width, canvas.value.height, hoveredCell.row, hoveredCell.col)
  }
}

// Funkcia na vymazanie obrázka na danom políčku alebo políčkach ktoré obsadzuje
const deleteImageAtCell = (row, col) => {
  console.log(`🗑️ CheckerboardCanvas: Vymazanie obrázka na políčku [${row}, ${col}]`)
  
  // Nájdeme všetky obrázky ktoré obsadzujú toto políčko
  const toDelete = []
  
  for (const [key, image] of Object.entries(cellImages)) {
    const [imgRow, imgCol] = key.split('-').map(Number)
    const cellsX = image.cellsX || 1
    const cellsY = image.cellsY || 1
    
    // Zistíme všetky políčka ktoré tento obrázok obsadzuje
    const occupiedCells = []
    
    if (cellsX === 1 && cellsY === 1) {
      occupiedCells.push(`${imgRow}-${imgCol}`)
    } else if (cellsX === 1 && cellsY === 2) {
      occupiedCells.push(`${imgRow}-${imgCol}`)
      occupiedCells.push(`${imgRow + 1}-${imgCol}`)
    } else if (cellsX === 2 && cellsY === 2) {
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 2; c++) {
          occupiedCells.push(`${imgRow + r}-${imgCol + c}`)
        }
      }
    } else if (cellsX === 3 && cellsY === 3) {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          occupiedCells.push(`${imgRow + r}-${imgCol + c}`)
        }
      }
    } else if (cellsX === 4 && cellsY === 4) {
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          occupiedCells.push(`${imgRow + r}-${imgCol + c}`)
        }
      }
    } else if (cellsX === 5 && cellsY === 5) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          occupiedCells.push(`${imgRow + r}-${imgCol + c}`)
        }
      }
    }
    
    // Ak kliknuté políčko je v tomto zozname, označíme tento obrázok na vymazanie
    if (occupiedCells.includes(`${row}-${col}`)) {
      toDelete.push(key)
    }
  }
  
  // Vymažeme nájdené obrázky
  for (const key of toDelete) {
    console.log(`  ✓ Vymazaný obrázok na ${key}`)
    delete cellImages[key]
    delete loadedImages[key]
  }
  
  // Prekreslíme canvas
  if (canvas.value) {
    const ctx = canvas.value.getContext('2d')
    drawCheckerboard(ctx, canvas.value.width, canvas.value.height, hoveredCell.row, hoveredCell.col)
  }
  
  return toDelete.length > 0
}

// Expose funkcie aby ich mohol App.vue volať
defineExpose({
  placeImageAtSelectedCell,
  setBackgroundTiles,
  placeEnvironmentElements,
  deleteImageAtCell
})

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

// Watch na zmenu showNumbering - okamžite prekreslí pomocou requestAnimationFrame
watch(() => props.showNumbering, () => {
  if (canvas.value) {
    requestAnimationFrame(() => {
      const ctx = canvas.value.getContext('2d')
      drawCheckerboard(ctx, canvas.value.width, canvas.value.height)
    })
  }
})

// Watch na zmenu showGrid - okamžite prekreslí pomocou requestAnimationFrame
watch(() => props.showGrid, () => {
  if (canvas.value) {
    requestAnimationFrame(() => {
      const ctx = canvas.value.getContext('2d')
      drawCheckerboard(ctx, canvas.value.width, canvas.value.height)
    })
  }
})</script>

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
    
    <!-- Checkbox overlay pre číslovanie a galériu -->
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
.canvas-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  overflow: hidden;
  z-index: 1;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
  user-select: none;
}

canvas:active {
  cursor: grabbing;
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
