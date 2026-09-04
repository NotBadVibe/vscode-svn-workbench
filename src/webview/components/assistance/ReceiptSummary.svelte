<script lang="ts">
  /*
   * v0.1.6 V016-B ReceiptSummary：外发回执纯展示 + 事件。
   * - 只共享表达，不共享任务 token：确认事件由页面携带一次性 token，
   *   token 绝不进入组件 props（组件内无 token 字段，不渲染 token 文本）。
   * - 纯展示：模型、数据类型、范围、预算、是否含历史、文件清单（字符数/截断）、
   *   附加说明；动作为透传 `onConfirm` / `onDiscard`。
   * - 只用 VS Code 主题变量；scoped 样式无全局 overflow。
   */
  import type { AssistanceReceiptFileView } from "./assistanceTypes";

  let {
    model,
    dataTypes,
    scopeText,
    budgetText,
    historyIncluded,
    receiptNote,
    files,
    onConfirm,
    onDiscard,
    confirmLabel,
    cancelLabel = "放弃",
  }: {
    /** 模型名（未配置时缺省，组件不虚构）。 */
    model?: string;
    /** 数据类型说明（如“仅文件信息”“含差异”）。 */
    dataTypes: string;
    /** 文件范围说明。 */
    scopeText: string;
    /** 字符/文件预算说明。 */
    budgetText: string;
    /** 是否包含历史。 */
    historyIncluded: boolean;
    /** 附加说明（如不会发送项、保留策略提示）。 */
    receiptNote?: string;
    /** 包含/排除文件清单（可选）。 */
    files?: AssistanceReceiptFileView[];
    /** 确认回调：由页面携带一次性 token 调用 Host。 */
    onConfirm: () => void;
    /** 放弃回调：由页面放弃回执，不外发。 */
    onDiscard: () => void;
    /** 确认按钮文案（如“开始模型生成”）。 */
    confirmLabel: string;
    /** 放弃按钮文案，缺省“放弃”。 */
    cancelLabel?: string;
  } = $props();
</script>

<div class="receipt-summary" role="region" aria-label="外发回执确认">
  <p class="receipt-summary__title">
    <span class="codicon codicon-shield" aria-hidden="true"></span>
    外发前请确认以下内容
  </p>
  <dl class="receipt-summary__list">
    {#if model}
      <div class="receipt-summary__row">
        <dt>模型</dt>
        <dd>{model}</dd>
      </div>
    {/if}
    <div class="receipt-summary__row">
      <dt>数据类型</dt>
      <dd>{dataTypes}</dd>
    </div>
    <div class="receipt-summary__row">
      <dt>文件范围</dt>
      <dd>{scopeText}</dd>
    </div>
    <div class="receipt-summary__row">
      <dt>字符预算</dt>
      <dd>{budgetText}</dd>
    </div>
    <div class="receipt-summary__row">
      <dt>是否包含历史</dt>
      <dd>{historyIncluded ? "包含历史" : "不包含历史"}</dd>
    </div>
  </dl>
  {#if receiptNote}
    <p class="receipt-summary__note">{receiptNote}</p>
  {/if}
  {#if files && files.length > 0}
    <details class="receipt-summary__files">
      <summary>查看文件清单（{files.length}）</summary>
      <ul>
        {#each files as file, index (index)}
          <li>
            <span class="receipt-summary__name">{file.name}</span>
            <span class="receipt-summary__meta">
              {file.characters} 字符{file.truncated ? "（已截断）" : ""}
            </span>
          </li>
        {/each}
      </ul>
    </details>
  {/if}
  <div class="receipt-summary__actions" role="group" aria-label="回执操作">
    <button type="button" class="button button--secondary" onclick={onDiscard}>
      {cancelLabel}
    </button>
    <button type="button" class="button button--primary" onclick={onConfirm}>
      {confirmLabel}
    </button>
  </div>
</div>

<style>
  /* 只用 VS Code 主题变量；回执信息用文字表达，不只靠颜色。 */
  .receipt-summary {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: var(--space-sm);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-size: 13px;
  }
  .receipt-summary__title {
    margin: 0;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .receipt-summary__list {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .receipt-summary__row {
    display: flex;
    gap: var(--space-xs);
    font-size: 12px;
  }
  .receipt-summary__row dt {
    flex-shrink: 0;
    min-width: 5em;
    color: var(--vscode-descriptionForeground);
  }
  .receipt-summary__row dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: break-word;
  }
  .receipt-summary__note {
    margin: 0;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  .receipt-summary__files {
    font-size: 12px;
  }
  .receipt-summary__files ul {
    margin: 4px 0 0;
    padding-left: var(--space-md);
  }
  .receipt-summary__name {
    overflow-wrap: break-word;
  }
  .receipt-summary__meta {
    color: var(--vscode-descriptionForeground);
    margin-left: 6px;
  }
  .receipt-summary__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-xs);
    padding-top: 4px;
  }
</style>
