# SVN Workbench 提交页命令测试补充

> 阶段：技术验证  
> 日期：2026-07-04  
> 说明：本文件补充记录 Webview 提交页入口测试，不修改旧文档。

## 1. 新增测试

新增 Extension Host 测试：

```text
opens commit panel for the selected folder command
```

执行内容：

```text
vscode.commands.executeCommand(
  'svnWorkbench.commitFolder',
  vscode.Uri.joinPath(workspace.uri, 'src', 'pages', 'order')
)
```

## 2. 验证意义

该测试覆盖：

- 命令注册可调用。
- 能按选中文件夹创建 `OperationScope`。
- 能收集提交候选文件。
- 能创建 Webview 提交页。
- 命令执行过程不抛异常。

## 3. 限制

该测试不验证页面视觉布局，只验证命令链路可运行。

页面布局仍需要后续在真实 VS Code 窗口中人工验收或用截图工具补充验证。
