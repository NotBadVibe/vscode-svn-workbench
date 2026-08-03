<script lang="ts">
  import type {
    RepositorySnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";

  let {
    onAction,
  }: {
    snapshot: RepositorySnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  let shelfName = $state("wip");
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
        ><span>本地搁置名称</span><input
          bind:value={shelfName}
          maxlength="64"
        /></label
      ><small>实现为私有补丁 + 精确文件还原，不冒充 SVN 原生搁置。</small
      ><button
        class="button button--primary"
        onclick={() =>
          onAction("repository/preview-advanced", {
            operation: "shelf",
            shelfName,
          })}>预览创建本地搁置</button
      >
    </article>
  </div>
</section>
