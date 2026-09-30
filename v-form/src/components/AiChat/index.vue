<template>
  <div class="ai-agent-panel">
    <div class="hint">
      空画布可「生成表单」；已有表单用自然语言描述结构或交互。含糊或高风险会先澄清；事件冲突须选择合并方式后再写入。
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
      :disabled="loading || clarifying"
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
      <el-button type="primary" :loading="loading" :disabled="clarifying" @click="onSubmit">
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

    <!-- 结构化澄清 -->
    <div v-if="clarifying && activeClarification" class="clarify-panel mt">
      <div class="warnings-title">需要确认后再继续</div>
      <div v-if="activePendingPlan" class="plan-box">
        <div><b>目标：</b>{{ activePendingPlan.goal }}</div>
        <div v-if="activePendingPlan.ambiguities?.length">
          <b>待澄清：</b>{{ activePendingPlan.ambiguities.join('；') }}
        </div>
        <div v-if="activePendingPlan.riskFacts?.length" class="risk-row">
          <b>风险：</b>
          <span
            v-for="(f, i) in activePendingPlan.riskFacts"
            :key="i"
            class="risk-badge"
            :data-level="f.level"
          >{{ f.level }} {{ f.message }}</span>
        </div>
        <div v-if="activePendingPlan.nextStepsAfterAnswer?.length">
          <b>下一步：</b>{{ activePendingPlan.nextStepsAfterAnswer.join(' → ') }}
        </div>
        <div v-if="activePendingPlan.plannedHandlers?.length">
          <b>计划事件：</b>
          {{ activePendingPlan.plannedHandlers.map((h) => `${h.target}.${h.eventKey}`).join('，') }}
        </div>
      </div>

      <div
        v-for="q in activeClarification.questions"
        :key="q.id"
        class="clarify-q"
      >
        <div class="q-prompt">
          {{ q.prompt }}
          <span v-if="q.riskNote" class="risk-badge" data-level="L2">{{ q.riskNote }}</span>
        </div>
        <el-radio-group
          v-if="q.type === 'single_choice' || q.type === 'confirm'"
          v-model="clarifyAnswers[q.id].single"
          :disabled="loading"
        >
          <el-radio
            v-for="opt in q.options || []"
            :key="opt.id"
            :label="opt.id"
          >
            {{ opt.label }}
            <span v-if="opt.recommended" class="rec">推荐</span>
            <span v-if="opt.riskLevel" class="risk-badge" :data-level="opt.riskLevel">{{ opt.riskLevel }}</span>
            <span v-if="opt.description" class="opt-desc">{{ opt.description }}</span>
          </el-radio>
        </el-radio-group>
        <el-checkbox-group
          v-else-if="q.type === 'multiple_choice'"
          v-model="clarifyAnswers[q.id].multi"
          :disabled="loading"
        >
          <el-checkbox
            v-for="opt in q.options || []"
            :key="opt.id"
            :label="opt.id"
          >
            {{ opt.label }}
            <span v-if="opt.recommended" class="rec">推荐</span>
          </el-checkbox>
        </el-checkbox-group>
        <el-input
          v-else
          v-model="clarifyAnswers[q.id].text"
          type="textarea"
          :rows="2"
          :disabled="loading"
          placeholder="请输入"
        />
      </div>

      <div class="actions">
        <el-button type="primary" :loading="loading" @click="onClarifyContinue">继续生成</el-button>
        <el-button :disabled="loading" @click="onClarifyResetAnswers">返回修改</el-button>
        <el-button :disabled="loading" @click="onClarifyCancel">取消</el-button>
      </div>
    </div>

    <div class="actions event-actions" v-if="lastInteraction && !clarifying">
      <el-button
        size="small"
        :disabled="loading || lastInteraction.status !== 'generated' || !lastInteraction.formJsonCandidate || !conflictsResolved"
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

    <!-- 事件冲突决议 -->
    <div v-if="activeConflicts.length && lastInteraction?.status === 'generated'" class="conflict-panel mt">
      <div class="warnings-title">事件冲突（写入前须选择）</div>
      <div
        v-for="(c, i) in activeConflicts"
        :key="`${c.target}.${c.eventKey}`"
        class="conflict-item"
      >
        <div class="conflict-head">
          <b>{{ c.target }}.{{ c.eventKey }}</b>
          <span class="risk-badge" :data-level="c.mergeSafe ? 'L1' : 'L2'">
            {{ c.mergeSafe ? '可安全合并' : '仅覆盖/取消' }}
          </span>
        </div>
        <el-radio-group v-model="conflictModes[conflictKey(c)]" size="small" :disabled="loading" @change="onConflictModeChange">
          <el-radio
            v-for="m in c.suggestedModes"
            :key="m"
            :label="m"
          >{{ mergeModeLabel(m) }}</el-radio>
        </el-radio-group>
        <details class="diff-details">
          <summary>查看代码差异</summary>
          <pre class="diff-pre">=== 旧代码 ===
{{ c.existingCode }}

=== 新代码 ===
{{ c.incomingCode }}</pre>
        </details>
      </div>
      <div v-if="!conflictsResolved" class="conflict-hint">请为每一项选择合并方式后再验证/写入</div>
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
      v-if="lastInteraction && !clarifying"
      class="mt"
      :type="interactionAlertType"
      :title="interactionAlertTitle"
      show-icon
      :closable="false"
    />

    <div v-if="lastInteraction?.riskFacts?.length && !clarifying" class="warnings mt">
      <div class="warnings-title">风险说明</div>
      <ul>
        <li v-for="(f, i) in lastInteraction.riskFacts" :key="i">
          <span class="risk-badge" :data-level="f.level">{{ f.level }}</span>
          {{ f.message }}
        </li>
      </ul>
    </div>

    <div v-if="handlerCodePreview && !clarifying" class="code-preview mt">
      <div class="warnings-title">候选事件代码</div>
      <pre>{{ handlerCodePreview }}</pre>
    </div>

    <div v-if="lastInteraction?.scenarioNarration?.length && !clarifying" class="warnings mt">
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
import { computed, createVNode, getCurrentInstance, nextTick, reactive, ref, render as renderVNode, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  generateFormByAgent,
  refineFormByAgent,
  interactionFormByAgent,
  type AgentGenerateResponse,
  type AgentInteractionResponse,
  type ClarificationAnswer,
  type ClarificationPayload,
  type EventConflict,
  type EventMergeMode,
  type EventResolution,
  type PendingPlanView,
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
type AnswerDraft = { single: string; multi: string[]; text: string }

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

const activeClarification = ref<ClarificationPayload | null>(null)
const activePendingPlan = ref<PendingPlanView | null>(null)
const sessionFormFingerprint = ref('')
const clarifyAnswers = reactive<Record<string, AnswerDraft>>({})
const conflictModes = reactive<Record<string, EventMergeMode>>({})
const activeConflicts = ref<EventConflict[]>([])

const clarifying = computed(
  () =>
    Boolean(activeClarification.value?.questions?.length) &&
    lastInteraction.value?.status === 'need_clarification',
)

const previewCount = computed(() => lastResult.value?.formJson?.widgetList?.length || 0)
const canApply = computed(
  () => Boolean(lastResult.value?.formJson) && !lastInteraction.value && !loading.value,
)

const conflictsResolved = computed(() => {
  if (!activeConflicts.value.length) return true
  return activeConflicts.value.every((c) => Boolean(conflictModes[conflictKey(c)]))
})

const canApplyInteraction = computed(
  () =>
    Boolean(lastInteraction.value?.status === 'generated' || lastInteraction.value?.status === 'applied') &&
    interactionVerifiedPass.value &&
    conflictsResolved.value &&
    !loading.value &&
    !clarifying.value,
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
  if (s === 'need_clarification' || s === 'plan_expired' || s === 'cancelled') return 'warning'
  if (s === 'unsupported' || s === 'failed' || s === 'error') return 'error'
  return 'info'
})

const interactionAlertTitle = computed(() => {
  const s = lastInteraction.value
  if (!s) return ''
  const risk = s.riskLevel ? ` [${s.riskLevel}]` : ''
  return `${s.summary || s.status}${risk}`
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
  clarifying.value
    ? '请先完成上方澄清问题，或点「取消」'
    : effectiveMode.value === 'refine'
      ? '例如：把备注改成多行；或每个 tab 加下一页并校验；或数量×单价算金额'
      : '例如：生成老年人认知评估表，包含时间定向、人物定向等评分题',
)

function conflictKey(c: { target: string; eventKey: string }) {
  return `${c.target}::${c.eventKey}`
}

function mergeModeLabel(m: EventMergeMode) {
  if (m === 'prepend') return '前置合并'
  if (m === 'append') return '后置合并'
  if (m === 'overwrite') return '覆盖'
  return '取消该项'
}

function initClarifyAnswers(payload: ClarificationPayload) {
  for (const key of Object.keys(clarifyAnswers)) delete clarifyAnswers[key]
  for (const q of payload.questions) {
    const def = q.defaultOptionIds?.[0] || q.recommendedOptionIds?.[0] || ''
    clarifyAnswers[q.id] = {
      single: q.type === 'single_choice' || q.type === 'confirm' ? def : '',
      multi: q.type === 'multiple_choice' ? [...(q.defaultOptionIds || [])] : [],
      text: '',
    }
  }
}

function initConflictModes(conflicts: EventConflict[]) {
  for (const key of Object.keys(conflictModes)) delete conflictModes[key]
  activeConflicts.value = conflicts
  for (const c of conflicts) {
    const preferred =
      c.suggestedModes.find((m) => m === 'append') ||
      c.suggestedModes.find((m) => m === 'overwrite') ||
      c.suggestedModes[0]
    if (preferred) conflictModes[conflictKey(c)] = preferred
  }
}

function buildEventResolutions(): EventResolution[] {
  return activeConflicts.value.map((c) => ({
    target: c.target,
    eventKey: c.eventKey,
    mode: conflictModes[conflictKey(c)] || 'cancel',
  }))
}

function clearClarificationState() {
  activeClarification.value = null
  activePendingPlan.value = null
  sessionFormFingerprint.value = ''
  for (const key of Object.keys(clarifyAnswers)) delete clarifyAnswers[key]
}

function applyInteractionResponse(data: AgentInteractionResponse, instruction?: string) {
  lastInteraction.value = data
  if (instruction) lastInteractionInstruction.value = instruction
  lastResult.value = null
  sessionFormFingerprint.value = data.formFingerprint || ''

  if (data.status === 'need_clarification' && data.clarification?.questions?.length) {
    activeClarification.value = data.clarification
    activePendingPlan.value = data.pendingPlan || null
    initClarifyAnswers(data.clarification)
    activeConflicts.value = []
    for (const key of Object.keys(conflictModes)) delete conflictModes[key]
    interactionVerifiedPass.value = false
    return
  }

  clearClarificationState()
  if (data.status === 'generated') {
    initConflictModes(data.eventConflicts || [])
    interactionVerifiedPass.value = false
  } else {
    activeConflicts.value = []
    for (const key of Object.keys(conflictModes)) delete conflictModes[key]
  }
}

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
  clearClarificationState()
  activeConflicts.value = []
  for (const key of Object.keys(conflictModes)) delete conflictModes[key]
  clearFile()
}

function buildClarifyAnswersPayload(): ClarificationAnswer[] {
  const qs = activeClarification.value?.questions || []
  return qs.map((q) => {
    const draft = clarifyAnswers[q.id] || { single: '', multi: [], text: '' }
    if (q.type === 'confirm') {
      const id = draft.single
      return {
        questionId: q.id,
        optionIds: id ? [id] : [],
        confirmed: id === 'yes' ? true : id === 'no' ? false : undefined,
      }
    }
    if (q.type === 'single_choice') {
      return { questionId: q.id, optionIds: draft.single ? [draft.single] : [], text: draft.text || undefined }
    }
    if (q.type === 'multiple_choice') {
      return { questionId: q.id, optionIds: [...draft.multi], text: draft.text || undefined }
    }
    return { questionId: q.id, text: draft.text }
  })
}

async function onClarifyContinue() {
  const plan = activePendingPlan.value
  const clarification = activeClarification.value
  if (!plan || !clarification) return
  const current = props.getCurrentFormJson?.()
  if (!current) return

  for (const q of clarification.questions) {
    if (!q.required) continue
    const draft = clarifyAnswers[q.id]
    if (q.type === 'text' && !draft?.text?.trim()) {
      error.value = `请回答：${q.prompt}`
      return
    }
    if ((q.type === 'single_choice' || q.type === 'confirm') && !draft?.single) {
      error.value = `请选择：${q.prompt}`
      return
    }
    if (q.type === 'multiple_choice' && !(draft?.multi?.length)) {
      error.value = `请选择：${q.prompt}`
      return
    }
  }

  loading.value = true
  error.value = ''
  try {
    const data = await interactionFormByAgent({
      action: 'clarify',
      currentFormJson: current,
      pendingPlanId: plan.id,
      formFingerprint: sessionFormFingerprint.value || plan.formFingerprint,
      answers: buildClarifyAnswersPayload(),
      messages: messages.value.slice(-20),
    })
    messages.value.push({ role: 'user', content: '（已提交澄清答案）' })
    messages.value.push({ role: 'assistant', content: data.summary || data.status })
    applyInteractionResponse(data)

    if (data.status === 'plan_expired') {
      ElMessage.warning('画布或计划已变化，请重新描述')
      clearClarificationState()
    } else if (data.status === 'cancelled') {
      ElMessage.info('已取消，画布未变更')
      clearClarificationState()
    } else if (data.status === 'need_clarification') {
      ElMessage.info('仍需进一步确认')
    } else if (data.status === 'generated') {
      ElMessage.success('已生成交互方案，请处理冲突（如有）并验证')
    } else if (data.status === 'unsupported') {
      ElMessage.warning('高风险动作已拒绝')
    }
  } catch (e: any) {
    error.value = e?.message || '提交澄清失败'
    emit('AiError')
  } finally {
    loading.value = false
  }
}

function onClarifyResetAnswers() {
  if (activeClarification.value) initClarifyAnswers(activeClarification.value)
  error.value = ''
}

function onClarifyCancel() {
  clearClarificationState()
  if (lastInteraction.value) {
    lastInteraction.value = {
      ...lastInteraction.value,
      status: 'cancelled',
      summary: '已取消澄清，画布未变更',
    }
  }
  ElMessage.info('已取消，画布未变更')
}

async function onConflictModeChange() {
  interactionVerifiedPass.value = false
  if (!lastInteraction.value?.output) return
  const current = props.getCurrentFormJson?.()
  if (!current || !conflictsResolved.value) return
  // 切换合并模式后重建候选
  loading.value = true
  try {
    const data = await interactionFormByAgent({
      action: 'preview',
      currentFormJson: current,
      output: lastInteraction.value.output,
      eventResolutions: buildEventResolutions(),
    })
    if (data.formJsonCandidate) {
      lastInteraction.value = {
        ...lastInteraction.value,
        formJsonCandidate: data.formJsonCandidate,
        eventConflicts: data.eventConflicts || lastInteraction.value.eventConflicts,
        warnings: data.warnings,
        summary: lastInteraction.value.summary,
        status: 'generated',
        verificationReport: undefined,
      }
    }
  } catch (e: any) {
    error.value = e?.message || '重建预览失败'
  } finally {
    loading.value = false
  }
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
  await runInteraction(text)
}

async function runInteraction(text: string) {
  const current = props.getCurrentFormJson?.()
  if (!current?.widgetList?.length) {
    error.value = '当前画布无表单，请先生成/拖拽控件，或切换到「整表生成」'
    return
  }
  loading.value = true
  clearClarificationState()
  lastInteraction.value = null
  interactionVerifiedPass.value = false
  repairRound.value = 0
  activeConflicts.value = []
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

    applyInteractionResponse(data, text)
    messages.value.push({ role: 'user', content: text })
    const q =
      Array.isArray(data.questions) && data.questions.length
        ? `\n追问：\n- ${data.questions.join('\n- ')}`
        : ''
    const nextHint =
      data.status === 'generated'
        ? '\n（请核对场景 →「在预览中验证」→「确认写入画布」）'
        : data.status === 'need_clarification'
          ? '\n（请在下方澄清面板作答）'
          : ''
    messages.value.push({
      role: 'assistant',
      content: `${data.summary || data.status}${q}${nextHint}`,
    })
    prompt.value = ''
    if (data.status === 'need_clarification') {
      ElMessage.info('请完成澄清后再继续')
    } else if (data.status === 'unsupported') {
      ElMessage.warning('需求超出纯前端范围或被风险策略拒绝，未写入')
    } else if (data.status === 'generated') {
      ElMessage.success(
        activeConflicts.value.length
          ? '已生成方案，请先处理事件冲突再验证'
          : '已生成交互方案，请验证后写入',
      )
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
  if (!conflictsResolved.value) {
    error.value = '请先为事件冲突选择合并方式'
    return
  }
  loading.value = true
  try {
    // 确保候选与当前决议一致
    if (activeConflicts.value.length) {
      const current = props.getCurrentFormJson?.()
      if (current && lastInteraction.value.output) {
        const preview = await interactionFormByAgent({
          action: 'preview',
          currentFormJson: current,
          output: lastInteraction.value.output,
          eventResolutions: buildEventResolutions(),
        })
        if (preview.formJsonCandidate) {
          lastInteraction.value = {
            ...lastInteraction.value,
            formJsonCandidate: preview.formJsonCandidate,
          }
        }
      }
    }
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
    applyInteractionResponse({ ...data, formJson: current, applied: false })
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
  if (!conflictsResolved.value) {
    error.value = '请先为事件冲突选择合并方式'
    return
  }
  const current = props.getCurrentFormJson?.()
  if (!current) return
  loading.value = true
  try {
    const resolutions = buildEventResolutions()
    const data = await interactionFormByAgent({
      action: 'apply',
      instruction: lastInteractionInstruction.value || 'apply',
      currentFormJson: current,
      output: lastInteraction.value.output,
      verificationReport: lastInteraction.value.verificationReport,
      userConfirmed: true,
      eventResolutions: resolutions.length ? resolutions : undefined,
      confirmOverwrite: resolutions.length ? undefined : true,
    })
    lastInteraction.value = { ...lastInteraction.value, ...data }
    if (data.status === 'applied' && data.applied && data.formJson) {
      emit('apply', data.formJson)
      ElMessage.success('交互已写入画布')
      interactionVerifiedPass.value = false
      activeConflicts.value = []
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
    clearClarificationState()
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
  clearClarificationState()
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

watch(
  () => lastInteraction.value?.eventConflicts,
  (conflicts) => {
    if (conflicts?.length && lastInteraction.value?.status === 'generated') {
      initConflictModes(conflicts)
    }
  },
)
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
  .warnings, .code-preview, .clarify-panel, .conflict-panel {
    background: #fff7e6;
    border: 1px solid #ffd591;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 12px;
    color: #606266;
    .warnings-title {
      font-weight: 600;
      margin-bottom: 6px;
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
  .clarify-panel, .conflict-panel {
    background: #f0f7ff;
    border-color: #91caff;
    .warnings-title { color: #0958d9; }
  }
  .plan-box {
    margin-bottom: 10px;
    padding: 8px;
    background: #fff;
    border-radius: 4px;
    line-height: 1.6;
  }
  .clarify-q {
    margin-bottom: 12px;
    .q-prompt {
      font-weight: 600;
      margin-bottom: 6px;
      color: #303133;
    }
    .opt-desc {
      color: #909399;
      margin-left: 4px;
      font-weight: 400;
    }
    .rec {
      color: #67c23a;
      margin-left: 4px;
      font-size: 11px;
    }
  }
  .risk-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .risk-badge {
    display: inline-block;
    font-size: 11px;
    padding: 0 6px;
    border-radius: 3px;
    margin-left: 4px;
    background: #f0f0f0;
    color: #606266;
    &[data-level='L1'] { background: #e6f4ff; color: #1677ff; }
    &[data-level='L2'] { background: #fff7e6; color: #d46b08; }
    &[data-level='L3'] { background: #fff1f0; color: #cf1322; }
  }
  .conflict-item {
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px dashed #d9d9d9;
    &:last-child { border-bottom: none; }
  }
  .conflict-head {
    margin-bottom: 6px;
  }
  .conflict-hint {
    color: #d46b08;
    margin-top: 4px;
  }
  .diff-details {
    margin-top: 6px;
    summary { cursor: pointer; color: #1677ff; }
  }
  .diff-pre {
    max-height: 160px;
    background: #fafafa;
    padding: 6px;
    border-radius: 4px;
  }
  .preview {
    font-size: 12px;
    color: #409eff;
  }
}
</style>
