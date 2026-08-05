<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import type {
    CommitSnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import { isExplicitSubmitShortcut } from "../../i18n/keyboard";
  import { formatZhDateTime } from "../../i18n/formatters";
  import {
    commitSelectionAiSourceLabels,
    describeCommitSelectionEvaluation,
    fileStatusLabels,
    sourceLabels,
  } from "../../i18n/terminology";

  let {
    snapshot,
    onAction,
  }: {
    snapshot: CommitSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  let query = $state("");
  let message = $state("");
  const selected = new SvelteSet<string>();

  $effect(() => {
    message = snapshot.message;
    selected.clear();
    for (const relativePath of snapshot.selectedPaths) {
      selected.add(relativePath);
    }
  });

  const visibleFiles = $derived(
    snapshot.files.filter((file) =>
      file.relativePath.toLowerCase().includes(query.trim().toLowerCase()),
    ),
  );
  const selectionPrivacy = $derived(
    snapshot.selectionAi.configured
      ? snapshot.aiPrivacy.find((item) => item.scenario === "selection")
      : undefined,
  );
  const messagePrivacy = $derived(
    snapshot.aiPrivacy.find((item) => item.scenario === "message"),
  );

  function toggle(relativePath: string): void {
    if (selected.has(relativePath)) {
      selected.delete(relativePath);
    } else {
      selected.add(relativePath);
    }
    onAction("commit/update-selection", { selectedPaths: [...selected] });
  }

  function updateDraft(): void {
    onAction("commit/update-draft", { message });
  }

  function handleMessageKeydown(event: KeyboardEvent): void {
    if (!isExplicitSubmitShortcut(event)) return;
    event.preventDefault();
    onAction("commit/preview", { selectedPaths: [...selected], message });
  }
</script>

<section class="commit-layout">
  <div class="commit-files">
    <div class="feature-toolbar feature-toolbar--compact">
      <div>
        <h2>提交文件</h2>
        <p>已选择 {selected.size}/{snapshot.files.length} 个文件</p>
      </div>
      <div class="search-field search-field--compact">
        <span class="codicon codicon-search" aria-hidden="true"></span>
        <input
          bind:value={query}
          aria-label="筛选提交文件"
          placeholder="筛选文件…"
        />
      </div>
    </div>
    <div class="commit-summary">
      <span>推荐 {snapshot.summary.selected}</span>
      <span>待确认 {snapshot.summary.needsReview}</span>
      <span>排除 {snapshot.summary.excluded}</span>
      <span class:danger={snapshot.summary.blocked > 0}
        >阻止 {snapshot.summary.blocked}</span
      >
    </div>
    {#if snapshot.feedback}
      <div
        class={`commit-feedback commit-feedback--${snapshot.feedback.tone}`}
        role="status"
      >
        {snapshot.feedback.message}
      </div>
    {/if}
    <div class="commit-action-row">
      <button
        class="button button--secondary"
        onclick={() => onAction("commit/apply-local-rules")}
        ><span class="codicon codicon-checklist" aria-hidden="true"
        ></span>应用本地规则</button
      >
      {#if snapshot.selectionAi.configured}
        <button
          class="button button--secondary"
          onclick={() => onAction("commit/ai-select")}
          ><span class="codicon codicon-sparkle" aria-hidden="true"></span>获取
          AI 建议</button
        >
      {:else}
        <button
          class="button button--secondary"
          onclick={() =>
            onAction("open-module", {
              moduleId: "settings",
              taskId: "settings/ai",
            })}
          ><span class="codicon codicon-settings-gear" aria-hidden="true"
          ></span>配置 AI</button
        >
      {/if}
    </div>
    {#if selectionPrivacy}<div class="privacy-note">
        <strong>外发预览</strong><span
          >{selectionPrivacy.data}；最多 {selectionPrivacy.fileLimit} 个文件；模型
          {selectionPrivacy.model}；不含历史。</span
        >
      </div>{/if}
    <ScrollArea class="commit-file-list" role="list" label="提交候选文件">
      {#each visibleFiles as file (file.relativePath)}
        <div
          class="commit-file-row"
          class:commit-file-row--blocked={file.selection === "blocked"}
          role="listitem"
        >
          <input
            type="checkbox"
            aria-label={`选择 ${file.relativePath}`}
            checked={selected.has(file.relativePath)}
            disabled={file.selection === "blocked" ||
              file.selection === "excluded"}
            onchange={() => toggle(file.relativePath)}
          />
          <span class="codicon codicon-file" aria-hidden="true"></span>
          <span class="commit-file-text">
            <span class="commit-file-path" title={file.relativePath}
              >{file.relativePath}</span
            >
            {#if file.evaluation}<span class="commit-file-decision"
                >{describeCommitSelectionEvaluation(file.evaluation)}</span
              >{/if}
          </span>
          <span class={`status-badge status-badge--${file.status}`}
            >{fileStatusLabels[file.status]}</span
          >
          <button
            type="button"
            class="icon-button icon-button--small"
            aria-label={`查看 ${file.relativePath} 差异`}
            onclick={(event) => {
              event.preventDefault();
              onAction("open-diff", { relativePath: file.relativePath });
            }}
          >
            <span class="codicon codicon-diff" aria-hidden="true"></span>
          </button>
        </div>
      {/each}
    </ScrollArea>
  </div>

  <ScrollArea class="commit-compose" label="提交说明与提交前检查">
    <div class="compose-section">
      <div class="section-heading">
        <div>
          <span class="eyebrow">提交内容</span>
          <h2>提交说明</h2>
        </div>
        <button
          class="button button--secondary"
          onclick={() =>
            onAction("commit/generate-message", {
              selectedPaths: [...selected],
              message,
            })}
        >
          <span class="codicon codicon-sparkle" aria-hidden="true"></span>
          AI 生成说明
        </button>
      </div>
      {#if messagePrivacy}<div class="privacy-note">
          <strong>外发预览</strong><span
            >{messagePrivacy.data}；最多 {messagePrivacy.fileLimit} 个文件；模型 {messagePrivacy.model}；{messagePrivacy.historyIncluded
              ? `包含 ${messagePrivacy.historyCount ?? 0} 条已脱敏历史摘要`
              : "不含历史"}。</span
          >
        </div>{/if}
      <div class="template-row" aria-label="提交说明模板">
        {#each snapshot.templates as template (template.id)}
          <button
            title={template.body}
            onclick={() =>
              onAction("commit/apply-template", { templateId: template.id })}
            >{template.label}</button
          >
        {/each}
      </div>
      <textarea
        bind:value={message}
        onblur={updateDraft}
        oninput={() => onAction("commit/update-draft", { message })}
        onkeydown={handleMessageKeydown}
        aria-label="提交说明"
        aria-describedby="commit-message-shortcut"
        placeholder="说明改动意图、范围与影响…"
        maxlength="2000"></textarea>
      <div class="compose-meta">
        <span>{message.length}/2000 个字符</span>
        <span id="commit-message-shortcut">按 Ctrl/⌘ + Enter 生成提交预览</span>
        {#if snapshot.conventionHint}<span title={snapshot.conventionHint}
            >团队规范已加载</span
          >{/if}
      </div>
      {#if snapshot.messageIssues.length > 0}
        <div class="issue-list" role="alert">
          {#each snapshot.messageIssues as issue, issueIndex (issueIndex)}
            <div>
              <span class="codicon codicon-warning" aria-hidden="true"
              ></span>{issue}
            </div>
          {/each}
        </div>
      {/if}
      {#if snapshot.ai}
        <div class="ai-summary">
          <span class="codicon codicon-sparkle" aria-hidden="true"></span>
          <div>
            {#if snapshot.ai.failed}
              <strong>{snapshot.ai.summary}</strong>
              <small>来源：{commitSelectionAiSourceLabels.failed}</small>
              {#if snapshot.ai.fallbackReason}<p>
                  失败原因：{snapshot.ai.fallbackReason}
                </p>{/if}
              <button
                type="button"
                class="button button--secondary ai-recover-button"
                onclick={() => onAction("commit/apply-local-rules")}
                ><span class="codicon codicon-checklist" aria-hidden="true"
                ></span>应用本地规则</button
              >
            {:else}
              <strong>{snapshot.ai.summary}</strong>
              <small
                >来源：{sourceLabels[snapshot.ai.source]}{snapshot.ai.source ===
                "local-rule-fallback"
                  ? " · 模型暂时不可用"
                  : ""}{#if snapshot.ai.source === "configured-model" && snapshot.ai.binding}
                  · 模型 {snapshot.ai.binding.model ?? "已配置模型"} · {formatZhDateTime(
                    snapshot.ai.binding.generatedAt,
                  )}{/if}{#if snapshot.ai.stale}
                  · {commitSelectionAiSourceLabels.staleBadge}{/if}</small
              >
              {#if snapshot.ai.stale}<p>
                  {commitSelectionAiSourceLabels.staleHint}
                </p>{/if}
              {#if snapshot.ai.fallbackReason}<p>
                  降级原因：{snapshot.ai.fallbackReason}
                </p>{/if}
              {#each snapshot.ai.warnings as warning, warningIndex (warningIndex)}<p
                >
                  {warning}
                </p>{/each}
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <div class="compose-section compose-section--preview">
      <div class="section-heading">
        <div>
          <span class="eyebrow">执行前确认</span>
          <h2>提交前检查</h2>
        </div>
        <button
          class="button button--secondary"
          onclick={() =>
            onAction("commit/preview", {
              selectedPaths: [...selected],
              message,
            })}>重新检查</button
        >
      </div>
      {#if snapshot.preview}
        <div class="preview-facts">
          <span>{snapshot.preview.selectedPaths.length} 个文件</span>
          <span>{snapshot.preview.addPaths.length} 个文件待加入版本控制</span>
          <span>{snapshot.preview.removePaths.length} 个文件待标记删除</span>
          {#if snapshot.preview.remoteRevision}<span
              >远端 r{snapshot.preview.remoteRevision}</span
            >{/if}
        </div>
        {#if snapshot.preview.issues.length > 0}
          <div class="issue-list" role="alert">
            {#each snapshot.preview.issues as issue, issueIndex (issueIndex)}<div
              >
                <span class="codicon codicon-error" aria-hidden="true"
                ></span>{issue}
              </div>{/each}
          </div>
        {:else}
          <div class="ready-banner">
            <span class="codicon codicon-pass-filled" aria-hidden="true"
            ></span>范围、状态和远端检查已通过
          </div>
        {/if}
        <details class="command-preview">
          <summary>查看命令预览</summary>
          {#each snapshot.preview.commands as command, commandIndex (commandIndex)}<code
              >{command}</code
            >{/each}
        </details>
        <button
          class="button button--primary commit-button"
          disabled={!snapshot.preview.canExecute}
          onclick={() =>
            onAction("commit/execute", {
              previewToken: snapshot.preview?.token,
            })}
        >
          <span class="codicon codicon-cloud-upload" aria-hidden="true"></span>
          确认提交
        </button>
      {:else}
        <div class="preview-empty">
          <span class="codicon codicon-shield" aria-hidden="true"></span>
          <p>执行前将重新校验范围、文件状态、团队规范和远端更新。</p>
          <button
            class="button button--primary"
            onclick={() =>
              onAction("commit/preview", {
                selectedPaths: [...selected],
                message,
              })}>生成提交预览</button
          >
        </div>
      {/if}
    </div>
  </ScrollArea>
</section>
