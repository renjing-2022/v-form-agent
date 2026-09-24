# v-form-agent

基于 `v-form` 低代码表单平台的 Agent 化改造项目：自然语言 / Excel 整表生成，以及对**当前画布表单**的多轮优化（结构 / options / 公式）。

## 当前版本

- DeliveryGuard 最新已发布版本：`v0.9.0`（阶段：`released`；OpenSpec `archived`；acceptance=`passed`）
- 发布锚点：https://github.com/renjing-2022/v-form-agent/tree/v0.9.0
- 已归档 OpenSpec：`openspec/changes/archive/`（v0.1.0–v0.9.0）
- 进行中提案：`v0.10.0`–`v0.13.0`（`openspec/changes/ai-form-*`）
- 验收报告：`docs/acceptance/v0.9.0.md`
- Evidence Manifest：`.deliveryguard/acceptance/v0.9.0/evidence.json`

## 项目结构

- `v-form/`：Vue3 + Vite 低代码表单设计器 / 渲染器
- `agent/`：本地智能体服务（Fastify + DeepSeek，开发期同机 `3040`）
- `docs/`：PRD 与技术设计
- `openspec/changes/`：进行中提案；已发布变更在 `openspec/changes/archive/`
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
- 证据输出：`docs/evidence/<version>/`（本版默认 `EVIDENCE_VERSION=v0.2.0`）
- 规范见 `.agents/skills/deliveryguard-e2e/SKILL.md`

## 能力概览

| 版本 | 能力 |
|---|---|
| v0.1.0 | 自然语言 / Excel 整表生成、校验后确认回填 |
| v0.2.0 | 多轮优化当前表：结构（含 tab）、options、公式；会话前端内存；Playwright 验收证据已落盘 |

P0 **不做**：自由 CSS / 任意事件 JS 自动生成（后续阶段）。

## v0.3.0：Widget Catalog + 厚 P1

OpenSpec：`ai-form-widget-catalog-refine`（已验收；release 视部署事实）

### Widget Catalog

- 真源：`v-form/src/components/form-designer/widget-panel/widgetsConfig.js` + `getDefaultFormConfig()`
- 产物：`agent/src/knowledge/generated/widget-catalog.json`（37 个组件类型）
- 同步：`cd agent && npm run catalog:sync`
- 漂移检查：`cd agent && npm run catalog:check`

### Refine 扩展（Agent）

- `updateField.patch` 按 Catalog `writableKeys` 合入常见属性；事件键禁写
- 受控样式：`setCssCode` / `patchFormConfig` / `setCustomClass`（长度与危险构造护栏）
- 精准定位：formSummary 含 path/parent/writableSnapshot；重复 name 歧义 → 422
- 按需注入：`catalogSnippets`（每轮最多 12 个 type）

### 验证

```bash
cd agent
npm run typecheck
npm run catalog:check
npm run acceptance:cases   # 输出 docs/evidence/v0.3.0/ 与 v0.4.0/
npm run smoke
```

## v0.4.0：设计真源 Catalog 2.0

OpenSpec：`ai-form-design-truth-catalog`（`ready`；DeliveryGuard acceptance **passed**；**release pending**）

**产品硬门槛：**

1. 知识库对设计可配置面的覆盖 ≈ 查阅 v-form 设计源码（widgetsConfig + property-editor + 渲染约定 + policy）
2. 自然语言结果与设计器手动操作高精确度一致（合法字面量与**值形态**；非法值不可静默成功）

### Catalog 2.0

- 多真源：widgetsConfig + formConfig + propertyRegister + **219** `*-editor.vue` → `design-truth-graph.json`
- Policy 层：禁写/identity/渲染/联动/复合 schema/容器级/双轨/扩展边界；enum 主路径来自 graph
- 50×(type,prop) 抽样：`catalog:check` + `catalog-sample-parity`
- IntentGate + 同源 Validator（generate/refine/Excel）
- loadFormJson 前：`preApplyFormJsonGate`（duplicate id 结构门闩）

### 验证

```bash
cd agent
npm run catalog:sync
npm run catalog:check          # DESIGN_TRUTH_CATALOG_SYNC_OK
npm run acceptance:cases       # docs/evidence/v0.4.0/*
npm run smoke

cd ../e2e
npm test -- tests/ai-form-v040.spec.ts
```

- 验收报告：`docs/acceptance/v0.4.0.md`
- Evidence Manifest：`.deliveryguard/acceptance/v0.4.0/evidence.json`

## 文档

- PRD：`docs/requirements/ai-form-design-truth-catalog.md`（v0.4.0）
- 技术设计：`docs/design/ai-form-design-truth-catalog.md`
- 多轮优化：`docs/requirements/ai-form-multiturn-refine.md`
- 验收报告：`docs/acceptance/v0.2.0.md` / `docs/acceptance/v0.3.0.md`
- 历史 MVP：`docs/requirements/ai-form-agent-mvp.md` / `docs/acceptance/v0.1.0.md`
