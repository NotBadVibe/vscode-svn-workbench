# SVN Workbench 提交成功刷新与 Revision 摘要记录

> 阶段：技术验证  
> 日期：2026-07-04  
> 目标：真实提交成功后解析 revision，展示提交摘要，并自动刷新提交候选列表。

## 1. 本轮新增能力

更新：

```text
src/commit/commitFlow.ts
src/commit/commitPanel.ts
src/test/suite/index.ts
```

新增行为：

- `svn commit` 成功后解析 `Committed revision <n>.`
- 页面显示：
  - revision
  - 提交路径数量
  - `svn add` 数量
  - `svn remove` 数量
- 提交成功后自动重新执行候选收集。
- 页面刷新候选列表、统计和默认勾选状态。

## 2. CommitFlow 强化

`CommitFlowResult` 新增：

```text
revision?: string
```

新增解析函数：

```text
parseCommittedRevision(output)
```

同时强化执行安全：

- `svn add` 失败会中止提交流。
- `svn remove` 失败会中止提交流。
- 不再在预处理失败后继续执行 `svn commit`。

## 3. 页面刷新流程

提交成功后：

```text
runCommitFlow
  -> post commitExecutionResult
  -> collectCommitCandidates
  -> post commitCandidatesRefreshed
  -> Webview 更新 candidates / summary / selected
  -> render()
```

用户能在页面内看到提交结果，不需要手动刷新页面。

## 4. 当前测试

新增测试：

```text
parses committed revision from svn output
```

验证：

```text
Committed revision 42. -> 42
无 revision 输出 -> undefined
```

## 5. 当前限制

| 限制 | 后续动作 |
| --- | --- |
| 尚未真实自动化执行提交 | 避免污染本机验证仓库，真实提交仍需人工确认。 |
| revision 解析目前按英文 SVN 输出 | 后续补中文/本地化输出兼容。 |
| 提交成功后未联动 SCM Provider 刷新 | 后续将提交页刷新和 Source Control 刷新统一。 |

## 6. 结论

提交闭环已经具备：

- 提交前计划。
- 提交说明校验。
- 二次确认。
- 真实提交执行。
- revision 摘要。
- 成功后刷新提交页候选列表。
