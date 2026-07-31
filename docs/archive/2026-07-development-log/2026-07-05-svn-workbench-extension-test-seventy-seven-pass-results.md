# SVN Workbench 扩展测试记录：77 PASS

日期：2026-07-05
阶段：开发
整体进度：约 69%

## 本轮验证目标

验证 AI 拆分队列新增计划状态筛选后，队列状态筛选、批量预览、草稿恢复、提交生命周期和冲突相关能力没有回退。

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

## 新增通过用例

- `filters commit split queue by plan view`

该用例验证：

- `blocked` 计划筛选只返回需处理项；
- `ready` 计划筛选只返回可提交项；
- `notPreviewed` 计划筛选只返回未预览项；
- 队列摘要会同时统计未预览、可提交和需处理数量。

## 本轮结论

AI 拆分队列已经支持按提交状态和计划状态叠加筛选。批量预览后用户可以一键聚焦需处理项，日常处理大队列时会更顺手。
