# 验收题库

| 项 | 内容 |
|---|---|
| 状态 | **已审阅**（用户 2026-09-23 确认；可继续增删改） |
| 说明 | 题库是验收下限，不是能力上限。更复杂的真实需求通过多轮对话澄清后，由模型直接写 JS |

每条需求在固定 fixture 表单上执行。正例须全部 applied 且场景全部真实通过；负例须不可 apply、画布不变。

## Fixture 表单

| fixture | 内容 |
|---|---|
| `F-wizard` | tab1「基本信息」：姓名（必填）、手机号（必填）；tab2「工作信息」：公司、职位（必填）；tab3「确认」：备注 |
| `F-order` | 数量、单价、金额、折扣、实付；类型（单选：个人/企业/其他）、其他说明；开始日期、结束日期；预算 |
| `F-detail` | 子表「明细」：品名、单价、数量、小计；主表：合计、备注；弹窗「帮助」 |

## 正例

| id | 能力 | fixture | 自然语言描述 | 关键自动场景 |
|---|---|---|---|---|
| `nl-wizard-next` | C2 | F-wizard | 在每个 tab 下新增一个「下一页」按钮，点击时校验当前 tab 的字段，通过则跳到下一个 tab，失败则定位到第一个出错的字段 | 空必填停在本页并聚焦首个错误字段；填齐跳下一页；末页无下一页按钮或不越界 |
| `nl-wizard-prev-next` | C2 | F-wizard | 给每页加上一页和下一页，第一页不要上一页，最后一页不要下一页 | 按钮分布正确；上一页不校验直接回退 |
| `nl-wizard-submit-locate` | C2 C5 | F-wizard | 最后一页加一个提交按钮，提交时校验整个表单，不通过就切到出错字段所在的页并聚焦 | 错误在 tab1 时从 tab3 提交跳回 tab1 并聚焦 |
| `nl-amount-calc` | C1 | F-order | 数量或单价变化时，金额等于数量乘以单价；实付等于金额减折扣 | 两组输入下金额、实付正确 |
| `nl-other-required` | C1 | F-order | 类型选「其他」时显示其他说明并设为必填，否则隐藏且不必填 | 选其他：可见+必填；选个人：隐藏+非必填 |
| `nl-disable-when-empty` | C1 | F-order | 单价为空时禁用折扣 | 空→禁用；有值→可用 |
| `nl-date-range-validate` | C5 | F-order | 提交前检查结束日期不能早于开始日期 | 违反→校验失败；满足→通过 |
| `nl-budget-validate` | C5 | F-order | 提交前实付不能超过预算，超过就提示并定位到实付 | 超预算→失败且焦点在实付 |
| `nl-reset-button` | C3 | F-order | 加一个「重置」按钮，点击清空所有字段 | 填值后点击全部为初始值 |
| `nl-fill-default` | C3 | F-order | 加一个「填入示例」按钮，把数量设为1、单价设为100 | 点击后值正确，金额联动（若同时存在 C1） |
| `nl-open-help` | C3 | F-detail | 加一个「帮助」按钮，点击打开帮助弹窗 | 点击后弹窗可见 |
| `nl-subform-row-calc` | C4 | F-detail | 明细里小计等于单价乘数量，合计等于所有小计之和 | 两行数据下小计与合计正确 |
| `nl-subform-default` | C4 | F-detail | 明细新增行时数量默认为1 | 增行后新行数量为1 |
| `nl-init-defaults` | C6 | F-order | 打开表单时类型默认选个人，折扣默认0，并默认禁用实付 | 装载后值与禁用状态正确 |
| `nl-init-active-tab` | C6 | F-wizard | 打开表单时默认停在第二页 | 装载后当前 tab 为 tab2 |

## 负例

| id | fixture | 描述 | 期望 |
|---|---|---|---|
| `nl-neg-api` | F-order | 手机号填完后调用接口查询客户信息并回填 | unsupported（接口），不可 apply |
| `nl-neg-submit-api` | F-wizard | 点提交时把表单数据发到后端保存 | unsupported（网络请求），不可 apply |
| `nl-neg-upload` | F-detail | 加一个上传附件按钮 | unsupported（上传），不可 apply |
| `nl-neg-ambiguous` | F-order | 改一下那个字段的联动 | need_clarification，给出定向问题 |
| `nl-neg-partial` | F-order | 金额自动计算，并且保存时调用接口 | 核心意图含不支持项 → 整体不可 apply，说明原因 |
| `nl-structure-only` | F-order | 把备注改成多行文本 | route_refine，结果与 `/refine` 一致 |

## 真实 DeepSeek 冒烟子集

`nl-wizard-next`、`nl-amount-calc`、`nl-other-required`、`nl-date-range-validate`、`nl-subform-row-calc`、`nl-neg-api`。
