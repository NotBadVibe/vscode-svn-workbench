# SVN Workbench Quick Diff 技术验证记录

> 阶段：技术验证  
> 日期：2026-07-04  
> 前置：Extension Host 调试配置已新增，本机 VS Code CLI 可用。

## 1. 本轮目标

补齐 SCM 面板中的 Quick Diff 基线读取能力，让用户在 Source Control 中查看文件差异时，不再只依赖临时 `untitled` 文件，而是走 VS Code 标准内容提供器。

## 2. 实现方式

新增：

```text
src/diff/svnBaseContentProvider.ts
```

核心机制：

```text
svn-base:<file-uri> -> svn cat -r BASE <file>
```

扩展注册：

```text
vscode.workspace.registerTextDocumentContentProvider('svn-base', provider)
```

SCM Provider：

```text
sourceControl.quickDiffProvider.provideOriginalResource(...)
```

## 3. 用户体验变化

现在有两条差异查看路径：

| 场景 | 行为 |
| --- | --- |
| SCM 面板 Quick Diff | VS Code 请求 `svn-base` 内容，扩展读取 BASE 版本。 |
| 右键 `SVN: Open Diff` | 打开 `BASE -> Working` 双栏 Diff。 |

这一步还不是 TortoiseSVN 那种完整冲突三栏面板，但已经打通了 VS Code 原生差异能力的底座。

## 4. 跨平台标准

Windows 与 macOS 统一：

- 都使用 VS Code URI 传递文件路径。
- 都通过 `svn cat -r BASE` 获取基线内容。
- 都不拼接 shell 命令，避免空格、中文、特殊字符路径导致命令注入或转义问题。

平台差异只由：

- VS Code `Uri.fsPath`
- Node `spawn(..., { shell: false })`
- SVN CLI

共同处理。

## 5. 已知限制

| 限制 | 说明 | 后续处理 |
| --- | --- | --- |
| 新增文件没有 BASE | `svn cat -r BASE` 会失败并返回空内容 | Diff 面板后续显示“新增文件”提示。 |
| 缺失文件读取 BASE 需继续验证 | 当前实现依赖 SVN CLI 对 missing path 的支持 | 后续在工作副本中实测 missing 文件 Diff。 |
| 冲突三方合并未完成 | 当前只完成 BASE 与 Working 对比 | 设计阶段的 AI 冲突处理会单独落地。 |

## 6. 本轮结论

Quick Diff 技术路线可行，当前已经具备最小实现：

- 有标准 URI scheme。
- 有基线内容提供器。
- 有 SCM Provider 对接。
- 有右键 Diff 命令复用同一套基线 URI。

下一步可以进入 Extension Host 肉眼验收，并把缺失文件、新增文件、冲突文件分别作为验收用例。
