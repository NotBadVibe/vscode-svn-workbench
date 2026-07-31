# SVN Workbench AI 决策过滤与批量动作

日期：2026-07-05

阶段：开发 -> 测试

## 目标

在提交页已有 `AI 筛选` 和 `AI 原因` 的基础上，继续补齐用户可控的后处理动作。

本轮重点不是让 AI 替用户提交，而是让 AI 的判断可以被快速过滤、快速接受、快速回退，满足日常开发中“先让 AI 分一遍，再人工决策”的使用习惯。

## 页面变化

提交页工具栏新增：

- `全部 AI 建议` 筛选器。
- `接受 AI 推荐` 按钮。
- `恢复默认` 按钮。

AI 决策筛选器支持：

- `全部 AI 建议`
- `AI 推荐`
- `待确认`
- `已排除`
- `已阻止`
- `未分析`

## 交互规则

### 1. 按 AI 决策过滤

用户运行 `AI 筛选` 后，可以只查看某一类文件：

- 只看 `AI 推荐`：快速确认本次准备提交的文件。
- 只看 `待确认`：集中处理新增文件、删除文件、脚本类文件等需要人工判断的内容。
- 只看 `已排除`：检查 `bin`、`dist`、日志、缓存等生成物是否被正确排除。
- 只看 `已阻止`：定位冲突、异常状态或不可提交内容。
- 只看 `未分析`：发现模型遗漏的候选文件。

筛选器会和已有条件叠加：

- 路径搜索。
- SVN 状态筛选。
- 文件类型筛选。
- 模板预设筛选。
- 隐藏生成物。

### 2. 接受 AI 推荐

点击 `接受 AI 推荐` 后：

- 只勾选 AI 决策为 `recommended / AI 推荐` 的候选文件。
- 不勾选默认 `excluded / 已排除` 的文件。
- 不勾选默认 `blocked / 已阻止` 的文件。
- 保留提交前的计划预览、远端更新检查和确认提交弹窗。

如果尚未运行 AI 筛选，页面会提示先运行 AI 分析。

### 3. 恢复默认

点击 `恢复默认` 后：

- 清空当前人工勾选和 AI 勾选结果。
- 回到 SVN Workbench 本地默认策略。
- 只勾选默认 `selected / 已选` 的候选文件。

这个动作适合用户发现 AI 结果不符合预期时快速回退，不需要关闭页面重新打开。

## 技术实现

新增 `src/ai/commitSelectionActions.ts`，沉淀三类纯函数：

- `getAiRecommendedCandidatePaths`：根据 AI 解释结果返回可接受的推荐路径。
- `filterCandidatesByAiDecision`：按 AI 决策过滤候选文件。
- `getDefaultSelectedCandidatePaths`：返回本地默认勾选路径。

提交页 `src/commit/commitPanel.ts` 新增前端状态：

- `state.aiDecision`
- `state.aiExplanationByPath`

前端渲染时通过候选文件绝对路径映射 AI 决策，保证同一个文件的勾选、过滤和解释来源一致。

## 安全边界

本轮动作继续遵守既有提交安全链路：

1. AI 原始结果先由后端校验。
2. 范围外路径和非候选路径会被拦截。
3. `接受 AI 推荐` 不会勾选阻止项。
4. `接受 AI 推荐` 不会勾选默认排除项。
5. 真正提交前仍会生成提交计划。
6. 提交前仍会检查远端更新。
7. 提交仍需用户最终确认。

## 已修改文件

- `src/ai/commitSelectionActions.ts`
- `src/commit/commitPanel.ts`
- `src/test/suite/index.ts`

## 本轮新增测试

- `returns AI recommended commit candidate paths`
- `filters commit candidates by AI decision`
- `restores default selected commit candidate paths`

## 下一步建议

下一步可以继续推进“AI 提交页体验细化”：

- 支持保存用户自己的常用过滤组合。
- 支持按模块、目录、文件后缀生成提交分组。
- 支持 AI 给每个提交分组生成独立提交说明。
- 支持把 `待确认` 文件转成显式“本次加入 / 本次忽略”的用户决策记录。
