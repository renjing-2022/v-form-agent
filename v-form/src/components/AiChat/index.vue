<template>
  <div class="ai-agent-panel">
    <div class="hint">
      空画布可「生成表单」；已有表单可多轮「优化当前表」。交互经 /event：澄清 → 生成代码 → 预览验证 → 确认写入。
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
        :disabled="!canApply"
        @click="onApply"
      >应用到设计器（整表覆盖）</el-button>
      <el-button size="small" text :disabled="loading || (!messages.length && !lastResult && !lastEvent)" @click="onReset">
        清空会话
      </el-button>
    </div>

    <div class="actions event-actions" v-if="lastEvent">
      <el-button
        size="small"
        type="primary"
        :disabled="loading || lastEvent.status !== 'spec_ready'"
        @click="onGenerateEventCode"
      >生成交互代码</el-button>
      <el-button
        size="small"
        :disabled="loading || lastEvent.status !== 'code_preview' || !lastEvent.formJsonCandidate"
        @click="onVerifyInPreview"
      >在预览中验证</el-button>
      <el-button
        size="small"
        type="success"
        :disabled="!canApplyEvent"
        @click="onApplyEvent"
      >确认写入画布</el-button>
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
      v-if="lastEvent"
      class="mt"
      :type="eventAlertType"
      :title="lastEvent.summary"
      show-icon
      :closable="false"
    />

    <div v-if="lastEvent?.code" class="code-preview mt">
      <div class="warnings-title">候选事件代码</div>
      <pre>{{ lastEvent.code }}</pre>
    </div>

    <div v-if="lastEvent?.questions?.length" class="warnings mt">
      <div class="warnings-title">澄清问题</div>
      <ul>
        <li v-for="(q, i) in lastEvent.questions" :key="i">{{ q }}</li>
      </ul>
    </div>

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
import { computed, createVNode, getCurrentInstance, nextTick, ref, render as renderVNode } from 'vue'
import { ElMessage } from 'element-plus'
import {
  generateFormByAgent,
  refineFormByAgent,
  eventFormByAgent,
  type AgentGenerateResponse,
  type AgentEventResponse,
} from '@/api/chat'
import { runEventExamplesOnPreview } from '@/utils/eventPreviewRunner'

const props = defineProps<{
  getCurrentFormJson?: () => { widgetList: any[]; formConfig: Record<string, any> } | null
}>()

const emit = defineEmits<{
  (e: 'apply', formJson: AgentGenerateResponse['formJson']): void
  (e: 'AiError'): void
}>()

const appContext = getCurrentInstance()?.appContext ?? null

type ChatTurn = { role: 'user' | 'assistant'; content: string }

const mode = ref<'auto' | 'generate' | 'refine'>('auto')
const prompt = ref('')
const file = ref<File | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const loading = ref(false)
const error = ref('')
const lastResult = ref<AgentGenerateResponse | null>(null)
const lastEvent = ref<AgentEventResponse | null>(null)
const lastEventInstruction = ref('')
const eventVerifiedPass = ref(false)
const messages = ref<ChatTurn[]>([])

const previewCount = computed(() => lastResult.value?.formJson?.widgetList?.length || 0)
const canApply = computed(
  () => Boolean(lastResult.value?.formJson) && !lastEvent.value && !loading.value,
)
const canApplyEvent = computed(
  () =>
    Boolean(lastEvent.value?.status === 'code_preview' || lastEvent.value?.status === 'applied') &&
    eventVerifiedPass.value &&
    !loading.value,
)

const eventAlertType = computed(() => {
  const s = lastEvent.value?.status
  if (s === 'applied' || s === 'code_preview') return 'success'
  if (s === 'spec_ready') return 'info'
  return 'warning'
})

function looksLikeEventIntent(text: string): boolean {
  return /联动|交互|事件|onChange|onClick|onMounted|onCreated|onForm|子表|增行|挂载|打开表单时|提交前|校验规则|计分|加权|显示|隐藏|禁用|启用/.test(
    text,
  )
}

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
    ? '例如：加两个 tab（基本信息/评估题目）；或把单选题选项改成 0/2/4 分；或增加总分公式；或描述字段联动'
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
  lastEvent.value = null
  lastEventInstruction.value = ''
  eventVerifiedPass.value = false
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
  if (looksLikeEventIntent(text)) {
    await runEvent(text)
    return
  }
  await runRefine(text)
}

async function runEvent(text: string) {
  const current = props.getCurrentFormJson?.()
  if (!current?.widgetList?.length) {
    error.value = '当前画布无表单，请先生成/拖拽控件，或切换到「整表生成」'
    return
  }
  loading.value = true
  lastEvent.value = null
  eventVerifiedPass.value = false
  try {
    const history = messages.value.slice(-20)
    const data = await eventFormByAgent({
      instruction: text,
      currentFormJson: current,
      messages: history,
      action: 'clarify',
    })
    lastEvent.value = data
    lastEventInstruction.value = text
    lastResult.value = null
    messages.value.push({ role: 'user', content: text })
    const q = Array.isArray(data.questions) && data.questions.length
      ? `\n追问：\n- ${data.questions.join('\n- ')}`
      : ''
    const specHint =
      data.status === 'spec_ready'
        ? '\n（EventSpec 已就绪：请点「生成交互代码」→「在预览中验证」→「确认写入画布」）'
        : ''
    messages.value.push({
      role: 'assistant',
      content: `${data.summary}${q}${specHint}`,
    })
    prompt.value = ''
    if (data.status === 'need_clarification') {
      ElMessage.info('请根据追问继续补充交互细节')
    } else {
      ElMessage.success('交互意图已澄清')
    }
  } catch (e: any) {
    error.value = e?.message || '交互澄清失败'
    emit('AiError')
  } finally {
    loading.value = false
  }
}

async function onGenerateEventCode() {
  if (!lastEvent.value?.eventSpec) return
  const current = props.getCurrentFormJson?.()
  if (!current) return
  loading.value = true
  eventVerifiedPass.value = false
  try {
    const data = await eventFormByAgent({
      instruction: lastEventInstruction.value || 'generate',
      currentFormJson: current,
      action: 'generate',
      eventSpec: lastEvent.value.eventSpec,
    })
    lastEvent.value = data
    if (data.status === 'code_preview') {
      ElMessage.success('已生成候选代码，请在预览中验证')
    } else {
      ElMessage.warning(data.summary || '生成未通过')
    }
  } catch (e: any) {
    error.value = e?.message || '生成交互代码失败'
    emit('AiError')
  } finally {
    loading.value = false
  }
}

async function onVerifyInPreview() {
  if (!lastEvent.value?.formJsonCandidate || !lastEvent.value.eventSpec) return
  loading.value = true
  let host: HTMLDivElement | null = null
  try {
    // 动态挂载，避免 AiChat ↔ VFormRender 静态循环依赖导致设计器白屏
    const VFormRender = (await import('@/components/form-render/index')).default
    host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;height:600px;opacity:0;pointer-events:none;'
    document.body.appendChild(host)

    // 必须复用设计器 appContext：控件与 Element Plus 组件都是全局注册的
    const vnode = createVNode(VFormRender, {
      formJson: JSON.parse(JSON.stringify(lastEvent.value.formJsonCandidate)),
      previewState: true,
    })
    vnode.appContext = appContext
    renderVNode(vnode, host)
    await nextTick()
    const formRef: any = vnode.component?.proxy
    await new Promise((r) => setTimeout(r, 350))
    if (!formRef) {
      throw new Error('预览 VFormRender 未就绪')
    }

    const spec = lastEvent.value.eventSpec as any
    const examples = Array.isArray(spec.examples) ? spec.examples : []
    const eventKey = String(spec.trigger?.eventKey || spec.sink?.eventKey || 'onChange')
    const report = await runEventExamplesOnPreview({
      formRef,
      formJson: lastEvent.value.formJsonCandidate,
      examples,
      eventKey,
      triggerName: spec.trigger?.widgetRef?.name || spec.trigger?.widgetRef?.id,
      runner: 'designer-preview',
    })
    lastEvent.value = {
      ...lastEvent.value,
      executionReport: report,
      summary: report.pass
        ? `${lastEvent.value.summary}（预览验证通过）`
        : `${lastEvent.value.summary}（预览验证未通过）`,
    }
    eventVerifiedPass.value = report.pass
    if (report.pass) {
      ElMessage.success('预览验证通过，可确认写入画布')
    } else {
      ElMessage.warning('预览验证未通过，不能写入画布')
    }
  } catch (e: any) {
    eventVerifiedPass.value = false
    error.value = e?.message || '预览验证失败'
    emit('AiError')
  } finally {
    try {
      if (host) renderVNode(null, host)
    } catch {
      /* ignore */
    }
    host?.remove()
    loading.value = false
  }
}

async function onApplyEvent() {
  if (!lastEvent.value?.eventSpec || !eventVerifiedPass.value) return
  const current = props.getCurrentFormJson?.()
  if (!current) return
  loading.value = true
  try {
    const data = await eventFormByAgent({
      instruction: lastEventInstruction.value || 'apply',
      currentFormJson: current,
      action: 'apply',
      eventSpec: lastEvent.value.eventSpec,
      patches: lastEvent.value.patches,
      executionReport: lastEvent.value.executionReport,
      confirmOverwrite: true,
    })
    lastEvent.value = data
    if (data.status === 'applied' && data.applied && data.formJson) {
      emit('apply', data.formJson)
      ElMessage.success('事件已写入画布')
      eventVerifiedPass.value = false
    } else {
      ElMessage.warning(data.summary || '写入被拒绝')
    }
  } catch (e: any) {
    error.value = e?.message || '写入事件失败'
    emit('AiError')
  } finally {
    loading.value = false
  }
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
    lastEvent.value = null
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
  lastEvent.value = null
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
  .event-actions {
    margin-top: 8px;
  }
  .mt {
    margin-top: 12px;
  }
  .warnings, .code-preview {
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
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 120px;
      overflow: auto;
    }
  }
  .preview {
    font-size: 12px;
    color: #409eff;
  }
}
</style>
