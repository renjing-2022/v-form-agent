<template>
  <div class="ai-agent-panel">
    <div class="hint">
      空画布可「生成表单」；已有表单用自然语言描述结构或交互。交互由模型直接写 JS → 真实预览验证 → 确认后写入画布。
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
        {{ effectiveMode === 'refine' ? '发送' : '生成表单' }}
      </el-button>
      <el-button
        type="success"
        :disabled="!canApply"
        @click="onApply"
      >应用到设计器（整表覆盖）</el-button>
      <el-button size="small" text :disabled="loading || (!messages.length && !lastResult && !lastInteraction)" @click="onReset">
        清空会话
      </el-button>
    </div>

    <div class="actions event-actions" v-if="lastInteraction">
      <el-button
        size="small"
        :disabled="loading || lastInteraction.status !== 'generated' || !lastInteraction.formJsonCandidate"
        @click="onVerifyInteraction"
      >在预览中验证</el-button>
      <el-button
        size="small"
        :disabled="loading || !canRepairInteraction"
        @click="onRepairInteraction"
      >自动修正（{{ repairRound }}/2）</el-button>
      <el-button
        size="small"
        type="success"
        :disabled="!canApplyInteraction"
        @click="onApplyInteraction"
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
      v-if="lastInteraction"
      class="mt"
      :type="interactionAlertType"
      :title="lastInteraction.summary"
      show-icon
      :closable="false"
    />

    <div v-if="handlerCodePreview" class="code-preview mt">
      <div class="warnings-title">候选事件代码</div>
      <pre>{{ handlerCodePreview }}</pre>
    </div>

    <div v-if="lastInteraction?.scenarioNarration?.length" class="warnings mt">
      <div class="warnings-title">验证场景（请确认）</div>
      <ul>
        <li v-for="(line, i) in lastInteraction.scenarioNarration" :key="i">{{ line }}</li>
      </ul>
    </div>

    <div v-if="lastInteraction?.verificationReport?.results?.length" class="warnings mt">
      <div class="warnings-title">预览执行结果</div>
      <ul>
        <li
          v-for="(r, i) in lastInteraction.verificationReport.results"
          :key="i"
        >
          {{ r.scenarioId }}：{{ r.ok ? '通过' : `失败 ${r.error || ''}` }}
        </li>
      </ul>
    </div>

    <div v-if="lastInteraction?.questions?.length" class="warnings mt">
      <div class="warnings-title">澄清问题</div>
      <ul>
        <li v-for="(q, i) in lastInteraction.questions" :key="i">{{ q }}</li>
      </ul>
    </div>

    <div v-if="lastInteraction?.unsupported?.length" class="warnings mt">
      <div class="warnings-title">不支持项</div>
      <ul>
        <li v-for="(u, i) in lastInteraction.unsupported" :key="i">{{ u.text }} — {{ u.reason }}</li>
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
  interactionFormByAgent,
  type AgentGenerateResponse,
  type AgentInteractionResponse,
} from '@/api/chat'
import { runInteractionScenariosOnPreview } from '@/utils/interactionRunner'

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
const lastInteraction = ref<AgentInteractionResponse | null>(null)
const lastInteractionInstruction = ref('')
const interactionVerifiedPass = ref(false)
const repairRound = ref(0)
const messages = ref<ChatTurn[]>([])

const previewCount = computed(() => lastResult.value?.formJson?.widgetList?.length || 0)
const canApply = computed(
  () => Boolean(lastResult.value?.formJson) && !lastInteraction.value && !loading.value,
)
const canApplyInteraction = computed(
  () =>
    Boolean(lastInteraction.value?.status === 'generated' || lastInteraction.value?.status === 'applied') &&
    interactionVerifiedPass.value &&
    !loading.value,
)
const canRepairInteraction = computed(
  () =>
    Boolean(lastInteraction.value?.status === 'generated') &&
    Boolean(lastInteraction.value?.verificationReport) &&
    !interactionVerifiedPass.value &&
    repairRound.value < 2 &&
    !loading.value,
)

const interactionAlertType = computed(() => {
  const s = lastInteraction.value?.status
  if (s === 'applied' || s === 'generated') return 'success'
  if (s === 'need_clarification') return 'warning'
  if (s === 'unsupported' || s === 'failed' || s === 'error') return 'error'
  return 'info'
})

const handlerCodePreview = computed(() => {
  const handlers = lastInteraction.value?.output?.handlers
  if (!handlers?.length) return ''
  return handlers
    .map((h) => `// ${h.target}.${h.eventKey}\n${h.code}`)
    .join('\n\n')
})

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
  effectiveMode.value === 'refine' ? '当前：优化 / 交互（统一入口）' : '当前：整表生成',
)

const inputPlaceholder = computed(() =>
  effectiveMode.value === 'refine'
    ? '例如：把备注改成多行；或每个 tab 加下一页并校验；或数量×单价算金额'
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
  lastInteraction.value = null
  lastInteractionInstruction.value = ''
  interactionVerifiedPass.value = false
  repairRound.value = 0
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
    error.value = '请输入指令'
    return
  }
  // 统一入口：不再用关键词分流，由 /interaction 判定意图
  await runInteraction(text)
}

async function runInteraction(text: string) {
  const current = props.getCurrentFormJson?.()
  if (!current?.widgetList?.length) {
    error.value = '当前画布无表单，请先生成/拖拽控件，或切换到「整表生成」'
    return
  }
  loading.value = true
  lastInteraction.value = null
  interactionVerifiedPass.value = false
  repairRound.value = 0
  try {
    const history = messages.value.slice(-20)
    const data = await interactionFormByAgent({
      action: 'generate',
      instruction: text,
      currentFormJson: current,
      messages: history,
    })

    if (data.status === 'route_refine') {
      messages.value.push({ role: 'user', content: text })
      messages.value.push({ role: 'assistant', content: '判定为纯结构优化，改走 /refine…' })
      prompt.value = ''
      loading.value = false
      await runRefine(text)
      return
    }

    lastInteraction.value = data
    lastInteractionInstruction.value = text
    lastResult.value = null
    messages.value.push({ role: 'user', content: text })
    const q =
      Array.isArray(data.questions) && data.questions.length
        ? `\n追问：\n- ${data.questions.join('\n- ')}`
        : ''
    const nextHint =
      data.status === 'generated'
        ? '\n（请核对场景 →「在预览中验证」→「确认写入画布」）'
        : ''
    messages.value.push({
      role: 'assistant',
      content: `${data.summary || data.status}${q}${nextHint}`,
    })
    prompt.value = ''
    if (data.status === 'need_clarification') {
      ElMessage.info('请根据追问继续补充')
    } else if (data.status === 'unsupported') {
      ElMessage.warning('需求超出纯前端范围，未写入')
    } else if (data.status === 'generated') {
      ElMessage.success('已生成交互方案，请验证后写入')
    } else if (data.status === 'error') {
      ElMessage.error(data.error || data.summary || '交互生成失败')
    }
  } catch (e: any) {
    error.value = e?.message || '交互生成失败'
    emit('AiError')
  } finally {
    loading.value = false
  }
}

async function mountPreviewAndRun() {
  if (!lastInteraction.value?.formJsonCandidate || !lastInteraction.value.output?.scenarios?.length) {
    throw new Error('缺少候选表单或验证场景')
  }
  const VFormRender = (await import('@/components/form-render/index')).default
  const host = document.createElement('div')
  host.style.cssText =
    'position:fixed;left:-9999px;top:0;width:800px;height:600px;opacity:0;pointer-events:none;'
  document.body.appendChild(host)
  try {
    const vnode = createVNode(VFormRender, {
      formJson: JSON.parse(JSON.stringify(lastInteraction.value.formJsonCandidate)),
      previewState: true,
    })
    vnode.appContext = appContext
    renderVNode(vnode, host)
    await nextTick()
    await new Promise((r) => setTimeout(r, 350))
    const formRef: any = vnode.component?.proxy
    if (!formRef) throw new Error('预览 VFormRender 未就绪')

    const report = await runInteractionScenariosOnPreview({
      formRef,
      formJson: lastInteraction.value.formJsonCandidate,
      scenarios: lastInteraction.value.output.scenarios as any,
      handlers: lastInteraction.value.output.handlers,
      runner: 'designer-preview',
    })
    return report
  } finally {
    try {
      renderVNode(null, host)
    } catch {
      /* ignore */
    }
    host.remove()
  }
}

async function onVerifyInteraction() {
  if (!lastInteraction.value?.formJsonCandidate) return
  loading.value = true
  try {
    const report = await mountPreviewAndRun()
    lastInteraction.value = {
      ...lastInteraction.value,
      verificationReport: report,
      summary: report.pass
        ? `${lastInteraction.value.summary}（预览验证通过）`
        : `${lastInteraction.value.summary}（预览验证未通过）`,
    }
    interactionVerifiedPass.value = report.pass
    if (report.pass) {
      ElMessage.success('预览验证通过，可确认写入画布')
    } else {
      ElMessage.warning('预览验证未通过，可点「自动修正」或改描述重试')
    }
  } catch (e: any) {
    interactionVerifiedPass.value = false
    error.value = e?.message || '预览验证失败'
    emit('AiError')
  } finally {
    loading.value = false
  }
}

async function onRepairInteraction() {
  if (!lastInteraction.value?.output || !lastInteraction.value.verificationReport) return
  if (repairRound.value >= 2) {
    ElMessage.warning('修正次数已用尽')
    return
  }
  const current = props.getCurrentFormJson?.()
  if (!current) return
  loading.value = true
  try {
    const nextRound = repairRound.value + 1
    const data = await interactionFormByAgent({
      action: 'repair',
      instruction: lastInteractionInstruction.value || 'repair',
      currentFormJson: current,
      output: lastInteraction.value.output,
      verificationReport: lastInteraction.value.verificationReport,
      round: nextRound,
      expectedScenarioFingerprint: lastInteraction.value.scenarioFingerprint,
    })
    repairRound.value = nextRound
    if (data.status === 'tamper') {
      ElMessage.error('修正试图改动验证场景，已拒绝')
      return
    }
    if (data.status !== 'generated' || !data.output) {
      ElMessage.warning(data.summary || '修正失败')
      lastInteraction.value = { ...lastInteraction.value, ...data, status: data.status }
      return
    }
    lastInteraction.value = {
      ...data,
      formJson: current,
      applied: false,
    }
    interactionVerifiedPass.value = false
    ElMessage.info(`第 ${nextRound} 轮修正已返回，正在重新验证…`)
    loading.value = false
    await onVerifyInteraction()
  } catch (e: any) {
    error.value = e?.message || '自动修正失败'
    emit('AiError')
    loading.value = false
  }
}

async function onApplyInteraction() {
  if (!lastInteraction.value?.output || !interactionVerifiedPass.value || !lastInteraction.value.verificationReport) {
    return
  }
  const current = props.getCurrentFormJson?.()
  if (!current) return
  loading.value = true
  try {
    const data = await interactionFormByAgent({
      action: 'apply',
      instruction: lastInteractionInstruction.value || 'apply',
      currentFormJson: current,
      output: lastInteraction.value.output,
      verificationReport: lastInteraction.value.verificationReport,
      userConfirmed: true,
      confirmOverwrite: true,
    })
    lastInteraction.value = { ...lastInteraction.value, ...data }
    if (data.status === 'applied' && data.applied && data.formJson) {
      emit('apply', data.formJson)
      ElMessage.success('交互已写入画布')
      interactionVerifiedPass.value = false
    } else {
      ElMessage.warning(data.summary || '写入被拒绝')
    }
  } catch (e: any) {
    error.value = e?.message || '写入交互失败'
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
    lastInteraction.value = null
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
  lastInteraction.value = null
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
    // runInteraction 已推送 user 消息时避免重复
    const last = messages.value[messages.value.length - 1]
    if (!(last?.role === 'user' && last.content === text)) {
      messages.value.push({ role: 'user', content: text })
    }
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
    color: #606266;
    .warnings-title {
      font-weight: 600;
      margin-bottom: 4px;
      color: #ad6800;
    }
    ul {
      margin: 0;
      padding-left: 18px;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 200px;
      overflow: auto;
      font-size: 11px;
    }
  }
  .preview {
    font-size: 12px;
    color: #409eff;
  }
}
</style>
