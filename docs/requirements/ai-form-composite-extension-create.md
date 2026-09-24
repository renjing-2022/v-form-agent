# PRD：复合组件、上传/远程配置与运行时扩展创建（v0.12.0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-composite-extension-create-prd` |
| 类型 | product-requirement |
| 目标版本 | `v0.12.0` |
| 状态 | proposed |
| 关联 OpenSpec | `ai-form-composite-extension-create` |
| 前置版本 | `v0.11.0` planned |

## 1. 目标

让 Agent 覆盖组件库剩余的复合容器、上传、声明式远程数据源及运行时扩展组件，实现“所有用户可见组件均可由 Agent 创建”。内部节点不作为独立用户组件创建，而由父组件结构编译器生成。

## 2. 范围定义

### FR-1 复合组件

覆盖：

- `sub-form`
- `grid-sub-form`
- `data-table`
- `tree`
- `button-group`
- `object-group`
- `vf-dialog`
- `vf-drawer`
- `grid`/`grid-col`
- `tab`/`tab-pane`
- `table`/`table-cell`

每类必须具有最小可用模板、子集合约、父子约束和独立验收。

### FR-2 上传组件

覆盖 `file-upload` 与 `picture-upload`：

- 允许创建和配置设计器原生上传能力；
- 上传属于 L2，必须 Ask-before-act；
- 不允许模型生成上传网络 JS；
- 凭据、token 和私密 header 不得写入 formJson、prompt、日志或证据；
- 上传目标必须引用受管配置或由用户明确提供的非秘密配置。

### FR-3 声明式远程数据源

允许 select/cascader/tree/data-table 等组件配置设计器原生远程能力，但：

- JS handlers 继续禁止 `fetch`、XHR、axios、数据源执行 API 等网络调用；
- Agent 只生成声明式数据源引用和字段映射；
- 配置前必须显示 endpoint/connector、方法、触发时机、字段映射和数据用途；
- L2 确认后才能形成候选；
- 生产、写操作或含凭据的数据源属于 L3，默认拒绝。

### FR-4 运行时扩展

`slot`、运行时 `card`/`alert`、custom widget 和未来 chart type 纳入 Agent 创建，前提是运行时扩展注册时提供机器可读 manifest：

- type/alias/version；
- default schema；
- allowed parents/children；
- writable/forbidden options；
- events/API；
- preview actions/assertions；
- risk/network flags。

无 manifest 的扩展不可由 Agent 猜测创建。

### FR-5 内部节点

`table-cell`、`grid-col`、`tab-pane` 等 internal type 仅由父结构模板生成或在明确父上下文中创建；不得作为无父节点的独立组件。

### FR-6 混合交互

复合组件和扩展组件可在同一句话中创建并绑定 JS。handlers 必须引用候选树解析后的稳定目标；场景执行器必须支持对应组件动作与观测。

## 3. 组件能力等级

- **Create-ready**：可创建、配置、预览、断言。
- **Structure-ready**：可生成合法子树，但部分高级属性需用户手动。
- **Runtime-ready**：扩展 manifest 已加载且版本匹配。
- **Managed-network**：仅声明式网络配置，需 L2。
- **Blocked**：缺 manifest、凭据、生产写或不能安全验证。

UI 必须显示能力等级，不得把“能克隆默认 JSON”宣传为“组件已完整支持”。

## 4. 非目标

- 任意网络 JS；
- 自动生成或保存凭据；
- 未授权生产写入；
- 无 manifest 的运行时组件；
- 场景之外行为的绝对正确性保证。

## 5. 验收标准

1. 静态 Catalog 全 37 type 均有 create capability 结论与测试。
2. 用户可见组件要么可创建，要么返回具体阻塞原因；不得泛化为“白名单不支持”。
3. 复合组件生成的 JSON 可被设计器加载、编辑、预览。
4. 上传和声明式远程数据源均执行 L2 Ask-before-act。
5. 任何生成 JS 网络调用仍被拒绝。
6. runtime manifest 的合法、缺失、版本漂移均有验收。
7. 复合组件 + JS 事务失败时画布不变。

## 6. 风险

- “全部组件”被误解为所有能力全开：用能力等级和覆盖矩阵诚实表达。
- 声明式远程配置泄露凭据：仅允许受管引用，证据脱敏。
- 复合子树身份冲突：子树级确定性命名与事务校验。
- runtime extension 漂移：manifest fingerprint 与加载版本绑定。
- 预览触发真实上传/远程请求：验证环境使用受控 mock/fixture，不访问生产。
