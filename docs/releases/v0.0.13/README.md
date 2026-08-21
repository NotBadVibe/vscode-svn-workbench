# SVN Workbench v0.0.13：会话状态总线——草稿不丢、选择不乱

> 文档身份：`planned-version-record`
>
> 状态：开发中（源码已落地并随 v0.0.16 候选包提交，2026-08-21 verify 全链路 exit 0）。范围已随 v0.0.16 候选包交付，发版时同包转 released。当前开发事实以源码、测试和 [`../../current/`](../../current/) 为准。
>
> 规划基线：[`v0.0.12`](../v0.0.12/)（已发布）。
>
> 优先级：P0。关闭易用性审查条目 U-01（冲突草稿丢失）、U-04（统一提交选择）、U-05（变更集丢弃所选）。
>
> 不包含：草稿不持久化到磁盘、不跨 VS Code 重启；保存检查点不等于写入工作副本，不绕过任何预览与确认。

## 1. 版本结论

用户最不能接受的损失是"输入丢失"和"选择被静默改变"。当前 Diff、提交说明、项目切换已各有草稿机制（`diffDraftService`、提交说明草稿保护、`projectDraftStore`/`projectSwitchGuard`），但冲突合并稿仍只活在 Webview 本地状态，切换冲突即被快照覆盖；Changes 已把 `selectedPaths` 传给 Host，Changelists 快照却不消费。本版本把这两类会话状态提升为 Host 侧一等公民，共用一套总线，而不是逐模块打补丁。

## 2. 范围

1. **草稿总线**：扩展 `projectDraftStore` 支持任意模块草稿（冲突合并稿、Patch 内容等），按 `projectId + moduleId + scopeHash` 隔离；Conflicts 的 `mergeDraft` 迁入 Host 内存，不写磁盘、不触发 Resolve。
2. **切换守卫泛化**：`projectSwitchGuard` 的三选一（保存检查点 / 留在当前文件 / 放弃草稿）推广到切换冲突文件、刷新快照、关闭任务；保存失败内联展示，编辑器与草稿保留。
3. **会话级选择状态**：`session.selectedPaths` 升级为各模块共读的"当前选择"；Changes / Commit / Changelists / Patch 读写同一份；Changelists 快照消费预选并显示"已带入 N 个文件"；筛选变化只提示、不静默扩大选择。
4. 冲突草稿提供"复制 / 导出草稿"逃生口。

## 3. 任务拆分

| 批次 | 任务                                                                                                       | 主要涉及位置                                                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | `projectDraftStore` 泛化为通用草稿总线（类型化草稿种类、容量上限、隔离键）                                 | `src/extension/workbench/projectDraftStore.ts`、`src/scope/`                                                                                                                     |
| B    | Conflicts 草稿接入：协议新增草稿同步/检查点消息；`mergeDraft` 迁移；切换/刷新/关闭三选一守卫；保存失败内联 | `src/protocol/workbenchProtocol.ts`、`src/extension/workbench/WorkbenchController.ts`、`src/webview/features/conflicts/ConflictsModule.svelte`                                   |
| C    | 会话级选择状态：Host 选择读写契约、Changelists 快照消费预选、Patch 接入、"已带入 N 个文件"展示             | `src/protocol/workbenchProtocol.ts`、`src/extension/workbench/WorkbenchController.ts`（`buildChangelistsSnapshot`）、`src/webview/features/changelists/ChangelistsModule.svelte` |
| D    | 冲突草稿复制/导出；Mock、类型守卫与测试同步                                                                | `src/protocol/`、Mock、`tests/`                                                                                                                                                  |

协议改动必须同步 Host、Webview、Mock、类型守卫和相关测试。

## 4. 验收口径

- 编辑冲突后切换文件、刷新快照、模拟保存失败、重开当前任务，未经明确放弃时内容不消失。
- 任一入口带入的选中项，在 Commit / Changelists / Patch 的数量与路径完全一致。
- 刷新、筛选和状态更新不静默扩大选择范围。
- 共享选择只引用右键范围的子集，不突破 `moduleId + taskId + operationScope` 边界。
- 中文 IME composition 保护在三选一对话框与编辑区均生效。

## 5. 已知风险

- 选择状态跨模块共享须守住"右键范围只能缩小"：共享的是子集引用，不是范围本身。
- 三选一守卫接入点增多，需统一焦点返回与键盘路径，避免各模块分叉。

## 6. 实施状态（开发中，2026-08-20）

- 已完成（源码 + Mock + 协议双向守卫）：
  - 批次 A：`projectDraftStore` 泛化为通用总线——`DraftKind/ConflictFileDraft(baseContent)/ConflictMergeDraft`、`MAX_PROJECT_DRAFTS/MAX_CONFLICT_FILE_DRAFTS`、`projectDraftKey` 隔离、`writeConflictFileDraft/getConflictFileDraft/isConflictFileDirty` 纯领域、可单测，Controller 仅持有内存 `ProjectDraftMap` 实例（不写 `workspaceState`）。
  - 批次 B：冲突草稿 Host 内存化（`buildConflictSnapshot` 注入 `draft`，`workingView` 无 `as never`，并缓存 `conflictPaths/workingBaseContents` 供逐键 `draft-update` 无重采，快照重建时刷新）、三选一守卫（`conflict/select|refresh|open`→`conflict/draft-switch-confirm`，脏判断用 `isConflictFileDirty` 不重采 SVN，30s 超时文案“30 秒未选择将自动保存检查点并继续”）、保存失败内联（`editState.feedback`）且编辑器与草稿保留、不触发 Resolve、`conflict/draft-update|checkpoint|abandon|copy|export|switch-decision` 全链路、复制/导出逃生口。
  - 批次 C：`session.selectedPaths` 会话级共读（`applyWebviewSelection/buildCommitSnapshot/apply-local-rules|ai-select` 同步），`buildChangelistsSnapshot` 消费预选并展示“已带入 N 个文件” + `preselectedFeedback` 提示不扩大，`ChangelistsModule` 首次空选自动同步带入（不覆盖已有选择），刷新/筛选仅提示。
  - 批次 D：Mock（`injectHostMessage: HostToWebviewMessage["type"]`、`changelists+preselected`、`conflict/draft-*`、`conflictSave=fail` 保留）、类型守卫（`webviewActions` 双向 `AssertNever`）同步；Webview（`workbenchState/FeatureRouter/ConflictsModule/ChangelistsModule`）IME 保护、键盘可达、焦点返回。
- 门禁验证（2026-08-21，worker dev3 真实执行）：
  - `npm run test:extension` 真实 SVN Extension Host 验收三次运行均 exit 0；
  - `npm run verify` 端到端（docs:verify / audit 0 漏洞 / check / platform-contracts 52 / coverage 104 文件 1205 测试达标 / webview 77 E2E / performance 预算通过 / test:extension）单次链式 **exit 0**，复验亦 exit 0；
  - 期间修复均限定在 v0.0.13 变更集（mockWorkbench.ts Prettier 格式、jsdom `<dialog>` polyfill、SvelteSet、E2E 选择器），未降低校验、未删断言；
  - 变更集核对：17 个修改文件 + 4 个新增测试 + 规划版本目录，无范围外改动。
- 当前状态：门禁全绿，待提交后转 candidate 流程；`docs/current/实现与代码映射.md` §8.12 与 `docs/current/设计与交互基线.md` §8.5 已同步。
- 未实施（后续可选）：Patch 模块对共享选择的显式消费、小高度/200% 目视与真实读屏复验。
