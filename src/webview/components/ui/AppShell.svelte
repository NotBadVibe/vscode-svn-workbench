<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import type { WorkbenchState } from "../../app/workbenchState.svelte";
  import ScopeBar from "../svn/ScopeBar.svelte";

  let {
    state: workbenchState,
    children,
  }: { state: WorkbenchState; children: Snippet } = $props();

  let now = $state(Date.now());
  const elapsedSeconds = $derived(
    workbenchState.progress
      ? Math.max(
          0,
          Math.floor((now - workbenchState.progress.startedAt) / 1000),
        )
      : 0,
  );

  onMount(() => {
    const timer = window.setInterval(() => (now = Date.now()), 1000);
    return () => window.clearInterval(timer);
  });
</script>

<div class="workbench-shell">
  <main class="workbench-main">
    <ScopeBar
      scope={workbenchState.scope}
      taskId={workbenchState.taskId}
      onRefresh={() => workbenchState.action("refresh")}
      onSwitchProject={() => workbenchState.action("projects/switch")}
    />
    {#if workbenchState.progress}
      <div class="progress-strip" role="status" aria-live="polite">
        <span class="loading-ring loading-ring--small" aria-hidden="true"
        ></span>
        <div class="progress-strip__content">
          <strong>{workbenchState.progress.title}</strong><span
            >阶段：{workbenchState.progress.stage ??
              workbenchState.progress.message ??
              "执行 SVN 命令"}</span
          ><span
            >范围：{workbenchState.progress.scope ??
              workbenchState.scope?.roots
                .map((root) => root.relativePath)
                .join("、") ??
              "当前范围"}</span
          ><span>已用时：{elapsedSeconds} 秒</span>
        </div>
        {#if workbenchState.progress.outputAvailable}<button
            class="button button--secondary"
            onclick={() => workbenchState.action("diagnostics/show-output")}
            >查看输出</button
          >{/if}
        {#if workbenchState.progress.cancellable}<button
            class="button button--secondary"
            onclick={() => workbenchState.action("operation/cancel")}
            >取消</button
          >{/if}
      </div>
    {/if}
    {#if workbenchState.notification}
      <div
        class={`result-strip result-strip--${workbenchState.notification.tone}`}
        role="status"
      >
        <span
          class={`codicon codicon-${workbenchState.notification.tone === "success" ? "pass-filled" : "warning"}`}
          aria-hidden="true"
        ></span><strong>{workbenchState.notification.title}</strong><span
          >{workbenchState.notification.message}</span
        >
      </div>
    {/if}
    <div class="workbench-content">
      {@render children()}
    </div>
  </main>
</div>
