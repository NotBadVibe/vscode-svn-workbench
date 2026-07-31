# SVN Workbench AI 拆分队列批量预览进度

日期：2026-07-05
阶段：开发
整体进度：约 67%

## 背景

上一轮提交页已经支持“重新预览全部”，但用户点击后只能看到请求已发起，无法判断有多少拆分项已经完成回填。本轮补上批量预览进度，让 AI 拆分队列在处理多个提交建议时更可控。

## 本轮新增

提交页在发起批量重新预览后，会在拆分队列顶部显示进度区域：

- 显示“批量重新预览中”；
- 显示已完成数量；
- 显示总数量；
- 显示剩余数量；
- 使用进度条展示当前完成比例；
- 每个拆分项预览结果回填时自动刷新进度；
- 全部回填后自动关闭进度区域，并提示“批量预览完成”。

## 状态规则

批量预览状态只保存在当前 webview 会话内，不写入草稿。

原因：

- 它表示一次临时操作进度，不是业务数据；
- 关闭页面后后台不会继续执行 webview 发出的批量预览；
- 重开页面后应重新发起预览，而不是恢复一个过期进度。

## 技术实现

队列逻辑模块新增：

- `CommitSplitQueueBulkPreviewState`
- `CommitSplitQueueBulkPreviewSummary`
- `createCommitSplitQueueBulkPreviewState(queue, now)`
- `completeCommitSplitQueueBulkPreviewItem(state, id)`
- `summarizeCommitSplitQueueBulkPreview(state)`

提交页 webview 新增：

- `splitQueueBulkPreview` 页面状态；
- `summarizeSplitQueueBulkPreview()`；
- `renderSplitQueueBulkPreviewProgress(summary)`；
- `completeSplitQueueBulkPreviewItem(id)`。

## 交互细节

1. 用户点击“重新预览全部”。
2. 页面收集所有可重新预览的队列项。
3. 页面创建批量预览状态，记录本次要回填的队列项 id。
4. 页面逐项发送 `previewCommitSplitPlan`。
5. 每个 `commitSplitPlanPreview` 回来后，队列项更新为 `ready` 或 `blocked`。
6. 如果该队列项属于当前批量预览，进度完成数加一。
7. 所有队列项完成后，进度状态清空，页面展示完成反馈。

## 安全策略

- 已完成项不参与批量预览；
- 提交中项不参与批量预览；
- 批量预览进行中，“重新预览全部”按钮禁用，避免重复发起；
- 清空队列、丢弃草稿、刷新候选后，会清空批量预览状态。

## 下一步

后续可以继续推进：

- 批量预览失败项计数；
- 批量预览取消；
- 批量预览并发限制；
- 自动聚焦第一条 `blocked` 队列项；
- 结合当前工作副本状态展示“哪些文件变更导致预览阻止”。
