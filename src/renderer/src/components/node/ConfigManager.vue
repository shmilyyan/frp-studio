<template>
  <a-modal
    :open="open"
    title="配置管理"
    :footer="null"
    @cancel="$emit('update:open', false)"
    width="600px"
  >
    <a-tabs v-model:activeKey="activeTab">
      <!-- Tab 1: Field-based config -->
      <a-tab-pane key="fields" tab="字段配置">
        <div class="config-fields">
          <a-descriptions :column="1" bordered size="small">
            <a-descriptions-item label="服务端地址">{{ node?.host }}</a-descriptions-item>
            <a-descriptions-item label="服务端端口">{{ node?.port }}</a-descriptions-item>
            <a-descriptions-item label="认证 Token">{{
              node?.token ? '已设置' : '未设置'
            }}</a-descriptions-item>
          </a-descriptions>

          <div class="config-preview">
            <div class="preview-label">生成的 frpc.toml 预览</div>
            <pre class="code-block">{{ generatedConfig }}</pre>
          </div>
        </div>
      </a-tab-pane>

      <!-- Tab 2: Paste & validate -->
      <a-tab-pane key="paste" tab="粘贴验证 (frps.toml)">
        <div class="paste-area">
          <a-textarea
            v-model:value="pastedConfig"
            :rows="12"
            placeholder="粘贴 frps.toml 内容..."
            style="font-family: monospace; font-size: 12px"
          />
          <div class="paste-actions">
            <a-button @click="validateConfig" :loading="validating">验证配置</a-button>
            <a-button
              type="primary"
              :disabled="!validationResult?.valid"
              @click="applyConfig"
            >
              应用到节点
            </a-button>
          </div>
          <div v-if="validationResult" class="validation-result">
            <a-alert
              v-if="validationResult.valid"
              type="success"
              message="配置验证通过"
              show-icon
            />
            <template v-else>
              <a-alert type="error" message="配置验证失败" show-icon />
              <ul class="error-list">
                <li v-for="err in validationResult.errors" :key="err">{{ err }}</li>
              </ul>
            </template>
          </div>
        </div>
      </a-tab-pane>
    </a-tabs>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Node } from '../../stores/node'
import { message } from 'ant-design-vue'

interface Props {
  open: boolean
  node?: Node | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  apply: [data: Partial<Node>]
}>()

const activeTab = ref('fields')
const pastedConfig = ref('')
const validating = ref(false)
const validationResult = ref<{ valid: boolean; errors: string[]; extracted?: Record<string, unknown> } | null>(null)

const generatedConfig = computed(() => {
  if (!props.node) return ''
  let cfg = `serverAddr = "${props.node.host}"\nserverPort = ${props.node.port}\n`
  if (props.node.token) {
    cfg += `\n[auth]\nmethod = "token"\ntoken = "${props.node.token}"\n`
  }
  return cfg
})

watch(
  () => props.open,
  (val) => {
    if (val) {
      validationResult.value = null
      pastedConfig.value = ''
    }
  }
)

async function validateConfig() {
  if (!pastedConfig.value.trim()) {
    message.warning('请先粘贴 frps.toml 内容')
    return
  }
  validating.value = true
  try {
    validationResult.value = await window.api.node.validateConfig(pastedConfig.value)
  } finally {
    validating.value = false
  }
}

function applyConfig() {
  if (!validationResult.value?.valid) return
  const extracted = validationResult.value.extracted as Record<string, unknown> | undefined
  if (extracted) {
    emit('apply', {
      port: extracted.port as number | undefined,
      token: extracted.token as string | undefined
    })
    message.success('配置已应用')
    emit('update:open', false)
  }
}
</script>

<style scoped>
.config-fields {
  padding: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.config-preview {
  margin-top: 8px;
}

.preview-label {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 8px;
}

.code-block {
  background: #0d0d0d;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 12px;
  font-size: 12px;
  font-family: 'Cascadia Code', 'Consolas', monospace;
  color: #a8ff78;
  white-space: pre-wrap;
}

.paste-area {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 0;
}

.paste-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.validation-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.error-list {
  padding-left: 20px;
  color: var(--color-error);
  font-size: 13px;
}

.error-list li {
  margin: 4px 0;
}
</style>
