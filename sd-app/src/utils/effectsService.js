/**
 * Effects Service - správa vizuálnych efektov (dym, svetlá)
 * Obsahuje funkcie pre vytváranie a správu particle efektov a svetiel
 */

export class EffectsService {
  constructor(scene, config = {}) {
    this.scene = scene
    this.TILE_WIDTH = config.TILE_WIDTH || 64
    this.TILE_HEIGHT = config.TILE_HEIGHT || 32
    
    // Mapa efektov pre jednotlivé budovy
    this.smokeEffects = {}
    this.lightEffects = {}
  }

  /**
   * Výpočet depth pre efekt (rovnaký ako budova + 1)
   */
  calculateEffectDepth(row, col, cellsX = 1, cellsY = 1) {
    const baseR = row + cellsX - 1
    const baseC = col + (cellsY - 1) / 2
    const depthSum = baseR + baseC
    return Math.round(depthSum * 10000 + baseC * 10) + 1
  }

  /**
   * Vytvorí smoke efekt pre budovu
   * @param {number} x - Screen X pozícia
   * @param {number} y - Screen Y pozícia
   * @param {string} key - Unikátny kľúč budovy
   * @param {Object} options - Nastavenia efektu
   * @returns {Phaser.GameObjects.Particles.ParticleEmitter} - Particle emitter
   */
  createSmokeEffect(x, y, key, options = {}) {
    const {
      speed = 1,
      scale = 1,
      alpha = 0.5,
      tint = 1,
      row = 0,
      col = 0,
      cellsX = 1,
      cellsY = 1
    } = options

    if (!this.scene.textures.exists('smoke')) {
      console.warn('⚠️ Smoke textúra nie je načítaná')
      return null
    }

    // Základné hodnoty
    const baseSpeedY = { min: -100, max: -200 }
    const baseSpeedX = { min: -20, max: 20 }
    const baseFrequency = 100
    const baseLifespan = 3000
    const baseScaleStart = 0.2
    const baseScaleEnd = 1.5

    // Aplikujeme tint pre tmavosť
    const tintColor = Phaser.Display.Color.GetColor(
      Math.min(255, 255 * tint),
      Math.min(255, 255 * tint),
      Math.min(255, 255 * tint)
    )

    const particles = this.scene.add.particles(x, y, 'smoke', {
      speedY: { 
        min: baseSpeedY.min * speed, 
        max: baseSpeedY.max * speed 
      },
      speedX: { 
        min: baseSpeedX.min * speed, 
        max: baseSpeedX.max * speed 
      },
      scale: { 
        start: baseScaleStart * scale, 
        end: baseScaleEnd * scale 
      },
      alpha: { start: alpha, end: 0 },
      lifespan: baseLifespan / speed,
      blendMode: 'SCREEN',
      frequency: baseFrequency / speed,
      rotate: { min: 0, max: 360 },
      tint: tintColor
    })

    // Nastavíme depth
    const depth = this.calculateEffectDepth(row, col, cellsX, cellsY)
    particles.setDepth(depth)
    
    // Uložíme referenciu
    this._addEffect(key, particles)
    
    console.log(`💨 Smoke effect vytvorený: speed=${speed}x, scale=${scale}x, alpha=${alpha}, tint=${tint}x, depth=${depth}`)
    
    return particles
  }

  /**
   * Vytvorí blikajúci svetelný efekt
   * @param {number} x - Screen X pozícia
   * @param {number} y - Screen Y pozícia
   * @param {string} key - Unikátny kľúč budovy
   * @param {Object} options - Nastavenia efektu
   * @returns {Phaser.GameObjects.Graphics} - Graphics objekt
   */
  createLightEffect(x, y, key, options = {}) {
    const {
      blinkSpeed = 1,
      color = 0xffff00,
      size = 1,
      row = 0,
      col = 0,
      cellsX = 1,
      cellsY = 1
    } = options

    // Parsuj farbu ak je string
    let lightColor = color
    if (typeof color === 'string') {
      lightColor = parseInt(color.replace('#', ''), 16)
    }
    
    // Vytvoríme grafický objekt pre svetlo
    const lightGraphics = this.scene.add.graphics()
    lightGraphics.setPosition(x, y + 17)
    
    // Nakreslíme svetelný kruh
    const baseRadius = 0.5
    const radius = baseRadius * size
    lightGraphics.fillStyle(lightColor, 1)
    lightGraphics.fillCircle(0, 0, radius)
    
    // Pridáme jemný glow efekt
    const glowRadius = radius + (0.5 * size)
    lightGraphics.fillStyle(lightColor, 0.5)
    lightGraphics.fillCircle(0, 0, glowRadius)
    
    // Nastavíme depth
    const depth = this.calculateEffectDepth(row, col, cellsX, cellsY)
    lightGraphics.setDepth(depth)
    
    // Vytvoríme blikací efekt
    const blinkDuration = Math.max(200, 1000 / blinkSpeed)
    
    this.scene.tweens.add({
      targets: lightGraphics,
      alpha: { from: 1, to: 0.2 },
      duration: blinkDuration,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1
    })
    
    // Uložíme referenciu
    this._addEffect(key, lightGraphics)
    
    console.log(`💡 Light effect vytvorený: blinkSpeed=${blinkSpeed}, color=${color}, duration=${blinkDuration}ms`)
    return lightGraphics
  }

  /**
   * Pridá efekt do mapy
   * @private
   */
  _addEffect(key, effect) {
    if (!this.smokeEffects[key]) {
      this.smokeEffects[key] = []
    } else if (!Array.isArray(this.smokeEffects[key])) {
      this.smokeEffects[key] = [this.smokeEffects[key]]
    }
    
    this.smokeEffects[key].push(effect)
  }

  /**
   * Odstráni všetky efekty pre danú budovu
   * @param {string} key - Kľúč budovy
   */
  removeEffects(key) {
    if (this.smokeEffects[key]) {
      const effects = Array.isArray(this.smokeEffects[key]) 
        ? this.smokeEffects[key] 
        : [this.smokeEffects[key]]
      
      effects.forEach(effect => {
        if (effect && typeof effect.destroy === 'function') {
          effect.destroy()
        }
      })
      
      delete this.smokeEffects[key]
    }
  }

  /**
   * Odstráni všetky efekty
   */
  removeAllEffects() {
    for (const key in this.smokeEffects) {
      this.removeEffects(key)
    }
  }

  /**
   * Získa efekty pre budovu
   * @param {string} key - Kľúč budovy
   * @returns {Array} - Pole efektov
   */
  getEffects(key) {
    return this.smokeEffects[key] || []
  }
}

export default EffectsService
