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
 * Regeneruje všetky road tiles na canvas s novou opacity
 * @param {Object} canvas - Referencia na canvas (canvasRef.value)
 * @param {Array} roadTiles - Pole dostupných road tiles s novou opacity
 */
export function regenerateRoadTilesOnCanvas(canvas, roadTiles) {
  if (!canvas) {
    console.error('❌ Canvas nie je dostupný')
    return false
  }
  
  const cellImages = canvas.cellImages ? canvas.cellImages() : {}
  console.log('🔄 Regenerujem road tiles na canvas s novou opacity...')
  
  let regeneratedCount = 0
  
  // Prejdi všetkými obrázkami na canvas
  for (const key in cellImages) {
    const imageData = cellImages[key]
    
    // Ak má flag isRoadTile, je to road tile
    if (imageData.isRoadTile) {
      const [row, col] = key.split('-').map(Number)
      
      // Nájdi korešpondujúci tile z nového setu podľa názvu
      const tileName = imageData.tileMetadata?.name || imageData.templateName
      const newTile = roadTiles.find(t => t.name === tileName)
      
      if (newTile) {
        console.log(`   🎨 Regenerujem road tile na [${row}, ${col}] - ${newTile.name} s opacity ${newTile.opacity || 100}%`)
        
        // Vymaž starý tile
        canvas.deleteImageAtCell(row, col)
        
        // Umiestni nový tile s novou opacity
        canvas.placeImageAtCell(row, col, newTile.url, 1, 1, false, true, newTile.bitmap, newTile.name)
        regeneratedCount++
      } else {
        console.warn(`⚠️ Nepodarilo sa nájsť tile pre ${tileName}`)
      }
    }
  }
  
  console.log(`✅ Road tiles regenerované! (${regeneratedCount} tiles)`)
  return true
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
  
  // Helper funkcia: Kontrola či je obrázok road tile
  const isRoadTile = (imageUrl) => {
    return roadTiles.some(t => t.url === imageUrl)
  }
  
  // KROK 1: Skontroluj či niekde na ceste nie je budova
  console.log('🏘️ Kontrolujem či cesta nepretína budovy...')
  const existingImages = canvas.cellImages ? canvas.cellImages() : {}
  for (const cell of path) {
    const key = `${cell.row}-${cell.col}`
    if (existingImages[key] && !isRoadTile(existingImages[key].url)) {
      console.error(`❌ Budova na políčku [${cell.row}, ${cell.col}] - cesta sa nemôže položiť!`)
      return false
    }
  }
  
  // KROK 2: Vymaž LEN road tiles na celej trase
  console.log('🗑️ Vymazávam existujúce cesty na trase...')
  for (const cell of path) {
    const key = `${cell.row}-${cell.col}`
    const imageData = existingImages[key]
    if (imageData && isRoadTile(imageData.url)) {
      canvas.deleteImageAtCell(cell.row, cell.col)
    }
  }
  
  // KROK 3: Umiestni tiles na všetky políčka cesty
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

    // Získaj aktuálne obrázky z canvas
    const currentImages = canvas.cellImages ? canvas.cellImages() : {}
    // Kontrola susedných buniek - v aktuálnej ceste AJ na canvas (LEN CESTY, nie budovy)
    const checkNeighbor = (row, col) => {
      // Kontrola v aktuálnej ceste
      const inPath = path.some(p => p.row === row && p.col === col)
      // Kontrola existujúcich ciest na canvas (IGNORUJ budovy)
      const key = `${row}-${col}`
      const onCanvas = currentImages[key] && isRoadTile(currentImages[key].url)
      return inPath || onCanvas
    }
    
    const neighbors = {
      topright: checkNeighbor(cell.row - 1, cell.col),
      bottomleft: checkNeighbor(cell.row + 1, cell.col),
      topleft: checkNeighbor(cell.row, cell.col - 1),
      bottomright: checkNeighbor(cell.row, cell.col + 1)
    }
    
    // Vyber správny tile
    const tile = selectTileByDirection(roadTiles, direction, neighbors.topleft, neighbors.topright, neighbors.bottomleft, neighbors.bottomright)
    console.log(`➤ Umiestňujem tile pre smer "${direction}" na [${cell.row}, ${cell.col}]`)
    
    if (!tile) {
      console.error(`❌ Tile pre smer "${direction}" nenájdený`)
      continue
    }
    
    // Umiestni tile
    canvas.placeImageAtCell(cell.row, cell.col, tile.url, 1, 1, false, true, tile.bitmap, tile.name)
    console.log(`   └─ [${cell.row}, ${cell.col}] - ${tile.name} (${direction})`)
  }
  
  // KROK 4: Prekreslenie len susedných ROAD tiles vedľa novej cesty (budovy sa ignorujú)
  console.log('🔄 Prekresľujem susedné road tiles vedľa novej cesty...')
  const finalImages = canvas.cellImages ? canvas.cellImages() : {}
  const redrawnTiles = new Set() // Aby sme neprekresľovali to isté viackrát
  
  // Prejdi len cestu a skontroluj susedov
  for (const pathCell of path) {
    const neighbors = [
      { row: pathCell.row - 1, col: pathCell.col }, // hore
      { row: pathCell.row + 1, col: pathCell.col }, // dole
      { row: pathCell.row, col: pathCell.col - 1 }, // vľavo
      { row: pathCell.row, col: pathCell.col + 1 }  // vpravo
    ]
    
    for (const neighbor of neighbors) {
      const key = `${neighbor.row}-${neighbor.col}`
      const imageData = finalImages[key]
      
      // Preskočiť ak nie je obrázok, je v ceste, alebo nie je road tile (budova)
      if (!imageData || path.some(p => p.row === neighbor.row && p.col === neighbor.col) || !isRoadTile(imageData.url)) {
        continue
      }
      
      // Preskočiť ak sme to už prekresľovali
      if (redrawnTiles.has(key)) {
        continue
      }
      redrawnTiles.add(key)
      
      // Kontrola susedov tohto road tile-u (budovy sa ignorujú)
      const checkNeighbor = (checkRow, checkCol) => {
        const inPath = path.some(p => p.row === checkRow && p.col === checkCol)
        const checkKey = `${checkRow}-${checkCol}`
        const onCanvas = finalImages[checkKey] && isRoadTile(finalImages[checkKey].url)
        return inPath || onCanvas
      }
      
      const tileNeighbors = {
        topleft: checkNeighbor(neighbor.row, neighbor.col - 1),
        topright: checkNeighbor(neighbor.row - 1, neighbor.col),
        bottomleft: checkNeighbor(neighbor.row + 1, neighbor.col),
        bottomright: checkNeighbor(neighbor.row, neighbor.col + 1)
      }
      
      // Vyber nový tile podľa nových susedov
      const newTile = selectTileByDirection(roadTiles, 'horizontal', tileNeighbors.topleft, tileNeighbors.topright, tileNeighbors.bottomleft, tileNeighbors.bottomright)
      
      if (newTile) {
        console.log(`   🔄 Prekreslím road tile na [${neighbor.row}, ${neighbor.col}] na ${newTile.name}`)
        canvas.placeImageAtCell(neighbor.row, neighbor.col, newTile.url, 1, 1, false, true, newTile.bitmap, newTile.name)
      }
    }
  }
  
  console.log('✅ Cesta postavená!')
  return true
}
