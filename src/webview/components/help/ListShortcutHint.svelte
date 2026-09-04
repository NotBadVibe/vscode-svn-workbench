<script lang="ts">
  /*
   * V017-B 列表聚焦后紧凑提示条（按区域实际绑定生成）。
   * - 条目来自集中 keymap（`getCompactHintItems`）；`/` 搜索仅在
   *   `searchAvailable` 为 true（真实存在搜索框并接线）时出现。
   * - 容器可聚焦并带完整 `aria-label`（键盘 focus 通道），条目带
   *   `title`（hover 通道）；状态不只依赖颜色。
   * - 首次轻提示可关闭，关闭只记会话内存（`helpSession`，不落盘）；
   *   提示条为行内次要信息，不遮挡列表、不拦截操作，可忽略。
   * - 中文文案复用 `src/webview/i18n/shortcutHelp.ts`。
   */
  import {
    getCompactHintItems,
    type ShortcutRegion,
  } from "../../keyboard/shortcuts";
  import { shortcutHelpLabels } from "../../i18n/shortcutHelp";
  import { dismissHint, isHintDismissed } from "./helpSession";

  let {
    region = "list" as ShortcutRegion,
    hintKey = "list",
    searchAvailable = false,
  }: {
    region?: ShortcutRegion;
    hintKey?: string;
    searchAvailable?: boolean;
  } = $props();

  let dismissedLocal = $state(false);
  /** 会话记忆（`helpSession`）或本次交互关闭后隐藏。 */
  const dismissed = $derived(dismissedLocal || isHintDismissed(hintKey));
  const items = $derived(getCompactHintItems(region, { searchAvailable }));
  const fullText = $derived(
    items
      .map((item) => `${item.display} ${item.hintLabel ?? item.label}`)
      .join(" · "),
  );

  function onDismiss(): void {
    dismissHint(hintKey);
    dismissedLocal = true;
  }
</script>

{#if !dismissed && items.length > 0}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -- 提示条需键盘可聚焦以播报全文；内容同时以可见文本呈现，不只依赖焦点。 -->
  <div
    class="list-shortcut-hint"
    role="note"
    tabindex="0"
    aria-label={`${shortcutHelpLabels.hintRegion}：${fullText}。${shortcutHelpLabels.hintNote}`}
    data-testid="list-shortcut-hint"
  >
    <span class="hint-items">
      {#each items as item, index (item.id)}
        {#if index > 0}<span class="hint-sep" aria-hidden="true"> · </span>{/if}
        <span class="hint-item" title={item.title}>
          <code>{item.display}</code>
          <span>{item.hintLabel ?? item.label}</span>
        </span>
      {/each}
    </span>
    <span class="hint-note muted">{shortcutHelpLabels.hintNote}</span>
    <button
      type="button"
      class="button button--secondary hint-dismiss"
      aria-label={shortcutHelpLabels.dismissHintName}
      title={shortcutHelpLabels.dismissHint}
      data-testid="list-shortcut-hint-dismiss"
      onclick={onDismiss}
    >
      {shortcutHelpLabels.dismissHint}
    </button>
  </div>
{/if}

<style>
  .list-shortcut-hint {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 4px 8px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    background: var(--vscode-editor-background);
    font-size: 12px;
  }
  .list-shortcut-hint:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .hint-items {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
  }
  .hint-item code {
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .hint-sep {
    margin: 0 4px;
    color: var(--vscode-descriptionForeground);
  }
  .hint-note {
    font-size: 12px;
  }
  .hint-dismiss {
    margin-left: auto;
    padding: 2px 8px;
    font-size: 12px;
  }
</style>
