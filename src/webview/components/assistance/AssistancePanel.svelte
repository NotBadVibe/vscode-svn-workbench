<script lang="ts">
  /*
   * v0.1.6 V016-B AssistancePanel：一致按需帮助容器。
   * - 默认折叠：只露出一句用途 + 「需要帮助」入口，不挤压主任务。
   * - 组件只表达状态与事件：token 生成/绑定/消费、scope 校验、stale 判定、
   *   模型调用、采用复验全部留在领域模块/Host。
   * - 本地动作直接透传；模型动作点击后才展示外发说明（按 `kind` 区分）。
   * - `stale` 时采用类动作（`adopt`）禁用 + 中文提示，只能查看不能采用。
   * - 折叠不清理任何 props：结果/草稿由页面持有，组件不丢不改。
   * - 键盘展开、折叠后焦点返回触发按钮、IME 候选 Enter 不触发、error 含重试/放弃。
   * - 只用 VS Code 主题变量；scoped 样式无全局 overflow。
   */
  import type { Snippet } from "svelte";
  import { isImeComposing } from "../../i18n/keyboard";
  import { assistanceLabels } from "../../i18n/terminology";
  import ReceiptSummary from "./ReceiptSummary.svelte";
  import SuggestionSourceBadge from "./SuggestionSourceBadge.svelte";
  import type {
    AssistanceActionItem,
    AssistanceReceiptView,
    AssistanceSourceState,
  } from "./assistanceTypes";

  let {
    title,
    summary,
    sourceState,
    configured,
    expanded,
    localActions = [],
    modelActions = [],
    receipt,
    progress,
    result,
    model,
    stale = false,
    error,
    onExpand,
    onCollapse,
    onRetry,
    onDiscard,
    children,
  }: {
    /** 面板标题（如“提交说明帮助”）。 */
    title: string;
    /** 一句用途：折叠态展示，不挤压主任务。 */
    summary?: string;
    /** 结果来源状态：如实标注，本地不标 AI。 */
    sourceState: AssistanceSourceState;
    /** 是否已配置外部模型：未配置时如实提示，本地路径仍可用。 */
    configured: boolean;
    /** 展开态由页面持有，组件不自建第二状态机。 */
    expanded: boolean;
    /** 本地动作：点击直接透传，不弹外发回执。 */
    localActions?: AssistanceActionItem[];
    /** 模型动作：点击后先展示外发说明，再由页面走回执流程。 */
    modelActions?: AssistanceActionItem[];
    /** 外发回执展示数据（不含 token）；到达后在展开区展示。 */
    receipt?: AssistanceReceiptView;
    /** 进行中说明（`role=status` 播报）。 */
    progress?: string;
    /** 结果文本：折叠不丢，由页面持有。 */
    result?: string;
    /** 结果来源模型名：仅 `configured-model` 时展示，缺省不虚构。 */
    model?: string;
    /** 已过期：采用类动作禁用，只能查看。 */
    stale?: boolean;
    /** 错误文本：`role=alert` + 重试/放弃出口。 */
    error?: string;
    /** 展开事件。 */
    onExpand: () => void;
    /** 折叠事件。 */
    onCollapse: () => void;
    /** 错误重试事件（可选）。 */
    onRetry?: () => void;
    /** 错误/结果放弃事件（可选）。 */
    onDiscard?: () => void;
    /** 领域结果富内容插槽（与 `result` 文本二选一或并存）。 */
    children?: Snippet;
  } = $props();

  /** 触发按钮：折叠后焦点返回此处。 */
  let triggerEl = $state<HTMLButtonElement | null>(null);
  /** 中文 IME 候选阶段标记（`oncompositionstart/end` 跟踪）。 */
  let isComposing = $state(false);
  /** 模型外发说明可见性：仅模型动作点击后置 true，本地动作不触发。 */
  let modelExplainVisible = $state(false);
  /** 被点击的模型动作标签：外发说明中点名，不虚构回执内容。 */
  let pendingModelLabel = $state<string | undefined>(undefined);

  /** 采用类动作在 `stale` 时强制禁用（旧结果只能查看）。 */
  function isAdoptDisabled(item: AssistanceActionItem): boolean {
    return stale === true && item.adopt === true ? true : false;
  }

  function adoptDisabledReason(item: AssistanceActionItem): string | undefined {
    if (isAdoptDisabled(item)) return assistanceLabels.staleAdoptHint;
    return item.disabledReason;
  }

  /** 本地动作：直接透传，不展示外发说明。 */
  function handleLocalSelect(item: AssistanceActionItem): void {
    if (isComposing) return;
    if (item.disabled) return;
    if (isAdoptDisabled(item)) return;
    item.onSelect();
  }

  /** 模型动作：先展示外发说明，再透传页面走回执流程。 */
  function handleModelSelect(item: AssistanceActionItem): void {
    if (isComposing) return;
    if (item.disabled) return;
    if (isAdoptDisabled(item)) return;
    pendingModelLabel = item.label;
    modelExplainVisible = true;
    item.onSelect();
  }

  /** 触发按钮键盘守卫：IME 候选阶段 Enter 不展开/折叠。 */
  function handleTriggerKeydown(event: KeyboardEvent): void {
    if (isComposing || isImeComposing(event)) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
  }

  /** 动作按钮键盘守卫：IME 候选阶段 Enter 不触发。 */
  function guardActionKeydown(event: KeyboardEvent): void {
    if (isComposing || isImeComposing(event)) {
      if (event.key === "Enter") event.preventDefault();
    }
  }

  /** 折叠并把焦点返回触发按钮。 */
  function handleCollapse(): void {
    onCollapse();
    queueMicrotask(() => triggerEl?.focus());
  }
</script>

<div
  class="assistance-panel"
  role="region"
  aria-label={title}
  oncompositionstart={() => (isComposing = true)}
  oncompositionend={() => (isComposing = false)}
>
  <div class="assistance-panel__header">
    <div class="assistance-panel__titles">
      <span class="assistance-panel__title">{title}</span>
      {#if summary && !expanded}
        <span class="assistance-panel__summary">{summary}</span>
      {/if}
    </div>
    <button
      type="button"
      class="button button--secondary"
      bind:this={triggerEl}
      aria-expanded={expanded}
      aria-controls="assistance-panel-body"
      onkeydown={handleTriggerKeydown}
      onclick={() => {
        if (isComposing) return;
        if (expanded) handleCollapse();
        else onExpand();
      }}
    >
      {expanded ? assistanceLabels.collapse : assistanceLabels.needHelp}
    </button>
  </div>

  {#if expanded}
    <div class="assistance-panel__body" id="assistance-panel-body">
      {#if summary}
        <p class="assistance-panel__purpose">{summary}</p>
      {/if}
      <SuggestionSourceBadge source={sourceState} {model} {stale} />
      {#if !configured}
        <p class="notice" role="note">
          <span class="codicon codicon-info" aria-hidden="true"></span>
          {assistanceLabels.unconfiguredHint}
        </p>
      {/if}

      {#if localActions.length > 0}
        <div
          class="assistance-panel__group"
          role="group"
          aria-label={assistanceLabels.localGroup}
        >
          <span class="assistance-panel__group-title">
            {assistanceLabels.localGroup}
          </span>
          {#each localActions as item, index (index)}
            <button
              type="button"
              class="button button--secondary"
              disabled={item.disabled || isAdoptDisabled(item)}
              title={adoptDisabledReason(item)}
              aria-disabled={item.disabled || isAdoptDisabled(item)}
              onkeydown={guardActionKeydown}
              onclick={() => handleLocalSelect(item)}
            >
              {#if item.icon}
                <span class="codicon {item.icon}" aria-hidden="true"></span>
              {/if}
              {item.label}
            </button>
            {#if item.hint}
              <span class="assistance-panel__hint">{item.hint}</span>
            {/if}
          {/each}
        </div>
      {/if}

      {#if modelActions.length > 0}
        <div
          class="assistance-panel__group"
          role="group"
          aria-label={assistanceLabels.modelGroup}
        >
          <span class="assistance-panel__group-title">
            {assistanceLabels.modelGroup}
          </span>
          {#each modelActions as item, index (index)}
            <button
              type="button"
              class="button button--secondary"
              disabled={item.disabled || isAdoptDisabled(item)}
              title={adoptDisabledReason(item)}
              aria-disabled={item.disabled || isAdoptDisabled(item)}
              onkeydown={guardActionKeydown}
              onclick={() => handleModelSelect(item)}
            >
              {#if item.icon}
                <span class="codicon {item.icon}" aria-hidden="true"></span>
              {/if}
              {item.label}
            </button>
            {#if item.hint}
              <span class="assistance-panel__hint">{item.hint}</span>
            {/if}
          {/each}
        </div>
      {/if}

      {#if modelExplainVisible && pendingModelLabel}
        <p class="notice" role="note">
          <span class="codicon codicon-info" aria-hidden="true"></span>
          {assistanceLabels.modelExplainPrefix}{pendingModelLabel}{assistanceLabels.modelExplainSuffix}
        </p>
      {/if}

      {#if stale}
        <p class="notice notice--warning" role="alert">
          <span class="codicon codicon-warning" aria-hidden="true"></span>
          {assistanceLabels.staleAdoptHint}
        </p>
      {/if}

      {#if receipt}
        <ReceiptSummary
          model={receipt.model}
          dataTypes={receipt.dataTypes}
          scopeText={receipt.scopeText}
          budgetText={receipt.budgetText}
          historyIncluded={receipt.historyIncluded}
          receiptNote={receipt.receiptNote}
          files={receipt.files}
          onConfirm={receipt.onConfirm}
          onDiscard={receipt.onDiscard}
          confirmLabel={receipt.confirmLabel}
          cancelLabel={receipt.cancelLabel}
        />
      {/if}

      {#if progress}
        <p class="assistance-panel__progress" role="status">{progress}</p>
      {/if}

      {#if result}
        <div class="assistance-panel__result" role="status">
          {result}
        </div>
      {/if}
      {#if children}
        <div class="assistance-panel__result">
          {@render children()}
        </div>
      {/if}

      {#if error}
        <div class="assistance-panel__error" role="alert">
          <p class="assistance-panel__error-text">{error}</p>
          {#if onRetry || onDiscard}
            <div
              class="assistance-panel__error-actions"
              role="group"
              aria-label={assistanceLabels.errorActions}
            >
              {#if onRetry}
                <button
                  type="button"
                  class="button button--primary"
                  onkeydown={guardActionKeydown}
                  onclick={() => {
                    if (!isComposing) onRetry?.();
                  }}
                >
                  {assistanceLabels.retry}
                </button>
              {/if}
              {#if onDiscard}
                <button
                  type="button"
                  class="button button--secondary"
                  onkeydown={guardActionKeydown}
                  onclick={() => {
                    if (!isComposing) onDiscard?.();
                  }}
                >
                  {assistanceLabels.discard}
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* 只用 VS Code 主题变量；面板为行内区块，不声明页面级滚动。 */
  .assistance-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-size: 13px;
  }
  .assistance-panel__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .assistance-panel__titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .assistance-panel__title {
    font-weight: 600;
  }
  .assistance-panel__summary,
  .assistance-panel__purpose {
    margin: 0;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  .assistance-panel__body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .assistance-panel__group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .assistance-panel__group-title {
    width: 100%;
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
  }
  .assistance-panel__hint {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  .assistance-panel__progress {
    margin: 0;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  .assistance-panel__result {
    padding: 8px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    font-size: 12px;
    overflow-wrap: break-word;
  }
  .assistance-panel__error {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    border-radius: 4px;
    background: var(--vscode-inputValidation-errorBackground);
  }
  .assistance-panel__error-text {
    margin: 0;
    font-size: 12px;
  }
  .assistance-panel__error-actions {
    display: flex;
    gap: 8px;
  }
</style>
