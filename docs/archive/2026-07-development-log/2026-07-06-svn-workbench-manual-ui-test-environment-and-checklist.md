# SVN Workbench 手工 UI 测试环境与操作清单

日期：2026-07-06

## 当前结论

已创建独立 SVN 手工验收环境，用于验证 VS Code 右键入口、中文命令标题、提交范围、提交候选筛选、模板预设过滤、生成物排除、更新预览和冲突中心入口。

测试环境固定使用英文磁盘路径，避免 Windows 下部分 SVN CLI 对中文用户名路径处理异常。

## 测试环境

- SVN 仓库：`C:\svn-workbench-manual-ui-acceptance\repo`
- 本地工作副本：`C:\svn-workbench-manual-ui-acceptance\wc`
- 远端模拟工作副本：`C:\svn-workbench-manual-ui-acceptance\remote-wc`
- 环境说明：`C:\svn-workbench-manual-ui-acceptance\README-manual-acceptance.md`

重新生成环境：

```powershell
cd "C:\Users\杨楠\Documents\vscode-svn"
npm run prepare:manual-test-env
```

打开本地测试工作副本：

```powershell
code "C:\svn-workbench-manual-ui-acceptance\wc"
```

## 开始前检查

1. 确认 VS Code 已安装当前本地 VSIX。

```powershell
code --list-extensions --show-versions | Select-String "local.svn-workbench"
```

2. 如果 VS Code 已经打开旧版本扩展，执行一次“开发者：重新加载窗口”。
3. 打开命令面板，搜索 `SVN：`，应看到中文命令：

- `SVN：检查环境`
- `SVN：刷新状态`
- `SVN：提交当前范围`
- `SVN：打开冲突中心`
- `SVN：打开差异对比`
- `SVN：打开团队配置`
- `SVN：配置团队规则`
- `SVN：显示输出`
- `SVN：AI 配置模型`
- `SVN：AI 测试连接`
- `SVN：AI 选择当前范围`
- `SVN：打开验收清单`

## 预置数据

本地工作副本中已有以下状态：

```text
M  config/app.json
?  config/local.dev.json
!  docs/readme.md
?  src/pages/order/NewFeature.ts
M  src/pages/order/OrderList.vue
?  src/pages/order/debug.log
A  src/pages/user/UserProfile.vue
?  bin/Debug/app.exe
?  dist/bundle.js
?  obj/cache.tmp
```

远端模拟工作副本已提交一批远端变更：

- `src/pages/order/OrderList.vue`：本地和远端同时修改，用于验证更新风险提示。
- `src/pages/order/RemoteOnly.vue`：仅远端新增，用于验证更新预览的远端新增。

仓库根目录 `.svn-workbench.json` 预置：

- 提交规范：要求前缀和模块。
- 筛选预设：`前端订单模块`、`只看配置文件`。

## 右键中文与范围测试

1. 在 VS Code 打开 `C:\svn-workbench-manual-ui-acceptance\wc`。
2. 在资源管理器中右键 `src/pages/order` 文件夹。
3. 确认右键菜单中显示 `SVN：提交当前范围`，不是英文命令。
4. 点击 `SVN：提交当前范围`。
5. 提交页打开后，确认当前范围是 `src/pages/order`。
6. 候选列表应只出现当前文件夹内的文件：

- `src/pages/order/OrderList.vue`
- `src/pages/order/NewFeature.ts`
- `src/pages/order/debug.log`

7. 不应出现这些范围外文件：

- `config/app.json`
- `config/local.dev.json`
- `src/pages/user/UserProfile.vue`
- `docs/readme.md`

通过标准：右键哪个文件夹，就只提交该文件夹范围内的内容。

## 提交页筛选测试

1. 在 `src/pages/order` 提交页点击 `预览更新` 前，先检查筛选控件。
2. 切换状态筛选：

- `全部`
- `已修改`
- `未版本控制`
- `已新增`
- `本地缺失`
- `冲突`

3. 切换文件类型筛选：

- `全部`
- `Vue`
- `TypeScript`
- `JSON`
- `Markdown`
- `日志`
- `二进制`

4. 切换模板分类筛选：

- `全部模板`
- `前端`
- `配置`
- `文档`
- `构建产物`

5. 切换 `隐藏生成物`。
6. 验证生成物默认不应进入建议提交：

- `src/pages/order/debug.log`
- `dist/bundle.js`
- `obj/cache.tmp`
- `bin/Debug/app.exe`

7. 在仓库根目录右键执行 `SVN：提交当前范围`，再测试仓库预设：

- 选择 `前端订单模块` 后，应主要聚焦 `src/pages/order`。
- 选择 `只看配置文件` 后，应主要聚焦 `config/*.json`。

通过标准：筛选只影响候选视图和批量选择，不应偷偷扩大右键范围。

## 提交计划预览测试

1. 在提交页选择一个或多个候选文件。
2. 填写提交说明，例如：

```text
fix(order): 调整订单列表
```

3. 点击 `预览提交计划`。
4. 检查预览中是否展示将执行的 SVN 命令。
5. 如果包含未跟踪文件，应看到 `svn add` 预览。
6. 如果包含缺失文件，应看到删除或移除相关风险提示。
7. 不点击 `确认提交`，除非你就是要验证真实提交。

通过标准：提交前必须能看见路径、命令和阻止原因。

## 更新预览测试

1. 在 `src/pages/order` 提交页点击 `预览更新`。
2. 期望看到本地变更摘要：

- `OrderList.vue` 本地已修改。
- `NewFeature.ts` 本地未版本控制。
- `debug.log` 属于生成物或待确认文件。

3. 期望看到远端变更摘要：

- `OrderList.vue` 远端也有修改。
- `RemoteOnly.vue` 远端新增。

4. 期望风险级别提示至少标出 `OrderList.vue` 存在本地和远端重叠。
5. 暂不点击 `更新当前范围`，除非要验证真实 update。

通过标准：更新前能看到“本地有什么、远端有什么、哪里有重叠风险”。

## 冲突中心测试

1. 右键工作副本根目录或 `src/pages/order`。
2. 点击 `SVN：打开冲突中心`。
3. 当前默认环境尚未真正执行 update，因此通常显示“当前范围没有 SVN 冲突”。
4. 如果你执行了 `更新当前范围` 并产生冲突，再打开冲突中心：

- 应显示冲突文件列表。
- 应能打开 Mine / Theirs / Base / Working 对比。
- AI 建议只应给出方案和风险，不应自动修改文件。

通过标准：无冲突时有清晰空状态，有冲突时能进入对比和决策流程。

## 验收清单面板

1. 打开命令面板。
2. 执行 `SVN：打开验收清单`。
3. 点击 `环境检查`。
4. 打开 `SVN Workbench` 输出面板。
5. 期望看到：

- Windows 或 macOS 平台识别。
- SVN CLI 版本。
- 当前工作区包含 `.svn`。
- 未配置 AI 时只显示提醒，不阻塞核心 SVN 流程。

## 发现问题时记录

每个问题建议按下面格式记录：

```text
问题标题：
操作路径：
当前结果：
期望结果：
是否可复现：
截图或输出：
```

优先记录这些问题：

- 右键菜单仍出现英文命令。
- 右键子文件夹后出现范围外文件。
- 生成物被默认选中提交。
- 仓库预设没有出现或筛选结果不对。
- `预览更新` 点击无响应。
- 冲突中心无法显示冲突或对比入口。

## 重置环境

如果测试过程中执行了提交、更新或解决冲突，使用下面命令一键重置：

```powershell
cd "C:\Users\杨楠\Documents\vscode-svn"
npm run prepare:manual-test-env
code "C:\svn-workbench-manual-ui-acceptance\wc"
```
