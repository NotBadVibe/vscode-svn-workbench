# SVN Workbench AI 拆分队列草稿恢复交互

日期：2026-07-05
阶段：开发
整体进度：约 66%

## 背景

上一轮已经实现 AI 拆分提交队列草稿持久化。本轮把“能恢复”补成“用户能看懂、能处理”的页面交互，避免用户重新打开提交页后不知道队列从哪里来，也避免恢复后逐条手动点击重新预览。

## 本轮新增

提交页在恢复到未完成拆分队列时，会在队列顶部显示提示条：

- 提示“已恢复上次未完成的拆分队列”；
- 展示恢复项数量；
- 展示草稿保存时间；
- 明确说明恢复后需要重新预览再提交；
- 提供“重新预览全部”；
- 提供“知道了”；
- 提供“丢弃草稿”。

队列标题栏也新增“重新预览全部”按钮。即使不是从草稿恢复，只要队列中存在可重新预览的项，也可以批量触发预览。

## 批量重新预览规则

参与批量重新预览的队列项：

- `pending`：待处理；
- `applied`：已经套用、待提交；
- `failed`：提交失败后待处理。

不会参与批量重新预览的队列项：

- `completed`：已完成，避免重复干预；
- `submitting`：提交中，避免和正在执行的 SVN 操作交叉。

## 丢弃草稿规则

用户点击“丢弃草稿”时：

- 清空当前恢复出的拆分队列；
- 清空当前激活队列项；
- 立即持久化空草稿；
- 页面给出“已丢弃拆分草稿”的反馈。

用户点击“清空队列”时，也会同步关闭草稿恢复提示，避免出现空队列但仍提示恢复的状态。

## 技术实现

新增规则函数：

- `getRepreviewableCommitSplitQueueItems(queue)`

该函数位于：

- `src/commit/commitSplitQueue.ts`

提交页 webview 新增状态：

- `splitQueueDraftNoticeVisible`

提交页 webview 新增行为：

- `renderSplitQueueDraftNotice(summary, previewableCount)`；
- `formatDraftSavedAt(value)`；
- `getRepreviewableSplitQueueItems()`；
- `requestSplitQueueBulkPreview(items)`；
- `previewAll` 队列动作；
- `dismissDraftNotice` 队列动作；
- `discardDraft` 队列动作。

## 用户价值

这个改动让 AI 拆分提交从“单次页面内辅助”更接近日常开发工作流：

- 中断后能继续；
- 恢复来源清晰；
- 不会误把旧预览当成最新状态；
- 批量重新预览减少重复点击；
- 用户仍保留最后决策权。

## 下一步

可以继续推进：

- 批量预览进度条；
- 批量预览完成后自动聚焦第一条阻止项；
- 恢复草稿时对比当前工作副本，提示缺失文件、状态变化和新增文件；
- AI 根据最新状态修正拆分队列。
