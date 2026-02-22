<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  events: {
    type: Array,
    default: () => []
  },
  resources: {
    type: Array,
    default: () => []
  },
  workforce: {
    type: Array,
    default: () => []
  },
  images: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update-events'])

// Formulár pre nový event
const newEventName = ref('')
const newEventDescription = ref('')
const newEventImage = ref(null)
const imageInput = ref(null)
const newEventTrigger = ref('day')

// Trigger typy
const triggerTypes = [
  { value: 'day', label: '📅 Day Event', description: 'Spustí sa v konkrétny herný deň' },
  { value: 'resource', label: '📦 Resource Event', description: 'Spustí sa pri zmene resources' },
  { value: 'building', label: '🏗️ Building Event', description: 'Spustí sa pri akcii s budovou' }
]

// Day event konfigurácia
const dayEventDay = ref(1)

// Resource event konfigurácia
const resourceEventType = ref('reaches')
const resourceEventResourceId = ref('')
const resourceEventValue = ref(0)

const resourceConditions = [
  { value: 'reaches', label: 'Dosiahne hodnotu' },
  { value: 'drops_below', label: 'Klesne pod' },
  { value: 'exceeds', label: 'Presiahne' },
  { value: 'equals', label: 'Rovná sa' }
]

// Building event konfigurácia
const buildingEventType = ref('built')
const buildingEventBuildingId = ref('')

// Computed - reálne resources (všetky vrátane workforce)
const allResources = computed(() => {
  const res = [...(props.resources || []), ...(props.workforce || [])]
  return res
})

// Computed - reálne budovy z images
const allBuildings = computed(() => {
  return (props.images || []).filter(img => img.buildingData?.isBuilding === true)
})

const buildingConditions = [
  { value: 'built', label: 'Budova postavená' },
  { value: 'destroyed', label: 'Budova zničená' },
  { value: 'recycled', label: 'Budova recyklovaná' },
  { value: 'production_started', label: 'Produkcia spustená' },
  { value: 'production_stopped', label: 'Produkcia zastavená' }
]

// Akcie pre event
const newActionType = ref('show_message')
const newActionMessage = ref('')
const newActionResourceId = ref('')
const newActionResourceAmount = ref(0)

const actionTypes = [
  { value: 'show_message', label: '💬 Zobraziť správu' },
  { value: 'add_resource', label: '➕ Pridať resource' },
  { value: 'remove_resource', label: '➖ Odobrať resource' },
  { value: 'unlock_building', label: '🔓 Odomknúť budovu' }
]

// Editácia
const editingIndex = ref(-1)
const editingEvent = ref(null)
const editImageInput = ref(null)

// Image upload handler
const handleImageUpload = (event, target = 'new') => {
  const file = event.target.files[0]
  if (!file) return
  
  const reader = new FileReader()
  reader.onload = (e) => {
    // Resize to max 300px to keep JSON small
    const img = new Image()
    img.onload = () => {
      const maxSize = 300
      let w = img.width
      let h = img.height
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize }
        else { w = Math.round(w * maxSize / h); h = maxSize }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
      
      if (target === 'new') {
        newEventImage.value = dataUrl
      } else if (editingEvent.value) {
        editingEvent.value.image = dataUrl
      }
    }
    img.src = e.target.result
  }
  reader.readAsDataURL(file)
}

const removeNewImage = () => {
  newEventImage.value = null
  if (imageInput.value) imageInput.value.value = ''
}

const removeEditImage = () => {
  if (editingEvent.value) editingEvent.value.image = null
  if (editImageInput.value) editImageInput.value.value = ''
}

const addEvent = () => {
  if (!newEventName.value.trim()) return

  const event = {
    id: Date.now(),
    name: newEventName.value.trim(),
    description: newEventDescription.value.trim(),
    image: newEventImage.value,
    trigger: newEventTrigger.value,
    enabled: true,
    triggerConfig: getTriggerConfig(),
    actions: []
  }

  const updated = [...props.events, event]
  emit('update-events', updated)

  // Reset formulár
  newEventName.value = ''
  newEventDescription.value = ''
  newEventImage.value = null
  if (imageInput.value) imageInput.value.value = ''
  newEventTrigger.value = 'day'
  dayEventDay.value = 1
  resourceEventType.value = 'reaches'
  resourceEventResourceId.value = ''
  resourceEventValue.value = 0
  buildingEventType.value = 'built'
  buildingEventBuildingId.value = ''
}

const getTriggerConfig = () => {
  switch (newEventTrigger.value) {
    case 'day':
      return { day: dayEventDay.value }
    case 'resource':
      return {
        condition: resourceEventType.value,
        resourceId: resourceEventResourceId.value,
        resourceName: allResources.value.find(r => r.id === resourceEventResourceId.value)?.name || '',
        value: resourceEventValue.value
      }
    case 'building':
      return { 
        condition: buildingEventType.value,
        buildingId: buildingEventBuildingId.value,
        buildingName: allBuildings.value.find(b => b.id === buildingEventBuildingId.value)?.buildingData?.buildingName || ''
      }
    default:
      return {}
  }
}

const removeEvent = (index) => {
  const updated = props.events.filter((_, i) => i !== index)
  emit('update-events', updated)
}

const toggleEvent = (index) => {
  const updated = [...props.events]
  updated[index] = { ...updated[index], enabled: !updated[index].enabled }
  emit('update-events', updated)
}

const startEdit = (index) => {
  editingIndex.value = index
  editingEvent.value = JSON.parse(JSON.stringify(props.events[index]))
}

const saveEdit = () => {
  if (editingIndex.value < 0 || !editingEvent.value) return
  const updated = [...props.events]
  updated[editingIndex.value] = editingEvent.value
  emit('update-events', updated)
  editingIndex.value = -1
  editingEvent.value = null
}

const cancelEdit = () => {
  editingIndex.value = -1
  editingEvent.value = null
}

const getTriggerLabel = (trigger) => {
  const found = triggerTypes.find(t => t.value === trigger)
  return found ? found.label : trigger
}

const getTriggerDescription = (event) => {
  if (!event.triggerConfig) return ''
  switch (event.trigger) {
    case 'day':
      return `Deň ${event.triggerConfig.day}`
    case 'resource': {
      const cond = resourceConditions.find(c => c.value === event.triggerConfig.condition)
      const resName = event.triggerConfig.resourceName || allResources.value.find(r => r.id === event.triggerConfig.resourceId)?.name || event.triggerConfig.resourceId
      return `${resName}: ${cond?.label || event.triggerConfig.condition} ${event.triggerConfig.value}`
    }
    case 'building': {
      const cond = buildingConditions.find(c => c.value === event.triggerConfig.condition)
      const bldName = event.triggerConfig.buildingName || allBuildings.value.find(b => b.id === event.triggerConfig.buildingId)?.buildingData?.buildingName || ''
      return `${cond?.label || event.triggerConfig.condition}${bldName ? ' - ' + bldName : ''}`
    }
    default:
      return ''
  }
}
</script>

<template>
  <div class="event-emitter">
    <!-- Formulár pre nový event -->
    <div class="new-event-form">
      <h3>➕ Vytvoriť nový event</h3>
      
      <div class="form-row">
        <label>Názov eventu</label>
        <input 
          v-model="newEventName" 
          type="text" 
          placeholder="Napr. Príchod posíl..." 
          class="form-input"
        />
      </div>

      <div class="form-row">
        <label>Popis eventu</label>
        <textarea 
          v-model="newEventDescription" 
          placeholder="Dlhší popis toho čo sa stane..." 
          class="form-textarea"
          rows="3"
        ></textarea>
      </div>

      <div class="form-row">
        <label>Obrázok (voliteľné)</label>
        <div class="image-upload-area">
          <input 
            ref="imageInput"
            type="file" 
            accept="image/*" 
            @change="handleImageUpload($event, 'new')" 
            class="file-input"
          />
          <div v-if="newEventImage" class="image-preview">
            <img :src="newEventImage" alt="Event preview" />
            <button @click="removeNewImage" class="btn-remove-img" title="Odstrániť obrázok">✕</button>
          </div>
        </div>
      </div>

      <div class="form-row">
        <label>Event Trigger</label>
        <select v-model="newEventTrigger" class="form-select">
          <option v-for="t in triggerTypes" :key="t.value" :value="t.value">
            {{ t.label }}
          </option>
        </select>
        <span class="trigger-description">
          {{ triggerTypes.find(t => t.value === newEventTrigger)?.description }}
        </span>
      </div>

      <!-- Day Event konfigurácia -->
      <div v-if="newEventTrigger === 'day'" class="trigger-config">
        <div class="form-row">
          <label>Herný deň</label>
          <input v-model.number="dayEventDay" type="number" min="1" class="form-input small" />
        </div>
      </div>

      <!-- Resource Event konfigurácia -->
      <div v-if="newEventTrigger === 'resource'" class="trigger-config">
        <div class="form-row">
          <label>Podmienka</label>
          <select v-model="resourceEventType" class="form-select">
            <option v-for="c in resourceConditions" :key="c.value" :value="c.value">
              {{ c.label }}
            </option>
          </select>
        </div>
        <div class="form-row">
          <label>Resource</label>
          <select v-model="resourceEventResourceId" class="form-select">
            <option value="" disabled>-- Vyber resource --</option>
            <option v-for="r in allResources" :key="r.id" :value="r.id">
              {{ r.name }} {{ r.workResource ? '(👷 work)' : '' }}
            </option>
          </select>
          <span v-if="allResources.length === 0" class="trigger-description">* Žiadne resources nie sú definované</span>
        </div>
        <div class="form-row">
          <label>Hodnota</label>
          <input v-model.number="resourceEventValue" type="number" min="0" class="form-input small" />
        </div>
      </div>

      <!-- Building Event konfigurácia -->
      <div v-if="newEventTrigger === 'building'" class="trigger-config">
        <div class="form-row">
          <label>Typ udalosti</label>
          <select v-model="buildingEventType" class="form-select">
            <option v-for="c in buildingConditions" :key="c.value" :value="c.value">
              {{ c.label }}
            </option>
          </select>
        </div>
        <div class="form-row">
          <label>Budova (voliteľné)</label>
          <select v-model="buildingEventBuildingId" class="form-select">
            <option value="">-- Akákoľvek budova --</option>
            <option v-for="b in allBuildings" :key="b.id" :value="b.id">
              {{ b.buildingData?.buildingName || 'Bez názvu' }}
            </option>
          </select>
          <span v-if="allBuildings.length === 0" class="trigger-description">* Žiadne budovy nie sú v galérii</span>
        </div>
      </div>

      <button @click="addEvent" class="btn-add" :disabled="!newEventName.trim()">
        ✅ Pridať Event
      </button>
    </div>

    <!-- Zoznam existujúcich eventov -->
    <div class="events-list">
      <h3>📋 Existujúce eventy ({{ events.length }})</h3>
      
      <div v-if="events.length === 0" class="empty-state">
        <p>Žiadne eventy. Vytvor prvý event vyššie.</p>
      </div>

      <div 
        v-for="(event, index) in events" 
        :key="event.id" 
        class="event-item"
        :class="{ disabled: !event.enabled, editing: editingIndex === index }"
      >
        <!-- Normálny pohľad -->
        <template v-if="editingIndex !== index">
          <div class="event-header">
            <div class="event-name">
              <span class="event-status" :class="{ active: event.enabled }">●</span>
              {{ event.name }}
            </div>
            <div class="event-actions">
              <button @click="toggleEvent(index)" class="action-btn" :title="event.enabled ? 'Vypnúť' : 'Zapnúť'">
                {{ event.enabled ? '⏸️' : '▶️' }}
              </button>
              <button @click="startEdit(index)" class="action-btn" title="Upraviť">✏️</button>
              <button @click="removeEvent(index)" class="action-btn delete" title="Zmazať">🗑️</button>
            </div>
          </div>
          <div v-if="event.description" class="event-description">
            {{ event.description }}
          </div>
          <div v-if="event.image" class="event-image-thumb">
            <img :src="event.image" alt="Event image" />
          </div>
          <div class="event-details">
            <span class="event-trigger-badge">{{ getTriggerLabel(event.trigger) }}</span>
            <span class="event-trigger-desc">{{ getTriggerDescription(event) }}</span>
          </div>
        </template>

        <!-- Editácia -->
        <template v-else>
          <div class="edit-form">
            <div class="form-row">
              <label>Názov</label>
              <input v-model="editingEvent.name" type="text" class="form-input" />
            </div>
            <div class="form-row">
              <label>Popis</label>
              <textarea v-model="editingEvent.description" class="form-textarea" rows="3" placeholder="Popis eventu..."></textarea>
            </div>
            <div class="form-row">
              <label>Obrázok</label>
              <div class="image-upload-area">
                <input 
                  ref="editImageInput"
                  type="file" 
                  accept="image/*" 
                  @change="handleImageUpload($event, 'edit')" 
                  class="file-input"
                />
                <div v-if="editingEvent.image" class="image-preview">
                  <img :src="editingEvent.image" alt="Event preview" />
                  <button @click="removeEditImage" class="btn-remove-img" title="Odstrániť obrázok">✕</button>
                </div>
              </div>
            </div>
            <div class="form-row">
              <label>Trigger</label>
              <select v-model="editingEvent.trigger" class="form-select">
                <option v-for="t in triggerTypes" :key="t.value" :value="t.value">
                  {{ t.label }}
                </option>
              </select>
            </div>
            <div class="edit-actions">
              <button @click="saveEdit" class="btn-save-edit">💾 Uložiť</button>
              <button @click="cancelEdit" class="btn-cancel-edit">❌ Zrušiť</button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.event-emitter {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.new-event-form {
  background: #f8f9fa;
  border-radius: 12px;
  padding: 1.25rem;
  border: 1px solid #e0e0e0;
}

.new-event-form h3,
.events-list h3 {
  margin: 0 0 1rem 0;
  font-size: 1rem;
  color: #374151;
  font-weight: 700;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-bottom: 0.75rem;
}

.form-row label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.form-input {
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.9rem;
  background: white;
  transition: border-color 0.2s;
}

.form-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

.form-input.small {
  max-width: 120px;
}

.form-select {
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.9rem;
  background: white;
  cursor: pointer;
  transition: border-color 0.2s;
}

.form-select:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

.trigger-description {
  font-size: 0.78rem;
  color: #9ca3af;
  font-style: italic;
}

.trigger-config {
  margin: 0.5rem 0;
  padding: 0.75rem;
  background: white;
  border-radius: 8px;
  border: 1px dashed #d1d5db;
}

.btn-add {
  width: 100%;
  padding: 0.65rem 1rem;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 0.5rem;
}

.btn-add:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.35);
}

.btn-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Zoznam eventov */
.events-list {
  background: #f8f9fa;
  border-radius: 12px;
  padding: 1.25rem;
  border: 1px solid #e0e0e0;
}

.empty-state {
  text-align: center;
  padding: 1.5rem;
  color: #9ca3af;
  font-style: italic;
}

.event-item {
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  background: white;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  transition: all 0.2s;
}

.event-item:hover {
  border-color: #667eea;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.1);
}

.event-item.disabled {
  opacity: 0.55;
  background: #f9fafb;
}

.event-item.editing {
  border-color: #f59e0b;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
}

.event-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.35rem;
}

.event-name {
  font-weight: 600;
  font-size: 0.9rem;
  color: #1f2937;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.event-status {
  font-size: 0.6rem;
  color: #9ca3af;
}

.event-status.active {
  color: #10b981;
}

.event-actions {
  display: flex;
  gap: 0.25rem;
}

.action-btn {
  padding: 0.25rem 0.4rem;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 0.85rem;
  border-radius: 4px;
  transition: background 0.15s;
}

.action-btn:hover {
  background: #f3f4f6;
}

.action-btn.delete:hover {
  background: #fee2e2;
}

.event-details {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.event-trigger-badge {
  font-size: 0.75rem;
  padding: 0.2rem 0.5rem;
  background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
  color: #6d28d9;
  border-radius: 12px;
  font-weight: 600;
}

.event-trigger-desc {
  font-size: 0.78rem;
  color: #6b7280;
}

/* Editácia */
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.edit-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.btn-save-edit,
.btn-cancel-edit {
  flex: 1;
  padding: 0.45rem 0.75rem;
  border: none;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-save-edit {
  background: #10b981;
  color: white;
}

.btn-save-edit:hover {
  background: #059669;
}

.btn-cancel-edit {
  background: #e5e7eb;
  color: #4b5563;
}

.btn-cancel-edit:hover {
  background: #d1d5db;
}

/* Textarea */
.form-textarea {
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.9rem;
  background: white;
  resize: vertical;
  font-family: inherit;
  min-height: 60px;
  transition: border-color 0.2s;
}

.form-textarea:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

/* Image upload */
.image-upload-area {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.file-input {
  font-size: 0.82rem;
  color: #6b7280;
}

.file-input::file-selector-button {
  padding: 0.35rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: white;
  color: #374151;
  font-size: 0.82rem;
  cursor: pointer;
  margin-right: 0.5rem;
  transition: all 0.15s;
}

.file-input::file-selector-button:hover {
  background: #f3f4f6;
  border-color: #667eea;
}

.image-preview {
  position: relative;
  display: inline-block;
  max-width: 200px;
}

.image-preview img {
  width: 100%;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.btn-remove-img {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.85);
  color: white;
  font-size: 0.7rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  transition: background 0.15s;
}

.btn-remove-img:hover {
  background: #dc2626;
}

/* Event description & image thumb in list */
.event-description {
  font-size: 0.82rem;
  color: #6b7280;
  margin-bottom: 0.35rem;
  line-height: 1.4;
  white-space: pre-wrap;
}

.event-image-thumb {
  margin-bottom: 0.35rem;
}

.event-image-thumb img {
  max-width: 120px;
  max-height: 80px;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  object-fit: cover;
}
</style>
