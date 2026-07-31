# SVN Workbench 操作范围测试修正记录

> 阶段：技术验证  
> 日期：2026-07-04  
> 说明：本文件补充记录测试语义修正，不修改旧文档。

## 1. 发现的问题

新增范围测试首次运行时失败：

```text
FAIL keeps folder operation scope inside the selected folder

actual: explorerMultiSelection
expected: explorerFolder
```

原因：

测试传入的是：

```text
selectedFolder + childFile
```

这在真实 VS Code 语义中属于多选场景，不是单纯右键一个文件夹。

## 2. 修正后的语义

拆成两个测试：

| 测试 | 输入 | 预期 |
| --- | --- | --- |
| keeps folder operation scope inside the selected folder | 单个文件夹 | `explorerFolder` |
| merges parent and child roots in multi selection | 文件夹 + 子文件 | `explorerMultiSelection`，并合并为一个父文件夹 root |

## 3. 产品结论

这一点对后续提交页很重要：

- 用户右键一个文件夹：页面标题和范围提示应显示“当前文件夹”。
- 用户多选文件夹和文件：页面应显示“多选范围”，但内部去重后只保留必要根路径。
- 无论单选还是多选，提交候选都不能越过 `OperationScope` 边界。

## 4. 后续设计建议

提交页面可以把范围来源显示得更清楚：

| 来源 | 页面提示 |
| --- | --- |
| explorerFolder | 当前文件夹 |
| explorerFile | 当前文件 |
| explorerMultiSelection | 已选择 N 个范围，已自动合并重复父子路径 |
| workspace | 整个工作副本 |
