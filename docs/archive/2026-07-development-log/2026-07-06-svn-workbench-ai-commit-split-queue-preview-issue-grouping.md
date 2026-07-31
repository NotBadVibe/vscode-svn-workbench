# SVN Workbench AI 拆分队列阻止原因分组

日期：2026-07-06
阶段：开发
整体进度：约 72%

## 背景

拆分队列已经可以汇总所有预览阻止项，但汇总列表较长时，用户仍需要逐条判断问题类型。本轮新增阻止原因分组，让用户先看到问题分布，再决定处理顺序。

## 本轮新增

阻止项汇总面板新增“按原因分组”：

- 范围不匹配；
- 候选列表缺失；
- 规则排除；
- 阻止状态；
- SVN 状态不支持；
- 空选择；
- 其他原因。

每组展示：

- 阻止项数量；
- 涉及拆分项数量。

## 技术实现

队列逻辑模块新增：

- `CommitSplitQueuePreviewIssueCategory`
- `CommitSplitQueuePreviewIssueGroup`
- `classifyCommitSplitQueuePreviewIssue(reason)`
- `getCommitSplitQueuePreviewIssueCategoryLabel(category)`
- `groupCommitSplitQueuePreviewIssues(issues)`

提交页 webview 新增：

- `groupSplitQueuePreviewIssues(issues)`
- `classifySplitQueuePreviewIssue(reason)`
- 阻止项汇总面板先展示分组，再展示具体阻止项。

## 分类规则

分类采用保守关键词匹配：

- 包含“请选择至少一个文件”：空选择；
- 包含“当前提交范围”：范围不匹配；
- 包含“当前 SVN 候选列表”：候选列表缺失；
- 包含“规则排除”：规则排除；
- 包含“阻止状态”：阻止状态；
- 包含“当前 SVN 状态”：SVN 状态不支持；
- 其他：其他原因。

## 用户价值

用户可以先判断阻止项主要集中在哪类问题：

- 如果大多是候选列表缺失，优先刷新或重新生成拆分建议；
- 如果大多是范围不匹配，检查是否右键选错文件夹；
- 如果大多是规则排除，检查团队提交规则；
- 如果大多是 SVN 状态异常，优先处理冲突或本地状态。

## 下一步

后续可以继续推进：

- 按原因分组点击筛选；
- AI 解释每类阻止原因；
- AI 自动修正失效路径；
- “只重预览当前可见项”；
- 批量预览取消与并发限制。
