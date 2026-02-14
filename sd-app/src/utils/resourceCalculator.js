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
    
    // Použi buildingData z canvasItem (má prednosť) alebo z image library
    const buildingData = canvasItem.buildingData || image?.buildingData
    
    if (!buildingData || !buildingData.isBuilding) {
      return
    }
    
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
 * @returns {Object} - {resourceId: amount}
 */
export function calculateStoredResources(canvasImagesMap, images, buildingProductionStates = {}, animatingBuildings = null) {
  const stored = {}

  // Prejdi všetky umiestnené budovy na canvase
  Object.entries(canvasImagesMap || {}).forEach(([key, canvasItem]) => {
    // Preskočíme budovy ktoré sú ešte v stavebnej animácii
    if (animatingBuildings && animatingBuildings.has && animatingBuildings.has(key)) {
      return
    }
    
    const image = images.find(img => img.id === canvasItem.imageId)
    
    // Použi buildingData z canvasItem (má prednosť) alebo z image library
    const buildingData = canvasItem.buildingData || image?.buildingData
    if (!buildingData || !buildingData.isBuilding) return

    // Započítaj stored capacity vždy (aj keď je produkcia vypnutá)
    // Kapacita skladu existuje bez ohľadu na to či budova produkuje
    const buildingStored = buildingData.stored || []
    buildingStored.forEach(s => {
      if (!stored[s.resourceId]) stored[s.resourceId] = 0
      stored[s.resourceId] += Number(s.amount) || 0
    })
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
 * Odpočíta build cost resources a trackuje alokovanie workResource
 * Work-force sa nevracia automaticky - volajúci musí zavolať returnBuildWorkforce() po dokončení stavby
 * @param {Object} buildingData - Metadata budovy
 * @param {Array} resources - Zoznam dostupných resources (ref)
 * @param {Object} allocatedResources - Objekt pre tracking alokovaných resources (ref)
 * @param {Object} workforceAllocations - Detailný tracking kde je work-force alokovaná (ref)
 * @param {number} row - Riadok budovy na canvase
 * @param {number} col - Stĺpec budovy na canvase
 * @returns {Array} - Zoznam alokovaných work-force items pre neskoršie vrátenie
 */
export function deductBuildCost(buildingData, resources, allocatedResources = {}, workforceAllocations = {}, row = 0, col = 0) {
  if (!buildingData || !buildingData.isBuilding) return []
  
  const buildCost = buildingData.buildCost || []
  const allocatedWorkItems = [] // Zoznam work-force na vrátenie po stavbe
  
  buildCost.forEach(cost => {
    const resource = resources.find(r => r.id === cost.resourceId)
    if (resource) {
      // Odpočítaj amount
      resource.amount -= cost.amount
      console.log(`💰 Odpočítané ${cost.amount}x ${resource.name}, zostatok: ${resource.amount}`)
      
      // Ak je to workResource, alokuj (nevracia sa automaticky)
      if (resource.workResource) {
        // Pridaj do celkového allocated count
        if (!allocatedResources[cost.resourceId]) {
          allocatedResources[cost.resourceId] = 0
        }
        allocatedResources[cost.resourceId] += cost.amount
        
        // Pridaj detailný záznam alokácie
        if (!workforceAllocations[cost.resourceId]) {
          workforceAllocations[cost.resourceId] = []
        }
        workforceAllocations[cost.resourceId].push({
          row, col, amount: cost.amount, type: 'build',
          buildingName: buildingData.buildingName || 'Budova'
        })
        
        allocatedWorkItems.push({
          resourceId: resource.id,
          amount: cost.amount,
          resourceName: resource.name
        })
        
        console.log(`👷 Alokované work force (build): ${cost.amount}x ${resource.name} na [${row},${col}], total allocated: ${allocatedResources[cost.resourceId]}`)
      }
    }
  })
  
  return allocatedWorkItems
}

/**
 * Vráti work-force po dokončení stavby budovy
 * @param {Array} allocatedWorkItems - Items vrátené z deductBuildCost
 * @param {Array} resources - Zoznam dostupných resources (ref)
 * @param {Object} allocatedResources - Objekt pre tracking alokovaných resources (ref)
 * @param {Object} workforceAllocations - Detailný tracking kde je work-force alokovaná (ref)
 * @param {number} row - Riadok budovy
 * @param {number} col - Stĺpec budovy
 */
export function returnBuildWorkforce(allocatedWorkItems, resources, allocatedResources = {}, workforceAllocations = {}, row = 0, col = 0) {
  if (!allocatedWorkItems || allocatedWorkItems.length === 0) return
  
  allocatedWorkItems.forEach(item => {
    const resource = resources.find(r => r.id === item.resourceId)
    if (resource) {
      resource.amount += item.amount
      
      // Uber z allocated
      if (allocatedResources[item.resourceId]) {
        allocatedResources[item.resourceId] -= item.amount
        if (allocatedResources[item.resourceId] <= 0) {
          delete allocatedResources[item.resourceId]
        }
      }
      
      // Odstráň detailný záznam alokácie
      if (workforceAllocations[item.resourceId]) {
        const idx = workforceAllocations[item.resourceId].findIndex(
          a => a.row === row && a.col === col && a.type === 'build'
        )
        if (idx !== -1) {
          workforceAllocations[item.resourceId].splice(idx, 1)
          if (workforceAllocations[item.resourceId].length === 0) {
            delete workforceAllocations[item.resourceId]
          }
        }
      }
      
      console.log(`👷 Work force vrátené po stavbe: ${item.amount}x ${item.resourceName} z [${row},${col}], zostatok: ${resource.amount}`)
    }
  })
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
    // Work-force sa preskakuje - je alokovaná pri zapnutí produkcie, nie každý cyklus
    if (resource && resource.workResource) continue
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
    // Work-force sa preskakuje - je alokovaná pri zapnutí produkcie
    if (resource && resource.workResource) return
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
  
  // Odpočítaj operational cost (work-force sa preskakuje - je alokovaná na úrovni produkcie)
  operationalCost.forEach(cost => {
    const resource = resources.find(r => r.id === cost.resourceId)
    if (resource) {
      // Work-force sa neodčítava tu - je alokovaná pri zapnutí produkcie
      if (resource.workResource) {
        console.log(`👷 Work force ${resource.name} preskočená - je alokovaná na úrovni produkcie`)
        return
      }
      resource.amount -= cost.amount
      console.log(`⚙️ Odpočítané prevádzkové náklady: ${cost.amount}x ${resource.name}, zostatok: ${resource.amount}`)
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
  
  console.log('✅ Produkcia spustená!')
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