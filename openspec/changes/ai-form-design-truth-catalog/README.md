# OpenSpec change: ai-form-design-truth-catalog

| 项 | 值 |
|---|---|
| Change ID | `ai-form-design-truth-catalog` |
| Target version | `v0.4.0` |
| Status | `ready`（OpenSpec 任务清单已勾选；DeliveryGuard acceptance passed；**release 仍 pending**） |

本目录为 DeliveryGuard 版本 `v0.4.0` 的 OpenSpec 挂载点。

## 产品硬门槛

1. Agent 知识库对 v-form **设计可配置面**的覆盖，应与查阅源码无本质差异；
2. 自然语言生成/优化结果，应与设计器手动操作达到**高精确度**一致（含值形态）；
3. **未落地不得报成功**（IntentGate + 前端诚实 UI）。

## 交付结构（见 `tasks.md`）

| 阶段 | 内容 |
|---|---|
| **v0.4.0-a** | DesignTruthGraph + 统一 Validator + IntentGate |
| **v0.4.0-b** | NL 归一/label 定位/tab 批量 + generate/Excel 同源 + Playwright + DeliveryGuard acceptance |

## 当前基线（2026-09-18）

- DesignTruthGraph 219 editors + Catalog 37 types + 50 抽样 parity + policy enum 收敛
- HIGH_PRECISION 形态门禁、IntentGate、三路径同源 Validator 已绿
- DeliveryGuard：`.deliveryguard/acceptance/v0.4.0/evidence.json` passed
- **未 release**：无生产部署锚点；运行时 extension widget 仍 NON_GOAL

## 关联文档

- `docs/requirements/ai-form-design-truth-catalog.md`
- `docs/design/ai-form-design-truth-catalog.md`
- `docs/acceptance/v0.4.0.md`
- `tasks.md` — **权威任务清单与 DoD**
