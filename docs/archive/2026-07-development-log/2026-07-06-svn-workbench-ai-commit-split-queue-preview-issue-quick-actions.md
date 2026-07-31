# SVN Workbench AI 拆分队列阻止原因快捷动作

日期：2026-07-06

阶段：开发 -> 测试

## 背景

拆分待提交队列已经具备阻止项汇总、原因分组、原因筛选和处理建议。本轮继续把建议推进为可点击动作，让用户可以在同一个面板里完成下一步处理。

## 新增能力

位置：提交页面 -> 拆分待提交队列 -> 需处理阻止项汇总 -> 处理建议。

新增快捷动作：

1. 刷新候选并重预览此原因。
2. 打开冲突中心。
3. 重新生成拆分建议。
4. 查看具体阻止项。

## 动作规则

### 刷新候选并重预览此原因

适用原因：

- 范围不匹配
- 候选列表缺失
- 规则排除
- 阻止状态
- SVN 状态不支持
- 空选择
- 其他原因

执行流程：

1. 前端收集当前原因下可重预览的拆分队列项。
2. Webview 向扩展宿主发送 `refreshCommitCandidatesForSplitQueue`。
3. 扩展宿主刷新 SVN 状态并重新采集提交候选文件。
4. Webview 保留拆分队列，但重置非完成项的预览状态。
5. Webview 自动批量重预览刚才匹配的队列项。
6. 预览结果逐项回填，并继续走原有批量预览完成提示。

安全边界：

- 不自动提交。
- 不自动 add/remove/revert/resolved。
- 不自动修改文件内容。
- 不自动修改团队规则。

### 打开冲突中心

适用原因：

- 阻止状态
- SVN 状态不支持

执行流程：

1. Webview 向扩展宿主发送 `openConflictCenterFromCommit`。
2. 扩展宿主调用现有 `svnWorkbench.openConflictCenter` 命令。
3. 冲突中心按当前仓库范围打开。

安全边界：

- 只打开冲突中心。
- 冲突处理仍由用户在冲突中心确认。
- AI 冲突建议仍是辅助决策，不自动覆盖文件。

### 重新生成拆分建议

适用原因：

- 范围不匹配
- 候选列表缺失
- 空选择

执行流程：

1. Webview 使用当前已选文件。
2. 向扩展宿主发送现有 `suggestCommitSplits`。
3. 扩展宿主按当前候选和团队规范生成新的 AI 拆分建议。

安全边界：

- 不直接替换队列。
- 新拆分建议仍需要用户手动加入队列。
- 后续仍需要预览计划通过后才能提交。

### 查看具体阻止项

适用原因：

- 规则排除
- 其他原因

执行流程：

1. 复用已有原因筛选。
2. 只显示该原因匹配的拆分队列项和阻止详情。

## 核心模型

新增类型：

- `CommitSplitQueuePreviewIssueQuickActionKind`
- `CommitSplitQueuePreviewIssueQuickAction`

扩展类型：

- `CommitSplitQueuePreviewIssueCategoryAction.quickActions`

当前快捷动作类型：

- `refreshAndRepreview`
- `openConflictCenter`
- `regenerateSplit`
- `manualReview`

## 页面交互

处理建议面板现在展示快捷动作按钮：

- 点击“刷新候选并重预览此原因”后，按钮不会立即修改提交选择，而是刷新候选并重预览匹配队列项。
- 点击“打开冲突中心”后，打开当前仓库范围的冲突中心。
- 点击“重新生成拆分建议”后，基于当前已选文件重新生成建议。
- 点击“查看具体阻止项”后，保留在当前原因筛选视图。

## 跨平台说明

该功能复用 VS Code Webview 消息、VS Code 命令和现有 SVN CLI 采集逻辑，不依赖 Windows 或 macOS 专有 API。

## 验证

已通过：

- `npm.cmd run compile`
- `npm.cmd run test:extension`
- `npm.cmd audit`

新增测试：

- `returns quick actions for commit split queue preview issue reasons`

