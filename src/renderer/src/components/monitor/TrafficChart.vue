<template>
  <div class="traffic-chart">
    <div class="chart-header">
      <span class="chart-title">连接趋势</span>
      <div class="range-tabs">
        <button
          v-for="r in ranges"
          :key="r.value"
          class="range-tab"
          :class="{ active: activeRange === r.value }"
          @click="activeRange = r.value"
        >
          {{ r.label }}
        </button>
      </div>
    </div>

    <div class="chart-body" ref="chartEl">
      <svg v-if="points.length > 0" :width="width" :height="height" class="chart-svg">
        <!-- Grid lines -->
        <line
          v-for="i in 4"
          :key="i"
          :x1="padL"
          :x2="width - padR"
          :y1="padT + ((height - padT - padB) / 4) * (i - 1)"
          :y2="padT + ((height - padT - padB) / 4) * (i - 1)"
          class="grid-line"
        />
        <!-- Connection polyline -->
        <polyline v-if="connPath" :points="connPath" class="line-conn" fill="none" />
        <!-- Error polyline -->
        <polyline v-if="errPath" :points="errPath" class="line-err" fill="none" />
        <!-- Fill area -->
        <polygon v-if="connFill" :points="connFill" class="fill-conn" />
        <!-- Y-axis labels -->
        <text :x="padL - 6" :y="padT + 4" class="axis-label" text-anchor="end">
          {{ maxVal }}
        </text>
        <text :x="padL - 6" :y="height - padB + 4" class="axis-label" text-anchor="end">
          0
        </text>
        <!-- X-axis time labels -->
        <text
          v-for="(lbl, i) in xLabels"
          :key="i"
          :x="lbl.x"
          :y="height - 4"
          class="axis-label"
          text-anchor="middle"
        >
          {{ lbl.text }}
        </text>
      </svg>

      <div v-else class="chart-empty">暂无连接数据</div>
    </div>

    <!-- Legend -->
    <div class="chart-legend">
      <span class="legend-item conn">
        <span class="legend-dot"></span> 连接数
      </span>
      <span class="legend-item err">
        <span class="legend-dot"></span> 错误数
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useMonitorStore } from '../../stores/monitor'

const monitorStore = useMonitorStore()

const ranges = [
  { label: '30分钟', value: 30 },
  { label: '1小时', value: 60 },
  { label: '6小时', value: 360 }
]
const activeRange = ref(60)

const chartEl = ref<HTMLElement | null>(null)
const width = ref(600)
const height = 120
const padL = 32
const padR = 8
const padT = 8
const padB = 20

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (chartEl.value) {
    resizeObserver = new ResizeObserver((entries) => {
      width.value = entries[0].contentRect.width || 600
    })
    resizeObserver.observe(chartEl.value)
    width.value = chartEl.value.clientWidth || 600
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})

const points = computed(() => monitorStore.recentTraffic(activeRange.value))

const maxVal = computed(() => {
  const max = Math.max(1, ...points.value.map((p) => Math.max(p.connections, p.errors)))
  return max
})

function toX(i: number, total: number): number {
  const w = width.value - padL - padR
  return total <= 1 ? padL + w / 2 : padL + (i / (total - 1)) * w
}

function toY(val: number): number {
  const h = height - padT - padB
  return padT + h - (val / maxVal.value) * h
}

const connPath = computed(() => {
  const pts = points.value
  if (pts.length === 0) return ''
  return pts.map((p, i) => `${toX(i, pts.length)},${toY(p.connections)}`).join(' ')
})

const errPath = computed(() => {
  const pts = points.value
  if (pts.length === 0) return ''
  return pts.map((p, i) => `${toX(i, pts.length)},${toY(p.errors)}`).join(' ')
})

const connFill = computed(() => {
  const pts = points.value
  if (pts.length === 0) return ''
  const line = pts.map((p, i) => `${toX(i, pts.length)},${toY(p.connections)}`).join(' ')
  const last = toX(pts.length - 1, pts.length)
  const first = toX(0, pts.length)
  const bottom = height - padB
  return `${line} ${last},${bottom} ${first},${bottom}`
})

const xLabels = computed(() => {
  const pts = points.value
  if (pts.length < 2) return []
  const step = Math.max(1, Math.floor(pts.length / 4))
  return pts
    .filter((_, i) => i % step === 0 || i === pts.length - 1)
    .map((p, idx, arr) => {
      const origIdx = idx * step
      const x = toX(Math.min(origIdx, pts.length - 1), pts.length)
      const d = new Date(p.timestamp)
      return {
        x,
        text: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
        key: arr[idx].timestamp
      }
    })
})
</script>

<style scoped>
.traffic-chart {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px 16px;
}

.chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.chart-title {
  font-size: 13px;
  color: var(--color-text-secondary);
  font-weight: 500;
}

.range-tabs {
  display: flex;
  gap: 2px;
}

.range-tab {
  padding: 2px 8px;
  font-size: 11px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.range-tab.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

.chart-body {
  width: 100%;
  min-height: 120px;
  position: relative;
}

.chart-svg {
  display: block;
  width: 100%;
  height: 120px;
  overflow: visible;
}

.grid-line {
  stroke: var(--color-border);
  stroke-width: 1;
  stroke-dasharray: 3 3;
  opacity: 0.5;
}

.line-conn {
  stroke: #4096ff;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.line-err {
  stroke: #ff4d4f;
  stroke-width: 1.5;
  stroke-dasharray: 4 2;
  stroke-linejoin: round;
}

.fill-conn {
  fill: #4096ff;
  opacity: 0.08;
}

.axis-label {
  font-size: 10px;
  fill: var(--color-text-tertiary);
  font-family: 'Consolas', monospace;
}

.chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100px;
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.chart-legend {
  display: flex;
  gap: 16px;
  margin-top: 6px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--color-text-secondary);
}

.legend-dot {
  width: 10px;
  height: 2px;
  border-radius: 1px;
  display: inline-block;
}

.legend-item.conn .legend-dot {
  background: #4096ff;
}

.legend-item.err .legend-dot {
  background: #ff4d4f;
}
</style>
