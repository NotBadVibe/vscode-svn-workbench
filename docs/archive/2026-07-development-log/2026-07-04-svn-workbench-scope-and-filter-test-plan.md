# SVN Workbench 范围与过滤自动化测试补充

> 阶段：技术验证  
> 日期：2026-07-04  
> 说明：本文件补充记录本轮新增测试覆盖，不修改旧文档。

## 1. 背景

用户重点关注：

- 右键选中某个文件夹时，只提交当前文件夹内容。
- 提交页要能过滤 `bin/dist/obj/log` 等生成物。
- 普通 `bin` 目录中的脚本类文件不能一刀切排除。

因此本轮把这些规则纳入 Extension Host 自动化测试。

## 2. 新增测试一：生成物过滤

覆盖规则：

| 路径 | 预期 |
| --- | --- |
| `dist/app.js` | exclude |
| `obj/Debug/net8.0/app.dll` | exclude |
| `src/pages/order/debug.log` | exclude |
| `bin/Debug/app.dll` | exclude |
| `bin/deploy.sh` | review |
| `src/pages/order/OrderList.vue` | include |

结论：

- 常见生成物默认排除。
- `bin/deploy.sh` 这类可能是业务脚本的文件进入 review，不直接排除。

## 3. 新增测试二：文件夹操作范围

验证场景：

```text
右键选择 src/pages/order 文件夹
```

预期：

- `OperationScope.source = explorerFolder`
- `allowExpandScope = false`
- `includeExternals = false`
- `includeNestedWorkingCopies = false`
- 父文件夹与子文件同时选择时，只保留父文件夹根。

范围校验：

| 文件 | 预期 |
| --- | --- |
| `src/pages/order/OrderList.vue` | validItems |
| `config/app.json` | outOfScopeItems |

结论：

- 右键文件夹提交范围不会自动扩大到其它目录。
- 后续提交页候选文件必须先经过 `OperationScope` 边界校验。

## 4. 技术意义

这两个测试把早期产品设计里的关键使用习惯固化为工程约束：

- 用户选哪里，就只处理哪里。
- 生成物默认不打扰。
- 业务脚本不被粗暴排除。
- AI 后续即使参与筛选，也必须受范围边界和过滤规则约束。
