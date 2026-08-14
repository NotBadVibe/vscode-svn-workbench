<script lang="ts">
  import type {
    HostToWebviewMessage,
    WebviewAction,
    WorkbenchModuleSnapshot,
    WorkbenchTaskId,
  } from "@protocol/workbenchProtocol";
  let {
    snapshot,
    taskId,
    editSession,
    diffSaveResult,
    draftAck,
    targetSwitchRequest,
    pathDetail,
    onAction,
  }: {
    snapshot: WorkbenchModuleSnapshot;
    taskId: WorkbenchTaskId;
    editSession?: Extract<
      HostToWebviewMessage,
      { type: "diff/edit-opened" }
    >["payload"];
    diffSaveResult?: Extract<
      HostToWebviewMessage,
      { type: "diff/save-result" }
    >["payload"];
    draftAck?: Extract<
      HostToWebviewMessage,
      { type: "diff/draft-checkpointed" }
    >["payload"];
    targetSwitchRequest?: Extract<
      HostToWebviewMessage,
      { type: "diff/target-switch-confirm" }
    >["payload"];
    pathDetail?: Extract<
      HostToWebviewMessage,
      { type: "file/path-detail-result" }
    >["payload"];
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();
</script>

{#snippet loadingModule()}
  <section class="module-state" aria-busy="true">
    <span class="loading-ring" aria-hidden="true"></span>
    <div>
      <strong>正在加载功能模块</strong>
      <p>仅加载当前任务所需的 Svelte 代码…</p>
    </div>
  </section>
{/snippet}

{#if snapshot.kind === "changes"}
  {#await import("../features/changes/ChangesModule.svelte")}{@render loadingModule()}{:then module}{@const Feature =
      module.default}<Feature {snapshot} {onAction} {pathDetail} />{/await}
{:else if snapshot.kind === "diff"}
  {#await import("../features/diff/DiffModule.svelte")}{@render loadingModule()}{:then module}{@const Feature =
      module.default}<Feature
      {snapshot}
      {onAction}
      {editSession}
      {diffSaveResult}
      {draftAck}
      {targetSwitchRequest}
    />{/await}
{:else if snapshot.kind === "commit"}
  {#await import("../features/commit/CommitModule.svelte")}{@render loadingModule()}{:then module}{@const Feature =
      module.default}<Feature {snapshot} {onAction} {pathDetail} />{/await}
{:else if snapshot.kind === "history"}
  {#await import("../features/history/HistoryModule.svelte")}{@render loadingModule()}{:then module}{@const Feature =
      module.default}<Feature {snapshot} {onAction} />{/await}
{:else if snapshot.kind === "conflicts"}
  {#await import("../features/conflicts/ConflictsModule.svelte")}{@render loadingModule()}{:then module}{@const Feature =
      module.default}<Feature {snapshot} {onAction} />{/await}
{:else if snapshot.kind === "settings"}
  {#await import("../features/settings/SettingsModule.svelte")}{@render loadingModule()}{:then module}{@const Feature =
      module.default}<Feature {snapshot} {taskId} {onAction} />{/await}
{:else if snapshot.kind === "diagnostics"}
  {#await import("../features/diagnostics/DiagnosticsModule.svelte")}{@render loadingModule()}{:then module}{@const Feature =
      module.default}<Feature {snapshot} {taskId} {onAction} />{/await}
{:else if snapshot.kind === "repository"}
  {#await import("../features/repository/RepositoryModule.svelte")}{@render loadingModule()}{:then module}{@const Feature =
      module.default}<Feature {snapshot} {taskId} {onAction} />{/await}
{:else if snapshot.kind === "ai-review"}
  {#await import("../features/ai-review/AiReviewModule.svelte")}{@render loadingModule()}{:then module}{@const Feature =
      module.default}<Feature {snapshot} {onAction} />{/await}
{:else if snapshot.kind === "impact"}
  {#await import("../features/impact/ImpactModule.svelte")}{@render loadingModule()}{:then module}{@const Feature =
      module.default}<Feature {snapshot} {onAction} />{/await}
{:else if snapshot.kind === "changelists"}
  {#await import("../features/changelists/ChangelistsModule.svelte")}{@render loadingModule()}{:then module}{@const Feature =
      module.default}<Feature {snapshot} {onAction} />{/await}
{:else if snapshot.kind === "agent"}
  {#await import("../features/agent/AgentModule.svelte")}{@render loadingModule()}{:then module}{@const Feature =
      module.default}<Feature {snapshot} {onAction} />{/await}
{:else if snapshot.kind === "projects"}
  {#await import("../features/projects/ProjectsModule.svelte")}{@render loadingModule()}{:then module}{@const Feature =
      module.default}<Feature {snapshot} {onAction} />{/await}
{/if}
