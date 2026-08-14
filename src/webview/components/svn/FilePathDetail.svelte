<script lang="ts">
  import type { HostToWebviewMessage } from "@protocol/workbenchProtocol";

  /*
   * v0.0.7 路径详情（§7.1）：分别标注项目内路径、工作副本内路径、仓库
   * 内路径、SVN URL 与本地完整路径。本地完整路径的复制由 Host 完成
   * （file/copy-path），不经过 Webview 可写字段；相对路径可直接复制。
   */

  type PathDetailPayload = Extract<
    HostToWebviewMessage,
    { type: "file/path-detail-result" }
  >["payload"];

  let {
    detail,
    onCopyLocalPath,
  }: {
    detail: PathDetailPayload;
    onCopyLocalPath: () => void;
  } = $props();

  async function copyText(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // 剪贴板不可用时不阻断详情查看。
    }
  }
</script>

<div class="path-detail" role="group" aria-label="路径详情">
  {#if detail.error}
    <p class="path-detail__error" role="alert">{detail.error}</p>
  {:else if detail.detail}
    <dl class="path-detail__list">
      {#if detail.detail.projectRelativePath}
        <div class="path-detail__row">
          <dt>项目内路径</dt>
          <dd>
            <button
              class="path-detail__value"
              title="点击复制项目内路径"
              onclick={() => copyText(detail.detail?.projectRelativePath ?? "")}
              >{detail.detail.projectRelativePath}</button
            >
          </dd>
        </div>
      {/if}
      <div class="path-detail__row">
        <dt>工作副本内路径</dt>
        <dd>
          <button
            class="path-detail__value"
            title="点击复制工作副本内路径"
            onclick={() =>
              copyText(detail.detail?.workingCopyRelativePath ?? "")}
            >{detail.detail.workingCopyRelativePath}</button
          >
        </dd>
      </div>
      {#if detail.detail.repositoryRelativePath}
        <div class="path-detail__row">
          <dt>仓库内路径</dt>
          <dd>
            <button
              class="path-detail__value"
              title="点击复制仓库内路径"
              onclick={() =>
                copyText(detail.detail?.repositoryRelativePath ?? "")}
              >{detail.detail.repositoryRelativePath}</button
            >
          </dd>
        </div>
      {/if}
      {#if detail.detail.svnUrl}
        <div class="path-detail__row">
          <dt>SVN URL</dt>
          <dd>
            <button
              class="path-detail__value"
              title="点击复制 SVN URL"
              onclick={() => copyText(detail.detail?.svnUrl ?? "")}
              >{detail.detail.svnUrl}</button
            >
          </dd>
        </div>
      {/if}
      <div class="path-detail__row">
        <dt>本地完整路径</dt>
        <dd>
          <span class="path-detail__value path-detail__value--static"
            >{detail.detail.absolutePath}</span
          >
          <button
            class="icon-button icon-button--small"
            aria-label="复制本地完整路径"
            title="复制本地完整路径"
            onclick={onCopyLocalPath}
            ><span class="codicon codicon-copy" aria-hidden="true"
            ></span></button
          >
        </dd>
      </div>
    </dl>
  {/if}
</div>
