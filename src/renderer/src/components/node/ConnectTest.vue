<template>
  <a-modal
    :open="open"
    title="连通性测试"
    :footer="null"
    @cancel="$emit('update:open', false)"
    width="420px"
  >
    <div class="test-container">
      <div class="test-step" v-for="(step, i) in steps" :key="i">
        <div class="step-status">
          <a-spin v-if="step.status === 'testing'" :size="'small'" />
          <span v-else-if="step.status === 'success'" class="step-icon success">✓</span>
          <span v-else-if="step.status === 'fail'" class="step-icon fail">✗</span>
          <span v-else class="step-icon pending">○</span>
        </div>
        <div class="step-info">
          <div class="step-label">{{ step.label }}</div>
          <div class="step-desc" :class="step.status">{{ step.desc }}</div>
        </div>
      </div>
    </div>

    <div v-if="done" class="test-summary">
      <a-alert
        :type="allPassed ? 'success' : 'error'"
        :message="allPassed ? '连接测试通过' : '连接测试失败'"
        :description="summaryDesc"
        show-icon
      />
      <div class="test-actions">
        <a-button @click="$emit('update:open', false)">关闭</a-button>
        <a-button type="primary" @click="runTest">重新测试</a-button>
      </div>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

interface Props {
  open: boolean
  host: string
  port: number
  token?: string | null
}

const props = defineProps<Props>()
defineEmits<{ 'update:open': [value: boolean] }>()

type StepStatus = 'pending' | 'testing' | 'success' | 'fail'

const steps = ref([
  { label: 'TCP 连接', desc: '等待测试...', status: 'pending' as StepStatus },
  { label: 'FRP 服务', desc: '等待测试...', status: 'pending' as StepStatus },
  { label: 'Token 验证', desc: '等待测试...', status: 'pending' as StepStatus }
])

const done = ref(false)
const allPassed = ref(false)
const summaryDesc = ref('')

watch(
  () => props.open,
  (val) => {
    if (val) runTest()
  }
)

async function runTest() {
  done.value = false
  steps.value = [
    { label: 'TCP 连接', desc: '正在测试...', status: 'testing' },
    { label: 'FRP 服务', desc: '等待测试...', status: 'pending' },
    { label: 'Token 验证', desc: '等待测试...', status: 'pending' }
  ]

  const result = await window.api.node.test(props.host, props.port, props.token || undefined)

  // Step 1: TCP
  if (result.tcpReachable) {
    steps.value[0] = {
      label: 'TCP 连接',
      desc: `连接成功 (${result.latency}ms)`,
      status: 'success'
    }
  } else {
    steps.value[0] = {
      label: 'TCP 连接',
      desc: result.error || '连接失败',
      status: 'fail'
    }
    steps.value[1] = { label: 'FRP 服务', desc: '跳过', status: 'fail' }
    steps.value[2] = { label: 'Token 验证', desc: '跳过', status: 'fail' }
    done.value = true
    allPassed.value = false
    summaryDesc.value = `无法连接到 ${props.host}:${props.port}`
    return
  }

  // Step 2: FRP running
  steps.value[1] = {
    label: 'FRP 服务',
    desc: result.frpRunning ? 'frps 正在运行' : '未检测到 frps',
    status: result.frpRunning ? 'success' : 'fail'
  }

  // Step 3: Token
  if (!props.token) {
    steps.value[2] = { label: 'Token 验证', desc: '未设置 token，跳过', status: 'success' }
  } else if (result.tokenValid === true) {
    steps.value[2] = { label: 'Token 验证', desc: 'Token 验证通过', status: 'success' }
  } else if (result.tokenValid === false) {
    steps.value[2] = { label: 'Token 验证', desc: 'Token 验证失败', status: 'fail' }
  } else {
    steps.value[2] = { label: 'Token 验证', desc: '无法验证（管理 API 不可用）', status: 'success' }
  }

  done.value = true
  allPassed.value = steps.value.every((s) => s.status === 'success')
  summaryDesc.value = allPassed.value
    ? `成功连接到 ${props.host}:${props.port}`
    : '部分检测项未通过，请检查服务器配置'
}
</script>

<style scoped>
.test-container {
  padding: 16px 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.test-step {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.step-status {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}

.step-icon {
  font-size: 16px;
  font-weight: bold;
}

.step-icon.success {
  color: var(--color-success);
}
.step-icon.fail {
  color: var(--color-error);
}
.step-icon.pending {
  color: var(--color-text-tertiary);
}

.step-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-primary);
}

.step-desc {
  font-size: 12px;
  margin-top: 2px;
  color: var(--color-text-secondary);
}

.step-desc.success {
  color: var(--color-success);
}
.step-desc.fail {
  color: var(--color-error);
}

.test-summary {
  margin-top: 8px;
}

.test-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
