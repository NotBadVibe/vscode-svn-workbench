# SVN 工作台 v0.0.1 验收报告

> 验收日期：2026-07-31  
> 结论：自动化、制品与 Windows/macOS/Linux CI 验收通过，私有预发布已归档；真实 VS Code 现场检查与目标企业环境签字仍待补齐
> 版本清单：[`manifest.json`](./manifest.json)
> 功能追踪：[`v0.0.1 实现状态与验收追踪`](../../archive/milestones/2026-07/v0.0.1实现状态与验收追踪.md)
> 页面截图：[`artifacts/pages/README.md`](./artifacts/pages/README.md)
> 中文体验专项记录：[`中文体验与页面滚动验收.md`](./中文体验与页面滚动验收.md)

## 1. 候选与环境

| 项目           | 值                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 候选源码       | [私有仓库 `v0.0.1` 标签](https://github.com/NotBadVibe/VSCode-svn-workbench/tree/v0.0.1)                                      |
| VSIX           | [GitHub 私有预发布附件](https://github.com/NotBadVibe/VSCode-svn-workbench/releases/download/v0.0.1/svn-workbench-0.0.1.vsix) |
| VSIX 文件数    | 91                                                                                                                            |
| VSIX 大小      | 441,691 字节                                                                                                                  |
| SHA256         | `445B4B4BA9E45505A8BC2C481D47D9530BF29E8995FE69466A60FCA0A28DF31C`                                                            |
| 操作系统       | macOS 26.6（Darwin 25G72），ARM64                                                                                             |
| VS Code        | 1.131.0，ARM64                                                                                                                |
| SVN / svnadmin | 1.14.5 / 1.14.5                                                                                                               |
| Node / npm     | 26.0.0 / 11.12.1                                                                                                              |

任何进入 VSIX 的源码、README、Changelog、依赖或构建配置变化都会使本节指纹失效，必须重新打包并重新执行安装生命周期。

## 2. 自动化结果

| 层级                    | 命令                            | 结果 | 关键证据                                                                            |
| ----------------------- | ------------------------------- | ---- | ----------------------------------------------------------------------------------- |
| 静态与 Svelte           | `npm run check`                 | 通过 | TypeScript 编译通过；Svelte 0 error、0 warning                                      |
| 单元/组件/领域/覆盖率   | `npm run test:coverage`         | 通过 | 29 文件、208 项；无跳过；包含中文格式化、IME、taskId、Explorer/编辑器冷启动菜单回归 |
| Webview/视觉/无障碍     | `npm run test:webview`          | 通过 | 42 项；ZH-01～ZH-10、SCR-01～SCR-15、三主题、真实局部滚动、200% 缩放、axe           |
| 性能                    | `npm run test:performance`      | 通过 | 20 次冷启动、5000 文件和 gzip 预算全部通过                                          |
| Extension Host/真实 SVN | `npm run test:extension`        | 通过 | 106 项；包含 SCM 参数、真实提交与隔离仓库高级操作                                   |
| 一键门禁                | `npm run verify`                | 通过 | 当时的结果现已固化到本版本证据目录                                                  |
| 依赖安全                | `npm audit --audit-level=high`  | 通过 | 0 vulnerabilities                                                                   |
| 打包                    | `npm run package:vsix`          | 通过 | 91 文件，vsce 显示 431.34 KB                                                        |
| 安装生命周期            | `npm run validate:vsix-install` | 通过 | 干净 profile 安装→可列出→卸载→为空→重装→可列出                                      |

### 覆盖率门槛

| 指标                         |   实测 | 门槛 | 结论 |
| ---------------------------- | -----: | ---: | ---- |
| Statements                   | 91.64% |  80% | 通过 |
| Branches                     | 81.49% |  80% | 通过 |
| Functions                    | 96.81% |  80% | 通过 |
| Lines                        | 91.82% |  80% | 通过 |
| Protocol branches            | 96.66% |  90% | 通过 |
| AI result validator branches | 93.75% |  90% | 通过 |

## 3. 功能矩阵结论

| 范围               | 结论                      | 验收摘要                                                           |
| ------------------ | ------------------------- | ------------------------------------------------------------------ |
| CORE-01～CORE-11   | 通过                      | 状态、更新、提交、Diff、历史、冲突合并及常用文件操作闭环           |
| SCM-01～SCM-07     | 通过                      | 独立 provider、状态组、共享草稿、Changelist、多仓库与归属边界      |
| SAFE-01～SAFE-10   | 通过                      | SecretStorage 认证、证书核对、网络分类、取消、恢复、危险确认和降级 |
| HIST-01～HIST-05   | 通过                      | 修订、Changed Paths、任意比较、Blame 与恢复                        |
| ADMIN-01～ADMIN-07 | 通过                      | Branch/Tag/Switch/Relocate/Merge/Browser/Patch/Shelf/发布说明      |
| AI-01～AI-14       | 通过                      | 建议、证据、拆分、隐私预算、团队记忆、过期保护和本地降级           |
| CTX-01～CTX-08     | 通过（平台边界见第 8 节） | Explorer 模块入口、SCM 精确状态菜单、Svelte 右键、多选与混仓阻止   |

逐项实现与边界见 [`v0.0.1 实现状态与验收追踪`](../../archive/milestones/2026-07/v0.0.1实现状态与验收追踪.md)。

## 4. 性能

| 指标                    |    实测 |      预算 | 结论 |
| ----------------------- | ------: | --------: | ---- |
| Mock 首次可交互 P50     |    44ms |         — | 记录 |
| Mock 首次可交互 P95     |    48ms |    ≤700ms | 通过 |
| Shell JS gzip           | 34,055B | ≤163,840B | 通过 |
| Shell CSS gzip          | 17,884B |  ≤51,200B | 通过 |
| 业务懒加载块            |      19 |       ≥17 | 通过 |
| Repository 子任务异步块 |       7 |        ≥7 | 通过 |
| 5000 文件已挂载行       |      18 |      ≤100 | 通过 |
| 5000 文件滚动到末尾     |    36ms |    ≤500ms | 通过 |

原始 20 次样本与预算判断见 [`performance.json`](./artifacts/performance.json)。脚本在超预算时返回非零退出码，不依赖人工判断。

## 5. UI、主题与截图

- 功能页与关键恢复状态：21 张，统一为 Dark 1440 × 960 完整内容截图；这组截图不作为滚动通过证据。
- 主题/宽度矩阵：Light、Dark、High Contrast × 720、1024、1440，共 9 张。
- 每张功能页截图前检查：模块非加载中、字体完成、无页面级横向溢出、axe 无自动可检测违规。
- 真实视口测试不注入 overflow 覆盖；实际验证局部容器溢出、PageDown、滚到末项、焦点离开、小高度和 200% 缩放。
- 键盘自动化覆盖 Svelte 右键菜单的方向键、Enter 与 Escape；冲突工作副本编辑器使用 CodeMirror 可编辑表面。
- 5000 文件页验证虚拟列表，DOM 行数低于 100。

## 5.1 中文体验与滚动增量验收

| 范围              | 结论 | 自动化证据                                                                      |
| ----------------- | ---- | ------------------------------------------------------------------------------- |
| ZH-01～ZH-04      | 通过 | 公共状态、24 小时时间、中文数字与量词；页面英文白名单扫描                       |
| ZH-05～ZH-06      | 通过 | `特殊 路径/订单(#1).ts`；提交和 AI 目标的 IME composition 防误触                |
| ZH-07～ZH-09      | 通过 | 危险操作精确范围/后果/恢复性；中文错误恢复；AI 外发模型、文件数、字符和历史范围 |
| ZH-10             | 通过 | 100%～200% 缩放矩阵，关键警告与操作无永久裁切                                   |
| SCR-01～SCR-08    | 通过 | Shell、变更、提交、历史、冲突、变更集、Repository、设置与诊断真实局部滚动       |
| SCR-09～SCR-15    | 通过 | 480px 高度、滚动反馈、键盘、焦点、嵌套滚动、四档高度与缩放矩阵                  |
| Repository 任务化 | 通过 | `moduleId + taskId + scope` 深链接；7 个任务异步包；非当前任务资源不加载        |

截图目录：[`artifacts/`](./artifacts/)；逐页说明：[`pages/README.md`](./artifacts/pages/README.md)。

## 6. 安全与恢复

| 检查           | 结论                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------- |
| 密码/API Key   | Password 不进入 Webview 消息和日志；SVN password 走 stdin；API Key/凭据由 SecretStorage 保存 |
| AI 隐私        | 提交历史默认关闭；启用时仅使用脱敏成功提交摘要，限制 1～20 条；调用前展示数据范围            |
| CSP            | 单 nonce 启动脚本、本地资源、无 `unsafe-inline`/`unsafe-eval`                                |
| Host 边界      | Webview 只表达意图；Host 校验协议、scope、仓库、路径、revision、状态哈希和确认令牌           |
| 破坏性操作     | Revert/Delete/Switch/Merge 显示精确目标、影响和可恢复性，要求独立勾选确认                    |
| 取消/过期      | 取消后重新采集状态；旧请求、旧 AI 结果和旧预览不可执行                                       |
| 认证/证书/网络 | 有独立分类和恢复页；证书展示主机/指纹/原因；代理可跳转 VS Code 设置                          |
| 工作副本恢复   | locked/interrupted 有安全 Cleanup 预览，恢复后强制刷新                                       |

## 7. 制品审计与安装生命周期

最终 VSIX 仅包含运行所需 `out/`、`dist/webview/`、manifest、README、Changelog 和 License。以下内容均未入包：

- `src/`、`tests/`、`docs/`、`scripts/`、`.github/`
- `coverage/`、Playwright 报告、test-results、`.validation/`
- TypeScript/Vite source map、锁文件和本机环境文件

安装生命周期使用独立 `user-data` 与 `extensions` 目录完成，验证结果为：

1. 安装 `local.svn-workbench@0.0.1` 成功。
2. `--list-extensions --show-versions` 可找到精确版本。
3. 卸载成功，列表为空。
4. 同一 VSIX 重装成功，列表再次出现精确版本。
5. 使用 `--force` 覆盖安装到当前 VS Code 后执行“开发人员：重新加载窗口”；Explorer 文件夹右键应显示“SVN 工作台”子菜单，常用操作位于首层，AI、恢复、更多 SVN 操作、设置与诊断按任务分组。

安装生命周期的可归档摘要见 [`vsix-install.json`](./artifacts/vsix-install.json)。

真实 VS Code 的右键菜单、任务直达与局部滚动现场检查单独记录在 [`中文体验与页面滚动验收记录`](./中文体验与页面滚动验收.md)；自动化或 Mock 结果不替代其中的人工项。

## 8. 平台边界与发布前外部证据

- 源码已推送至 [GitHub 私有仓库](https://github.com/NotBadVibe/VSCode-svn-workbench)；Windows、macOS、Linux 的 SVN、覆盖率、Webview、Extension Host 与候选制品门禁已在 [GitHub Actions #30638351619](https://github.com/NotBadVibe/VSCode-svn-workbench/actions/runs/30638351619) 全部通过。
- Windows Runner 使用 SlikSVN 1.14.5。英文系统代码页无法向 SVN 1.14 无损传递中文命令行参数，因此真实提交用 `added (#1).txt` 验证空格、括号和 `#`；中文路径采集仍由 `特殊 路径/订单(#1).ts` 自动化覆盖。完整中文文件名的端到端提交保留为目标 `zh-CN` Windows 实机抽查项。
- 真实企业 AI Provider、代理和私有 CA 需要目标环境账号/网络；本次覆盖其配置、错误分类、敏感信息边界、本地降级与页面状态，不声称完成某个企业端点的连通性认证。
- VS Code Explorer 公开 `when` 条件无法为每个资源异步查询 SVN 状态。为避免入口依赖扩展激活后 context key 的冷启动循环，Explorer 模块子菜单对 `file` 资源稳定可见；精确 conflicted/versioned/unversioned 菜单在原生 SCM 和 Svelte 文件树提供；Explorer 命令执行前仍由 Host 复验并拒绝非 SVN/混仓范围。
- 候选源码由 `v0.0.1` 标签固定，VSIX 以同名私有预发布附件归档；附件大小和 SHA256 必须与第 1 节一致。

## 9. 结论与签字

- [x] 本机开发验收通过
- [x] 功能矩阵实现关闭
- [x] 中文体验、局部滚动、页面与主题自动化证据已保存
- [x] 最终 VSIX 打包和干净 profile 生命周期通过
- [x] 冻结并推送候选 commit，创建 `v0.0.1` 私有预发布
- [x] Windows/macOS/Linux 远端 CI 运行全部绿色
- [ ] 真实 VS Code Explorer 右键、任务直达与局部滚动现场确认
- [ ] 目标企业 AI/代理/CA（若项目要求）连接性签字

当前候选可通过私有预发布交付给产品/测试进行独立安装验收。对外发布前，发布负责人必须补齐其余适用证据；若任一项失败，结论自动退回“不通过”，修复后从受影响层重新执行。
