# SVN Workbench 扩展测试记录：84 PASS（全部加入并预览）

日期：2026-07-06

阶段：开发 -> 测试

## 本轮验证内容

本轮新增 AI 拆分建议“全部加入并预览”能力：

- 批量入队结果返回新增队列项 ID。
- 页面新增“全部加入并预览”按钮。
- 只对本次新增队列项触发批量预览。
- 重复建议、空建议仍然不会进入队列。

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

- `adds commit split suggestions to queue in bulk`

新增断言：

- 批量入队返回 `addedIds`。
- 新增队列项 ID 可用于后续只预览新增项。

## 当前测试基线

当前自动化测试保持 84 个。

覆盖范围继续保持：

- SVN 环境检查与状态刷新
- 右键范围与多选范围保护
- 提交候选文件筛选
- AI 文件选择
- AI 拆分提交建议
- 拆分建议批量加入队列、全部加入并预览
- 拆分队列状态、计划、预览、重试、草稿、提交生命周期
- 阻止项详情、分组、原因筛选、处理建议、快捷动作、按原因重生成拆分
- 提交计划预览与提交安全
- 提交说明模板、规范、AI 生成
- 远端更新检查
- 更新预览
- 冲突中心与 AI 冲突建议

