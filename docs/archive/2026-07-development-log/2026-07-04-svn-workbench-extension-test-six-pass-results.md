# SVN Workbench Extension Host 六项测试通过记录

> 阶段：技术验证  
> 日期：2026-07-04  
> 环境：Windows + VS Code 1.104.0 + SlikSVN 1.14.2 + Git 2.55.0

## 1. 执行命令

```text
npm.cmd run test:extension
```

结果：

```text
PASS activates and registers core commands
PASS refreshes status for a validation working copy
PASS reads BASE content through the svn-base provider
PASS classifies generated files for commit filtering
PASS keeps folder operation scope inside the selected folder
PASS merges parent and child roots in multi selection
Exit code: 0
```

## 2. 当前测试覆盖

| 测试 | 验证点 |
| --- | --- |
| activates and registers core commands | 扩展激活与核心命令注册。 |
| refreshes status for a validation working copy | 真实 SVN 工作副本状态刷新。 |
| reads BASE content through the svn-base provider | Quick Diff BASE 内容读取。 |
| classifies generated files for commit filtering | 生成物过滤策略。 |
| keeps folder operation scope inside the selected folder | 右键文件夹提交范围不越界。 |
| merges parent and child roots in multi selection | 多选父子路径自动合并。 |

## 3. 编译与安全

编译：

```text
npm.cmd run compile -> 成功
```

依赖审计：

```text
npm.cmd audit -> found 0 vulnerabilities
```

依赖调整：

- `@types/vscode` 固定为 `1.92.0`，与最低兼容 VS Code API 对齐。
- 不使用 Mocha，避免引入当前已知漏洞链。

## 4. 产品意义

这轮测试已经把几个核心产品约束固化下来：

- SVN 插件能在真实 VS Code Extension Host 中运行。
- 文件夹右键操作不会扩大提交范围。
- 常见生成物默认排除。
- 普通 `bin` 业务脚本进入 review，而不是直接排除。
- Quick Diff 可以读取 SVN BASE 内容。
- 多选路径会自动合并父子重复范围。

## 5. 下一步

继续技术验证时，建议补以下用例：

- 未版本控制文件 Diff 友好提示。
- Missing 文件恢复入口。
- 提交页候选文件列表。
- AI 文件筛选 mock，用于验证越权路径拦截。
- 冲突文件三方信息读取。
