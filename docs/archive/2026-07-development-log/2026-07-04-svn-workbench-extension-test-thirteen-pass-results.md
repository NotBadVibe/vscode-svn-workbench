# SVN Workbench Extension Host 十三项测试通过记录

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
Exit code: 0
```

## 3. 新增覆盖

| 测试 | 验证点 |
| --- | --- |
| builds commit plan preview for missing files | `missing` 文件会生成 `svn remove` + `svn commit` 预览。 |
| blocks generated files in commit plan preview | 生成物即使被传入后端，也不能进入提交计划。 |
| blocks out-of-scope files in commit plan preview | 越过右键范围的路径会被阻止。 |

## 4. 编译与审计

```text
npm.cmd run compile -> 成功
npm.cmd audit -> found 0 vulnerabilities
```

## 5. 当前结论

提交页已经从“候选列表原型”推进到“提交计划预览原型”。

当前仍不执行真实提交，符合本阶段安全目标。
