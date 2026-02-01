/**
 * Road Service - správa cestných dlaždíc a pathfindingu
 * Obsahuje funkcie pre stavbu ciest a hľadanie ciest
 */

export class RoadService {
  constructor(scene, config = {}) {
    this.scene = scene
    this.TILE_WIDTH = config.TILE_WIDTH || 64
    this.TILE_HEIGHT = config.TILE_HEIGHT || 32
    this.GRID_SIZE = config.GRID_SIZE || 50
    
    // Dáta ciest
    this.cellImages = config.cellImages || {}
    
    // Road building state
    this.roadStartCell = null
    this.roadPath = []
    this.roadPathGraphics = null
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
   * Začne stavbu cesty
   * @param {number} row - Začiatočný riadok
   * @param {number} col - Začiatočný stĺpec
   */
  startRoadBuilding(row, col) {
    this.roadStartCell = { row, col }
    this.roadPath = []
    console.log(`🛣️ Road building started at [${row}, ${col}]`)
  }

  /**
   * Aktualizuje cestu k cieľovej bunke
   * @param {Object} endCell - {row, col} cieľová bunka
   * @returns {Array} - Pole buniek cesty
   */
  updateRoadPath(endCell) {
    if (!this.roadStartCell) return []
    
    const path = []
    const startRow = this.roadStartCell.row
    const startCol = this.roadStartCell.col
    const endRow = endCell.row
    const endCol = endCell.col
    
    // Zisti vzdialenosti v oboch smeroch
    const rowDiff = Math.abs(endRow - startRow)
    const colDiff = Math.abs(endCol - startCol)
    
    // Určíme orientáciu cesty
    const isVertical = rowDiff >= colDiff
    
    if (isVertical) {
      // Vertikálna cesta
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
        path.push({ 
          row: startRow, 
          col: startCol, 
          direction: 'vertical',
          fromDir: null,
          toDir: null
        })
      }
    } else {
      // Horizontálna cesta
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
        path.push({ 
          row: startRow, 
          col: startCol, 
          direction: 'horizontal',
          fromDir: null,
          toDir: null
        })
      }
    }
    
    // Určíme smery pre každý segment
    this._calculateDirections(path)
    
    this.roadPath = path
    return path
  }

  /**
   * Vypočíta smery pre segmenty cesty
   * @private
   */
  _calculateDirections(path) {
    for (let i = 0; i < path.length; i++) {
      const prev = path[i - 1]
      const curr = path[i]
      const next = path[i + 1]
      
      // Odkiaľ prichádza
      if (prev) {
        if (prev.row < curr.row) curr.fromDir = 'N'
        else if (prev.row > curr.row) curr.fromDir = 'S'
        else if (prev.col < curr.col) curr.fromDir = 'W'
        else if (prev.col > curr.col) curr.fromDir = 'E'
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
  }

  /**
   * Určí typ tile podľa smeru
   * @param {string} fromDir - Smer odkiaľ (N, S, E, W)
   * @param {string} toDir - Smer kam
   * @param {string} defaultDirection - Predvolený smer
   * @returns {string} - Typ tile
   */
  determineTileType(fromDir, toDir, defaultDirection) {
    if (!fromDir && !toDir) {
      return defaultDirection === 'horizontal' ? 'straight_h' : 'straight_v'
    }
    
    if (!fromDir || !toDir) {
      const dir = fromDir || toDir
      if (dir === 'N' || dir === 'S') return 'straight_v'
      return 'straight_h'
    }
    
    const combo = fromDir + toDir
    
    // Rovné cesty
    if (combo === 'NS' || combo === 'SN') return 'straight_v'
    if (combo === 'WE' || combo === 'EW') return 'straight_h'
    
    // Rohy
    if (combo === 'NE' || combo === 'EN') return 'corner_SW'
    if (combo === 'NW' || combo === 'WN') return 'corner_SE'
    if (combo === 'SE' || combo === 'ES') return 'corner_NW'
    if (combo === 'SW' || combo === 'WS') return 'corner_NE'
    
    return defaultDirection === 'horizontal' ? 'straight_h' : 'straight_v'
  }

  /**
   * Nakreslí preview cesty
   * @param {Phaser.GameObjects.Container} container - Kontajner pre grafiku
   */
  drawRoadPath(container) {
    if (this.roadPathGraphics) {
      this.roadPathGraphics.destroy()
    }
    
    if (this.roadPath.length === 0) return
    
    this.roadPathGraphics = this.scene.add.graphics()
    if (container) {
      container.add(this.roadPathGraphics)
    }
    
    for (const cell of this.roadPath) {
      const { x, y } = this.gridToScreen(cell.row, cell.col)
      
      // Modrá farba pre preview
      this.roadPathGraphics.fillStyle(0x667eea, 0.5)
      this.roadPathGraphics.beginPath()
      this.roadPathGraphics.moveTo(x, y)
      this.roadPathGraphics.lineTo(x + this.TILE_WIDTH / 2, y + this.TILE_HEIGHT / 2)
      this.roadPathGraphics.lineTo(x, y + this.TILE_HEIGHT)
      this.roadPathGraphics.lineTo(x - this.TILE_WIDTH / 2, y + this.TILE_HEIGHT / 2)
      this.roadPathGraphics.closePath()
      this.roadPathGraphics.fillPath()
      
      this.roadPathGraphics.lineStyle(3, 0x667eea, 1)
      this.roadPathGraphics.strokePath()
    }
  }

  /**
   * Vyčistí stav road buildingu
   */
  clearRoadBuilding() {
    this.roadStartCell = null
    this.roadPath = []
    if (this.roadPathGraphics) {
      this.roadPathGraphics.destroy()
      this.roadPathGraphics = null
    }
  }

  /**
   * Získa aktuálnu cestu
   * @returns {Array}
   */
  getRoadPath() {
    return this.roadPath
  }

  /**
   * Získa štartovú bunku
   * @returns {Object|null}
   */
  getStartCell() {
    return this.roadStartCell
  }

  /**
   * Kontroluje či je bunka cestou
   * @param {number} row - Riadok
   * @param {number} col - Stĺpec
   * @returns {boolean}
   */
  isRoadTile(row, col) {
    const key = `${row}-${col}`
    return this.cellImages[key]?.isRoadTile === true
  }

  /**
   * Získa všetky cestné bunky
   * @returns {Array} - Pole {row, col} objektov
   */
  getAllRoadTiles() {
    const roads = []
    for (const key in this.cellImages) {
      if (this.cellImages[key]?.isRoadTile) {
        const [row, col] = key.split('-').map(Number)
        roads.push({ row, col })
      }
    }
    return roads
  }

  /**
   * Nájde susedné cestné bunky
   * @param {number} row - Riadok
   * @param {number} col - Stĺpec
   * @returns {Array} - Pole susedných cestných buniek
   */
  getAdjacentRoads(row, col) {
    const directions = [
      { dr: -1, dc: 0 }, // N
      { dr: 1, dc: 0 },  // S
      { dr: 0, dc: -1 }, // W
      { dr: 0, dc: 1 }   // E
    ]
    
    return directions
      .map(({ dr, dc }) => ({ row: row + dr, col: col + dc }))
      .filter(cell => this.isRoadTile(cell.row, cell.col))
  }
}

export default RoadService
