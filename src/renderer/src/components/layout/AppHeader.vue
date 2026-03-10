<template>
  <header class="app-header drag-region">
    <div class="header-left no-drag">
      <img class="app-icon" src="../../assets/icon.png" alt="Frper" />
      <span class="app-title">Frper</span>
    </div>
    <div class="header-center drag-region">
      <!-- draggable area -->
    </div>
    <div class="header-controls no-drag">
      <button class="win-btn minimize" @click="minimize" title="最小化">
        <span>&#8212;</span>
      </button>
      <button class="win-btn maximize" @click="maximize" title="最大化/还原">
        <span>&#9633;</span>
      </button>
      <button class="win-btn close" @click="close" title="关闭">
        <span>&#10005;</span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
function minimize() {
  window.api.window.minimize()
}
function maximize() {
  window.api.window.maximize()
}
function close() {
  window.api.window.close()
}

</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  height: var(--header-height);
  background-color: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border);
  user-select: none;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
}

.app-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.app-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: 0.5px;
}

.header-center {
  flex: 1;
  height: 100%;
}

.header-controls {
  display: flex;
  align-items: center;
}

.win-btn {
  width: 46px;
  height: var(--header-height);
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  transition: background 0.15s;
}

.win-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
}

.win-btn.close:hover {
  background: #c42b1c;
  color: white;
}
</style>
