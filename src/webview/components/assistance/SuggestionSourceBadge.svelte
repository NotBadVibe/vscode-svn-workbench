<script lang="ts">
  /*
   * v0.1.6 V016-B SuggestionSourceBadge：结果来源如实标注。
   * - 本地检查结果禁止显示 AI 字样：`local-rule` 只渲染“本地检查”。
   * - 模型建议显示模型名；降级显示完整降级原因，不简称 AI。
   * - 状态不只靠颜色：文字 + 图标 + tone 样式钩子。
   * - 只用 VS Code 主题变量；scoped 样式无全局 overflow。
   */
  import { sourceLabels } from "../../i18n/terminology";
  import type { AssistanceSourceState } from "./assistanceTypes";

  let {
    source,
    model,
    generatedAt,
    stale = false,
    fallbackReason,
  }: {
    /** 来源状态：`local-rule` / `configured-model` / `local-rule-fallback` / `unconfigured`。 */
    source: AssistanceSourceState;
    /** 模型名：仅 `configured-model` 时展示，缺省不虚构。 */
    model?: string;
    /** 生成时间（毫秒时间戳）：详情展示完整中文时间。 */
    generatedAt?: number;
    /** 是否已过期：过期只读提示，不只靠颜色。 */
    stale?: boolean;
    /** 降级原因：仅 `local-rule-fallback` 时展示完整原因。 */
    fallbackReason?: string;
  } = $props();

  /** 主文案：全部复用 terminology，不在组件内生造来源词。 */
  const mainLabel = $derived(
    source === "configured-model"
      ? model
        ? `${sourceLabels["configured-model"]}（${model}）`
        : sourceLabels["configured-model"]
      : source === "unconfigured"
        ? "未配置外部模型"
        : sourceLabels[source],
  );

  /** 中文时间：统一 `zh-CN` 24 小时制。 */
  const timeLabel = $derived(
    generatedAt !== undefined
      ? new Date(generatedAt).toLocaleString("zh-CN", { hour12: false })
      : undefined,
  );
</script>

<span
  class="source-badge source-badge--{source}"
  role="status"
  aria-label="结果来源：{mainLabel}"
>
  {#if source === "local-rule"}
    <span class="codicon codicon-check" aria-hidden="true"></span>
  {:else if source === "configured-model"}
    <span class="codicon codicon-sparkle" aria-hidden="true"></span>
  {:else if source === "local-rule-fallback"}
    <span class="codicon codicon-warning" aria-hidden="true"></span>
  {:else}
    <span class="codicon codicon-info" aria-hidden="true"></span>
  {/if}
  <span class="source-badge__label">{mainLabel}</span>
  {#if timeLabel}
    <span class="source-badge__time">{timeLabel}</span>
  {/if}
  {#if stale}
    <span class="source-badge__stale">结果已过期</span>
  {/if}
  {#if source === "local-rule-fallback" && fallbackReason}
    <span class="source-badge__reason">{fallbackReason}</span>
  {/if}
</span>

<style>
  /* 只用 VS Code 主题变量；来源同时用文字与图标，不只靠颜色。 */
  .source-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px var(--space-xs);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 3px;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-size: 12px;
    max-width: 100%;
  }
  .source-badge--configured-model {
    border-left-color: var(--vscode-textLink-foreground);
    border-left-width: 3px;
  }
  .source-badge--local-rule-fallback {
    border-left-color: var(--vscode-inputValidation-warningBorder);
    border-left-width: 3px;
  }
  .source-badge__label {
    font-weight: 600;
  }
  .source-badge__time,
  .source-badge__reason {
    color: var(--vscode-descriptionForeground);
  }
  .source-badge__stale {
    color: var(--vscode-inputValidation-warningBorder);
    font-weight: 600;
  }
</style>
