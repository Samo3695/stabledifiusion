<script setup>
import { ref } from 'vue'

const props = defineProps({
  initialResources: {
    type: Array,
    default: () => []
  },
  initialWorkforce: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update'])

const resources = ref([...props.initialResources])
const workforce = ref([...props.initialWorkforce])
const newResourceName = ref('')
const newWorkforceName = ref('')
const editingResourceId = ref(null)
const editingWorkforceId = ref(null)

const addResource = () => {
  if (!newResourceName.value.trim()) return
  
  const newResource = {
    id: Date.now().toString(),
    name: newResourceName.value.trim(),
    amount: 0
  }
  
  resources.value.push(newResource)
  newResourceName.value = ''
  emitUpdate()
}

const addWorkforce = () => {
  if (!newWorkforceName.value.trim()) return
  
  const newWorker = {
    id: Date.now().toString(),
    name: newWorkforceName.value.trim(),
    count: 0
  }
  
  workforce.value.push(newWorker)
  newWorkforceName.value = ''
  emitUpdate()
}

const deleteResource = (id) => {
  resources.value = resources.value.filter(r => r.id !== id)
  emitUpdate()
}

const deleteWorkforce = (id) => {
  workforce.value = workforce.value.filter(w => w.id !== id)
  emitUpdate()
}

const startEditResource = (id) => {
  editingResourceId.value = id
}

const startEditWorkforce = (id) => {
  editingWorkforceId.value = id
}

const finishEditResource = () => {
  editingResourceId.value = null
  emitUpdate()
}

const finishEditWorkforce = () => {
  editingWorkforceId.value = null
  emitUpdate()
}

const emitUpdate = () => {
  emit('update', {
    resources: resources.value,
    workforce: workforce.value
  })
}

const updateResourceAmount = (id, amount) => {
  const resource = resources.value.find(r => r.id === id)
  if (resource) {
    resource.amount = Number(amount) || 0
    emitUpdate()
  }
}

const updateWorkforceCount = (id, count) => {
  const worker = workforce.value.find(w => w.id === id)
  if (worker) {
    worker.count = Number(count) || 0
    emitUpdate()
  }
}
</script>

<template>
  <div class="resource-manager">
    <div class="manager-grid">
      <!-- Resources Section -->
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
      
      <!-- Workforce Section -->
      <div class="section">
        <div class="section-header">
          <h3>👷 Workforce</h3>
          <span class="count">{{ workforce.length }}</span>
        </div>
        
        <div class="add-item">
          <input
            v-model="newWorkforceName"
            type="text"
            placeholder="Názov workforce..."
            @keyup.enter="addWorkforce"
            maxlength="50"
          />
          <button @click="addWorkforce" class="btn-add">
            ➕ Pridať
          </button>
        </div>
        
        <div class="items-list">
          <div v-if="workforce.length === 0" class="empty-state">
            <p>Zatiaľ žiadna workforce</p>
          </div>
          
          <div 
            v-for="worker in workforce" 
            :key="worker.id" 
            class="item"
          >
            <div class="item-content">
              <input
                v-if="editingWorkforceId === worker.id"
                v-model="worker.name"
                @blur="finishEditWorkforce"
                @keyup.enter="finishEditWorkforce"
                class="edit-input"
                autofocus
              />
              <span 
                v-else 
                class="item-name"
                @dblclick="startEditWorkforce(worker.id)"
              >
                {{ worker.name }}
              </span>
              
              <div class="item-controls">
                <input
                  type="number"
                  :value="worker.count"
                  @input="updateWorkforceCount(worker.id, $event.target.value)"
                  class="amount-input"
                  min="0"
                />
                <button 
                  @click="deleteWorkforce(worker.id)" 
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
  </div>
</template>

<style scoped>
.resource-manager {
  width: 100%;
}

.manager-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
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
