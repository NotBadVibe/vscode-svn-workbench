# SVN Workbench 实现参考基线

> 状态：ACTIVE-REFERENCE  
> 产品基线：`docs/SVN工作台原型v3/`  
> 目的：把旧规格中仍然有效的技术规则收敛为一份可开发、可审查的实现契约。

## 1. 权威顺序

发生冲突时按以下顺序判断：

1. `SVN工作台原型v3/完整功能清单与验收矩阵.md`
2. `SVN工作台原型v3/Svelte统一UI开发改造与验收方案.md`
3. `SVN工作台原型v3/设计分析与开发映射.md`
4. 本文
5. `docs/archive/` 中的历史资料

归档中的“v1 收敛声明”、完整页面结构、旧里程碑和旧技术选型不再具有权威性。

## 2. 不可破坏的领域契约

### 2.1 操作范围

所有命令先解析统一上下文：

```ts
interface ResolvedCommandContext {
  repositoryRoot: string;
  repositoryUuid: string;
  operationScope: OperationScope;
  selectedFiles: string[];
  statusSnapshot: SvnStatusSnapshot;
  capabilities: CommandCapabilities;
}
```

必须遵守：

- 文件入口只允许影响该文件。
- 文件夹入口只允许影响该目录及其子目录。
- 多选范围是所选路径的去重并集，父目录已选时合并其子路径。
- 筛选、搜索、模板、Changelist 和 AI 只能缩小范围。
- 嵌套工作副本与 `svn:externals` 默认形成独立仓库边界。
- 混合仓库选择不能提交为一个 revision，必须按仓库拆分。
- 写操作执行前再次校验绝对路径、仓库 UUID 和范围哈希。

### 2.2 状态模型

内部状态至少区分：

- `modified`
- `added`
- `deleted`
- `missing`
- `replaced`
- `conflicted`
- `unversioned`
- `ignored`
- `external`
- `obstructed`
- `lockedBySelf`
- `lockedByOther`
- `outOfDate`

文本状态、属性状态、远端状态、锁状态和仓库归属应分别保存，不能压成一个显示字符。UI 可以按优先级显示装饰，但领域层不能丢失原始维度。

### 2.3 多仓库与 Changelist

- 每个工作副本创建独立 repository model。
- Svelte Changes 按冲突、Changelist、修改、新增、删除、缺失和未版本化分组。
- Changes 和智能提交模块共享同一份 Host 草稿来源。
- AI 拆分结果只能生成 Changelist 建议，用户可以移动或移出文件。
- Changelist 草稿跨会话恢复时必须重新采集状态并检查过期路径。

## 3. SVN 命令契约

### 3.1 通用规则

- 所有命令通过一个 `SvnCommandRunner` 执行，禁止 UI 层直接启动进程。
- 优先解析 `--xml`，不要依赖本地化终端文案。
- 参数使用数组传递，不拼接 shell 命令字符串。
- 命令记录需要脱敏密码、token、认证缓存路径和用户隐私数据。
- 长任务必须支持阶段、耗时、输出入口和取消信号。
- 取消、失败或工作副本状态变化后，必须重新执行状态采集才能重试。

### 3.2 主要能力与命令

| 能力 | 推荐命令/机制 | 关键约束 |
| --- | --- | --- |
| 本地状态 | `svn status --xml` | 限定工作副本和操作范围 |
| 远端检查 | `svn status --show-updates --xml` | 失败不能伪装成“无更新” |
| 信息与归属 | `svn info --xml` | 读取 root、URL、UUID、revision |
| 更新 | `svn update <paths>` | 执行前展示范围和冲突风险 |
| 提交 | `svn commit <paths> -F <file>` | 消息使用临时文件；执行最终远端检查 |
| Diff | `svn diff` / BASE 内容 + Svelte Diff 模块 | 编辑能力按需加载，超大文件安全降级 |
| 历史 | `svn log --xml -v` | Changed Paths 保留 revision 来源 |
| Blame | `svn blame --xml` | 单文件入口 |
| Add/Delete/Revert | 对应 SVN 子命令 | Delete/Revert 显示精确清单和恢复方式 |
| Lock/Unlock | 对应 SVN 子命令 | 展示锁所有者与注释 |
| 属性 | `proplist/propget/propset/propdel` | 修改前显示原值和目标值 |
| Cleanup | `svn cleanup` | 默认不删除未版本化或忽略文件 |
| Switch/Relocate | 对应 SVN 子命令 | 只在合法仓库上下文显示；操作前预检 |
| Branch/Tag | `svn copy` | 展示来源、目标 URL 和提交说明 |
| Merge | `svn merge` | 先预检，冲突转入 Svelte 冲突与合并模块 |

## 4. UI 表面契约

| 任务 | 首选表面 |
| --- | --- |
| 持续查看状态、分组、Changelist、提交草稿 | Svelte Changes 模块 |
| 文件与修订差异 | Svelte Diff 模块 |
| 文本冲突编辑 | Svelte 冲突与合并模块 |
| 简单选择与轻量确认 | Svelte Dialog / Command / Context Menu |
| 密码输入 | Svelte 安全输入；Secret 只传给 Host，不回显 |
| 长任务 | Svelte Progress/Task 状态；Host 管理取消和日志 |
| 配置项 | Svelte Settings 模块 |
| 智能提交、AI 审查、拆分计划、冲突理由 | 对应 Svelte feature module |
| 仓库浏览 | Svelte Repository 模块 |

所有可见业务 UI 统一使用 Svelte 5。一个 Workbench Shell 根据命令直接进入目标模块；不得恢复一个同时挂载所有能力和全部状态的巨型页面。

## 5. 安全与恢复契约

### 5.1 认证与证书

- 密码不得写入 settings、工作区配置或日志。
- 可使用 VS Code SecretStorage 保存扩展管理的 secret，但要兼容 SVN 自身认证缓存。
- 证书确认必须显示主机、SHA-256 指纹、错误原因和有效期。
- “仅本次信任”与“永久信任”必须明确区分。
- 认证失败、证书失败、代理失败、DNS 失败和离线状态不能合并成一个错误。

### 5.2 破坏性操作

Revert、Delete、Switch、Relocate、Merge 和从历史恢复文件必须展示：

- 精确路径清单。
- 本地未保存或未提交内容。
- 是否可以撤销以及如何恢复。
- 将执行的 SVN 命令或动作。
- 明确的二次确认。

必要时先提供恢复 Patch。不要把“本地搁置”描述为 SVN 标准 shelf；它是插件管理的可恢复 Patch。

### 5.3 工作副本恢复

- 识别锁定、未完成 update/merge、tree conflict 和 obstructed 状态。
- Cleanup 页面展示安全默认参数，不默认删除 ignored/unversioned 文件。
- 恢复后刷新 SCM、候选文件、revision、冲突和 AI 结果有效性。

## 6. AI 契约

### 6.1 处理顺序

```text
OperationScope
  -> SVN 状态与仓库边界
  -> 本地确定性规则
  -> 敏感信息 / 生成物 / 大文件 / 调试代码扫描
  -> 裁剪后的 AI 上下文
  -> 结构化结果校验
  -> 用户确认
```

### 6.2 结果要求

- 文件级判断包含 `path`、分类、理由和置信度。
- 审查结论包含文件、行号、证据、严重度和置信度。
- 拆分建议包含文件集合、提交意图、建议说明和依赖关系。
- 冲突建议包含两侧意图、候选结果、风险和验证步骤。
- 模型返回路径必须经过仓库与范围校验；虚构路径和范围外路径直接丢弃。
- AI 不得直接执行 commit、update、resolve、revert、delete、switch 或 merge。

### 6.3 上下文与过期

每个 AI 结果至少绑定：

- repository UUID
- operation scope hash
- 文件内容或 diff hash
- working copy revision
- 生成时间与模型

任一关键值变化后结果标记为过期，只能查看或重新生成，不能直接采用。

### 6.4 隐私与降级

- 外发前显示文件数、字符预算、模型和数据类型。
- 默认不发送范围外文件、完整仓库历史、认证信息和本地绝对路径。
- 团队记忆优先保存本地摘要，并提供查看来源、清除缓存和关闭入口。
- AI 未配置或调用失败时，保留范围保护、敏感规则、生成物检测和全部手动 SVN 流程。

## 7. 受控 AI 任务代理

任务代理的执行单元不是“自由操作”，而是带审批的领域步骤：

```ts
interface AgentStep {
  id: string;
  title: string;
  repositoryUuid: string;
  scopeHash: string;
  preview: string;
  risk: 'read' | 'write' | 'destructive' | 'remoteRevision';
  undo: string;
  privacy: string;
  requiresApproval: boolean;
}
```

- 代理先生成计划，再逐步执行。
- 每个写步骤执行前重新校验仓库、scope 和工作副本状态。
- 提交前必须再次显示最终文件、说明、远端状态和风险。
- 停止代理不静默回滚已经完成的 SVN 步骤，而是说明当前状态和恢复路径。

## 8. 当前代码映射与缺口

| 领域 | 当前代码 | 判断 |
| --- | --- | --- |
| 范围与边界 | `src/scope/operationScope.ts`、`pathBoundaryGuard.ts` | 可保留并扩展统一上下文解析 |
| SVN 进程与解析 | `src/svn/` | 可作为统一命令层基础 |
| SCM/Changes | `src/scm/svnScmProvider.ts` | 保留状态采集价值，展示迁移为 Svelte repository model、Changes 和 Changelist |
| 提交 | `src/commit/commitPanel.ts` | 保留领域能力，删除内联 UI，迁移为 Svelte commit feature 与 Host controller |
| 拆分队列 | `commitSplitQueue.ts`、`commitSplitQueueDraft.ts` | 保留领域状态机，UI 迁移到 Svelte Changelist/拆分模块 |
| 更新 | `src/update/updateFlow.ts` | 保留预检与风险汇总，入口改为上下文命令 |
| Diff | `src/diff/` | 保留 BASE 内容和 Diff 数据能力，展示迁移到 Svelte Diff 模块 |
| 冲突 | `src/conflict/` | 保留采集、范围保护和 AI 建议；编辑迁移到 Svelte 冲突模块 |
| AI 配置与路由 | `src/ai/` | 已有基础；需新增审查、影响、测试、过期和隐私预算协议 |
| 历史/仓库管理 | 尚不完整 | 按 v3 P0/P1/P2 顺序新增 |
| 可靠性状态 | 分散 | 需要统一操作状态机、取消、重试、认证和证书恢复 |

## 9. 推荐迁移顺序

1. 建立 `resolveCommandContext`、动态右键子菜单、统一 WorkbenchPanelHost 和多仓库模型。
2. 建立 Svelte Shell、类型化 Bridge、设计系统、Mock 与测试基础。
3. 先把查看修改迁移为 Svelte Diff 垂直链路。
4. 从巨型提交面板提取领域能力并迁移智能提交、AI 审查和拆分计划。
5. 迁移冲突、历史、设置、诊断、认证和异常恢复模块。
6. 完成 AI 任务代理、范围过期、性能、安全和可访问性验收。
7. 删除旧内联业务 UI，再实现或补齐 P2 仓库管理功能。
