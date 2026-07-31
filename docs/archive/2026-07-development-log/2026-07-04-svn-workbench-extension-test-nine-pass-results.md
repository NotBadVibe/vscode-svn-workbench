# SVN Workbench Extension Host 九项测试通过记录

> 阶段：技术验证  
> 日期：2026-07-04  
> 环境：Windows + VS Code 1.104.0 + SlikSVN 1.14.2 + Git 2.55.0

## 1. 执行命令

```text
npm.cmd run test:extension
```

## 2. 运行结果

```text
PASS activates and registers core commands
PASS refreshes status for a validation working copy
PASS reads BASE content through the svn-base provider
PASS classifies generated files for commit filtering
PASS keeps folder operation scope inside the selected folder
PASS merges parent and child roots in multi selection
PASS collects root commit candidates with generated file decisions
PASS collects folder commit candidates inside the selected folder only
PASS rejects out-of-scope AI mock selections
Exit code: 0
```

## 3. 新增覆盖

| 测试 | 验证点 |
| --- | --- |
| collects root commit candidates with generated file decisions | 根目录候选收集、missing 文件、生成物排除。 |
| collects folder commit candidates inside the selected folder only | 右键文件夹只收集当前文件夹内容。 |
| rejects out-of-scope AI mock selections | AI 输出越权路径会被后端范围守卫拦截。 |

## 4. 编译与审计

```text
npm.cmd run compile -> 成功
npm.cmd audit -> found 0 vulnerabilities
```

## 5. 当前技术验证结论

本轮通过后，技术验证节点新增确认：

- 提交页候选收集可基于真实 SVN 工作副本运行。
- 文件夹右键提交范围不会扩大到其它目录。
- 生成物策略可参与候选默认选择。
- 文件类型和模板预设字段可用于 UI 筛选。
- AI 建议必须经过范围验证，不能越权提交。

## 6. 后续风险

| 风险 | 状态 | 后续动作 |
| --- | --- | --- |
| 真实提交尚未接入 UI | 未完成 | 下一轮生成提交计划并预览 `svn add/remove/commit`。 |
| 模板预设仍为内置规则 | 未完成 | 后续外置为配置文件或设置项。 |
| AI 仍为 mock | 未完成 | 后续接国产模型配置和 SecretStorage。 |
| Webview 尚未做截图验收 | 未完成 | 后续打开 Extension Host 人工验收页面布局。 |
