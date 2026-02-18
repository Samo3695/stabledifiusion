/**
 * CarDispatchService - Univerzálny service na dispatchovanie najbližšieho auta k cieľovej pozícii
 * 
 * Použitie:
 * - Nájde najbližšie auto k cieľovej budove (podľa BFS vzdialenosti na cestách)
 * - Zastaví auto, nasmeruje ho k budove najkratšou trasou po cestách
 * - Auto zíde z cesty k budove, vykoná akciu, a vráti sa späť na cestu
 * 
 * Tento service je znovupoužiteľný pre rôzne scenáre (stavba budov, dodávky, atď.)
 */

const TILE_WIDTH = 64
const TILE_HEIGHT = 32

/**
 * Konverzia grid súradníc na izometrické
 */
function gridToIso(row, col) {
  const x = (col - row) * (TILE_WIDTH / 2)
  const y = (col + row) * (TILE_HEIGHT / 2)
  return { x, y }
}

/**
 * Nájde najbližší road tile k cieľovej pozícii (Manhattan distance v grid priestore)
 * @param {number} targetRow - Riadok cieľovej budovy
 * @param {number} targetCol - Stĺpec cieľovej budovy
 * @param {Object} cellImages - Mapa všetkých tiles na canvase
 * @returns {{ row: number, col: number } | null}
 */
function findNearestRoadTileToTarget(targetRow, targetCol, cellImages) {
  let nearest = null
  let minDist = Infinity

  for (const key in cellImages) {
    const cell = cellImages[key]
    if (!cell.isRoadTile || cell.isSecondary) continue
    const [row, col] = key.split('-').map(Number)
    const dist = Math.abs(row - targetRow) + Math.abs(col - targetCol)
    if (dist < minDist) {
      minDist = dist
      nearest = { row, col }
    }
  }

  return nearest
}

/**
 * BFS najkratšia cesta medzi dvoma road tiles
 * @param {number} startRow
 * @param {number} startCol
 * @param {number} endRow
 * @param {number} endCol
 * @param {Object} cellImages
 * @returns {Array<{row, col}>} - Cesta od start po end (vrátane oboch)
 */
function findShortestRoadPath(startRow, startCol, endRow, endCol, cellImages) {
  const startKey = `${startRow}-${startCol}`
  const endKey = `${endRow}-${endCol}`
  
  if (startKey === endKey) return [{ row: startRow, col: startCol }]

  const visited = new Set()
  const queue = [{ row: startRow, col: startCol, path: [{ row: startRow, col: startCol }] }]
  visited.add(startKey)

  const directions = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 }
  ]

  while (queue.length > 0) {
    const current = queue.shift()

    for (const dir of directions) {
      const nr = current.row + dir.dr
      const nc = current.col + dir.dc
      const nKey = `${nr}-${nc}`

      if (visited.has(nKey)) continue
      
      // Cieľový tile nemusí byť road - posledný krok
      if (nr === endRow && nc === endCol) {
        return [...current.path, { row: nr, col: nc }]
      }

      // Len road tiles
      if (cellImages[nKey] && cellImages[nKey].isRoadTile) {
        visited.add(nKey)
        queue.push({
          row: nr,
          col: nc,
          path: [...current.path, { row: nr, col: nc }]
        })
      }
    }
  }

  // Cesta nenájdená - vráti priamu cestu (len start a end)
  return [{ row: startRow, col: startCol }, { row: endRow, col: endCol }]
}

/**
 * Nájde najbližšie auto k cieľovej pozícii
 * Počíta BFS vzdialenosť po cestách od aktuálnej pozície auta k najbližšiemu road tile pri budove
 * 
 * @param {Array} cars - Pole áut z carManager.cars
 * @param {number} targetRow - Riadok cieľovej budovy
 * @param {number} targetCol - Stĺpec cieľovej budovy
 * @param {Object} cellImages - Mapa tiles
 * @returns {{ car: Object, nearestRoad: {row, col}, path: Array } | null}
 */
export function findNearestCar(cars, targetRow, targetCol, cellImages) {
  if (!cars || cars.length === 0) return null

  // Nájdi najbližší road tile k budove
  const nearestRoad = findNearestRoadTileToTarget(targetRow, targetCol, cellImages)
  if (!nearestRoad) return null

  let bestCar = null
  let bestPath = null
  let bestDist = Infinity

  for (const car of cars) {
    if (!car.sprite || !car.sprite.visible) continue
    // Preskočíme autá ktoré sú už dispatchované
    if (car.dispatched) continue

    const carRow = car.currentCell.row
    const carCol = car.currentCell.col

    // BFS cesta od auta k najbližšiemu road tile pri budove
    const path = findShortestRoadPath(carRow, carCol, nearestRoad.row, nearestRoad.col, cellImages)
    
    if (path.length < bestDist) {
      bestDist = path.length
      bestCar = car
      bestPath = path
    }
  }

  if (!bestCar) return null

  return {
    car: bestCar,
    nearestRoad,
    path: bestPath
  }
}

/**
 * Dispatchne auto k cieľovej budove
 * Auto ide po ceste k najbližšiemu road tile pri budove,
 * potom zíde z cesty k budove, vykoná callback, a vráti sa na cestu
 * 
 * @param {Object} scene - Phaser scéna
 * @param {Object} car - Auto objekt z carManager
 * @param {Array<{row, col}>} roadPath - Cesta po road tiles
 * @param {{row: number, col: number}} nearestRoad - Najbližší road tile k budove
 * @param {number} targetRow - Cieľový riadok budovy
 * @param {number} targetCol - Cieľový stĺpec budovy
 * @param {Object} options - Nastavenia
 * @param {Function} options.onArrive - Callback keď auto príde k budove
 * @param {Function} options.onReturn - Callback keď sa auto vráti na cestu
 * @param {number} options.moveSpeed - Rýchlosť pohybu na tile (ms), default 400
 * @param {number} options.waitAtBuilding - Čas čakania pri budove (ms), default 0 (čaká na signal)
 * @param {Object} options.carManager - CarManager referencia pre reštart pohybu
 */
export function dispatchCarToBuilding(scene, car, roadPath, nearestRoad, targetRow, targetCol, options = {}) {
  const {
    onArrive = null,
    onReturn = null,
    moveSpeed = 400,
    waitAtBuilding = 0,
    carManager = null
  } = options

  // Označ auto ako dispatchované
  car.dispatched = true

  // Zastav aktuálny pohyb auta
  if (car.moveTween) {
    car.moveTween.stop()
    car.moveTween = null
  }
  if (car.moveTimer) {
    car.moveTimer.remove()
    car.moveTimer = null
  }

  console.log(`🚗 Dispatch: Auto ${car.id} ide k budove [${targetRow}, ${targetCol}], cesta: ${roadPath.length} tiles`)

  // Animuj pohyb po ceste tile-by-tile
  let pathIndex = 0

  const moveAlongPath = () => {
    pathIndex++
    if (pathIndex >= roadPath.length) {
      // Dorazili sme k najbližšiemu road tile - teraz zídeme k budove
      moveToBuilding()
      return
    }

    const nextTile = roadPath[pathIndex]
    const { x, y } = gridToIso(nextTile.row, nextTile.col)

    // Nastav správnu textúru podľa smeru
    const deltaRow = nextTile.row - car.currentCell.row
    const deltaCol = nextTile.col - car.currentCell.col
    if (deltaCol !== 0 && deltaRow === 0) {
      car.sprite.setTexture('car2')
      car.shadow.setTexture('car2')
    } else if (deltaRow !== 0 && deltaCol === 0) {
      car.sprite.setTexture('car1')
      car.shadow.setTexture('car1')
    }

    car.moveTween = scene.tweens.add({
      targets: car.sprite,
      x: x,
      y: y + TILE_HEIGHT / 2,
      duration: moveSpeed,
      ease: 'Linear',
      onUpdate: () => {
        car.shadow.setPosition(car.sprite.x + (car.shadowOffsetX ?? 4), car.sprite.y + (car.shadowOffsetY ?? 2))
        const depth = 99 + (nextTile.row + nextTile.col)
        car.sprite.setDepth(depth)
      },
      onComplete: () => {
        car.currentCell = { row: nextTile.row, col: nextTile.col }
        moveAlongPath()
      }
    })
  }

  const moveToBuilding = () => {
    // Pohyb z road tile k budove (off-road)
    const { x: buildX, y: buildY } = gridToIso(targetRow, targetCol)

    // Nastav textúru podľa smeru
    const deltaRow = targetRow - car.currentCell.row
    const deltaCol = targetCol - car.currentCell.col
    if (Math.abs(deltaCol) >= Math.abs(deltaRow)) {
      car.sprite.setTexture('car2')
      car.shadow.setTexture('car2')
    } else {
      car.sprite.setTexture('car1')
      car.shadow.setTexture('car1')
    }

    car.moveTween = scene.tweens.add({
      targets: car.sprite,
      x: buildX,
      y: buildY + TILE_HEIGHT / 2,
      duration: moveSpeed * 1.5, // Trochu pomalšie mimo cestu
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        car.shadow.setPosition(car.sprite.x + (car.shadowOffsetX ?? 4), car.sprite.y + (car.shadowOffsetY ?? 2))
        car.sprite.setDepth(100 + targetRow + targetCol)
      },
      onComplete: () => {
        console.log(`🚗 Auto ${car.id} dorazilo k budove [${targetRow}, ${targetCol}]`)
        
        // Callback - auto dorazilo
        if (onArrive) {
          onArrive()
        }

        // Ak je nastavený wait time, auto sa vráti po danom čase
        // Ak nie, čaká na manuálne zavolanie returnCar
        if (waitAtBuilding > 0) {
          scene.time.delayedCall(waitAtBuilding, () => {
            returnToRoad()
          })
        } else {
          // Uložíme return funkciu na auto objekt pre manuálne volanie
          car._returnToRoad = returnToRoad
        }
      }
    })
  }

  const returnToRoad = () => {
    // Pohyb späť na najbližší road tile
    const { x: roadX, y: roadY } = gridToIso(nearestRoad.row, nearestRoad.col)

    // Nastav textúru podľa smeru
    const deltaRow = nearestRoad.row - targetRow
    const deltaCol = nearestRoad.col - targetCol
    if (Math.abs(deltaCol) >= Math.abs(deltaRow)) {
      car.sprite.setTexture('car2')
      car.shadow.setTexture('car2')
    } else {
      car.sprite.setTexture('car1')
      car.shadow.setTexture('car1')
    }

    car.moveTween = scene.tweens.add({
      targets: car.sprite,
      x: roadX,
      y: roadY + TILE_HEIGHT / 2,
      duration: moveSpeed * 1.5,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        car.shadow.setPosition(car.sprite.x + (car.shadowOffsetX ?? 4), car.sprite.y + (car.shadowOffsetY ?? 2))
      },
      onComplete: () => {
        car.currentCell = { row: nearestRoad.row, col: nearestRoad.col }
        car.dispatched = false
        delete car._returnToRoad

        console.log(`🚗 Auto ${car.id} sa vrátilo na cestu [${nearestRoad.row}, ${nearestRoad.col}]`)

        // Callback
        if (onReturn) {
          onReturn()
        }

        // Reštart normálneho pohybu
        if (carManager) {
          carManager.startCarMovement(car)
        }
      }
    })
  }

  // Spusti pohyb po ceste
  if (roadPath.length <= 1) {
    // Auto je už na správnom tile - rovno k budove
    moveToBuilding()
  } else {
    moveAlongPath()
  }

  // Vrátime objekt s control funkciami
  return {
    /** Vráť auto na cestu s animáciou (volaj po dokončení akcie pri budove) */
    returnCar: () => {
      returnToRoad()
    },
    /** Okamžite teleportuj auto na cestu bez animácie */
    instantReturn: () => {
      // Zastav prípadný aktuálny tween
      if (car.moveTween) {
        car.moveTween.stop()
        car.moveTween = null
      }
      // Teleport na nearest road s malým náhodným offsetom aby sa autá nezlievali
      const { x: roadX, y: roadY } = gridToIso(nearestRoad.row, nearestRoad.col)
      const offsetX = (Math.random() - 0.5) * 16 // -8 až +8 px
      const offsetY = (Math.random() - 0.5) * 8  // -4 až +4 px
      car.sprite.setPosition(roadX + offsetX, roadY + TILE_HEIGHT / 2 + offsetY)
      car.shadow.setPosition(roadX + offsetX + (car.shadowOffsetX ?? 4), roadY + TILE_HEIGHT / 2 + offsetY + (car.shadowOffsetY ?? 2))
      car.currentCell = { row: nearestRoad.row, col: nearestRoad.col }
      car.dispatched = false
      delete car._returnToRoad
      console.log(`🚗⚡ Auto ${car.id} okamžite vrátené na cestu [${nearestRoad.row}, ${nearestRoad.col}]`)
      if (onReturn) onReturn()
      if (carManager) carManager.startCarMovement(car)
    },
    /** Zastav dispatch (emergency) */
    cancel: () => {
      if (car.moveTween) {
        car.moveTween.stop()
        car.moveTween = null
      }
      car.dispatched = false
      delete car._returnToRoad
      if (carManager) {
        carManager.startCarMovement(car)
      }
    }
  }
}
