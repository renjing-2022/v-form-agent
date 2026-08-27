import type { HookFetchPlugin } from 'hook-fetch';
import { ElMessage } from 'element-plus';
import hookFetch from 'hook-fetch';
import { sseTextDecoderPlugin } from 'hook-fetch/plugins';
// import router from '@/routers';
// import { useUserStore } from '@/store/modules/user';
// import { getToken } from '@/utils/auth';

interface BaseResponse {
  code: number;
  data: never;
  msg: string;
  rows: never;
}
// 创建基础配置
const baseConfig = {
  headers: {
    'Content-Type': 'application/json'
  },
  timeout: 0,
  plugins: [sseTextDecoderPlugin({ json: true, prefix: 'data:' })]
};
// export const request = hookFetch.create<BaseResponse, 'data' | 'rows'>({
//   baseURL: import.meta.env.VITE_APP_API_PREFIX + import.meta.env.VITE_APP_CHAT_API,
//   headers: {
//     'Content-Type': 'application/json',
//   },
//   timeout: 0, // 添加这一行，设置超时时间为0，表示不限时间
//   plugins: [sseTextDecoderPlugin({ json: true, prefix: 'data:' })],
// });
// 请求实例工厂函数
export function createRequestInstance(customBaseURL?: string) {
  const request = hookFetch.create<BaseResponse, 'data' | 'rows'>({
    ...baseConfig,
    baseURL: customBaseURL || import.meta.env.VITE_APP_API_PREFIX + import.meta.env.VITE_APP_CHAT_API
  });

  request.use(jwtPlugin());
  return request;
}
// 默认请求实例
export const request = createRequestInstance();
function jwtPlugin(): HookFetchPlugin<BaseResponse> {
  //   const userStore = useUserStore();
  return {
    name: 'jwt',
    beforeRequest: async (config) => {
      config.headers = new Headers(config.headers);

    //   if (config.url == '/chat-messages') {
    //     // config.headers.set('authorization', `Bearer app-LsPQrrYGyNHxerISi5bp5Bvm`);
    //     config.headers.set('authorization', `Bearer ${config.data.inputs.appKey}`);
    //   } else {
    //     //   config.headers.set('authorization', `Bearer ${getToken()}`);
    //     // config.headers.set('authorization', getToken());
    //     config.headers.set('appId', import.meta.env.VITE_APP_ID);
    //     config.headers.set('clientId', import.meta.env.VITE_APP_CLIENT_ID);
    //   }
    // 旧 Coze/Dify Bearer 已移除；AI 主路径改为本地 /api/agent，不再在浏览器携带平台密钥。
      return config;
    },
    afterResponse: async (res) => {
      if (res.result?.code === 200) {
        return res;
      }
      // 处理403逻辑
      if (res.result?.code === 403) {
        // 跳转到403页面（确保路由已配置）

        ElMessage.error(res.result?.msg);
        return Promise.reject(res);
      }
      // 处理401逻辑
      if (res.result?.code === 401) {
        // 如果没有权限，退出，且弹框提示登录
        // userStore.logout();
        // userStore.openLoginDialog();
        console.log('没有权限');
      }
      ElMessage.error(res.result?.msg);
      return Promise.reject(res);
    }
  };
}

request.use(jwtPlugin());

export const post = request.post;

export const get = request.get;

export const put = request.put;

export const del = request.delete;

export default request;
