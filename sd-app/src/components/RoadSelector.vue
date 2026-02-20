<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  roadBuildingMode: {
    type: Boolean,
    default: false
  },
  roadDeleteMode: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['road-mode-toggled', 'road-delete-mode-toggled'])

const toggleRoadMode = () => {
  emit('road-mode-toggled', !props.roadBuildingMode)
}

const toggleRoadDeleteMode = () => {
  emit('road-delete-mode-toggled', !props.roadDeleteMode)
}
</script>

<template>
  <div class="toolbar">
    <!-- Build Road -->
    <button
      :class="['toolbar-btn', { active: roadBuildingMode }]"
      @click="toggleRoadMode"
      title="Build Road"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 12h18M3 6h18M3 18h18"/>
        <circle cx="7" cy="12" r="1" fill="currentColor"/>
        <circle cx="12" cy="12" r="1" fill="currentColor"/>
        <circle cx="17" cy="12" r="1" fill="currentColor"/>
      </svg>
    </button>

    <!-- Recycle (placeholder) -->
    <button
      class="toolbar-btn disabled"
      title="Recycle - coming soon"
      @click.prevent
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5"/>
        <path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12"/>
        <path d="m14 16-3 3 3 3"/>
        <path d="M8.293 13.596 4.875 7.97l.927-.535 2.862 4.7"/>
        <path d="M17.5 9.5 14.23 3.804a1.784 1.784 0 0 0-1.573-.886 1.83 1.83 0 0 0-1.557.89L9.875 6.03"/>
        <path d="m9.5 4.5 1-3.5 3.5 1"/>
        <path d="m17.5 9.5 3.5-1-1-3.5"/>
      </svg>
    </button>

    <!-- Remove / Delete -->
    <button
      :class="['toolbar-btn remove', { active: roadDeleteMode }]"
      @click="toggleRoadDeleteMode"
      title="Delete buildings & roads"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18"/>
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
        <line x1="10" y1="11" x2="10" y2="17"/>
        <line x1="14" y1="11" x2="14" y2="17"/>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
}

.toolbar-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 2px solid #e5e7eb;
  background: #f8f9fa;
  color: #555;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  padding: 6px;
}

.toolbar-btn:hover:not(.disabled) {
  border-color: #667eea;
  color: #667eea;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
}

.toolbar-btn.active {
  border-color: #10b981;
  background: linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(5,150,105,0.15) 100%);
  color: #059669;
  box-shadow: 0 0 0 2px rgba(16,185,129,0.25);
}

.toolbar-btn.remove.active {
  border-color: #ef4444;
  background: linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(220,38,38,0.15) 100%);
  color: #dc2626;
  box-shadow: 0 0 0 2px rgba(239,68,68,0.25);
}

.toolbar-btn.disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.toolbar-btn svg {
  width: 18px;
  height: 18px;
}
</style>
