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
};

/**
 * 本地 Agent 整表生成（主路径）
 * - text: JSON body
 * - excel: multipart file + optional prompt
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
