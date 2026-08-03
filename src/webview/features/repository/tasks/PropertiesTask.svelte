<script lang="ts">
  import type {
    RepositorySnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../../components/ui/ScrollArea.svelte";

  let {
    snapshot,
    onAction,
  }: {
    snapshot: RepositorySnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  let propertyName = $state("");
  let propertyValue = $state("");

  function selectProperty(name: string, value: string): void {
    propertyName = name;
    propertyValue = value;
  }
</script>

<section class="operation-card operation-card--wide repository-task-card">
  <div class="section-heading">
    <div>
      <span class="eyebrow">版本控制属性</span>
      <h2>SVN 属性</h2>
    </div>
    <span class="status-badge">{snapshot.properties.target}</span>
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
    <ScrollArea class="property-list" label="当前 SVN 属性"
      >{#if snapshot.properties.items.length === 0}<div class="mini-empty">
          当前目标没有显式属性。
        </div>{/if}{#each snapshot.properties.items as item (item.name)}<button
          class:active={propertyName === item.name}
          onclick={() => selectProperty(item.name, item.value)}
          ><strong>{item.name}</strong><small>{item.value || "（空值）"}</small
          ></button
        >{/each}</ScrollArea
    >
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
            onclick={() =>
              onAction("repository/execute-property", {
                previewToken: snapshot.properties.preview?.token,
              })}
            >{snapshot.properties.preview.remove
              ? "确认删除属性"
              : "确认设置属性"}</button
          >
        </div>{/if}
    </div>
  </div>
</section>
