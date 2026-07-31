# SVN Workbench AI 拆分提交队列草稿持久化

日期：2026-07-05
阶段：开发
整体进度：约 65%

## 背景

AI 拆分提交队列已经支持加入队列、预览、单项提交、失败重试、完成项清理和状态筛选。实际使用时，用户可能在处理一组拆分建议时关闭提交页、切换文件夹范围或重开 VS Code，因此队列需要具备按操作范围恢复的能力。

本轮新增“拆分提交队列草稿持久化”，目标是让未完成的 AI 拆分建议在同一个工作副本范围内可恢复，同时避免恢复后直接沿用旧预览状态造成误提交。

## 功能边界

- 保存位置：VS Code `workspaceState`。
- 保存维度：SVN 仓库根目录 + 当前操作范围 roots。
- 恢复时机：打开提交页时读取同一范围的草稿。
- 保存内容：
  - 未完成的拆分队列项；
  - 队列状态过滤器；
  - 是否隐藏已完成项；
  - 保存时间；
  - 仓库根目录与 roots 快照。
- 不保存内容：
  - 已完成队列项；
  - 已提交 revision；
  - 旧的预览通过状态。

## 交互规则

1. 用户添加 AI 拆分建议到队列后，队列立即保存。
2. 用户切换队列状态过滤器或“隐藏已完成”后，视图偏好立即保存。
3. 用户应用、提交、重试、清理或移除队列项后，队列立即保存。
4. 用户关闭提交页后再打开相同范围，自动恢复未完成队列。
5. 恢复后的队列项必须重新预览，才能再次应用或提交。
6. 如果关闭页面前某项处于提交中，恢复时降级为失败状态，并要求用户重新预览、重新确认。
7. 已完成项不会进入草稿，避免重复提交或让队列长期膨胀。

## 技术实现

新增模块：

- `src/commit/commitSplitQueueDraft.ts`

核心能力：

- `buildCommitSplitQueueDraftScopeKey(scope)`：生成范围键，Windows 下大小写归一，路径分隔符归一。
- `getCommitSplitQueueDraftStorageKey(scope)`：生成 workspaceState 存储键。
- `createCommitSplitQueueDraft(scope, payload)`：从 webview 队列状态生成可保存草稿。
- `restoreCommitSplitQueueDraft(draft, scope)`：校验版本与范围后恢复草稿。
- `sanitizeCommitSplitQueueDraftItems(queue)`：恢复前清洗队列项。

提交页接入点：

- `openCommitPanel` 打开时读取草稿。
- webview 初始化时把草稿注入 `splitQueue`、`splitQueueFilter`、`hideCompletedSplitQueue`。
- webview 在队列状态变化后发送 `saveCommitSplitQueueDraft`。
- 扩展侧收到消息后写入 `context.workspaceState`。

## 安全策略

- 范围不一致不恢复：右键某个文件夹提交时，只恢复该文件夹范围的草稿，不污染工作副本根提交。
- 完成项不恢复：避免重复提交。
- 提交中不恢复为提交中：避免 UI 假装后台任务仍在运行。
- 预览状态不复用：SVN 工作副本可能已经变化，恢复后必须重新生成提交计划。
- 版本号校验：后续草稿结构变化时可以平滑放弃旧草稿。

## 跨平台要求

- Windows 与 macOS 使用同一套规则。
- 范围键内部统一使用 `/` 作为路径分隔符。
- Windows 下范围键大小写归一，macOS 保持文件系统路径原样。
- 存储使用 VS Code API，不依赖平台特定目录。

## 已覆盖测试

新增扩展测试：

- `persists commit split queue drafts by operation scope`

覆盖点：

- 草稿按操作范围恢复；
- 不同范围不恢复；
- 多 roots 顺序变化不影响范围键；
- 已完成项被剔除；
- 提交中项恢复为失败；
- 恢复后预览状态重置为 `notPreviewed`；
- 状态过滤器和隐藏完成项偏好被保存；
- 草稿版本不匹配时放弃恢复。

## 下一步

后续可以继续推进“AI 拆分队列的人工决策增强”：

- 队列恢复后展示“上次保存时间”；
- 提供“一键重新预览全部未完成项”；
- 提供“恢复草稿 / 丢弃草稿”的显式提示；
- AI 根据最新工作副本状态自动修正拆分建议；
- 结合远端检查，在提交前提示某个拆分项是否需要先更新。
