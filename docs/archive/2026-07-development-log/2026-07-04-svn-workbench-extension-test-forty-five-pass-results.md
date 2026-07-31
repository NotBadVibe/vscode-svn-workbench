# SVN Workbench 扩展测试记录：45 PASS

日期：2026-07-04

阶段：开发 -> 测试

## 本轮验证目标

验证团队规则可视化配置页接入后，仓库级配置、提交页、AI 提交说明、冲突中心和更新流程没有回归。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过。
- VS Code 扩展测试：45 PASS。
- npm 安全审计：0 vulnerabilities。

## 本轮新增测试

### 1. normalizes visual team config form input

验证表单输入会被规范化：

- 支持英文逗号、中文逗号、分号和换行。
- 自动去掉空项。
- 自动去重。
- 工单号正则会去除前后空格。

### 2. validates visual team config before saving

验证保存前校验：

- 启用前缀校验但前缀为空时阻止保存。
- 启用模块校验但模块为空时阻止保存。
- 启用工单号校验但正则非法时阻止保存。
- 团队规范关闭时不强制校验这些字段。

### 3. updates team config while preserving other project config

验证保存 `.svn-workbench.json` 时：

- 只更新 `commitConvention`。
- 保留已有其他字段，例如未来的 `ai` 配置。
- 原文件不是合法 JSON 时会重建配置并给出提醒。

## 当前完整测试覆盖

当前 45 个扩展测试覆盖：

- 扩展激活与命令注册。
- SVN 状态刷新。
- Quick Diff BASE 内容读取。
- 生成物识别与提交过滤。
- 右键文件夹范围和多选范围边界。
- 根目录与文件夹提交候选收集。
- AI mock 筛选越权拦截。
- AI Provider 预设、模型列表、场景模型路由。
- 提交页打开、提交计划预览、提交前远端更新检查。
- 提交说明模板、团队规范、仓库级团队配置。
- 团队规则可视化配置页的输入归一化、校验和保存策略。
- AI 提交说明生成、轻量 diff 摘要、模板补全。
- 当前范围更新预览。
- SVN 冲突解析、冲突中心、AI 冲突建议、标记解决预览。

## 结论

团队规则配置从“手写 JSON”推进到“表单配置 + JSON 兜底”：

- 普通用户走可视化表单。
- 高级用户仍可直接打开 JSON。
- 团队规则继续跨 Windows 和 macOS 统一。
- 保存策略不会覆盖未来扩展字段。
