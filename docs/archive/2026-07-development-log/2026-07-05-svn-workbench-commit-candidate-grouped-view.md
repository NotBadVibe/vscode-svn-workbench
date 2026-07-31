# SVN Workbench 提交候选分组视图

日期：2026-07-05

阶段：开发 -> 测试

## 目标

在提交页已有路径搜索、状态筛选、文件类型筛选、模板筛选、AI 决策筛选的基础上，新增“分组视图”。

这个能力用于解决日常提交时的一个高频问题：候选文件很多时，用户需要先按业务模块、文件类型、SVN 状态或 AI 建议快速理解本次变更范围，再决定是否提交。

## 页面变化

提交页工具栏新增 `分组` 下拉框。

当前支持：

- `不分组`
- `按模块目录`
- `按文件类型`
- `按 SVN 状态`
- `按模板预设`
- `按 AI 建议`

分组后，文件表格会插入分组行，展示：

- 分组名称。
- 分组内文件总数。
- 当前已勾选数量。
- 待确认数量。
- 排除数量。
- 阻止数量。

## 分组规则

### 1. 按模块目录

适合中国团队常见的业务模块目录结构。

示例：

- `src/pages/order/OrderList.vue` -> `src/pages/order`
- `src/pages/user/UserList.vue` -> `src/pages/user`
- `packages/admin/package.json` -> `packages/admin`
- `docs/readme.md` -> `docs`
- `README.md` -> `仓库根目录`

### 2. 按文件类型

按 `fileType` 分组，例如：

- `vue`
- `ts`
- `json`
- `md`
- `dll`
- `folder`

适合快速检查前端、配置、文档、二进制或生成物。

### 3. 按 SVN 状态

按 SVN 工作副本状态分组，例如：

- `modified`
- `missing`
- `unversioned`
- `conflicted`

适合提交前重点确认新增、删除和冲突类文件。

### 4. 按模板预设

按提交模板预设分组：

- `前端`
- `后端`
- `文档`
- `配置`
- `资源`
- `其他`

后续可以基于这个分组生成更贴近实际工作的提交说明。

### 5. 按 AI 建议

按 AI 筛选结果分组：

- `AI 推荐`
- `待确认`
- `已排除`
- `已阻止`
- `未分析`

适合在 AI 筛选后集中处理待确认项和排除项。

## 交互规则

分组视图只影响展示，不改变提交流程：

1. 分组不会自动修改勾选状态。
2. 分组不会绕过生成物排除规则。
3. 分组不会绕过右键范围边界。
4. 分组不会绕过提交计划预览。
5. 分组不会绕过提交前远端更新检查。
6. 分组不会绕过最终确认提交。

分组可以和现有筛选条件叠加：

- 路径搜索。
- SVN 状态筛选。
- 文件类型筛选。
- 模板预设筛选。
- AI 决策筛选。
- 隐藏生成物。

## 技术实现

新增 `src/commit/commitCandidateGrouping.ts`，沉淀可测试的分组规则：

- `groupCommitCandidates`
- `inferCommitCandidateModuleGroup`

提交页 `src/commit/commitPanel.ts` 新增：

- `state.groupBy`
- `getGroupByOptions`
- `groupRows`
- `getGroupInfo`
- `inferModuleGroup`
- `renderTableBody`
- `renderGroupRow`

## 本轮新增测试

- `groups commit candidates by module directory`
- `groups commit candidates by AI decision`
- `summarizes commit candidate groups`

## 下一步建议

分组视图完成后，可以继续做“分组级 AI 提交说明”：

- 选中某个分组后为该组生成提交说明。
- 按分组拆分提交计划。
- 对每组提示风险，例如删除文件、未版本控制文件、生成物、冲突文件。
- 让 AI 基于分组自动建议“本次应拆成几次提交”。
