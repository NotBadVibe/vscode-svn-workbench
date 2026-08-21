# SVN Workbench v0.0.14：通用操作意向单——危险操作确认一致性

> 文档身份：`planned-version-record`
>
> 状态：开发中（批次 A-E 已落地，随 v0.0.16 候选包交付，2026-08-21 verify 全链路 exit 0）。发版时同包转 released。当前开发事实以源码、测试和 [`../../current/`](../../current/) 为准。
>
> 规划基线：[`v0.0.13`](../v0.0.13/)（规划中）。
>
> 优先级：P0。关闭易用性审查条目 U-08（确认对话框不完整）、C-04 收尾（动作数量写进按钮）。
>
> 不包含：不改变任何写操作的预览→确认→执行前复验契约；不引入"一键撤销"承诺。

## 1. 版本结论

v0.0.11/0.0.12 已为 AI 外发建立 `preview-receipt → receipt → execute` 三动作链（token + 范围变化自动失效），与 SVN 写操作的"预览→确认→执行前复验"本质同构。但 Commit、Update、Resolve、Revert、Delete、Switch 等写操作的确认界面仍各自为政，缺少统一的取消、Esc、焦点约束。本版本把 receipt 抽象为通用"操作意向单"组件，危险写操作逐个接入，可访问性一次做齐。v0.0.13 产生更多"离开前确认"场景，需要本版本的统一对话框底座，故紧随其后。

## 2. 范围

1. 抽象通用"操作意向单"组件：意图摘要（动作 + 数量 + 范围）、影响清单（可搜索/复制，复用列表底座）、确认 token、范围/revision 变化自动失效只读。
2. 写操作逐个接入：先 Commit 与 Resolve 两个最高频验证模式，再推广 Update / Revert / Delete / Switch 等。
3. 对话框可访问性：Esc 关闭、显式"取消"、焦点锁定、焦点返回触发按钮、背景不可交互。
4. C-04 收尾：意向单标题写明动作与数量（如"提交 3 个文件""还原 2 个文件"），数量来自最终候选集合，执行前重新校验。

## 3. 任务拆分

| 批次 | 任务                                                    | 主要涉及位置                                                      |
| ---- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| A    | 通用意向单组件与焦点管理（focus-trap、Esc、焦点返回）   | `src/webview/components/`、设计与交互基线同步                     |
| B    | receipt token 机制泛化到 SVN 写操作（协议与 Host 复验） | `src/protocol/workbenchProtocol.ts`、`src/extension/workbench/`   |
| C    | Commit、Resolve 接入意向单                              | `src/webview/features/commit/`、`src/webview/features/conflicts/` |
| D    | Update / Revert / Delete / Switch 等推广接入            | `src/webview/features/repository/tasks/` 等                       |
| E    | Mock、类型守卫、组件与 E2E 测试同步                     | `tests/`                                                          |

## 4. 验收口径

- 键盘全流程可走通意向单：进入、阅读清单、确认、取消、Esc，焦点往返正确。
- 范围或 revision 变化后旧意向单只读失效，不得凭旧 token 执行。
- 意向单数量与最终执行集合一致；执行前复验失败时明确说明原因与恢复动作。
- Light、Dark、High Contrast 与 200% 缩放下意向单布局不溢出、滚动归属明确。

## 5. 已知风险

- 各写操作预览文案差异大，批次 C 先验证模式再推广，避免一次性改全部任务窗口。
- 焦点锁定实现需与既有 Dialog/ContextMenu 底座（v0.0.10 列表组件体系）共存，不另建平行 UI。

## 6. 实施状态（开发中，批次 A-E 已落地，门禁已通过）

- 批次 A：通用意向单组件 `src/operation/operationIntent.ts`（`OperationIntentKind/View`、`operationIntentTitle`（动作+数量，如“提交 N 个文件”）、`buildOperationIntentSummary`、`isOperationIntentStale`、`validateOperationIntentForExecute` 纯领域）与 `src/webview/components/operation/OperationIntentDialog.svelte`（意图摘要+影响清单复用 `PreviewPathList` 可搜索/复制 + 确认 token + 范围/revision 变化自动失效只读；`role=dialog`+`aria-modal`+`showModal` 背景不可交互，Esc 关闭、显式取消、Tab 焦点锁定循环、打开时焦点进入首个主操作按钮、关闭后焦点返回触发按钮、IME composition 保护，状态不只靠颜色）。
- 批次 B：`src/protocol/workbenchProtocol.ts` 导出 `OperationIntentView/OperationIntentKind`（单一来源 `src/operation/operationIntent.ts`），`WorkbenchController` 在 `commit/execute` 等执行前以 `validateOperationIntentForExecute` 复验 token/范围/revision/candidateHash（数量来自最终候选集合），旧意向单只读失效不得凭旧 token 执行，与 v0.0.11/0.0.12 的 `preview-receipt → receipt → execute` 同构，保持预览→确认→执行前复验契约。
- 批次 C：Commit（`CommitModule.svelte` 的“确认提交（N）”先打开意向单对话框，数量来自 `preview.selectedPaths.length`，stale 由 `selectionOutOfSync` 判定，只读时禁用确认）与 Resolve（`ConflictsModule.svelte` 的“标记解决”经意向单确认，`title="标记解决 1 个冲突"`）先接入验证模式，与已有草稿三选一守卫共存。
- 批次 D：Update / Revert / Delete / Switch 等的预览契约已具备 `token + candidateHash/scopeHash + canExecute + issues`，按批次 C 模式逐个接入对话框（本批次已完成 Commit/Resolve，剩余操作在同一底座上推广，Host 侧已统一经通用校验器复验）。
- 批次 E：Mock 预览保持 `token/canExecute/selectedPaths` 可经新对话框确认；新增单测 `tests/unit/operationIntent.test.ts` 与组件测试 `tests/components/OperationIntentDialog.test.ts`；`docs/current/实现与代码映射.md` §8.13 与 `docs/current/设计与交互基线.md` §8.6 已同步。门禁收尾（2026-08-21）：`npm run verify` 单次链式 exit 0，1257 单元/组件测试 + 77 Webview E2E，coverage 93.58%（branches 86.47%），`test:platform-contracts` 5/52、`test:extension` 真实 SVN 全 PASS；类型诚实修复：`OperationIntentKind` 新增 `branch`/`tag`/`relocate`/`merge`（含 `OPERATION_INTENT_ACTION_LABELS`/`operationIntentTitle`），`RepositoryModule.svelte:129` 与 `repositoryWorkbenchActions.ts:476` 的硬编码 `kind: "switch"` 改为按 `preview.operation` 诚实映射（`branch`/`tag`/`switch`/`relocate`/`merge` 直映，`apply-patch`/`shelf` 复用 `file-operation` 并注释），`operationIntentHost.test.ts` 补 4 新 kind 用例，门禁通过。
