# SVN Workbench 跨平台环境诊断

日期：2026-07-06

阶段：测试 -> 验收准备

## 背景

产品要求同时运行在 Windows 和 macOS，并且两个平台的使用标准保持一致。

原有 `SVN: Check Environment` 只检查 SVN 是否可用，信息不足以支撑跨平台验收。本轮将环境检查升级为统一诊断报告，用于判断当前机器是否具备运行 SVN Workbench 的基础条件。

## 命令入口

VS Code 命令面板：

- `SVN: Check Environment`

执行后会打开 `SVN Workbench` 输出面板，展示统一诊断报告。

## 诊断内容

当前诊断项：

- 操作系统：Windows / macOS 通过，其他平台提醒。
- CPU 架构：x64 / arm64 通过，其他架构提醒。
- VS Code 版本：必须能在 Extension Host 中读取。
- SVN CLI：必须能找到 `svn` 可执行文件并读取版本。
- 工作区：检测当前打开工作区是否包含 `.svn`。
- AI 配置：检查模型服务、模型名和 API Key 是否完整。

## Windows SVN 路径标准

Windows 候选顺序：

1. 用户配置的 `svnWorkbench.svn.path`
2. `svn.exe`
3. `C:\Program Files\TortoiseSVN\bin\svn.exe`
4. `C:\Program Files\SlikSvn\bin\svn.exe`
5. `C:\Program Files\VisualSVN\bin\svn.exe`
6. `C:\Program Files\VisualSVN Server\bin\svn.exe`

## macOS SVN 路径标准

macOS 候选顺序：

1. 用户配置的 `svnWorkbench.svn.path`
2. `svn`
3. `/opt/homebrew/bin/svn`
4. `/usr/local/bin/svn`
5. `/usr/bin/svn`

说明：

- Apple Silicon 优先覆盖 Homebrew 默认路径 `/opt/homebrew/bin/svn`。
- Intel Mac 覆盖 `/usr/local/bin/svn`。
- `/usr/bin/svn` 作为系统路径兜底。

## 诊断状态

统一报告有三种状态：

- `通过`：基础运行条件完整。
- `提醒`：可以运行部分功能，但存在需要补齐的配置，例如未打开 SVN 工作副本或 AI 未配置。
- `失败`：关键依赖不可用，例如未找到 SVN CLI。

## 本机实测

当前 Windows 开发机实测：

- 平台：Windows x64
- Node：v24.18.0
- PowerShell：5.1.26100.8737
- SVN：1.14.2-SlikSvn

macOS 侧本轮完成标准和自动化测试覆盖，真实机器验收需要在 macOS 上执行同一套 `SVN: Check Environment`、提交页、更新页、冲突中心流程。

## 验收建议

Windows 验收：

1. 打开 SVN 工作副本。
2. 执行 `SVN: Check Environment`。
3. 确认 SVN CLI 通过。
4. 执行右键 `SVN: Commit This Scope`。
5. 验证提交候选、筛选预设、更新预览、风险确认。
6. 制造或打开冲突场景，验证冲突中心和 AI 建议入口。

macOS 验收：

1. 安装 SVN CLI，例如通过 Homebrew。
2. 打开 SVN 工作副本。
3. 执行同一套 `SVN: Check Environment`。
4. 确认路径解析命中 `svn`、`/opt/homebrew/bin/svn` 或 `/usr/local/bin/svn`。
5. 重复 Windows 的提交、更新、冲突中心流程。

## 核心实现

新增：

- `buildSvnExecutableCandidates`
- `buildEnvironmentDiagnosticReport`
- `formatEnvironmentDiagnosticReport`

扩展：

- `SVN: Check Environment` 输出完整诊断报告。
- SVN CLI 候选路径覆盖 Windows 和 macOS 常见安装方式。

## 验证

已通过：

- `npm.cmd run compile`
- `npm.cmd run test:extension`
- `npm.cmd audit`

新增测试：

- `builds cross-platform svn executable candidates`
- `builds environment diagnostic report`

