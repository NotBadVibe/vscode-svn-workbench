# SVN Workbench 中文菜单与手工测试环境验证记录

日期：2026-07-06

## 本轮目标

修复 VS Code 右键菜单与可见入口中文不完整的问题，并创建可重复生成的手工 UI 测试环境，让后续验收可以按固定清单执行。

## 已完成调整

- `package.json` 命令标题统一为中文：
  - `SVN：检查环境`
  - `SVN：刷新状态`
  - `SVN：提交当前范围`
  - `SVN：打开冲突中心`
  - `SVN：打开差异对比`
  - `SVN：打开团队配置`
  - `SVN：配置团队规则`
  - `SVN：显示输出`
  - `SVN：AI 配置模型`
  - `SVN：AI 测试连接`
  - `SVN：AI 选择当前范围`
  - `SVN：打开验收清单`
- SCM 面板分组和文件项动作改为中文。
- 验收清单与环境诊断里的命令提示改为中文命令名。
- 新增 `npm run prepare:manual-test-env`，用于创建可重置的 SVN 手工验收环境。
- 新增手工操作文档：`2026-07-06-svn-workbench-manual-ui-test-environment-and-checklist.md`。

## 手工测试环境

- SVN 仓库：`C:\svn-workbench-manual-ui-acceptance\repo`
- 本地工作副本：`C:\svn-workbench-manual-ui-acceptance\wc`
- 远端模拟工作副本：`C:\svn-workbench-manual-ui-acceptance\remote-wc`
- 环境说明：`C:\svn-workbench-manual-ui-acceptance\README-manual-acceptance.md`

打开方式：

```powershell
code "C:\svn-workbench-manual-ui-acceptance\wc"
```

重置方式：

```powershell
cd "C:\Users\杨楠\Documents\vscode-svn"
npm run prepare:manual-test-env
```

## 预置状态

```text
?       C:\svn-workbench-manual-ui-acceptance\wc\bin
M       C:\svn-workbench-manual-ui-acceptance\wc\config\app.json
?       C:\svn-workbench-manual-ui-acceptance\wc\config\local.dev.json
?       C:\svn-workbench-manual-ui-acceptance\wc\dist
!       C:\svn-workbench-manual-ui-acceptance\wc\docs\readme.md
?       C:\svn-workbench-manual-ui-acceptance\wc\obj
?       C:\svn-workbench-manual-ui-acceptance\wc\src\pages\order\NewFeature.ts
M       C:\svn-workbench-manual-ui-acceptance\wc\src\pages\order\OrderList.vue
?       C:\svn-workbench-manual-ui-acceptance\wc\src\pages\order\debug.log
A       C:\svn-workbench-manual-ui-acceptance\wc\src\pages\user\UserProfile.vue
```

远端更新检查：

```text
M       *        1   C:\svn-workbench-manual-ui-acceptance\wc\src\pages\order\OrderList.vue
?                    C:\svn-workbench-manual-ui-acceptance\wc\src\pages\order\debug.log
?                    C:\svn-workbench-manual-ui-acceptance\wc\src\pages\order\NewFeature.ts
        *            C:\svn-workbench-manual-ui-acceptance\wc\src\pages\order\RemoteOnly.vue
        *        1   C:\svn-workbench-manual-ui-acceptance\wc\src\pages\order
A                -   C:\svn-workbench-manual-ui-acceptance\wc\src\pages\user\UserProfile.vue
?                    C:\svn-workbench-manual-ui-acceptance\wc\dist
M                1   C:\svn-workbench-manual-ui-acceptance\wc\config\app.json
?                    C:\svn-workbench-manual-ui-acceptance\wc\config\local.dev.json
?                    C:\svn-workbench-manual-ui-acceptance\wc\bin
!                1   C:\svn-workbench-manual-ui-acceptance\wc\docs\readme.md
?                    C:\svn-workbench-manual-ui-acceptance\wc\obj
Status against revision:      2
```

## 验证命令

```powershell
npm run compile
npm run test:extension
npm audit
npm run package:vsix
npm run validate:vsix-install
code --install-extension "C:\Users\杨楠\Documents\vscode-svn\svn-workbench-0.0.1.vsix" --force
```

## 验证结果

- TypeScript 编译：通过。
- VS Code Extension Host 自动化测试：103 PASS。
- `npm audit`：0 vulnerabilities。
- VSIX 清洁 profile 安装验证：通过。
- 当前 VS Code 安装列表：`local.svn-workbench@0.0.1`。
- VSIX 路径：`C:\Users\杨楠\Documents\vscode-svn\svn-workbench-0.0.1.vsix`
- VSIX SHA256：`0D0FD27524E264C9B48F3C7409A63D2C993A56DD99233398867ED8E4D445F284`
- VSIX 大小：`132856` bytes。

## 下一步人工操作

按 `2026-07-06-svn-workbench-manual-ui-test-environment-and-checklist.md` 执行：

1. 打开 `C:\svn-workbench-manual-ui-acceptance\wc`。
2. 命令面板搜索 `SVN：`，确认命令全为中文。
3. 右键 `src/pages/order`，执行 `SVN：提交当前范围`。
4. 验证候选列表只包含当前文件夹范围。
5. 验证文件类型、状态、模板预设、隐藏生成物筛选。
6. 点击 `预览更新`，验证本地/远端/重叠风险提示。
7. 打开 `SVN：打开冲突中心`，验证无冲突空状态或冲突列表。
