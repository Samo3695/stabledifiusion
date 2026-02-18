/**
 * GIF Frame Extractor - Parsuje animovaný GIF a extrahuje framy pre Phaser
 * Používa gifuct-js na dekódovanie GIF súborov
 */
import { parseGIF, decompressFrames } from 'gifuct-js'

/**
 * Načíta a rozparsuje animovaný GIF, vráti pole frame-ov (ImageData)
 * @param {string} url - URL k GIF súboru
 * @returns {Promise<{frames: ImageData[], width: number, height: number, delays: number[]}>}
 */
export async function loadGifFrames(url) {
  const response = await fetch(url)
  const buffer = await response.arrayBuffer()
  
  const gif = parseGIF(buffer)
  const frames = decompressFrames(gif, true) // true = build full frames (composite)
  
  if (frames.length === 0) {
    throw new Error('GIF neobsahuje žiadne framy')
  }
  
  const width = gif.lsd.width
  const height = gif.lsd.height
  
  // Konvertujeme framy na ImageData
  const imageDataFrames = []
  const delays = []
  
  // Vytvoríme canvas pre kompozíciu framov
  const compositeCanvas = document.createElement('canvas')
  compositeCanvas.width = width
  compositeCanvas.height = height
  const compositeCtx = compositeCanvas.getContext('2d')
  
  for (const frame of frames) {
    // Vytvoríme ImageData z frame patch dát
    const patchCanvas = document.createElement('canvas')
    patchCanvas.width = frame.dims.width
    patchCanvas.height = frame.dims.height
    const patchCtx = patchCanvas.getContext('2d')
    const patchImageData = patchCtx.createImageData(frame.dims.width, frame.dims.height)
    patchImageData.data.set(frame.patch)
    patchCtx.putImageData(patchImageData, 0, 0)
    
    // Nakreslíme patch na composite canvas
    if (frame.disposalType === 2) {
      compositeCtx.clearRect(0, 0, width, height)
    }
    compositeCtx.drawImage(patchCanvas, frame.dims.left, frame.dims.top)
    
    // Uložíme kompletný frame
    const fullFrameData = compositeCtx.getImageData(0, 0, width, height)
    imageDataFrames.push(fullFrameData)
    delays.push(frame.delay || 100)
  }
  
  console.log(`🎬 GIF načítaný: ${width}x${height}, ${frames.length} framov`)
  
  return { frames: imageDataFrames, width, height, delays }
}

/**
 * Z každého GIF framu vystrihne N-tý stĺpec (postavu) a vráti ako canvas elementy
 * @param {ImageData[]} frames - Pole GIF framov
 * @param {number} gifWidth - Šírka celého GIF
 * @param {number} gifHeight - Výška celého GIF
 * @param {number} columnCount - Počet stĺpcov (postáv) v GIF
 * @param {number} columnIndex - Index stĺpca na extrakciu (0-based)
 * @returns {HTMLCanvasElement[]} - Pole canvas elementov s vystrihnutými framami
 */
export function extractColumnFrames(frames, gifWidth, gifHeight, columnCount, columnIndex) {
  const colWidth = Math.floor(gifWidth / columnCount)
  const srcX = colWidth * columnIndex
  
  const canvases = []
  
  for (const frameData of frames) {
    const canvas = document.createElement('canvas')
    canvas.width = colWidth
    canvas.height = gifHeight
    const ctx = canvas.getContext('2d')
    
    // Najprv nakreslíme celý frame na temp canvas
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = gifWidth
    tempCanvas.height = gifHeight
    const tempCtx = tempCanvas.getContext('2d')
    tempCtx.putImageData(frameData, 0, 0)
    
    // Potom vystrihneme požadovaný stĺpec
    ctx.drawImage(tempCanvas, srcX, 0, colWidth, gifHeight, 0, 0, colWidth, gifHeight)
    
    canvases.push(canvas)
  }
  
  console.log(`✂️ Extrahovaných ${canvases.length} framov pre stĺpec ${columnIndex} (${colWidth}x${gifHeight})`)
  
  return canvases
}

/**
 * Načíta GIF, extrahuje konkrétnu postavu a zaregistruje framy do Phaser scény
 * @param {Phaser.Scene} scene - Phaser scéna
 * @param {string} gifUrl - URL k GIF súboru
 * @param {number} columnCount - Počet postáv v GIF (stĺpcov)
 * @param {number} columnIndex - Index postavy na extrakciu (0-based)
 * @param {string} texturePrefix - Prefix pre Phaser textúry (napr. 'person')
 * @returns {Promise<{frameKeys: string[], delay: number}>}
 */
export async function loadPersonGifFrames(scene, gifUrl, columnCount, columnIndex, texturePrefix = 'person') {
  const { frames, width, height, delays } = await loadGifFrames(gifUrl)
  
  // Extrahujeme stĺpec s požadovanou postavou
  const columnCanvases = extractColumnFrames(frames, width, height, columnCount, columnIndex)
  
  // Zaregistrujeme každý frame ako Phaser textúru
  const frameKeys = []
  for (let i = 0; i < columnCanvases.length; i++) {
    const key = `${texturePrefix}_frame${i}`
    
    // Ak textúra už existuje, odstránime ju
    if (scene.textures.exists(key)) {
      scene.textures.remove(key)
    }
    
    scene.textures.addCanvas(key, columnCanvases[i])
    frameKeys.push(key)
  }
  
  // Priemerný delay z GIF
  const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length
  
  console.log(`✅ Zaregistrovaných ${frameKeys.length} framov ako Phaser textúry (prefix: ${texturePrefix}, delay: ${avgDelay}ms)`)
  
  return { frameKeys, delay: avgDelay }
}
