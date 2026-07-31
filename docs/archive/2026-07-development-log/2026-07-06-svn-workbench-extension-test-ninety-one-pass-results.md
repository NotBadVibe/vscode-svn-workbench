# SVN Workbench 扩展测试记录：91 PASS

日期：2026-07-06

阶段：开发 -> 测试

## 本轮验证内容

本轮新增提交候选文件“当前筛选批量选择”能力：

- 支持按搜索、SVN 状态、文件类型、模板预设、隐藏生成物和 AI 建议组合筛选候选文件。
- 支持筛选后只选当前结果。
- 支持筛选后加入当前结果。
- 支持筛选后移除当前结果。
- 批量动作只处理可提交候选，跳过默认排除项和阻止项。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过
- VS Code Extension Host 测试：91 PASS
- npm audit：found 0 vulnerabilities

## 新增测试用例

新增：

- `filters commit candidates by current file filters`
- `returns selectable commit candidate paths after filters`

覆盖点：

- 文件类型筛选。
- 模板预设筛选。
- SVN 状态筛选。
- 路径搜索。
- 隐藏生成物。
- AI 建议筛选。
- 筛选后只返回可批量选择路径。
- 排除默认排除项和阻止项。

## 当前测试基线

当前自动化测试从 89 个增加到 91 个。

覆盖范围继续保持：

- SVN 环境检查与状态刷新
- 右键范围与多选范围保护
- 提交候选文件筛选、分组和批量选择
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

