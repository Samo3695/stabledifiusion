/**
 * Web Worker pre výpočet pohybu áut
 * Beží v samostatnom vlákne aby neblokoval hlavné vlákno pri stavbe budov
 */

let roadTiles = []
let TILE_WIDTH = 64
let TILE_HEIGHT = 32

// Prijímanie správ z hlavného vlákna
self.onmessage = function(e) {
  const { type, data } = e.data
  
  switch (type) {
    case 'init':
      // Inicializácia worker-a s konfiguráciou
      TILE_WIDTH = data.TILE_WIDTH
      TILE_HEIGHT = data.TILE_HEIGHT
      roadTiles = data.roadTiles
      self.postMessage({ type: 'initialized' })
      break
      
    case 'updateRoadTiles':
      // Aktualizácia road tiles keď sa pridajú/odstránia
      roadTiles = data.roadTiles
      break
      
    case 'findNextMove':
      // Vypočítaj ďalší pohyb pre auto
      const nextMove = findNextMove(data.currentCell)
      self.postMessage({
        type: 'nextMove',
        data: {
          carId: data.carId,
          target: nextMove
        }
      })
      break
      
    case 'batchFindNextMove':
      // Vypočítaj ďalší pohyb pre viacero áut naraz
      const moves = data.cars.map(car => ({
        carId: car.id,
        target: findNextMove(car.currentCell)
      }))
      self.postMessage({
        type: 'batchNextMoves',
        data: moves
      })
      break
  }
}

/**
 * Nájde ďalší tile kam sa má auto presunúť
 */
function findNextMove(currentCell) {
  // Nájdeme susedné road tiles
  const adjacent = findAdjacentRoadTiles(currentCell.row, currentCell.col)
  
  if (adjacent.length === 0) {
    // Žiadne susedné road tiles - vrátime náhodný
    if (roadTiles.length > 0) {
      return roadTiles[Math.floor(Math.random() * roadTiles.length)]
    }
    return null
  }
  
  // Vyberieme náhodný susedný tile
  return adjacent[Math.floor(Math.random() * adjacent.length)]
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
