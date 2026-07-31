# SVN Workbench UI 验收清单面板

日期：2026-07-06

阶段：验收准备

## 背景

VS Code CLI 不支持直接执行扩展命令，因此命令面板、资源管理器右键菜单和 Webview 页面仍需要人工进行真实 UI 验收。

为降低人工验收遗漏，本轮在扩展内新增 `SVN: Open Acceptance Checklist` 命令，打开一个可勾选的 UI 验收清单面板。

## 命令入口

命令面板：

```text
SVN: Open Acceptance Checklist
```

## 面板能力

验收清单面板支持：

- 展示验收分组、验收项、步骤和期望结果。
- 勾选完成项。
- 勾选状态保存在 Webview localStorage。
- 显示完成进度。
- 一键执行 `SVN: Check Environment`。
- 一键打开 `SVN Workbench` 输出面板。
- 一键打开 AI 配置页。
- 一键复制 Markdown 格式验收清单。

## 验收分组

当前包含 6 个分组、13 个验收项：

1. 环境与安装
2. 资源管理器入口
3. 提交页
4. 更新页能力
5. 冲突中心
6. 跨平台一致性

重点覆盖：

- 命令面板环境检查。
- VSIX 安装状态。
- 右键文件夹只提交当前范围。
- 右键打开冲突中心。
- 提交候选筛选、生成物隐藏和批量选择。
- 提交计划预览与安全拦截。
- AI 选择、拆分和提交说明。
- 更新预览与风险确认。
- 更新后候选刷新与冲突入口。
- 冲突中心 AI 建议。
- Windows 与 macOS 安装及流程一致性。

## 核心实现

新增：

- `src/diagnostics/acceptanceChecklist.ts`
- `src/diagnostics/acceptanceChecklistPanel.ts`

扩展：

- `package.json` 新增 activation event 和 command。
- `extension.ts` 注册 `svnWorkbench.openAcceptanceChecklist`。
- README 与 CHANGELOG 补充入口说明。

## 验证

已通过：

- `npm.cmd run compile`
- `npm.cmd run test:extension`
- `npm.cmd run package:vsix`
- `npm.cmd run validate:vsix-install`
- `npm.cmd audit`

新增测试：

- `builds UI acceptance checklist`

