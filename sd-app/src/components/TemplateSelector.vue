<script setup>
import { ref, watch, onMounted } from 'vue'

const emit = defineEmits(['template-selected', 'tab-changed'])

const activeTemplateTab = ref('1size')
const templateImages = ref({
  '1size': ['0.png', '1.png', '1x2.png', '1x3.png'],
  '2size': ['2x1.png', '2x2-1.png', '2x2.png', '2x3-1.png', '2x3.png'],
  '4size': ['4x1.png', '4x2-1.png', '4x2-2.png', '4x2-3.png', '4x2.png', '4x3-1.png', '4x3-2.png', '4x3-3.png', '4x3.png']
})
const selectedTemplate = ref(null)

// Funkcia na emitovanie veľkosti podľa tabu
const emitTabSize = (tab) => {
  let cellsX = 1, cellsY = 1
  if (tab === '2size') {
    cellsX = 1
    cellsY = 2  // 2 políčka nad sebou
  } else if (tab === '4size') {
    cellsX = 2
    cellsY = 2
  }
  
  emit('tab-changed', { cellsX, cellsY })
}

// Sleduj zmeny tabu a pošli info o veľkosti políčok
watch(activeTemplateTab, (newTab) => {
  emitTabSize(newTab)
})

// Pri prvom načítaní pošli aktuálnu veľkosť
onMounted(() => {
  emitTabSize(activeTemplateTab.value)
})

const selectTemplate = (template) => {
  const folder = activeTemplateTab.value === '1size' ? 'cubes1' : 
                 activeTemplateTab.value === '2size' ? 'cubes2' : 'cubes4'
  const templatePath = `/templates/${folder}/${template}`
  
  selectedTemplate.value = template
  
  // Zisti počet políčok podľa tabu
  let cellsX = 1, cellsY = 1
  if (activeTemplateTab.value === '2size') {
    cellsX = 1
    cellsY = 2  // 2 políčka nad sebou
  } else if (activeTemplateTab.value === '4size') {
    cellsX = 2
    cellsY = 2
  }
  
  // Načítaj šablónu ako blob a zisti jej rozmery
  fetch(templatePath)
    .then(res => res.blob())
    .then(blob => {
      const reader = new FileReader()
      reader.onload = (e) => {
        // Načítaj obrázok aby sme zistili rozmery
        const img = new Image()
        img.onload = () => {
          // Zaokrúhli rozmery na násobok 8 (požiadavka SD)
          const width = Math.round(img.width / 8) * 8
          const height = Math.round(img.height / 8) * 8
          
          emit('template-selected', {
            dataUrl: e.target.result,
            templateName: template,
            width: width,
            height: height,
            cellsX: cellsX,
            cellsY: cellsY
          })
        }
        img.src = e.target.result
      }
      reader.readAsDataURL(blob)
    })
    .catch(err => {
      console.error('Chyba pri načítaní šablóny:', err)
    })
}
</script>

<template>
  <div class="template-selector">
    <label>🎨 Šablóny</label>
    
    <!-- Tab navigácia -->
    <div class="template-tabs">
      <button 
        @click="activeTemplateTab = '1size'" 
        :class="{ active: activeTemplateTab === '1size' }"
        class="tab-btn"
        type="button"
      >
        1size
      </button>
      <button 
        @click="activeTemplateTab = '2size'" 
        :class="{ active: activeTemplateTab === '2size' }"
        class="tab-btn"
        type="button"
      >
        2size
      </button>
      <button 
        @click="activeTemplateTab = '4size'" 
        :class="{ active: activeTemplateTab === '4size' }"
        class="tab-btn"
        type="button"
      >
        4size
      </button>
    </div>
    
    <!-- Galéria šablón -->
    <div class="templates-gallery">
      <div 
        v-for="template in templateImages[activeTemplateTab]" 
        :key="template"
        @click="selectTemplate(template)"
        :class="{ selected: selectedTemplate === template }"
        class="template-item"
      >
        <img 
          :src="`/templates/${activeTemplateTab === '1size' ? 'cubes1' : activeTemplateTab === '2size' ? 'cubes2' : 'cubes4'}/${template}`" 
          :alt="template"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.template-selector {
  margin-bottom: 1rem;
}

.template-selector label {
  display: block;
  margin-bottom: 0.75rem;
  font-weight: 600;
  color: #333;
  font-size: 0.9rem;
}

/* Template tabs */
.template-tabs {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.tab-btn {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  background: white;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.3s;
  color: #666;
}

.tab-btn:hover {
  border-color: #667eea;
  background: rgba(102, 126, 234, 0.05);
}

.tab-btn.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-color: #667eea;
}

/* Templates gallery */
.templates-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 0.75rem;
  max-height: 250px;
  overflow-y: auto;
  padding: 0.5rem;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 8px;
}

.template-item {
  aspect-ratio: 1;
  border: 3px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s;
  background: white;
}

.template-item:hover {
  border-color: #667eea;
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.template-item.selected {
  border-color: #667eea;
  border-width: 4px;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
}

.template-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
