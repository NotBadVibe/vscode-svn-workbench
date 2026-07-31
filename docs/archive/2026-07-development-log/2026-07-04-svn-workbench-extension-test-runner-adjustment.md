# SVN Workbench Extension Test Runner 调整记录

> 阶段：技术验证  
> 日期：2026-07-04  
> 说明：本文件是对上一份测试环境文档的补充，不修改旧文档。

## 1. 调整原因

首次安装测试依赖时使用：

```text
@vscode/test-electron
mocha
@types/mocha
```

`npm audit` 显示漏洞来自 `mocha` 的传递依赖：

```text
3 vulnerabilities (1 low, 1 moderate, 1 high)
```

涉及：

- `diff`
- `serialize-javascript`

`npm audit fix` 建议使用 `--force`，会改变测试依赖版本。当前阶段只有少量基础用例，不值得为此引入额外依赖风险。

## 2. 调整方案

保留：

```text
@vscode/test-electron
```

移除：

```text
mocha
@types/mocha
```

改为：

```text
src/test/suite/index.ts
```

内部直接定义轻量测试 runner。

## 3. 保留的测试覆盖

| 测试 | 状态 |
| --- | --- |
| 扩展激活与命令注册 | 保留 |
| 真实 SVN 工作副本状态刷新 | 保留 |
| `svn-base` BASE 内容读取 | 保留 |

## 4. 设计取舍

优点：

- 减少测试依赖。
- 避免当前已知漏洞链。
- 更适合技术验证阶段的轻量回归。

限制：

- 暂时没有 Mocha 的分组、过滤、丰富报告能力。
- 后续测试规模扩大后，可以重新评估 Vitest、Mocha 或 VS Code 官方推荐结构。

## 5. 结论

当前阶段优先选择轻量测试 runner。

正式开发阶段如果测试用例明显增长，再单独做测试框架选型，不在技术验证阶段提前绑定重依赖。
