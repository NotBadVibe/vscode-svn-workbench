# SVN Workbench AI 拆分队列计划状态筛选

日期：2026-07-05
阶段：开发
整体进度：约 69%

## 背景

批量预览完成后，队列已经能统计“可提交 / 需处理 / 未回填”，并能定位第一条阻止项。本轮继续补齐队列查看方式：把“队列提交状态”和“提交计划状态”拆成两套筛选。

## 本轮新增

拆分待提交队列新增“计划”筛选：

- 全部计划；
- 只看需处理；
- 只看可提交；
- 只看未预览。

队列标题栏新增“只看需处理”按钮：

- 当没有阻止项时禁用；
- 有阻止项时一键切换到计划筛选 `blocked`；
- 自动取消隐藏已完成；
- 自动聚焦第一条需处理队列项。

批量预览完成后，如果存在阻止项：

- 自动切换到“只看需处理”；
- 保留原有完成摘要；
- 滚动并高亮第一条需处理项。

## 筛选模型

现在队列有两类筛选：

- 队列状态筛选：`all / pending / applied / submitting / completed / failed`
- 计划状态筛选：`all / notPreviewed / ready / blocked`

两类筛选可叠加。例如：

- 只看失败 + 只看需处理；
- 全部状态 + 只看可提交；
- 全部状态 + 只看未预览。

## 草稿持久化

拆分队列草稿新增保存：

- `splitQueuePlanFilter`

恢复提交页时，会保留用户上次的计划筛选偏好。默认值为 `all`，旧草稿没有该字段时也会安全回退到全部计划。

## 技术实现

队列逻辑模块新增：

- `CommitSplitQueuePlanFilter`
- `getVisibleCommitSplitQueueItems(queue, hideCompleted, filter, planFilter)`
- `summarizeCommitSplitQueue(queue, hideCompleted, filter, planFilter)`

队列摘要新增统计：

- `notPreviewed`
- `ready`
- `blocked`

草稿模块新增：

- `splitQueuePlanFilter`
- `sanitizeCommitSplitQueuePlanFilter(value)`

提交页 webview 新增：

- `splitQueuePlanFilter`
- `restoreSplitQueuePlanFilter(draft)`
- 计划筛选下拉框；
- “只看需处理”按钮；
- 按计划状态过滤队列项；
- 空状态文案按计划筛选变化。

## 用户价值

这个改动让用户在批量预览后可以直接进入处理视图：

- 先看所有需处理项；
- 处理后再重新预览；
- 切到可提交项逐个提交；
- 未预览项也能单独查看。

## 下一步

后续可以继续推进：

- 阻止项列表面板；
- AI 解释每条阻止项；
- AI 自动修正拆分建议中的失效路径；
- 批量预览失败项单独筛选；
- 批量预览取消与并发限制。
