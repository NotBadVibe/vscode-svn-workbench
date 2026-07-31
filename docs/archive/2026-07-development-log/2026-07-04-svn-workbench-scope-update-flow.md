# SVN Workbench 当前范围更新流程记录

> 阶段：技术验证  
> 日期：2026-07-04  
> 目标：当提交前发现远端已有更新时，用户可以在当前提交范围内预览并执行更新。

## 1. 本轮新增能力

新增：

```text
src/update/updateFlow.ts
```

更新：

```text
src/commit/commitPanel.ts
src/extension.ts
src/test/suite/index.ts
```

提交页新增：

- `预览更新`
- `更新当前范围`
- 更新结果区域

## 2. 更新命令策略

更新执行命令：

```text
svn update --accept postpone <scope paths>
```

设计理由：

- 只更新当前 `OperationScope` 范围。
- 不自动解决冲突。
- 冲突保留为待处理状态，后续交给冲突中心和 AI 冲突建议。

## 3. 更新预览

点击 `预览更新` 后展示：

- 工作目录。
- 更新路径数量。
- 即将执行的 SVN 命令。

不会修改工作副本。

## 4. 更新执行

点击 `更新当前范围` 后：

1. 弹出 VS Code 原生确认框。
2. 用户确认后执行 `svn update --accept postpone`。
3. 解析更新 revision。
4. 检测输出中是否包含冲突。
5. 刷新提交页候选列表。
6. 刷新 VS Code Source Control 面板。

## 5. 输出解析

当前支持：

```text
Updated to revision 12.
At revision 13.
```

冲突识别：

```text
C    path/to/file
```

## 6. 当前限制

| 限制 | 后续动作 |
| --- | --- |
| 未自动展开冲突详情 | 后续接冲突中心。 |
| 未做更新前远端日志摘要 | 后续接更新页和 AI 总结。 |
| 未测试真实冲突样本 | 后续构造双工作副本冲突验证。 |

## 7. 结论

提交前远端更新阻止已经不再是死路。

用户现在可以：

- 预览当前范围更新。
- 手动确认更新。
- 更新后自动刷新提交页和 SCM。
- 冲突保留给后续专门处理。
