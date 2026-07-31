# SVN Workbench 扩展测试记录：56 PASS

日期：2026-07-05

阶段：开发 -> 测试

## 本轮验证目标

验证提交页新增 AI 决策过滤、接受 AI 推荐、恢复默认选择后，提交候选、AI 文件筛选、安全边界、提交说明、团队规则、更新流程和冲突中心没有回归。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过。
- VS Code 扩展测试：56 PASS。
- npm 安全审计：0 vulnerabilities。

## 本轮新增测试

### 1. returns AI recommended commit candidate paths

验证 `接受 AI 推荐` 的核心规则：

- 只返回 AI 推荐文件。
- 默认排除文件即使被模型误判推荐，也不会进入推荐勾选路径。

### 2. filters commit candidates by AI decision

验证 AI 决策筛选器的基础规则：

- 可以筛选 `needsReview / 待确认`。
- 可以筛选 `none / 未分析`。
- `all / 全部` 保留完整候选列表。

### 3. restores default selected commit candidate paths

验证 `恢复默认` 的核心规则：

- 只返回本地默认 `selected / 已选` 的候选文件。
- 不受 AI 解释结果影响。

## 当前完整测试覆盖

当前 56 个扩展测试覆盖：

- 扩展激活与命令注册。
- SVN 状态刷新。
- Quick Diff BASE 内容读取。
- 生成物识别与提交过滤。
- 右键文件夹范围和多选范围边界。
- 根目录与文件夹提交候选收集。
- AI 提交文件筛选请求、本地回退、越权和幻觉路径拦截。
- AI 筛选解释映射、未分析状态、AI 决策过滤和批量选择动作。
- AI Provider 预设、模型列表、场景模型路由。
- AI 团队规则推荐请求、本地推荐和模型结果归一化。
- 提交页打开、提交计划预览、提交前远端更新检查。
- 提交说明模板、团队规范、仓库级团队配置。
- 团队规则可视化配置页的输入归一化、校验和保存策略。
- AI 提交说明生成、轻量 diff 摘要、模板补全。
- 当前范围更新预览。
- SVN 冲突解析、冲突中心、AI 冲突建议、标记解决预览。

## 结论

AI 文件筛选已经从“给出推荐”推进到“可解释、可过滤、可接受、可回退”的提交页闭环。

本轮验证显示新增交互没有破坏现有提交、更新、冲突和团队规则能力。
