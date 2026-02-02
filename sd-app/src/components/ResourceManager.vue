<script setup>
import { ref } from 'vue'

const props = defineProps({
  initialResources: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update'])

const resources = ref([...props.initialResources])
const newResourceName = ref('')
const editingResourceId = ref(null)

const addResource = () => {
  if (!newResourceName.value.trim()) return
  
  const newResource = {
    id: Date.now().toString(),
    name: newResourceName.value.trim(),
    amount: 0,
    icon: null, // Base64 ikonka
    workResource: false // Či je to work resource
  }
  
  resources.value.push(newResource)
  newResourceName.value = ''
  emitUpdate()
}

const deleteResource = (id) => {
  resources.value = resources.value.filter(r => r.id !== id)
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
    resources: resources.value
  })
}

const updateResourceAmount = (id, amount) => {
  const resource = resources.value.find(r => r.id === id)
  if (resource) {
    resource.amount = Number(amount) || 0
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
    const resource = resources.value.find(r => r.id === id)
    if (resource) {
      resource.icon = e.target.result // Base64 string
      emitUpdate()
    }
  }
  reader.readAsDataURL(file)
}

const removeIcon = (id) => {
  const resource = resources.value.find(r => r.id === id)
  if (resource) {
    resource.icon = null
    emitUpdate()
  }
}

const toggleWorkResource = (id) => {
  const resource = resources.value.find(r => r.id === id)
  if (resource) {
    resource.workResource = !resource.workResource
    emitUpdate()
  }
}
</script>

<template>
  <div class="resource-manager">
    <div class="section">
      <div class="section-header">
        <h3>📦 Resources</h3>
        <span class="count">{{ resources.length }}</span>
      </div>
      
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
              <input
                type="number"
                :value="resource.amount"
                @input="updateResourceAmount(resource.id, $event.target.value)"
                class="amount-input"
                min="0"
              />
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
  </div>
</template>

<style scoped>
.resource-manager {
  width: 100%;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #e0e0e0;
}

.section-header h3 {
  margin: 0;
  color: #667eea;
  font-size: 1.2rem;
}

.count {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.9rem;
  font-weight: 600;
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
