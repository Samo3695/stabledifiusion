/**
 * Web Worker pre výpočet pohybu áut
 * Beží v samostatnom vlákne aby neblokoval hlavné vlákno pri stavbe budov
 */

let roadTiles = []
let roadTileSet = new Set() // Pre rýchle vyhľadávanie
let TILE_WIDTH = 64
let TILE_HEIGHT = 32

// Sledovanie smeru pre každé auto (carId -> { dRow, dCol })
const carDirections = new Map()

function buildRoadTileSet() {
  roadTileSet = new Set(roadTiles.map(t => `${t.row},${t.col}`))
}

function isRoadTile(row, col) {
  return roadTileSet.has(`${row},${col}`)
}

// Prijímanie správ z hlavného vlákna
self.onmessage = function(e) {
  const { type, data } = e.data
  
  switch (type) {
    case 'init':
      TILE_WIDTH = data.TILE_WIDTH
      TILE_HEIGHT = data.TILE_HEIGHT
      roadTiles = data.roadTiles
      buildRoadTileSet()
      self.postMessage({ type: 'initialized' })
      break
      
    case 'updateRoadTiles':
      roadTiles = data.roadTiles
      buildRoadTileSet()
      break
      
    case 'findNextMove': {
      const result = findNextMove(data.carId, data.currentCell)
      self.postMessage({
        type: 'nextMove',
        data: {
          carId: data.carId,
          target: result
        }
      })
      break
    }
      
    case 'batchFindNextMove': {
      const moves = data.cars.map(car => ({
        carId: car.id,
        target: findNextMove(car.id, car.currentCell)
      }))
      self.postMessage({
        type: 'batchNextMoves',
        data: moves
      })
      break
    }
  }
}

/**
 * Nájde ďalší tile kam sa má auto presunúť
 * Na rovnej ceste pokračuje rovno, smer mení len na križovatkách/zátačkách
 */
function findNextMove(carId, currentCell) {
  const adjacent = findAdjacentRoadTiles(currentCell.row, currentCell.col)
  
  if (adjacent.length === 0) {
    // Žiadne susedné road tiles - teleport na náhodný
    carDirections.delete(carId)
    if (roadTiles.length > 0) {
      return roadTiles[Math.floor(Math.random() * roadTiles.length)]
    }
    return null
  }
  
  const prevDir = carDirections.get(carId)
  
  if (!prevDir) {
    // Auto ešte nemá smer - vyberieme náhodný
    const chosen = adjacent[Math.floor(Math.random() * adjacent.length)]
    carDirections.set(carId, {
      dRow: chosen.row - currentCell.row,
      dCol: chosen.col - currentCell.col
    })
    return chosen
  }
  
  // Skúsime pokračovať rovno v aktuálnom smere
  const straightRow = currentCell.row + prevDir.dRow
  const straightCol = currentCell.col + prevDir.dCol
  const canGoStraight = adjacent.find(t => t.row === straightRow && t.col === straightCol)
  
  if (canGoStraight) {
    // Rovná cesta - pokračujeme rovno, nemení sa smer
    return canGoStraight
  }
  
  // Nemôžeme ísť rovno = križovatka, zátačka alebo slepá ulička
  // Vyfiltrujeme opačný smer (nechceme sa otáčať ak máme inú možnosť)
  const backRow = currentCell.row - prevDir.dRow
  const backCol = currentCell.col - prevDir.dCol
  const nonBackward = adjacent.filter(t => !(t.row === backRow && t.col === backCol))
  
  let chosen
  if (nonBackward.length > 0) {
    // Na zátačke/križovatke vyberieme náhodný smer (okrem otočenia)
    chosen = nonBackward[Math.floor(Math.random() * nonBackward.length)]
  } else {
    // Slepá ulička - musíme sa otočiť
    chosen = adjacent[Math.floor(Math.random() * adjacent.length)]
  }
  
  carDirections.set(carId, {
    dRow: chosen.row - currentCell.row,
    dCol: chosen.col - currentCell.col
  })
  return chosen
}

/**
 * Nájde susedné road tiles
 */
function findAdjacentRoadTiles(row, col) {
  const adjacent = []
  const directions = [
    { row: -1, col: 0 }, // hore
    { row: 1, col: 0 },  // dole
    { row: 0, col: -1 }, // vľavo
    { row: 0, col: 1 }   // vpravo
  ]
  
  for (const dir of directions) {
    const newRow = row + dir.row
    const newCol = col + dir.col
    
    // Kontrolujeme či tile existuje v roadTiles
    const found = roadTiles.find(tile => tile.row === newRow && tile.col === newCol)
    if (found) {
      adjacent.push(found)
    }
  }
  
  return adjacent
}

/**
 * Konverzia grid súradníc na izometrické
 */
function gridToIso(row, col) {
  const x = (col - row) * (TILE_WIDTH / 2)
  const y = (col + row) * (TILE_HEIGHT / 2)
  return { x, y }
}

/**
 * Konverzia izometrických súradníc na grid
 */
function isoToGrid(x, y) {
  const col = (x / (TILE_WIDTH / 2) + y / (TILE_HEIGHT / 2)) / 2
  const row = (y / (TILE_HEIGHT / 2) - x / (TILE_WIDTH / 2)) / 2
  return { row: Math.floor(row), col: Math.floor(col) }
}
