/**
 * TexturePreloader - Preloading textúr v pozadí
 * Načítava textúry asynchrónne mimo Phaser loader aby neblokoval hlavné vlákno
 */

export class TexturePreloader {
  constructor() {
    this.cache = new Map()
    this.loading = new Set()
  }

  /**
   * Načíta obrázok do cache asynchrónne
   */
  async preloadImage(url) {
    // Ak už je v cache, vrátime ho
    if (this.cache.has(url)) {
      return this.cache.get(url)
    }

    // Ak sa už načítava, počkáme
    if (this.loading.has(url)) {
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.cache.has(url)) {
            clearInterval(checkInterval)
            resolve(this.cache.get(url))
          }
        }, 50)
      })
    }

    // Začneme načítavať
    this.loading.add(url)

    return new Promise((resolve, reject) => {
      const img = new Image()
      
      img.onload = () => {
        // Vytvoríme canvas pre konverziu do formátu použiteľného v Phaser
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        
        // Uložíme do cache
        const imageData = {
          element: img,
          canvas: canvas,
          width: img.width,
          height: img.height,
          url: url
        }
        
        this.cache.set(url, imageData)
        this.loading.delete(url)
        
        console.log(`✅ Textúra preloadnutá: ${url}`)
        resolve(imageData)
      }

      img.onerror = () => {
        this.loading.delete(url)
        reject(new Error(`Failed to load image: ${url}`))
      }

      img.src = url
    })
  }

  /**
   * Batch preload viacerých obrázkov naraz
   */
  async preloadBatch(urls) {
    return Promise.all(urls.map(url => this.preloadImage(url)))
  }

  /**
   * Získa obrázok z cache
   */
  getFromCache(url) {
    return this.cache.get(url)
  }

  /**
   * Kontrola či je obrázok v cache
   */
  isCached(url) {
    return this.cache.has(url)
  }

  /**
   * Vyčistí cache
   */
  clearCache() {
    this.cache.clear()
    this.loading.clear()
  }

  /**
   * Získa veľkosť cache
   */
  getCacheSize() {
    return this.cache.size
  }
}

// Singleton inštancia
export const texturePreloader = new TexturePreloader()
