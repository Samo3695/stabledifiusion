<script setup>
const props = defineProps({
  resources: {
    type: Array,
    default: () => []
  },
  storedResources: {
    type: Object,
    default: () => ({})
  }
})
</script>

<template>
  <div class="resource-display">
    <div class="resource-header">
      <h2>📊 Resources</h2>
    </div>
    
    <div class="resource-list">
      <div v-if="resources.length === 0" class="empty-state">
        <p>Žiadne resources</p>
      </div>
      
      <div 
        v-for="resource in resources" 
        :key="resource.id" 
        class="resource-item"
      >
        <div class="resource-icon">
          <img 
            v-if="resource.icon" 
            :src="resource.icon" 
            :alt="resource.name"
            class="icon-image"
          />
          <span v-else class="icon-placeholder">📦</span>
        </div>
        <div class="resource-info">
          <div class="resource-name">{{ resource.name }}</div>
          <div class="resource-amounts">
            <span class="amount-current">{{ resource.amount }}</span>
            <span 
              v-if="storedResources && storedResources[resource.id] !== undefined" 
              class="amount-stored"
              :class="{ 'storage-full': resource.amount >= storedResources[resource.id] }"
            >/{{ storedResources[resource.id] }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.resource-display {
  display: flex;
  flex-direction: column;
  background: white;
}

.resource-header {
  padding: 1rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-bottom: 2px solid #e0e0e0;
}

.resource-header h2 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 600;
}

.resource-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}

.empty-state {
  text-align: center;
  padding: 2rem;
  color: #999;
}

.empty-state p {
  margin: 0;
  font-size: 0.9rem;
}

.resource-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  transition: all 0.2s;
}

.resource-item:hover {
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}

.resource-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border-radius: 8px;
  border: 2px solid #e0e0e0;
  flex-shrink: 0;
}

.icon-image {
  width: 40px;
  height: 40px;
  object-fit: contain;
  border-radius: 4px;
}

.icon-placeholder {
  font-size: 1.5rem;
}

.resource-info {
  flex: 1;
  min-width: 0;
}

.resource-name {
  font-weight: 600;
  color: #333;
  font-size: 0.95rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 0.25rem;
}

.resource-amounts {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.amount-current {
  font-weight: 700;
  font-size: 1.3rem;
  color: #667eea;
}

.amount-stored {
  font-weight: 700;
  font-size: 1.3rem;
  color: #000; /* čierna farba pre stored hodnotu */
  transition: color 0.3s ease;
}

.amount-stored.storage-full {
  color: #ff0000; /* červená farba keď je sklad plný */
}

/* Scrollbar styling */
.resource-list::-webkit-scrollbar {
  width: 8px;
}

.resource-list::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

.resource-list::-webkit-scrollbar-thumb {
  background: #667eea;
  border-radius: 4px;
}

.resource-list::-webkit-scrollbar-thumb:hover {
  background: #5568d3;
}
</style>
