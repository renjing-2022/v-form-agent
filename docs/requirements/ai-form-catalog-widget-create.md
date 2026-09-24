# PRD：Catalog 驱动普通组件创建与 JS 同事务（v0.11.0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-catalog-widget-create-prd` |
| 类型 | product-requirement |
| 目标版本 | `v0.11.0` |
| 状态 | proposed |
| 关联 OpenSpec | `ai-form-catalog-widget-create` |
| 前置版本 | `v0.10.0` planned |

## 1. 目标

自然语言可创建组件面板中的普通、非复合字段，并在同一句话中为本轮新增组件生成纯前端 JS、验证场景和原子写入候选。解决当前 generate 仅 8 类、refine 实际创建面有限、interaction 仅 `addButton` 的分裂。

## 2. 范围

### FR-1 Catalog 驱动通用创建

新增统一 `createWidget` 操作：

- `type`
- `tempRef`
- `parent`
- `position`
- `label/name`
- `optionOverrides`

type 必须来自当前 Catalog，不再由 `widgetTypeSchema` 手写枚举作为第二真源。

### FR-2 普通字段覆盖

本版本至少覆盖所有不要求复杂子树的用户可见字段：

`input`、`textarea`、`number`、`radio`、`checkbox`、`select`、`cascader`、`date`、`date-range`、`time`、`time-range`、`switch`、`rate`、`color`、`slider`、`static-text`、`html-text`、`button`、`divider`、`rich-editor`。

上传组件和重型容器延后至 v0.12。

### FR-3 语义别名

组件语义字典必须覆盖中文业务称呼与 type，例如：

- 计数器/数字输入 → `number`
- 多选题 → `checkbox`
- 星级评分 → `rate`
- 日期区间 → `date-range`
- 说明文字 → `static-text`

有多个合理 type 时调用 v0.10 Ask-before-act。

### FR-4 结构 + JS 同一事务

处理顺序固定为：

1. 编译结构候选；
2. 为每个 `tempRef` 分配稳定 id/name；
3. 在候选树上解析 handler target；
4. 校验事件键和 API；
5. 运行 scenarios；
6. 用户确认后原子写入。

任一步失败则结构和事件均不写。

### FR-5 属性与事件真源

- 默认 options 从 Catalog 克隆；
- optionOverrides 经 writable/applicable/constraint/linkage 校验；
- eventKey 按组件实际事件能力校验；
- 未在 Catalog 登记的属性不得静默写入；
- 生成 JS 继续禁止网络请求。

### FR-6 普通组件预览

场景执行器扩展到普通组件的输入、选择、清空、日期/时间、开关、评分、滑块、文本展示等动作和观测。

## 3. 非目标

- data-table、tree、sub-form、grid-sub-form 等复合组件；
- vf-dialog/vf-drawer 和 runtime extension；
- 上传、远程数据源；
- 网络 JS；
- 任意跨容器移动已有控件。

## 4. 验收标准

1. Catalog 普通字段创建覆盖矩阵全部通过。
2. `grid/grid-col` 白名单与实际创建能力漂移被消除：要么提供 op，要么从本版本声明中移除。
3. “每个 tab 末尾加 number 并实时汇总”在一句话中完成候选、预览和原子写入。
4. 新增组件可以被同批 handler/scenario 使用。
5. type 别名歧义进入结构化澄清，不得猜错后静默降级。
6. 未知 type、非法 parent、非法属性、非法事件均诚实失败。
7. v0.10 风险治理及 v0.9 交互回归通过。

## 5. 风险

- 组件事件差异大：Catalog 增加 create/interaction capability 元数据。
- Prompt 过大：按语义检索注入候选类型，不注入全部 options。
- 模型直接构造错误 JSON：结构操作由编译器从 Catalog defaults 生成。
- type 名称与产品叫法不一致：别名注册与歧义澄清双保险。
