<template>
  <div class="ai-agent-panel">
    <div class="hint">
      空画布可「生成表单」；已有表单可多轮「优化当前表」。确认后将整表覆盖写入画布。
    </div>

    <div class="mode-row">
      <el-radio-group v-model="mode" size="small" :disabled="loading">
        <el-radio-button label="auto">自动</el-radio-button>
        <el-radio-button label="generate">整表生成</el-radio-button>
        <el-radio-button label="refine">优化当前表</el-radio-button>
      </el-radio-group>
      <span class="mode-hint">{{ resolvedModeLabel }}</span>
    </div>

    <div class="messages" v-if="messages.length">
      <div
        v-for="(m, i) in messages"
        :key="i"
        class="msg"
        :class="m.role"
      >
        <div class="role">{{ m.role === 'user' ? '我' : 'Agent' }}</div>
        <div class="content">{{ m.content }}</div>
      </div>
    </div>

    <el-input
      v-model="prompt"
      type="textarea"
      :rows="3"
      maxlength="2000"
      show-word-limit
      :placeholder="inputPlaceholder"
      :disabled="loading"
    />

    <div class="upload-row" v-if="effectiveMode === 'generate'">
      <input
        ref="fileInputRef"
        type="file"
        accept=".xlsx,.xls"
        class="file-input"
        @change="onFileChange"
      />
      <el-button size="small" @click="pickFile" :disabled="loading">选择 Excel</el-button>
      <span class="file-name">{{ file ? file.name : '未选择文件' }}</span>
      <el-button
        v-if="file"
        size="small"
        text
        type="danger"
        @click="clearFile"
        :disabled="loading"
      >清除</el-button>
    </div>

    <div class="actions">
      <el-button type="primary" :loading="loading" @click="onSubmit">
        {{ effectiveMode === 'refine' ? '优化当前表' : '生成表单' }}
      </el-button>
      <el-button
        type="success"
        :disabled="!lastResult || loading"
        @click="onApply"
      >应用到设计器（整表覆盖）</el-button>
      <el-button size="small" text :disabled="loading || (!messages.length && !lastResult)" @click="onReset">
        清空会话
      </el-button>
    </div>

    <el-alert
      v-if="error"
      class="mt"
      type="error"
      :title="error"
      show-icon
      :closable="false"
    />

    <el-alert
      v-if="lastResult"
      class="mt"
      type="success"
      :title="lastResult.summary"
      show-icon
      :closable="false"
    />

    <div v-if="lastResult?.warnings?.length" class="warnings mt">
      <div class="warnings-title">警告</div>
      <ul>
        <li v-for="(w, i) in lastResult.warnings" :key="i">{{ w }}</li>
      </ul>
    </div>

    <div v-if="previewCount > 0" class="preview mt">
      预览：共 {{ previewCount }} 个控件（确认后才会整表覆盖写入画布）
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  generateFormByAgent,
  refineFormByAgent,
  type AgentGenerateResponse,
} from '@/api/chat'

const props = defineProps<{
  getCurrentFormJson?: () => { widgetList: any[]; formConfig: Record<string, any> } | null
}>()

const emit = defineEmits<{
  (e: 'apply', formJson: AgentGenerateResponse['formJson']): void
  (e: 'AiError'): void
}>()

type ChatTurn = { role: 'user' | 'assistant'; content: string }

const mode = ref<'auto' | 'generate' | 'refine'>('auto')
const prompt = ref('')
const file = ref<File | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const loading = ref(false)
const error = ref('')
const lastResult = ref<AgentGenerateResponse | null>(null)
const messages = ref<ChatTurn[]>([])

const previewCount = computed(() => lastResult.value?.formJson?.widgetList?.length || 0)

const canvasWidgetCount = computed(() => {
  const json = props.getCurrentFormJson?.()
  return Array.isArray(json?.widgetList) ? json!.widgetList.length : 0
})

const effectiveMode = computed<'generate' | 'refine'>(() => {
  if (mode.value === 'generate') return 'generate'
  if (mode.value === 'refine') return 'refine'
  return canvasWidgetCount.value > 0 ? 'refine' : 'generate'
})

const resolvedModeLabel = computed(() =>
  effectiveMode.value === 'refine' ? '当前：优化已有表' : '当前：整表生成',
)

const inputPlaceholder = computed(() =>
  effectiveMode.value === 'refine'
    ? '例如：加两个 tab（基本信息/评估题目）；或把单选题选项改成 0/2/4 分；或增加总分公式'
    : '例如：生成老年人认知评估表，包含时间定向、人物定向等评分题',
)

function pickFile() {
  fileInputRef.value?.click()
}

function onFileChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  file.value = input.files?.[0] || null
}

function clearFile() {
  file.value = null
  if (fileInputRef.value) fileInputRef.value.value = ''
}

function onReset() {
  messages.value = []
  lastResult.value = null
  error.value = ''
  prompt.value = ''
  clearFile()
}

async function onSubmit() {
  error.value = ''
  const text = prompt.value.trim()
  if (effectiveMode.value === 'generate') {
    if (!file.value && !text) {
      error.value = '请输入需求描述，或上传 Excel'
      return
    }
    await runGenerate(text)
    return
  }
  if (!text) {
    error.value = '请输入优化指令'
    return
  }
  await runRefine(text)
}

async function runGenerate(text: string) {
  loading.value = true
  try {
    const data = await generateFormByAgent({
      mode: file.value ? 'excel' : 'text',
      prompt: text,
      file: file.value,
    })
    if (!data?.formJson?.widgetList) {
      throw new Error('返回结果缺少 formJson')
    }
    lastResult.value = data
    if (text) {
      messages.value.push({ role: 'user', content: text })
      messages.value.push({ role: 'assistant', content: data.summary })
    }
    ElMessage.success('生成成功，请确认后应用到设计器')
  } catch (e: any) {
    error.value = e?.message || '生成失败'
    emit('AiError')
  } finally {
    loading.value = false
  }
}

async function runRefine(text: string) {
  const current = props.getCurrentFormJson?.()
  if (!current?.widgetList?.length) {
    error.value = '当前画布无表单，请先生成/拖拽控件，或切换到「整表生成」'
    return
  }
  loading.value = true
  try {
    const history = messages.value.slice(-20)
    const data = await refineFormByAgent({
      instruction: text,
      currentFormJson: current,
      messages: history,
    })
    if (!data?.formJson?.widgetList) {
      throw new Error('返回结果缺少 formJson')
    }
    lastResult.value = data
    messages.value.push({ role: 'user', content: text })
    messages.value.push({ role: 'assistant', content: data.summary })
    prompt.value = ''
    const hasWarnings = Array.isArray(data.warnings) && data.warnings.length > 0
    const applied = data.applied !== false && !String(data.summary || '').startsWith('未写入画布变更')
    if (!applied) {
      ElMessage.warning(data.summary || '优化未产生可应用变更')
    } else if (hasWarnings) {
      ElMessage.warning('部分调整已写入，请查看说明与警告后再确认应用')
    } else {
      ElMessage.success('优化成功，请确认后整表覆盖应用到设计器')
    }
  } catch (e: any) {
    error.value = e?.message || '优化失败'
    emit('AiError')
  } finally {
    loading.value = false
  }
}

function onApply() {
  if (!lastResult.value?.formJson) return
  emit('apply', lastResult.value.formJson)
}
</script>

<style scoped lang="scss">
.ai-agent-panel {
  padding: 8px 4px 16px;
  .hint {
    color: #666;
    font-size: 12px;
    line-height: 1.5;
    margin-bottom: 10px;
  }
  .mode-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  .mode-hint {
    font-size: 12px;
    color: #909399;
  }
  .messages {
    max-height: 180px;
    overflow: auto;
    border: 1px solid #ebeef5;
    border-radius: 6px;
    padding: 8px;
    margin-bottom: 10px;
    background: #fafafa;
  }
  .msg {
    margin-bottom: 8px;
    font-size: 12px;
    line-height: 1.45;
    .role {
      font-weight: 600;
      color: #606266;
      margin-bottom: 2px;
    }
    &.user .role { color: #409eff; }
    &.assistant .role { color: #67c23a; }
    .content { color: #303133; white-space: pre-wrap; }
  }
  .upload-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
  }
  .file-input {
    display: none;
  }
  .file-name {
    font-size: 12px;
    color: #888;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    flex-wrap: wrap;
  }
  .mt {
    margin-top: 12px;
  }
  .warnings {
    background: #fff7e6;
    border: 1px solid #ffd591;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 12px;
    color: #ad6800;
    .warnings-title {
      font-weight: 600;
      margin-bottom: 4px;
    }
    ul {
      margin: 0;
      padding-left: 18px;
    }
  }
  .preview {
    font-size: 12px;
    color: #409eff;
  }
}
</style>
