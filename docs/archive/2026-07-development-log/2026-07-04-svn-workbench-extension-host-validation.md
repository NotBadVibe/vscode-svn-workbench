# SVN Workbench Extension Host 技术验证记录

> 阶段：技术验证  
> 日期：2026-07-04  
> 原则：使用本机 Windows 开发环境验证，不使用沙盒运行时；macOS 保持同一套标准与配置入口。

## 1. 验证目标

本轮把项目从“命令行核心能力可编译”推进到“可以在真实 VS Code Extension Host 中启动验证”。

重点验证：

- 本机 VS Code CLI 是否可用。
- Extension Host 调试配置是否完整。
- 打开 SVN 工作副本时，扩展能否自动激活并刷新状态。
- 手动命令仍然可用于环境检查、状态刷新、文件夹范围提交、Diff 和 AI 连接验证。

## 2. 本机 VS Code 环境

命令：

```text
code --version
```

结果：

```text
VS Code: 1.104.0
Commit: f220831ea2d946c0dcb0f3eaa480eb435a2c1260
Arch: x64
```

结论：

- 满足 `package.json` 中 `engines.vscode: ^1.92.0` 的最低要求。
- 本机 `code` 命令可用于后续真实 Extension Host 验证。

## 3. 新增调试配置

新增文件：

```text
.vscode/tasks.json
.vscode/launch.json
```

配置项：

| 配置 | 用途 |
| --- | --- |
| Run SVN Workbench Extension | 启动普通 Extension Host，用于命令面板和基础 API 验证。 |
| Run SVN Workbench Extension With Validation WC | 启动 Extension Host 并打开本机 SVN 验证工作副本。 |

默认验证工作副本：

```text
C:\svn-workbench-validation-test-wc
```

该路径通过 VS Code `inputs.promptString` 提供，macOS 验证时可以直接输入 macOS 工作副本路径，不需要改代码。

## 4. 新增自动激活验证能力

新增激活事件：

```text
workspaceContains:.svn
```

行为：

- 当 VS Code 打开 SVN 工作副本根目录时，扩展自动激活。
- 激活后静默执行一次 `svn status --xml`。
- 解析结果写入 SCM Provider。
- 手动 `SVN: Refresh Status` 仍然保留，并显示用户提示。

设计理由：

- 符合日常使用习惯：打开项目后应直接看到 SVN 状态。
- 不强制弹窗打扰用户。
- 仍保留手动刷新入口，便于网络仓库、锁、冲突等场景重试。

## 5. 当前可验证路径

1. 在 VS Code 中打开本项目。
2. 进入 Run and Debug。
3. 选择 `Run SVN Workbench Extension With Validation WC`。
4. 启动后输入或确认工作副本路径。
5. Extension Host 打开后观察 Source Control 面板。
6. 执行命令面板：
   - `SVN: Check Environment`
   - `SVN: Refresh Status`
   - `SVN: Show Output`
   - 对文件执行 `SVN: Open Diff`

## 6. 预期结果

当前验证工作副本应出现以下 SVN 状态：

```text
? bin\Debug
? dist
! docs\readme.md
? obj
? src\pages\order\debug.log
```

SCM Provider 分组预期：

| 分组 | 文件 |
| --- | --- |
| Missing | `docs/readme.md` |
| Unversioned | `bin/Debug`, `dist`, `obj`, `src/pages/order/debug.log` |

## 7. 风险与待补验证

| 风险 | 当前状态 | 后续动作 |
| --- | --- | --- |
| 中文用户名路径下 SVN 临时文件读取失败 | 已发现并规避 | 继续统一使用 ASCII 临时目录策略。 |
| 中文工作副本路径状态读取 | 未完成 | 需要单独建立中文路径 working copy 验证。 |
| macOS Extension Host 验证 | 未完成 | 后续在 macOS 安装 Node、VS Code、SVN 后跑同一套配置。 |
| SCM Quick Diff 原始内容 Provider | 未完成 | 后续补 `svn-base` 内容提供器或统一走自研 Diff 命令。 |
| AI 自动筛选真实模型联调 | 未完成 | 等用户提供国产模型 Base URL、模型名和密钥后验证。 |

## 8. 本轮结论

本轮技术验证通过条件已经满足：

- 本机 VS Code CLI 可用。
- Extension Host 调试配置已落地。
- SVN 工作副本自动激活策略已落地。
- 现有命令行核心能力仍可继续编译验证。

下一轮建议推进：

- 启动真实 Extension Host，肉眼验收 SCM 面板分组和右键菜单。
- 补 `svn-base` 内容 Provider，让 Quick Diff 和 Diff 体验更接近正式产品。
- 建立 `@vscode/test-electron` 自动化测试，开始把 Extension Host 验证固化为可重复测试。
