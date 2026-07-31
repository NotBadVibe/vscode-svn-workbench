# SVN Workbench AI 拆分队列只预览未预览项

日期：2026-07-06

阶段：开发 -> 测试

## 背景

拆分队列的下一步建议已经能识别“当前有未预览项”，但此前主操作复用的是“重新预览全部”。这会把已通过预览的队列项也重新跑一遍。

本轮新增专门的“预览未预览”动作，让用户只处理尚未确认的队列项。

## 功能说明

入口：

- 提交页面 -> 拆分待提交队列头部 -> `预览未预览`
- 提交页面 -> 拆分待提交队列下一步建议 -> `预览未预览项`

执行逻辑：

1. 收集队列中 `planStatus = notPreviewed` 的项。
2. 排除已完成项。
3. 排除提交中项。
4. 排除没有路径的异常项。
5. 对剩余项发起批量提交计划预览。
6. 预览结果逐项回填。

## 与重新预览全部的区别

`重新预览全部`：

- 会预览所有可重预览队列项。
- 包括已通过预览的 ready 项。
- 包括需处理 blocked 项。

`预览未预览`：

- 只预览尚未预览的队列项。
- 不打扰已通过预览的项。
- 不重复跑已知阻止项。

## 核心实现

新增函数：

- `getNotPreviewedCommitSplitQueueItems`

扩展命令：

- `previewNotPreviewed`

调整下一步建议：

- `previewNotPreviewed` 状态的主动作从 `previewAll` 改为 `previewNotPreviewed`。

## 安全边界

该能力只做提交前预览：

- 不自动提交。
- 不自动套用建议。
- 不修改文件。
- 不修改提交说明。
- 不处理已完成或提交中队列项。

## 验证

已通过：

- `npm.cmd run compile`
- `npm.cmd run test:extension`
- `npm.cmd audit`

新增测试：

- `returns not-previewed commit split queue items`

