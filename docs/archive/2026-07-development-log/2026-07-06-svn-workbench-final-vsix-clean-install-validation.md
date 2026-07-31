# SVN Workbench 最终 VSIX 干净安装验证

日期：2026-07-06

阶段：验收准备 -> 交付前验证

## 本轮目标

在已有本机安装验收基础上，增加“干净 profile 安装验证”，确保 VSIX 不依赖当前用户已有扩展状态。

## 最终 VSIX

```text
Path: C:\Users\杨楠\Documents\vscode-svn\svn-workbench-0.0.1.vsix
Size: 125539 bytes
SHA256: EC0375EDD2F78885FD08E6DE4596F56FFACE61C1B25E4D3E760721699411FEFA
Files: 51
```

## 干净 Profile 验收摘要

```text
Run ID: 2026-07-06T14-34-19-948Z
Expected Extension: local.svn-workbench@0.0.1
VS Code: 1.127.0 / 4fe60c8b1cdac1c4c174f2fb180d0d758272d713 / x64
Installed Extensions: local.svn-workbench@0.0.1
```

摘要文件：

```text
.validation/vsix-install-acceptance/latest-summary.json
```

## 执行命令

```powershell
npm.cmd run package:vsix
npm.cmd run validate:vsix-install
code --install-extension "C:\Users\杨楠\Documents\vscode-svn\svn-workbench-0.0.1.vsix" --force
npm.cmd run test:extension
npm.cmd audit
```

## 验证结果

- VSIX 打包：通过
- 干净 profile 安装：通过
- 当前 VS Code 用户环境覆盖安装：通过
- Extension Host 测试：102 PASS
- npm audit：found 0 vulnerabilities

## 说明

本轮最终 VSIX 指纹已变更为：

```text
EC0375EDD2F78885FD08E6DE4596F56FFACE61C1B25E4D3E760721699411FEFA
```

原因是新增了 `validate:vsix-install` 脚本入口，并在 README 中补充了该验证命令。旧文档中的较早 VSIX 指纹仅代表当时打包结果，交付时以本文件记录为准。

## 剩余事项

自动化已经覆盖安装层面。仍需人工在 VS Code UI 中确认：

- 命令面板可见并可执行 `SVN: Check Environment`。
- Explorer 右键菜单可见。
- 提交页 Webview 可打开并响应筛选。
- 更新预览和更新确认可用。
- 冲突中心可打开。
- macOS 机器重复安装验收。

