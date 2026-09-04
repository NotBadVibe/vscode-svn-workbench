<script lang="ts">
  /*
   * v0.1.5 V015-B TaskErrorState：错误三段式（发生了什么 / 可能原因 /
   * 可以怎么做）+ 可执行恢复动作。
   * - `role="alert"` 紧急播报；错误必须包含可执行恢复或诊断出口。
   * - `actions` 至少 1 个：为空时在 DEV 下警告（渲染不补按钮）。
   * - `diagnosticText` 安全门（fail-closed）：组件内做基础密钥 / 密码模式
   *   检测，命中则拒绝渲染诊断文本原文，只显示脱敏提示；绝不把疑似密钥
   *   输出到界面。注意确认令牌（token）是正常诊断内容，不计入密钥模式。
   * - 动作为透传 `onAction(action, data)`；文案来自 props 或 terminology。
   */
  import { taskSkeletonLabels } from "../../i18n/terminology";
  import type { TaskActionItem } from "./taskTypes";

  /**
   * 诊断文本密钥模式（基础检测，fail-closed）：
   * 覆盖 `apiKey=` / `password=` / `passwd` / `secret=` / 私钥块等常见写法。
   * 有意不匹配通用 `token`（确认令牌是合法诊断内容）。
   */
  const SECRET_PATTERNS: RegExp[] = [
    /api[_-]?key\s*[:=]/i,
    /password\s*[:=]/i,
    /passwd/i,
    /secret\s*[:=]/i,
    /private[_-]?key/i,
    /bearer\s+[A-Za-z0-9]/i,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ];

  let {
    what,
    cause,
    recovery,
    actions,
    diagnosticText,
    onAction,
    ariaLabel,
  }: {
    /** 发生了什么。 */
    what: string;
    /** 可能原因（可选）。 */
    cause?: string;
    /** 可以怎么做（恢复说明，必须可执行）。 */
    recovery: string;
    /** 恢复 / 诊断动作，至少 1 个。 */
    actions: TaskActionItem[];
    /** 可选诊断文本：命中密钥模式时拒绝渲染原文（fail-closed）。 */
    diagnosticText?: string;
    /** 动作透传：`onAction(action, data)`。 */
    onAction: (action: string, data?: Record<string, unknown>) => void;
    /** 可访问名称，缺省使用 terminology 默认值。 */
    ariaLabel?: string;
  } = $props();

  /** 错误无恢复动作用于 DEV 警告：错误页不得没有出口。 */
  $effect(() => {
    if (typeof import.meta === "undefined" || !import.meta.env?.DEV) return;
    if (actions.length === 0) {
      console.warn(
        "[TaskErrorState] 错误态缺少恢复动作（actions 至少 1 个）。",
      );
    }
  });

  /** 命中任一密钥模式即拦截原文渲染（fail-closed，默认拒绝）。 */
  const diagnosticBlocked = $derived(
    diagnosticText
      ? SECRET_PATTERNS.some((pattern) => pattern.test(diagnosticText))
      : false,
  );
</script>

<div
  class="task-error-state"
  role="alert"
  aria-label={ariaLabel ?? taskSkeletonLabels.errorState}
>
  <div class="task-error-state__body">
    <p class="task-error-state__what">{what}</p>
    {#if cause}
      <p class="task-error-state__cause">{cause}</p>
    {/if}
    <p class="task-error-state__recovery">{recovery}</p>
    {#if diagnosticText && !diagnosticBlocked}
      <details class="task-error-state__diagnostic">
        <summary>查看诊断信息</summary>
        <code>{diagnosticText}</code>
      </details>
    {:else if diagnosticBlocked}
      <p class="task-error-state__blocked">
        <span class="codicon codicon-warning" aria-hidden="true"></span>
        {taskSkeletonLabels.diagnosticBlocked}
      </p>
    {/if}
    {#if actions.length > 0}
      <div class="task-error-state__actions" role="group" aria-label={recovery}>
        {#each actions as item, index (index)}
          <button
            type="button"
            class={item.kind === "primary"
              ? "button button--primary"
              : "button button--secondary"}
            onclick={() => onAction(item.action, item.data)}
          >
            {#if item.icon}
              <span class="codicon {item.icon}" aria-hidden="true"></span>
            {/if}
            {item.label}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  /* 只用 VS Code 主题变量；错误同时用文字与图标，不只靠颜色。 */
  .task-error-state {
    display: flex;
    align-items: flex-start;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    border-left-width: 4px;
    border-radius: 4px;
    background: var(--vscode-inputValidation-errorBackground);
    color: var(--vscode-editor-foreground);
    font-size: 13px;
  }
  .task-error-state__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .task-error-state__what {
    margin: 0;
    font-weight: 600;
  }
  .task-error-state__cause,
  .task-error-state__recovery {
    margin: 0;
    font-size: 12px;
  }
  .task-error-state__diagnostic {
    font-size: 12px;
  }
  .task-error-state__diagnostic code {
    display: block;
    margin-top: 4px;
    padding: 4px 6px;
    background: var(--vscode-textCodeBlock-background);
    border-radius: 3px;
    overflow-wrap: break-word;
  }
  .task-error-state__blocked {
    margin: 0;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  .task-error-state__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    margin-top: 4px;
  }
</style>
