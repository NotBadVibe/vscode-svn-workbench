# SVN Workbench 扩展测试记录：81 PASS

日期：2026-07-06

阶段：开发 -> 测试

## 本轮验证内容

本轮新增 AI 拆分待提交队列的“阻止原因处理建议”能力：

- 按阻止原因提供稳定处理建议。
- 页面在阻止项汇总区展示优先处理建议。
- 用户点击某个阻止原因后，页面展示该原因的专项建议。
- 建议包含标题、说明、首选动作和备选动作。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- TypeScript 编译：通过
- VS Code Extension Host 测试：81 PASS
- npm audit：found 0 vulnerabilities

## 新增测试用例

新增：

- `returns handling advice for commit split queue preview issue reasons`

覆盖点：

- 范围不匹配原因返回正确标题与首选动作。
- 候选列表缺失原因返回刷新 SVN 状态后重预览建议。
- 其他原因返回重新预览获取详情建议。

## 当前测试基线

当前自动化测试从 80 个增加到 81 个。

覆盖范围继续保持：

- SVN 环境检查与状态刷新
- 右键范围与多选范围保护
- 提交候选文件筛选
- AI 文件选择
- AI 拆分提交建议
- 拆分队列状态、计划、预览、重试、草稿、提交生命周期
- 阻止项详情、分组、原因筛选、处理建议
- 提交计划预览与提交安全
- 提交说明模板、规范、AI 生成
- 远端更新检查
- 更新预览
- 冲突中心与 AI 冲突建议

