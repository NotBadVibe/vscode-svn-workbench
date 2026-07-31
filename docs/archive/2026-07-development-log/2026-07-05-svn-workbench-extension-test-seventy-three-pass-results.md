# SVN Workbench 扩展测试记录：73 PASS

日期：2026-07-05
阶段：开发
整体进度：约 65%

## 本轮验证目标

验证 AI 拆分提交队列草稿持久化后，提交页、队列状态机、状态筛选、失败重试、提交后流转等既有能力没有回退。

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
- `npm.cmd run test:extension`：73 PASS。
- `npm.cmd audit`：found 0 vulnerabilities。

## 新增通过用例

- `persists commit split queue drafts by operation scope`

该用例验证：

- 同一操作范围可以恢复草稿；
- 不同操作范围不会误恢复；
- 多选 roots 的顺序变化不会影响范围键；
- 已完成项不会进入草稿；
- 提交中项恢复为失败态；
- 恢复后必须重新预览；
- 队列过滤器与“隐藏已完成”偏好可保存；
- 草稿版本不匹配时放弃恢复。

## 当前自动化覆盖总览

本轮之后，扩展测试覆盖继续保持在核心链路：

- SVN 可执行文件与工作副本基础能力；
- Quick Diff 与 BASE 内容读取；
- 提交候选文件收集、生成文件过滤、文件夹范围提交；
- AI 文件筛选、解释、推荐路径与恢复默认选择；
- 提交候选分组、分组选择；
- AI 拆分提交建议、计划预览、队列管理、提交生命周期、失败重试、完成项清理、状态过滤、草稿恢复；
- 团队提交规范配置与可视化配置页；
- AI commit message 生成、模板补全、diff 摘要；
- 真实提交前远端检查与提交计划；
- 当前范围更新；
- 冲突中心、AI 冲突建议与 resolve 预览。

## 结论

本轮变更可以进入下一轮开发。AI 拆分提交队列已经具备更接近日常使用的连续性：用户关闭页面后，不会丢失未处理的拆分任务，同时恢复后的每一项仍需重新预览和确认，符合提交安全要求。
