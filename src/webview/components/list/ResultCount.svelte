<script lang="ts">
  /*
   * v0.0.10 共享结果数量：筛选后数量经 role=status 播报。
   * 所有迁移模块使用同一“N 个结果”表达，不各自发明计数文案。
   */

  let {
    count,
    suffix = "个结果",
  }: {
    count: number;
    suffix?: string;
  } = $props();
</script>

<span class="toolbar-count" role="status">{count} {suffix}</span>
