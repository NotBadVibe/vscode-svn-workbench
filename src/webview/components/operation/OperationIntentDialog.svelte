<script lang="ts">
  import { isImeComposing } from "../../i18n/keyboard";
  import PreviewPathList from "../list/PreviewPathList.svelte";
  import type {
    HostToWebviewMessage,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import type { OperationIntentView } from "../../../operation/operationIntent";

  /**
   * v0.0.14 通用操作意向单对话框
   * - 意图摘要（动作+数量+范围）、影响清单（可搜索/复制，复用 PreviewPathList）
   * - 确认 token、范围/revision 变化自动失效只读
   * - 可访问性：Esc 关闭、显式取消、焦点锁定、焦点返回触发按钮、背景不可交互（dialog showModal）
   * - 中文 IME composition 保护：候选阶段 Enter 不触发确认
   */

  let {
    intent,
    open,
    onConfirm,
    onCancel,
    onAction,
    pathDetail,
    confirmLabel,
    cancelLabel = "取消",
    triggerElement,
    recheckLabel,
    onRecheck,
  }: {
    intent?: OperationIntentView;
    open: boolean;
    onConfirm: (token: string) => void;
    onCancel: () => void;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
    pathDetail?: Extract<
      HostToWebviewMessage,
      { type: "file/path-detail-result" }
    >["payload"];
    confirmLabel: string;
    cancelLabel?: string;
    /** 触发按钮，用于焦点返回 */
    triggerElement?: HTMLElement | null;
    /**
     * v0.1.5 V015-C1：stale/不可执行态的“重新检查”次级按钮文案。
     * 仅当同时提供 onRecheck 时渲染；点击后透传页面既定的重新预览动作，
     * 组件不拼 action 名。缺省时保持原双按钮结构。
     */
    recheckLabel?: string;
    onRecheck?: () => void;
  } = $props();

  let dialogEl = $state<HTMLDialogElement | undefined>(undefined);
  let isComposing = $state(false);
  let previousFocus = $state<HTMLElement | null>(null);
  let confirmButtonEl = $state<HTMLButtonElement | null>(null);

  // 打开时保存触发点，showModal 并把焦点移到确认按钮（首个主操作）
  $effect(() => {
    if (open && intent) {
      previousFocus = (triggerElement ??
        (document.activeElement as HTMLElement | null)) as HTMLElement | null;
      queueMicrotask(() => {
        if (!dialogEl) return;
        try {
          dialogEl.showModal();
        } catch {
          dialogEl.setAttribute("open", "");
        }
        // 焦点锁定起点：优先确认按钮，其次对话框自身
        queueMicrotask(() => {
          const first = dialogEl?.querySelector<HTMLButtonElement>(
            "button[data-primary]",
          );
          (first ?? dialogEl)?.focus();
        });
      });
    } else {
      // 关闭时恢复焦点、清理 open 属性
      if (dialogEl?.open) dialogEl.close();
      else dialogEl?.removeAttribute("open");
      // 焦点返回触发按钮
      if (previousFocus) {
        queueMicrotask(() => previousFocus?.focus());
        previousFocus = null;
      }
    }
  });

  function handleCancel(): void {
    onCancel();
  }

  function handleConfirm(): void {
    if (!intent) return;
    if (intent.stale || !intent.canExecute) return;
    onConfirm(intent.token);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (isComposing || isImeComposing(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      handleCancel();
      return;
    }
    // 焦点锁定：Tab 在对话框首尾循环
    if (event.key === "Tab" && dialogEl) {
      const focusable = Array.from(
        dialogEl.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    // IME 候选阶段 Enter 不触发确认
    if (event.key === "Enter" && isComposing) {
      event.preventDefault();
    }
  }

  // 点击 backdrop 关闭（dialog 原生：点击 ::backdrop 会触发 cancel 事件，此处用 mousedown 兜底）
  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === dialogEl) {
      handleCancel();
    }
  }
</script>

{#if intent}
  <dialog
    bind:this={dialogEl}
    class="operation-intent-dialog"
    aria-modal="true"
    aria-label={intent.title}
    onkeydown={handleKeydown}
    oncompositionstart={() => (isComposing = true)}
    oncompositionend={() => (isComposing = false)}
    onmousedown={handleBackdropClick}
    onclose={handleCancel}
  >
    <form method="dialog" class="operation-intent-dialog__card">
      <div class="operation-intent-dialog__header">
        <div>
          <h3 class="operation-intent-dialog__title">{intent.title}</h3>
          <p class="operation-intent-dialog__summary">{intent.summary}</p>
        </div>
        {#if intent.stale}
          <span class="badge badge--warning" role="status">已失效（只读）</span>
        {/if}
      </div>

      {#if intent.stale}
        <div class="notice notice--warning" role="alert">
          <span class="codicon codicon-warning" aria-hidden="true"></span>
          范围、候选或修订版本已变化，旧意向单已只读失效，不能凭旧确认继续执行。请关闭后重新生成预览。
        </div>
      {/if}

      {#if intent.issues.length > 0}
        <div class="notice notice--error" role="alert">
          {#each intent.issues as issue, i (i)}
            <div>{issue}</div>
          {/each}
        </div>
      {:else if !intent.canExecute}
        <div class="notice notice--warning">
          当前意向单暂不可执行，请检查影响清单。
        </div>
      {/if}

      <div class="operation-intent-dialog__meta">
        <span class="operation-intent-dialog__count"
          >影响 {intent.paths.length} 个路径</span
        >
        {#if intent.createdAt}
          <small class="operation-intent-dialog__time"
            >{new Date(intent.createdAt).toLocaleString("zh-CN")}</small
          >
        {/if}
      </div>

      <!-- v0.1.5 V015-C1：九要素补齐行（范围 / 修订版本 / 可恢复性，有则展示，无不虚构） -->
      {#if intent.scopeText}
        <div class="notice" role="note">
          <span class="codicon codicon-repo" aria-hidden="true"></span><span
            ><strong>范围：</strong>{intent.scopeText}</span
          >
        </div>
      {/if}
      {#if intent.revision}
        <div class="notice" role="note">
          <span class="codicon codicon-history" aria-hidden="true"></span><span
            ><strong>修订版本：</strong>{intent.revision}</span
          >
        </div>
      {/if}
      {#if intent.recoverability}
        <div class="notice notice--warning" role="note">
          <span class="codicon codicon-info" aria-hidden="true"></span><span
            ><strong>可恢复性：</strong>{intent.recoverability}</span
          >
        </div>
      {/if}

      <!-- 影响清单：可搜索/复制，复用 PreviewPathList 底座 -->
      <PreviewPathList
        paths={intent.paths}
        label="影响清单"
        emptyHint="没有匹配的路径；调整搜索词后重试。"
        {onAction}
        {pathDetail}
      />

      {#if intent.commands && intent.commands.length > 0}
        <details class="operation-intent-dialog__commands">
          <summary>查看将执行的命令（{intent.commands.length}）</summary>
          {#each intent.commands as command, idx (idx)}
            <code class="operation-intent-dialog__command">{command}</code>
          {/each}
        </details>
      {/if}

      <div
        class="operation-intent-dialog__actions"
        role="group"
        aria-label="意向单操作"
      >
        <button
          type="button"
          class="button button--secondary"
          onclick={handleCancel}
          onkeydown={(e) =>
            isComposing && e.key === "Enter" && e.preventDefault()}
          >{cancelLabel}</button
        >
        {#if recheckLabel && onRecheck && (intent.stale || !intent.canExecute)}
          <button
            type="button"
            class="button button--secondary"
            onclick={() => onRecheck?.()}
            onkeydown={(e) =>
              isComposing && e.key === "Enter" && e.preventDefault()}
            title="关闭当前意向单，按页面既定流程重新生成预览"
            >{recheckLabel}</button
          >
        {/if}
        <button
          bind:this={confirmButtonEl}
          type="button"
          class="button button--primary"
          data-primary="true"
          disabled={intent.stale || !intent.canExecute}
          aria-disabled={intent.stale || !intent.canExecute}
          title={intent.stale
            ? "意向单已失效，请重新预览"
            : !intent.canExecute
              ? "存在校验问题，无法执行"
              : confirmLabel}
          onkeydown={(e) =>
            isComposing && e.key === "Enter" && e.preventDefault()}
          onclick={handleConfirm}
          >{confirmLabel}{intent.stale ? "（已失效）" : ""}</button
        >
      </div>
    </form>
  </dialog>
{/if}

<style>
  .operation-intent-dialog {
    max-width: 720px;
    width: min(720px, 90vw);
    max-height: 86vh;
    padding: 0;
    border: 1px solid var(--vscode-panel-border, #ddd);
    border-radius: 6px;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
  }
  .operation-intent-dialog::backdrop {
    background: rgba(0, 0, 0, 0.32);
  }
  .operation-intent-dialog__card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    max-height: 86vh;
    overflow: auto;
  }
  .operation-intent-dialog__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .operation-intent-dialog__title {
    font-size: 16px;
    font-weight: 600;
    margin: 0;
  }
  .operation-intent-dialog__summary {
    margin: 4px 0 0;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }
  .operation-intent-dialog__meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  .operation-intent-dialog__actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--vscode-panel-border);
  }
  .operation-intent-dialog__commands {
    font-size: 12px;
  }
  .operation-intent-dialog__command {
    display: block;
    margin-top: 4px;
    padding: 4px 6px;
    background: var(--vscode-textCodeBlock-background);
    border-radius: 3px;
    overflow-wrap: break-word;
  }
  .badge--warning {
    background: var(--vscode-inputValidation-warningBackground);
    border: 1px solid var(--vscode-inputValidation-warningBorder);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 11px;
  }
</style>
