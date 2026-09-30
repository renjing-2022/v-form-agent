import { get, post } from '@/utils/requestFetch';

export function getModelList() {
  return get('/system/model/modelList').json();
}

export const send = (data) => post<null>('/chat/send', data);

/** @deprecated 已切换本地 Agent，保留空实现避免旧组件引用报错 */
export const sendMessage = async () => {
  throw new Error('Dify 直连已停用，请使用 generateFormByAgent');
};

/** @deprecated 已切换本地 Agent，保留空实现避免旧组件引用报错 */
export const sendMessageCoze = async () => {
  throw new Error('Coze 直连已停用，请使用 generateFormByAgent');
};

export type AgentGenerateResponse = {
  summary: string;
  warnings: string[];
  formJson: {
    widgetList: any[];
    formConfig: Record<string, any>;
  };
  message?: string;
  applied?: boolean;
};

export type AgentEventResponse = {
  status: 'need_clarification' | 'spec_ready' | 'code_preview' | 'applied' | 'draft';
  summary: string;
  warnings: string[];
  questions?: string[];
  eventSpec?: Record<string, unknown>;
  code?: string;
  patches?: unknown[];
  formJsonCandidate?: AgentGenerateResponse['formJson'];
  formJson: AgentGenerateResponse['formJson'];
  applied: boolean;
  executionReport?: {
    runner: 'designer-preview' | 'playwright';
    results: Array<{ exampleIndex: number; ok: boolean; actual?: Record<string, unknown>; error?: string }>;
    pass: boolean;
  };
  message?: string;
};

async function postEvent(body: Record<string, unknown>): Promise<AgentEventResponse> {
  const base = import.meta.env.VITE_APP_AGENT_API || '/api/agent';
  const res = await fetch(`${base}/v1/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const issueHint = Array.isArray(data?.issues)
      ? `：${data.issues
          .slice(0, 3)
          .map((i: any) => i.message)
          .join('；')}`
      : '';
    throw new Error((data?.message || data?.summary || `交互请求失败 (${res.status})`) + issueHint);
  }
  return data;
}

/**
 * 本地 Agent 整表生成（主路径）
 */
export async function generateFormByAgent(payload: {
  mode: 'text' | 'excel';
  prompt?: string;
  file?: File | null;
}): Promise<AgentGenerateResponse> {
  const base = import.meta.env.VITE_APP_AGENT_API || '/api/agent';

  if (payload.mode === 'excel') {
    if (!payload.file) {
      throw new Error('请先选择 Excel 文件');
    }
    const form = new FormData();
    form.append('mode', 'excel');
    if (payload.prompt) form.append('prompt', payload.prompt);
    form.append('file', payload.file);

    const res = await fetch(`${base}/v1/generate`, {
      method: 'POST',
      body: form,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.message || `生成失败 (${res.status})`);
    }
    return data;
  }

  const res = await fetch(`${base}/v1/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'text',
      prompt: payload.prompt || '',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `生成失败 (${res.status})`);
  }
  return data;
}

/**
 * 基于当前画布 formJson 的多轮优化
 */
export async function refineFormByAgent(payload: {
  instruction: string;
  currentFormJson: AgentGenerateResponse['formJson'];
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<AgentGenerateResponse> {
  const base = import.meta.env.VITE_APP_AGENT_API || '/api/agent';
  const res = await fetch(`${base}/v1/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instruction: payload.instruction,
      currentFormJson: payload.currentFormJson,
      messages: payload.messages || [],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const issueHint = Array.isArray(data?.issues)
      ? `：${data.issues
          .slice(0, 3)
          .map((i: any) => i.message)
          .join('；')}`
      : '';
    throw new Error((data?.message || `优化失败 (${res.status})`) + issueHint);
  }
  return data;
}

/** v0.7+：交互澄清（默认 action=clarify）；v0.9 UI 主路径改用 interactionFormByAgent */
export async function eventFormByAgent(payload: {
  instruction: string;
  currentFormJson: AgentGenerateResponse['formJson'];
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  action?: 'clarify' | 'generate' | 'apply';
  eventSpec?: Record<string, unknown>;
  patches?: unknown[];
  executionReport?: AgentEventResponse['executionReport'];
  confirmOverwrite?: boolean;
}): Promise<AgentEventResponse> {
  return postEvent({
    instruction: payload.instruction,
    currentFormJson: payload.currentFormJson,
    messages: payload.messages || [],
    action: payload.action || 'clarify',
    eventSpec: payload.eventSpec,
    patches: payload.patches,
    executionReport: payload.executionReport,
    confirmOverwrite: payload.confirmOverwrite,
  });
}

export type AgentInteractionOutput = {
  intent?: string;
  summary?: string;
  structure?: unknown[];
  handlers?: Array<{ id?: string; target: string; eventKey: string; code: string; explain?: string }>;
  scenarios?: Array<{
    id: string;
    handlerRefs: string[];
    title: string;
    arrange?: Record<string, unknown>;
    act?: Array<Record<string, unknown>>;
    assert: Array<Record<string, unknown>>;
  }>;
  unsupported?: Array<{ text: string; reason: string }>;
  questions?: string[];
};

export type ClarificationOption = {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
  riskLevel?: 'L0' | 'L1' | 'L2' | 'L3';
  value: string | boolean | number | Record<string, unknown>;
};

export type ClarificationQuestion = {
  id: string;
  type: 'single_choice' | 'multiple_choice' | 'text' | 'confirm';
  prompt: string;
  options?: ClarificationOption[];
  allowCustom?: boolean;
  defaultOptionIds?: string[];
  recommendedOptionIds?: string[];
  required: boolean;
  riskNote?: string;
  binds?: { slot: string };
};

export type ClarificationPayload = {
  questions: ClarificationQuestion[];
  protocol: 'structured-clarify-v1';
};

export type ClarificationAnswer = {
  questionId: string;
  optionIds?: string[];
  text?: string;
  confirmed?: boolean;
};

export type RiskFact = {
  level: 'L0' | 'L1' | 'L2' | 'L3';
  code: string;
  message: string;
  relatedTargets?: string[];
};

export type PendingPlanView = {
  id: string;
  formFingerprint: string;
  createdAt: string;
  expiresAt: string;
  goal: string;
  ambiguities: string[];
  assumed?: string[];
  plannedStructure: { summary: string; opKinds: string[] };
  plannedHandlers: Array<{ target: string; eventKey: string; action: 'create' | 'merge' | 'overwrite' }>;
  plannedDeletes?: string[];
  riskLevel: 'L0' | 'L1' | 'L2' | 'L3';
  riskFacts: RiskFact[];
  nextStepsAfterAnswer: string[];
};

export type EventMergeMode = 'prepend' | 'append' | 'overwrite' | 'cancel';

export type EventResolution = {
  target: string;
  eventKey: string;
  mode: EventMergeMode;
};

export type EventConflict = {
  target: string;
  eventKey: string;
  existingCode: string;
  incomingCode: string;
  mergeSafe: boolean;
  suggestedModes: EventMergeMode[];
  diffPreview?: {
    old: string;
    mergedPrepend?: string;
    mergedAppend?: string;
    incoming: string;
  };
};

export type AgentInteractionResponse = {
  status:
    | 'generated'
    | 'need_clarification'
    | 'route_refine'
    | 'unsupported'
    | 'applied'
    | 'draft'
    | 'failed'
    | 'tamper'
    | 'error'
    | 'plan_expired'
    | 'cancelled';
  summary: string;
  warnings?: string[];
  questions?: string[];
  unsupported?: Array<{ text: string; reason: string }>;
  output?: AgentInteractionOutput;
  formJsonCandidate?: AgentGenerateResponse['formJson'];
  formJson: AgentGenerateResponse['formJson'];
  applied: boolean;
  scenarioNarration?: string[];
  scenarioFingerprint?: string;
  verificationReport?: {
    runner: 'designer-preview' | 'playwright';
    results: Array<{
      scenarioId: string;
      ok: boolean;
      actual?: Record<string, unknown>;
      error?: string;
      unverifiable?: boolean;
    }>;
    pass: boolean;
    networkHits?: string[];
    errors?: string[];
  };
  round?: number;
  usedMock?: boolean;
  error?: string;
  message?: string;
  clarification?: ClarificationPayload;
  pendingPlan?: PendingPlanView;
  riskLevel?: 'L0' | 'L1' | 'L2' | 'L3';
  riskFacts?: RiskFact[];
  formFingerprint?: string;
  eventConflicts?: EventConflict[];
};

async function postInteraction(body: Record<string, unknown>): Promise<AgentInteractionResponse> {
  const base = import.meta.env.VITE_APP_AGENT_API || '/api/agent';
  const res = await fetch(`${base}/v1/interaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const issueHint = Array.isArray(data?.issues)
      ? `：${data.issues
          .slice(0, 3)
          .map((i: any) => i.message)
          .join('；')}`
      : '';
    throw new Error((data?.message || data?.summary || `交互请求失败 (${res.status})`) + issueHint);
  }
  return data;
}

/** v0.9+：自然语言 → 直出 JS 交互（generate / repair / apply / clarify / preview） */
export async function interactionFormByAgent(payload: {
  action: 'generate' | 'repair' | 'apply' | 'clarify' | 'preview';
  instruction?: string;
  currentFormJson: AgentGenerateResponse['formJson'];
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  output?: AgentInteractionOutput;
  verificationReport?: AgentInteractionResponse['verificationReport'];
  round?: number;
  expectedScenarioFingerprint?: string;
  userConfirmed?: boolean;
  confirmOverwrite?: boolean;
  eventResolutions?: EventResolution[];
  pendingPlanId?: string;
  formFingerprint?: string;
  answers?: ClarificationAnswer[];
}): Promise<AgentInteractionResponse> {
  return postInteraction({
    action: payload.action,
    instruction: payload.instruction,
    currentFormJson: payload.currentFormJson,
    messages: payload.messages || [],
    output: payload.output,
    verificationReport: payload.verificationReport,
    round: payload.round,
    expectedScenarioFingerprint: payload.expectedScenarioFingerprint,
    userConfirmed: payload.userConfirmed,
    confirmOverwrite: payload.confirmOverwrite,
    eventResolutions: payload.eventResolutions,
    pendingPlanId: payload.pendingPlanId,
    formFingerprint: payload.formFingerprint,
    answers: payload.answers,
  });
}
