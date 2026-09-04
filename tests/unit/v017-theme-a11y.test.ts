import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..");
const read = (relative: string): string =>
  readFileSync(path.join(root, relative), "utf8");

/* V017-E：主题、读屏语义与 reduced motion —— 平台无关的源码契约断言。
 * 中文注释：本文件为源码契约（静态包含/正则），计算样式以 e2e 为准
 * （见 tests/webview-e2e/visual-accessibility.spec.ts 主题计算样式用例）。 */
describe("V017-E 主题与辅助技术语义", () => {
  it("增删行不只靠颜色：pierre 用 classic +/-，遗留样式补符号", () => {
    const adapter = read("src/webview/features/diff/diffViewAdapter.ts");
    expect(adapter).toContain('diffIndicators: "classic"');
    const css = read("src/webview/styles/global.css");
    expect(css).toContain(".diff-line--added .line-number::before");
    expect(css).toContain('content: "+ "');
    expect(css).toContain('content: "- "');
    const theme = read("src/webview/styles/diff-theme.css");
    expect(theme).toContain("+/-");
  });

  it("阻止行除背景色外有边框通道", () => {
    const css = read("src/webview/styles/global.css");
    expect(css).toMatch(
      /\.file-row--blocked\s*\{[^}]*border-left:[^}]*var\(--danger\)/,
    );
  });

  it("notice 三通道：修复的警告/错误都有图标与角色", () => {
    const dialog = read(
      "src/webview/components/operation/OperationIntentDialog.svelte",
    );
    expect(dialog).toContain("当前意向单暂不可执行");
    expect(dialog).toMatch(
      /notice notice--warning" role="note"[\s\S]*codicon-info/,
    );
    const changes = read("src/webview/features/changes/ChangesModule.svelte");
    expect(changes).toMatch(
      /notice notice--error"[\s\S]*role="alert"[\s\S]*codicon-error/,
    );
    const toolbar = read(
      "src/webview/features/conflicts/MergeActionToolbar.svelte",
    );
    expect(toolbar).toMatch(/merge-action-error"[\s\S]*codicon-warning/);
  });

  it("reduced motion：全局关闭动效，冲突滚动感知媒体查询", () => {
    const css = read("src/webview/styles/global.css");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("scroll-behavior: auto !important");
    expect(css).toContain("animation-duration: 0.01ms !important");
    expect(css).toContain("transition-duration: 0.01ms !important");
    const adapter = read(
      "src/webview/features/conflicts/conflictDiffViewAdapter.ts",
    );
    expect(adapter).toContain("prefers-reduced-motion: reduce");
    expect(adapter).not.toMatch(/scrollIntoView\(\{\s*behavior:\s*"smooth"/);
  });

  it("动态播报节制：搜索输入不逐字播报大段内容", () => {
    const search = read("src/webview/components/list/SearchInput.svelte");
    expect(search).not.toContain('role="status"');
    expect(search).not.toContain("aria-live");
    const count = read("src/webview/components/list/ResultCount.svelte");
    // 结果数量只播报短计数，不播报大段内容。
    expect(count).toContain('role="status"');
  });

  it("真实读屏未执行如实记录，不写已通过", () => {
    const baseline = read("docs/current/设计与交互基线.md");
    expect(baseline).toContain("真实读屏未执行");
    expect(baseline).not.toContain("真实读屏已通过");
  });
});
