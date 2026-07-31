# SVN Workbench 手工 UI 完整状态环境 v2 测试清单

日期：2026-07-06

## 为什么新增 v2

上一版环境只准备了远端更新风险，没有直接制造真实 SVN 冲突，也没有计划删除状态。旧目录当时被 VS Code 占用，重建时出现目录锁，因此本轮新增独立固定路径：

```text
C:\svn-workbench-manual-ui-acceptance-v2
```

后续测试请优先使用 v2。

## 打开测试环境

```powershell
code "C:\svn-workbench-manual-ui-acceptance-v2\wc"
```

重置 v2 环境：

```powershell
cd "C:\Users\杨楠\Documents\vscode-svn"
npm run prepare:manual-test-env
code "C:\svn-workbench-manual-ui-acceptance-v2\wc"
```

## 当前完整状态

本地工作副本路径：

```text
C:\svn-workbench-manual-ui-acceptance-v2\wc
```

应包含以下状态：

```text
C  src/pages/conflict/ConflictDemo.vue
?  src/pages/conflict/ConflictDemo.vue.mine
?  src/pages/conflict/ConflictDemo.vue.r1
?  src/pages/conflict/ConflictDemo.vue.r2
M  src/pages/order/OrderList.vue
D  src/pages/order/DeletedByLocal.ts
?  src/pages/order/NewFeature.ts
?  src/pages/order/debug.log
A  src/pages/user/UserProfile.vue
M  config/app.json
?  config/local.dev.json
!  docs/readme.md
?  bin/Debug/app.exe
?  dist/bundle.js
?  obj/cache.tmp
```

状态含义：

- `C`：真实 SVN 文本冲突。
- `M`：已修改。
- `A`：已 `svn add` 的新增文件。
- `D`：已 `svn delete` 的计划删除文件。
- `!`：版本控制文件在本地缺失，但没有执行 `svn delete`。
- `?`：未版本控制文件，包括普通新文件和生成物。

## 右键菜单测试

1. 打开 v2 工作副本。
2. 在资源管理器中右键任意文件或文件夹。
3. 应看到这些中文菜单：

- `SVN：提交当前范围`
- `SVN：打开冲突中心`
- `SVN：打开差异对比`
- `SVN：打开团队配置`
- `SVN：配置团队规则`
- `SVN：AI 配置模型`
- `SVN：AI 测试连接`

4. 右键文件夹时，还应看到：

- `SVN：AI 选择当前范围`

说明：`SVN：AI 测试连接` 在没有配置 API Key 时会失败或提醒，这是正确行为。先用 `SVN：AI 配置模型` 配好模型和 Key 后再测连接。

## 当前文件夹范围提交测试

1. 右键 `src/pages/order`。
2. 点击 `SVN：提交当前范围`。
3. 提交页候选应聚焦订单目录，主要看到：

- `src/pages/order/OrderList.vue`
- `src/pages/order/DeletedByLocal.ts`
- `src/pages/order/NewFeature.ts`
- `src/pages/order/debug.log`

4. 不应混入这些范围外内容：

- `src/pages/user/UserProfile.vue`
- `src/pages/conflict/ConflictDemo.vue`
- `config/app.json`
- `docs/readme.md`

通过标准：右键子文件夹后，提交范围不能扩大到整个工作副本。

## 根目录完整状态提交测试

1. 右键工作副本根目录 `wc`。
2. 点击 `SVN：提交当前范围`。
3. 提交页应能覆盖全部状态：

- 冲突文件：`src/pages/conflict/ConflictDemo.vue`
- 修改文件：`src/pages/order/OrderList.vue`、`config/app.json`
- 新增文件：`src/pages/user/UserProfile.vue`
- 删除文件：`src/pages/order/DeletedByLocal.ts`
- 缺失文件：`docs/readme.md`
- 未跟踪普通文件：`src/pages/order/NewFeature.ts`、`config/local.dev.json`
- 生成物：`src/pages/order/debug.log`、`bin/Debug/app.exe`、`dist/bundle.js`、`obj/cache.tmp`

通过标准：冲突和阻止项要明确提示，不能被当作普通可提交文件静默提交。

## 筛选测试

1. 切换状态筛选：

- `冲突` 应看到 `ConflictDemo.vue`。
- `已修改` 应看到 `OrderList.vue`、`config/app.json`。
- `已新增` 应看到 `UserProfile.vue`。
- `已删除` 应看到 `DeletedByLocal.ts`。
- `本地缺失` 应看到 `docs/readme.md`。
- `未版本控制` 应看到 `NewFeature.ts`、`local.dev.json` 和生成物。

2. 切换文件类型筛选：

- `Vue` 应包含 `OrderList.vue`、`ConflictDemo.vue`、`UserProfile.vue`。
- `TypeScript` 应包含 `DeletedByLocal.ts`、`NewFeature.ts`。
- `JSON` 应包含 `app.json`、`local.dev.json`。
- `Markdown` 应包含 `docs/readme.md`。
- `日志` 应包含 `debug.log`。
- `二进制` 应包含 `bin/Debug/app.exe`。

3. 切换模板预设：

- `前端订单模块` 应聚焦 `src/pages/order`。
- `只看配置文件` 应聚焦 `config`。

4. 切换 `隐藏生成物`：

- 开启后应隐藏或排除 `debug.log`、`bin`、`dist`、`obj`。
- 关闭后可看到这些生成物，但仍应默认给出谨慎提示。

## 冲突中心测试

1. 右键 `src/pages/conflict`。
2. 点击 `SVN：打开冲突中心`。
3. 应看到 `src/pages/conflict/ConflictDemo.vue`。
4. 检查对比入口：

- Base / Mine / Theirs / Working 对比。
- AI 冲突建议按钮。
- 解决前预览或确认。

通过标准：冲突中心必须能直接识别真实 `C` 冲突文件。

## AI 右键入口测试

1. 右键工作副本根目录。
2. 点击 `SVN：AI 配置模型`。
3. 应打开 AI 模型配置页。
4. 配置 DeepSeek、通义千问、智谱、Kimi 或自定义 OpenAI-compatible 模型。
5. 保存后右键再点击 `SVN：AI 测试连接`。
6. 右键 `src/pages/order`，点击 `SVN：AI 选择当前范围`。

通过标准：

- AI 配置入口不需要命令面板也能打开。
- AI 连接失败时要有明确提示。
- AI 选择当前范围不能选择 `src/pages/order` 之外的文件。

## 更新预览测试

1. 右键 `src/pages/order`，打开提交页。
2. 点击 `预览更新`。
3. 应看到：

- 本地 `OrderList.vue` 已修改。
- 远端 `OrderList.vue` 也已修改。
- 远端新增 `RemoteOnly.vue`。
- `OrderList.vue` 有重叠风险。

通过标准：更新前必须展示本地、远端和风险摘要。
