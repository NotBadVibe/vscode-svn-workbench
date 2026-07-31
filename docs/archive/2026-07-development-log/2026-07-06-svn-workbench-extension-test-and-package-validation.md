# SVN Workbench 测试与打包验证记录

日期：2026-07-06

阶段：交付准备

## 本轮验证内容

本轮在 102 PASS 测试基线基础上，新增交付包验证：

- 安装 `@vscode/vsce`。
- 新增 VSIX 打包脚本。
- 新增 README、CHANGELOG、LICENSE。
- 精简 VSIX 内容。
- 生成最终 VSIX。
- 记录包大小和 SHA256。

## 执行命令

```powershell
npm.cmd install --save-dev @vscode/vsce
npm.cmd run compile
npm.cmd run test:extension
npm.cmd run package:vsix
npm.cmd audit
Get-FileHash svn-workbench-0.0.1.vsix -Algorithm SHA256
```

## 结果

- TypeScript 编译：通过
- VS Code Extension Host 测试：102 PASS
- VSIX 打包：通过
- npm audit：found 0 vulnerabilities
- 最终 VSIX：`svn-workbench-0.0.1.vsix`

## 最终 VSIX 指纹

```text
Path: C:\Users\杨楠\Documents\vscode-svn\svn-workbench-0.0.1.vsix
Size: 125480 bytes
SHA256: EA5E2D1C7E031C7B7E92AFBEEAA6E3DD38A56139F991699997420C6788AC735C
```

## 当前结论

当前版本已经具备本地 VSIX 交付能力。

仍需在真实 Windows 与 macOS 用户环境中执行安装验收：

1. VS Code 执行 `Extensions: Install from VSIX...`。
2. 选择 `svn-workbench-0.0.1.vsix`。
3. 打开 SVN 工作副本。
4. 执行 `SVN: Check Environment`。
5. 验证右键提交、更新预览、冲突中心和 AI 配置流程。

