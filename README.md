# v-form-agent

基于 `v-form` 低代码表单平台的 Agent 化改造项目，目标是在可视化设计器中集成 AI 能力，实现“通过自然语言 / 评估量表 Excel 生成合规表单 JSON，并确认后应用到画布”。

## 当前版本

- DeliveryGuard 版本：`v0.1.0`（阶段：`specified`，实现进行中）
- OpenSpec change：`ai-form-agent-mvp`

## 项目结构

- `v-form/`：Vue3 + Vite 低代码表单设计器 / 渲染器
- `agent/`：本地智能体服务（Fastify + DeepSeek，开发期同机 `3040`）
- `docs/`：PRD 与技术设计
- `openspec/changes/ai-form-agent-mvp/`：提案与任务
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

1. 输入需求或上传评估量表 Excel  
2. 点击「生成表单」  
3. 确认后「应用到设计器」

Vite 已将 `/api/agent` 代理到 `http://127.0.0.1:3040`。

### 3. 运行浏览器 E2E

E2E 使用 Playwright Chromium，并在隔离端口启动 mock Agent 与前端，不会复用开发中的 `3030/3040` 服务：

```bash
cd e2e
npm install
npm run typecheck
npm test
```

- E2E 端口：`v-form:3130`、`agent:3140`
- Windows 默认复用系统 Edge；无可用浏览器的环境先执行 `npx playwright install chromium`
- 默认强制 `AGENT_ALLOW_MOCK=1` 且不使用 DeepSeek Key
- 稳定验收证据输出到 `docs/evidence/<version>/`
- HTML 报告与失败 trace 位于 `e2e/playwright-report/`、`e2e/test-results/`，不纳入版本事实
- 项目级执行规范见 `.agents/skills/deliveryguard-e2e/SKILL.md`

## MVP 能力

- 自然语言整表生成
- 评估量表类 Excel 解析（合并单元格 / 分区 / `N分：` 评分选项）
- FieldPlan → 合规 `formJson` 校验后回填
- DeepSeek Key 仅服务端；前端不再硬编码 Coze/Dify Bearer

## 文档

- PRD：`docs/requirements/ai-form-agent-mvp.md`
- 技术设计：`docs/design/ai-form-agent-mvp.md`
- 本地验证记录：`docs/verification/v0.1.0-local.md`
