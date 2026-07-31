# SVN Workbench 扩展测试记录：97 PASS

日期：2026-07-06

阶段：开发 -> 测试

## 本轮验证内容

本轮新增更新预览远端变更摘要：

- 更新预览执行远端更新状态检查。
- 支持汇总远端过期项总数。
- 支持按远端 repositoryStatus 聚合。
- 支持展示远端变更文件明细。
- 远端检查失败时保留本地预览并展示错误。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过
- VS Code Extension Host 测试：97 PASS
- npm audit：found 0 vulnerabilities

## 新增测试用例

新增：

- `summarizes update scope remote changes`

覆盖点：

- 透传远端检查版本。
- 统计远端变更总数。
- 按 `modified`、`deleted` 等远端状态聚合。
- 保留远端变更文件明细顺序。

## 当前测试基线

当前自动化测试从 96 个增加到 97 个。

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
- 更新预览、本地变更摘要、远端变更摘要
- 冲突中心与 AI 冲突建议

