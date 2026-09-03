<script lang="ts">
  import type {
    RepositorySnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../../components/ui/ScrollArea.svelte";
  import SearchInput from "../../../components/list/SearchInput.svelte";
  import ResultCount from "../../../components/list/ResultCount.svelte";
  import OperationIntentDialog from "../../../components/operation/OperationIntentDialog.svelte";
  import { naturalCompare } from "../../../../selection/selectionSort";

  /*
   * v0.0.10 跨模块列表迁移：属性列表复用共享搜索与排序；属性名/值/
   * 完整目标路径可复制。属性编辑保持单项预览确认，不提供批量删除。
   */

  let {
    snapshot,
    onAction,
  }: {
    snapshot: RepositorySnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  let propertyName = $state("");
  let propertyValue = $state("");
  let query = $state("");
  /** 名称排序：默认 A→Z；可切换 Z→A。 */
  let sortDirection = $state<"asc" | "desc">("asc");

  function selectProperty(name: string, value: string): void {
    propertyName = name;
    propertyValue = value;
  }

  const filteredProperties = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? snapshot.properties.items.filter((item) =>
          item.name.toLowerCase().includes(needle),
        )
      : snapshot.properties.items;
    return [...matched].sort((left, right) => {
      const cmp = naturalCompare(left.name, right.name);
      return sortDirection === "asc" ? cmp : -cmp;
    });
  });

  // v0.0.14 批次 D：属性修改意向单
  let propertyIntentOpen = $state(false);
  let propertyTriggerEl = $state<HTMLElement | null>(null);
  const propertyIntent = $derived.by(() => {
    const preview = snapshot.properties.preview;
    if (!preview) return undefined;
    const title = preview.remove
      ? `删除属性 ${preview.name}`
      : `修改属性 ${preview.name}（1 个路径）`;
    const summary = `${title} · 目标：${snapshot.properties.target}，执行前将重新校验`;
    // v0.1.5 V015-C1 九要素补齐：scope 即属性目标；可恢复性说明属性语义
    // （只写工作副本、不自动提交，提交前可再次修改）；revision 无权威来源，不虚构。
    return {
      token: preview.token,
      kind: "property" as const,
      title,
      summary,
      paths: [snapshot.properties.target],
      scopeText: snapshot.properties.target,
      recoverability:
        "属性变更只写入工作副本，不会自动提交；提交前可再次修改或还原。",
      createdAt: new Date().toISOString(),
      canExecute: preview.canExecute,
      issues: preview.issues,
      commands: [preview.command],
      stale: false,
    };
  });
  const propertyConfirmLabel = $derived.by(() => {
    const preview = snapshot.properties.preview;
    if (!preview) return "确认";
    return preview.remove ? "确认删除属性" : "确认设置属性";
  });
</script>

<section class="operation-card operation-card--wide repository-task-card">
  <div class="section-heading">
    <div>
      <span class="eyebrow">版本控制属性</span>
      <h2>SVN 属性</h2>
    </div>
    <div class="toolbar-actions">
      <button
        class="icon-button icon-button--small"
        aria-label="复制完整目标路径"
        title="复制完整目标路径"
        onclick={() =>
          onAction("file/copy-path", {
            relativePath: snapshot.properties.target,
          })}
        ><span class="codicon codicon-copy" aria-hidden="true"></span></button
      >
      <span class="status-badge">{snapshot.properties.target}</span>
    </div>
  </div>
  {#if snapshot.properties.feedback}<div
      class="notice notice--success"
      role="status"
    >
      {snapshot.properties.feedback}
    </div>{/if}{#if snapshot.properties.error}<div
      class="notice notice--warning"
    >
      {snapshot.properties.error}
    </div>{/if}
  <div class="property-layout">
    <div class="property-list-pane">
      <div class="property-filter-bar">
        <SearchInput
          bind:value={query}
          ariaLabel="筛选属性名"
          placeholder="属性名…"
          compact
        />
        <ResultCount count={filteredProperties.length} suffix="条属性" />
        <select
          class="sort-menu"
          aria-label="属性排序"
          value={sortDirection}
          onchange={(event) => {
            sortDirection =
              (event.currentTarget as HTMLSelectElement).value === "desc"
                ? "desc"
                : "asc";
          }}
        >
          <option value="asc">名称 A→Z</option>
          <option value="desc">名称 Z→A</option>
        </select>
      </div>
      <ScrollArea class="property-list" label="当前 SVN 属性"
        >{#if filteredProperties.length === 0}<div class="mini-empty">
            {snapshot.properties.items.length === 0
              ? "当前目标没有显式属性。"
              : "没有匹配的属性；调整属性名筛选后重试。"}
          </div>{/if}{#each filteredProperties as item (item.name)}<div
            class:property-item--active={propertyName === item.name}
            class="property-item"
          >
            <button
              type="button"
              class="property-item__select"
              onclick={() => selectProperty(item.name, item.value)}
            >
              <strong>{item.name}</strong><small
                >{item.value || "（空值）"}</small
              >
            </button>
            <span class="property-item__actions">
              <button
                type="button"
                class="icon-button icon-button--small"
                aria-label={`复制属性名 ${item.name}`}
                title="复制属性名"
                onclick={() => onAction("copy-text", { text: item.name })}
                ><span class="codicon codicon-copy" aria-hidden="true"
                ></span></button
              >
              <button
                type="button"
                class="icon-button icon-button--small"
                aria-label={`复制属性值 ${item.name}`}
                title="复制属性值"
                disabled={!item.value}
                onclick={() => onAction("copy-text", { text: item.value })}
                ><span class="codicon codicon-clippy" aria-hidden="true"
                ></span></button
              >
            </span>
          </div>{/each}</ScrollArea
      >
    </div>
    <div class="property-editor">
      <label class="field"
        ><span>属性名</span><input
          bind:value={propertyName}
          disabled={!snapshot.properties.available}
          placeholder="例如 svn:ignore"
        /></label
      ><label class="field"
        ><span>属性值</span><textarea
          bind:value={propertyValue}
          disabled={!snapshot.properties.available}
          placeholder="输入属性值…"></textarea></label
      >
      <div class="toolbar-actions">
        <button
          class="button button--secondary"
          disabled={!snapshot.properties.available || !propertyName}
          onclick={() =>
            onAction("repository/preview-property", {
              name: propertyName,
              value: propertyValue,
              remove: true,
            })}>预览删除</button
        ><button
          class="button button--primary"
          disabled={!snapshot.properties.available || !propertyName}
          onclick={() =>
            onAction("repository/preview-property", {
              name: propertyName,
              value: propertyValue,
              remove: false,
            })}>预览设置</button
        >
      </div>
      {#if snapshot.properties.preview}<div class="property-preview">
          <code>{snapshot.properties.preview.command}</code
          >{#if !snapshot.properties.preview.remove}<pre>{snapshot.properties
                .preview
                .value}</pre>{/if}{#each snapshot.properties.preview.issues as issue, issueIndex (issueIndex)}<div
              class="notice notice--error"
            >
              {issue}
            </div>{/each}<button
            class="button button--primary commit-button"
            disabled={!snapshot.properties.preview.canExecute}
            onclick={(event) => {
              propertyTriggerEl = event.currentTarget as HTMLElement;
              propertyIntentOpen = true;
            }}
            >{snapshot.properties.preview.remove
              ? "确认删除属性"
              : "确认设置属性"}</button
          >
          <OperationIntentDialog
            intent={propertyIntent}
            open={propertyIntentOpen && Boolean(propertyIntent)}
            confirmLabel={propertyConfirmLabel}
            cancelLabel="取消"
            recheckLabel="重新检查"
            triggerElement={propertyTriggerEl}
            onAction={(a, d) => onAction(a, d)}
            onConfirm={(token) => {
              propertyIntentOpen = false;
              onAction("repository/execute-property", { previewToken: token });
            }}
            onCancel={() => (propertyIntentOpen = false)}
            onRecheck={() => {
              propertyIntentOpen = false;
              const current = snapshot.properties.preview;
              if (!current) return;
              onAction("repository/preview-property", {
                name: current.name,
                value: current.value ?? propertyValue,
                remove: current.remove,
              });
            }}
          />
        </div>{/if}
    </div>
  </div>
</section>
