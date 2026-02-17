<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  initialResources: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update'])

// Rozdelíme resources a components
const allItems = ref([...props.initialResources])
const resources = computed(() => allItems.value.filter(item => !item.isComponent))
const components = computed(() => allItems.value.filter(item => item.isComponent))

const activeTab = ref('resources') // 'resources' alebo 'components'
const newResourceName = ref('')
const newComponentName = ref('')
const editingResourceId = ref(null)

const addResource = () => {
  if (!newResourceName.value.trim()) return
  
  const newResource = {
    id: Date.now().toString(),
    name: newResourceName.value.trim(),
    amount: 0,
    weight: 0,
    icon: null,
    workResource: false,
    vehicleAnimation: false,
    personAnimation: false,
    isComponent: false
  }
  
  allItems.value.push(newResource)
  newResourceName.value = ''
  emitUpdate()
}

const addComponent = () => {
  if (!newComponentName.value.trim()) return
  
  const newComponent = {
    id: Date.now().toString(),
    name: newComponentName.value.trim(),
    amount: 0,
    weight: 0,
    icon: null,
    workResource: false,
    isComponent: true
  }
  
  allItems.value.push(newComponent)
  newComponentName.value = ''
  emitUpdate()
}

const deleteResource = (id) => {
  allItems.value = allItems.value.filter(r => r.id !== id)
  emitUpdate()
}

const startEditResource = (id) => {
  editingResourceId.value = id
}

const finishEditResource = () => {
  editingResourceId.value = null
  emitUpdate()
}

const emitUpdate = () => {
  emit('update', {
    resources: allItems.value
  })
}

const updateResourceAmount = (id, amount) => {
  const resource = allItems.value.find(r => r.id === id)
  if (resource) {
    resource.amount = Number(amount) || 0
    emitUpdate()
  }
}

const updateResourceWeight = (id, weight) => {
  const resource = allItems.value.find(r => r.id === id)
  if (resource) {
    resource.weight = Number(weight) || 0
    emitUpdate()
  }
}

const handleIconUpload = async (id, event) => {
  const file = event.target.files?.[0]
  if (!file) return
  
  // Skontroluj či je to obrázok
  if (!file.type.startsWith('image/')) {
    alert('Prosím nahrajte obrázok (PNG, JPG, atď.)')
    return
  }
  
  // Limit 500KB
  if (file.size > 500000) {
    alert('Obrázok je príliš veľký. Maximum je 500KB.')
    return
  }
  
  const reader = new FileReader()
  reader.onload = (e) => {
    const resource = allItems.value.find(r => r.id === id)
    if (resource) {
      resource.icon = e.target.result // Base64 string
      emitUpdate()
    }
  }
  reader.readAsDataURL(file)
}

const removeIcon = (id) => {
  const resource = allItems.value.find(r => r.id === id)
  if (resource) {
    resource.icon = null
    emitUpdate()
  }
}

const toggleWorkResource = (id) => {
  const resource = allItems.value.find(r => r.id === id)
  if (resource) {
    resource.workResource = !resource.workResource
    emitUpdate()
  }
}

const toggleVehicleAnimation = (id) => {
  const resource = allItems.value.find(r => r.id === id)
  if (resource) {
    resource.vehicleAnimation = !resource.vehicleAnimation
    emitUpdate()
  }
}

const togglePersonAnimation = (id) => {
  const resource = allItems.value.find(r => r.id === id)
  if (resource) {
    resource.personAnimation = !resource.personAnimation
    emitUpdate()
  }
}
</script>

<template>
  <div class="resource-manager">
    <!-- Tab Navigation -->
    <div class="tabs">
      <button 
        @click="activeTab = 'resources'" 
        :class="['tab', { active: activeTab === 'resources' }]"
      >
        📦 Resources
        <span class="tab-count">{{ resources.length }}</span>
      </button>
      <button 
        @click="activeTab = 'components'" 
        :class="['tab', { active: activeTab === 'components' }]"
      >
        🧩 Components
        <span class="tab-count">{{ components.length }}</span>
      </button>
    </div>

    <!-- Resources Tab -->
    <div v-if="activeTab === 'resources'" class="section">
      <div class="add-item">
          <input
            v-model="newResourceName"
            type="text"
            placeholder="Názov resource..."
            @keyup.enter="addResource"
            maxlength="50"
          />
          <button @click="addResource" class="btn-add">
            ➕ Pridať
          </button>
      </div>
      
      <div class="items-list">
        <div v-if="resources.length === 0" class="empty-state">
          <p>Zatiaľ žiadne resources</p>
        </div>
        
        <div 
          v-for="resource in resources" 
          :key="resource.id" 
          class="item"
        >
          <div class="item-content">
            <!-- Ikonka -->
            <div class="icon-wrapper">
              <div v-if="resource.icon" class="icon-preview">
                <img :src="resource.icon" :alt="resource.name" />
                <button 
                  @click="removeIcon(resource.id)"
                  class="btn-remove-icon"
                  title="Odstrániť ikonku"
                >
                  ✕
                </button>
              </div>
              <label v-else class="icon-upload" :for="'icon-' + resource.id">
                <span>📷</span>
                <input
                  :id="'icon-' + resource.id"
                  type="file"
                  accept="image/*"
                  @change="handleIconUpload(resource.id, $event)"
                  class="icon-input"
                />
              </label>
            </div>
            
            <!-- Názov -->
            <input
              v-if="editingResourceId === resource.id"
              v-model="resource.name"
              @blur="finishEditResource"
              @keyup.enter="finishEditResource"
              class="edit-input"
              autofocus
            />
            <span 
              v-else 
              class="item-name"
              @dblclick="startEditResource(resource.id)"
            >
              {{ resource.name }}
            </span>
            
            <div class="item-controls">
              <label class="work-resource-toggle" :title="'Work Resource: ' + (resource.workResource ? 'Áno' : 'Nie')">
                <input
                  type="checkbox"
                  :checked="resource.workResource"
                  @change="toggleWorkResource(resource.id)"
                  class="work-checkbox"
                />
                <span class="work-label">👷 Work</span>
              </label>
              <label v-if="resource.workResource" class="work-resource-toggle vehicle-toggle" :title="'Vehicle Animation: ' + (resource.vehicleAnimation ? 'Áno' : 'Nie')">
                <input
                  type="checkbox"
                  :checked="resource.vehicleAnimation"
                  @change="toggleVehicleAnimation(resource.id)"
                  class="work-checkbox"
                />
                <span class="work-label">🚗 Vehicle</span>
              </label>
              <label v-if="resource.workResource" class="work-resource-toggle person-toggle" :title="'Person Animation: ' + (resource.personAnimation ? 'Áno' : 'Nie')">
                <input
                  type="checkbox"
                  :checked="resource.personAnimation"
                  @change="togglePersonAnimation(resource.id)"
                  class="work-checkbox"
                />
                <span class="work-label">🧑 Person</span>
              </label>
              <div class="number-inputs-group">
                <div class="input-wrapper">
                  <label class="input-label">Amount</label>
                  <input
                    type="number"
                    :value="resource.amount"
                    @input="updateResourceAmount(resource.id, $event.target.value)"
                    class="amount-input"
                    min="0"
                  />
                </div>
                <div class="input-wrapper">
                  <label class="input-label">Weight</label>
                  <input
                    type="number"
                    :value="resource.weight"
                    @input="updateResourceWeight(resource.id, $event.target.value)"
                    class="amount-input"
                    min="0"
                  />
                </div>
              </div>
              <button 
                @click="deleteResource(resource.id)" 
                class="btn-delete"
                title="Vymazať"
              >
                🗑️
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Components Tab -->
    <div v-if="activeTab === 'components'" class="section">
      <div class="add-item">
          <input
            v-model="newComponentName"
            type="text"
            placeholder="Názov component..."
            @keyup.enter="addComponent"
            maxlength="50"
          />
          <button @click="addComponent" class="btn-add">
            ➕ Pridať
          </button>
      </div>
      
      <div class="items-list">
        <div v-if="components.length === 0" class="empty-state">
          <p>Zatiaľ žiadne components</p>
        </div>
        
        <div 
          v-for="component in components" 
          :key="component.id" 
          class="item"
        >
          <div class="item-content">
            <!-- Ikonka -->
            <div class="icon-wrapper">
              <div v-if="component.icon" class="icon-preview">
                <img :src="component.icon" :alt="component.name" />
                <button 
                  @click="removeIcon(component.id)"
                  class="btn-remove-icon"
                  title="Odstrániť ikonku"
                >
                  ✕
                </button>
              </div>
              <label v-else class="icon-upload" :for="'icon-' + component.id">
                <span>📷</span>
                <input
                  :id="'icon-' + component.id"
                  type="file"
                  accept="image/*"
                  @change="handleIconUpload(component.id, $event)"
                  class="icon-input"
                />
              </label>
            </div>
            
            <!-- Názov -->
            <input
              v-if="editingResourceId === component.id"
              v-model="component.name"
              @blur="finishEditResource"
              @keyup.enter="finishEditResource"
              class="edit-input"
              autofocus
            />
            <span 
              v-else 
              class="item-name"
              @dblclick="startEditResource(component.id)"
            >
              {{ component.name }}
            </span>
            
            <div class="item-controls">
              <label class="work-resource-toggle" :title="'Work Resource: ' + (component.workResource ? 'Áno' : 'Nie')">
                <input
                  type="checkbox"
                  :checked="component.workResource"
                  @change="toggleWorkResource(component.id)"
                  class="work-checkbox"
                />
                <span class="work-label">👷 Work</span>
              </label>
              <div class="number-inputs-group">
                <div class="input-wrapper">
                  <label class="input-label">Amount</label>
                  <input
                    type="number"
                    :value="component.amount"
                    @input="updateResourceAmount(component.id, $event.target.value)"
                    class="amount-input"
                    min="0"
                  />
                </div>
                <div class="input-wrapper">
                  <label class="input-label">Weight</label>
                  <input
                    type="number"
                    :value="component.weight"
                    @input="updateResourceWeight(component.id, $event.target.value)"
                    class="amount-input"
                    min="0"
                  />
                </div>
              </div>
              <button 
                @click="deleteResource(component.id)" 
                class="btn-delete"
                title="Vymazať"
              >
                🗑️
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.resource-manager {
  width: 100%;
}

/* Tabs */
.tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  border-bottom: 2px solid #e0e0e0;
}

.tab {
  flex: 1;
  padding: 0.75rem 1rem;
  border: none;
  background: transparent;
  color: #666;
  font-weight: 600;
  font-size: 1rem;
  cursor: pointer;
  position: relative;
  transition: all 0.2s;
  border-bottom: 3px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.tab:hover {
  color: #667eea;
  background: rgba(102, 126, 234, 0.05);
}

.tab.active {
  color: #667eea;
  border-bottom-color: #667eea;
  background: rgba(102, 126, 234, 0.1);
}

.tab-count {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 0.15rem 0.5rem;
  border-radius: 10px;
  font-size: 0.8rem;
  font-weight: 600;
  min-width: 24px;
  text-align: center;
}

.tab.active .tab-count {
  animation: pulse 0.5s ease-in-out;
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.15);
  }
}

.section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.add-item {
  display: flex;
  gap: 0.5rem;
}

.add-item input {
  flex: 1;
  padding: 0.75rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 0.95rem;
  transition: border-color 0.2s;
}

.add-item input:focus {
  outline: none;
  border-color: #667eea;
}

.btn-add {
  padding: 0.75rem 1.25rem;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  transition: transform 0.2s;
  white-space: nowrap;
}

.btn-add:hover {
  transform: translateY(-2px);
}

.items-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 400px;
  overflow-y: auto;
  padding-right: 0.5rem;
}

.empty-state {
  text-align: center;
  padding: 2rem;
  color: #999;
  font-style: italic;
}

.empty-state p {
  margin: 0;
}

.item {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 0.75rem;
  transition: all 0.2s;
  border: 2px solid transparent;
}

.item:hover {
  background: #f0f0f0;
  border-color: #667eea;
}

.item-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.icon-wrapper {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
}

.icon-preview {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid #e0e0e0;
}

.icon-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.btn-remove-icon {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border: none;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  border-radius: 50%;
  font-size: 0.7rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  line-height: 1;
  opacity: 0;
  transition: opacity 0.2s;
}

.icon-preview:hover .btn-remove-icon {
  opacity: 1;
}

.btn-remove-icon:hover {
  background: rgba(255, 0, 0, 0.8);
}

.icon-upload {
  width: 100%;
  height: 100%;
  border: 2px dashed #d0d0d0;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  background: #fafafa;
}

.icon-upload:hover {
  border-color: #667eea;
  background: rgba(102, 126, 234, 0.05);
}

.icon-upload span {
  font-size: 1.5rem;
  opacity: 0.5;
}

.icon-upload:hover span {
  opacity: 0.8;
}

.icon-input {
  display: none;
}

.item-name {
  flex: 1;
  font-weight: 500;
  color: #333;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  transition: background 0.2s;
}

.item-name:hover {
  background: rgba(102, 126, 234, 0.1);
}

.edit-input {
  flex: 1;
  padding: 0.5rem;
  border: 2px solid #667eea;
  border-radius: 6px;
  font-size: 0.95rem;
  font-weight: 500;
}

.item-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.work-resource-toggle {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.35rem 0.6rem;
  background: #f0f0f0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;
  user-select: none;
}

.work-resource-toggle:hover {
  background: #e8e8e8;
  border-color: #667eea;
}

.work-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #667eea;
  margin: 0;
}

.work-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #555;
  white-space: nowrap;
}

.work-resource-toggle:has(.work-checkbox:checked) {
  background: rgba(102, 126, 234, 0.15);
  border-color: #667eea;
}

.work-resource-toggle:has(.work-checkbox:checked) .work-label {
  color: #667eea;
}

.vehicle-toggle:has(.work-checkbox:checked) {
  background: rgba(16, 185, 129, 0.15);
  border-color: #10b981;
}

.vehicle-toggle:has(.work-checkbox:checked) .work-label {
  color: #10b981;
}

.person-toggle:has(.work-checkbox:checked) {
  background: rgba(245, 158, 11, 0.15);
  border-color: #f59e0b;
}

.person-toggle:has(.work-checkbox:checked) .work-label {
  color: #f59e0b;
}

.number-inputs-group {
  display: flex;
  gap: 0.5rem;
}

.input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.input-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.amount-input {
  width: 80px;
  padding: 0.5rem;
  border: 2px solid #e0e0e0;
  border-radius: 6px;
  text-align: center;
  font-weight: 600;
  font-size: 0.95rem;
  transition: border-color 0.2s;
}

.amount-input:focus {
  outline: none;
  border-color: #667eea;
}

.btn-delete {
  padding: 0.5rem;
  border: none;
  background: transparent;
  font-size: 1.2rem;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s;
}

.btn-delete:hover {
  background: #fee;
  transform: scale(1.1);
}

/* Scrollbar styling */
.items-list::-webkit-scrollbar {
  width: 8px;
}

.items-list::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

.items-list::-webkit-scrollbar-thumb {
  background: #667eea;
  border-radius: 4px;
}

.items-list::-webkit-scrollbar-thumb:hover {
  background: #764ba2;
}
</style>
