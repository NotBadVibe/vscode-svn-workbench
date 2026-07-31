# SVN Workbench 本机 VSIX 安装验收

日期：2026-07-06

阶段：验收准备 -> 本机安装验收

## 背景

上一轮已经生成本地 VSIX 包。本轮继续推进交付验收，将 VSIX 安装到本机 VS Code，并验证扩展能够被 VS Code 枚举。

## 验收环境

```text
OS: Windows x64
VS Code: 1.127.0
SVN: 1.14.2-SlikSvn
Extension ID: local.svn-workbench
Extension Version: 0.0.1
```

## 安装包

```text
Path: C:\Users\杨楠\Documents\vscode-svn\svn-workbench-0.0.1.vsix
Size: 125480 bytes
SHA256: EA5E2D1C7E031C7B7E92AFBEEAA6E3DD38A56139F991699997420C6788AC735C
```

## 执行命令

```powershell
code --install-extension "C:\Users\杨楠\Documents\vscode-svn\svn-workbench-0.0.1.vsix" --force
code --list-extensions --show-versions
code --version
svn --version --quiet
npm.cmd run compile
npm.cmd run test:extension
npm.cmd audit
Get-FileHash svn-workbench-0.0.1.vsix -Algorithm SHA256
```

## 验收结果

VSIX 安装：

```text
Extension 'svn-workbench-0.0.1.vsix' was successfully installed.
```

扩展枚举：

```text
local.svn-workbench@0.0.1
```

基础验证：

- TypeScript 编译：通过
- Extension Host 测试：102 PASS
- npm audit：found 0 vulnerabilities
- VSIX SHA256：匹配交付记录

## 注意事项

安装命令输出了 VS Code CLI 自身的 Node `url.parse()` 弃用提示：

```text
DeprecationWarning: `url.parse()` behavior is not standardized...
```

该提示来自 VS Code CLI 运行环境，不是 SVN Workbench 扩展运行错误。

## 当前结论

当前 VSIX 已通过本机安装验收：

- 可以被 VS Code CLI 安装。
- 可以被 VS Code 扩展列表枚举。
- 安装后开发态回归测试仍为 102 PASS。
- 交付包指纹未变化。

## 剩余验收项

仍需在真实 VS Code UI 中执行：

1. 打开命令面板，执行 `SVN: Check Environment`。
2. 打开 SVN 工作副本，验证 SCM 状态刷新。
3. 在资源管理器右键文件夹，执行 `SVN: Commit This Scope`。
4. 验证提交页筛选、AI 选择、提交计划预览。
5. 验证更新预览、风险确认、更新后候选刷新。
6. 验证冲突中心与 AI 冲突建议。
7. 在 macOS 上重复安装和核心流程验收。

