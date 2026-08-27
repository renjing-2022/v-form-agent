# 技术设计：v-form AI 表单生成 Agent（MVP）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-agent-design` |
| 类型 | technical-design |
| 目标版本 | `v0.1.0` |
| 关联 PRD | `docs/requirements/ai-form-agent-mvp.md` |
| 关联 OpenSpec | `ai-form-agent-mvp` |

## 1. 设计目标

将“前端直连 Dify/Coze 聊天”升级为“仓库内 Agent 服务驱动的整表生成”，保证：

- 密钥不出浏览器；
- 输出可被 `designer.loadFormJson` 消费；
- Excel 评估量表可抽取为结构化字段计划后再组装 JSON。

## 2. 总体架构

```text
[ v-form AiChat UI ]
        |  HTTP (Vite proxy /api/agent)
        v
[ agent/  TypeScript 服务 :3040 ]
   1) ingest: text | excel
   2) plan: DeepSeek -> FieldPlan JSON
   3) assemble: FieldPlan + widget whitelist -> formJson
   4) validate: schema / type whitelist
        |
        v
[ 返回 { formJson, summary, warnings[] } ]
        |
        v
[ 前端确认 ] -> designer.loadFormJson(formJson)
```

### 关键原则

1. **LLM 负责理解与规划，代码负责合规组装。**
2. 不允许把模型自由文本直接当 formJson 写画布。
3. Excel 走“版式理解”，不是“首行表头字段表”。

## 3. 技术选型（已拍板）

| 层级 | 选择 | 说明 |
|---|---|---|
| 运行时 | Node.js + TypeScript | 与前端同语言，便于共享 schema |
| HTTP | Fastify | 轻量，适合同机开发 |
| 模型 | DeepSeek 云 API（OpenAI 兼容） | Key 仅服务端 |
| Excel | SheetJS（xlsx）或 exceljs | 需读取合并单元格信息 |
| 校验 | Zod | FieldPlan / 响应契约 |
| 前端改造 | 现有 `AiChat` + `loadFormJson` | 替换请求目标并增加应用动作 |

开发期端口约定：

- `v-form`：`3030`
- `agent`：`3040`
- Vite proxy：`/api/agent` -> `http://127.0.0.1:3040`

## 4. 模块划分（`agent/`）

建议目录：

```text
agent/
  package.json
  src/
    server.ts
    routes/generate.ts
    services/deepseek.ts
    services/excelParser.ts
    services/planner.ts
    services/assembler.ts
    services/validator.ts
    schemas/fieldPlan.ts
    schemas/formJson.ts
    knowledge/widgetWhitelist.ts
  .env.example
```

### 4.1 Excel Parser

针对评估量表样例（合并单元格 + 分区标题 + 评分说明单元格）：

输入：xlsx/xls buffer  
输出：`ExcelDigest`

```ts
type ExcelDigest = {
  title?: string
  sections: Array<{
    name: string
    items: Array<{
      label: string
      optionText?: string   // 原始评分说明文本
      sampleScore?: string  // 已填分，仅供参考，不作为默认值
    }>
  }>
  notes: string[]           // 解析降级说明
}
```

解析策略：

1. 读取第一个工作表；
2. 保留 merges，把合并区主单元格文本展开到逻辑块；
3. 识别分区行（如包含「评估」「沟通」等标题样式/整行合并）；
4. 识别题目行（编号前缀如 `1.` / `2.`）；
5. 抽取邻近评分说明单元格，按 `N分：...` 正则拆选项；
6. 跳过 Logo 行、水印、纯「分值」标签行；
7. 「小计」「总分」记入 notes 或生成 `static-text`，不做公式。

### 4.2 Planner（DeepSeek）

输入：用户文本，或 `ExcelDigest`  
输出：`FieldPlan`

```ts
type FieldPlan = {
  formTitle: string
  layout: 'single-column' | 'sectioned'
  sections: Array<{
    title: string
    fields: Array<{
      key: string
      label: string
      type: 'input' | 'textarea' | 'radio' | 'select' | 'number' | 'date' | 'static-text' | 'divider'
      required?: boolean
      options?: Array<{ value: string | number; label: string }>
    }>
  }>
}
```

Prompt 约束：

- 只能使用白名单 `type`；
- 评估题优先 `radio`；
- 禁止输出事件回调代码；
- 输出必须是 JSON，禁止 Markdown 包裹（服务端再做一次提取兜底）。

### 4.3 Assembler

把 `FieldPlan` 转成 v-form formJson：

- `formConfig` 基于 `getDefaultFormConfig()` 语义（`jsonVersion: 3` 等）；
- 字段模板来自白名单默认 options（对齐 `widgetsConfig.js`）；
- 生成稳定的 `id` / `options.name`；
- 分区标题使用 `divider` 或 `static-text`；
- 默认不做深层 `tab` / `sub-form`。

### 4.4 Validator

校验失败则返回 4xx/业务错误，不返回“半合法可写画布”的 JSON：

- JSON 结构：必须含 `widgetList`、`formConfig`；
- 类型白名单；
- `radio/select` 必须有 options；
- name 唯一性；
- 深度与字段数量上限（防止异常输入拖垮前端）。

## 5. API 契约（MVP）

### `POST /api/agent/v1/generate`

`Content-Type: multipart/form-data` 或 `application/json`

JSON 示例：

```json
{
  "mode": "text",
  "prompt": "生成一个老年人认知评估表，包含时间定向和人物定向"
}
```

Multipart：

- `mode=excel`
- `file=<xlsx>`
- `prompt` 可选补充说明

成功响应：

```json
{
  "summary": "已生成认知评估表，共 2 个分区、8 个题目",
  "warnings": ["总分未生成计算公式"],
  "formJson": {
    "widgetList": [],
    "formConfig": { "jsonVersion": 3 }
  }
}
```

错误响应需包含可读 `message`（如 Excel 无法识别、模型超时、校验失败）。

## 6. 前端改造点

| 位置 | 改动 |
|---|---|
| `vite.config.js` | 增加 `/api/agent` 代理到 `3040` |
| `src/api/chat/index.ts` | 新增 `generateFormByAgent`；主路径不再依赖 Coze/Dify |
| `src/components/AiChat/*` | 支持文本提交与 Excel 上传；展示 summary/warnings；提供“应用到设计器” |
| `setting-panel/index.vue` | 将 Agent 结果桥接到 `designer.loadFormJson` |
| 环境变量 | 前端仅保留 Agent base path；移除硬编码外部 Bearer |

安全要求：删除或停用前端默认 Coze PAT 硬编码。

## 7. 规范同步策略

`widgetsConfig.js` 是组件真源。MVP 采用：

1. 在 `agent` 内维护精简白名单副本 `widgetWhitelist.ts`；
2. 在技术任务中增加“白名单与 widgetsConfig 对齐检查”说明；
3. 后续可再升级为构建脚本自动抽取（非本版本必做）。

## 8. 测试与验收设计

最低验证集：

1. **文本冒烟**：一句中文需求 -> 校验通过 -> 画布出现字段；
2. **Excel 黄金样例**：认知能力专项评估类 xlsx -> 至少识别出分区与 1 个带 0-4 分选项的 radio；
3. **负例**：损坏文件 / 空文件 / 超大文件；
4. **安全**：前端产物不含 DeepSeek Key；主请求走本地代理。

浏览器验收由 `e2e/` 下的 Playwright 测试执行。测试服务使用隔离端口
`v-form:3130`、`agent:3140`，强制 mock 规划以保持确定性，并通过
`case-id` 将测试映射到 DeliveryGuard Evidence Manifest。自定义 reporter
把结果与截图写入 `docs/evidence/<version>/`；HTML report 与 trace 仅作为
本地诊断产物，不单独构成版本验收结论。

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 合并单元格解析失败 | 分区/题目启发式 + warnings，不中断 |
| 模型输出非法 type | Zod 白名单 + 默认降级 `input`（或直接失败重试一次） |
| 一次生成过深布局 | MVP 强制 sectioned/single-column |
| DeepSeek 波动 | 超时、重试 1 次、错误透出 |

## 10. 明确不做（实现边界）

- LangGraph 复杂多 Agent；
- 向量库 RAG（可后续加组件说明检索）；
- 增量 patch 当前 formJson；
- 生产容器编排。
