# SVN Workbench 干净 Profile VSIX 安装验证脚本

日期：2026-07-06

阶段：验收准备

## 背景

VS Code CLI 不提供直接执行扩展命令的通用参数，因此真实 UI 验收仍需要人工在 VS Code 中操作。

为降低交付前安装验证遗漏，本轮新增一个自动化脚本：使用独立 `user-data-dir` 和 `extensions-dir` 安装 VSIX，并验证扩展能在干净扩展目录中被枚举。

## 新增脚本

```text
scripts/validate-vsix-install.js
```

新增 npm 命令：

```powershell
npm run validate:vsix-install
```

## 脚本行为

脚本会执行：

1. 读取 `package.json`，生成期望扩展 ID：`local.svn-workbench@0.0.1`。
2. 查找当前 VSIX：`svn-workbench-0.0.1.vsix`。
3. 计算 VSIX SHA256。
4. 创建独立验收目录：

```text
.validation/vsix-install-acceptance/<runId>/user-data
.validation/vsix-install-acceptance/<runId>/extensions
```

5. 执行：

```powershell
code --user-data-dir <user-data> --extensions-dir <extensions> --install-extension <vsix> --force
```

6. 执行：

```powershell
code --user-data-dir <user-data> --extensions-dir <extensions> --list-extensions --show-versions
```

7. 验证列表包含：

```text
local.svn-workbench@0.0.1
```

8. 写入验收摘要：

```text
.validation/vsix-install-acceptance/latest-summary.json
```

## 包内容控制

脚本本身用于开发与验收，不进入 VSIX。

`.vscodeignore` 已排除：

```text
scripts/**
```

## 注意事项

VS Code CLI 当前会输出 Node `url.parse()` 弃用提示：

```text
DeprecationWarning: `url.parse()` behavior is not standardized...
```

该提示来自 VS Code CLI，不是 SVN Workbench 扩展错误。

## 验证结果

本轮脚本已成功执行，干净 profile 中可以枚举：

```text
local.svn-workbench@0.0.1
```

