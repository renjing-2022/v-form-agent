# 技术设计：Truth Strict 全量收敛 + Refine 删/排/复制（v0.5.0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-truth-strict-refine-structure-design` |
| 类型 | technical-design |
| 目标版本 | `v0.5.0` |
| 关联 PRD | `docs/requirements/ai-form-truth-strict-refine-structure.md` |
| 关联 OpenSpec | `ai-form-truth-strict-refine-structure` |

## 1. 设计目标

在 v0.4 DesignTruthGraph + IntentGate 基线上：

1. **A2 strict**：全部 `applicableKeys` / form `writableKeys` → Catalog `constraints` 带 `valueKind` + `strict: true`（有 enum 则 enum）；
2. **结构 op 子集**：`removeField` / `removeFieldsInScope` / `reorderField` / `duplicateField`；
3. **不 reparent、不扩 create**；E2E mock-only。

## 2. Truth Strict 编译与校验

### 2.1 收敛规则

```text
对每个 (scope, type, prop) where applicable:
  1. resolveEffectiveEditorName → editorGraph.editors[name]
  2. valueKind := editor.valueKind ?? policy override ?? FAIL (known-gap)
  3. enum := editor.enum ?? policy enum ?? omit
  4. constraint.strict := true
  5. 禁止仅 widgetsConfig 出厂 typeof 作为唯一依据
```

### 2.2 catalog:check 扩展

- 新增 `checkCatalogFullStrictSweep(catalog, graph)`：
  - 遍历全部 applicable 键；
  - 断言 `constraints[prop].valueKind` 非空且 `strict === true`；
  - enum 键断言 `enumsEqual`；
  - 失败输出 `(scope, type, prop, reason)` 列表 → `known-gap` 输入。
- 保留 v0.4 `catalog-sample-parity` 作回归，**release 门槛以 full sweep 为准**。

### 2.3 Validator

- `sanitizeWidgetPatch` / `sanitizeFormPatch`：applicable + strict 键非法 → strip + warning；IntentGate 聚合 → 422；
- generate / refine / Excel 路径不变，共用入口。

## 3. RefinePlan 扩展

### 3.1 Schema（草案）

```typescript
// removeField
{ op: 'removeField', target: TargetRef }

// removeFieldsInScope
{ op: 'removeFieldsInScope', parent: TargetRef, filterType?: string }

// reorderField — 同级 only
{ op: 'reorderField', target: TargetRef, position:
    | { kind: 'first' | 'last' }
    | { kind: 'before' | 'after', sibling: TargetRef }
}

// duplicateField
{ op: 'duplicateField', target: TargetRef, position?: same as reorderField }
```

### 3.2 Merger 行为

| op | 实现要点 |
|---|---|
| `removeField` | 复用 `extractTargetsFromTree`；**tab-pane** 删除时不提升子节点，整棵子树移除 |
| `removeFieldsInScope` | `resolveScopeFields` + 逐个 remove |
| `reorderField` | 定位 parent list + index；仅 splice 同级；不调用 cross-container move |
| `duplicateField` | `structuredClone` + `regenerateIdsAndNames(subtree)`；对齐 `designer.copyNewFieldWidget`（新 id、name=id 或 slug） |

### 3.3 删除 tab-pane 语义（产品锁定）

```text
removeField(target=tab-pane) =>
  从 parent.tabs 移除该 pane
  pane.widgetList 内控件不保留、不提升
```

与 `designer.deleteTabPaneOfTabs` 行为对齐（需读源码确认无 orphan 提升）。

### 3.4 duplicateField 与 designer 对齐

参考 `designer.js`：

- `copyNewFieldWidget`：新 id、`options.name = newWidget.id`、保留 label；
- 容器：`copyNewContainerWidget` 递归新 id；
- Agent merger 必须 **递归 regenerate** 子树 id/name，避免 duplicate id 触发 `preApplyFormJsonGate`。

### 3.5 NON_GOAL 守卫

- `table` / `table-cell` / `data-table` 内部删排 → container policy reject；
- `moveField` / reparent：**schema 不提供**，Planner 提示用 reorderField 仅限同级。

## 4. IntentGate 扩展

- `planStructureOpsAllFailed`：remove/reorder/duplicate 全部未生效 → 422；
- strict sweep strip 与用户提及键交集非空 → 422；
- summary 机器描述：「已删除 N 个」「已复制」「已调整顺序」。

## 5. Planner 提示

- 明确：**不能**跨 tab/grid 移动；需用户先删再加或手动；
- duplicate 会生成新 name/id；
- 删 tab 会删除页内全部字段。

## 6. 测试设计

| case-id | 类型 | 说明 |
|---|---|---|
| `catalog-full-strict-sweep` | agent/static | 全 applicable strict |
| `catalog-known-gap-report` | agent/static | gap 清单格式（若 sweep 有 gap） |
| `refine-remove-field-by-label` | agent/playwright | 单字段删除 |
| `refine-remove-tabpane-cascade` | agent/playwright | tab-pane + 子控件一并删 |
| `refine-reorder-sibling` | agent/playwright | 同级 before/after |
| `refine-duplicate-field` | agent/playwright | 复制 + 新 id 可见 |
| `refine-structure-ambiguous-reject` | agent | 歧义 delete → 422 |
| `refine-v04-regression` | agent/playwright | v0.4 高精度回归 |
| `frontend-no-secret` | static | 安全边界 |

E2E：`EVIDENCE_VERSION=v0.5.0`，`AGENT_ALLOW_MOCK=1`。

## 7. 非本版技术范围

- reparent / moveField；
- create 白名单扩展；
- 事件执行；extension 静态全覆盖；
- 真 LLM 必选 case。

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| A2 暴露大量 gap | known-gap 文件 + 分波修复；DoD 允许 signed gap 仅当 PRD 明确 |
| duplicate 子树 id 冲突 | 递归 regenerate + preApply gate |
| reorder 首末边界 | 对齐 designer moveUp/moveDown hint 语义 |
