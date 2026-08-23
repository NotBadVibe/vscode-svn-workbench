# SVN Workbench v0.0.16：操作时间线与有限恢复

> 文档身份：`released-version-record`
>
> 状态：已发布。源码提交 `e506a608efc73020f1f03e2b654878fe8c8913f1`、标签 `v0.0.16`、VSIX 指纹、本地完整门禁、发布 evidence 已绑定；真实读屏 / 200% 目视 / 真实 SVN 人工主路径与三平台 CI 保留为非阻断观察项。当前开发事实以源码、测试和 [`../../current/`](../../current/) 为准。
>
> 规划基线：[`v0.0.15`](../v0.0.15/)（已发布，同包）。依赖 v0.0.13（草稿总线）、v0.0.14（意向单 token）与 v0.0.12（确认事实）三类已存在状态。
>
> 优先级：P1。关闭易用性审查条目 U-10（操作记录与恢复中心），并新增"快照新鲜度"协议能力。
>
> 不包含：不做跨会话持久化（仅会话内）；不承诺远端 commit / merge / switch / relocate 可一键撤销；恢复动作仍须经过新的状态检查、预览与确认。

## 1. 版本结论

用户忘记"刚才做了什么"、失败后难以继续，是审稿排序的高伤害问题。但不必新建一套记录系统：会话中已存在三类带时间戳与失效语义的状态——草稿（v0.0.13）、确认事实（v0.0.12）、操作意向单 token（v0.0.14）。本版本将它们汇合为统一时间线视图，并附加执行结果，形成诚实的"操作记录与有限恢复"。同时把 v0.0.12 验证过的"结果保鲜"机制（绑定 hash、过期只读）推广为协议级快照新鲜度字段。

## 2. 范围

1. **会话内操作记录**：时间、任务、项目、范围、影响数量、预览摘要、执行结果、错误原因。
2. **每条记录的可执行下一步**：重试、查看冲突、打开日志、复制诊断；SVN 无安全本地恢复方式的操作明确标注"此操作不能在工作台中一键撤销"。
3. **快照新鲜度协议字段**：`capturedAt` + `scopeHash` + `revision`；快照过期时显示"此结果基于 N 分钟前的状态，工作副本已变化"；History 等只读模块先行接入。
4. 恢复动作统一走 v0.0.14 意向单（新预览 + 新确认），不复用旧 token。

## 3. 任务拆分

| 批次 | 任务                                                 | 主要涉及位置                                                             |
| ---- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| A    | 操作记录领域模型与会话存储（纯领域、可测试）         | 新增 `src/activity/` 或对应领域目录（避免扩大 `WorkbenchController.ts`） |
| B    | 三类状态接入时间线：草稿、确认事实、意向单执行结果   | `src/extension/workbench/`                                               |
| C    | 时间线视图（记录列表、错误内联、恢复动作入口）       | `src/webview/`（复用列表底座）                                           |
| D    | 快照新鲜度协议字段与过期提示；History 等只读模块接入 | `src/protocol/workbenchProtocol.ts`、各快照构建器                        |
| E    | Mock、类型守卫、单元/组件/E2E 测试同步               | `tests/`                                                                 |

## 4. 验收口径

- 用户能回答"我刚才做了什么、哪步失败了、怎么继续"。
- 过期快照有明确视觉与文字提示（不只依赖颜色）。
- 全部记录中无"撤销远端提交"类误导文案；恢复动作执行前必经新预览与新确认。
- 会话结束后记录不残留（不写磁盘）。

## 5. 开放问题

- 时间线是否只做"会话内"，还是评估跨会话持久化？（本规划建议只做会话内）

## 6. 实施状态（已发布，2026-08-21）

- 批次 A：`src/activity/activityRecord.ts`、`activityStore.ts`（64 上限、纯内存）、`snapshotFreshness.ts` 已落地；`WorkbenchController.activityStore` 仅内存持有，空值不进磁盘，私密材料不进记录。
- 批次 B：三类接入——草稿（`diff/draft-checkpoint`、`conflict/draft-checkpoint` 写入后记录）、确认事实（`understanding/confirm-fact` 后记录）、意向单执行结果（`commit/execute` 成功/失败后记录，`nonRecoverable` 标记），其余 7 个执行路径复用同一 `appendActivityRecord` 契约（新预览+新确认，不复用旧 token）。
- 批次 C：`src/webview/features/activity/ActivityModule.svelte` 时间线视图（记录列表、错误内联 `role=alert`、可执行下一步、非可撤销 `notice--warning` 文案“此操作不能在工作台中一键撤销”）；协议 `activity` 模块 + `ActivitySnapshot` + `activity/*` 6 动作已同步 `webviewActions`/`moduleIds`/`FeatureRouter`；Mock 已补工厂。
- 批次 D：`SnapshotFreshness` 协议字段（`HistorySnapshot.freshness`）、`WorkbenchController.buildHistorySnapshot` 生成 `capturedAt/scopeHash/revision`，`HistoryModule.svelte` 基于 `capturedAt` 与 `≥5 分钟` 判断过期并以文字+图标提示“此结果基于 N 分钟前的状态，工作副本已变化”，不只依赖颜色；History 先行接入。
- 批次 E：`src/protocol/workbenchProtocol.ts` 双向守卫同步；`src/webview/mocks/mockWorkbench.ts` 快照工厂与动作分发同步；新增 `tests/unit/activityStore.test.ts`、`snapshotFreshness.test.ts`、`tests/components/ActivityModule.test.ts` 与 `tests/webview-e2e` 扩展（已随候选 verify 全链路 exit 0）。
- 文档同步：`docs/current/实现与代码映射.md` §8.15、`docs/current/设计与交互基线.md` §8.8 已更新；本文件 §6 为发布时实施记录。
