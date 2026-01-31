/**
 * CarManager - Správa pohyblivých áut v izometrickom svete
 * Používa Web Worker pre výpočty aby neblokoval hlavné vlákno
 */

export class CarManager {
  constructor(scene, cellImages, config = {}) {
    this.scene = scene
    this.cellImages = cellImages
    this.cars = []
    this.carIdSeq = 0
    
    // Konfigurácia
    this.carCount = config.carCount || 20
    this.TILE_WIDTH = config.TILE_WIDTH || 64
    this.TILE_HEIGHT = config.TILE_HEIGHT || 32
    this.moveDuration = config.moveDuration || 60600 // ms (spomalené o polovicu)
    this.initialDelayRange = config.initialDelayRange || [0, 4000] // [min, max] ms
    
    // Web Worker pre výpočty pohybu
    this.worker = new Worker(new URL('./carWorker.js', import.meta.url), { type: 'module' })
    this.workerReady = false
    
    // Callback mapy pre async operácie
    this.pendingMoves = new Map()
    
    // Inicializujeme worker
    this.initWorker()
  }

  generateCarId() {
    const id = `car_${this.carIdSeq}`
    this.carIdSeq += 1
    return id
  }

  /**
   * Inicializuje Web Worker
   */
  initWorker() {
    this.worker.onmessage = (e) => {
      const { type, data } = e.data
      
      switch (type) {
        case 'initialized':
          this.workerReady = true
          console.log('🔧 Car Worker initialized')
          break
          
        case 'nextMove':
          // Aplikujeme pohyb na auto
          this.applyMove(data.carId, data.target)
          break
          
        case 'batchNextMoves':
          // Aplikujeme batch pohybov
          data.forEach(move => {
            this.applyMove(move.carId, move.target)
          })
          break
      }
    }
    
    // Inicializujeme worker s konfiguráciou
    this.worker.postMessage({
      type: 'init',
      data: {
        TILE_WIDTH: this.TILE_WIDTH,
        TILE_HEIGHT: this.TILE_HEIGHT,
        roadTiles: this.getAllRoadTiles()
      }
    })
  }
  
  /**
   * Aktualizuje road tiles vo worker-i
   */
  updateWorkerRoadTiles() {
    if (this.workerReady) {
      this.worker.postMessage({
        type: 'updateRoadTiles',
        data: {
          roadTiles: this.getAllRoadTiles()
        }
      })
    }
  }

  /**
   * Vytvorí všetky autá na náhodných road tiles
   */
  createCars() {
    // Ak už autá existujú, len ich aktualizujeme
    if (this.cars.length > 0) {
      this.updateAllCarsPosition()
      return
    }
    
    // Nájdeme všetky road tiles
    const allRoadTiles = this.getAllRoadTiles()
    if (allRoadTiles.length === 0) {
      console.log('🚗 Žiadne road tiles, autá sa nevytvoria')
      return
    }
    
    // Vytvoríme viaceré autá
    for (let i = 0; i < this.carCount; i++) {
      const randomTile = Phaser.Utils.Array.GetRandom(allRoadTiles)
      this.spawnSingleCarAt(randomTile.row, randomTile.col)
    }
    
    console.log(`🚗 Vytvorených ${this.cars.length} áut`)
    
    // Aktualizujeme worker s aktuálnymi road tiles
    this.updateWorkerRoadTiles()
  }

  spawnSingleCarAt(row, col) {
    const { x, y } = this.gridToIso(row, col)

    const carSprite = this.scene.add.sprite(0, 0, 'car1')
    carSprite.setScale(0.0700) // 2x menšie ako pôvodné (0.167 / 2)
    carSprite.setOrigin(0.5, 1)

    const carShadow = this.scene.add.sprite(0, 0, 'car1')
    carShadow.setDepth(0.6)
    carShadow.setOrigin(0.5, 1)
    carShadow.setTint(0x000000)
    carShadow.setAlpha(0.35)
    carShadow.setAngle(-90)
    carShadow.setScale(0.0835 * 0.7, 0.0835 * 0.4) // Úmerne zmenšený tieň

    carSprite.setPosition(x, y + this.TILE_HEIGHT / 2)
    carSprite.setVisible(true)

    const carDepth = 99 + (row + col)
    carSprite.setDepth(carDepth)

    const shadowOffsetX = 4
    const shadowOffsetY = 2
    carShadow.setPosition(x + shadowOffsetX, y + shadowOffsetY)
    carShadow.setVisible(true)

    const car = {
      id: this.generateCarId(),
      sprite: carSprite,
      shadow: carShadow,
      currentCell: { row, col },
      targetCell: null,
      moveTween: null,
      moveTimer: null
    }

    this.cars.push(car)

    const [minDelay, maxDelay] = this.initialDelayRange
    const initialDelay = Phaser.Math.Between(minDelay, maxDelay)
    this.scene.time.delayedCall(initialDelay, () => {
      this.startCarMovement(car)
    })
  }

  createCarsAtTile(count = 1, row, col) {
    const key = `${row}-${col}`
    const tile = this.cellImages[key]
    if (!tile || !tile.isRoadTile) {
      console.warn('🚫 createCarsAtTile: tile nie je road, spawn preskočený', key)
      return
    }

    const safeCount = Math.max(0, Math.min(500, Math.round(count)))
    if (safeCount === 0) return

    for (let i = 0; i < safeCount; i++) {
      this.spawnSingleCarAt(row, col)
    }

    this.updateWorkerRoadTiles()
  }

  /**
   * Aktualizuje pozíciu všetkých áut
   */
  updateAllCarsPosition() {
    if (this.cars.length === 0) return
    
    const allRoadTiles = this.getAllRoadTiles()
    if (allRoadTiles.length === 0) {
      // Ak už nie sú žiadne road tiles, skryjeme všetky autá
      this.cars.forEach(car => {
        car.sprite.setVisible(false)
        car.shadow.setVisible(false)
        this.stopCarMovement(car)
      })
      return
    }
    
    // Ukážeme autá ak sú skryté
    this.cars.forEach(car => {
      if (!car.sprite.visible) {
        const randomTile = Phaser.Utils.Array.GetRandom(allRoadTiles)
        car.currentCell = { row: randomTile.row, col: randomTile.col }
        const { x, y } = this.gridToIso(randomTile.row, randomTile.col)
        car.sprite.setPosition(x, y + this.TILE_HEIGHT / 2)
        car.sprite.setVisible(true)
        car.shadow.setVisible(true)
        this.startCarMovement(car)
      }
    })
  }

  /**
   * Nájde prvý road tile v cellImages
   */
  findFirstRoadTile() {
    for (const key in this.cellImages) {
      const img = this.cellImages[key]
      if (img.isRoadTile) {
        const [row, col] = key.split('-').map(Number)
        return { row, col }
      }
    }
    return null
  }

  /**
   * Vráti všetky road tiles
   */
  getAllRoadTiles() {
    const roadTiles = []
    for (const key in this.cellImages) {
      const img = this.cellImages[key]
      if (img.isRoadTile) {
        const [row, col] = key.split('-').map(Number)
        roadTiles.push({ row, col })
      }
    }
    return roadTiles
  }

  /**
   * Nájde susedné road tiles (hore, dole, vľavo, vpravo)
   * DEPRECATED - používa sa už len pre kompatibilitu, výpočet je vo worker-i
   */
  findAdjacentRoadTiles(row, col) {
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
      const key = `${newRow}-${newCol}`
      
      if (this.cellImages[key] && this.cellImages[key].isRoadTile) {
        adjacent.push({ row: newRow, col: newCol })
      }
    }
    
    return adjacent
  }

  /**
   * Začne pohyb auta - deleguje výpočet na worker
   */
  startCarMovement(car) {
    if (!car || !car.sprite || !car.currentCell) return
    
    // Okamžite začneme pohyb - worker vypočíta ďalší tile
    this.requestNextMove(car)
  }
  
  /**
   * Požiada worker o výpočet ďalšieho pohybu
   */
  requestNextMove(car) {
    if (!this.workerReady) {
      // Ak worker nie je ready, skúsime neskôr
      setTimeout(() => this.requestNextMove(car), 100)
      return
    }
    
    this.worker.postMessage({
      type: 'findNextMove',
      data: {
        carId: car.id,
        currentCell: car.currentCell
      }
    })
  }
  
  /**
   * Aplikuje pohyb vypočítaný worker-om
   */
  applyMove(carId, target) {
    const car = this.cars.find(c => c.id === carId)
    if (!car || !target) return
    
    this.moveCarToTarget(car, target)
  }

  /**
   * Presunie auto na zadaný tile (vypočítaný worker-om)
   */
  moveCarToTarget(car, target) {
    if (!car || !car.sprite || !target) return
    
    const { x: targetX, y: targetY } = this.gridToIso(target.row, target.col)
    
    // Vypočítaj smer pohybu pre výber správnej textúry
    const deltaRow = target.row - car.currentCell.row
    const deltaCol = target.col - car.currentCell.col
    
    // Nastav správnu textúru podľa smeru pohybu
    // Ak sa mení row (pohyb po Y izometrickej ploche) = car1 (car-dawn-top-right.png)
    // Ak sa mení col (pohyb po X izometrickej ploche) = car2 (car-down-top-left.png)
    if (deltaCol !== 0 && deltaRow === 0) {
      // Pohyb po col (X osi) - použiť car2
      car.sprite.setTexture('car2')
      car.shadow.setTexture('car2')
    } else if (deltaRow !== 0 && deltaCol === 0) {
      // Pohyb po row (Y osi) - použiť car1
      car.sprite.setTexture('car1')
      car.shadow.setTexture('car1')
    }
    
    // Animujeme pohyb
    car.moveTween = this.scene.tweens.add({
      targets: car.sprite,
      x: targetX,
      y: targetY + this.TILE_HEIGHT / 2,
      duration: this.moveDuration,
      ease: 'Linear',
      onUpdate: () => {
        // Aktualizujeme pozíciu tieňa počas pohybu
        const shadowOffsetX = 4
        const shadowOffsetY = 2
        car.shadow.setPosition(car.sprite.x + shadowOffsetX, car.sprite.y + shadowOffsetY)
        
        // Aktualizujeme depth počas pohybu pre plynulé zobrazovanie za budovami
        const currentPos = this.isoToGrid(car.sprite.x, car.sprite.y - this.TILE_HEIGHT / 2)
        const newDepth = 99 + (currentPos.row + currentPos.col)
        car.sprite.setDepth(newDepth)
      },
      onComplete: () => {
        car.currentCell = target
        // Nastavíme finálny depth
        const finalDepth = 99 + (target.row + target.col)
        car.sprite.setDepth(finalDepth)
        // Okamžite požiadame o ďalší pohyb
        this.requestNextMove(car)
      }
    })
  }

  /**
   * Zastaví pohyb auta
   */
  stopCarMovement(car) {
    if (car.moveTimer) {
      car.moveTimer.remove()
      car.moveTimer = null
    }
    if (car.moveTween) {
      car.moveTween.stop()
      car.moveTween = null
    }
  }

  /**
   * Zapne/vypne viditeľnosť všetkých áut
   */
  toggleCars(visible) {
    this.cars.forEach(car => {
      if (visible) {
        car.sprite.setVisible(true)
        car.shadow.setVisible(true)
        // Reštartujeme pohyb ak bol zastavený
        if (!car.moveTimer) {
          this.startCarMovement(car)
        }
      } else {
        car.sprite.setVisible(false)
        car.shadow.setVisible(false)
        this.stopCarMovement(car)
      }
    })
  }

  /**
   * Konverzia grid súradníc na izometrické
   */
  gridToIso(row, col) {
    const x = (col - row) * (this.TILE_WIDTH / 2)
    const y = (col + row) * (this.TILE_HEIGHT / 2)
    return { x, y }
  }

  /**
   * Konverzia izometrických súradníc na grid
   */
  isoToGrid(x, y) {
    const col = (x / (this.TILE_WIDTH / 2) + y / (this.TILE_HEIGHT / 2)) / 2
    const row = (y / (this.TILE_HEIGHT / 2) - x / (this.TILE_WIDTH / 2)) / 2
    return { row: Math.floor(row), col: Math.floor(col) }
  }

  /**
   * Zničí všetky autá a uvoľní pamäť
   */
  destroy() {
    this.cars.forEach(car => {
      this.stopCarMovement(car)
      if (car.sprite) car.sprite.destroy()
      if (car.shadow) car.shadow.destroy()
    })
    this.cars = []
    
    // Ukončíme worker
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
  }

  /**
   * Získa počet áut
   */
  getCarCount() {
    return this.cars.length
  }

  /**
   * Nastaví rýchlosť pohybu áut
   */
  setMoveDuration(duration) {
    this.moveDuration = duration
  }
}
