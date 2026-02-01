/**
 * Building Service - správa budov v izometrickej scéne
 * Obsahuje funkcie pre pridávanie, odoberanie a sorting budov
 */

export class BuildingService {
  constructor(scene, config = {}) {
    this.scene = scene
    this.TILE_WIDTH = config.TILE_WIDTH || 64
    this.TILE_HEIGHT = config.TILE_HEIGHT || 32
    this.GRID_SIZE = config.GRID_SIZE || 50
    
    // Referencie na dátové štruktúry scény
    this.buildingSprites = scene.buildingSprites
    this.shadowSprites = scene.shadowSprites
    this.cellImages = config.cellImages || {}
  }

  /**
   * Konverzia grid súradníc na screen súradnice
   */
  gridToScreen(row, col) {
    const x = (col - row) * (this.TILE_WIDTH / 2)
    const y = (col + row) * (this.TILE_HEIGHT / 2)
    return { x, y }
  }

  /**
   * Výpočet depth pre budovu na základe footprint sort point
   * @param {number} row - Riadok (top-left)
   * @param {number} col - Stĺpec (top-left)
   * @param {number} cellsX - Počet buniek v X smere
   * @param {number} cellsY - Počet buniek v Y smere
   * @returns {number} - Depth hodnota
   */
  calculateDepth(row, col, cellsX = 1, cellsY = 1) {
    // Footprint sort point - spodná hrana footprintu
    // baseR = spodný riadok footprintu (r + h - 1)
    // baseC = stred spodnej hrany footprintu (c + (w-1)/2)
    // Primárne: vyšší súčet (baseR + baseC) = bližšie k pozorovateľovi = vpredu
    // Sekundárne: pri rovnakom súčte, vyšší baseC = vpredu
    const baseR = row + cellsX - 1  // spodný riadok
    const baseC = col + (cellsY - 1) / 2  // stred spodnej hrany
    const depthSum = baseR + baseC
    return Math.round(depthSum * 10000 + baseC * 10)
  }

  /**
   * Zoradí všetky budovy podľa ich depth
   */
  sortBuildings() {
    for (const key in this.buildingSprites) {
      const [row, col] = key.split('-').map(Number)
      
      // Získame veľkosť budovy z cellImages
      const imageData = this.cellImages[key]
      const cellsX = imageData?.cellsX || 1
      const cellsY = imageData?.cellsY || 1
      
      // Preskočíme road tiles - tie majú fixný depth 0.5
      if (imageData?.isRoadTile) {
        continue
      }
      
      const depth = this.calculateDepth(row, col, cellsX, cellsY)
      this.buildingSprites[key].setDepth(depth)
      
      console.log(`🏠 Building ${key}: row=${row}, col=${col}, cellsX=${cellsX}, cellsY=${cellsY}, depth=${depth}`)
    }
  }

  /**
   * Kontrola kolízie pre novú budovu
   * @param {number} row - Riadok
   * @param {number} col - Stĺpec
   * @param {number} cellsX - Počet buniek v X
   * @param {number} cellsY - Počet buniek v Y
   * @returns {boolean} - True ak je kolízia
   */
  checkCollision(row, col, cellsX, cellsY) {
    for (let r = row; r < row + cellsX; r++) {
      for (let c = col; c < col + cellsY; c++) {
        const key = `${r}-${c}`
        const existingImage = this.cellImages[key]
        if (existingImage && !existingImage.isRoadTile && !existingImage.isBackground) {
          return true
        }
      }
    }
    return false
  }

  /**
   * Získa všetky bunky obsadené budovou
   * @param {number} row - Riadok
   * @param {number} col - Stĺpec
   * @param {number} cellsX - Počet buniek v X
   * @param {number} cellsY - Počet buniek v Y
   * @returns {Array} - Pole kľúčov buniek
   */
  getOccupiedCells(row, col, cellsX, cellsY) {
    const cells = []
    for (let r = row; r < row + cellsX; r++) {
      for (let c = col; c < col + cellsY; c++) {
        cells.push(`${r}-${c}`)
      }
    }
    return cells
  }
}

export default BuildingService
