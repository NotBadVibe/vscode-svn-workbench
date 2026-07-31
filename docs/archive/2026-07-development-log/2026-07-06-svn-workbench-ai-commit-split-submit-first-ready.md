# SVN Workbench AI 拆分队列提交首个可提交项

日期：2026-07-06

阶段：开发 -> 测试

## 背景

拆分队列批量预览完成后，页面已经能自动切到可提交项并聚焦第一条可提交项。用户下一步通常就是提交该项。

本轮在拆分待提交队列头部新增“提交首个可提交”按钮，减少用户在队列中查找按钮的操作。

## 功能说明

入口：提交页面 -> 拆分待提交队列头部。

新增按钮：

- `提交首个可提交`

启用条件：

- 当前队列存在真正可提交的拆分项。
- 批量预览没有进行中。

真正可提交的定义：

- 已通过提交计划预览。
- 不是提交中。
- 不是已完成。
- 不存在阻止项。

执行逻辑：

1. 查找第一条真正可提交的队列项。
2. 自动切到“计划：只看可提交”。
3. 聚焦该队列项。
4. 复用现有 `requestSplitQueueItemCommit` 提交流程。
5. 继续走提交计划守卫、远端更新检查和 VS Code 确认弹窗。

## 核心实现

新增函数：

- `getFirstSubmittableCommitSplitQueueItem`

该函数复用 `canSubmitCommitSplitQueueItem`，避免把未预览、阻止、提交中、已完成项误判为可提交。

页面新增函数：

- `getFirstSubmittableSplitQueueItem`

页面新增动作：

- `submitFirstReady`

## 安全边界

该功能不会绕过任何提交安全检查：

- 不自动提交。
- 不跳过确认弹窗。
- 不跳过远端更新检查。
- 不跳过提交计划预览。
- 不提交未通过预览的队列项。

用户仍需要在 VS Code 弹窗中确认提交。

## 验证

已通过：

- `npm.cmd run compile`
- `npm.cmd run test:extension`
- `npm.cmd audit`

新增测试：

- `returns first submittable commit split queue item`

