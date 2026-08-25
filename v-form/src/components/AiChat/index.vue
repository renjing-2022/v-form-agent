<template>
  <div class="chat-with-id-container">
    <div class="chat-warp">
      <div v-if="bubbleItems.length">
        <BubbleList
          ref="bubbleListRef"
          :list="bubbleItems"
          max-height="calc(100vh - 380px)"
        >
          <template #header="{ item }">
            <Thinking
              v-if="item.role === 'system' && !item.content && !item.stopped"
              v-model="item.thinlCollapse"
              :content="item.reasoning_content"
              :status="item.thinkingStatus"
              class="thinking-chain-warp"
              @change="handleChange"
              color="#fff"
              background-color="linear-gradient(to bottom right, rgba(190, 126, 246, 1), rgba(95, 13, 245, 1), rgba(186, 74, 227, 1))"
            >
              <template #label>
                <span
                  v-if="
                    props.isBtnChart &&
                    props.needCheck &&
                    item.role === 'system' &&
                    !finishedInsert &&
                    chatFlag != 'sure'
                  "
                  >处理中...</span
                >
                <span v-else>思考中...</span>
              </template>
            </Thinking>
          </template>
          <template #content="{ item }">
            <Bubble
              class="system-content"
              v-if="item.content && item.role === 'system'"
              ref="bubbleRef"
              maxWidth="600px"
              :typing="true"
              @finish="onFinish"
            >
              <template #content>
                <XMarkdown
                  :markdown="item.content"
                  :allow-html="true"
                  default-theme-mode="light"
                />
              </template>
            </Bubble>
            <div class="footer-container">
              <el-button v-if="item.stopped" type="warning" size="small"
                >已终止思考</el-button
              >
            </div>
            <div class="footer-row">
              <div
                class="footer-text"
                v-if="
                  props.isBtnChart &&
                  !item.typing &&
                  item.role === 'system' &&
                  !finishedInsert
                "
              >
                内容由AI生成，仅供参考
              </div>
              <div
                style="margin-top: 6px"
                v-if="
                  props.isBtnChart &&
                  !item.typing &&
                  item.role === 'system' &&
                  !finishedInsert &&
                  item.key === bubbleItems.length - 1
                "
              ></div>
            </div>
            <!-- user 内容 纯文本 -->
            <div
              v-if="item.content && item.role === 'user'"
              class="user-content"
            >
              {{ item.content }}
            </div>
          </template>
        </BubbleList>
      </div>

      <div
        v-if="!bubbleItems.length"
        class="welcome-text w-full flex flex-wrap items-center justify-center text-center text-lg font-semibold mb-32px mt-12px font-size-32px line-height-32px"
      >
        <Welcome
          title="欢迎使用 AI智能助手 💖"
          :style="{
            background:
              'linear-gradient(97deg, rgba(90,196,255,0.12) 0%, rgba(174,136,255,0.12) 100%)',
          }"
        >
          <!-- <template #image>
              <img :src="systemLogo" style="width: 60px" />
            </template> -->
        </Welcome>
      </div>
      <div>
        <Sender
          ref="senderRef"
          v-model="inputValue"
          class="chat-defaul-sender"
          :auto-size="{
            maxRows: 6,
            minRows: 2,
          }"
          variant="updown"
          clearable
          :loading="isLoading"
          @submit="startSSE(inputValue, 'sure')"
          @cancel="hanlderInterrupt"
        >
          <template #action-list>
            <div class="action-list-self-wrap">
              <el-tooltip
                v-if="!finishedResponse"
                content="停止"
                placement="bottom"
                effect="light"
              >
                <span
                  style="width: 36px; height: 36px"
                  type="info"
                  @click="hanlderInterrupt"
                >
                  <!-- <svg-icon style="width: 36px;height: 36px;color: #fff;" :icon-class="'stop'" /> -->
                  <el-button type="danger" round size="small">停止</el-button>
                </span>
              </el-tooltip>
              <el-button
                v-else
                round
                color="#659AEE"
                @click="startSSE(inputValue, 'sure')"
                :disabled="!inputValue || !inputValue.trim()"
              >
                <el-icon color="#fff"><Position /></el-icon>
              </el-button>
            </div>
          </template>
        </Sender>
      </div>
    </div>
  </div>
</template>
<!-- 每个回话对应的聊天内容 -->
<script setup lang="ts">
// import type { AnyObject } from 'typescript-api-pro';
import { h, markRaw, ref, computed, watch, nextTick } from "vue";
import {
  Delete,
  Loading,
  Operation,
  Position,
  Promotion,
  Right,
  Setting,
} from "@element-plus/icons-vue";
import {
  BubbleList,
  Sender,
  Attachments,
  FilesCard,
  XMarkdown,
  Typewriter,
  Welcome,
  Prompts,
  Thinking,
  Bubble,
} from "vue-element-plus-x";
import type { TypewriterInstance } from "vue-element-plus-x/types/Typewriter";
import type { BubbleProps } from "vue-element-plus-x/types/Bubble";
import type { BubbleListInstance } from "vue-element-plus-x/types/BubbleList";
import type {
  FilesCardProps,
  FilesType,
} from "vue-element-plus-x/types/FilesCard";
import type { ThinkingStatus } from "vue-element-plus-x/types/Thinking";
import type { PromptsItemsProps } from "vue-element-plus-x/types/Prompts";
import { useHookFetch } from "hook-fetch/vue";
// import systemLogo from '../../assets/images/aiAvatar.png'
// import defAva from '@/assets/images/profile.jpg';
const systemLogo = ref(
  "https://cube.elemecdn.com/0/88/03b0d39583f48206768a7534e55bcpng.png"
);
const defAva = ref("https://avatars.githubusercontent.com/u/76239030?v=4");
import { send, sendMessage,sendMessageCoze } from "@/api/chat";

// import { useFilesStore } from '@/store/modules/files';
// import { useUserStore } from '@/store/modules/user';
// import { getToken ,getSessionId } from '@/utils/auth';

const props = defineProps({
  prompText: {
    type: Array,
    default: () => [],
  },
  appKey: {
    type: String,
    default: () => {
      return "app-HnO04J3kSzcUwu94Fgc0PcMT";
    },
  },
  isBtnChart: {
    type: Boolean,
    default: () => false,
  },
  needCheck: {
    type: Boolean,
    default: () => true,
  },
  uuid: {
    type: Boolean,
    default: () => true,
  },
});
const conversationId = ref("");
type MessageItem = BubbleProps & {
  key: number;
  role: "ai" | "user" | "system";
  avatar: string;
  thinkingStatus?: ThinkingStatus;
  thinlCollapse?: boolean;
  reasoning_content?: string;
  stopped?: boolean; // 新增：标识该消息是否被停止
};

// const chatStore = useChatStore();

// const filesStore = useFilesStore();
const finishedResponse = ref(true);
const stopResponse = ref(false);
const requestError = ref(false);
const stopThink = ref(false); //在没有响应之前停止
const finishedInsert = ref(""); // 写入系统成功
// const userStore = useUserStore();
const bubbleRef = ref<InstanceType<typeof Bubble> | null>(null);
const emit = defineEmits([
  "dataFinished",
  "AiError",
  "again",
  "apply",
  "stop",
  "close",
  "resizeDialog",
]);
// 用户头像
const avatar = computed(() => {
  return "https://avatars.githubusercontent.com/u/76239030?v=4";
});

const inputValue = ref("");
const senderRef = ref<InstanceType<typeof Sender> | null>(null);
const bubbleItems = ref<MessageItem[]>([]);
const bubbleListRef = ref<BubbleListInstance | null>();

const statusValue = ref<ThinkingStatus>("thinking");
const dataReceived = ref(false); // 新增：标记数据是否接收完毕
const typingFinished = ref(false); // 新增：标记打字是否结束
const {
  stream,
  loading: isLoading,
  cancel,
} = useHookFetch({
  request: sendMessageCoze,
  onError: (err) => {
    console.warn("测试错误拦截", err);
  },
});
// 记录进入思考中
let isThinking = false;

// 封装数据处理逻辑
function handleDataChunk(chunk) {
  console.log(parseSSEMessage(chunk))
  try {
    const reasoningChunk = chunk.choices?.[0].delta.reasoning_content;
    if (reasoningChunk) {
      // 开始思考链状态
      bubbleItems.value[bubbleItems.value.length - 1].thinkingStatus =
        "thinking";
      bubbleItems.value[bubbleItems.value.length - 1].loading = true;
      bubbleItems.value[bubbleItems.value.length - 1].thinlCollapse = true;
      if (bubbleItems.value.length) {
        bubbleItems.value[bubbleItems.value.length - 1].reasoning_content +=
          reasoningChunk;
      }
    }
    const chunkObj = parseSSEMessage(chunk)
    console.log(chunkObj)
    const parsedChunk = chunkObj.event === 'conversation.message.delta'&& chunkObj.data.content?chunkObj.data.content:null
    console.log(parsedChunk)
    if (parsedChunk) {
      const thinkStart = parsedChunk.includes("<think>");
      const thinkEnd = parsedChunk.includes("</think>");
      if (thinkStart) {
        isThinking = true;
      }
      if (thinkEnd) {
        isThinking = false;
      }
      if (isThinking) {
        // 开始思考链状态
        bubbleItems.value[bubbleItems.value.length - 1].thinkingStatus =
          "thinking";
        bubbleItems.value[bubbleItems.value.length - 1].loading = true;
        bubbleItems.value[bubbleItems.value.length - 1].thinlCollapse = true;
        if (bubbleItems.value.length) {
          bubbleItems.value[bubbleItems.value.length - 1].reasoning_content +=
            parsedChunk.replace("<think>", "").replace("</think>", "");
        }
      } else {
        // 结束 思考链状态
        bubbleItems.value[bubbleItems.value.length - 1].thinkingStatus = "end";
        bubbleItems.value[bubbleItems.value.length - 1].loading = false;
        if (bubbleItems.value.length) {
          bubbleItems.value[bubbleItems.value.length - 1].content +=
            parsedChunk;
        }
      }
    }
  } catch (err) {
    // 这里如果使用了中断，会有报错，可以忽略不管
    console.error("解析数据时出错:", err);
  }
}
// 封装错误处理逻辑
function handleError(err: any) {
  console.error("Fetch error:", err);
  requestError.value = true;
  emit("AiError");
}

// SSE消息解析函数：将SSE格式字符串转换为JavaScript对象
function parseSSEMessage(sseMessage) {
  try {
    // 分割event和data字段
    const lines = sseMessage.trim().split('\n');
    const result = {};
    
    for (const line of lines) {
      if (line.startsWith('event:')) {
        result.event = line.substring('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        const dataStr = line.substring('data:'.length).trim();
        // 解析data字段的JSON
        result.data = JSON.parse(dataStr);
        
        // 进一步解析嵌套的content字段（如果存在）
        if (result.data.content) {
          try {
            result.data.content = JSON.parse(result.data.content);
            
            // 如果content中的data字段也是JSON字符串，继续解析
            if (result.data.content.data && typeof result.data.content.data === 'string') {
              try {
                result.data.content.data = JSON.parse(result.data.content.data);
              } catch (innerDataErr) {
                // 如果解析失败，保持原始字符串
                console.warn("解析content.data失败:", innerDataErr);
              }
            }
          } catch (contentErr) {
            // 如果content不是JSON字符串，保持原始值
            // console.warn("解析content失败:", contentErr);
          }
        }
      }
    }
    
    return result;
  } catch (err) {
    console.error("解析SSE消息失败:", err);
    return null;
  }
}
const chatFlag = ref("");

const timer = ref();

function start() {
  // 定义模拟数据 - 菜谱分析
  const mockData = `
以下是对2025年11月24日 - 2025年11月30日这一周菜谱的分析：

### 机构老人健康统计信息概述
机构内共有757位老人，平均年龄71.8岁，大部分老人年龄在70 - 90岁之间。
\`\`\`javascript
const a = 1
\`\`\`

\`\`\`cookbook
 data={
 menuDay: "2025-11-24"
 }
\`\`\`

接下来还要继续输入吧？机构内共有757位老人，平均年龄71.8岁，大部分老人年龄在70 - 90岁之间。
`;

  // 重置或初始化必要的变量
  let currentIndex = 0;
  let currentContent = "";

  // 设置更短的定时器间隔(50ms)，加快打字速度
  timer.value = setInterval(() => {
    if (currentIndex < mockData.length) {
      // 每次增加3个字符
      const endIndex = Math.min(currentIndex + 3, mockData.length);
      currentContent += mockData.slice(currentIndex, endIndex);
      currentIndex = endIndex;

      // 更新到bubbleItems
      if (bubbleItems.value.length > 0) {
        bubbleItems.value[bubbleItems.value.length - 1].content =
          currentContent;
      }

      // 对于标点符号，增加稍长的停顿，使效果更自然
      const char = mockData[currentIndex - 1];
      if (["。", "！", "？", "；", "\n\n"].includes(char)) {
        clearInterval(timer.value);
        setTimeout(() => {
          // 继续打字效果
          timer.value = setInterval(() => {
            if (currentIndex < mockData.length) {
              currentContent += mockData[currentIndex];
              currentIndex++;
              if (bubbleItems.value.length > 0) {
                bubbleItems.value[bubbleItems.value.length - 1].content =
                  currentContent;
              }
            } else {
              // 打字结束
              clearInterval(timer.value);
              // 完成后设置相关状态
              if (bubbleItems.value.length > 0) {
                bubbleItems.value[bubbleItems.value.length - 1].typing = false;
              }
              dataReceived.value = true;
              typingFinished.value = true;
              checkAndSetFinishedResponse();
            }
          }, 50); // 标点后恢复正常速度
        }, 200); // 标点停顿时间
      }
    } else {
      // 打字结束
      clearInterval(timer.value);
      // 完成后设置相关状态
      if (bubbleItems.value.length > 0) {
        bubbleItems.value[bubbleItems.value.length - 1].typing = false;
      }
      dataReceived.value = true;
      typingFinished.value = true;
      checkAndSetFinishedResponse();
    }
  }, 50); // 正常打字速度
}

async function startSSE(chatInfo: string | object, flag: string) {
  console.log(chatInfo, flag);
  if (senderRef.value) {
    senderRef.value.blur();
  }
  chatFlag.value = flag;
  finishedResponse.value = false;
  finishedInsert.value = "";
  requestError.value = false;
  stopThink.value = false;
  dataReceived.value = false;
  stopResponse.value = false;
  let chatContent = "";
  let showContent = "";
  if (typeof chatInfo === "string") {
    chatContent = chatInfo;
    showContent = chatInfo;
  } else if (typeof chatInfo === "object") {
    chatContent = chatInfo.text;
    showContent = chatInfo.showText;
  }
  try {
    // 添加用户输入的消息
    // console.log('chatContent', chatContent);
    // 清空输入框
    inputValue.value = "";
    addMessage(showContent || chatContent, true);

    // if(!filesStore.filesList.length){

    // }else{
    //   //有上传文件
    //   let ObjArr = [
    //     {type: "text", text: chatContent},
    //   ]
    //   addMessage(ObjArr, true);
    // }
    addMessage("", false);
    // 这里有必要调用一下 BubbleList 组件的滚动到底部 手动触发 自动滚动
    // console.log(bubbleListRef.value)
    await nextTick();
    if (
      bubbleListRef.value &&
      typeof bubbleListRef.value.scrollToBottom === "function"
    ) {
      bubbleListRef.value.scrollToBottom();
    }
    bubbleItems.value[bubbleItems.value.length - 1].thinkingStatus = "thinking";
    for await (const chunk of stream({
      // inputs: {
      // },
      // query: chatContent,
      // conversation_id:
      //   props.uuid && conversationId.value ? conversationId.value : null,
      // user: "abc-123",
      // response_mode: "streaming",
      conversation_id:
        props.uuid && conversationId.value ? conversationId.value : null,
      bot_id: '7592179648004784163',
      user_id: 'user_123',
      stream: true, // 流式响应
      additional_messages: [
          { role: 'user', content: chatContent, content_type: 'text' }
        ]

    })) {
      if (props.uuid && !conversationId.value) {
        conversationId.value = chunk.result.conversation_id;
      }
      if(chunk.result.event === 'done'){
        finishedResponse.value = true;
      }
      console.log(chunk)
      handleDataChunk(chunk.result);
    }
    // bubbleItems.value[bubbleItems.value.length - 1].thinkingStatus = 'end';
    // bubbleItems.value[bubbleItems.value.length - 1].loading = false;
    // start()
  } catch (err) {
    // 优化错误处理，忽略请求被取消导致的错误
    if (
      err.name === "AbortError" ||
      err.message?.includes("signal is aborted")
    ) {
      console.log("请求已被取消");
      stopThink.value = true;
      return;
    }
    handleError(err);
  } finally {
    console.log("数据接收完毕");
    console.log(bubbleItems.value);
    dataReceived.value = true; // 改为设置数据接收完毕标志

    // 停止打字器状态
    if (bubbleItems.value.length) {
      bubbleItems.value[bubbleItems.value.length - 1].typing = false;
    }
    if (!chatFlag.value) {
      emit(
        "dataFinished",
        bubbleItems.value[bubbleItems.value.length - 1].content
      );
    }
  }
}

// 中断请求
async function cancelSSE() {
  cancel();
  // 结束最后一条消息打字状态
  if (bubbleItems.value.length) {
    bubbleItems.value[bubbleItems.value.length - 1].typing = false;
  }
}
const hanlderInterrupt = () => {
  cancelSSE();
  finishedResponse.value = true;
  stopResponse.value = true;
  // 标记当前最新的消息项为已停止
  if (bubbleItems.value.length > 0) {
    bubbleItems.value[bubbleItems.value.length - 1].stopped = true;
    bubbleItems.value[bubbleItems.value.length - 1].loading = false;
  }
  // 调用interrupt方法停止打字动画
  if (bubbleRef.value && typeof bubbleRef.value.interrupt === "function") {
    bubbleRef.value.interrupt();
  }
};

const onFinish = () => {
  typingFinished.value = true;
  checkAndSetFinishedResponse();
};
const checkAndSetFinishedResponse = () => {
  if (dataReceived.value && typingFinished.value) {
    // console.log('数据接收完毕且打字结束，设置 finishedResponse 为 true');
    finishedResponse.value = true;
  }
};

// 添加消息 - 维护聊天记录
function addMessage(message: any, isUser: boolean) {
  const i = bubbleItems.value.length;
  const obj: MessageItem = {
    key: i,
    avatar: isUser ? defAva : systemLogo,
    avatarSize: "32px",
    role: isUser ? "user" : "system",
    placement: isUser ? "end" : "start",
    isMarkdown: !isUser,
    loading: !isUser,
    content: message || "",
    reasoning_content: "",
    thinkingStatus: "start",
    thinlCollapse: false,
  };
  bubbleItems.value.push(obj);
  console.log("添加消息后 bubbleItems:", bubbleItems.value); // 添加日志
}

// 展开收起 事件展示
function handleChange(payload: { value: boolean; status: ThinkingStatus }) {
  console.log("value", payload.value, "status", payload.status);
}

import type {
  BubbleListItemProps,
  BubbleListProps,
} from "vue-element-plus-x/types/BubbleList";
import { array } from "vue-types";

type listType = BubbleListItemProps & {
  key: number;
  role: "user" | "ai";
};

// import { Edit } from '@element-plus/icons-vue'
// const EditIcon = Edit
const promptList = ref<PromptsItemsProps[]>(
  props.prompText.map((text, index) => ({
    key: (index + 1).toString(),
    label: text.showText,
    textInfo: text,
    // 如有需要可添加其他属性
  }))
);
watch(
  () => props.prompText,
  (newVal) => {
    // 例如，如果需要重新开始SSE连接
    promptList.value = props.prompText.map((text, index) => ({
      key: (index + 1).toString(),
      label: text.showText,
      textInfo: text,
      // 如有需要可添加其他属性
    }));
  },
  { deep: true }
);

defineExpose({
  startSSE,
});
</script>

<style scoped lang="scss">
.chat-container {
  display: flex;
  justify-content: space-between;
  flex-direction: row-reverse;
  .showCom {
    flex: 1;
  }
}
.chat-with-id-container {
  // position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 750px;
  height: 100%;
  .chat-warp {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    width: 100%;
    height: calc(100vh - 110px);
    .thinking-chain-warp {
      margin-bottom: 12px;
    }
  }
  :deep() {
    .el-bubble-list {
      padding-top: 24px;
    }
    .el-bubble {
      padding: 0 12px;
      padding-bottom: 24px;
    }
    .el-typewriter {
      overflow: hidden;
      border-radius: 12px;
    }
    .markdown-body {
      background-color: transparent;
    }
    // 为 system-content 类添加样式，左右 padding 设为0
    .system-content .el-bubble-content {
      padding: 0 !important;
      padding-right: 0 !important;
    }
  }
  .chat-defaul-sender {
    width: 100%;
    margin-bottom: 22px;
  }
  :deep(.elx-attachments-file-card-wrap) {
    padding-top: 8px !important;
  }
  .footer-container {
    :deep(.el-button + .el-button) {
      margin-left: 8px;
    }
  }
  :deep(.markdown-body td) {
    // padding: 8px;
    // border: 1px solid #ddd;
    background-color: #fff;
  }
  :deep(.markdown-body th) {
    // padding: 8px;
    // border: 1px solid #ddd;
    background-color: #fefefe;
  }
  :deep(.chat-with-id-container.el-bubble) {
    padding: 0 !important;
  }
  :deep(.el-bubble .el-bubble-start) {
    padding: 0 !important;
  }
  :deep(.el-bubble-content-wrapper .el-bubble-content-filled) {
    max-width: 630px;
  }
  :deep(.elx-xmarkdown-container){
    padding: 0 !important;
  }

  .content-wrapper {
    justify-content: center;
    align-items: center;
  }
  .footer-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
}
.btn-line {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  // background-color: #f1f1f1;
  height: 60px;
  // padding: 15px 15px;
  // 修改为固定在底部并添加上边框阴影
  position: absolute;
  bottom: 0;

  right: 0;
  z-index: 100;
  border-top: 1px solid #ddd;
  box-shadow: 0 -2px 4px rgba(0, 0, 0, 0.1);
  background-color: #fff; // 添加白色背景，确保内容清晰可见
  padding: 15px;
  width: 100%;
}
.footer-text {
  font-size: 12px;
  color: #999;
}
.loading-container {
  font-size: 14px;
  color: #333;
  padding: 12px;
  background: linear-gradient(to right, #fdfcfb 0%, #659aee 100%);
  border-radius: 15px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.loading-container span {
  display: inline-block;
  margin-left: 8px;
}

@keyframes bounce {
  0%,
  100% {
    transform: translateY(5px);
  }
  50% {
    transform: translateY(-5px);
  }
}

.loading-container span:nth-child(4n) {
  animation: bounce 1.2s ease infinite;
}
.loading-container span:nth-child(4n + 1) {
  animation: bounce 1.2s ease infinite;
  animation-delay: 0.3s;
}
.loading-container span:nth-child(4n + 2) {
  animation: bounce 1.2s ease infinite;
  animation-delay: 0.6s;
}
.loading-container span:nth-child(4n + 3) {
  animation: bounce 1.2s ease infinite;
  animation-delay: 0.9s;
}

/* 组件过渡动画效果 */
.component-fade-enter-active,
.component-fade-leave-active {
  transition: all 0.3s ease;
  transform-origin: top center;
}

.component-fade-enter-from,
.component-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.95);
}

.showCom {
  flex: 1;
  /* 确保动画效果正常 */
  overflow: hidden;
}
</style>
