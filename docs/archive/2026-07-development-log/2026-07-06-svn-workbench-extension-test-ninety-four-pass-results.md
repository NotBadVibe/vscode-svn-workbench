# SVN Workbench 扩展测试记录：94 PASS

日期：2026-07-06

阶段：开发 -> 测试

## 本轮验证内容

本轮新增仓库级提交候选筛选预设：

- 支持从 `.svn-workbench.json` 读取 `commitCandidateFilterPresets`。
- 支持与内置筛选预设合并。
- 仓库预设不会覆盖内置预设。
- 无效预设会被跳过并产生提示。
- 提交页打开后可直接在 `筛选预设` 下拉框中使用团队预设。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过
- VS Code Extension Host 测试：94 PASS
- npm audit：found 0 vulnerabilities

## 新增测试用例

新增：

- `parses repository commit candidate filter presets`
- `reads repository commit candidate filter presets`

覆盖点：

- 解析仓库级筛选预设。
- 校验预设 ID、label 和 filters。
- 跳过与内置预设冲突的仓库预设。
- 跳过非法 ID。
- 读取真实 `.svn-workbench.json` 文件。
- 返回配置路径和警告信息。

## 当前测试基线

当前自动化测试从 92 个增加到 94 个。

覆盖范围继续保持：

- SVN 环境检查与状态刷新
- 右键范围与多选范围保护
- 提交候选文件筛选、筛选预设、仓库级预设、分组和批量选择
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

