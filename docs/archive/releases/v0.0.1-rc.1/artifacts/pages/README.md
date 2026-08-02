# SVN Workbench 页面 UI 验收截图

> 生成方式：`npm run test:webview` 运行 `tests/webview-e2e/page-screenshots.spec.ts`  
> 主题与尺寸：Dark / 1440 × 960；长页面使用全页截图  
> 每张截图生成前同时检查页面级横向溢出和 axe 自动可访问性规则。

| 序号 | 页面/状态 | 截图 |
| --- | --- | --- |
| 01 | Changes | [`01-changes.png`](./01-changes.png) |
| 02 | Diff | [`02-diff.png`](./02-diff.png) |
| 03 | Commit（AI 说明 + 提交预检） | [`03-commit.png`](./03-commit.png) |
| 04 | History（Changed Paths + Blame） | [`04-history.png`](./04-history.png) |
| 05 | Conflicts（AI 建议 + Resolve 预览） | [`05-conflicts.png`](./05-conflicts.png) |
| 06 | Changelists（AI 拆分 + 应用预览） | [`06-changelists.png`](./06-changelists.png) |
| 07 | AI Review | [`07-ai-review.png`](./07-ai-review.png) |
| 08 | Impact | [`08-impact.png`](./08-impact.png) |
| 09 | Agent（待逐步审批计划） | [`09-agent.png`](./09-agent.png) |
| 10 | Repository（Update + Cleanup 预览） | [`10-repository.png`](./10-repository.png) |
| 11 | Settings / AI 模型 | [`11-settings-ai.png`](./11-settings-ai.png) |
| 12 | Settings / 团队规范 | [`12-settings-team.png`](./12-settings-team.png) |
| 13 | Settings / SVN 安全 | [`13-settings-svn-security.png`](./13-settings-svn-security.png) |
| 14 | Diagnostics / 验收清单 | [`13-diagnostics.png`](./13-diagnostics.png) |
| 15 | Changes / 5000 文件窗口化 | [`14-changes-5000-files.png`](./14-changes-5000-files.png) |
| 16 | Authentication / 安全恢复 | [`15-authentication-recovery.png`](./15-authentication-recovery.png) |
| 17 | Certificate / 指纹核对与信任 | [`16-certificate-recovery.png`](./16-certificate-recovery.png) |

后续新增正式模块时，必须同步新增截图用例和本索引；只有截图实际生成且测试通过，才允许在版本验收报告中声明页面已验收。
