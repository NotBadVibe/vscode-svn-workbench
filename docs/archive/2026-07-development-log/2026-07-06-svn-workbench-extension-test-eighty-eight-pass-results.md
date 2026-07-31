# SVN Workbench 扩展测试记录：88 PASS

日期：2026-07-06

阶段：开发 -> 测试

## 本轮验证内容

本轮新增拆分队列“重试首个失败”能力：

- 核心层支持查找第一个可重试失败队列项。
- 队列头部新增 `重试首个失败`。
- 下一步建议可在失败项可恢复时优先显示 `优先重试失败项`。
- 点击队列级重试后自动切到 `失败 + 可提交计划` 视图。
- 重试仍复用提交计划守卫、提交确认和远端更新检查。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过
- VS Code Extension Host 测试：88 PASS
- npm audit：found 0 vulnerabilities

## 新增测试用例

新增：

- `returns first retryable failed commit split queue item`

覆盖点：

- 跳过失败但未预览的队列项。
- 找到第一个失败且计划可提交的队列项。
- 跳过已完成队列项。

更新：

- `recommends the next commit split queue action`

覆盖点：

- 可重试失败项的下一步建议为 `retryFailed`。
- 主操作为 `retryFirstFailed`。
- 该建议优先级高于普通 `submitReady`。

## 当前测试基线

当前自动化测试从 87 个增加到 88 个。

覆盖范围继续保持：

- SVN 环境检查与状态刷新
- 右键范围与多选范围保护
- 提交候选文件筛选
- AI 文件选择
- AI 拆分提交建议
- 拆分队列加入、预览、筛选、重试、草稿、提交生命周期
- 拆分队列下一步建议
- 拆分队列阻止项详情、分组、原因筛选、处理建议、快捷动作
- 提交计划预览与提交安全
- 提交说明模板、规范、AI 生成
- 远端更新检查
- 更新预览
- 冲突中心与 AI 冲突建议

