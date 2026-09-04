<script lang="ts">
  /*
   * V017-B 上下文快捷帮助共享组件（`?` 触发 + 当前区域面板）。
   * - 帮助条目只显示当前区域绑定，来自集中 keymap
   *  （`src/webview/keyboard/shortcuts.ts`），不显示无关命令。
   * - Tooltip 双通道：触发按钮 `title`（hover）+ `aria-label` 与可见
   *   `?` 文本（键盘 focus/读屏）；面板条目为可见文本，无隐藏信息。
   * - Esc 关闭帮助并把焦点返回触发按钮；IME 候选阶段 `?` 不切换。
   * - 中文文案复用 `src/webview/i18n/shortcutHelp.ts`。
   */
  import {
    getShortcutsForRegion,
    type ShortcutRegion,
  } from "../../keyboard/shortcuts";
  import {
    shortcutHelpLabels,
    shortcutHelpRegionTitles,
  } from "../../i18n/shortcutHelp";
  import { isImeComposing } from "../../i18n/keyboard";

  let {
    region,
    open = $bindable(false),
    showTrigger = true,
    triggerTestId = "shortcut-help-trigger",
    panelTestId = "shortcut-help-panel",
    closeTestId = "shortcut-help-close",
    searchAvailable = false,
    returnFocusTo = null,
    extraNote = undefined,
    onClose,
  }: {
    region: ShortcutRegion;
    open?: boolean;
    showTrigger?: boolean;
    triggerTestId?: string;
    panelTestId?: string;
    closeTestId?: string;
    searchAvailable?: boolean;
    returnFocusTo?: HTMLElement | null | (() => HTMLElement | null);
    extraNote?: string;
    onClose?: () => void;
  } = $props();

  let triggerEl = $state<HTMLButtonElement | undefined>();
  let closeEl = $state<HTMLButtonElement | undefined>();
  const shortcuts = $derived(
    getShortcutsForRegion(region, { searchAvailable }),
  );
  const panelTitle = $derived(shortcutHelpRegionTitles[region]);

  function focusTarget(): HTMLElement | undefined | null {
    if (typeof returnFocusTo === "function") return returnFocusTo();
    return returnFocusTo ?? triggerEl;
  }

  function closeHelp(restoreFocus = true): void {
    if (!open) return;
    open = false;
    onClose?.();
    if (restoreFocus) focusTarget()?.focus();
  }

  function toggleHelp(): void {
    open = !open;
    if (!open) onClose?.();
  }

  // 打开后把焦点放入面板关闭按钮；关闭/Esc 后由 closeHelp 返回触发按钮。
  $effect(() => {
    if (open) closeEl?.focus();
  });

  function onTriggerKeydown(event: KeyboardEvent): void {
    if (isImeComposing(event)) return;
    if (
      event.key === "?" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      toggleHelp();
      // 打开后焦点进入面板关闭按钮（$effect），关闭后返回触发按钮。
      if (!open) focusTarget()?.focus();
    }
  }

  function onPanelKeydown(event: KeyboardEvent): void {
    if (isImeComposing(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeHelp(true);
      return;
    }
    if (
      event.key === "?" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      // 中文注释：V017-C T4——面板内按 `?` 关闭时同样返回触发按钮，
      // 否则焦点随已卸载的关闭按钮丢失到 body。
      const wasOpen = open;
      toggleHelp();
      if (wasOpen) focusTarget()?.focus();
    }
  }
</script>

<div class="shortcut-help" data-testid="shortcut-help-host">
  {#if showTrigger}
    <button
      type="button"
      class="button button--secondary"
      bind:this={triggerEl}
      data-testid={triggerTestId}
      aria-label={shortcutHelpLabels.triggerName}
      title={shortcutHelpLabels.triggerName}
      aria-expanded={open}
      onclick={toggleHelp}
      onkeydown={onTriggerKeydown}
    >
      {shortcutHelpLabels.trigger}
    </button>
  {/if}
  {#if open}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -- 面板内唯一可聚焦控件为关闭按钮；Esc/`?` 经冒泡在面板层统一处理并返回焦点。 -->
    <div
      class="shortcut-help-panel"
      role="region"
      aria-label={panelTitle}
      data-testid={panelTestId}
      onkeydown={onPanelKeydown}
    >
      <strong>{panelTitle}（? 打开/关闭）</strong>
      <small class="muted">{shortcutHelpLabels.halfWidthNote}</small>
      <ul>
        {#each shortcuts as sc (sc.id)}
          <li data-testid={`shortcut-item-${sc.id}`}>
            <span>{sc.label}</span><code>{sc.display}</code><small
              >{sc.title}</small
            >
          </li>
        {/each}
      </ul>
      {#if extraNote}
        <small class="muted" data-testid="shortcut-help-extra-note"
          >{extraNote}</small
        >
      {/if}
      <button
        type="button"
        class="button button--secondary"
        bind:this={closeEl}
        data-testid={closeTestId}
        onclick={() => closeHelp(true)}
      >
        {shortcutHelpLabels.close}
      </button>
    </div>
  {/if}
</div>

<style>
  .shortcut-help {
    display: contents;
  }
  .shortcut-help-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    background: var(--vscode-editor-background);
  }
  .shortcut-help-panel ul {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .shortcut-help-panel li {
    display: flex;
    gap: 8px;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .shortcut-help-panel code {
    font-family: var(--vscode-editor-font-family, monospace);
  }
</style>
