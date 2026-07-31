# SVN Workbench 真实提交入口与安全确认记录

> 阶段：技术验证  
> 日期：2026-07-04  
> 目标：在提交页接入真实 `svn add/remove/commit` 入口，但必须经过计划预览、提交说明校验和二次确认。

## 1. 本轮新增能力

新增：

```text
src/commit/commitMessageTemplates.ts
```

更新：

```text
src/commit/commitPanel.ts
src/test/suite/index.ts
```

提交页新增：

- 提交说明输入框。
- 提交模板下拉。
- `套用模板` 按钮。
- `确认提交` 按钮。
- 提交执行结果区域。

## 2. 内置提交模板

当前内置：

| 模板 | 内容结构 |
| --- | --- |
| 需求开发 | 需求 / 范围 / 影响 |
| 问题修复 | 修复 / 原因 / 影响 |
| 配置调整 | 配置 / 原因 / 影响 |
| 文档更新 | 文档 / 范围 |
| 重构优化 | 重构 / 范围 / 风险 |

后续可以把这些模板外置成用户设置或团队配置文件。

## 3. 提交说明校验

当前校验：

- 提交说明不能为空。
- 提交说明不能超过 2000 个字符。
- 换行统一交给 `CommitFlow` 处理为 LF。

Windows 已验证过中文提交说明需要：

```text
svn commit ... -F <message-file> --encoding utf-8
```

当前真实提交链路继续沿用该策略。

## 4. 执行安全链路

点击 `确认提交` 后并不会直接提交。

后端会重新执行：

1. 重新生成提交计划。
2. 校验选中文件是否仍在 `OperationScope` 内。
3. 校验文件是否仍在候选列表中。
4. 阻止生成物和 blocked 文件。
5. 校验提交说明。
6. 弹出 VS Code 原生 modal 二次确认。
7. 用户点击 `确认提交` 后才执行 `runCommitFlow`。

## 5. 执行动作

真实执行仍然复用已有提交流：

```text
runCommitFlow(svnPath, plan)
```

执行顺序：

```text
svn add <unversioned paths>
svn remove <missing paths>
svn commit <selected paths> -F <message-file> --encoding utf-8
```

## 6. 当前限制

| 限制 | 后续处理 |
| --- | --- |
| 测试不自动点击真实提交确认 | 避免污染本机验证仓库，这是有意设计。 |
| 提交后未自动刷新候选列表 | 下一轮补提交成功后的刷新。 |
| 提交结果还未解析 revision | 后续从 stdout 提取修订号。 |
| 没有远端更新检查 | 后续提交前补 `svn update --dry-run` 或等效检查策略。 |

## 7. 结论

真实提交入口已经接入，但不会绕过用户确认。

当前仍保持安全优先：

- AI 不能提交。
- 前端不能越权提交。
- 空提交说明不能提交。
- 生成物默认不能提交。
- 用户必须在 VS Code modal 中二次确认。
