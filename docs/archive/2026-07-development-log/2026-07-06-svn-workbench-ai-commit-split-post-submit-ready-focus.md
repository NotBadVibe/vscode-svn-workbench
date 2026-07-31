# SVN Workbench AI 拆分队列提交成功后聚焦下一条可提交项

日期：2026-07-06

阶段：开发 -> 测试

## 背景

拆分队列已经支持提交首个可提交项。提交成功后，原逻辑会提示下一条待处理项，但不会主动切到下一条真正可提交项。

本轮补齐提交成功后的队列流转：如果后面还有可提交项，自动切到“只看可提交”并聚焦下一条。

## 功能说明

触发场景：

- 用户提交某个拆分队列项并成功。

执行逻辑：

1. 当前队列项标记为已完成。
2. 从当前完成项之后查找下一条真正可提交项。
3. 如果找到，则切到“计划：只看可提交”。
4. 聚焦下一条可提交项。
5. 提示用户可以继续点击“提交此项”或使用“提交首个可提交”。
6. 如果没有下一条可提交项，则保留原有下一条待处理提示。

## 核心实现

新增函数：

- `getNextSubmittableCommitSplitQueueItem`

已有函数调整：

- `getFirstSubmittableCommitSplitQueueItem` 复用 next-submittable 查找。

页面新增函数：

- `getNextSubmittableSplitQueueItem`

页面调整：

- `updateSplitQueueSubmissionResult` 在提交成功后优先查找下一条可提交项。

## 安全边界

该能力只改变提交成功后的筛选、提示和聚焦：

- 不自动提交下一条。
- 不跳过确认弹窗。
- 不跳过远端更新检查。
- 不修改文件。
- 不修改提交说明。

下一次提交仍需要用户主动点击并确认。

## 验证

已通过：

- `npm.cmd run compile`
- `npm.cmd run test:extension`
- `npm.cmd audit`

测试补强：

- `returns first submittable commit split queue item` 增加 next-submittable 断言。

