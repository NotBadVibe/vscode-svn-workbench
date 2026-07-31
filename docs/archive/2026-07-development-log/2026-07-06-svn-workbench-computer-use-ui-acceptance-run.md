# SVN Workbench Computer Use UI 验收执行记录

日期：2026-07-06

阶段：验收准备 -> 真实 UI 触发

## 执行环境

```text
OS: Windows
VS Code: 1.127.0
Workspace: C:\svn-workbench-validation-test-wc
Installed Extension: local.svn-workbench@0.0.1
SVN: 1.14.2-SlikSvn
```

## 已执行 UI 操作

### 1. 打开 VS Code 工作副本窗口

结果：通过

实际窗口标题：

```text
app.exe - svn-workbench-validation-test-wc - Visual Studio Code
```

左侧 SCM 区域显示 SVN 状态分组：

- Conflicts
- Modified
- Added
- Deleted
- Missing
- Unversioned

### 2. 命令面板打开验收清单

操作：

```text
F1 -> SVN: Open Acceptance Checklist -> Enter
```

结果：通过

实际打开页面：

```text
SVN UI 验收清单
```

页面可见：

- 6 个分组
- 13 个验收项
- 37 个步骤
- 30 个期望结果
- 环境检查
- 打开输出
- AI 配置
- 复制 Markdown

### 3. 验收清单按钮触发环境检查

操作：

```text
点击 验收清单 -> 环境检查
```

结果：通过

输出面板显示：

```text
SVN Workbench 环境诊断：提醒
[通过] 操作系统：Windows
[通过] CPU 架构：x64
[通过] VS Code 版本：1.127.0
[通过] SVN CLI：svn.exe (1.14.2-SlikSvn)
[通过] 工作区：1/1 个工作区包含 .svn
[提醒] AI 配置：deepseek 缺少 API Key
```

结论：

- 环境检查可从 Webview 按钮真实触发。
- 输出面板能切换到 `SVN Workbench`。
- AI API Key 缺失是当前机器配置状态，不是扩展错误。

### 4. 命令面板打开提交页

操作：

```text
F1 -> SVN: Commit This Scope -> Enter
```

结果：通过

实际打开页面：

```text
SVN 提交
```

页面可见：

- 候选筛选控件
- 隐藏生成物
- AI 筛选
- AI 拆分提交
- 接受 AI 推荐
- 恢复默认
- 只选当前筛选
- 加入当前筛选
- 移除当前筛选
- 预览提交计划
- 预览更新
- 更新当前范围
- 提交说明输入框
- 确认提交

### 5. 提交页预览更新按钮

操作：

```text
点击 提交页 -> 预览更新
```

结果：需复核

观察：

- 按钮可见。
- 自动化点击后未观察到更新预览结果区。
- 输出面板未观察到新的 `svn status --show-updates` 输出。
- 隐藏生成物复选框在自动化点击下也未出现明显状态变化。

初步判断：

- 可能是 Computer Use 对当前 Webview 内按钮点击的命中问题。
- 也可能是提交页 Webview 交互事件需要进一步复核。

后续建议：

1. 人工鼠标点击一次 `预览更新` 复核。
2. 如果人工也无响应，优先排查提交页 Webview 前端事件绑定。
3. 如果人工可响应，则记录为自动化点击限制。

### 6. 命令面板打开冲突中心

操作：

```text
F1 -> SVN: Open Conflict Center -> Enter
```

结果：通过

实际打开页面：

```text
SVN 冲突中心
```

页面显示：

```text
当前范围没有 SVN 冲突
```

结论：

- 冲突中心命令可从真实命令面板触发。
- 当前验证工作副本没有冲突，因此显示空状态符合预期。

## 意外情况

第一次尝试命令面板时，焦点没有进入命令面板，文本进入了左侧 SCM 筛选框；同时其他扩展弹出了 `.NET Install Tool` 的 SDK 输入流程。

处理方式：

- 未继续执行该第三方扩展流程。
- 使用 `Developer: Reload Window` 重载 VS Code。
- 重载后新命令 `SVN: Open Acceptance Checklist` 正常出现。

## 当前结论

通过：

- VS Code 中已安装扩展可见。
- 命令面板能触发验收清单。
- 验收清单 Webview 可打开。
- 验收清单按钮能触发环境检查。
- 输出面板能展示环境诊断结果。
- 命令面板能打开提交页。
- 命令面板能打开冲突中心。

需复核：

- 提交页 Webview 内按钮点击，尤其是 `预览更新`。

## 下一步

建议优先做一次人工点击复核：

1. 打开 `SVN 提交` 页。
2. 手动点击 `预览更新`。
3. 观察页面是否出现更新预览。
4. 如果无响应，进入代码修复。

