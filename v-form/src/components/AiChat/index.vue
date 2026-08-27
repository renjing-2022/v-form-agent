<template>
  <div class="ai-agent-panel">
    <div class="hint">
      描述业务需求，或上传评估量表 Excel，生成合规表单后确认应用到画布。
    </div>

    <el-input
      v-model="prompt"
      type="textarea"
      :rows="4"
      maxlength="2000"
      show-word-limit
      placeholder="例如：生成老年人认知评估表，包含时间定向、人物定向等评分题"
      :disabled="loading"
    />

    <div class="upload-row">
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
      <el-button type="primary" :loading="loading" @click="onGenerate">生成表单</el-button>
      <el-button
        type="success"
        :disabled="!lastResult || loading"
        @click="onApply"
      >应用到设计器</el-button>
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
      预览：共 {{ previewCount }} 个控件（确认后才会写入画布）
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { generateFormByAgent, type AgentGenerateResponse } from '@/api/chat'

const emit = defineEmits<{
  (e: 'apply', formJson: AgentGenerateResponse['formJson']): void
  (e: 'AiError'): void
}>()

const prompt = ref('')
const file = ref<File | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const loading = ref(false)
const error = ref('')
const lastResult = ref<AgentGenerateResponse | null>(null)

const previewCount = computed(() => lastResult.value?.formJson?.widgetList?.length || 0)

function pickFile() {
  fileInputRef.value?.click()
}

function onFileChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  const f = input.files?.[0] || null
  file.value = f
}

function clearFile() {
  file.value = null
  if (fileInputRef.value) fileInputRef.value.value = ''
}

async function onGenerate() {
  error.value = ''
  lastResult.value = null
  const mode = file.value ? 'excel' : 'text'
  if (mode === 'text' && !prompt.value.trim()) {
    error.value = '请输入需求描述，或上传 Excel'
    return
  }

  loading.value = true
  try {
    const data = await generateFormByAgent({
      mode,
      prompt: prompt.value.trim(),
      file: file.value,
    })
    if (!data?.formJson?.widgetList) {
      throw new Error('返回结果缺少 formJson')
    }
    lastResult.value = data
    ElMessage.success('生成成功，请确认后应用到设计器')
  } catch (e: any) {
    error.value = e?.message || '生成失败'
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
