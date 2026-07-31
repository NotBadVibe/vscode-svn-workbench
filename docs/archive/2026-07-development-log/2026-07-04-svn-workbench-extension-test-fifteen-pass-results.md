# SVN Workbench Extension Host 十五项测试通过记录

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
PASS opens commit panel for the selected folder command
PASS builds commit plan preview for missing files
PASS blocks generated files in commit plan preview
PASS blocks out-of-scope files in commit plan preview
PASS validates commit message templates
PASS converts commit preview to commit flow plan
Exit code: 0
```

## 3. 新增覆盖

| 测试 | 验证点 |
| --- | --- |
| validates commit message templates | 模板可用，空提交说明会被阻止。 |
| converts commit preview to commit flow plan | 预览计划可以安全转换成真实提交计划。 |

## 4. 编译与审计

```text
npm.cmd run compile -> 成功
npm.cmd audit -> found 0 vulnerabilities
```

## 5. 说明

测试中不会执行真实 `svn commit`。

真实提交入口已经存在于页面中，但需要用户在 VS Code 原生确认框中点击 `确认提交`，避免自动化测试污染本机 SVN 验证仓库。
