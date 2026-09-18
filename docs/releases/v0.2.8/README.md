# SVN Workbench v0.2.8：设置草稿保护与预览时间本地化

> 文档身份：`planned-version-record`。
>
> 状态：`released`，业务工作已实施，验收通过。计划建立于 2026-09-18，代码基准 v0.2.7 / `f07de9e`，验收基准 `main` / `f07de9e` + 工作区改动，发布日期 2026-09-18。
>
> 适用范围：本版本分配的 2 项任务；承接 Vercel Web Interface Guidelines 审查发现。不包含：不另建首页、Rail 或平行业务 UI；不改写操作协议；不修改既有发布版本证据。
>
> 依赖：[v0.2.7](../v0.2.7/README.md)；路线总览见 [v0.2.x 开发路线](../v0.2.0/开发路线.md)。未来版本能力不得当作当前已实现事实。
>
> 主权威：[产品](../../current/产品与功能基线.md)、[交互](../../current/设计与交互基线.md)、[实现映射](../../current/实现与代码映射.md)、[验收](../../current/测试与验收基线.md)。

## 1. 用户结果与范围

**本版完成后：设置页草稿不再因误关窗口而静默丢失，更新模块的预览时间以中文本地化格式展示。**

用户可独立体验的主路径：在设置页修改 AI 配置或团队规则后未保存，关闭窗口/刷新页面前收到浏览器拦截提示；在更新模块生成预览后，预览时间显示为 `2026-09-07 08:00` 而非 `2026-09-07T00:00:00.000Z`。

进入条件：v0.2.7 已发布。一次只把一个版本置为 `developing`，其余保持 `planned`。

## 2. 实施批次与接线边界

1. V028-R01：SettingsModule `beforeunload` 守卫 + 组件测试。
2. V028-R02：UpdateModule `formatZhDateTime` 本地化 + 组件测试。

两项均为 Webview 层独立修复，默认不改写操作协议，不涉及 Host 逻辑。

## 3. 问题与开发任务

<a id="v028-r01"></a>

### V028-R01 · 设置模块未保存草稿关闭窗口无警告

- **原评审映射：** Vercel Web Interface Guidelines 审查发现（高优先级）。
- **优先级 / 证据等级：** P1 / 源码已确认。
- **实施状态：** 已实施（SettingsModule `beforeunload` 守卫 + 3 个组件测试；V028-R01 验收通过）。
- **看到的现状：** SettingsModule 的 AI 配置与团队规则草稿在切换页签时保留（V020-R07 已修复），但关闭窗口/刷新页面/VS Code 窗口重载时无任何警告，草稿被静默丢弃。
- **用户影响：** 用户配置到一半误关窗口，重新打开后所有修改丢失，需要重新输入。
- **现有证据与预计改动入口：** [SettingsModule.svelte](../../../src/webview/features/settings/SettingsModule.svelte)、[SettingsModule.test.ts](../../../tests/components/SettingsModule.test.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 在 SettingsModule 挂载时注册 `beforeunload` 监听器，当 `aiDirty || teamDirty` 为真时调用 `event.preventDefault()`。
2. 保存成功或放弃修改后，脏状态归零，不再拦截。
3. 守卫只读当前 derived 脏状态，不引入额外持久化。

**验收场景与完成条件：**

- [x] 编辑 AI 配置后未保存，触发 `beforeunload` 事件被拦截（`defaultPrevented === true`）。
- [x] 点击"放弃修改"后，同一事件不再被拦截。
- [x] 点击"保存配置"成功后，不再被拦截。
- [x] 团队规则草稿脏时同样拦截。
- [x] 无草稿脏时，不拦截任何 `beforeunload`。

<a id="v028-r02"></a>

### V028-R02 · 更新模块预览时间直出 ISO 字符串

- **原评审映射：** Vercel Web Interface Guidelines 审查发现（高优先级）。
- **优先级 / 证据等级：** P1 / 源码已确认。
- **实施状态：** 已实施（UpdateModule `formatZhDateTime` 本地化 + 2 个组件测试；V028-R02 验收通过）。
- **看到的现状：** UpdateModule 的预览时间直接渲染 Host 下发的 ISO 字符串 `2026-09-07T00:00:00.000Z`，未经 `Intl.DateTimeFormat` 本地化。
- **用户影响：** 用户看到机器时间格式，与项目中文体验基线不一致，增加认知负担。
- **现有证据与预计改动入口：** [UpdateModule.svelte](../../../src/webview/features/update/UpdateModule.svelte)、[UpdateModule.test.ts](../../../tests/components/UpdateModule.test.ts)。以基准提交的符号/行为定位，不依赖易漂移行号；入口清单不是已经完成的改动。

**具体改动：**

1. 引入 `formatZhDateTime` 替换直接插值。
2. 保持既有"预览时间"文案前缀不变。

**验收场景与完成条件：**

- [x] 预览时间显示为 `2026-09-07 08:00`（ Asia/Shanghai 时区）。
- [x] 不再出现 ISO 字符串 `2026-09-07T00:00:00.000Z`。
- [x] 当天时间显示为"今天 HH:mm"。

## 4. 测试落点

- [SettingsModule.test.ts](../../../tests/components/SettingsModule.test.ts)（V028-R01）
- [UpdateModule.test.ts](../../../tests/components/UpdateModule.test.ts)（V028-R02）

## 开发与验证约束

- 先完整阅读根 README、文档索引、current 索引、四份当前基线、本版与直接前置版计划。开始实现前列出已读文档。
- 沿用 Svelte 5 与现有领域/共享组件。Host 负责 SVN、文件系统、凭据与最终校验，Webview 只展示和发意图。
- 写操作继续精确预览→一次明确确认→执行前复验范围/候选/工作副本或 revision/token；方案与范围变化撤销旧预览。
- 代码变更至少执行 `npm run check` 与直接相关测试；行为/源码/测试映射变化同步相应 current 基线并执行 `npm run docs:verify`；完整版本交付执行 `npm run verify`。Node.js 26、npm 12。
- 普通证据写 `.validation/evidence/v0.2.8/<run>/`，记录实际提交、设备和命令。只有用户显式要求发布才能执行 `npm run evidence:release`、发布/标签或绑定发布产物；本计划不授权发布。
- 各版自行覆盖正常、空、加载、失败、取消、过期与恢复；有写操作时成功/拒绝/过期/失败/恢复均测。键盘、中文 composition、小高度、200% 和 Light/Dark/High Contrast 随改动验收，不推迟到最后一版才检查。

## 完成状态与交付清单

- 已完成：本版问题与任务建档；V028-R01/V028-R02 已实现并通过组件测试。
- 待实施：无（本版全部业务修复/增强已完成）。

- [x] 各任务有实现或明确反证/候选 no-go；未修复的确定缺陷不得以文档完成代替。
- [x] 用户主路径可独立完成，不依赖后续版本补齐基本可用性。
- [x] 每项验收有实际结果与证据位置；测试文件名以最终落地为准，新增用例不是仅扫描源码或复制实现断言。
- [x] `npm run check`、相关测试、`npm run docs:verify` 与完整 `npm run verify` 实际执行，失败和未运行项逐项说明。
- [x] 修改过的 current 基线与协议映射同步，旧已发布目录不改写。
- [x] 未执行的真人/真机/读屏项目标为待观察；明确发现的内容丢失/范围错误不能被"人工未执行"标签掩盖。

## 失败、回退与延期处理

功能性 UI 回归优先回退本版相应组件/适配变更并保留新增复现用例；不能靠回退安全校验解决。降级不应丢草稿或默认执行写操作。无法在本版交付的增强项需标明具体边界、原因、受影响任务与替代出口；确定缺陷保持未完成，不以"后续优化"掩盖。
