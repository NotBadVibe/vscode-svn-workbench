# SVN Workbench AI 拆分队列下一步建议

日期：2026-07-06

阶段：开发 -> 测试

## 背景

拆分待提交队列已经有较多能力：

- 预览全部。
- 只看需处理。
- 重预览需处理。
- 提交首个可提交。
- 清理已完成。
- 阻止原因筛选与处理建议。

功能变多后，用户需要判断下一步应该先处理阻止项、提交可提交项，还是先预览未确认项。本轮新增“下一步建议”卡片，把当前最合理的动作前置。

## 功能说明

入口：提交页面 -> 拆分待提交队列头部下方。

建议卡片展示：

- 标题。
- 说明。
- 主操作按钮。

## 判断规则

优先级如下：

1. 队列为空：提示先生成 AI 拆分建议。
2. 批量预览中：提示等待批量预览完成。
3. 存在阻止项：建议优先处理阻止项，主按钮为“只看需处理”。
4. 存在可提交项：建议提交下一项，主按钮为“提交首个可提交”。
5. 存在未预览项：建议先预览未确认项，主按钮为“重新预览全部”。
6. 存在提交中项：提示等待提交结果。
7. 全部已完成：建议清理已完成项，主按钮为“清理已完成”。
8. 其他状态：提示检查筛选条件或重新预览。

## 核心实现

新增类型：

- `CommitSplitQueueNextActionKind`
- `CommitSplitQueueNextActionCommand`
- `CommitSplitQueueNextAction`

新增函数：

- `getCommitSplitQueueNextAction`

页面新增函数：

- `getSplitQueueNextAction`
- `renderSplitQueueNextAction`

页面新增样式：

- `.split-queue-next-action`

## 安全边界

下一步建议只是把已有安全动作前置：

- 不自动提交。
- 不自动修改文件。
- 不自动套用拆分建议。
- 不跳过远端更新检查。
- 不跳过确认弹窗。

## 验证

已通过：

- `npm.cmd run compile`
- `npm.cmd run test:extension`
- `npm.cmd audit`

新增测试：

- `recommends the next commit split queue action`

