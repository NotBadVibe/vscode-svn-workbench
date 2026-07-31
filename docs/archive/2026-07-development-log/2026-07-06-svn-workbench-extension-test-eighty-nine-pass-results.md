# SVN Workbench 扩展测试记录：89 PASS

日期：2026-07-06

阶段：开发 -> 测试

## 本轮验证内容

本轮新增拆分队列 `重预览失败项` 能力：

- 核心层支持筛选失败且可重预览的队列项。
- 队列头部新增失败项专属重预览入口。
- 下一步建议可识别失败项需要重新确认提交计划的状态。
- 点击后只批量预览失败项，不影响其他已确认队列项。
- 该动作不直接提交，仍停留在计划预览和用户决策阶段。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过
- VS Code Extension Host 测试：89 PASS
- npm audit：found 0 vulnerabilities

## 新增测试用例

新增：

- `returns failed repreviewable commit split queue items`

覆盖点：

- 返回失败且可重新预览的队列项。
- 跳过普通待处理队列项。
- 跳过已完成队列项。
- 跳过提交中队列项。

更新：

- `recommends the next commit split queue action`

覆盖点：

- 失败但尚不能直接重试时，下一步建议为 `previewFailed`。
- 主操作为 `previewFailed`。
- 该建议优先级高于普通未预览和普通可提交动作。

## 当前测试基线

当前自动化测试从 88 个增加到 89 个。

覆盖范围继续保持：

- SVN 环境检查与状态刷新
- 右键范围与多选范围保护
- 提交候选文件筛选
- AI 文件选择
- AI 拆分提交建议
- 拆分队列加入、预览、筛选、重预览、重试、草稿、提交生命周期
- 拆分队列下一步建议
- 拆分队列失败恢复链路
- 拆分队列阻止项详情、分组、原因筛选、处理建议、快捷动作
- 提交计划预览与提交安全
- 提交说明模板、规范、AI 生成
- 远端更新检查
- 更新预览
- 冲突中心与 AI 冲突建议

