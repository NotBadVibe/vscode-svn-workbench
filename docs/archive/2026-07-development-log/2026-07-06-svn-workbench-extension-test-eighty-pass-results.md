# SVN Workbench 扩展测试记录：80 PASS

日期：2026-07-06

阶段：开发 -> 测试

## 本轮验证内容

本轮新增 AI 拆分待提交队列的“阻止原因筛选”能力：

- 阻止原因分组从纯统计升级为可点击筛选。
- 队列可按范围不匹配、候选列表缺失、规则排除、阻止状态、SVN 状态不支持、空选择、其他原因筛选。
- 原因筛选与计划筛选联动，点击原因后自动进入“只看需处理”。
- 批量预览、清空队列、丢弃草稿、非需处理计划筛选会清理旧原因筛选。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过
- VS Code Extension Host 测试：80 PASS
- npm audit：found 0 vulnerabilities

## 新增测试用例

新增：

- `filters commit split queue items by preview issue reason`

覆盖点：

- `doesCommitSplitQueueItemMatchPreviewIssueCategory` 能按阻止原因匹配队列项。
- `getVisibleCommitSplitQueueItems` 的第五个参数可按阻止原因收窄可见队列。
- 缺少 `lastPreviewIssues` 的阻止项归入 `unknown`。
- `ready` 等非阻止计划不会被具体原因筛选误命中。

## 当前测试基线

当前自动化测试从 79 个增加到 80 个，覆盖范围继续保持：

- SVN 环境检查与状态刷新
- 右键范围与多选范围保护
- 提交候选文件筛选
- AI 文件选择
- AI 拆分提交建议
- 拆分队列状态、计划、预览、重试、草稿、提交生命周期
- 阻止项详情、分组、原因筛选
- 提交计划预览与提交安全
- 提交说明模板、规范、AI 生成
- 远端更新检查
- 更新预览
- 冲突中心与 AI 冲突建议

