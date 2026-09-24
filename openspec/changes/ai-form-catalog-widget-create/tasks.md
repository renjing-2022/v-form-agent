# Tasks: ai-form-catalog-widget-create

仅在实现与对应检查完成后勾选。

## 1. Catalog 创建真源

- [ ] 增加 createKind、allowedParents、eventKeys、previewCapabilities
- [ ] 建立中文语义别名注册与漂移检查
- [ ] 明确 standalone/internal/composite/extension 分类
- [ ] 修复 grid/grid-col 白名单与实际 op 漂移

## 2. 统一创建操作

- [ ] 定义 createWidget/tempRef/parent/position schema
- [ ] generate/refine/interaction 复用同一创建编译器
- [ ] 从 Catalog defaults 构造节点并消毒 optionOverrides
- [ ] 实现确定性 id/name 与同事务临时引用解析
- [ ] 未知 type、非法 parent、非法属性均拒绝

## 3. 普通组件覆盖

- [ ] 基础文本、数字、选项字段
- [ ] 日期/时间及范围字段
- [ ] switch/rate/color/slider
- [ ] static-text/html-text/divider/rich-editor
- [ ] button 与现有 addButton 兼容迁移

## 4. 混合事务和预览

- [ ] 候选结构完成后再绑定 handlers
- [ ] 事件键按组件能力校验
- [ ] 扩展 scenario act/assert 普通组件矩阵
- [ ] 结构、事件、验证、确认原子写入
- [ ] 保持生成 JS 禁网

## 5. 验收

- [ ] 全普通字段 create matrix
- [ ] 中文别名与歧义 Ask-before-act
- [ ] 每 tab 新建 number + radio 求和 JS E2E
- [ ] 新组件引用与 rollback 负例
- [ ] v0.10/v0.9/v0.8 回归
- [ ] DeliveryGuard acceptance 全证据收口
