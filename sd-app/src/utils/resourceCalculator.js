/**
 * Resource Calculator Service
 * Počítá použité a produkované resources zo všetkých budov na canvase
 */

/**
 * Vypočíta celkové použité resources (operational cost) a produkované resources
 * @param {Object} canvasImagesMap - Mapa budov na canvase {key: {imageId, url, templateName}}
 * @param {Array} images - Zoznam všetkých obrázkov s buildingData
 * @returns {Object} - {usedResources: {resourceId: amount}, producedResources: {resourceId: amount}}
 */
export function calculateResourceUsage(canvasImagesMap, images) {
  const usedResources = {}
  const producedResources = {}
  
  // Prejdi všetky budovy na canvase
  Object.values(canvasImagesMap).forEach(canvasItem => {
    // Nájdi zodpovedajúci obrázok s buildingData
    const image = images.find(img => img.id === canvasItem.imageId)
    
    if (!image || !image.buildingData || !image.buildingData.isBuilding) {
      return
    }
    
    const buildingData = image.buildingData
    
    // Spočítaj operational cost (použité resources)
    const operationalCost = buildingData.operationalCost || []
    operationalCost.forEach(cost => {
      if (!usedResources[cost.resourceId]) {
        usedResources[cost.resourceId] = 0
      }
      usedResources[cost.resourceId] += cost.amount
    })
    
    // Spočítaj produkciu
    const production = buildingData.production || []
    production.forEach(prod => {
      if (!producedResources[prod.resourceId]) {
        producedResources[prod.resourceId] = 0
      }
      producedResources[prod.resourceId] += prod.amount
    })
  })
  
  return {
    usedResources,
    producedResources
  }
}

/**
 * Vypočíta celkové skladované resources zo všetkých budov umiestnených na canvase
 * Aggreguje hodnoty z buildingData.stored len pre budovy, ktoré sú v production mode.
 * @param {Object} canvasImagesMap - Mapa budov na canvase {key: {imageId, url, templateName}}
 * @param {Array} images - Zoznam všetkých obrázkov s buildingData
 * @param {Object} buildingProductionStates - Mapa stavov produkcie {'row-col': {enabled: boolean}}
 * @param {Array} allResources - Všetky resources pre kontrolu mustBeStored
 * @returns {Object} - {resourceId: amount}
 */
export function calculateStoredResources(canvasImagesMap, images, buildingProductionStates = {}, allResources = []) {
  const stored = {}

  // Prejdi všetky umiestnené budovy na canvase
  Object.entries(canvasImagesMap || {}).forEach(([key, canvasItem]) => {
    const image = images.find(img => img.id === canvasItem.imageId)
    if (!image || !image.buildingData || !image.buildingData.isBuilding) return

    // Započítaj stored capacity len ak má budova zapnutú auto produkciu
    const productionState = buildingProductionStates[key]
    if (!productionState || !productionState.enabled) return

    const buildingStored = image.buildingData.stored || []
    buildingStored.forEach(s => {
      if (!stored[s.resourceId]) stored[s.resourceId] = 0
      stored[s.resourceId] += Number(s.amount) || 0
    })
  })

  // Pre všetky resources s mustBeStored: true, pridaj kapacitu 0 ak nemajú žiadny sklad
  allResources.forEach(resource => {
    if (resource.mustBeStored && stored[resource.id] === undefined) {
      stored[resource.id] = 0
    }
  })

  return stored
}

/**
 * Kontrola dostupnosti resources pre konkrétnu budovu
 * @param {Object} buildingData - Metadata budovy
 * @param {Array} resources - Zoznam dostupných resources
 * @returns {Object} - {hasEnough: boolean, missingBuild: [], missingOperational: []}
 */
export function checkBuildingResources(buildingData, resources) {
  if (!buildingData || !buildingData.isBuilding) {
    return { hasEnough: true, missingBuild: [], missingOperational: [] }
  }
  
  const missingBuild = []
  
  // Kontrola build cost (potrebné na stavbu)
  const buildCost = buildingData.buildCost || []
  buildCost.forEach(cost => {
    const resource = resources.find(r => r.id === cost.resourceId)
    if (!resource) {
      missingBuild.push({
        name: cost.resourceName,
        needed: cost.amount,
        available: 0,
        isWorkResource: false
      })
      return
    }
    
    // Pre build cost kontrolujeme reálny amount
    const available = resource.amount
    
    if (available < cost.amount) {
      missingBuild.push({
        name: cost.resourceName,
        needed: cost.amount,
        available: available,
        isWorkResource: resource.workResource || false
      })
    }
  })
  
  return {
    hasEnough: missingBuild.length === 0,
    missingBuild,
    missingOperational: [] // Zatiaľ prázdne
  }
}

/**
 * Odpočíta build cost resources a vráti workResource po 3 sekundách
 * @param {Object} buildingData - Metadata budovy
 * @param {Array} resources - Zoznam dostupných resources (ref)
 */
export function deductBuildCost(buildingData, resources) {
  if (!buildingData || !buildingData.isBuilding) return
  
  const buildCost = buildingData.buildCost || []
  const workResourcesToReturn = [] // Zoznam workResource ktoré treba vrátiť
  
  buildCost.forEach(cost => {
    const resource = resources.find(r => r.id === cost.resourceId)
    if (resource) {
      // Odpočítaj amount
      resource.amount -= cost.amount
      console.log(`💰 Odpočítané ${cost.amount}x ${resource.name}, zostatok: ${resource.amount}`)
      
      // Ak je to workResource, pridáme do zoznamu na vrátenie
      if (resource.workResource) {
        workResourcesToReturn.push({
          resourceId: resource.id,
          amount: cost.amount,
          resourceName: resource.name
        })
      }
    }
  })
  
  // Vrátiť workResources po 3 sekundách
  if (workResourcesToReturn.length > 0) {
    setTimeout(() => {
      workResourcesToReturn.forEach(item => {
        const resource = resources.find(r => r.id === item.resourceId)
        if (resource) {
          resource.amount += item.amount
          console.log(`👷 Work resource vrátené: ${item.amount}x ${item.resourceName}, nový zostatok: ${resource.amount}`)
        }
      })
    }, 3000) // 3 sekundy
  }
}

/**
 * Vráti build cost resources pri zmazaní budovy (nevracia workResource)
 * @param {Object} buildingData - Metadata budovy
 * @param {Array} resources - Zoznam dostupných resources (ref)
 */
export function refundBuildCostOnDelete(buildingData, resources) {
  if (!buildingData || !buildingData.isBuilding) return

  const buildCost = buildingData.buildCost || []
  buildCost.forEach(cost => {
    const resource = resources.find(r => r.id === cost.resourceId)
    if (!resource) return

    // Work resources sa nevracajú
    if (resource.workResource) return

    resource.amount += cost.amount
    console.log(`🔁 Vrátené ${cost.amount}x ${resource.name}, nový zostatok: ${resource.amount}`)
  })
}

/**
 * Kontrola či je dosť resources na spustenie produkcie budovy
 * @param {Object} buildingData - Metadata budovy
 * @param {Array} resources - Zoznam dostupných resources
 * @returns {boolean}
 */
export function canStartProduction(buildingData, resources) {
  if (!buildingData || !buildingData.operationalCost) return true
  
  const operationalCost = buildingData.operationalCost || []
  
  for (const cost of operationalCost) {
    const resource = resources.find(r => r.id === cost.resourceId)
    if (!resource || resource.amount < cost.amount) {
      return false
    }
  }
  
  return true
}

/**
 * Získa zoznam chýbajúcich operational resources
 * @param {Object} buildingData - Metadata budovy
 * @param {Array} resources - Zoznam dostupných resources
 * @returns {Set} - Set s resourceId ktoré chýbajú
 */
export function getMissingOperationalResources(buildingData, resources) {
  const missingResourceIds = new Set()
  
  if (!buildingData || !buildingData.operationalCost) return missingResourceIds
  
  const operationalCost = buildingData.operationalCost || []
  
  operationalCost.forEach(cost => {
    const resource = resources.find(r => r.id === cost.resourceId)
    if (!resource || resource.amount < cost.amount) {
      missingResourceIds.add(cost.resourceId)
    }
  })
  
  return missingResourceIds
}

/**
 * Spustí produkciu budovy - odpočíta operational cost a pridá produkciu
 * @param {Object} buildingData - Metadata budovy
 * @param {Array} resources - Zoznam dostupných resources (ref)
 * @param {Object} storedCapacities - Objekt s celkovou stored kapacitou pre každú resource {resourceId: totalCapacity}
 */
export function executeProduction(buildingData, resources, storedCapacities = {}) {
  if (!buildingData) return
  
  const operationalCost = buildingData.operationalCost || []
  const production = buildingData.production || []
  const workResourcesToReturn = []
  
  // Odpočítaj operational cost
  operationalCost.forEach(cost => {
    const resource = resources.find(r => r.id === cost.resourceId)
    if (resource) {
      resource.amount -= cost.amount
      console.log(`⚙️ Odpočítané prevádzkové náklady: ${cost.amount}x ${resource.name}, zostatok: ${resource.amount}`)
      
      // Ak je to workResource, pridáme do zoznamu na vrátenie
      if (resource.workResource) {
        workResourcesToReturn.push({
          resourceId: resource.id,
          amount: cost.amount,
          resourceName: resource.name
        })
      }
    }
  })
  
  // Pridaj produkciu - ale len do výšky stored kapacity
  production.forEach(prod => {
    const resource = resources.find(r => r.id === prod.resourceId)
    if (resource) {
      const currentAmount = resource.amount
      const storedCapacity = storedCapacities[prod.resourceId] || Infinity
      
      // Ak má resource stored kapacitu, kontroluj limit
      if (storedCapacity < Infinity) {
        const availableSpace = storedCapacity - currentAmount
        
        if (availableSpace <= 0) {
          console.log(`🚫 Sklad plný! ${resource.name} je na maximálnej kapacite (${currentAmount}/${storedCapacity})`)
          return // Neskladuj, sklad je plný
        }
        
        // Pridaj len toľko, koľko sa zmestí
        const amountToAdd = Math.min(prod.amount, availableSpace)
        resource.amount += amountToAdd
        
        if (amountToAdd < prod.amount) {
          console.log(`⚠️ Čiastočná produkcia: +${amountToAdd}/${prod.amount}x ${resource.name} (sklad takmer plný: ${resource.amount}/${storedCapacity})`)
        } else {
          console.log(`📦 Vyprodukované: +${amountToAdd}x ${resource.name}, zostatok: ${resource.amount}/${storedCapacity}`)
        }
      } else {
        // Bez limitu stored - pridaj celú produkciu
        resource.amount += prod.amount
        console.log(`📦 Vyprodukované: +${prod.amount}x ${resource.name}, nový zostatok: ${resource.amount}`)
      }
    } else {
      console.warn(`⚠️ Resource ${prod.resourceName} (${prod.resourceId}) neexistuje v zozname resources`)
    }
  })
  
  // Vrátiť workResources po 3 sekundách
  if (workResourcesToReturn.length > 0) {
    setTimeout(() => {
      workResourcesToReturn.forEach(item => {
        const resource = resources.find(r => r.id === item.resourceId)
        if (resource) {
          resource.amount += item.amount
          console.log(`👷 Work resource vrátené: ${item.amount}x ${item.resourceName}, nový zostatok: ${resource.amount}`)
        }
      })
    }, 3000)
  }
  
  console.log('✅ Produkcia spustená!')
}
/**
 * Odpočíta resources s mustBeStored: true keď nemajú dostatok skladu
 * @param {Array} resources - Zoznam dostupných resources (ref)
 * @param {Object} storedCapacities - Objekt s celkovou stored kapacitou pre každú resource {resourceId: totalCapacity}
 */
export function decreaseMustBeStoredResources(resources, storedCapacities = {}) {
  resources.forEach(resource => {
    if (!resource.mustBeStored) return
    
    const capacity = storedCapacities[resource.id] || 0
    
    // Ak resource nemá žiadny sklad (capacity === 0) alebo je sklad plný
    if (capacity === 0) {
      // Odpočítaj 1 resource každú sekundu
      if (resource.amount > 0) {
        resource.amount = Math.max(0, resource.amount - 1)
        console.log(`⬇️ ${resource.name} klesá (žiadny sklad): ${resource.amount}`)
      }
    } else if (resource.amount > capacity) {
      // Ak je resource nad kapacitou, zníž ju na kapacitu
      resource.amount = capacity
      console.log(`📉 ${resource.name} znížené na kapacitu skladu: ${resource.amount}/${capacity}`)
    }
  })
}

/**
 * Kontrola či je dostatok miesta na uskladnenie produkcie budovy
 * @param {Object} buildingData - Metadata budovy
 * @param {Array} resources - Zoznam dostupných resources
 * @param {Object} storedCapacities - Objekt s celkovou stored kapacitou pre každú resource {resourceId: totalCapacity}
 * @returns {Object} - {hasSpace: boolean, fullResources: []}
 */
export function canStoreProduction(buildingData, resources, storedCapacities = {}) {
  const fullResources = []
  
  if (!buildingData || !buildingData.production) {
    return { hasSpace: true, fullResources }
  }
  
  const production = buildingData.production || []
  
  for (const prod of production) {
    const resource = resources.find(r => r.id === prod.resourceId)
    if (!resource) continue
    
    const currentAmount = resource.amount
    const storedCapacity = storedCapacities[prod.resourceId]
    
    // Ak má resource stored kapacitu, kontroluj limit
    if (storedCapacity !== undefined && storedCapacity < Infinity) {
      const availableSpace = storedCapacity - currentAmount
      
      if (availableSpace <= 0) {
        fullResources.push({
          resourceId: prod.resourceId,
          resourceName: prod.resourceName || resource.name,
          currentAmount,
          capacity: storedCapacity
        })
      }
    }
  }
  
  return {
    hasSpace: fullResources.length === 0,
    fullResources
  }
}