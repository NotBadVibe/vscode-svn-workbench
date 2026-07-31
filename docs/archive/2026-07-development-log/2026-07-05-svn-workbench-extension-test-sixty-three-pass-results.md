# SVN Workbench 扩展测试记录：63 PASS

日期：2026-07-05

阶段：开发 -> 测试

## 本轮验证目标

验证 AI 拆分提交建议接入后，提交页、AI 场景模型配置、OpenAI-compatible Provider、路径安全校验、提交说明、更新流程、冲突中心和团队规则没有回归。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过。
- VS Code 扩展测试：63 PASS。
- npm 安全审计：0 vulnerabilities。

## 本轮新增测试

### 1. builds commit split AI request from selected candidates

验证拆分提交 AI 请求：

- 使用当前已选候选文件。
- 带上模块分组。
- 带上 noAutoCommit 策略。
- 使用 `zh-CN`。

### 2. creates local commit split suggestions

验证本地 fallback：

- 可以按模块生成多组拆分建议。
- 可以生成提交说明草稿。
- 删除/缺失文件会进入风险提示。

### 3. validates commit split suggestion paths

验证模型结果安全校验：

- 真实候选路径保留。
- 相对路径可解析为仓库内真实候选。
- 重复路径去重。
- 虚构路径丢弃。
- 范围外路径丢弃。

## 当前完整测试覆盖

当前 63 个扩展测试覆盖：

- 扩展激活与命令注册。
- SVN 状态刷新。
- Quick Diff BASE 内容读取。
- 生成物识别与提交过滤。
- 右键文件夹范围和多选范围边界。
- 根目录与文件夹提交候选收集。
- AI 提交文件筛选请求、本地回退、越权和幻觉路径拦截。
- AI 筛选解释映射、未分析状态、AI 决策过滤和批量选择动作。
- 提交候选按模块、AI 决策和默认策略统计分组。
- 分组级可选路径安全规则。
- AI 拆分提交请求、本地建议和路径校验。
- AI Provider 预设、模型列表、场景模型路由。
- AI 团队规则推荐请求、本地推荐和模型结果归一化。
- 提交页打开、提交计划预览、提交前远端更新检查。
- 提交说明模板、团队规范、仓库级团队配置。
- 团队规则可视化配置页的输入归一化、校验和保存策略。
- AI 提交说明生成、轻量 diff 摘要、模板补全。
- 当前范围更新预览。
- SVN 冲突解析、冲突中心、AI 冲突建议、标记解决预览。

## 结论

提交页已经具备“选择文件 -> AI 筛选 -> 分组操作 -> AI 拆分提交 -> 套用单组提交说明”的主流程雏形。

AI 仍只负责建议，提交动作继续由本地校验和用户确认控制。
