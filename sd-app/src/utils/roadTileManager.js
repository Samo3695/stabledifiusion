/**
 * Road Tile Manager
 * Samostatný manager pre road tiles - načítava a spravuje road tiles bez závislosti na UI komponentoch
 */

class RoadTileManager {
  constructor() {
    this.tiles = []
    this.spriteUrl = '/templates/roads/sprites/pastroad.png'
    this.opacity = 100
    this.isLoading = false
  }

  /**
   * Načíta road tiles zo sprite sheetu
   * @param {string} spriteUrl - URL sprite sheetu
   * @param {number} opacity - Opacity (0-100)
   * @returns {Promise<Array>} - Pole road tiles
   */
  async loadTiles(spriteUrl = null, opacity = 100) {
    if (spriteUrl) {
      this.spriteUrl = spriteUrl
    }
    this.opacity = opacity

    if (this.isLoading) {
      console.log('⚠️ RoadTileManager: Už prebieha načítavanie tiles')
      return this.tiles
    }

    this.isLoading = true
    console.log('🛣️ RoadTileManager: Načítavam road tiles...', this.spriteUrl.substring(0, 50))

    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'

      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d', { willReadFrequently: true })

          // Tile definície (rovnaké ako v ImageGallery)
          const tileDefinitions = [
            { name: 'Rovná ↘', x: 570, y: 266, width: 205, height: 105, rotation: 10 },
            { name: 'Rovná ↙', x: 20, y: 152, width: 205, height: 105, rotation: 0 },
            { name: 'Roh ↙', x: 580, y: 413, width: 205, height: 105, rotation: 0},
            { name: 'Roh ↘', x: 727, y: 342, width: 205, height: 105, rotation: 0 },
            { name: 'Roh ↖', x: 309, y: 275, width: 205, height: 105, rotation: 0 },
            { name: 'Roh ↗', x: 437, y: 78, width: 205, height: 105, rotation: 0 },
            { name: 'T ↖', x: 576, y: 146, width: 205, height: 105, rotation: 0 },
            { name: 'T ↘', x: 176, y: 73, width: 205, height: 105, rotation: 0 },
            { name: 'T ↗', x: 313, y: 141, width: 205, height: 105, rotation: 1 },
            { name: 'T ↙', x: 726, y: 74, width: 205, height: 105, rotation: 0 },
            { name: 'Križovatka +', x: 449, y: 206, width: 205, height: 105, rotation: 0 },
            { name: 'Koniec', x: 768, y: 384, width: 256, height: 128, rotation: 0 },
          ]

          const TILE_WIDTH = 200
          const TILE_HEIGHT = 100
          const tiles = []

          for (let i = 0; i < tileDefinitions.length; i++) {
            const def = tileDefinitions[i]
            canvas.width = TILE_WIDTH
            canvas.height = TILE_HEIGHT
            ctx.clearRect(0, 0, TILE_WIDTH, TILE_HEIGHT)

            // Vytvor izometrickú masku
            ctx.save()
            ctx.beginPath()
            ctx.moveTo(TILE_WIDTH / 2, 0)
            ctx.lineTo(TILE_WIDTH, TILE_HEIGHT / 2)
            ctx.lineTo(TILE_WIDTH / 2, TILE_HEIGHT)
            ctx.lineTo(0, TILE_HEIGHT / 2)
            ctx.closePath()
            ctx.clip()

            // Nakresli tile
            const scale = TILE_WIDTH / def.width
            const scaledHeight = def.height * scale
            const offsetY = (TILE_HEIGHT - scaledHeight) / 2
            
            ctx.drawImage(
              img,
              def.x, def.y, def.width, def.height,
              0, offsetY, TILE_WIDTH, scaledHeight
            )
            
            ctx.restore()

            // Aplikuj opacity ak je menej ako 100%
            if (this.opacity < 100) {
              const imageData = ctx.getImageData(0, 0, TILE_WIDTH, TILE_HEIGHT)
              const data = imageData.data
              const alpha = this.opacity / 100

              for (let j = 3; j < data.length; j += 4) {
                data[j] = Math.floor(data[j] * alpha)
              }

              ctx.putImageData(imageData, 0, 0)
            }

            const dataUrl = canvas.toDataURL('image/png')

            // Vytvor bitmap
            let bitmap = null
            try {
              const blob = await fetch(dataUrl).then(r => r.blob())
              bitmap = await createImageBitmap(blob)
            } catch (e) {
              console.warn('⚠️ Nemožno vytvoriť bitmap pre tile', i)
            }

            tiles.push({
              id: `road_tile_${i}`,
              name: def.name,
              url: dataUrl,
              tileIndex: i,
              x: def.x,
              y: def.y,
              width: def.width,
              height: def.height,
              rotation: def.rotation,
              opacity: this.opacity,
              bitmap: bitmap
            })
          }

          this.tiles = tiles
          this.isLoading = false
          console.log(`✅ RoadTileManager: Načítaných ${tiles.length} road tiles`)
          resolve(tiles)

        } catch (error) {
          this.isLoading = false
          console.error('❌ RoadTileManager: Chyba pri načítaní tiles:', error)
          reject(error)
        }
      }

      img.onerror = (error) => {
        this.isLoading = false
        console.error('❌ RoadTileManager: Chyba pri načítaní sprite:', error)
        reject(error)
      }

      img.src = this.spriteUrl
    })
  }

  /**
   * Získa tile podľa smeru
   * @param {string} direction - 'horizontal' alebo 'vertical'
   * @returns {Object|null}
   */
  getTileByDirection(direction) {
    const tileName = direction === 'horizontal' ? 'Rovná ↘' : 'Rovná ↙'
    return this.tiles.find(t => t.name === tileName) || null
  }

  /**
   * Získa tile podľa indexu
   * @param {number} tileIndex
   * @returns {Object|null}
   */
  getTileByIndex(tileIndex) {
    return this.tiles.find(t => t.tileIndex === tileIndex) || null
  }

  /**
   * Získa všetky tiles
   * @returns {Array}
   */
  getTiles() {
    return this.tiles
  }

  /**
   * Zmení opacity a regeneruje tiles
   * @param {number} newOpacity - Nová opacity (0-100)
   * @returns {Promise<Array>}
   */
  async changeOpacity(newOpacity) {
    if (newOpacity === this.opacity) {
      return this.tiles
    }

    console.log(`🎨 RoadTileManager: Mením opacity z ${this.opacity}% na ${newOpacity}%`)
    return await this.loadTiles(this.spriteUrl, newOpacity)
  }
}

// Singleton instance
const roadTileManager = new RoadTileManager()

export default roadTileManager
