/**
 * PersonManager - Správa pohyblivých postáv v izometrickom svete
 * Používa Web Worker pre výpočty aby neblokoval hlavné vlákno
 */

export class PersonManager {
  constructor(scene, cellImages, config = {}) {
    this.scene = scene
    this.cellImages = cellImages
    this.persons = []
    
    // Konfigurácia
    this.personCount = config.personCount || 20
    this.TILE_WIDTH = config.TILE_WIDTH || 64
    this.TILE_HEIGHT = config.TILE_HEIGHT || 32
    this.moveDuration = config.moveDuration || 2400 // ms
    this.initialDelayRange = config.initialDelayRange || [0, 4000] // [min, max] ms
    
    // Web Worker pre výpočty pohybu
    this.worker = new Worker(new URL('./personWorker.js', import.meta.url), { type: 'module' })
    this.workerReady = false
    
    // Callback mapy pre async operácie
    this.pendingMoves = new Map()
    
    // Inicializujeme worker
    this.initWorker()
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
          console.log('🔧 Person Worker initialized')
          break
          
        case 'nextMove':
          // Aplikujeme pohyb na osobu
          this.applyMove(data.personId, data.target)
          break
          
        case 'batchNextMoves':
          // Aplikujeme batch pohybov
          data.forEach(move => {
            this.applyMove(move.personId, move.target)
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
   * Vytvorí všetky osoby na náhodných road tiles
   */
  createPersons() {
    // Ak už osoby existujú, len ich aktualizujeme
    if (this.persons.length > 0) {
      this.updateAllPersonsPosition()
      return
    }
    
    // Nájdeme všetky road tiles
    const allRoadTiles = this.getAllRoadTiles()
    if (allRoadTiles.length === 0) {
      console.log('🚶 Žiadne road tiles, osoby sa nevytvoria')
      return
    }
    
    // Vytvoríme viaceré osoby
    for (let i = 0; i < this.personCount; i++) {
      // Náhodný road tile pre každú osobu
      const randomTile = Phaser.Utils.Array.GetRandom(allRoadTiles)
      
      // Vytvoríme sprite pre osobu
      const personSprite = this.scene.add.sprite(0, 0, 'person')
      personSprite.setScale(0.25)
      personSprite.setOrigin(0.5, 1)
      
      // Vytvoríme tieň
      const personShadow = this.scene.add.sprite(0, 0, 'person')
      personShadow.setDepth(0.6)
      personShadow.setOrigin(0.5, 1)
      personShadow.setTint(0x000000)
      personShadow.setAlpha(0.35)
      personShadow.setAngle(-90)
      personShadow.setScale(0.25 * 0.7, 0.25 * 0.4)
      
      const { x, y } = this.gridToIso(randomTile.row, randomTile.col)
      personSprite.setPosition(x, y + this.TILE_HEIGHT / 2)
      personSprite.setVisible(true)
      
      // Depth založený na pozícii - rovnaký systém ako budovy ale o 1 nižší
      const personDepth = 99 + (randomTile.row + randomTile.col)
      personSprite.setDepth(personDepth)
      
      // Aktualizujeme pozíciu tieňa
      const shadowOffsetX = 4
      const shadowOffsetY = 2
      personShadow.setPosition(x + shadowOffsetX, y + shadowOffsetY)
      personShadow.setVisible(true)
      
      // Uložíme do poľa
      const person = {
        id: `person_${i}`, // Unikátne ID pre komunikáciu s worker-om
        sprite: personSprite,
        shadow: personShadow,
        currentCell: { row: randomTile.row, col: randomTile.col },
        targetCell: null,
        moveTween: null,
        moveTimer: null
      }
      
      this.persons.push(person)
      
      // Spustíme náhodný pohyb s náhodným delayom
      const [minDelay, maxDelay] = this.initialDelayRange
      const initialDelay = Phaser.Math.Between(minDelay, maxDelay)
      this.scene.time.delayedCall(initialDelay, () => {
        this.startPersonMovement(person)
      })
    }
    
    console.log(`🚶 Vytvorených ${this.persons.length} osôb`)
    
    // Aktualizujeme worker s aktuálnymi road tiles
    this.updateWorkerRoadTiles()
  }

  /**
   * Aktualizuje pozíciu všetkých osôb
   */
  updateAllPersonsPosition() {
    if (this.persons.length === 0) return
    
    const allRoadTiles = this.getAllRoadTiles()
    if (allRoadTiles.length === 0) {
      // Ak už nie sú žiadne road tiles, skryjeme všetky osoby
      this.persons.forEach(person => {
        person.sprite.setVisible(false)
        person.shadow.setVisible(false)
        this.stopPersonMovement(person)
      })
      return
    }
    
    // Ukážeme osoby ak sú skryté
    this.persons.forEach(person => {
      if (!person.sprite.visible) {
        const randomTile = Phaser.Utils.Array.GetRandom(allRoadTiles)
        person.currentCell = { row: randomTile.row, col: randomTile.col }
        const { x, y } = this.gridToIso(randomTile.row, randomTile.col)
        person.sprite.setPosition(x, y + this.TILE_HEIGHT / 2)
        person.sprite.setVisible(true)
        person.shadow.setVisible(true)
        this.startPersonMovement(person)
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
   * Začne pohyb osoby - deleguje výpočet na worker
   */
  startPersonMovement(person) {
    if (!person || !person.sprite || !person.currentCell) return
    
    // Okamžite začneme pohyb - worker vypočíta ďalší tile
    this.requestNextMove(person)
  }
  
  /**
   * Požiada worker o výpočet ďalšieho pohybu
   */
  requestNextMove(person) {
    if (!this.workerReady) {
      // Ak worker nie je ready, skúsime neskôr
      setTimeout(() => this.requestNextMove(person), 100)
      return
    }
    
    this.worker.postMessage({
      type: 'findNextMove',
      data: {
        personId: person.id,
        currentCell: person.currentCell
      }
    })
  }
  
  /**
   * Aplikuje pohyb vypočítaný worker-om
   */
  applyMove(personId, target) {
    const person = this.persons.find(p => p.id === personId)
    if (!person || !target) return
    
    this.movePersonToTarget(person, target)
  }

  /**
   * Presunie osobu na zadaný tile (vypočítaný worker-om)
   */
  movePersonToTarget(person, target) {
    if (!person || !person.sprite || !target) return
    
    const { x: targetX, y: targetY } = this.gridToIso(target.row, target.col)
    
    // Animujeme pohyb
    person.moveTween = this.scene.tweens.add({
      targets: person.sprite,
      x: targetX,
      y: targetY + this.TILE_HEIGHT / 2,
      duration: this.moveDuration,
      ease: 'Linear',
      onUpdate: () => {
        // Aktualizujeme pozíciu tieňa počas pohybu
        const shadowOffsetX = 4
        const shadowOffsetY = 2
        person.shadow.setPosition(person.sprite.x + shadowOffsetX, person.sprite.y + shadowOffsetY)
        
        // Aktualizujeme depth počas pohybu pre plynulé zobrazovanie za budovami
        const currentPos = this.isoToGrid(person.sprite.x, person.sprite.y - this.TILE_HEIGHT / 2)
        const newDepth = 99 + (currentPos.row + currentPos.col)
        person.sprite.setDepth(newDepth)
      },
      onComplete: () => {
        person.currentCell = target
        // Nastavíme finálny depth
        const finalDepth = 99 + (target.row + target.col)
        person.sprite.setDepth(finalDepth)
        // Okamžite požiadame o ďalší pohyb
        this.requestNextMove(person)
      }
    })
  }

  /**
   * Zastaví pohyb osoby
   */
  stopPersonMovement(person) {
    if (person.moveTimer) {
      person.moveTimer.remove()
      person.moveTimer = null
    }
    if (person.moveTween) {
      person.moveTween.stop()
      person.moveTween = null
    }
  }

  /**
   * Zapne/vypne viditeľnosť všetkých osôb
   */
  togglePersons(visible) {
    this.persons.forEach(person => {
      if (visible) {
        person.sprite.setVisible(true)
        person.shadow.setVisible(true)
        // Reštartujeme pohyb ak bol zastavený
        if (!person.moveTimer) {
          this.startPersonMovement(person)
        }
      } else {
        person.sprite.setVisible(false)
        person.shadow.setVisible(false)
        this.stopPersonMovement(person)
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
   * Zničí všetky osoby a uvoľní pamäť
   */
  destroy() {
    this.persons.forEach(person => {
      this.stopPersonMovement(person)
      if (person.sprite) person.sprite.destroy()
      if (person.shadow) person.shadow.destroy()
    })
    this.persons = []
    
    // Ukončíme worker
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
  }

  /**
   * Získa počet osôb
   */
  getPersonCount() {
    return this.persons.length
  }

  /**
   * Nastaví rýchlosť pohybu osôb
   */
  setMoveDuration(duration) {
    this.moveDuration = duration
  }
}
