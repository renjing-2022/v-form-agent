# Proposal: ai-form-agent-mvp

| 项 | 值 |
|---|---|
| Change ID | `ai-form-agent-mvp` |
| Target version | `v0.1.0` |
| Primary document | `docs/requirements/ai-form-agent-mvp.md` |
| Supporting design | `docs/design/ai-form-agent-mvp.md` |
| Affected repository | `app` (`.` / 本仓库) |

## Problem

`v-form` 设计器已嵌入 AI 聊天面板，但当前主路径是浏览器直连 Dify / Coze：

1. API 密钥暴露在前端，不符合安全基线；
2. 对话输出没有形成可校验的 v-form `formJson`；
3. 无法稳定支持“自然语言 / 评估量表 Excel → 合规表单 → 画布可见”的业务目标。

需要在仓库内建设本地 Agent，替换直连外部平台的主生成链路。

## Scope

1. 在空目录 `agent/` 新建同机可运行的 TypeScript Agent 服务（Fastify + DeepSeek 云 API）。
2. 提供整表生成能力：
   - 自然语言描述 → 整表 `formJson`；
   - 评估量表类 Excel（合并单元格 / 分区 / 评分说明）→ 整表 `formJson`。
3. 采用 **FieldPlan（模型） + Assembler/Validator（代码）** 生成合规 JSON，禁止把模型自由文本直接写入画布。
4. 改造 `v-form`：`/api/agent` 代理、AiChat 主路径切换、结果预览与确认后调用 `designer.loadFormJson`。
5. 移除或停用前端硬编码外部平台 Bearer；DeepSeek Key 仅存在于 `agent` 服务端环境变量。

## Non-goals

- 对话式增量修改当前表单；
- PDF / Word / 图片 OCR；
- 事件脚本、数据源、自定义 CSS 自动生成；
- 小计 / 总分计算公式落地；
- 生产独立部署、多租户、向量库 RAG、复杂多 Agent 编排；
- 继续以 Coze / Dify 作为验收主路径（旁路可暂留，但不计入本 change 完成定义）。

## Affected contracts

| 契约 | 变更 |
|---|---|
| `POST /api/agent/v1/generate` | 新增。输入 `mode=text|excel`；成功返回 `{ summary, warnings[], formJson }`；失败返回可读 `message` |
| `designer.loadFormJson` | 不改语义；前端确认后消费 `{ widgetList, formConfig }` |
| 组件白名单 | MVP 限制：`input` / `textarea` / `radio` / `select` / `number` / `date` / `static-text` / `divider` / 简单 `grid`；真源参考 `widgetsConfig.js` |
| 前端 AI 主路径 | 从 Coze/Dify 直连切换为本地 Agent 代理 |
| 开发端口 | `v-form:3030`，`agent:3040`，Vite proxy `/api/agent` → `3040` |

## Design notes（跨边界必要说明）

1. **为什么自建 agent，而不是继续 Coze/Dify**  
   需要把密钥、Prompt、Excel 解析、JSON 校验放在可控服务端；并强制“规划与组装分离”，提高合规率。

2. **为什么 Excel 不能按表头字段表解析**  
   业务样例是评估量表排版（分区标题、合并单元格、多行评分标准）。Parser 输出 `ExcelDigest`，再进入 Planner，而不是“首行即字段定义”。

3. **前后端边界**  
   - `agent`：解析、规划、组装、校验、调用 DeepSeek；  
   - `v-form`：交互、上传、展示 warnings、确认后回填；  
   - 不在浏览器持有模型密钥。

详细设计见 `docs/design/ai-form-agent-mvp.md`，本提案不重复展开实现细节。

## Risks

| 风险 | 缓解 |
|---|---|
| 合并单元格 / 版式差异导致 Excel 解析不稳定 | 启发式分区+题目识别；失败降级进 `warnings`，服务不崩溃 |
| 模型输出非法组件类型 | Zod 白名单校验；非法则失败或有限重试，不写画布 |
| `widgetsConfig` 与 agent 白名单漂移 | MVP 维护精简副本，并在任务中要求对齐检查 |
| DeepSeek 超时/波动 | 超时、单次重试、错误信息透出到前端 |

## Acceptance criteria

1. 同机启动 `agent` 与 `v-form` 后，AI 面板可用自然语言完成至少一次整表生成，确认后画布出现对应控件。
2. 使用「老年人认知能力专项评估」类 Excel，可生成分区标题 + 至少若干带分值选项的 `radio` 题目，并成功应用到画布。
3. 损坏/空/超大 Excel 或校验失败时，有明确错误提示，且不破坏现有画布。
4. 浏览器主生成请求走本地 `/api/agent` 代理，而不是 Coze/Dify 主域名。
5. DeepSeek API Key 不出现在前端源码默认值与前端构建产物中。

## Out of this change’s evidence claims

本提案只推进到 OpenSpec `ready`。  
`sources` / `acceptance` / `deployments` / `release` 保持空或 `pending`，直到真实实现与验收证据存在后另行登记。
