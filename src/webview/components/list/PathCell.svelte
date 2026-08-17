<script lang="ts">
  import { fileStatusLabels } from "../../i18n/terminology";
  import {
    middleEllipsis,
    splitPathForCell,
    type FileQuerySource,
  } from "./listModel";

  /*
   * v0.0.8 PathCell：第一行文件名（保留扩展名），第二行项目内父目录
   * （中部省略）；跨项目/多仓库时显示徽标；文本可选择；读屏名称包含
   * 项目名、完整项目内路径、状态与选择状态。打开差异与路径详情都同时
   * 支持鼠标、键盘与触屏。
   * v0.0.10：输入泛化为 FileQuerySource（状态可选），WorkbenchFileView
   * 与变更集/冲突等富化条目都可复用。
   */

  let {
    file,
    selected = false,
    maxPathLength = 48,
    onOpenDiff,
    onOpenDetail,
  }: {
    file: FileQuerySource & {
      ownership?: "current" | "external" | "nested";
    };
    selected?: boolean;
    maxPathLength?: number;
    onOpenDiff: () => void;
    onOpenDetail: (trigger: HTMLButtonElement) => void;
  } = $props();

  const displayPath = $derived(file.projectRelativePath ?? file.relativePath);
  const parts = $derived(splitPathForCell(displayPath));
  const statusLabel = $derived(
    file.status ? fileStatusLabels[file.status] : undefined,
  );
  const accessibleName = $derived(
    [
      file.projectName ? `项目 ${file.projectName}` : undefined,
      displayPath,
      statusLabel ?? "状态未知",
      selected ? "已选" : "未选",
    ]
      .filter(Boolean)
      .join("，"),
  );
</script>

<span class="path-cell">
  <span class="path-cell__main">
    <button
      type="button"
      class="path-cell__name"
      title={displayPath}
      aria-label={accessibleName}
      onclick={(event) => {
        event.stopPropagation();
        onOpenDiff();
      }}>{parts.fileName}</button
    >
    {#if file.projectName}<small class="project-badge"
        ><span class="codicon codicon-project" aria-hidden="true"
        ></span>{file.projectName}</small
      >{/if}
    {#if file.ownership === "external" || file.ownership === "nested"}<small
        class={`ownership-badge ownership-badge--${file.ownership}`}
        ><span class="codicon codicon-repo" aria-hidden="true"
        ></span>{file.ownership === "external" ? "外部" : "嵌套"}</small
      >{/if}
    <button
      type="button"
      class="icon-button icon-button--small path-cell__detail"
      aria-label={`查看 ${displayPath} 路径详情`}
      title="路径详情"
      onclick={(event) => {
        event.stopPropagation();
        onOpenDetail(event.currentTarget);
      }}><span class="codicon codicon-info" aria-hidden="true"></span></button
    >
  </span>
  {#if parts.parentPath}
    <span class="path-cell__parent" title={displayPath}
      >{middleEllipsis(parts.parentPath, maxPathLength)}</span
    >
  {/if}
</span>
