/**
 * Grid Service - správa izometrickej mriežky
 * Obsahuje funkcie pre kreslenie mriežky, konverziu súradníc a hover efekty
 */

export class GridService {
  constructor(scene, config = {}) {
    this.scene = scene
    this.TILE_WIDTH = config.TILE_WIDTH || 64
    this.TILE_HEIGHT = config.TILE_HEIGHT || 32
    this.GRID_SIZE = config.GRID_SIZE || 50
    
    // Grafické objekty
    this.gridGraphics = null
    this.hoverGraphics = null
    this.selectedGraphics = null
    this.numberTexts = []
  }

  /**
   * Konverzia grid súradníc na screen súradnice
   * @param {number} row - Riadok
   * @param {number} col - Stĺpec
   * @returns {Object} - {x, y} screen pozícia
   */
  gridToScreen(row, col) {
    const x = (col - row) * (this.TILE_WIDTH / 2)
    const y = (col + row) * (this.TILE_HEIGHT / 2)
    return { x, y }
  }

  /**
   * Konverzia screen súradníc na grid súradnice
   * @param {number} screenX - Screen X
   * @param {number} screenY - Screen Y
   * @returns {Object} - {row, col} grid pozícia
   */
  screenToGrid(screenX, screenY) {
    const col = Math.floor((screenX / (this.TILE_WIDTH / 2) + screenY / (this.TILE_HEIGHT / 2)) / 2)
    const row = Math.floor((screenY / (this.TILE_HEIGHT / 2) - screenX / (this.TILE_WIDTH / 2)) / 2)
    return { row, col }
  }

  /**
   * Kontroluje či je pozícia v rámci gridu
   * @param {number} row - Riadok
   * @param {number} col - Stĺpec
   * @returns {boolean}
   */
  isInBounds(row, col) {
    return row >= 0 && row < this.GRID_SIZE && col >= 0 && col < this.GRID_SIZE
  }

  /**
   * Získa pozíciu bunky z pointer eventu
   * @param {Phaser.Input.Pointer} pointer - Pointer objekt
   * @returns {Object|null} - {row, col} alebo null ak mimo gridu
   */
  getCellFromPointer(pointer) {
    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y)
    const cell = this.screenToGrid(worldPoint.x, worldPoint.y)
    
    if (this.isInBounds(cell.row, cell.col)) {
      return cell
    }
    return null
  }

  /**
   * Nakreslí základnú mriežku (bez textúry)
   * @param {boolean} showNumbering - Či zobrazovať číslovanie
   * @param {Phaser.GameObjects.Container} uiContainer - Kontajner pre UI elementy
   */
  drawGrid(showNumbering = true, uiContainer = null) {
    // Vyčistíme existujúcu mriežku
    if (this.gridGraphics) {
      this.gridGraphics.destroy()
    }
    
    // Vyčistíme čísla
    this.numberTexts.forEach(t => t.destroy())
    this.numberTexts = []
    
    this.gridGraphics = this.scene.add.graphics()
    this.gridGraphics.setDepth(1)
    
    for (let row = 0; row < this.GRID_SIZE; row++) {
      for (let col = 0; col < this.GRID_SIZE; col++) {
        const { x, y } = this.gridToScreen(row, col)
        
        // Vyplnenie
        this.gridGraphics.fillStyle(0xcccccc, 0.3)
        this.gridGraphics.beginPath()
        this.gridGraphics.moveTo(x, y)
        this.gridGraphics.lineTo(x + this.TILE_WIDTH / 2, y + this.TILE_HEIGHT / 2)
        this.gridGraphics.lineTo(x, y + this.TILE_HEIGHT)
        this.gridGraphics.lineTo(x - this.TILE_WIDTH / 2, y + this.TILE_HEIGHT / 2)
        this.gridGraphics.closePath()
        this.gridGraphics.fillPath()
        
        // Okraj
        this.gridGraphics.lineStyle(1, 0x999999, 0.5)
        this.gridGraphics.strokePath()
        
        // Číslovanie
        if (showNumbering && uiContainer) {
          const text = this.scene.add.text(x, y + this.TILE_HEIGHT / 2, `${row},${col}`, {
            fontSize: '10px',
            color: '#ff0000',
            fontStyle: 'bold'
          })
          text.setOrigin(0.5, 0.5)
          text.setDepth(999999)
          uiContainer.add(text)
          this.numberTexts.push(text)
        }
      }
    }
  }

  /**
   * Nakreslí hover efekt pre bunku
   * @param {number} row - Riadok
   * @param {number} col - Stĺpec
   * @param {number} cellsX - Počet buniek v X
   * @param {number} cellsY - Počet buniek v Y
   * @param {number} color - Farba (hex)
   * @param {Phaser.GameObjects.Container} uiContainer - Kontajner pre UI
   */
  drawHover(row, col, cellsX = 1, cellsY = 1, color = 0x4a90d9, uiContainer = null) {
    if (this.hoverGraphics) {
      this.hoverGraphics.destroy()
      this.hoverGraphics = null
    }
    
    if (row < 0 || col < 0) return
    
    this.hoverGraphics = this.scene.add.graphics()
    this.hoverGraphics.lineStyle(3, color, 1)
    
    // Nakreslíme obrys pre všetky bunky
    const points = this._getMultiCellOutline(row, col, cellsX, cellsY)
    
    this.hoverGraphics.beginPath()
    this.hoverGraphics.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
      this.hoverGraphics.lineTo(points[i].x, points[i].y)
    }
    this.hoverGraphics.closePath()
    this.hoverGraphics.strokePath()
    
    // Pridáme výplň s priehľadnosťou
    this.hoverGraphics.fillStyle(color, 0.3)
    this.hoverGraphics.fillPath()
    
    if (uiContainer) {
      uiContainer.add(this.hoverGraphics)
    }
  }

  /**
   * Nakreslí selection efekt pre bunku
   * @param {number} row - Riadok
   * @param {number} col - Stĺpec
   * @param {Phaser.GameObjects.Container} uiContainer - Kontajner pre UI
   */
  drawSelected(row, col, uiContainer = null) {
    if (this.selectedGraphics) {
      this.selectedGraphics.destroy()
    }
    
    if (row < 0 || col < 0) return
    
    const { x, y } = this.gridToScreen(row, col)
    
    this.selectedGraphics = this.scene.add.graphics()
    this.selectedGraphics.lineStyle(3, 0x00ff00, 1)
    
    this.selectedGraphics.beginPath()
    this.selectedGraphics.moveTo(x, y)
    this.selectedGraphics.lineTo(x + this.TILE_WIDTH / 2, y + this.TILE_HEIGHT / 2)
    this.selectedGraphics.lineTo(x, y + this.TILE_HEIGHT)
    this.selectedGraphics.lineTo(x - this.TILE_WIDTH / 2, y + this.TILE_HEIGHT / 2)
    this.selectedGraphics.closePath()
    this.selectedGraphics.strokePath()
    
    if (uiContainer) {
      uiContainer.add(this.selectedGraphics)
    }
  }

  /**
   * Získa body obrysu pre multi-cell objekt
   * @private
   */
  _getMultiCellOutline(row, col, cellsX, cellsY) {
    const topLeft = this.gridToScreen(row, col)
    const topRight = this.gridToScreen(row, col + cellsY)
    const bottomRight = this.gridToScreen(row + cellsX, col + cellsY)
    const bottomLeft = this.gridToScreen(row + cellsX, col)
    
    return [
      { x: topLeft.x, y: topLeft.y },
      { x: topRight.x + this.TILE_WIDTH / 2, y: topRight.y - this.TILE_HEIGHT / 2 + this.TILE_HEIGHT },
      { x: bottomRight.x, y: bottomRight.y },
      { x: bottomLeft.x - this.TILE_WIDTH / 2, y: bottomLeft.y - this.TILE_HEIGHT / 2 + this.TILE_HEIGHT }
    ]
  }

  /**
   * Vyčistí hover grafiku
   */
  clearHover() {
    if (this.hoverGraphics) {
      this.hoverGraphics.destroy()
      this.hoverGraphics = null
    }
  }

  /**
   * Vyčistí selection grafiku
   */
  clearSelected() {
    if (this.selectedGraphics) {
      this.selectedGraphics.destroy()
      this.selectedGraphics = null
    }
  }

  /**
   * Vyčistí číslovanie
   */
  clearNumbering() {
    this.numberTexts.forEach(t => t.destroy())
    this.numberTexts = []
  }

  /**
   * Znovu nakreslí číslovanie
   * @param {boolean} show - Či zobraziť
   * @param {Phaser.GameObjects.Container} uiContainer - Kontajner pre UI
   */
  updateNumbering(show, uiContainer) {
    this.clearNumbering()
    
    if (!show) return
    
    for (let row = 0; row < this.GRID_SIZE; row++) {
      for (let col = 0; col < this.GRID_SIZE; col++) {
        const { x, y } = this.gridToScreen(row, col)
        
        const text = this.scene.add.text(x, y + this.TILE_HEIGHT / 2, `${row},${col}`, {
          fontSize: '10px',
          color: '#ff0000',
          fontStyle: 'bold'
        })
        text.setOrigin(0.5, 0.5)
        text.setDepth(999999)
        
        if (uiContainer) {
          uiContainer.add(text)
        }
        this.numberTexts.push(text)
      }
    }
  }
}

export default GridService
