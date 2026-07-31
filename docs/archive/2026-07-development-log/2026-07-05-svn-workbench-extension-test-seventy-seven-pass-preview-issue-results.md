# SVN Workbench 扩展测试记录：77 PASS，预览阻止原因增强

日期：2026-07-05
阶段：开发
整体进度：约 70%

## 本轮验证目标

验证拆分队列项保存预览阻止原因后，队列预览状态、草稿恢复、提交后刷新和既有 77 条扩展测试不回退。

## 命令

```powershell
$machine = [Environment]::GetEnvironmentVariable('Path','Machine')
$user = [Environment]::GetEnvironmentVariable('Path','User')
$env:Path = "$machine;$user;C:\Program Files\Git\cmd"
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
```

## 结果

- `npm.cmd run compile`：通过。
- `npm.cmd run test:extension`：77 PASS。
- `npm.cmd audit`：found 0 vulnerabilities。

## 加强覆盖点

本轮没有新增测试用例数量，但增强了既有用例断言：

- `updates commit split queue preview status`：验证 blocked 队列项会保存具体预览阻止原因。
- `tracks commit split queue submission lifecycle`：验证提交后刷新会清空旧预览阻止原因。
- `persists commit split queue drafts by operation scope`：验证草稿恢复不会带回旧预览阻止原因。

## 本轮结论

拆分队列项已经具备阻止原因摘要能力。用户进入“只看需处理”后，可以直接在队列项中看到阻止路径和原因，提交安全策略仍保持恢复后重新预览。
