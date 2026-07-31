# SVN Workbench v2 完整状态环境与 AI 右键菜单验证记录

日期：2026-07-06

## 本轮修复点

用户反馈：

- 测试环境没有直接提供真实冲突文件。
- 测试环境没有覆盖修改、新增、删除等完整 SVN 状态。
- 右键菜单没有 AI 配置模型等 AI 相关入口。

本轮处理：

- 新增 v2 手工测试环境：`C:\svn-workbench-manual-ui-acceptance-v2`。
- 在 v2 环境中制造真实 SVN 文本冲突。
- 在 v2 环境中覆盖 `C/M/A/D/!/ ?` 状态。
- 资源管理器右键菜单新增 AI 入口。
- 内置 UI 验收清单新增“右键 AI 操作入口”验收项。
- 新增操作清单：`2026-07-06-svn-workbench-manual-ui-full-state-env-v2-checklist.md`。

## v2 环境路径

- SVN 仓库：`C:\svn-workbench-manual-ui-acceptance-v2\repo`
- 本地工作副本：`C:\svn-workbench-manual-ui-acceptance-v2\wc`
- 远端模拟工作副本：`C:\svn-workbench-manual-ui-acceptance-v2\remote-wc`

打开方式：

```powershell
code "C:\svn-workbench-manual-ui-acceptance-v2\wc"
```

重置方式：

```powershell
cd "C:\Users\杨楠\Documents\vscode-svn"
npm run prepare:manual-test-env
```

## 已验证 SVN 状态

```text
?       C:\svn-workbench-manual-ui-acceptance-v2\wc\bin
M       C:\svn-workbench-manual-ui-acceptance-v2\wc\config\app.json
?       C:\svn-workbench-manual-ui-acceptance-v2\wc\config\local.dev.json
?       C:\svn-workbench-manual-ui-acceptance-v2\wc\dist
!       C:\svn-workbench-manual-ui-acceptance-v2\wc\docs\readme.md
?       C:\svn-workbench-manual-ui-acceptance-v2\wc\obj
C       C:\svn-workbench-manual-ui-acceptance-v2\wc\src\pages\conflict\ConflictDemo.vue
?       C:\svn-workbench-manual-ui-acceptance-v2\wc\src\pages\conflict\ConflictDemo.vue.mine
?       C:\svn-workbench-manual-ui-acceptance-v2\wc\src\pages\conflict\ConflictDemo.vue.r1
?       C:\svn-workbench-manual-ui-acceptance-v2\wc\src\pages\conflict\ConflictDemo.vue.r2
D       C:\svn-workbench-manual-ui-acceptance-v2\wc\src\pages\order\DeletedByLocal.ts
?       C:\svn-workbench-manual-ui-acceptance-v2\wc\src\pages\order\NewFeature.ts
M       C:\svn-workbench-manual-ui-acceptance-v2\wc\src\pages\order\OrderList.vue
?       C:\svn-workbench-manual-ui-acceptance-v2\wc\src\pages\order\debug.log
A       C:\svn-workbench-manual-ui-acceptance-v2\wc\src\pages\user\UserProfile.vue
Summary of conflicts:
  Text conflicts: 1
```

## 右键菜单入口

资源管理器右键菜单当前包含：

- `SVN：提交当前范围`
- `SVN：打开冲突中心`
- `SVN：打开差异对比`
- `SVN：打开团队配置`
- `SVN：配置团队规则`
- `SVN：AI 配置模型`
- `SVN：AI 测试连接`
- `SVN：AI 选择当前范围`，仅右键文件夹时显示。

## 验证命令

```powershell
npm run prepare:manual-test-env
npm run compile
npm run test:extension
npm audit
npm run package:vsix
npm run validate:vsix-install
code --install-extension "C:\Users\杨楠\Documents\vscode-svn\svn-workbench-0.0.1.vsix" --force
```

## 验证结果

- v2 环境生成：通过。
- TypeScript 编译：通过。
- VS Code Extension Host 自动化测试：103 PASS。
- `npm audit`：0 vulnerabilities。
- VSIX 清洁 profile 安装验证：通过。
- 当前 VS Code 安装列表：`local.svn-workbench@0.0.1`。
- VSIX 路径：`C:\Users\杨楠\Documents\vscode-svn\svn-workbench-0.0.1.vsix`
- VSIX SHA256：`1024544A272DBD8A6562C040FE6928D2FCC10E874BA776620FA9EA361ABEB19B`
- VSIX 大小：`133054` bytes。

## 用户下一步操作

1. 打开 `C:\svn-workbench-manual-ui-acceptance-v2\wc`。
2. 右键 `src/pages/conflict`，点击 `SVN：打开冲突中心`。
3. 右键 `src/pages/order`，点击 `SVN：提交当前范围`。
4. 右键根目录 `wc`，点击 `SVN：AI 配置模型`。
5. 配置模型后，再右键执行 `SVN：AI 测试连接` 和 `SVN：AI 选择当前范围`。
