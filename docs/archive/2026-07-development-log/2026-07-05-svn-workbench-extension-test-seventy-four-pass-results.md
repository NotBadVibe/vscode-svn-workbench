# SVN Workbench 扩展测试记录：74 PASS

日期：2026-07-05
阶段：开发
整体进度：约 66%

## 本轮验证目标

验证 AI 拆分提交队列草稿恢复交互和批量重新预览规则加入后，现有提交、队列、冲突、AI 和更新链路不回退。

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
- `npm.cmd run test:extension`：74 PASS。
- `npm.cmd audit`：found 0 vulnerabilities。

## 新增通过用例

- `returns repreviewable commit split queue items`

该用例验证：

- `pending` 队列项可以进入批量重新预览；
- `applied` 队列项可以进入批量重新预览；
- `failed` 队列项可以进入批量重新预览；
- `completed` 队列项不会进入批量重新预览；
- `submitting` 队列项不会进入批量重新预览。

## 本轮结论

AI 拆分队列恢复体验已补齐第一版交互闭环。用户重新打开提交页后可以看到恢复提示，并能选择批量重新预览、忽略提示或丢弃草稿；提交安全策略仍保持“恢复后必须重新预览再提交”。
