<script lang="ts">
  import { onMount, type Snippet } from "svelte";

  let {
    label,
    class: className = "",
    role = "region",
    element = $bindable(),
    onScroll,
    children,
  }: {
    label: string;
    class?: string;
    role?: "region" | "list" | "log";
    element?: HTMLElement;
    onScroll?: (event: Event) => void;
    children: Snippet;
  } = $props();

  let canScrollUp = $state(false);
  let canScrollDown = $state(false);
  let canScrollLeft = $state(false);
  let canScrollRight = $state(false);

  function updateOverflow(): void {
    if (!element) return;
    canScrollUp = element.scrollTop > 1;
    canScrollDown =
      element.scrollTop + element.clientHeight < element.scrollHeight - 1;
    canScrollLeft = element.scrollLeft > 1;
    canScrollRight =
      element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
  }

  function handleScroll(event: Event): void {
    updateOverflow();
    onScroll?.(event);
  }

  onMount(() => {
    if (!element) return;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(updateOverflow);
    const mutationObserver = new MutationObserver(updateOverflow);
    resizeObserver?.observe(element);
    mutationObserver.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const frame = requestAnimationFrame(updateOverflow);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
    };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -- 可滚动区域需要获得键盘焦点，以支持方向键、PageUp/PageDown 和 End。 -->
<div
  bind:this={element}
  class={`scroll-region ${className}`}
  class:scroll-region--can-scroll-up={canScrollUp}
  class:scroll-region--can-scroll-down={canScrollDown}
  class:scroll-region--can-scroll-left={canScrollLeft}
  class:scroll-region--can-scroll-right={canScrollRight}
  data-scroll-region
  data-can-scroll-up={canScrollUp}
  data-can-scroll-down={canScrollDown}
  data-can-scroll-left={canScrollLeft}
  data-can-scroll-right={canScrollRight}
  {role}
  aria-label={label}
  tabindex="0"
  onscroll={handleScroll}
>
  {@render children()}
</div>
