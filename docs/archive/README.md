# SVN Workbench 历史归档

本目录保存被 v3 替代的规格、原型和研发过程证据。内容保持可追溯，但不再作为现行产品或验收基线。

## 目录说明

| 目录 | 文件数 | 内容 | 当前用途 |
| --- | ---: | --- | --- |
| [`legacy-specs/`](./legacy-specs/) | 4 | 旧产品规格、页面规格、AI 专项和技术可行性 | 查询 SVN、范围、安全等原始论证 |
| [`prototype-v1/`](./prototype-v1/) | 16 | 第一版 11 页高保真原型 | 设计演变记录；已被 07-25 完整覆盖 |
| [`prototype-07-25/`](./prototype-07-25/) | 18 | 迭代后的旧高保真原型和检查脚本 | 查询复杂状态与组件细节 |
| [`2026-07-development-log/`](./2026-07-development-log/) | 167 | 功能增量、测试 PASS、安装和 VSIX 记录 | 审计研发过程 |

## 使用边界

- 产品与交互决策以 `../SVN工作台原型v3/` 为准。
- 技术实现以 `../implementation-reference/` 为准。
- 归档中的 Activity Bar 大工作台、完整页面数量、自建 Diff/Merge、Svelte 重写、v1 里程碑等内容可能已失效。
- 归档中的 Windows 路径、测试数量、包大小和 SHA256 都是历史快照。
- `legacy-specs` 原先引用的 `docs/workbuddy/v1-spec-converged.md` 已不存在；其权威声明已被当前文档体系取代。

## 两代旧原型的关系

`prototype-07-25` 包含 `prototype-v1` 的全部相对文件：13 个文件经过改进，3 个文件内容相同，并新增优化说明和检查脚本。保留 `prototype-v1` 仅为了设计演变追溯。

## 历史测试说明

开发日志中存在从少量 PASS 逐步增长到 103 PASS 的大量中间记录。它们说明功能演进，但不能证明当前代码仍通过相同测试。当前验证规则见：

[`../implementation-reference/测试与交付基线.md`](../implementation-reference/测试与交付基线.md)

