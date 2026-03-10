<template>
  <a-modal
    :open="open"
    title="编辑隧道"
    :footer="null"
    width="640px"
    @cancel="$emit('update:open', false)"
  >
    <a-form ref="formRef" :model="form" :rules="rules" layout="vertical" style="margin-top: 4px">
      <a-row :gutter="16">
        <a-col :span="12">
          <a-form-item label="所属节点" name="node_id">
            <a-select v-model:value="form.node_id" placeholder="选择节点">
              <a-select-option v-for="n in nodes" :key="n.id" :value="n.id">
                {{ n.name }} ({{ n.host }})
              </a-select-option>
            </a-select>
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="分组" name="group_name">
            <a-auto-complete
              v-model:value="form.group_name"
              :options="groupOptions"
              placeholder="默认分组"
            />
          </a-form-item>
        </a-col>
      </a-row>

      <a-row :gutter="16">
        <a-col :span="12">
          <a-form-item label="隧道名称" name="name">
            <a-input v-model:value="form.name" placeholder="唯一标识，如: my-ssh" />
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="协议类型" name="type">
            <a-select v-model:value="form.type">
              <a-select-option value="tcp">TCP</a-select-option>
              <a-select-option value="udp">UDP</a-select-option>
              <a-select-option value="http">HTTP</a-select-option>
              <a-select-option value="https">HTTPS</a-select-option>
              <a-select-option value="stcp">STCP</a-select-option>
              <a-select-option value="sudp">SUDP</a-select-option>
            </a-select>
          </a-form-item>
        </a-col>
      </a-row>

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

      <!-- 高级配置 -->
      <a-collapse ghost class="advanced-collapse">
        <a-collapse-panel key="adv" header="高级配置">

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
              <a-input v-model:value="advanced.subdomain" placeholder="留空则不使用子域名" />
            </a-form-item>

            <a-form-item label="访问路径">
              <div v-for="(_, i) in advanced.locations" :key="i" class="dynamic-row">
                <a-input
                  v-model:value="advanced.locations[i]"
                  placeholder="如: /"
                  style="flex: 1"
                />
                <a-button type="text" danger size="small" @click="advanced.locations.splice(i, 1)">✕</a-button>
              </div>
              <a-button size="small" style="margin-top: 6px" @click="advanced.locations.push('/')">
                + 添加路径
              </a-button>
            </a-form-item>

            <a-row :gutter="16">
              <a-col :span="12">
                <a-form-item label="HTTP 认证用户名">
                  <a-input v-model:value="advanced.httpUser" placeholder="留空则无需认证" />
                </a-form-item>
              </a-col>
              <a-col :span="12">
                <a-form-item label="HTTP 认证密码">
                  <a-input-password v-model:value="advanced.httpPassword" placeholder="留空则无需认证" />
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
              <a-input v-model:value="advanced.secretKey" placeholder="访问端须使用相同密钥" />
            </a-form-item>

            <a-form-item label="允许访问的用户">
              <div v-for="(_, i) in advanced.allowUsers" :key="i" class="dynamic-row">
                <a-input
                  v-model:value="advanced.allowUsers[i]"
                  placeholder="用户名，* 表示所有人"
                  style="flex: 1"
                />
                <a-button type="text" danger size="small" @click="advanced.allowUsers.splice(i, 1)">✕</a-button>
              </div>
              <a-button size="small" style="margin-top: 6px" @click="advanced.allowUsers.push('')">
                + 添加用户
              </a-button>
            </a-form-item>
          </template>

        </a-collapse-panel>
      </a-collapse>
    </a-form>

    <div class="modal-footer">
      <a-button @click="$emit('update:open', false)">取消</a-button>
      <a-button type="primary" :loading="saving" @click="handleSave">保存</a-button>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { FormInstance } from 'ant-design-vue'
import { message } from 'ant-design-vue'
import { useNodeStore } from '../../stores/node'
import { useTunnelStore, type Tunnel } from '../../stores/tunnel'

const props = defineProps<{ open: boolean; tunnel: Tunnel | null }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; updated: [tunnel: Tunnel] }>()

const nodeStore = useNodeStore()
const tunnelStore = useTunnelStore()

const nodes = computed(() => nodeStore.nodes)
const groupOptions = computed(() =>
  tunnelStore.groups.map((g) => ({ value: g }))
)

const formRef = ref<FormInstance>()
const saving = ref(false)

const form = ref({
  node_id: null as number | null,
  name: '',
  type: 'tcp',
  local_ip: '127.0.0.1',
  local_port: 22,
  remote_port: null as number | null,
  custom_domain: '',
  group_name: '默认分组'
})

const advanced = ref({
  useEncryption: false,
  useCompression: false,
  bandwidthLimitValue: null as number | null,
  bandwidthLimitUnit: 'MB' as 'KB' | 'MB',
  subdomain: '',
  locations: [] as string[],
  httpUser: '',
  httpPassword: '',
  hostHeaderRewrite: '',
  secretKey: '',
  allowUsers: [] as string[]
})

const rules = {
  node_id: [{ required: true, message: '请选择节点' }],
  name: [{ required: true, message: '请输入隧道名称' }],
  local_port: [{ required: true, message: '请输入本地端口' }]
}

// When tunnel prop changes, populate the form
watch(
  () => props.tunnel,
  (t) => {
    if (!t) return
    form.value = {
      node_id: t.node_id,
      name: t.name,
      type: t.type,
      local_ip: t.local_ip,
      local_port: t.local_port,
      remote_port: t.remote_port,
      custom_domain: t.custom_domain ?? '',
      group_name: t.group_name || '默认分组'
    }

    // Parse extra_attrs back to advanced fields
    let ea: Record<string, string> = {}
    try { ea = JSON.parse(t.extra_attrs || '{}') } catch { /* ignore */ }

    advanced.value = {
      useEncryption: ea.useEncryption === 'true',
      useCompression: ea.useCompression === 'true',
      bandwidthLimitValue: ea.bandwidthLimit ? parseInt(ea.bandwidthLimit) : null,
      bandwidthLimitUnit: (ea.bandwidthLimit?.replace(/\d+/, '') as 'KB' | 'MB') || 'MB',
      subdomain: ea.subdomain ?? '',
      locations: ea.locations ? (() => { try { return JSON.parse(ea.locations) } catch { return [] } })() : [],
      httpUser: ea.httpUser ?? '',
      httpPassword: ea.httpPassword ?? '',
      hostHeaderRewrite: ea.hostHeaderRewrite ?? '',
      secretKey: ea.secretKey ?? '',
      allowUsers: ea.allowUsers ? (() => { try { return JSON.parse(ea.allowUsers) } catch { return [] } })() : []
    }
  },
  { immediate: true }
)

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

async function handleSave() {
  if (!props.tunnel) return
  await formRef.value?.validate()
  saving.value = true
  try {
    const updated = await tunnelStore.updateTunnel(props.tunnel.id, {
      node_id: form.value.node_id!,
      name: form.value.name,
      type: form.value.type,
      local_ip: form.value.local_ip,
      local_port: form.value.local_port,
      remote_port: form.value.remote_port,
      custom_domain: form.value.custom_domain || null,
      group_name: form.value.group_name || '默认分组',
      extra_attrs: JSON.stringify(buildExtraAttrs())
    })
    message.success('隧道已更新')
    emit('updated', updated)
    emit('update:open', false)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
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

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}
</style>
