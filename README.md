# v-form-agent

基于 `v-form` 低代码表单平台的 Agent 化改造项目：自然语言 / Excel 整表生成，以及对**当前画布表单**的多轮优化（结构 / options / 公式）。

## 当前版本

- DeliveryGuard 版本：`v0.2.0`（阶段：`specified` → 实现中）
- OpenSpec change：`ai-form-multiturn-refine`
- 已发布：`v0.1.0`（整表生成 MVP）

## 项目结构

- `v-form/`：Vue3 + Vite 低代码表单设计器 / 渲染器
- `agent/`：本地智能体服务（Fastify + DeepSeek，开发期同机 `3040`）
- `docs/`：PRD 与技术设计
- `openspec/changes/ai-form-multiturn-refine/`：当前提案与任务
- `.deliveryguard/`：版本与证据目录

## 快速启动（开发同机）

### 1. 启动 Agent

```bash
cd agent
cp .env.example .env
# 可选：填写 DEEPSEEK_API_KEY；未填写时 AGENT_ALLOW_MOCK=1 可用本地 mock/启发式
npm install
npm run dev
```

健康检查：`http://127.0.0.1:3040/health`

### 2. 启动 v-form

```bash
cd v-form
npm install --registry=https://registry.npmmirror.com
npm run serve
```

浏览器打开设计器后，右侧设置面板切到 **AI** Tab：

1. **空画布**：输入需求或上传 Excel →「生成表单」→ 确认「应用到设计器」
2. **已有表单**：输入优化指令（如加 tab、改选项、加总分公式）→「优化当前表」→ 确认整表覆盖应用  
   多轮会话保存在前端内存；刷新页面会清空会话。

Vite 已将 `/api/agent` 代理到 `http://127.0.0.1:3040`。

相关接口：

- `POST /api/agent/v1/generate`：整表生成（text / excel）
- `POST /api/agent/v1/refine`：基于 `currentFormJson` 的多轮优化

### 3. 运行浏览器 E2E

```bash
cd e2e
npm install
npm run typecheck
npm test
```

- E2E 端口：`v-form:3130`、`agent:3140`
- 默认 `AGENT_ALLOW_MOCK=1`
- 证据输出：`docs/evidence/<version>/`
- 规范见 `.agents/skills/deliveryguard-e2e/SKILL.md`

## 能力概览

| 版本 | 能力 |
|---|---|
| v0.1.0 | 自然语言 / Excel 整表生成、校验后确认回填 |
| v0.2.0（进行中） | 多轮优化当前表：结构（含 tab）、options、公式；会话前端内存 |

P0 **不做**：自由 CSS / 任意事件 JS 自动生成（后续阶段）。

## 文档

- PRD：`docs/requirements/ai-form-multiturn-refine.md`
- 技术设计：`docs/design/ai-form-multiturn-refine.md`
- 历史 MVP：`docs/requirements/ai-form-agent-mvp.md`
