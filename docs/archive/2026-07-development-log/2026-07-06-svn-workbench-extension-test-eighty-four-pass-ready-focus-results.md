# SVN Workbench 扩展测试记录：84 PASS（批量预览可提交聚焦）

日期：2026-07-06

阶段：开发 -> 测试

## 本轮验证内容

本轮新增批量预览完成后的可提交聚焦能力：

- 批量预览结果记录第一条可提交队列项。
- 有阻止项时仍优先聚焦阻止项。
- 没有阻止项但有可提交项时，自动切到“只看可提交”并聚焦第一条可提交项。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过
- VS Code Extension Host 测试：84 PASS
- npm audit：found 0 vulnerabilities

## 测试补强

补强：

- `summarizes commit split queue bulk preview result`

新增断言：

- `firstReadyId`
- `firstReadyTitle`

## 当前测试基线

当前自动化测试保持 84 个。

覆盖范围继续保持：

- SVN 环境检查与状态刷新
- 右键范围与多选范围保护
- 提交候选文件筛选
- AI 文件选择
- AI 拆分提交建议
- 拆分建议单条加入并预览、批量加入队列、全部加入并预览
- 拆分队列状态、计划、预览、重试、草稿、提交生命周期
- 阻止项详情、分组、原因筛选、处理建议、快捷动作、按原因重生成拆分
- 批量预览完成后的需处理/可提交聚焦
- 提交计划预览与提交安全
- 提交说明模板、规范、AI 生成
- 远端更新检查
- 更新预览
- 冲突中心与 AI 冲突建议

