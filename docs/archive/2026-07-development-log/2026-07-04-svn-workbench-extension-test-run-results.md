# SVN Workbench Extension Host 自动化测试运行结果

> 阶段：技术验证  
> 日期：2026-07-04  
> 环境：Windows + VS Code 1.104.0 + SlikSVN 1.14.2 + Git 2.55.0

## 1. 执行命令

```text
npm.cmd run test:extension
```

脚本内容：

```text
npm run compile && node ./out/test/runTest.js
```

## 2. 测试环境

使用：

```text
@vscode/test-electron
```

工作副本：

```text
C:\svn-workbench-validation-test-wc
```

扩展开发路径：

```text
C:\Users\杨楠\Documents\vscode-svn
```

## 3. 运行结果

```text
PASS activates and registers core commands
PASS refreshes status for a validation working copy
PASS reads BASE content through the svn-base provider
Exit code: 0
```

结论：

- 扩展可在真实 VS Code Extension Host 中激活。
- 核心命令已注册。
- 真实 SVN 工作副本可执行状态刷新。
- `svn-base` 内容提供器可读取 BASE 内容，Quick Diff 技术底座通过。

## 4. 编译与依赖安全

编译：

```text
npm.cmd run compile -> 成功
```

依赖审计：

```text
npm.cmd audit -> found 0 vulnerabilities
```

调整：

- 移除 `mocha` 和 `@types/mocha`。
- 保留 `@vscode/test-electron`。
- 使用轻量自定义测试 runner。

## 5. 后续测试扩展方向

下一步建议增加以下 Extension Host 用例：

| 用例 | 目的 |
| --- | --- |
| Explorer 右键文件夹提交范围 | 验证只提交当前文件夹内容。 |
| 生成物过滤 | 验证 `bin/dist/obj/log` 默认不进入提交候选。 |
| Missing 文件 Diff | 验证被删除文件可从 BASE 预览和恢复。 |
| Unversioned 文件 Diff | 验证新增文件显示“无基线版本”。 |
| AI 文件筛选 mock | 验证 AI 返回越权路径时会被拦截。 |

## 6. 本轮结论

技术验证节点继续推进成功。

当前已经形成：

- 本机 Git 环境。
- 本地 Git 仓库。
- 可重复 Extension Host 自动化测试。
- 0 漏洞的测试依赖状态。
