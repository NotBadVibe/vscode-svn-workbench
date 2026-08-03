<script lang="ts">
  import type {
    ChangelistsSnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import { fileStatusLabels, sourceLabels } from "../../i18n/terminology";
  let {
    snapshot,
    onAction,
  }: {
    snapshot: ChangelistsSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();
  let name = $state("");
  let paths = $state<string[]>([]);

  function useSuggestion(id: string): void {
    const suggestion = snapshot.suggestions.find((item) => item.id === id);
    if (!suggestion) return;
    name = sanitizeName(suggestion.title);
    paths = [...suggestion.paths];
  }

  function sanitizeName(value: string): string {
    return (
      value
        .replace(/^拆分\s*\d+\s*[:：]\s*/, "")
        .replace(/\s+/g, "-")
        .slice(0, 60) || "workbench-change"
    );
  }
</script>

<section class="changelist-page">
  <header class="page-heading page-heading--actions">
    <div>
      <span class="eyebrow">SVN 变更集</span>
      <h1>变更集与智能拆分</h1>
      <p>AI 只生成候选分组；应用前仍由扩展主机校验范围与最新工作副本状态。</p>
    </div>
    <button
      class="button button--primary"
      onclick={() => onAction("changelist/suggest")}
      ><span class="codicon codicon-sparkle" aria-hidden="true"
      ></span>生成拆分建议</button
    >
  </header>
  {#if snapshot.feedback}<div class="notice notice--success" role="status">
      {snapshot.feedback}
    </div>{/if}
  <div class="privacy-note">
    <strong>外发预览</strong><span
      >{snapshot.aiPrivacy.data}；最多 {snapshot.aiPrivacy.fileLimit} 个文件；模型
      {snapshot.aiPrivacy.model}；不含历史。点击“生成拆分建议”才会发送。</span
    >
  </div>
  {#if snapshot.suggestions.length > 0}<div class="ai-source">
      建议来源：{sourceLabels[snapshot.source]}{snapshot.source ===
      "local-rule-fallback"
        ? " · 模型暂时不可用"
        : ""}
    </div>{/if}
  {#if snapshot.fallbackReason}<div class="notice notice--warning">
      降级原因：{snapshot.fallbackReason}
    </div>{/if}
  {#each snapshot.warnings as warning, warningIndex (warningIndex)}<div
      class="notice notice--warning"
    >
      {warning}
    </div>{/each}

  <div class="changelist-layout">
    <ScrollArea class="changelist-column" label="现有 SVN 变更集">
      <div class="section-heading">
        <div>
          <span class="eyebrow">当前分组</span>
          <h2>现有变更集</h2>
        </div>
        <span class="status-badge">{snapshot.groups.length}</span>
      </div>
      {#if snapshot.groups.length === 0}<div class="mini-empty">
          还没有 SVN 变更集。
        </div>{/if}
      {#each snapshot.groups as group (group.name)}
        <article class="changelist-group">
          <div>
            <span class="codicon codicon-list-tree" aria-hidden="true"
            ></span><strong>{group.name}</strong><span
              >{group.paths.length}</span
            >
          </div>
          {#each group.paths as item, pathIndex (`${group.name}:${pathIndex}`)}<button
              onclick={() => onAction("open-diff", { relativePath: item })}
              >{item}</button
            >{/each}<button
            class="text-action text-action--danger"
            onclick={() =>
              onAction("changelist/preview-apply", {
                remove: true,
                paths: group.paths,
              })}>预览移出全部文件</button
          >
        </article>
      {/each}
      <div class="unassigned-heading">
        <strong>未分组</strong><span>{snapshot.unassigned.length}</span>
      </div>
      <ScrollArea class="compact-file-list" label="未分组文件"
        >{#each snapshot.unassigned as item (item.relativePath)}<button
            onclick={() =>
              onAction("open-diff", { relativePath: item.relativePath })}
            ><span>{item.relativePath}</span><span
              class={`status-badge status-badge--${item.status}`}
              >{fileStatusLabels[item.status]}</span
            ></button
          >{/each}</ScrollArea
      >
    </ScrollArea>

    <ScrollArea
      class="changelist-column changelist-column--suggestions"
      label="AI 拆分候选"
    >
      <div class="section-heading">
        <div>
          <span class="eyebrow">AI 智能拆分</span>
          <h2>拆分候选</h2>
        </div>
      </div>
      {#if snapshot.suggestions.length === 0}<div class="preview-empty">
          <span class="codicon codicon-sparkle" aria-hidden="true"></span>
          <p>按模块与文件类型生成可调整的本地建议。</p>
        </div>{/if}
      {#each snapshot.suggestions as suggestion (suggestion.id)}
        <article class="split-card">
          <div class="split-card-heading">
            <strong>{suggestion.title}</strong><span
              >{suggestion.paths.length} 个文件</span
            >
          </div>
          <p>{suggestion.summary}</p>
          <small>{suggestion.reason}</small>{#if suggestion.risks.length}<ul>
              {#each suggestion.risks as risk, riskIndex (`${suggestion.id}:${riskIndex}`)}<li
                >
                  {risk}
                </li>{/each}
            </ul>{/if}<button
            class="button button--secondary"
            onclick={() => useSuggestion(suggestion.id)}>套用并调整</button
          >
        </article>
      {/each}
    </ScrollArea>

    <ScrollArea
      class="changelist-column changelist-editor"
      label="应用 SVN 变更集"
    >
      <div class="section-heading">
        <div>
          <span class="eyebrow">应用分组</span>
          <h2>应用到 SVN</h2>
        </div>
      </div>
      <label class="field"
        ><span>变更集名称</span><input
          bind:value={name}
          placeholder="例如 workbench-ui"
        /></label
      >
      <div class="selected-paths">
        <strong>将分组的文件（{paths.length}）</strong
        >{#each paths as item (item)}<div>
            <span>{item}</span><button
              aria-label={`移除 ${item}`}
              onclick={() => (paths = paths.filter((path) => path !== item))}
              ><span class="codicon codicon-close" aria-hidden="true"
              ></span></button
            >
          </div>{/each}
      </div>
      <button
        class="button button--primary commit-button"
        disabled={!name || paths.length === 0}
        onclick={() =>
          onAction("changelist/preview-apply", { name, paths, remove: false })}
        >生成应用预览</button
      >
      {#if snapshot.preview}
        <div class="changelist-preview">
          <code>{snapshot.preview.command}</code>
          {#each snapshot.preview.issues as issue, issueIndex (issueIndex)}<div
              class="notice notice--error"
            >
              {issue}
            </div>{/each}
          <button
            class="button button--primary commit-button"
            disabled={!snapshot.preview.canExecute}
            onclick={() =>
              onAction("changelist/execute-apply", {
                previewToken: snapshot.preview?.token,
              })}
            >{snapshot.preview.remove
              ? "确认移出变更集"
              : "确认应用变更集"}</button
          >
        </div>
      {/if}
    </ScrollArea>
  </div>
</section>
