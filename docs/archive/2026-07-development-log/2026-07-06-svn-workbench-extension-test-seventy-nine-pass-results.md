# SVN Workbench 扩展测试记录：79 PASS

日期：2026-07-06
阶段：开发
整体进度：约 72%

## 本轮验证目标

验证拆分队列阻止原因分组加入后，阻止项汇总、重预览需处理、计划筛选、草稿恢复和既有提交链路不回退。

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
- `npm.cmd run test:extension`：79 PASS。
- `npm.cmd audit`：found 0 vulnerabilities。

## 新增通过用例

- `groups commit split queue preview issues by reason`

该用例验证：

- 常见阻止原因能归到正确类别；
- 未知原因归到 `unknown`；
- 分组能统计阻止项数量；
- 分组能统计涉及的拆分项数量；
- 分组按数量排序。

## 本轮结论

阻止项汇总从“列表”升级为“分组 + 列表”。用户可以先看问题类型分布，再进入具体队列项处理。
