# SVN Workbench Git 与 Extension Test 环境验证

> 阶段：技术验证  
> 日期：2026-07-04  
> 环境：本机 Windows，不使用沙盒运行时

## 1. Git 环境

安装方式：

```text
winget install --id Git.Git --exact --silent --accept-source-agreements --accept-package-agreements
```

验证：

```text
git --version
```

结果：

```text
git version 2.55.0.windows.1
```

项目初始化：

```text
git init
git config core.autocrlf false
git config core.eol lf
```

结论：

- Git CLI 已可用。
- 当前项目已初始化本地 Git 仓库。
- 项目内统一 LF，避免 Windows/macOS 协作时产生无意义换行差异。

## 2. Git 忽略规则

新增：

```text
.gitignore
```

忽略内容：

- `node_modules/`
- `out/`
- `.vscode-test/`
- `.validation/`
- `*.vsix`
- `.env*`
- 操作系统临时文件

目的：

- 保留源码、文档、调试配置。
- 排除依赖、编译产物、本地验证仓库和密钥文件。

## 3. Extension Host 自动化测试依赖

安装：

```text
npm.cmd install --save-dev @vscode/test-electron mocha @types/mocha
```

新增脚本：

```text
npm.cmd run test:extension
```

脚本行为：

1. 先执行 TypeScript 编译。
2. 使用本机 VS Code 启动 Extension Host。
3. 加载当前扩展源码。
4. 打开本机 SVN 验证工作副本。
5. 执行 Mocha 测试套件。

## 4. 当前测试覆盖

新增测试文件：

```text
src/test/runTest.ts
src/test/suite/index.ts
src/test/suite/extension.test.ts
```

测试项：

| 测试 | 目标 |
| --- | --- |
| activates and registers core commands | 验证扩展能激活，核心命令已注册。 |
| refreshes status for a validation working copy | 验证真实 SVN 工作副本能执行状态刷新。 |
| reads BASE content through the svn-base provider | 验证 Quick Diff 基线内容提供器可读取 BASE。 |

## 5. 跨平台约定

Windows 默认验证工作副本：

```text
C:\svn-workbench-validation-test-wc
```

macOS/Linux 可通过环境变量指定：

```text
SVN_WORKBENCH_TEST_WORKSPACE=/path/to/wc
```

本机 VS Code 可通过环境变量指定：

```text
VSCODE_EXECUTABLE_PATH=/path/to/code
```

如果没有可用 SVN 工作副本，真实 SVN 相关测试会跳过，基础命令注册测试仍可运行。

## 6. 风险记录

`npm install` 后报告：

```text
3 vulnerabilities (1 low, 1 moderate, 1 high)
```

当前处理：

- 先记录，不立即执行 `npm audit fix`。
- 原因是 `audit fix` 可能升级传递依赖或改变锁文件较大，放到依赖安全专项验证中统一处理。

## 7. 本轮结论

Git 环境与 Extension Host 自动化测试脚手架已建立。

下一步推进：

- 运行 `npm.cmd run test:extension`。
- 根据真实测试结果修复 Extension Host 下的问题。
- 通过后，把测试结果追加为新的验证文档。
