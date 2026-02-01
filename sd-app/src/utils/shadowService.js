/**
 * Shadow Service - správa tieňov budov
 * Obsahuje funkcie pre vytváranie a renderovanie tieňov do RenderTexture
 */

export class ShadowService {
  constructor(scene, config = {}) {
    this.scene = scene
    this.TILE_WIDTH = config.TILE_WIDTH || 64
    this.TILE_HEIGHT = config.TILE_HEIGHT || 32
    this.GRID_SIZE = config.GRID_SIZE || 50
    
    // Mapa tieňov
    this.shadowSprites = scene.shadowSprites || {}
    
    // RenderTexture pre tiene
    this.shadowRenderTexture = null
    
    // Offsety pre rôzne veľkosti budov
    this.shadowOffsets = {
      '1x1': { x: 44, y: -23 },
      '2x2': { x: 89, y: -45 },
      '3x3': { x: 138, y: -68 },
      '4x4': { x: 180, y: -89 },
      '5x5': { x: 219, y: -112 },
      // Špeciálne offsety pre stromy
      'tree1x1': { x: 26, y: -11 },
      'tree2x2': { x: 44, y: -19 },
      'tree3x3': { x: 75, y: -32 },
      'tree4x4': { x: 100, y: -45 },
      'tree5x5': { x: 125, y: -58 }
    }
  }

  /**
   * Inicializuje RenderTexture pre tiene
   * @param {number} depth - Depth hodnota pre tiene
   */
  initRenderTexture(depth = 999000) {
    this.shadowRenderTexture = this.scene.add.renderTexture(0, 0, 4000, 4000)
    this.shadowRenderTexture.setOrigin(0.5, 0.5)
    this.shadowRenderTexture.setPosition(0, this.GRID_SIZE * this.TILE_HEIGHT / 2)
    this.shadowRenderTexture.setAlpha(0.25)
    this.shadowRenderTexture.setDepth(depth)
    
    return this.shadowRenderTexture
  }

  /**
   * Pridá info o tieni pre budovu
   * @param {string} key - Kľúč budovy
   * @param {Object} shadowInfo - Informácie o tieni
   */
  addShadow(key, shadowInfo) {
    this.shadowSprites[key] = shadowInfo
  }

  /**
   * Odstráni tieň pre budovu
   * @param {string} key - Kľúč budovy
   */
  removeShadow(key) {
    if (this.shadowSprites[key]) {
      delete this.shadowSprites[key]
    }
  }

  /**
   * Prekreslí všetky tiene do RenderTexture
   */
  redrawAllShadows() {
    requestAnimationFrame(() => {
      this.performShadowRedraw()
    })
  }

  /**
   * Prekreslí tiene len pre budovu a jej susedov
   * @param {number} centerRow - Stredový riadok
   * @param {number} centerCol - Stredový stĺpec
   */
  redrawShadowsAround(centerRow, centerCol) {
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

  /**
   * Skutočné prekreslenie tieňov
   */
  performShadowRedraw() {
    if (!this.shadowRenderTexture) return
    
    // Vyčistíme RenderTexture
    this.shadowRenderTexture.clear()
    
    // Offset pre RenderTexture (stred je na 2000, 2000)
    const rtOffsetX = 2000
    const rtOffsetY = 2000 - this.GRID_SIZE * this.TILE_HEIGHT / 2
    
    // Nakreslíme všetky tiene
    for (const key in this.shadowSprites) {
      this._drawShadow(key, rtOffsetX, rtOffsetY)
    }
  }

  /**
   * Prekreslí tiene len pre vybrané kľúče
   * @param {Array} keys - Pole kľúčov
   */
  performShadowRedrawForKeys(keys) {
    if (!this.shadowRenderTexture) return
    
    const rtOffsetX = 2000
    const rtOffsetY = 2000 - this.GRID_SIZE * this.TILE_HEIGHT / 2

    keys.forEach(key => {
      this._drawShadow(key, rtOffsetX, rtOffsetY)
    })
  }

  /**
   * Nakreslí tieň pre jednu budovu
   * @private
   */
  _drawShadow(key, rtOffsetX, rtOffsetY) {
    const shadowInfo = this.shadowSprites[key]
    if (!shadowInfo || !shadowInfo.textureKey) return
    
    if (!this.scene.textures.exists(shadowInfo.textureKey)) return
    
    const drawX = shadowInfo.x + shadowInfo.offsetX + rtOffsetX
    const drawY = shadowInfo.y + shadowInfo.offsetY + rtOffsetY
    
    // Vytvoríme dočasný sprite
    const tempSprite = this.scene.make.sprite({
      key: shadowInfo.textureKey,
      add: false
    })
    
    // Nastavíme scale pre tieň
    const shadowScaleX = shadowInfo.scale * 0.45
    const shadowScaleY = shadowInfo.scale * 1.3
    
    tempSprite.setScale(shadowScaleX, shadowScaleY)
    tempSprite.setOrigin(0.5, 1)
    tempSprite.setAngle(-90)
    tempSprite.setTint(0x000000)
    tempSprite.setAlpha(1)
    
    // Získame správne offsety
    const cellsX = shadowInfo.cellsX || 1
    const isTree = shadowInfo.isTree || false
    const sizeKey = isTree ? `tree${cellsX}x${cellsX}` : `${cellsX}x${cellsX}`
    const offsets = this.shadowOffsets[sizeKey] || this.shadowOffsets[`${cellsX}x${cellsX}`] || this.shadowOffsets['1x1']
    
    // Nakreslíme do RenderTexture
    this.shadowRenderTexture.draw(tempSprite, drawX + offsets.x, drawY + offsets.y)
    
    tempSprite.destroy()
  }

  /**
   * Získa offset pre tieň podľa veľkosti
   * @param {number} cellsX - Veľkosť budovy
   * @param {boolean} isTree - Či je to strom
   * @returns {Object} - {x, y} offset
   */
  getOffsetForSize(cellsX, isTree = false) {
    const sizeKey = isTree ? `tree${cellsX}x${cellsX}` : `${cellsX}x${cellsX}`
    return this.shadowOffsets[sizeKey] || this.shadowOffsets[`${cellsX}x${cellsX}`] || this.shadowOffsets['1x1']
  }

  /**
   * Nastaví vlastný offset pre veľkosť
   * @param {string} sizeKey - Kľúč veľkosti (napr. '3x3')
   * @param {Object} offset - {x, y} offset
   */
  setOffsetForSize(sizeKey, offset) {
    this.shadowOffsets[sizeKey] = offset
  }
}

export default ShadowService
