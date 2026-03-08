<template>
  <a-modal
    :open="open"
    :title="isEdit ? '编辑节点' : '添加节点'"
    @ok="handleSubmit"
    @cancel="$emit('update:open', false)"
    :confirm-loading="loading"
    ok-text="保存"
    cancel-text="取消"
    width="480px"
  >
    <a-form
      ref="formRef"
      :model="form"
      :rules="rules"
      layout="vertical"
      style="margin-top: 16px"
    >
      <a-form-item label="节点名称" name="name">
        <a-input v-model:value="form.name" placeholder="如: 我的服务器" />
      </a-form-item>
      <a-form-item label="服务器地址" name="host">
        <a-input v-model:value="form.host" placeholder="如: example.com 或 1.2.3.4" />
      </a-form-item>
      <a-form-item label="端口" name="port">
        <a-input-number
          v-model:value="form.port"
          :min="1"
          :max="65535"
          style="width: 100%"
          placeholder="7000"
        />
      </a-form-item>
      <a-form-item label="认证 Token（可选）" name="token">
        <a-input-password v-model:value="form.token" placeholder="frps token（留空表示无认证）" />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { FormInstance } from 'ant-design-vue'
import type { Node } from '../../stores/node'

interface Props {
  open: boolean
  node?: Node | null
}

const props = withDefaults(defineProps<Props>(), { node: null })
const emit = defineEmits<{
  'update:open': [value: boolean]
  submit: [data: Omit<Node, 'id' | 'created_at'>]
}>()

const formRef = ref<FormInstance>()
const loading = ref(false)
const isEdit = ref(false)

const form = ref({
  name: '',
  host: '',
  port: 7000,
  token: ''
})

const rules = {
  name: [{ required: true, message: '请输入节点名称' }],
  host: [{ required: true, message: '请输入服务器地址' }],
  port: [{ required: true, message: '请输入端口号' }]
}

watch(
  () => props.open,
  (val) => {
    if (val) {
      isEdit.value = !!props.node
      if (props.node) {
        form.value = {
          name: props.node.name,
          host: props.node.host,
          port: props.node.port,
          token: props.node.token || ''
        }
      } else {
        form.value = { name: '', host: '', port: 7000, token: '' }
      }
    }
  }
)

async function handleSubmit() {
  await formRef.value?.validate()
  loading.value = true
  try {
    emit('submit', {
      name: form.value.name,
      host: form.value.host,
      port: form.value.port,
      token: form.value.token || null
    })
    emit('update:open', false)
  } finally {
    loading.value = false
  }
}
</script>
