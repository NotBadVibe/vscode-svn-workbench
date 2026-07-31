# SVN Workbench 提交页原型实现记录

> 阶段：技术验证  
> 日期：2026-07-04  
> 目标：把“提交页候选文件列表 + 生成物过滤 + AI mock 筛选”落到可运行原型。

## 1. 本轮实现范围

新增能力：

- 右键 SVN 文件夹后打开 Webview 提交页。
- 按当前 `OperationScope` 收集 SVN 状态。
- 候选文件默认带出：
  - SVN 状态
  - 文件类型
  - 模板预设分组
  - 生成物策略
  - 默认选择状态
  - 选择原因
- 页面支持筛选：
  - 搜索路径
  - SVN 状态
  - 文件类型
  - 模板预设
  - 隐藏生成物
- 页面支持 AI mock 筛选，并展示越权路径拦截数量。

## 2. 新增源码

```text
src/commit/commitCandidateCollector.ts
src/commit/commitPanel.ts
src/ai/mockAiSelection.ts
```

更新：

```text
src/extension.ts
package.json
src/test/suite/index.ts
```

## 3. 候选文件模型

候选文件字段：

| 字段 | 说明 |
| --- | --- |
| `absolutePath` | 本机绝对路径。 |
| `relativePath` | 相对工作副本根路径。 |
| `status` | SVN 状态。 |
| `fileType` | 文件类型，例如 `vue`、`md`、`log`、`folder`。 |
| `templateGroup` | 模板预设分组。 |
| `generatedDecision` | 生成物策略：`include`、`review`、`exclude`。 |
| `selection` | 默认选择：`selected`、`needsReview`、`excluded`、`blocked`。 |
| `reason` | 默认选择原因。 |

## 4. 默认选择规则

| 条件 | 默认状态 |
| --- | --- |
| `conflicted` / `obstructed` / `incomplete` | blocked |
| 命中生成物排除规则 | excluded |
| `ignored` / `external` / `normal` | excluded |
| `missing` | needsReview |
| `unversioned` | needsReview |
| `bin` 下非 Debug/Release 文件 | needsReview |
| 常规 modified/added/deleted/replaced | selected |

## 5. 模板预设分组

当前原型内置：

| 分组 | 示例 |
| --- | --- |
| frontend | `vue`、`tsx`、`ts`、`js`、`scss`、`css` |
| backend | `java`、`cs`、`go`、`py`、`php` |
| document | `docs/`、`md`、`txt` |
| config | `json`、`yml`、`xml`、`ini` |
| asset | `png`、`jpg`、`svg`、`ico` |
| other | 其他 |

后续可以把这些规则外置为用户可配置模板。

## 6. AI mock 越权拦截

AI mock 会根据候选文件给出推荐、排除、待确认和阻止结果，同时故意注入一个越权路径：

```text
../ai-out-of-scope.txt
```

后端通过：

```text
validateAiSelectionResult(scope, rawResult)
```

拦截越权路径。

产品结论：

- AI 可以参与筛选。
- AI 不能扩大用户选择范围。
- AI 输出必须先经过后端范围守卫，再进入页面。

## 7. Webview 页面状态

当前页面是技术验证版，已具备可操作原型。

已完成：

- 现代化轻量布局。
- 表格候选列表。
- 多维筛选。
- 生成物隐藏。
- 默认勾选状态。
- AI mock 结果提示。

未完成：

- 真实提交按钮。
- 提交说明模板。
- 文件分组折叠。
- Missing 文件恢复。
- Unversioned 文件加入 SVN。
- 冲突三方处理。
- 真实模型选择和密钥管理。

## 8. 下一步

建议继续推进：

- 提交页真实提交计划生成。
- 提交说明模板与历史记忆。
- `svn add` / `svn remove` 预处理预览。
- AI mock 升级为可配置国产模型调用。
