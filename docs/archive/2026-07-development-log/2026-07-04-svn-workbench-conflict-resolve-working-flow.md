# SVN Workbench 冲突标记已解决流程记录

> 阶段：技术验证  
> 日期：2026-07-04  
> 目标：在冲突中心支持“使用当前 Working 内容标记已解决”，但必须先预览命令并二次确认。

## 1. 本轮新增能力

新增：

```text
src/conflict/conflictResolver.ts
```

更新：

```text
src/conflict/conflictCenterPanel.ts
src/extension.ts
src/test/suite/index.ts
```

## 2. 页面新增操作

冲突中心每个冲突文件新增：

- `预览解决命令`
- `标记已解决(Working)`

## 3. 解决命令

当前采用：

```text
svn resolve --accept working <conflicted-file>
```

含义：

- 使用当前 Working 文件内容作为最终解决结果。
- 不自动选择 Mine 或 Theirs。
- 用户需要先自己检查 Working 内容。

## 4. 安全流程

执行前：

1. 后端检查文件是否在当前 `OperationScope` 内。
2. 页面可预览实际 SVN 命令。
3. 点击标记时弹出 VS Code 原生 modal。
4. 用户确认后才执行 `svn resolve`。

执行后：

1. 解析 `Resolved conflicted state ...` 输出。
2. 刷新冲突列表。
3. 刷新 VS Code Source Control 面板。

## 5. 当前测试覆盖

新增测试：

| 测试 | 验证点 |
| --- | --- |
| builds resolve conflict preview | 生成解决命令预览，范围外路径会阻止。 |
| parses resolve conflict output | 识别 SVN resolved 输出。 |

## 6. 当前限制

| 限制 | 后续动作 |
| --- | --- |
| 不自动编辑 Working | 下一步接 AI 合并建议预览。 |
| 不支持 Mine/Theirs 一键接受 | 后续增加明确按钮，但必须二次确认。 |
| 不真实执行自动化 resolve | 避免破坏冲突验证样本。 |

## 7. 结论

冲突中心已经具备最小闭环：

- 查看四方文件。
- 打开 Diff。
- 预览解决命令。
- 二次确认。
- 标记已解决。
- 刷新冲突列表和 SCM。
