# Tasks: ai-form-composite-extension-create

仅在实现与对应检查完成后勾选。

## 1. 复合 schema

- [ ] 定义 composite/internal/runtime-extension 分类
- [ ] 为重型组件建立版本化最小模板
- [ ] 建立 allowedParents/requiredChildren/childSlots 约束
- [ ] 实现确定性子树 id/name 和冲突检查
- [ ] 打通 grid/grid-col 实际创建 op

## 2. 重型组件

- [ ] sub-form/grid-sub-form 创建与字段子节点
- [ ] data-table/tree 创建与列/节点配置
- [ ] object-group/button-group 创建
- [ ] vf-dialog/vf-drawer 创建
- [ ] tab/table/grid 及内部节点创建规则

## 3. 上传与远程

- [ ] file-upload/picture-upload 创建与 L2 风险确认
- [ ] 受管 upload/data-source reference schema
- [ ] 远程 options/tree/table 字段映射
- [ ] mock/fixture 预览隔离
- [ ] 凭据、生产写及生成 JS 网络调用负例

## 4. Runtime extension

- [ ] 定义 extension manifest 和 fingerprint
- [ ] 注册 slot、card、alert
- [ ] custom/chart 扩展发现与能力检查
- [ ] manifest 缺失、版本漂移、非法权限拒绝
- [ ] extension create/preview/assert 接口

## 5. 原子事务与验收

- [ ] 复合结构 + JS + scenarios 单事务
- [ ] internal type 无父创建负例
- [ ] 静态 Catalog 全 type 创建能力矩阵
- [ ] 上传/远程/runtime extension E2E
- [ ] v0.11/v0.10 回归
- [ ] DeliveryGuard acceptance 全证据收口
