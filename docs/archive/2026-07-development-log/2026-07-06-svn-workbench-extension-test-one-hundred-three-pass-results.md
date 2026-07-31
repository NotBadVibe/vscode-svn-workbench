# SVN Workbench 扩展测试记录：103 PASS

日期：2026-07-06

阶段：验收准备

## 本轮验证内容

本轮新增 UI 验收清单能力，并纳入自动化测试：

- 验收清单包含固定的 6 个分组。
- 验收清单包含 13 个验收项。
- 验收清单覆盖环境、右键入口、提交页、更新页、冲突中心和跨平台一致性。
- Markdown 导出内容包含关键验收项。
- 新命令 `SVN: Open Acceptance Checklist` 已注册。

## 执行命令

```powershell
npm.cmd run compile
npm.cmd run test:extension
npm.cmd run package:vsix
npm.cmd run validate:vsix-install
npm.cmd audit
```

## 结果

- TypeScript 编译：通过
- VS Code Extension Host 测试：103 PASS
- VSIX 打包：通过
- 干净 profile 安装验证：通过
- npm audit：found 0 vulnerabilities

## 新增测试用例

新增：

- `builds UI acceptance checklist`

覆盖点：

- 分组数量。
- 验收项数量。
- 核心验收项 ID。
- Markdown 导出内容。

## 最终 VSIX 指纹

```text
Path: C:\Users\杨楠\Documents\vscode-svn\svn-workbench-0.0.1.vsix
Size: 132379 bytes
SHA256: 578A80D77F37857E2C29655DBB77487D34F6750653C94FB5879AB75C40219567
Files: 53
```

## 当前测试基线

当前自动化测试从 102 个增加到 103 个。

覆盖范围继续保持：

- SVN 环境检查与跨平台候选路径
- UI 验收清单
- 右键范围、多选范围与路径边界保护
- 提交候选筛选、筛选预设、仓库级预设和批量选择
- AI 文件选择
- AI 拆分提交建议
- 拆分队列预览、重试、草稿、失败恢复、阻止原因处理
- 提交计划预览与提交安全
- 提交说明模板、团队规范和 AI 生成
- 远端更新检查
- 更新预览、本地变更摘要、远端变更摘要、风险提示、风险确认
- 更新后候选刷新与冲突入口
- 冲突中心与 AI 冲突建议

