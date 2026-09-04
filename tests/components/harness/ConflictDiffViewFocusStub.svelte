<script lang="ts">
  // 中文注释：V017-C T1 测试桩——替代真实 ConflictDiffView，上报固定块进度
  // （current 1/total 2），focusConflict 聚焦桩内按钮，使“后台刷新是否抢焦点
  // /用户选择是否聚焦首块”在 jsdom 可断言。不参与业务逻辑。
  let {
    onBlockProgress,
  }: {
    onBlockProgress?: (p: { current: number; total: number }) => void;
  } = $props();

  // 中文注释：lint 语境下 tests 桩无浏览器 globals，用结构类型代替 DOM 类型。
  let el = $state<{ focus: () => void } | undefined>();

  export function focusConflict(): void {
    el?.focus();
  }

  export function getBlockProgress(): { current: number; total: number } {
    return { current: 1, total: 2 };
  }

  export function getControlledResult(): string {
    return "";
  }

  $effect(() => {
    onBlockProgress?.({ current: 1, total: 2 });
  });
</script>

<button bind:this={el} type="button" data-testid="conflict-diff-focus-stub"
  >差异桩</button
>
