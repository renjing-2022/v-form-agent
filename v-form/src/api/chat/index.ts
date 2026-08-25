// 修复 sendMessage 方法的参数格式
import { get, post } from '@/utils/requestFetch';
import { createRequestInstance } from '@/utils/requestFetch';

// const customRequest = createRequestInstance('http://192.168.1.56/v1');
// const customRequest = createRequestInstance('/dify-ai/v1');
const customRequest = createRequestInstance(import.meta.env.VITE_APP_DIFY_API);
const customRequestCoze = createRequestInstance(import.meta.env.VITE_APP_COZE_API);




export function getModelList() {
  return get('/system/model/modelList').json();
}

export const send = (data) => post<null>('/chat/send', data);
// 正确格式：将 headers 作为配置对象的属性传递
export const sendMessage = (data) => customRequest.post<null>('/chat-messages', data);
export const sendMessageCoze = (data) => customRequestCoze.post<null>('/chat', data);
// export const sendMessage = (data) => post<null>('http://192.168.1.56/v1/chat-messages', data);

