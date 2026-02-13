/**
 * Service pre animáciu stavania budov
 * Obsahuje celú logiku animácie vrátane construct sprite-ov, 0.png tempSprite a masiek
 */

const BUILDING_ANIMATION_DURATION = 10000 // ms
const TILE_WIDTH = 64
const TILE_HEIGHT = 32

/**
 * Helper funkcia na kreslenie izometrickej masky
 */
function drawIsometricMask(graphics, centerX, bottomY, width, height, maxHeight) {
  graphics.clear()
  graphics.fillStyle(0xffffff)
  if (height <= 0) return
  
  const progress = height / maxHeight
  const currentWidth = width * progress
  const currentHeight = height
  const diamondCenterY = bottomY - currentHeight / 2
  
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
 * @param {Object} scene - Phaser scéna (this z PhaserCanvas)
 * @param {Object} params - Parametre animácie
 * @returns {Array} constructSprites - Pole construct sprite-ov (na neskoršie nastavenie depth)
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
    isTreeTemplate,
    baseShadowOffset,
    shadowSprites,
    redrawShadowsAround,
    row,
    col,
    createConstructionDustEffect
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
    tempSprite.setDepth(buildingSprite.depth + 2) // Najvrchnejšia vrstva - nad všetkým
    tempSprite.setAlpha(1)
    
    // Uložíme počiatočnú Y pozíciu a výšku
    tempSpriteInitialY = tempSprite.y
    tempSpriteHeight = tempSprite.displayHeight
    
    // Vytvoríme masku pre tempSprite s izometrickou šikmosťou
    tempSpriteMaskShape = scene.make.graphics()
    drawIsometricMask(tempSpriteMaskShape, tempSprite.x, tempSpriteInitialY, tempSprite.displayWidth, 0, tempSpriteHeight)
    const tempMask = tempSpriteMaskShape.createGeometryMask()
    tempSprite.setMask(tempMask)
    
    // Vytvoríme shadowInfo pre tempSprite s nulovou veľkosťou (žiadny tieň na začiatku)
    shadowSprites[tempBuildingKey] = {
      textureKey: tempBuildingKey,
      x: x + offsetX,
      y: y + TILE_HEIGHT + offsetY,
      scale: tempScale,
      scaleMultiplier: 0,
      alpha: 1,
      cellsX,
      isTree: isTreeTemplate,
      offsetX: -baseShadowOffset,
      offsetY: baseShadowOffset * 0.375
    }
    
    // Odstránime dočasný sprite po dokončení animácie
    scene.time.delayedCall(BUILDING_ANIMATION_DURATION, () => {
      if (tempSprite) {
        tempSprite.destroy()
      }
      if (tempSpriteMaskShape) {
        tempSpriteMaskShape.destroy()
      }
      if (shadowSprites[tempBuildingKey]) {
        delete shadowSprites[tempBuildingKey]
        redrawShadowsAround(row, col)
      }
    })
  })
  scene.load.start()
  
  // === CONSTRUCT SPRITES V 3 CÍPOCH DIAMANTU ===
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
        constructSprite.x -= 0
      } else if (tip.name === 'right') {
        constructSprite.x -= constructSprite.displayWidth
        constructSprite.y += 5
        constructSprite.x += 0
      }
      
      // Vytvoríme masku pre construct sprite
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
  } else {
    console.warn('⚠️ Textúra construct.png nebola nájdená')
  }
  
  // Odstránime construct sprite-y po dokončení animácie
  scene.time.delayedCall(BUILDING_ANIMATION_DURATION, () => {
    constructSprites.forEach(sprite => {
      if (sprite) sprite.destroy()
    })
    constructMasks.forEach(maskInfo => {
      if (maskInfo.shape) maskInfo.shape.destroy()
    })
  })
  
  // Vytvoríme rect masku pre hlavnú budovu
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
  
  // Vytvoríme efekt stavebného dymu/prachu na vrchu masky
  const constructionEffects = createConstructionDustEffect(
    buildingSprite.x,
    finalY - spriteHeight,
    buildingSprite.displayWidth,
    spriteHeight
  )
  if (constructionEffects) {
    constructionEffects.setDepth(buildingSprite.depth + 0.2)
  }
  
  // Animujeme výšku masky od 0 po plnú výšku
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
      
      // Posúvame efekty dymu/prachu s hornou hranou masky
      if (constructionEffects) {
        constructionEffects.setPosition(
          buildingSprite.x,
          finalY - height
        )
      }
      
      // Animujeme masky construct sprite-ov
      if (!dontDropShadow) {
        constructMasks.forEach(maskInfo => {
          let currentHeight = 0
          
          const constructPhase3Start = dontDropShadow 
            ? spriteHeight - diamondHeight / 0.5
            : spriteHeight - diamondHeight / 1.2
          
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
      
      // 3 fázy pohybu tempSprite:
      if (tempSprite && tempSpriteMaskShape) {
        // Pre budovy s dontDropShadow: len fáza 1 a fáza 3 (bez pohybu hore)
        if (dontDropShadow) {
          // Fáza 1: Vykresľovanie masky 0.png zdola hore do plnej výšky
          if (height < spriteHeight - diamondHeight / 2.2) {
            tempSprite.y = tempSpriteInitialY
            
            const phase1Duration = spriteHeight - diamondHeight / 2.2
            const phase1Progress = height / phase1Duration
            const tempMaskHeight = phase1Progress * tempSpriteHeight
            
            drawIsometricMask(tempSpriteMaskShape, tempSprite.x, tempSpriteInitialY, tempSprite.displayWidth, tempMaskHeight, tempSpriteHeight)
          }
          // Fáza 3: Stojí a maska mizne zhora dole (opačný smer)
          else {
            tempSprite.y = tempSpriteInitialY
            
            const phase3Progress = (height - (spriteHeight - diamondHeight / 2.2)) / (diamondHeight / 2.2)
            const remainingMaskHeight = tempSpriteHeight * (1 - phase3Progress)
            const newBottomY = tempSpriteInitialY - (tempSpriteHeight - remainingMaskHeight)
            
            drawIsometricMask(tempSpriteMaskShape, tempSprite.x, newBottomY, tempSprite.displayWidth, remainingMaskHeight, tempSpriteHeight)
          }
        }
        // Pre normálne budovy: všetky 3 fázy
        else {
          // Fáza 1: Vykresľovanie masky 0.png zdola hore kým maska nedosiahne diamondHeight / 2
          if (height < diamondHeight / 2) {
            tempSprite.y = tempSpriteInitialY
            
            const tempMaskHeight = (height / (diamondHeight / 2)) * tempSpriteHeight
            drawIsometricMask(tempSpriteMaskShape, tempSprite.x, tempSpriteInitialY, tempSprite.displayWidth, tempMaskHeight, tempSpriteHeight)
            
            if (shadowSprites[tempBuildingKey]) {
              shadowSprites[tempBuildingKey].scaleMultiplier = 0
            }
            if (shadowSprites[key]) {
              shadowSprites[key].scaleMultiplier = 0
            }
          }
          // Fáza 2: Pohyb hore kým nie je diamondHeight / 2.2 od vrchu obrázka
          else if (height < spriteHeight - diamondHeight / 2.2) {
            const traveledHeight = height - diamondHeight / 2
            tempSprite.y = tempSpriteInitialY - traveledHeight
            
            drawIsometricMask(tempSpriteMaskShape, tempSprite.x, tempSprite.y, tempSprite.displayWidth, tempSpriteHeight, tempSpriteHeight)
            
            const phase2Duration = (spriteHeight - diamondHeight / 2.2) - diamondHeight / 2
            const phase2Progress = (height - diamondHeight / 2) / phase2Duration
            if (shadowSprites[tempBuildingKey]) {
              shadowSprites[tempBuildingKey].scaleMultiplier = phase2Progress
              shadowSprites[tempBuildingKey].y = tempSprite.y
            }
            if (shadowSprites[key]) {
              shadowSprites[key].scaleMultiplier = phase2Progress
            }
            redrawShadowsAround(row, col)
          }
          // Fáza 3: Stojí a maska mizne zhora dole (opačný smer)
          else {
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
            if (shadowSprites[key]) {
              shadowSprites[key].scaleMultiplier = 1
            }
          }
        }
      }
    },
    onComplete: () => {
      // Odstránime masku po dokončení
      buildingSprite.clearMask(true)
      
      // Zastavíme a odstránime časticový efekt
      if (constructionEffects) {
        constructionEffects.stop()
        scene.time.delayedCall(2000, () => {
          constructionEffects.destroy()
        })
      }
    }
  })
  
  // Vrátime construct sprites aby sa im mohol nastaviť depth zvonka
  return constructSprites
}
