# SVN Workbench AI 拆分队列预览阻止原因展示

日期：2026-07-05
阶段：开发
整体进度：约 70%

## 背景

拆分队列已经支持批量预览、只看需处理和定位第一条阻止项。用户进入需处理视图后，还需要知道每个队列项为什么被阻止。本轮把预览阻止原因保存到队列项，并直接展示在队列项摘要里。

## 本轮新增

每个拆分队列项在预览后会保存：

- 阻止项数量；
- 阻止项路径；
- 阻止项原因。

当队列项存在阻止原因时，队列卡片会展示“预览阻止项”：

- 最多展示前 3 条；
- 每条包含文件路径和原因；
- 超过 3 条时展示剩余数量。

## 安全策略

预览阻止原因只在当前有效预览后保存。

以下场景会清空旧原因：

- 提交成功后刷新队列；
- 恢复草稿；
- 重开提交页后的草稿恢复。

原因是工作副本和候选文件状态可能已经变化，旧阻止原因不应被当成最新判断。

## 技术实现

队列项新增字段：

- `lastPreviewIssues?: CommitSplitQueuePreviewIssue[]`

新增接口：

- `CommitSplitQueuePreviewIssue`

队列状态更新：

- `updateCommitSplitQueueItemPreviewStatus` 会把 `preview.issues` 写入 `lastPreviewIssues`。
- `refreshCommitSplitQueueAfterCommit` 会清空 `lastPreviewIssues`。

提交页 webview：

- `updateSplitQueuePreviewStatus` 会把预览结果中的 issue 写入队列状态；
- `formatQueuePreviewIssues(item)` 负责队列卡片中的阻止项摘要；
- 恢复草稿、加入队列、提交后刷新时清空旧 issue。

草稿恢复：

- `sanitizeCommitSplitQueueDraftItems` 会清空 `lastPreviewIssues`，恢复后必须重新预览。

## 用户价值

用户在“只看需处理”视图里不需要再反复查看底部预览面板，可以直接在每条拆分队列项上看到阻止原因，处理顺序更明确。

## 下一步

后续可以继续推进：

- 阻止项汇总面板；
- 按阻止原因类型分组；
- AI 解释阻止原因；
- AI 修正拆分建议中的失效路径；
- 一键重新预览当前需处理项。
