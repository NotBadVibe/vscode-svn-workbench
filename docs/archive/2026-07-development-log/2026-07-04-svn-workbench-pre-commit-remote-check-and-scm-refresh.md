# SVN Workbench 提交前远端检查与 SCM 刷新记录

> 阶段：技术验证  
> 日期：2026-07-04  
> 目标：提交前检查远端是否已有更新；提交成功后同步刷新 VS Code Source Control 面板。

## 1. 本轮新增能力

新增：

```text
src/commit/preCommitRemoteCheck.ts
```

更新：

```text
src/commit/commitPanel.ts
src/extension.ts
src/test/suite/index.ts
```

## 2. 提交前远端检查

真实提交前新增检查：

```text
svn status --show-updates --xml <commit paths>
```

解析：

```text
<repos-status item="modified" />
<repos-status item="deleted" />
```

如果发现远端状态不是 `none` 或 `normal`：

- 阻止提交。
- 页面显示“远端已有更新，请先更新当前范围后再提交”。
- 列出受影响文件和远端状态。

## 3. 范围安全

远端检查结果仍经过 `OperationScope`：

- 只处理当前提交范围内文件。
- 范围外路径不会影响当前提交页。

## 4. SCM 面板刷新

提交页新增回调：

```text
onCommitted
```

扩展入口传入：

```text
refreshStatusInternal(repositoryRoot, { silent: true })
```

提交成功后会同时刷新：

- 提交页候选列表。
- VS Code Source Control 面板。

## 5. 当前测试覆盖

新增测试：

| 测试 | 验证点 |
| --- | --- |
| parses remote update status from svn xml | 能解析 `repos-status` 和 `against revision`。 |
| checks remote updates for validation working copy | 当前验证工作副本远端检查可运行，且无远端阻塞项。 |

## 6. 当前限制

| 限制 | 后续动作 |
| --- | --- |
| `repos-status` 样本仍偏少 | 后续准备远端 modified/deleted/conflict 样本。 |
| 远端检查失败时当前直接阻止 | 后续可提供“查看详情”和“重新检查”。 |
| 未实现一键更新当前范围 | 后续接更新页和冲突处理。 |

## 7. 结论

提交闭环进一步完善：

- 提交前会检查远端更新。
- 成功提交后会刷新提交页。
- 成功提交后会刷新 Source Control。
- AI、前端和用户手动选择都不能绕过后端范围校验。
