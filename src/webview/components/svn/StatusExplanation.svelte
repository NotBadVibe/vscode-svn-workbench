<script lang="ts">
  /*
   * v0.0.18 批次 B（C-05）：状态词就地解释。
   * 键盘可达（Tab 聚焦、Enter/Space 展开、Esc 关闭并归还焦点），
   * 不只依赖悬停 tooltip；释义就地展开，不遮挡列表内容。
   */
  let {
    term,
    explanation,
  }: {
    /** 术语本身（如“存在冲突”）。 */
    term: string;
    /** 一句话解释（terminology.ts 统一维护，不在此组件拼凑）。 */
    explanation: string;
  } = $props();

  let open = $state(false);
  let triggerEl = $state<HTMLElement | null>(null);

  function toggle(): void {
    open = !open;
  }
</script>

<span class="status-explanation">
  <button
    type="button"
    class="icon-button icon-button--small status-explanation__trigger"
    aria-label={`解释术语：${term}`}
    aria-expanded={open}
    title={`${term}——${explanation}`}
    bind:this={triggerEl}
    onclick={toggle}
    onkeydown={(event) => {
      // 展开态按 Esc 关闭并归还焦点（焦点始终在触发按钮上）。
      if (event.key === "Escape" && open) {
        open = false;
        triggerEl?.focus();
      }
    }}
  >
    <span class="codicon codicon-info" aria-hidden="true"></span>
  </button>
  {#if open}
    <span class="status-explanation__note" role="note">
      <strong>{term}</strong>{explanation}
    </span>
  {/if}
</span>
