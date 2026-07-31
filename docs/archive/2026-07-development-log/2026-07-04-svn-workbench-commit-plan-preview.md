# SVN Workbench 提交计划预览实现记录

> 阶段：技术验证  
> 日期：2026-07-04  
> 目标：页面勾选文件后先生成提交计划，只预览和二次确认，不直接执行真实提交。

## 1. 本轮新增能力

新增提交计划服务：

```text
src/commit/commitPlanBuilder.ts
```

Webview 提交页新增：

```text
预览提交计划
```

点击后页面会把当前勾选路径发给扩展后端，后端生成：

- 工作目录。
- `svn add` 路径。
- `svn remove` 路径。
- `svn commit` 路径。
- 命令预览。
- 阻止项和原因。
- 是否可以继续真实提交。

## 2. 计划生成规则

| SVN 状态 | 计划动作 |
| --- | --- |
| `modified` | 进入 `svn commit` |
| `added` | 进入 `svn commit` |
| `deleted` | 进入 `svn commit` |
| `replaced` | 进入 `svn commit` |
| `unversioned` | 先 `svn add`，再 `svn commit` |
| `missing` | 先 `svn remove`，再 `svn commit` |
| `conflicted` / `obstructed` / `incomplete` | 阻止 |
| `ignored` / `external` / `normal` / `unknown` | 阻止 |

生成物规则：

- `selection = excluded` 的文件不能进入计划。
- `selection = blocked` 的文件不能进入计划。
- 即使前端被绕过，后端仍会重新校验。

范围规则：

- 所有路径必须先经过 `OperationScope` 校验。
- 越过右键文件夹范围的路径会被阻止。

## 3. 页面交互

页面新增区域：

```text
提交计划预览
```

显示内容：

```text
工作目录
提交路径数量
svn add 数量
svn remove 数量
命令预览
阻止项
```

当前仍然不执行真实提交。

## 4. 安全边界

本轮重点不是“能提交”，而是“不能误提交”。

已建立的安全边界：

- 前端勾选只是输入，不被信任。
- 后端重新检查候选列表。
- 后端重新检查范围。
- 后端阻止生成物、冲突、异常状态。
- 真实提交前仍需后续二次确认。

## 5. 后续接真实提交

已有转换函数：

```text
toCommitFlowPlan(preview, message)
```

下一步可接入：

```text
runCommitFlow(svnPath, plan)
```

但必须先补：

- 提交说明输入框。
- 提交说明模板。
- 二次确认弹窗。
- 执行中状态。
- 成功/失败结果面板。
- 提交后自动刷新 SVN 状态。
