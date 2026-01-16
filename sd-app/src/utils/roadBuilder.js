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
function selectTileByDirection(roadTiles, direction, topLeft, topRight, bottomLeft, bottomRight) {
  if (topLeft && bottomLeft && topRight && bottomRight) {
    return roadTiles.find(t => t.name === 'Križovatka +')
  }
  if (!topLeft && !bottomRight && bottomLeft && topRight) {
    return roadTiles.find(t => t.name === 'Rovná ↙')
  }
  if (topLeft && bottomRight && !bottomLeft && !topRight) {
    return roadTiles.find(t => t.name === 'Rovná ↘')
  }
  if (topLeft && !bottomRight && !bottomLeft && topRight) {
    return roadTiles.find(t => t.name === 'Roh ↙')
  }
  if (topLeft && !bottomRight && bottomLeft && !topRight) {
    return roadTiles.find(t => t.name === 'Roh ↘')
  }
  if (!topLeft && bottomRight && !bottomLeft && topRight) {
    return roadTiles.find(t => t.name === 'Roh ↖')
  }
  if (!topLeft && bottomRight && bottomLeft && !topRight) {
    return roadTiles.find(t => t.name === 'Roh ↗')
  }
  if (topLeft && !bottomRight && bottomLeft && topRight) {
    return roadTiles.find(t => t.name === 'T ↖')
  }
  if (!topLeft && bottomRight && bottomLeft && topRight) {
    return roadTiles.find(t => t.name === 'T ↘')
  }
  if (topLeft && bottomRight && !bottomLeft && topRight) {
    return roadTiles.find(t => t.name === 'T ↗')
  }
  if (topLeft && bottomRight && bottomLeft && !topRight) {
    return roadTiles.find(t => t.name === 'T ↙')
  }
  // horizontal alebo default
  return direction === 'vertical' ? roadTiles.find(t => t.name === 'Rovná ↙'): roadTiles.find(t => t.name === 'Rovná ↘');
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

    // Získaj existujúce obrázky z canvas
    const existingImages = canvas.cellImages ? canvas.cellImages() : {}
    // Kontrola susedných buniek - v aktuálnej ceste AJ na canvas
    const checkNeighbor = (row, col) => {
      // Kontrola v aktuálnej ceste
      const inPath = path.some(p => p.row === row && p.col === col)
      // Kontrola existujúcich obrázkov na canvas
      const onCanvas = existingImages[`${row}-${col}`] !== undefined
      const all = inPath || onCanvas
      return { inPath, onCanvas, hasRoad: inPath || onCanvas, all }
    }
    
    const neighbors = {
      topright: checkNeighbor(cell.row - 1, cell.col),
      bottomleft: checkNeighbor(cell.row + 1, cell.col),
      topleft: checkNeighbor(cell.row, cell.col - 1),
      bottomright: checkNeighbor(cell.row, cell.col + 1)
    }
    /*
    console.warn(`🔢 Tile č. ${i} [${cell.row},${cell.col}] | Susedné cesty:`)
    console.warn(`   ↗ topright: inPath=${neighbors.topright.inPath}, onCanvas=${neighbors.topright.onCanvas}, all=${neighbors.topright.all}`)
    console.warn(`   ↙ bottomleft: inPath=${neighbors.bottomleft.inPath}, onCanvas=${neighbors.bottomleft.onCanvas}, all=${neighbors.bottomleft.all}`)
    console.warn(`   ↖ topleft: inPath=${neighbors.topleft.inPath}, onCanvas=${neighbors.topleft.onCanvas}, all=${neighbors.topleft.all}`)
    console.warn(`   ↘ bottomright: inPath=${neighbors.bottomright.inPath}, onCanvas=${neighbors.bottomright.onCanvas}, all=${neighbors.bottomright.all}`)
    */
    
    // Vyber správny tile
    const tile = selectTileByDirection(roadTiles, direction, neighbors.topleft.all, neighbors.topright.all, neighbors.bottomleft.all, neighbors.bottomright.all)
    console.log(`➤ Umiestňujem tile pre smer "${direction}" na [${cell.row}, ${cell.col}]`)
    

    
    
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
