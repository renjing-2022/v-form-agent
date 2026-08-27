# Tasks: ai-form-agent-mvp

有序、可验证任务。完成一项再勾选一项；未完成前不得提前勾选。

## 1. Agent 工程骨架

- [x] 在 `agent/` 初始化 TypeScript + Fastify 工程（`package.json`、`tsconfig`、启动脚本）
- [x] 添加 `.env.example`（含 `DEEPSEEK_API_KEY`、`PORT=3040`），确保真实 `.env` 不被提交
- [x] 实现健康检查接口（如 `GET /health`），同机可启动监听 `3040`

## 2. 契约、白名单与校验

- [x] 定义 `FieldPlan` 与生成响应 `{ summary, warnings[], formJson }` 的 Zod schema
- [x] 建立 MVP 组件白名单及默认 options 模板（对齐 `widgetsConfig.js` 关键类型）
- [x] 实现 formJson 校验器：结构、类型白名单、`radio/select` options、name 唯一性、数量上限

## 3. 文本整表生成链路

- [x] 实现 DeepSeek 客户端封装（超时、一次重试、错误透出）
- [x] 实现 Planner：文本 → `FieldPlan`（强制 JSON、白名单 type、评估题优先 radio）
- [x] 实现 Assembler：`FieldPlan` → 合规 `{ widgetList, formConfig }`（`jsonVersion: 3`）
- [x] 打通 `mode=text` 的 `POST /api/agent/v1/generate`，本地用一句中文需求冒烟通过校验

## 4. Excel 评估量表解析与生成

- [x] 实现 Excel Parser：读取首个 sheet、处理合并单元格，输出 `ExcelDigest`
- [x] 识别分区标题、题号行、评分说明（`N分：...`），忽略 Logo/水印/已填分；小计/总分降级为 notes 或 static-text
- [x] 打通 `mode=excel` 上传生成；用认知评估类样例至少产出分区 + 1 个含 0-4 分选项的 radio

## 5. 前端主路径改造与回填

- [x] 在 `v-form/vite.config.js` 增加 `/api/agent` → `http://127.0.0.1:3040` 代理
- [x] 新增前端 Agent API 调用，AiChat 主路径改为本地 Agent（支持文本与 Excel 上传）
- [x] 展示 `summary` / `warnings`，提供确认后调用 `designer.loadFormJson`；校验失败不写画布
- [x] 移除或停用前端硬编码外部 Bearer / Coze-Dify 主路径依赖

## 6. 本地验证与文档收口

- [x] 完成文本冒烟、Excel 黄金样例、负例（损坏/空文件）的本地验证记录
- [x] 更新根 `README.md` 或 `agent` 启动说明（同机启动步骤、端口、环境变量）
- [x] 确认本 change 验收标准可被手工复现后，再进入实现事实登记（source/acceptance 另做）

## 7. 浏览器 E2E 与证据自动化

- [x] 新增 Playwright 隔离环境，使用 mock Agent 覆盖自然语言生成并显式应用到画布
- [x] 覆盖评估量表 Excel 应用，以及空文件报错且不破坏已有画布
- [x] 通过 `case-id` reporter 输出 DeliveryGuard 文本证据与截图，并提供项目级 `deliveryguard-e2e` Skill
