# SVN Workbench 冲突中心原型记录

> 阶段：技术验证  
> 日期：2026-07-04  
> 目标：读取 SVN 冲突信息，展示 Working / Mine / Base / Theirs，并用 VS Code 原生 Diff 打开对比。

## 1. 本轮新增能力

新增：

```text
src/conflict/conflictCollector.ts
src/conflict/conflictCenterPanel.ts
```

更新：

```text
src/extension.ts
package.json
src/test/suite/index.ts
```

新增命令：

```text
SVN: Open Conflict Center
```

右键文件夹菜单也增加冲突中心入口。

## 2. 真实冲突样本

本轮在本机创建了独立验证仓库和两个工作副本：

```text
C:\svn-workbench-conflict-validation-repo
C:\svn-workbench-conflict-validation-wc-a
C:\svn-workbench-conflict-validation-wc-b
```

冲突文件：

```text
C:\svn-workbench-conflict-validation-wc-b\order.txt
```

SVN 生成：

```text
order.txt
order.txt.mine
order.txt.r2
order.txt.r3
```

## 3. SVN XML 结论

`svn status --xml` 只标记主文件：

```text
item="conflicted"
```

完整冲突文件路径来自：

```text
svn info --xml <conflicted-file>
```

关键字段：

```text
<conflict operation="update" type="text">
<prev-base-file>...</prev-base-file>
<prev-wc-file>...</prev-wc-file>
<cur-base-file>...</cur-base-file>
```

映射关系：

| SVN 字段 | 页面含义 |
| --- | --- |
| `prev-base-file` | Base |
| `prev-wc-file` | Mine |
| `cur-base-file` | Theirs |
| 原始冲突文件 | Working |

## 4. 冲突中心页面

当前页面展示：

- 冲突文件路径。
- 冲突类型。
- 冲突操作。
- Base revision。
- Theirs revision。

操作按钮：

- 打开 Working。
- Base ↔ Mine。
- Base ↔ Theirs。
- Mine ↔ Theirs。
- Theirs ↔ Working。

## 5. 当前限制

| 限制 | 后续动作 |
| --- | --- |
| 暂不执行 resolve | 后续增加“标记已解决”和安全检查。 |
| 暂不自动合并 | 后续接 AI 冲突建议，先预览再应用。 |
| 暂不提供三栏编辑器 | 先使用 VS Code 原生 Diff 验证基础链路。 |
| 暂不解析树冲突 | 后续增加 tree conflict 样本。 |

## 6. 结论

TortoiseSVN 风格冲突面板的底座可行。

当前已经能可靠拿到：

- Working。
- Mine。
- Base。
- Theirs。
- 左右版本 revision。

下一步可以推进：

- 冲突标记已解决。
- AI 冲突解释。
- AI 合并建议预览。
- 三方内容布局优化。
