/**
 * Phaser Services - centrálny export pre všetky servisy izometrickej scény
 * 
 * Použitie:
 * import { BuildingService, EffectsService, ShadowService, GridService, RoadService } from '../utils/phaserServices'
 * 
 * alebo:
 * import * as PhaserServices from '../utils/phaserServices'
 */

export { BuildingService } from './buildingService.js'
export { EffectsService } from './effectsService.js'
export { ShadowService } from './shadowService.js'
export { GridService } from './gridService.js'
export { RoadService } from './roadService.js'

// Už existujúce servisy
export { PersonManager } from './personManager.js'
export { CarManager } from './carManager.js'

/**
 * Konfigurácia pre izometrickú scénu
 */
export const DEFAULT_CONFIG = {
  TILE_WIDTH: 64,
  TILE_HEIGHT: 32,
  GRID_SIZE: 50
}

/**
 * Pomocná funkcia pre výpočet depth
 * Používa footprint sort point metódu
 * 
 * @param {number} row - Riadok (top-left)
 * @param {number} col - Stĺpec (top-left)
 * @param {number} cellsX - Počet buniek v X smere
 * @param {number} cellsY - Počet buniek v Y smere
 * @returns {number} - Depth hodnota
 */
export function calculateDepth(row, col, cellsX = 1, cellsY = 1) {
  const baseR = row + cellsX - 1
  const baseC = col + (cellsY - 1) / 2
  const depthSum = baseR + baseC
  return Math.round(depthSum * 10000 + baseC * 10)
}

/**
 * Konverzia grid súradníc na screen súradnice
 * 
 * @param {number} row - Riadok
 * @param {number} col - Stĺpec
 * @param {Object} config - {TILE_WIDTH, TILE_HEIGHT}
 * @returns {Object} - {x, y} screen pozícia
 */
export function gridToScreen(row, col, config = DEFAULT_CONFIG) {
  const x = (col - row) * (config.TILE_WIDTH / 2)
  const y = (col + row) * (config.TILE_HEIGHT / 2)
  return { x, y }
}

/**
 * Konverzia screen súradníc na grid súradnice
 * 
 * @param {number} screenX - Screen X
 * @param {number} screenY - Screen Y
 * @param {Object} config - {TILE_WIDTH, TILE_HEIGHT}
 * @returns {Object} - {row, col} grid pozícia
 */
export function screenToGrid(screenX, screenY, config = DEFAULT_CONFIG) {
  const col = Math.floor((screenX / (config.TILE_WIDTH / 2) + screenY / (config.TILE_HEIGHT / 2)) / 2)
  const row = Math.floor((screenY / (config.TILE_HEIGHT / 2) - screenX / (config.TILE_WIDTH / 2)) / 2)
  return { row, col }
}
