# SVN Workbench 扩展测试记录：82 PASS

日期：2026-07-06

阶段：开发 -> 测试

## 本轮验证内容

本轮新增 AI 拆分待提交队列的“阻止原因快捷动作”能力：

- 处理建议模型增加快捷动作。
- 页面处理建议区展示快捷动作按钮。
- 支持刷新候选并重预览匹配原因的队列项。
- 支持从提交页面打开冲突中心。
- 支持基于当前已选文件重新生成拆分建议。
- 支持复用原因筛选查看具体阻止项。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过
- VS Code Extension Host 测试：82 PASS
- npm audit：found 0 vulnerabilities

## 新增测试用例

新增：

- `returns quick actions for commit split queue preview issue reasons`

覆盖点：

- 候选列表缺失返回刷新并重预览、重新生成拆分建议。
- 阻止状态返回打开冲突中心、刷新并重预览。
- 规则排除返回刷新并重预览、人工查看阻止项。

## 当前测试基线

当前自动化测试从 81 个增加到 82 个。

覆盖范围继续保持：

- SVN 环境检查与状态刷新
- 右键范围与多选范围保护
- 提交候选文件筛选
- AI 文件选择
- AI 拆分提交建议
- 拆分队列状态、计划、预览、重试、草稿、提交生命周期
- 阻止项详情、分组、原因筛选、处理建议、快捷动作
- 提交计划预览与提交安全
- 提交说明模板、规范、AI 生成
- 远端更新检查
- 更新预览
- 冲突中心与 AI 冲突建议

