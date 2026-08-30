# SVN Workbench v0.1.3：冲突保存、核验与 Resolve 闭环

> 文档身份：`planned-version-record`
>
> 状态：规划中（`draft/planned`）。依赖 [`v0.1.2`](../v0.1.2/)。
>
> 基线版本：[`v0.1.2`](../v0.1.2/)。
>
> 路线来源：[融合审查报告](../../archive/product-reviews/2026-08-23/以人为本易用性审查与优化报告.md)第 5.4、6.4、6.8～6.9、8.2 节。
>
> 优先级：P0。
>
> 用户可独立体验的主路径：从 Update 或 Changes 进入冲突文件，编辑合并结果，明确保存到工作副本，查看 marker/范围/文件状态核验，经一次准确意向单确认执行 Resolve，成功后自动进入下一个未解决冲突；全部完成后返回正确来路。
>
> 不包含：AI 自动解决、自动运行任意项目命令、批量 Resolve、绕过现有原子写入和确认令牌。

## 1. 版本目标

本版本将 `v0.1.1`/`v0.1.2` 的统一冲突编辑器接入完整安全闭环。页面必须持续区分：

1. 草稿检查点已保存到 Host 内存；
2. 合并结果已保存到工作副本；
3. 文件已通过可自动核验的条件；
4. SVN 已执行 `resolve --accept working`。

任何一步都不能用“已保存/已完成”模糊替代另一阶段。

成功标准：

- `ConflictStepBar` 持续显示“编辑 → 保存工作副本 → 核验 → 标记解决 → 下一个”。
- 写盘继续复用现有路径/仓库/BASE/token/hash/原子写入保护。
- 自动核验只做确定性检查：marker、文件类型、scope、磁盘 hash、SVN 状态和 token 新鲜度。
- AI 或规则给出的项目验证命令只展示/复制，不自动执行。
- Resolve 只在工作副本内容已保存且当前状态可执行时启用；仍通过 `OperationIntentDialog` 一次明确确认。
- Resolve 成功后重新采集状态再进入下一个冲突，不根据旧列表乐观跳转。

## 2. 进入与退出门禁

### 2.1 进入条件

- [ ] `v0.1.2` 的编辑、undo/redo、检查点和失效契约通过。
- [ ] 当前 `diffEditingService`/冲突保存、原子写入、`OperationIntentView`、`conflict/preview-resolve` 与 `conflict/resolve` 测试为绿。
- [ ] 已准备隔离真实 SVN 文本冲突、tree conflict、属性冲突、外部变化和失败恢复 fixture。
- [ ] 明确文本冲突以外类型的出口，不强塞进文本合并编辑器。

### 2.2 退出条件

- [x] V013-A～V013-G 全部完成。V013-A~G 已落地，单测+组件 1580、E2E 100 全绿、check 0 错误。
- [ ] 保存、核验、Resolve、重采、下一个冲突和返回来路构成一个可完整完成的主路径。
- [ ] 写操作成功、拒绝、过期、失败、取消、恢复分支均有 Host/真实 SVN 证据。
- [ ] AI 未配置时完整可用。
- [ ] `npm run verify`、隔离真实 SVN 主路径和人工小视口验收通过。待 verify 与真实 SVN 验收。
- [ ] 满足进入 [`v0.1.4`](../v0.1.4/) 的跨模块连续性条件。

## 3. 状态机

建议以纯领域状态表示，不从按钮禁用状态反推：

```text
draft-clean
  └─ edit/action → draft-dirty
draft-dirty
  └─ checkpoint → draft-checkpointed
draft-dirty/checkpointed
  └─ save preview + token → save-ready
save-ready
  └─ atomic write success + authoritative reload → working-saved
working-saved
  └─ deterministic checks → verification-pass | verification-blocked
verification-pass
  └─ resolve preview + intent → resolve-ready
resolve-ready
  └─ Host revalidation + svn resolve → resolved
resolved
  └─ refresh status → next-conflict | all-resolved
```

任一 scope/revision/repository UUID/文件 identity/内容 hash/BASE hash/TextDocument.version 变化，使对应旧 preview/token/action 失效并回到可恢复状态。

## 4. AI 任务拆分

| ID     | 顺序 | 任务                         | 主要产物                  |
| ------ | ---- | ---------------------------- | ------------------------- |
| V013-A | 1    | 建立冲突完成状态机           | 纯函数、状态与恢复动作    |
| V013-B | 2    | 接入安全保存工作副本         | token、原子写入、权威刷新 |
| V013-C | 3    | 实现确定性核验清单           | marker/scope/status 检查  |
| V013-D | 4    | 收敛一次 Resolve 意向单      | 准确预览与执行前复验      |
| V013-E | 5    | 自动进入下一个冲突并返回来路 | 重采后的导航闭环          |
| V013-F | 6    | 失败/取消/非文本冲突恢复     | 明确出口                  |
| V013-G | 7    | 全层测试与文档               | 真实 SVN 证据             |

### 4.1 V013-A · 状态机与 `ConflictStepBar`

- 在 `src/conflict/` 新增纯状态推导，不把状态散落在 Svelte 条件表达式中。
- 每一步返回 `status`、`label`、`reason`、`primaryAction`、`blockingIssues`。
- `ConflictStepBar.svelte` 展示当前阶段、已完成阶段、阻止原因和下一步；状态同时用文字/图标/序号。
- 小高度可折叠为当前步骤摘要，但保存、阻止和 Resolve 状态必须持续可达。
- 后台刷新不抢焦点；状态变化通过 `role=status` 适度播报，避免每次输入重复播报。
- 文案复用 `src/webview/i18n/terminology.ts`。

### 4.2 V013-B · 保存到工作副本

复用 `v0.0.6` 安全写入，不重新实现文件写入：

- 保存预览绑定 session/module/task/repository/scope/目标/原始字节 hash/BASE/TextDocument.version/draftRevision/TTL。
- 执行前 lstat/realpath、wc-root、repository UUID、scope、external/嵌套 WC、磁盘 hash 和 BASE 再复验。
- 同目录临时文件、写句柄 fsync、保留权限/BOM/EOL/末尾换行、原子替换。
- 内容 >5 MB、二进制、非法编码、symlink/junction/目录/设备安全拒绝。
- 保存成功后重载权威快照并轮换 token/hash；旧回执不得清除后续脏输入。
- 保存失败保留原文件、Editor、草稿和复制/导出出口。

如果冲突保存与 Diff 保存当前有重复编排，应提取领域服务复用；不得在 `ConflictsModule.svelte` 直接写文件。

### 4.3 V013-C · 确定性核验

自动核验项目：

- 当前工作文本不含可识别冲突 marker；
- 文件仍为普通、可写、可解码文本；
- 文件仍在原 repository、working copy 和 operation scope；
- 磁盘内容 hash 等于最近保存成功内容；
- SVN 状态仍是允许 Resolve 的当前冲突；
- 保存/Resolve preview 未过期；
- 当前草稿无未保存输入。

不可自动核验的内容明确写“需人工确认”，例如业务逻辑、测试是否正确。AI 验证建议继续展示来源和证据；命令仅提供复制或打开任务入口，不由模型或页面自动执行。

### 4.4 V013-D · Resolve 意向单

- 用户点击“使用当前工作副本内容并标记解决”后先生成新的 Resolve preview。
- 意向单标题写“标记解决 1 个冲突”，展示项目、文件、revision、当前状态、命令和不可逆影响。
- 不增加前置“我已核对”复选框；同一 Resolve 只保留一次高质量确认。
- 确认后 Host 复验 token、scope、candidate hash、repository UUID、revision、磁盘内容与 SVN 状态。
- 只允许 `svn resolve --accept working <exact path>` 的参数数组；不拼 shell。
- AI、块级动作、自动检查或页面加载不得触发 Resolve。
- 过期意向单只读，提供“重新检查并生成新预览”。

### 4.5 V013-E · 下一个冲突与返回来路

- Resolve 成功后先刷新 SVN 状态，再从权威冲突集合选择下一个。
- 选择顺序稳定且与左侧列表排序一致；已解决文件不能因旧快照重新出现。
- 进入下一个前处理当前可能的新草稿/延迟回执。
- 全部完成显示结果摘要：已解决数量、失败/跳过项、工作副本当前状态。
- 记录进入来源（Update 结果、Changes 行、命令、冲突中心）；完成后提供准确“返回更新结果/查看本地修改/关闭”。
- 返回只保持或缩小原 scope，不构造新扩大范围。

### 4.6 V013-F · 失败与非文本分支

分别处理：

- 保存 token 过期、磁盘变化、文档脏、目标移动、写入失败；
- marker 仍存在；
- Resolve preview 过期；
- SVN 状态已被外部工具改变；
- `svn resolve` 失败或取消；
- tree conflict、属性冲突、二进制冲突；
- Update 来路已关闭；
- 重新采集失败。

每个错误按“发生了什么 → 可能原因 → 恢复动作”表达。非文本冲突提供适用的 SVN 选择、查看详情或外部工具出口，但不伪装成文本合并。

### 4.7 V013-G · 测试

最低新增/扩展：

- 纯状态机全迁移与失效分支。
- `ConflictStepBar` 可访问性、折叠、小高度、播报。
- 保存服务成功/拒绝/过期/失败/恢复，含 Windows fsync 契约。
- Resolve Host 参数、token/scope/revision/hash/status 复验。
- 真实 SVN：文本冲突保存→Resolve→刷新；外部变化；tree/property conflict。
- E2E：Update→Conflicts→编辑→保存→意向单→Resolve→下一个→返回。
- AI 未配置、AI 超时、AI 结果过期不阻塞人工路径。
- 操作时间线只记录安全字段，不记录正文、凭据或 token。

### 4.8 完成结论（v0.1.3 开发中）

- **主路径闭环已实现**：编辑 → 保存工作副本 → 核验 → 意向单一次确认 → Resolve → 自动下一个 → 全部完成 → 返回来路。`ConflictStepBar` 贯穿五阶段，`WorkbenchController` 完成 save-working 原子化与 Resolve 前置核验+SVN 状态复验，`ConflictsModule` 接入步骤条/下一个导航/恢复出口/非文本分支。
- **测试基线**：单测+组件 138 文件 1580 通过、Webview E2E 100 通过、`npm run check` 0 错误（`conflictCompletionModel` 39、`conflictSaveService` 20、`conflictVerification` 27、`conflictRecovery` 37 等；组件 `ConflictStepBar`、`ConflictsModuleV013E`；E2E `conflict-v013.spec.ts` 4）。
- **已知待完成**：未跑 `npm run verify`、未做隔离真实 SVN 主路径与人工小视口验收，留待发布前完成；不影响当前文档与代码映射同步。

## 5. 主要代码落点

| 领域    | 位置                                                                       |
| ------- | -------------------------------------------------------------------------- |
| 状态机  | 候选 `src/conflict/conflictCompletion.ts`                                  |
| 保存    | `src/diffEdit/`、`src/extension/workbench/diffEditHost.ts`、冲突 Host 适配 |
| 核验    | 候选 `src/conflict/conflictVerification.ts`                                |
| Resolve | `WorkbenchController` 对应冲突 action、`operationIntent.ts`                |
| UI      | `ConflictsModule.svelte`、候选 `ConflictStepBar.svelte`                    |
| 路由    | `workbenchRouting.ts`、Update/Changes 来源状态                             |
| 测试    | unit/component/E2E/Extension Host/真实 SVN                                 |

## 6. 验收指标

- 从保存成功到 Resolve 可用的确定性检查反馈 ≤300ms（不含 SVN 子进程重新采集）。
- Resolve 每个文件只有 1 次意向单确认。
- Update 结果进入正确 Conflicts scope 只需 1 个动作。
- Resolve 后 1 个动作以内进入下一个冲突；全部完成不再显示旧冲突。
- 任一范围扩大、旧 token 执行、未保存内容 Resolve、AI 自动 Resolve 均为阻断失败。
- 720×480、200%、键盘、IME、三主题和 High Contrast 下全流程可达。

## 7. AI 完成报告格式

1. 完整状态机与用户步骤；
2. 保存和 Resolve 的安全复验；
3. 自动核验与人工确认边界；
4. 真实 SVN 结果；
5. 失败恢复和非文本分支；
6. 实际检查、未运行项和风险；
7. 是否满足进入 [`v0.1.4`](../v0.1.4/)。

## 8. 延期

- 批量 Resolve 不进入本路线，除非未来单独证明逐文件预览与恢复安全。
- 自动运行项目测试命令不在本版本。
- 大文件专用冲突视图和外部工具深度集成进入 `v0.1.8`。
