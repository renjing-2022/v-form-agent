# 技术设计：v-form AI 组件知识库与厚 P1 优化（v0.3.0）

| 项 | 内容 |
|---|---|
| 文档 ID | `ai-form-widget-catalog-refine-design` |
| 类型 | technical-design |
| 目标版本 | `v0.3.0` |
| 关联 PRD | `docs/requirements/ai-form-widget-catalog-refine.md` |
| 关联 OpenSpec | `ai-form-widget-catalog-refine` |

## 1. 设计目标

在保持 v0.2.0 refine 主链路（规划 → 合入 → 校验 → 确认覆盖）不变的前提下，补齐：

1. 以 `widgetsConfig.js` 为真源的 **Widget Catalog**；
2. 按类型的 **常见属性可写集合** 与合入；
3. **受控 `formConfig.cssCode`**（及必要 `customClass`）；
4. 更强的 **控件定位摘要**。

不把自由事件 JS、重型容器深改纳入本版实现范围。

## 2. 总体架构

```text
[ widgetsConfig.js + form 默认配置 ]
        |  生成 / 同步（构建或脚本）
        v
[ Agent Widget Catalog（机器可读） ]
        |
[ AiChat ] -- instruction + messages + getFormJson() --> [ refine ]
        | 1) 从 currentFormJson 建定位摘要
        | 2) 按命中 type 注入 Catalog 片段
        | 3) 模型输出受限 RefinePlan（含属性 patch / css 操作）
        | 4) 代码合入 + 可写键/CSS 护栏 + 结构校验
        v
[ summary, warnings[], formJson ] -> 用户确认 -> loadFormJson
```

### 关键原则

1. **规范在 Catalog，执行在代码**；禁止未校验的模型完整 formJson 直写画布。
2. **按需注入**：只向 LLM 提供本轮相关 type 的可写键与形状，控制上下文。
3. **厚 P1**：属性覆盖与受控 CSS 同版交付；事件与重型容器后置。
4. **FR-6 延续**：有 CSS 后仍禁止改字冒充样式。

## 3. Catalog 形态（建议）

每个控件条目至少包含：

| 字段 | 含义 |
|---|---|
| `type` | 与 widgetsConfig 一致 |
| `category` | field / container / … |
| `structure` | 嵌套键（widgetList / tabs / cols 等） |
| `defaultOptions` | 默认 options 形状 |
| `writableKeys` | 本版允许 NL 改写的 options 键 |
| `forbiddenKeys` | 至少含 on* 事件与明确禁写项 |
| `notes` | 枚举或约束提示（可选） |

form 级：`formConfig` 可写键含受控 `cssCode`、`customClass` 等（以实现清单为准）。

同步策略：脚本从 `widgetsConfig.js` 抽取生成 Catalog 产物；CI 或本地校验「Catalog 与源文件哈希/类型集合」一致（实现阶段定具体命令）。

## 4. RefinePlan 扩展（方向）

在既有 op（`updateField` / `setFormula` / `addField` / `wrapInTabs`）上：

- **扩展 `updateField.patch`**：键必须 ∈ 目标 type 的 `writableKeys`；
- **新增或扩展 form 级 op**（名称实现时定）：如 `patchFormConfig` / `setCssCode`，写入受控 CSS；
- 可选：`setCustomClass` 绑定控件 class 与 cssCode 选择器。

Schema（Zod）与 Merger、Validator 同步收紧；未知键拒绝或 strip + warning（产品偏好在 propose 时定一）。

## 5. cssCode 护栏（最低要求）

- 最大长度上限；
- 拒绝明显危险片段（如 `@import`、`expression(`、`javascript:` 等，清单实现时固化）；
- 优先与 `customClass` / 控件 name 关联的选择器；过于宽泛的全局选择器可 warning；
- 校验失败：不返回可应用 formJson 或标记不可应用并保留原画布路径。

## 6. 定位摘要

相对 v0.2.0 仅 `id/name/label/type`：

- 增加稳定 path 或父容器线索（若实现成本可控）；
- 对指令中提及的控件，可附带当前关键 writable options 快照，减少「瞎猜现值」。

## 7. API 与前端

- 继续以 `POST /api/agent/v1/refine` 为主；请求/响应外壳可保持兼容，扩展 plan 语义；
- AiChat：warnings 展示 CSS/属性降级原因；确认文案仍标明整表覆盖；
- 密钥仍仅服务端。

## 8. 测试与验收设计（候选）

1. Catalog 与 widgetsConfig 类型集合一致性检查；
2. 属性：至少 2 个不同类型的常见键 NL → 确认写回；
3. 非法/禁写键被拦截；
4. 样式：重叠类指令 → cssCode 或属性路径，且文案不变（FR-6）；
5. P0 回归：生成、tab/options/formula、显式改文案。

具体 case-id 在 OpenSpec `tasks.md` / E2E case-map 中落地（propose 阶段）。

## 9. 明确不做

- 自由事件脚本主路径；
- 未纳入本版结构手术的重型容器深改；
- 服务端会话；OCR。
