/**
 * Service pre animáciu stavania budov
 */

const BUILDING_ANIMATION_DURATION = 5000 // ms
const TILE_WIDTH = 64
const TILE_HEIGHT = 32

/**
 * Helper funkcia na kreslenie izometrickej masky
 */
function drawIsometricMask(graphics, centerX, bottomY, width, height, maxHeight) {
  graphics.clear()
  graphics.fillStyle(0xffffff)
  if (height <= 0) return
  
  // Vypočítame progress (0 až 1)
  const progress = height / maxHeight
  
  // Izometrický diamant rastie zdola hore
  // Spodný bod je na bottomY, horný bod na bottomY - height
  // Šírka rastie proporcionálne s výškou
  const currentWidth = width * progress
  const currentHeight = height
  
  // Stred diamantu je posunutý tak, aby spodný bod ostal na bottomY
  // a diamant rástol smerom hore
  const diamondCenterY = bottomY - currentHeight / 2
  
  // Nakreslíme izometrický diamant (4 body)
  graphics.beginPath()
  graphics.moveTo(centerX, bottomY) // Spodný bod
  graphics.lineTo(centerX + currentWidth / 2, diamondCenterY) // Pravý bod
  graphics.lineTo(centerX, bottomY - currentHeight) // Horný bod
  graphics.lineTo(centerX - currentWidth / 2, diamondCenterY) // Ľavý bod
  graphics.closePath()
  graphics.fillPath()
}

/**
 * Spustí animáciu stavania budovy
 * @param {Object} scene - Phaser scéna
 * @param {Object} params - Parametre animácie
 */
export function startBuildingAnimation(scene, params) {
  const {
    buildingSprite,
    key,
    x,
    y,
    offsetX,
    offsetY,
    targetWidth,
    cellsX,
    cellsY,
    dontDropShadow,
    shadowSprites,
    redrawShadowsAround,
    row,
    col,
    sortBuildings // Pridáme sortBuildings funkciu
  } = params
  
  // Uložíme si pôvodné rozmery
  const spriteHeight = buildingSprite.displayHeight
  const finalY = buildingSprite.y
  
  // Vypočítame výšku diamantu tile na izometrickej ploche
  const diamondHeight = (cellsX + cellsY) * (TILE_HEIGHT / 2)
  
  // Umiestnime obrazok 0.png na tile pri začiatku animácie
  const tempBuildingKey = `temp_building_${key}_${Date.now()}`
  let tempSprite = null
  let tempSpriteInitialY = 0
  let tempSpriteMaskShape = null
  let tempSpriteHeight = 0
  
  scene.load.image(tempBuildingKey, '/templates/cubes1/0.png')
  scene.load.once('complete', () => {
    tempSprite = scene.add.sprite(x + offsetX, y + TILE_HEIGHT + offsetY, tempBuildingKey)
    const tempScale = targetWidth / tempSprite.width
    tempSprite.setScale(tempScale)
    tempSprite.setOrigin(0.5, 1)
    tempSprite.setDepth(buildingSprite.depth + 2)
    tempSprite.setAlpha(1)
    
    // Uložíme počiatočnú Y pozíciu a výšku
    tempSpriteInitialY = tempSprite.y
    tempSpriteHeight = tempSprite.displayHeight
    
    // Vytvoríme masku pre tempSprite
    tempSpriteMaskShape = scene.make.graphics()
    drawIsometricMask(tempSpriteMaskShape, tempSprite.x, tempSpriteInitialY, tempSprite.displayWidth, 0, tempSpriteHeight)
    const tempMask = tempSpriteMaskShape.createGeometryMask()
    tempSprite.setMask(tempMask)
    
    // Vytvoríme shadowInfo pre tempSprite
    const baseShadowOffset = TILE_WIDTH * cellsX * 0.4
    shadowSprites[tempBuildingKey] = {
      textureKey: tempBuildingKey,
      x: x + offsetX,
      y: y + TILE_HEIGHT + offsetY,
      scale: tempScale,
      scaleMultiplier: 0,
      alpha: 1,
      cellsX,
      isTree: false,
      offsetX: -baseShadowOffset,
      offsetY: baseShadowOffset * 0.375
    }
    
    // Odstránime dočasný sprite po dokončení animácie
    scene.time.delayedCall(BUILDING_ANIMATION_DURATION, () => {
      if (tempSprite) tempSprite.destroy()
      if (tempSpriteMaskShape) tempSpriteMaskShape.destroy()
      if (shadowSprites[tempBuildingKey]) {
        delete shadowSprites[tempBuildingKey]
        redrawShadowsAround(row, col)
      }
    })
  })
  scene.load.start()
  
  // === CONSTRUCT SPRITES ===
  const constructSprites = []
  const constructMasks = []
  
  const originYOffset = -(Math.max(cellsX, cellsY) - 1) * TILE_HEIGHT
  const diamondTips = [
    { name: 'left', x: x + offsetX - (cellsY * TILE_WIDTH) / 2, y: y + offsetY + originYOffset + ((cellsX + cellsY) * TILE_HEIGHT) / 4 },
    { name: 'bottom', x: x + offsetX, y: y + offsetY + originYOffset + ((cellsX + cellsY) * TILE_HEIGHT) / 2 },
    { name: 'right', x: x + offsetX + (cellsY * TILE_WIDTH) / 2, y: y + offsetY + originYOffset + ((cellsX + cellsY) * TILE_HEIGHT) / 4 }
  ]
  
  if (scene.textures.exists('construct') && !dontDropShadow) {
    diamondTips.forEach((tip) => {
      const constructSprite = scene.add.sprite(tip.x, tip.y, 'construct')
      const constructScale = (TILE_WIDTH * 0.2) / constructSprite.width
      constructSprite.setScale(constructScale)
      constructSprite.setOrigin(0.5, 1)
      
      if (tip.name === 'left') {
        constructSprite.x += constructSprite.displayWidth
        constructSprite.y += 5
        constructSprite.x -= 5
      } else if (tip.name === 'right') {
        constructSprite.x -= constructSprite.displayWidth
        constructSprite.y += 5
        constructSprite.x += 5
      }
      
      const constructMaskShape = scene.make.graphics()
      constructMaskShape.fillStyle(0xffffff)
      constructMaskShape.fillRect(
        constructSprite.x - constructSprite.displayWidth / 2,
        constructSprite.y,
        constructSprite.displayWidth,
        0
      )
      const constructMask = constructMaskShape.createGeometryMask()
      constructSprite.setMask(constructMask)
      
      constructSprites.push(constructSprite)
      constructMasks.push({ shape: constructMaskShape, sprite: constructSprite, height: spriteHeight, initialY: constructSprite.y })
    })
  }
  
  // Odstránime construct sprites po dokončení
  scene.time.delayedCall(BUILDING_ANIMATION_DURATION, () => {
    constructSprites.forEach(sprite => { if (sprite) sprite.destroy() })
    constructMasks.forEach(maskInfo => { if (maskInfo.shape) maskInfo.shape.destroy() })
  })
  
  // Nastavíme depth pre construct sprites po sortBuildings
  // Musí sa volať sortBuildings najprv, aby sa depth budovy správne nastavil
  if (sortBuildings) {
    sortBuildings()
  }
  
  // Nastavíme depth pre construct sprites AŽ PO sortBuildings()
  if (constructSprites.length > 0) {
    const finalBuildingDepth = buildingSprite.depth
    constructSprites.forEach(sprite => {
      sprite.setDepth(finalBuildingDepth + 1)
    })
  }
  
  // Vytvoríme masku pre hlavnú budovu
  const maskShape = scene.make.graphics()
  maskShape.fillStyle(0xffffff)
  maskShape.fillRect(
    buildingSprite.x - buildingSprite.displayWidth / 2,
    finalY,
    buildingSprite.displayWidth,
    0
  )
  const mask = maskShape.createGeometryMask()
  buildingSprite.setMask(mask)
  
  // Vytvoríme stavebný dym efekt
  const constructionEffects = createConstructionDustEffect(
    scene,
    buildingSprite.x,
    finalY - spriteHeight,
    buildingSprite.displayWidth,
    spriteHeight
  )
  if (constructionEffects) {
    constructionEffects.setDepth(buildingSprite.depth + 0.2)
  }
  
  // Animujeme výšku masky
  scene.tweens.addCounter({
    from: 0,
    to: spriteHeight,
    duration: BUILDING_ANIMATION_DURATION,
    ease: 'Linear',
    onUpdate: (tween) => {
      const height = tween.getValue()
      maskShape.clear()
      maskShape.fillStyle(0xffffff)
      maskShape.fillRect(
        buildingSprite.x - buildingSprite.displayWidth / 2,
        finalY - height,
        buildingSprite.displayWidth,
        height
      )
      
      // Posúvame efekty dymu
      if (constructionEffects) {
        constructionEffects.setPosition(buildingSprite.x, finalY - height)
      }
      
      // Animujeme construct sprites
      if (!dontDropShadow) {
        constructMasks.forEach(maskInfo => {
          let currentHeight = 0
          const constructPhase3Start = spriteHeight - diamondHeight / 1.2
          
          if (height >= diamondHeight / 2 && height < constructPhase3Start) {
            const constructAnimDuration = constructPhase3Start - diamondHeight / 2
            const progressInConstruct = (height - diamondHeight / 2) / constructAnimDuration
            currentHeight = progressInConstruct * maskInfo.height
          } else if (height >= constructPhase3Start) {
            const phase3Duration = spriteHeight - constructPhase3Start
            const phase3Progress = (height - constructPhase3Start) / phase3Duration
            currentHeight = maskInfo.height * (1 - phase3Progress)
          }
          
          const maskTopY = finalY - height
          const maskBottomY = maskInfo.initialY
          const actualMaskHeight = Math.min(currentHeight, maskBottomY - maskTopY)
          
          maskInfo.shape.clear()
          maskInfo.shape.fillStyle(0xffffff)
          if (actualMaskHeight > 0) {
            maskInfo.shape.fillRect(
              maskInfo.sprite.x - maskInfo.sprite.displayWidth / 2,
              maskBottomY - actualMaskHeight,
              maskInfo.sprite.displayWidth,
              actualMaskHeight
            )
          }
        })
      }
      
      // Animujeme tempSprite (0.png)
      if (tempSprite && tempSpriteMaskShape) {
        if (dontDropShadow) {
          // Pre dontDropShadow: len fáza 1 a 3
          if (height < spriteHeight - diamondHeight / 2.2) {
            tempSprite.y = tempSpriteInitialY
            const phase1Duration = spriteHeight - diamondHeight / 2.2
            const phase1Progress = height / phase1Duration
            const tempMaskHeight = phase1Progress * tempSpriteHeight
            drawIsometricMask(tempSpriteMaskShape, tempSprite.x, tempSpriteInitialY, tempSprite.displayWidth, tempMaskHeight, tempSpriteHeight)
          } else {
            tempSprite.y = tempSpriteInitialY
            const phase3Progress = (height - (spriteHeight - diamondHeight / 2.2)) / (diamondHeight / 2.2)
            const remainingMaskHeight = tempSpriteHeight * (1 - phase3Progress)
            const newBottomY = tempSpriteInitialY - (tempSpriteHeight - remainingMaskHeight)
            drawIsometricMask(tempSpriteMaskShape, tempSprite.x, newBottomY, tempSprite.displayWidth, remainingMaskHeight, tempSpriteHeight)
          }
        } else {
          // Pre normálne budovy: 3 fázy
          if (height < diamondHeight / 2) {
            tempSprite.y = tempSpriteInitialY
            const tempMaskHeight = (height / (diamondHeight / 2)) * tempSpriteHeight
            drawIsometricMask(tempSpriteMaskShape, tempSprite.x, tempSpriteInitialY, tempSprite.displayWidth, tempMaskHeight, tempSpriteHeight)
            
            if (shadowSprites[tempBuildingKey]) shadowSprites[tempBuildingKey].scaleMultiplier = 0
            if (shadowSprites[key]) shadowSprites[key].scaleMultiplier = 0
          } else if (height < spriteHeight - diamondHeight / 2.2) {
            const traveledHeight = height - diamondHeight / 2
            tempSprite.y = tempSpriteInitialY - traveledHeight
            drawIsometricMask(tempSpriteMaskShape, tempSprite.x, tempSprite.y, tempSprite.displayWidth, tempSpriteHeight, tempSpriteHeight)
            
            const phase2Duration = (spriteHeight - diamondHeight / 2.2) - diamondHeight / 2
            const phase2Progress = (height - diamondHeight / 2) / phase2Duration
            if (shadowSprites[tempBuildingKey]) {
              shadowSprites[tempBuildingKey].scaleMultiplier = phase2Progress
              shadowSprites[tempBuildingKey].y = tempSprite.y
            }
            if (shadowSprites[key]) shadowSprites[key].scaleMultiplier = phase2Progress
            redrawShadowsAround(row, col)
          } else {
            const finalTempY = tempSpriteInitialY - (spriteHeight - diamondHeight / 2.2 - diamondHeight / 2)
            tempSprite.y = finalTempY
            const phase3Progress = (height - (spriteHeight - diamondHeight / 2.2)) / (diamondHeight / 2.2)
            const remainingMaskHeight = tempSpriteHeight * (1 - phase3Progress)
            const newBottomY = finalTempY - (tempSpriteHeight - remainingMaskHeight)
            drawIsometricMask(tempSpriteMaskShape, tempSprite.x, newBottomY, tempSprite.displayWidth, remainingMaskHeight, tempSpriteHeight)
            
            if (shadowSprites[tempBuildingKey]) {
              shadowSprites[tempBuildingKey].scaleMultiplier = 1
              shadowSprites[tempBuildingKey].y = finalTempY
            }
            if (shadowSprites[key]) shadowSprites[key].scaleMultiplier = 1
          }
        }
      }
    },
    onComplete: () => {
      buildingSprite.clearMask(true)
      if (constructionEffects) {
        constructionEffects.stop()
        scene.time.delayedCall(2000, () => constructionEffects.destroy())
      }
    }
  })
}

/**
 * Vytvorí efekt stavebného dymu
 */
function createConstructionDustEffect(scene, x, y, width, height) {
  // Tu môžeš pridať Phaser particles alebo iný efekt
  // Zatiaľ vrátime null
  return null
}
