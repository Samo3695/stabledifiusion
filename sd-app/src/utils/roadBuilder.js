/**
 * Road Builder - Logika kreslenia ciest
 */

/**
 * Detekuje smer cesty medzi dvoma bunkami
 * @param {Object} cell1 - Prvá bunka {row, col}
 * @param {Object} cell2 - Druhá bunka {row, col}
 * @returns {string} 'horizontal' alebo 'vertical'
 */
function detectDirection(cell1, cell2) {
  const rowDiff = Math.abs(cell2.row - cell1.row)
  const colDiff = Math.abs(cell2.col - cell1.col)
  
  // Ak sa viac mení row → vertikálny smer
  if (rowDiff > colDiff) {
    return 'vertical'
  }
  // Ak sa viac mení col → horizontálny smer
  return 'horizontal'
}

/**
 * Vyberie správny road tile podľa smeru cesty
 * @param {Array} roadTiles - Pole dostupných road tiles
 * @param {string} direction - 'horizontal' alebo 'vertical'
 * @returns {Object|null} Tile objekt alebo null
 */
function selectTileByDirection(roadTiles, direction) {
  if (direction === 'vertical') {
    return roadTiles.find(t => t.name === 'Rovná ↙')
  }
  // horizontal alebo default
  return roadTiles.find(t => t.name === 'Rovná ↘')
}

/**
 * Postaví cestu na canvas
 * @param {Object} canvas - Referencia na canvas (canvasRef.value)
 * @param {Array} roadTiles - Pole dostupných road tiles
 * @param {Array} path - Cesta ako pole buniek {row, col}
 */
export function buildRoad(canvas, roadTiles, path) {
  console.log(`🛣️ RoadBuilder: Staviam cestu s ${path.length} segmentami`)
  
  if (!canvas || roadTiles.length === 0) {
    console.error('❌ Canvas alebo road tiles nie sú dostupné')
    return false
  }
  
  // KROK 1: Najprv vymaž VŠETKY obrázky na celej trase
  console.log('🗑️ Vymazávam existujúce obrázky na trase...')
  for (const cell of path) {
    canvas.deleteImageAtCell(cell.row, cell.col)
  }
  
  // KROK 2: Umiestni tiles na všetky políčka cesty
  for (let i = 0; i < path.length; i++) {
    const cell = path[i]
    
    // Detekuj smer pohybu
    let direction = 'horizontal' // default
    
    if (i > 0) {
      // Porovnaj s predchádzajúcou bunkou
      direction = detectDirection(path[i - 1], cell)
    } else if (i < path.length - 1) {
      // Pre prvú bunku porovnaj s nasledujúcou
      direction = detectDirection(cell, path[i + 1])
    }
    
    // Vyber správny tile
    const tile = selectTileByDirection(roadTiles, direction)
    console.log(`➤ Umiestňujem tile pre smer "${direction}" na [${cell.row}, ${cell.col}]`)
    
    //sem 
    if (!tile) {
      console.error(`❌ Tile pre smer "${direction}" nenájdený`)
      continue
    }
    
    // Umiestni tile (už sme vymazali na začiatku)
    canvas.placeImageAtCell(cell.row, cell.col, tile.url, 1, 1, false, true, tile.bitmap)
    console.log(`   └─ [${cell.row}, ${cell.col}] - ${tile.name} (${direction})`)
  }
  
  console.log('✅ Cesta postavená!')
  return true
}
