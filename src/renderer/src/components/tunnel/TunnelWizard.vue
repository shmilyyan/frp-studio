<template>
  <a-modal
    :open="open"
    title="新建隧道"
    :footer="null"
    @cancel="$emit('update:open', false)"
    width="640px"
  >
    <a-steps :current="currentStep" size="small" style="margin-bottom: 24px">
      <a-step title="选择类型" />
      <a-step title="填写配置" />
      <a-step title="确认创建" />
    </a-steps>

    <!-- Step 0: Type selection -->
    <div v-if="currentStep === 0" class="step-content">
      <div class="type-grid">
        <div
          v-for="tpl in templates"
          :key="tpl.type"
          class="type-card"
          :class="{ selected: selectedType === tpl.type }"
          @click="selectTemplate(tpl)"
        >
          <div class="type-icon">{{ tpl.icon }}</div>
          <div class="type-name">{{ tpl.name }}</div>
          <div class="type-desc">{{ tpl.desc }}</div>
        </div>
      </div>

      <div class="preset-label">快速模板</div>
      <div class="preset-grid">
        <a-tag
          v-for="preset in presets"
          :key="preset.name"
          class="preset-tag"
          @click="applyPreset(preset)"
        >
          {{ preset.name }}
        </a-tag>
      </div>
    </div>

    <!-- Step 1: Config form -->
    <div v-if="currentStep === 1" class="step-content">
      <a-form ref="formRef" :model="form" :rules="rules" layout="vertical">
        <a-form-item label="所属节点" name="node_id">
          <a-select v-model:value="form.node_id" placeholder="选择节点">
            <a-select-option v-for="n in nodes" :key="n.id" :value="n.id">
              {{ n.name }} ({{ n.host }})
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="隧道名称" name="name">
          <a-input v-model:value="form.name" placeholder="唯一标识，如: my-ssh" />
        </a-form-item>
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="本地 IP" name="local_ip">
              <a-input v-model:value="form.local_ip" placeholder="127.0.0.1" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="本地端口" name="local_port">
              <a-input-number
                v-model:value="form.local_port"
                :min="1"
                :max="65535"
                style="width: 100%"
              />
            </a-form-item>
          </a-col>
        </a-row>

        <!-- TCP / UDP 远程端口 -->
        <template v-if="['tcp', 'udp'].includes(form.type)">
          <a-form-item label="远程端口" name="remote_port">
            <a-input-number
              v-model:value="form.remote_port"
              :min="1"
              :max="65535"
              style="width: 100%"
              placeholder="0 = 随机分配"
            />
          </a-form-item>
        </template>

        <!-- HTTP / HTTPS 域名 -->
        <template v-if="['http', 'https'].includes(form.type)">
          <a-form-item label="自定义域名" name="custom_domain">
            <a-input v-model:value="form.custom_domain" placeholder="如: app.example.com" />
          </a-form-item>
        </template>

        <!-- ── 高级配置 ── -->
        <a-collapse ghost class="advanced-collapse">
          <a-collapse-panel key="adv" header="高级配置">

            <!-- 通用：加密 / 压缩 -->
            <a-row :gutter="24" style="margin-bottom: 12px">
              <a-col :span="12">
                <div class="switch-row">
                  <span class="switch-label">加密传输</span>
                  <a-switch v-model:checked="advanced.useEncryption" size="small" />
                </div>
              </a-col>
              <a-col :span="12">
                <div class="switch-row">
                  <span class="switch-label">压缩传输</span>
                  <a-switch v-model:checked="advanced.useCompression" size="small" />
                </div>
              </a-col>
            </a-row>

            <!-- 通用：带宽限制 -->
            <a-form-item label="带宽限制">
              <a-input-group compact>
                <a-input-number
                  v-model:value="advanced.bandwidthLimitValue"
                  :min="1"
                  placeholder="不限制"
                  style="width: 65%"
                />
                <a-select v-model:value="advanced.bandwidthLimitUnit" style="width: 35%">
                  <a-select-option value="KB">KB/s</a-select-option>
                  <a-select-option value="MB">MB/s</a-select-option>
                </a-select>
              </a-input-group>
            </a-form-item>

            <!-- HTTP / HTTPS 专属 -->
            <template v-if="['http', 'https'].includes(form.type)">
              <a-form-item label="子域名">
                <a-input
                  v-model:value="advanced.subdomain"
                  placeholder="留空则不使用子域名"
                />
              </a-form-item>

              <a-form-item label="访问路径">
                <div
                  v-for="(_, i) in advanced.locations"
                  :key="i"
                  class="dynamic-row"
                >
                  <a-input
                    v-model:value="advanced.locations[i]"
                    placeholder="如: /"
                    style="flex: 1"
                  />
                  <a-button type="text" danger size="small" @click="removeLocation(i)">✕</a-button>
                </div>
                <a-button size="small" style="margin-top: 6px" @click="addLocation">
                  + 添加路径
                </a-button>
              </a-form-item>

              <a-row :gutter="16">
                <a-col :span="12">
                  <a-form-item label="HTTP 认证用户名">
                    <a-input
                      v-model:value="advanced.httpUser"
                      placeholder="留空则无需认证"
                    />
                  </a-form-item>
                </a-col>
                <a-col :span="12">
                  <a-form-item label="HTTP 认证密码">
                    <a-input-password
                      v-model:value="advanced.httpPassword"
                      placeholder="留空则无需认证"
                    />
                  </a-form-item>
                </a-col>
              </a-row>

              <a-form-item label="Host 头改写">
                <a-input
                  v-model:value="advanced.hostHeaderRewrite"
                  placeholder="留空则不改写，如: 127.0.0.1"
                />
              </a-form-item>
            </template>

            <!-- STCP / SUDP 专属 -->
            <template v-if="['stcp', 'sudp'].includes(form.type)">
              <a-form-item label="访问密钥">
                <a-input
                  v-model:value="advanced.secretKey"
                  placeholder="访问端须使用相同密钥"
                />
              </a-form-item>

              <a-form-item label="允许访问的用户">
                <div
                  v-for="(_, i) in advanced.allowUsers"
                  :key="i"
                  class="dynamic-row"
                >
                  <a-input
                    v-model:value="advanced.allowUsers[i]"
                    placeholder="用户名，* 表示所有人"
                    style="flex: 1"
                  />
                  <a-button type="text" danger size="small" @click="removeAllowUser(i)">✕</a-button>
                </div>
                <a-button size="small" style="margin-top: 6px" @click="addAllowUser">
                  + 添加用户
                </a-button>
              </a-form-item>
            </template>

          </a-collapse-panel>
        </a-collapse>
      </a-form>
    </div>

    <!-- Step 2: Preview -->
    <div v-if="currentStep === 2" class="step-content">
      <div class="preview-title">配置预览</div>
      <pre class="code-block">{{ configPreview }}</pre>
    </div>

    <!-- Footer -->
    <div class="wizard-footer">
      <a-button v-if="currentStep > 0" @click="currentStep--">上一步</a-button>
      <div style="flex: 1"></div>
      <a-button @click="$emit('update:open', false)">取消</a-button>
      <a-button
        v-if="currentStep < 2"
        type="primary"
        @click="nextStep"
        :disabled="currentStep === 0 && !selectedType"
      >
        下一步
      </a-button>
      <a-button v-else type="primary" @click="handleCreate" :loading="creating">
        创建隧道
      </a-button>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { FormInstance } from 'ant-design-vue'
import { useNodeStore } from '../../stores/node'
import { useTunnelStore, type Tunnel } from '../../stores/tunnel'
import { message } from 'ant-design-vue'

const emit = defineEmits<{ 'update:open': [value: boolean]; created: [tunnel: Tunnel] }>()
defineProps<{ open: boolean }>()

const nodeStore = useNodeStore()
const tunnelStore = useTunnelStore()

const nodes = computed(() => nodeStore.nodes)
const formRef = ref<FormInstance>()
const currentStep = ref(0)
const selectedType = ref('')
const creating = ref(false)

// ── 基本表单 ──────────────────────────────────────────────────────────────────

const defaultForm = () => ({
  node_id: null as number | null,
  name: '',
  type: 'tcp',
  local_ip: '127.0.0.1',
  local_port: 22,
  remote_port: null as number | null,
  custom_domain: ''
})

const form = ref(defaultForm())

// ── 高级配置 ──────────────────────────────────────────────────────────────────

const defaultAdvanced = () => ({
  useEncryption: false,
  useCompression: false,
  bandwidthLimitValue: null as number | null,
  bandwidthLimitUnit: 'MB' as 'KB' | 'MB',
  // HTTP / HTTPS
  subdomain: '',
  locations: [] as string[],
  httpUser: '',
  httpPassword: '',
  hostHeaderRewrite: '',
  // STCP / SUDP
  secretKey: '',
  allowUsers: [] as string[]
})

const advanced = ref(defaultAdvanced())

function addLocation() { advanced.value.locations.push('/') }
function removeLocation(i: number) { advanced.value.locations.splice(i, 1) }
function addAllowUser() { advanced.value.allowUsers.push('') }
function removeAllowUser(i: number) { advanced.value.allowUsers.splice(i, 1) }

/** 将高级配置序列化为 extra_attrs Record */
function buildExtraAttrs(): Record<string, string> {
  const attrs: Record<string, string> = {}
  const adv = advanced.value
  const type = form.value.type

  if (adv.useEncryption) attrs.useEncryption = 'true'
  if (adv.useCompression) attrs.useCompression = 'true'
  if (adv.bandwidthLimitValue) {
    attrs.bandwidthLimit = `${adv.bandwidthLimitValue}${adv.bandwidthLimitUnit}`
  }

  if (['http', 'https'].includes(type)) {
    if (adv.subdomain.trim()) attrs.subdomain = adv.subdomain.trim()
    const locs = adv.locations.filter((l) => l.trim())
    if (locs.length) attrs.locations = JSON.stringify(locs)
    if (adv.httpUser.trim()) attrs.httpUser = adv.httpUser.trim()
    if (adv.httpPassword) attrs.httpPassword = adv.httpPassword
    if (adv.hostHeaderRewrite.trim()) attrs.hostHeaderRewrite = adv.hostHeaderRewrite.trim()
  }

  if (['stcp', 'sudp'].includes(type)) {
    if (adv.secretKey.trim()) attrs.secretKey = adv.secretKey.trim()
    const users = adv.allowUsers.filter((u) => u.trim())
    if (users.length) attrs.allowUsers = JSON.stringify(users)
  }

  return attrs
}

// ── 验证规则 ──────────────────────────────────────────────────────────────────

const rules = {
  node_id: [{ required: true, message: '请选择节点' }],
  name: [{ required: true, message: '请输入隧道名称' }],
  local_port: [{ required: true, message: '请输入本地端口' }]
}

// ── 类型模板 & 预设 ───────────────────────────────────────────────────────────

const templates = [
  { type: 'tcp',  name: 'TCP',  icon: '⇌', desc: 'TCP 端口转发' },
  { type: 'udp',  name: 'UDP',  icon: '⇋', desc: 'UDP 端口转发' },
  { type: 'http', name: 'HTTP', icon: '⬡', desc: 'HTTP 反向代理' },
  { type: 'https',name: 'HTTPS',icon: '⬢', desc: 'HTTPS 反向代理' },
  { type: 'stcp', name: 'STCP', icon: '⇄', desc: '加密 TCP 穿透' },
  { type: 'sudp', name: 'SUDP', icon: '⇆', desc: '加密 UDP 穿透' }
]

const presets = [
  { name: 'SSH',       type: 'tcp',  local_port: 22,   remote_port: 6022 },
  { name: 'RDP 远程桌面', type: 'tcp', local_port: 3389, remote_port: 63389 },
  { name: 'Web HTTP',  type: 'http', local_port: 80 },
  { name: 'MySQL',     type: 'tcp',  local_port: 3306, remote_port: 63306 },
  { name: 'PostgreSQL',type: 'tcp',  local_port: 5432, remote_port: 65432 },
  { name: 'STCP SSH',  type: 'stcp', local_port: 22 }
]

function selectTemplate(tpl: (typeof templates)[0]) {
  selectedType.value = tpl.type
  form.value.type = tpl.type
}

function applyPreset(preset: (typeof presets)[0]) {
  selectedType.value = preset.type
  form.value = {
    ...form.value,
    type: preset.type,
    name: preset.name.toLowerCase().replace(/[\s/]+/g, '-'),
    local_port: preset.local_port,
    remote_port: ('remote_port' in preset ? preset.remote_port : null) as number | null
  }
  currentStep.value = 1
}

// ── 步骤控制 ──────────────────────────────────────────────────────────────────

async function nextStep() {
  if (currentStep.value === 1) {
    await formRef.value?.validate()
  }
  currentStep.value++
}

// ── 配置预览 ──────────────────────────────────────────────────────────────────

const configPreview = computed(() => {
  const f = form.value
  const ea = buildExtraAttrs()

  let cfg = `[[proxies]]\n`
  cfg += `name = "${f.name}"\n`
  cfg += `type = "${f.type}"\n`

  if (['tcp', 'udp', 'stcp', 'sudp'].includes(f.type)) {
    cfg += `localIP = "${f.local_ip}"\n`
    cfg += `localPort = ${f.local_port}\n`
    if (f.remote_port && ['tcp', 'udp'].includes(f.type)) {
      cfg += `remotePort = ${f.remote_port}\n`
    }
  } else if (['http', 'https'].includes(f.type)) {
    cfg += `localIP = "${f.local_ip}"\n`
    cfg += `localPort = ${f.local_port}\n`
    if (f.custom_domain) cfg += `customDomains = ["${f.custom_domain}"]\n`
  }

  // HTTP / HTTPS 扩展字段
  if (['http', 'https'].includes(f.type)) {
    if (ea.subdomain) cfg += `subdomain = "${ea.subdomain}"\n`
    if (ea.locations) {
      try {
        const locs = JSON.parse(ea.locations) as string[]
        if (locs.length) cfg += `locations = [${locs.map((l) => `"${l}"`).join(', ')}]\n`
      } catch { /* ignore */ }
    }
    if (ea.httpUser) cfg += `httpUser = "${ea.httpUser}"\n`
    if (ea.httpPassword) cfg += `httpPassword = "***"\n`
    if (ea.hostHeaderRewrite) cfg += `hostHeaderRewrite = "${ea.hostHeaderRewrite}"\n`
  }

  // STCP / SUDP 扩展字段
  if (['stcp', 'sudp'].includes(f.type)) {
    if (ea.secretKey) cfg += `secretKey = "***"\n`
    if (ea.allowUsers) {
      try {
        const users = JSON.parse(ea.allowUsers) as string[]
        if (users.length) cfg += `allowUsers = [${users.map((u) => `"${u}"`).join(', ')}]\n`
      } catch { /* ignore */ }
    }
  }

  // [proxies.transport] 子块
  const transportLines: string[] = []
  if (ea.useEncryption === 'true') transportLines.push(`  useEncryption = true`)
  if (ea.useCompression === 'true') transportLines.push(`  useCompression = true`)
  if (ea.bandwidthLimit) transportLines.push(`  bandwidthLimit = "${ea.bandwidthLimit}"`)
  if (transportLines.length) {
    cfg += `[proxies.transport]\n`
    cfg += transportLines.join('\n') + '\n'
  }

  return cfg
})

// ── 创建 ──────────────────────────────────────────────────────────────────────

async function handleCreate() {
  creating.value = true
  try {
    const tunnel = await tunnelStore.addTunnel({
      node_id: form.value.node_id!,
      name: form.value.name,
      type: form.value.type,
      local_ip: form.value.local_ip,
      local_port: form.value.local_port,
      remote_port: form.value.remote_port,
      custom_domain: form.value.custom_domain || null,
      enabled: 1,
      group_name: '默认分组',
      extra_attrs: JSON.stringify(buildExtraAttrs())
    })
    message.success('隧道创建成功')
    emit('created', tunnel)
    emit('update:open', false)
    // 重置向导状态
    currentStep.value = 0
    selectedType.value = ''
    form.value = defaultForm()
    advanced.value = defaultAdvanced()
  } finally {
    creating.value = false
  }
}
</script>

<style scoped>
.step-content {
  min-height: 240px;
}

.type-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.type-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 14px 8px;
  text-align: center;
  cursor: pointer;
  transition: all 0.15s;
}

.type-card:hover {
  border-color: var(--color-primary);
  background: rgba(22, 104, 220, 0.05);
}

.type-card.selected {
  border-color: var(--color-primary);
  background: rgba(22, 104, 220, 0.1);
}

.type-icon {
  font-size: 22px;
  margin-bottom: 5px;
}

.type-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.type-desc {
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-top: 2px;
}

.preset-label {
  font-size: 12px;
  color: var(--color-text-tertiary);
  margin-bottom: 8px;
}

.preset-grid {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.preset-tag {
  cursor: pointer;
  border-color: var(--color-border);
}

.preset-tag:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.advanced-collapse {
  margin-top: 4px;
  border-top: 1px solid var(--color-border);
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
}

.switch-label {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.dynamic-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.preview-title {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 12px;
}

.code-block {
  background: #0d0d0d;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 16px;
  font-size: 13px;
  font-family: 'Cascadia Code', 'Consolas', monospace;
  color: #a8ff78;
  white-space: pre-wrap;
  max-height: 320px;
  overflow-y: auto;
}

.wizard-footer {
  display: flex;
  gap: 8px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}
</style>
