# SVN Workbench AI 拆分队列批量预览可提交聚焦

日期：2026-07-06

阶段：开发 -> 测试

## 背景

拆分队列批量预览完成后，已有逻辑会在发现阻止项时自动切到“只看需处理”并聚焦第一条阻止项。

但当本次批量预览全部通过或部分通过且没有阻止项时，页面没有主动带用户进入下一步。用户需要自己切换“只看可提交”。

本轮补齐“没有阻止项时聚焦可提交项”。

## 功能说明

触发场景：

- 单条加入并预览。
- 全部加入并预览。
- 重新预览全部。
- 重预览需处理。
- 刷新候选并重预览某个阻止原因。

完成后的跳转规则：

1. 如果有阻止项，优先切到“计划：只看需处理”，聚焦第一条阻止项。
2. 如果没有阻止项，但有可提交项，切到“计划：只看可提交”，聚焦第一条可提交项。
3. 如果没有阻止项也没有可提交项，只展示批量预览完成结果。

## 核心实现

扩展批量预览结果：

- `firstReadyId`
- `firstReadyTitle`

核心函数：

- `summarizeCommitSplitQueueBulkPreviewResult`

页面函数：

- `summarizeCompletedSplitQueueBulkPreviewResult`
- `formatBulkPreviewCompletionDetail`
- `updateSplitQueuePreviewStatus`

## 交互原则

阻止项优先：

- 只要存在阻止项，就优先带用户处理阻止项。
- 不会因为存在可提交项而掩盖需处理项。

可提交引导：

- 只有在没有阻止项时，才自动切到可提交项。
- 聚焦第一条可提交项，方便用户继续提交。

## 安全边界

该能力只改变筛选和聚焦：

- 不自动提交。
- 不自动套用建议。
- 不自动修改文件。
- 不自动修改提交说明。

## 验证

已通过：

- `npm.cmd run compile`
- `npm.cmd run test:extension`
- `npm.cmd audit`

测试补强：

- `summarizes commit split queue bulk preview result` 增加 `firstReadyId` 和 `firstReadyTitle` 断言。

