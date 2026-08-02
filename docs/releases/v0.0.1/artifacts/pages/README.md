# SVN Workbench v3 页面截图索引

本目录由 `tests/webview-e2e/page-screenshots.spec.ts` 在 1440 × 960 Dark 主题下生成。每次截图前均检查页面无水平溢出且 axe 无自动可检测违规。这里的完整内容截图使用专用捕获样式，只用于信息结构和视觉评审，不作为真实滚动证据。

同级目录另有 Light、Dark、High Contrast 在 720、1024、1440 三种宽度下的 9 张真实视口主题截图；它们由 `visual-accessibility.spec.ts` 生成，不修改页面 overflow。真实小区域滚动、末项边界、键盘 PageDown、焦点离开和 200% 缩放由 `chinese-scroll.spec.ts` 逐项断言。

| 文件 | 页面 / 状态 |
| --- | --- |
| `01-changes.png` | 工作副本修改、共享提交草稿、归属徽标 |
| `02-diff.png` | BASE ↔ 工作副本差异 |
| `03-commit.png` | 智能提交、AI 草稿与签名预览 |
| `04-history.png` | 修订历史、变更路径与逐行责任 |
| `05-conflicts.png` | 三方块级合并、AI 证据与解决预览 |
| `06-changelists.png` | AI 拆分与原生 SVN 变更集预览 |
| `07-ai-review.png` | AI 变更审查证据 |
| `08-impact.png` | 影响与测试建议 |
| `09-agent.png` | 受控任务代理计划 |
| `10-repository-update.png` | 任务化仓库页面：更新当前范围 |
| `10-repository-recovery.png` | 任务化仓库页面：清理与恢复工作副本 |
| `10a-repository-browser-release-notes.png` | 仓库浏览与发布说明子任务 |
| `10b-repository-destructive-preview.png` | 切换工作副本的破坏性二次确认 |
| `11-settings-ai.png` | AI 模型、路由与历史隐私预算 |
| `12-settings-team.png` | 团队规则与本地团队记忆 |
| `13-settings-svn-security.png` | SVN 认证与证书安全说明 |
| `13-diagnostics.png` | 环境诊断与验收清单 |
| `14-changes-5000-files.png` | 5000 文件窗口化列表 |
| `15-authentication-recovery.png` | 用户名/密码安全恢复 |
| `16-certificate-recovery.png` | HTTPS 证书指纹核对 |
| `17-proxy-recovery.png` | 代理故障分类与设置入口 |
