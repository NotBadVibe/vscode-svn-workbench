# SVN Workbench VSIX 交付准备

日期：2026-07-06

阶段：交付准备

## 背景

当前功能已经进入交付前收口阶段，需要确认扩展可以被打包成 VSIX，并且交付包中只包含运行和安装所需内容。

本轮新增 VSIX 打包能力、README、CHANGELOG、许可证说明，并收紧 `.vscodeignore`。

## 新增交付文件

- `README.md`
- `CHANGELOG.md`
- `LICENSE`

## 新增脚本

```powershell
npm run package:vsix
```

该脚本执行：

```powershell
vsce package --no-dependencies --allow-missing-repository
```

同时通过 `vscode:prepublish` 自动执行编译。

## VSIX 包内容

最终包：

```text
C:\Users\杨楠\Documents\vscode-svn\svn-workbench-0.0.1.vsix
```

包大小：

```text
125480 bytes
```

文件数量：

```text
51 files
```

SHA256：

```text
EA5E2D1C7E031C7B7E92AFBEEAA6E3DD38A56139F991699997420C6788AC735C
```

## 打包清单摘要

VSIX 包含：

- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- `package.json`
- `out/**` 运行时代码

VSIX 不包含：

- `src/**`
- `docs/**`
- `node_modules/**`
- `out/test/**`
- `out/**/*.map`
- `.agents/**`
- `.codex/**`
- `.validation/**`
- `.vscode-test/**`
- `package-lock.json`
- `tsconfig.json`

## 验证命令

```powershell
npm.cmd run test:extension
npm.cmd run package:vsix
npm.cmd audit
Get-FileHash svn-workbench-0.0.1.vsix -Algorithm SHA256
```

## 验证结果

- Extension Host 测试：102 PASS
- VSIX 打包：通过
- npm audit：found 0 vulnerabilities
- `vsce package`：无警告

## 交付说明

本轮生成的是本地技术验证 VSIX，不是公开 Marketplace 发布包。

后续如果要公开发布，需要补充：

- 正式 publisher。
- repository URL。
- Marketplace icon。
- Marketplace README 截图。
- 公开许可证策略。
- 版本号与发布说明策略。

