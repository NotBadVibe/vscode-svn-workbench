# SVN Workbench v0.0.15：首次上手与异常可恢复

> 文档身份：`planned-version-record`
>
> 状态：开发中（批次 A-E 已落地，随 v0.0.16 候选包交付，2026-08-21 verify 全链路 exit 0）。发版时同包转 released。当前开发事实以源码、测试和 [`../../current/`](../../current/) 为准。
>
> 规划基线：[`v0.0.14`](../v0.0.14/)（规划中）。不依赖 v0.0.13/0.0.14 的机制，可与二者并行开发。
>
> 优先级：P0。关闭易用性审查条目 U-02（环境诊断不可执行）、C-11（隐藏开发者验收入口）、C-12（README 与命令统一）；C-10（Checkout 向导）为可选项。
>
> 不包含：Checkout 向导若纳入，必须完整预览与凭据保护，凭据继续走既有安全输入通道；不引入自动修复系统环境的行为。

## 1. 版本结论

新用户的第一道断点不是功能缺失，而是"知道出错了，却不知道下一步去哪"：`getSvnPath` 只给警告文案，诊断页的 `action` 只是说明文字（`DiagnosticsModule.svelte`），非工作副本提示 Checkout 却没有入口。本版本把诊断从"说明"升级为"可执行恢复动作"，并把首次状态收敛为四种清晰结果。

## 2. 范围

1. **可执行诊断动作**：选择 SVN 可执行文件（文件选择对话框写入 `svnWorkbench.svn.path`）、打开相关设置、重新检测、打开文件夹、复制诊断信息；修复后原地重试。
2. **首次四状态收敛**：

   | 状态                         | 主动作              | 次动作                            |
   | ---------------------------- | ------------------- | --------------------------------- |
   | SVN 可用且当前目录是工作副本 | 查看修改            | 查看工作副本状态                  |
   | SVN CLI 未找到               | 选择 SVN 可执行文件 | 打开设置、查看安装帮助            |
   | 路径无效或无权限             | 重新选择并检测      | 复制诊断信息                      |
   | 当前目录不是工作副本         | 打开已有工作副本    | Checkout 到新目录（若 C-10 纳入） |

3. **C-11**：人工验收清单入口对普通用户隐藏，保留开发/测试环境通道。
4. **C-12**：README 与 `package.json` manifest 实际命令统一，删除重复说明。
5. **C-10（可选，单独立项评估）**：轻量 Checkout 向导——仓库 URL、目标目录、深度、revision 完整预览后用户确认；凭据走既有安全通道。

## 3. 任务拆分

| 批次      | 任务                                                                        | 主要涉及位置                                                                                                                                  |
| --------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A         | 诊断 action 协议化：检查项携带可执行动作 ID 与参数；Host 动作执行与原地重检 | `src/diagnostics/environmentDiagnostics.ts`、`src/protocol/workbenchProtocol.ts`、`src/webview/features/diagnostics/DiagnosticsModule.svelte` |
| B         | `getSvnPath` 失败路径改造：可执行选择/设置/重检动作替代纯警告               | `src/extension.ts`                                                                                                                            |
| C         | 首次四状态收敛与空状态动作接入                                              | 诊断/入口相关模块                                                                                                                             |
| D         | 人工验收入口隐藏（环境判定）；README 与 manifest 命令统一                   | `DiagnosticsModule.svelte`、`README.md`、`package.json`                                                                                       |
| E（可选） | Checkout 向导：预览、凭据、执行与失败恢复                                   | 新增 checkout 领域目录（按架构边界独立）                                                                                                      |

## 4. 验收口径

- 未读 README、但用过 SVN 的用户，能从四种首次状态各自走到可用工作副本或明确退出，过程中不需要搜索命令名称。
- 所有失败页都有原地重试和复制诊断入口。
- 普通用户环境不再出现"人工验收清单"入口；开发/测试环境保留。
- README 列出的命令均可在命令面板找到，反之关键命令均在 README 可查。

## 5. 开放问题

- C-10 Checkout 向导：纳入本版本，还是单独排期？（成本高、涉及凭据与写入流程）

## 6. 实施状态（开发中，批次 A-E 已落地，门禁已通过）

- 批次 A：诊断 action 协议化——`environmentDiagnostics.ts` 检查项携带 `actions`（动作 ID + 参数），`DiagnosticsModule.svelte` 渲染为可点击动作；Host 经 `diagnosticActions.ts` 执行并原地重检（选择可执行文件写入 `svnWorkbench.svn.path`、打开设置、重新检测、打开文件夹、复制诊断信息、打开 URL 仅 `https`/`http` 白名单）。
- 批次 B：`src/extension.ts` `getSvnPath` 失败路径改为可执行三选一（选择可执行文件 / 打开设置 / 重新检测）替代纯警告文案，满足“发生了什么、可能原因、恢复动作”三要素；复用 `diagnosticActions.ts` 共享实现，修复 `filters: ["exe",""]` 空串问题为不设 filters。
- 批次 C：首次四状态收敛——DiagnosticsModule 基于 `svn-cli` 与 `workspace` 检查结果派生首屏四状态卡片（可用 / CLI 缺失 / 路径无效 / 非工作副本），各有主、次动作，失败页均有原地重试与复制诊断入口。
- 批次 D：C-11 人工验收清单入口以 `import.meta.env.DEV` 控制，普通用户隐藏（`taskId=diagnostics/acceptance` 且 `!DEV` 时回退到环境诊断视图），开发/测试环境保留；C-12 README 与 `package.json` 实际命令统一，删除重复的“检查环境”，按 manifest 实际 28 个命令完整列出。
- 批次 E：Mock、类型守卫、单元/组件/E2E 测试同步中（`environmentDiagnostics.test.ts`、`DiagnosticsModule.test.ts`、`workbench.spec.ts` 诊断动作）；`docs/current/` 已同步 §8.14 与设计基线 §8.7，待 `npm run verify` 端到端绿灯后关闭。
- 走读修复（2026-08-22）：`diagnosticActions.ts` `handleOpenUrl` 增加 `https`/`http` 白名单与中文拒绝提示；`extension.ts` 复用共享实现并修复滤器；`docs/current/设计与交互基线.md` §8.7 补四状态卡片与验收入口显隐交互规范；`docs/releases/v0.0.15/README.md` 同步记录。
