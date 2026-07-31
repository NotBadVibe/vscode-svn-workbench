# SVN Workbench 扩展安装验证记录

日期：2026-07-06

阶段：验收准备

## 本轮验证内容

本轮完成本机 VSIX 安装验证：

- 确认 VS Code CLI 可用。
- 确认 VSIX 文件存在。
- 确认 VSIX SHA256 与交付记录一致。
- 使用 VS Code CLI 安装 VSIX。
- 使用 VS Code CLI 枚举已安装扩展。
- 安装后重新执行编译、测试、审计。

## 关键结果

```text
Installed Extension: local.svn-workbench@0.0.1
VS Code: 1.127.0
SVN: 1.14.2-SlikSvn
Extension Host Tests: 102 PASS
npm audit: found 0 vulnerabilities
```

## 命令摘要

```powershell
code --install-extension "C:\Users\杨楠\Documents\vscode-svn\svn-workbench-0.0.1.vsix" --force
code --list-extensions --show-versions
npm.cmd run test:extension
npm.cmd audit
```

## 结论

当前版本已经满足“本机 VSIX 可安装”的交付前置条件。

下一步应进入真实 UI 验收：

- 命令面板验收。
- Explorer 右键菜单验收。
- 提交页验收。
- 更新页验收。
- 冲突中心验收。
- macOS 安装验收。

