# SVN Workbench 扩展测试记录：95 PASS

日期：2026-07-06

阶段：开发 -> 测试

## 本轮验证内容

本轮新增筛选预设命中数量提示：

- 预设下拉框显示命中总数。
- 预设下拉框显示可批量选择数量。
- 可选数会排除默认排除项和阻止项。
- AI 筛选结果回填后会刷新 AI 相关预设计数。
- SVN 候选刷新后会刷新预设计数。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过
- VS Code Extension Host 测试：95 PASS
- npm audit：found 0 vulnerabilities

## 新增测试用例

新增：

- `summarizes commit candidate filter preset matches`

覆盖点：

- 统计预设命中总数。
- 统计预设可选数量。
- 统计内置前端预设。
- 统计文档预设。
- 统计 AI 推荐预设。

## 当前测试基线

当前自动化测试从 94 个增加到 95 个。

覆盖范围继续保持：

- SVN 环境检查与状态刷新
- 右键范围与多选范围保护
- 提交候选文件筛选、筛选预设、仓库级预设、预设计数、分组和批量选择
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

