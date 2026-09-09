<script lang="ts">
  import type {
    RepositorySnapshot,
    ShelfEntryView,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import { validateShelfDisplayName } from "../../../../repository/shelfIndex";

  let {
    snapshot,
    onAction,
  }: {
    snapshot: RepositorySnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  let shelfName = $state("wip");
  let isComposing = $state(false);
  let shelfQuery = $state("");
  let confirmDeleteId = $state<string | undefined>(undefined);

  const shelves: ShelfEntryView[] = $derived(snapshot.advanced.shelves ?? []);
  const existingNames = $derived(shelves.map((entry) => entry.displayName));
  // V024-R48：输入处实时提示（Host 始终复验，此处只做即时反馈）。
  const nameIssues = $derived(
    validateShelfDisplayName(shelfName, existingNames),
  );
  const filteredShelves = $derived.by(() => {
    const query = shelfQuery.trim().toLowerCase();
    if (!query) return shelves;
    return shelves.filter(
      (entry) =>
        entry.displayName.toLowerCase().includes(query) ||
        entry.projectName?.toLowerCase().includes(query) ||
        entry.createdAt.includes(query),
    );
  });

  function formatTime(value: string): string {
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return value;
    return new Intl.DateTimeFormat("zh-CN", {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(time));
  }

  function integrityLabel(entry: ShelfEntryView): string {
    if (entry.integrity === "ok") return "完整";
    if (entry.integrity === "missing-patch") return "补丁丢失";
    if (entry.integrity === "corrupt") return "补丁损坏";
    return "不可读";
  }

  function requestCreateShelf(): void {
    if (isComposing) return;
    onAction("repository/preview-advanced", { operation: "shelf", shelfName });
  }
</script>

<section class="operation-card operation-card--wide repository-task-card">
  <div class="section-heading">
    <div>
      <span class="eyebrow">补丁与本地搁置</span>
      <h2>导出、应用补丁与本地搁置</h2>
    </div>
  </div>
  <div class="advanced-tool-stack">
    <article>
      <div>
        <strong>导出或应用补丁（Patch）</strong><small
          >导出不会改变工作副本；应用前执行试运行（dry-run）和路径检查。</small
        >
      </div>
      <div class="toolbar-actions">
        <button
          class="button button--secondary"
          onclick={() => onAction("repository/export-patch")}
          >导出当前范围</button
        ><button
          class="button button--secondary"
          onclick={() => onAction("repository/select-patch")}
          >选择并预览应用</button
        >
      </div>
    </article>
    <article>
      <label class="field"
        ><span>本地搁置显示名称（支持中文）</span><input
          bind:value={shelfName}
          maxlength="64"
          aria-label="本地搁置显示名称"
          aria-describedby="shelf-name-hint"
          oncompositionstart={() => (isComposing = true)}
          oncompositionend={() => (isComposing = false)}
          onkeydown={(event) => {
            if (event.key === "Enter" && isComposing) event.preventDefault();
            if (event.key === "Enter" && !isComposing) requestCreateShelf();
          }}
        /></label
      >
      <small id="shelf-name-hint">
        {#if nameIssues.length > 0}
          {nameIssues.join(" ")}
        {:else}
          支持中文与空格（1–64
          个字符）；内部使用独立安全文件名，重启后可在清单中找到。
        {/if}
      </small>
      <small>实现为私有补丁 + 精确文件还原，不冒充 SVN 原生搁置。</small>
      <div class="toolbar-actions">
        <button
          class="button button--primary"
          disabled={nameIssues.length > 0}
          onclick={requestCreateShelf}>预览创建本地搁置</button
        >
        <button
          class="button button--secondary"
          onclick={() => onAction("repository/refresh-shelves")}
          >刷新搁置清单</button
        >
      </div>
    </article>
    <article aria-label="本地搁置清单">
      <div>
        <strong>本地搁置清单（{shelves.length} 个）</strong>
        <small
          >按仓库隔离；同名条目通过时间与项目区分。恢复成功保留搁置，删除为独立动作。</small
        >
      </div>
      {#if snapshot.advanced.shelvesError}
        <div class="notice notice--warning" role="note">
          {snapshot.advanced.shelvesError}
        </div>
      {/if}
      {#if snapshot.advanced.shelfFeedback}
        <div class="notice notice--success" role="status">
          {snapshot.advanced.shelfFeedback}
        </div>
      {/if}
      {#if shelves.length > 0}
        <label class="field"
          ><span>筛选搁置</span><input
            bind:value={shelfQuery}
            aria-label="筛选搁置"
            placeholder="按名称、项目或时间筛选"
            oncompositionstart={() => (isComposing = true)}
            oncompositionend={() => (isComposing = false)}
          /></label
        >
      {/if}
      {#if filteredShelves.length === 0}
        <p>
          {shelves.length === 0
            ? "暂无本地搁置。创建后重启仍可在此找到并预览恢复。"
            : "没有匹配的搁置。"}
        </p>
      {:else}
        <ul class="shelf-list">
          {#each filteredShelves as entry (entry.id)}
            <li>
              <div>
                <strong>{entry.displayName}</strong>
                <span
                  class="status-badge"
                  aria-label={`完整性${integrityLabel(entry)}`}
                >
                  <span class="codicon codicon-archive" aria-hidden="true"
                  ></span>{integrityLabel(entry)}
                </span>
              </div>
              <div>
                <small
                  >{formatTime(entry.createdAt)} · {entry.fileCount} 个文件 · 基线
                  {entry.baselineRevision ?? "未知"}{entry.projectName
                    ? ` · 项目 ${entry.projectName}`
                    : ""}</small
                >
              </div>
              {#if entry.integrityDetail}
                <div><small>{entry.integrityDetail}</small></div>
              {/if}
              <div class="toolbar-actions">
                <button
                  class="button button--secondary"
                  disabled={entry.integrity !== "ok"}
                  onclick={() =>
                    onAction("repository/preview-shelf-restore", {
                      shelfId: entry.id,
                    })}>预览恢复</button
                >
                <button
                  class="button button--secondary"
                  onclick={() =>
                    onAction("repository/export-shelf", { shelfId: entry.id })}
                  >导出</button
                >
                {#if confirmDeleteId === entry.id}
                  <button
                    class="button button--primary"
                    onclick={() => {
                      confirmDeleteId = undefined;
                      onAction("repository/delete-shelf", {
                        shelfId: entry.id,
                      });
                    }}>确认删除搁置“{entry.displayName}”</button
                  >
                  <button
                    class="button button--secondary"
                    onclick={() => (confirmDeleteId = undefined)}>取消</button
                  >
                {:else}
                  <button
                    class="button button--secondary"
                    onclick={() => (confirmDeleteId = entry.id)}>删除</button
                  >
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </article>
  </div>
</section>

<style>
  .shelf-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .shelf-list li {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 0.625rem;
  }
</style>
