# SVN Workbench AI 拆分队列批量预览结果摘要与阻止项定位

日期：2026-07-05
阶段：开发
整体进度：约 68%

## 背景

批量重新预览已经可以展示进度，但完成后只告诉用户“已回填多少项”。实际提交拆分队列时，用户更关心下一步怎么处理：哪些可以提交，哪些需要先处理，第一条阻止项在哪里。

本轮补上批量预览完成后的结果摘要和第一条阻止项定位。

## 本轮新增

批量重新预览全部完成后，提交页会展示：

- 已回填总数；
- 可提交数量；
- 需处理数量；
- 未回填数量；
- 第一条需处理队列项标题。

如果存在需处理队列项，页面会：

- 自动把队列过滤器切回“全部”；
- 取消隐藏已完成；
- 滚动到第一条 `blocked` 队列项；
- 给该队列项短暂高亮边框，便于用户直接定位。

## 技术实现

队列逻辑模块新增：

- `CommitSplitQueueBulkPreviewResultSummary`
- `summarizeCommitSplitQueueBulkPreviewResult(queue, ids)`

该函数根据本次批量预览的队列项 id 统计：

- `ready`
- `blocked`
- `notPreviewed`
- `firstBlockedId`
- `firstBlockedTitle`

提交页 webview 新增：

- `summarizeCompletedSplitQueueBulkPreviewResult(ids)`
- `formatBulkPreviewCompletionDetail(summary)`
- `focusSplitQueueItem(id)`
- 队列项 `data-queue-item-id`
- `.split-queue-item.focused` 高亮样式

## 交互策略

1. 批量预览进行中，进度条持续展示。
2. 每个预览结果回填后更新队列项状态。
3. 最后一项回填后，生成结果摘要。
4. 如果全部可提交，只提示可提交数量。
5. 如果存在阻止项，优先引导用户处理第一条阻止项。
6. 用户处理阻止项后，可以再次点击“重新预览全部”。

## 安全说明

该能力只改变页面展示和定位，不自动套用、不自动提交、不自动解决阻止项。提交仍然需要用户逐项预览确认后手动提交。

## 下一步

后续可以继续推进：

- 阻止项列表面板；
- 一键只看预览阻止项；
- AI 解释每条阻止项如何修复；
- AI 自动修正拆分建议中的失效路径；
- 批量预览取消与并发限制。
