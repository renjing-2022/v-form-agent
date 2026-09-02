# Issue：样式诉求不得通过改表单文案规避

| 项 | 内容 |
|---|---|
| 文档 ID | `refine-no-text-for-style` |
| 类型 | issue-report |
| 关联版本 | `v0.2.0`（及后续 refine 能力） |
| Repair Case | `.deliveryguard/repairs/refine-text-style-workaround.json` |
| 分类 | 规划器行为 / 需求缺口（P0 无 CSS） |

## 现象

用户用自然语言描述**样式或布局**问题（例如「标签和选项重叠」「间距太小」「字体太大」）时，LLM 有时会选择 `updateField` 修改 `label`、`textContent` 或 `optionItems` 的文案，使界面「看起来」问题消失，而不是：

- 说明 P0 不支持 CSS/布局自动修复；或
- 通过结构、options 配置、公式等**允许**的路径解决。

## 期望

1. **默认禁止**：在用户未明确要求改文案/改选项时，refine 规划**不得**改动字段 `label`、`textContent`、选项 `label` 等展示文字。
2. **允许改文案的唯一条件**：用户话术**明确**表达要改文字/标题/选项文案/描述（例如「把标题改成…」「选项文字缩短」）。
3. **样式类诉求**：应返回 `warnings` 说明 P0 不支持自由 CSS；**不得**用改字充当样式修复。
4. **仍允许**：结构变更（tab/grid）、业务向 options（分值/选项 value）、公式、required 等非「偷换样式」的变更。

## 实现落点

| 层 | 位置 |
|---|---|
| 产品规范 | `docs/requirements/ai-form-multiturn-refine.md` → FR-6 |
| 技术规范 | `docs/design/ai-form-multiturn-refine.md` → § 规划器文案策略 |
| Planner 提示词 | `agent/src/services/refinePlanner.ts` |
| 代码兜底 | `agent/src/services/refineTextPolicy.ts`（`enforceRefineTextPolicy`） |
| 回归 | `agent/scripts/acceptance-cases.ts` |

## 复现提示（人工）

1. 在设计器放入 label 较长的 radio 字段；
2. 对 AiChat 发送：「标签和选项重叠了，帮我优化一下样式」；
3. **修复前**：规划可能包含 `updateField.patch.label` 或改短 `optionItems[].label`；
4. **修复后**：上述 patch 被剔除并出现样式类 warning；或仅剩结构/公式类 op。
