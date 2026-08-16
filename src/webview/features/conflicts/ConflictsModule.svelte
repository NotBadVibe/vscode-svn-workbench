<script lang="ts">
  import { EditorState } from "@codemirror/state";
  import { EditorView, lineNumbers } from "@codemirror/view";
  import { untrack } from "svelte";
  import type {
    ConflictSnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import {
    applyTextConflictResolution,
    parseTextConflictBlocks,
  } from "../../../conflict/conflictMerge";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import { confidenceLabels, sourceLabels } from "../../i18n/terminology";

  let {
    snapshot,
    onAction,
  }: {
    snapshot: ConflictSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  let activePane = $state<"mine" | "theirs" | "base" | "working">("working");
  /** v0.0.9：模型未配置时按钮不标“AI”，如实指向本地建议（AI09-TRUTH-01）。 */
  const conflictAdviceConfigured = $derived(
    snapshot.aiPrivacy?.model !== undefined &&
      !snapshot.aiPrivacy.model.includes("未配置"),
  );
  let editorHost = $state<HTMLDivElement>();
  let editorView = $state<EditorView>();
  let editorToken = $state("");
  let mergeDraft = $state("");
  let savedWorking = $state("");
  const content = $derived(snapshot.selected?.contents[activePane]);
  const conflictBlocks = $derived(parseTextConflictBlocks(mergeDraft));
  const workingDirty = $derived(mergeDraft !== savedWorking);
  const recommendationLabels = {
    acceptWorking: "保留当前工作副本内容",
    acceptMine: "采用本地版本",
    acceptTheirs: "采用远端版本",
    manualMerge: "建议人工合并",
    noSafeSuggestion: "没有安全建议",
  };
  const paneLabels = {
    working: "工作副本",
    mine: "我的修改",
    theirs: "对方修改",
    base: "修改前版本",
  } as const;
  const conflictTypeLabels: Record<string, string> = {
    text: "文本冲突",
    tree: "树冲突",
    property: "属性冲突",
    unknown: "未知类型",
  };
  const conflictOperationLabels: Record<string, string> = {
    update: "更新产生",
    merge: "合并产生",
    switch: "切换产生",
    unknown: "来源未知",
  };

  $effect(() => {
    const token = snapshot.selected?.mergeEditor.token ?? "";
    if (token !== editorToken) {
      editorToken = token;
      mergeDraft = snapshot.selected?.contents.working?.content ?? "";
      savedWorking = mergeDraft;
    }
  });

  $effect(() => {
    const parent = editorHost;
    const token = editorToken;
    const editable = snapshot.selected?.mergeEditor.editable ?? false;
    if (!parent || !token || activePane !== "working") return;
    const view = new EditorView({
      state: EditorState.create({
        doc: untrack(() => mergeDraft),
        extensions: [
          lineNumbers(),
          EditorState.readOnly.of(!editable),
          EditorView.editable.of(editable),
          EditorView.contentAttributes.of({
            "aria-label": `${snapshot.selected?.relativePath ?? ""} 可编辑工作副本合并结果`,
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) mergeDraft = update.state.doc.toString();
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              color: "var(--vscode-editor-foreground)",
              backgroundColor: "var(--vscode-editor-background)",
              fontSize: "var(--vscode-editor-font-size, 12px)",
            },
            ".cm-content": {
              fontFamily: "var(--vscode-editor-font-family, monospace)",
              caretColor: "var(--vscode-editorCursor-foreground)",
            },
            ".cm-gutters": {
              color: "var(--vscode-editorLineNumber-foreground)",
              backgroundColor:
                "var(--vscode-editorGutter-background, var(--vscode-editor-background))",
              border: "none",
            },
            ".cm-activeLine": {
              backgroundColor: "var(--vscode-editor-lineHighlightBackground)",
            },
          }),
        ],
      }),
      parent,
    });
    editorView = view;
    return () => {
      if (editorView === view) editorView = undefined;
      view.destroy();
    };
  });

  function applyBlock(
    index: number,
    resolution: "mine" | "theirs" | "both",
  ): void {
    const next = applyTextConflictResolution(mergeDraft, index, resolution);
    mergeDraft = next;
    if (editorView)
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: next },
      });
  }
</script>

<section class="conflict-layout">
  <aside class="conflict-list-pane">
    <div class="feature-toolbar feature-toolbar--compact">
      <div>
        <h2>待处理冲突</h2>
        <p>{snapshot.conflicts.length} 个文件</p>
      </div>
      <span class="status-badge status-badge--conflicted">阻断提交</span>
    </div>
    {#if snapshot.conflicts.length === 0}
      <div class="empty-state">
        <span class="codicon codicon-pass-filled"></span>
        <div>
          <strong>没有冲突</strong>
          <p>当前范围可以继续提交。</p>
        </div>
      </div>
    {:else}
      <ScrollArea class="conflict-list" role="list" label="冲突文件">
        {#each snapshot.conflicts as conflict (conflict.relativePath)}
          <div role="listitem">
            <button
              class:active={snapshot.selected?.relativePath ===
                conflict.relativePath}
              class="conflict-row"
              onclick={() =>
                onAction("conflict/select", {
                  relativePath: conflict.relativePath,
                })}
            >
              <span class="codicon codicon-warning" aria-hidden="true"></span>
              <span
                ><strong>{conflict.relativePath}</strong><small
                  >{conflictTypeLabels[conflict.type ?? "unknown"] ??
                    conflict.type} · {conflictOperationLabels[
                    conflict.operation ?? "unknown"
                  ] ?? conflict.operation}</small
                ></span
              >
              <span class="codicon codicon-chevron-right" aria-hidden="true"
              ></span>
            </button>
          </div>
        {/each}
      </ScrollArea>
    {/if}
  </aside>

  <ScrollArea class="conflict-workspace" label="冲突处理工作区">
    {#if snapshot.selected}
      <div class="conflict-header">
        <div class="file-title">
          <span class="codicon codicon-merge"></span>
          <div>
            <strong>{snapshot.selected.relativePath}</strong><span
              >r{snapshot.selected.sourceLeftRevision ?? "?"} ↔ r{snapshot
                .selected.sourceRightRevision ?? "?"}</span
            >
          </div>
        </div>
        <div class="toolbar-actions">
          <button
            class="button button--secondary"
            onclick={() =>
              onAction("conflict/advise", {
                relativePath: snapshot.selected?.relativePath,
              })}
            ><span class="codicon codicon-sparkle"
            ></span>{conflictAdviceConfigured ? "AI 分析" : "本地建议"}</button
          >
          <button
            class="button button--secondary"
            onclick={() =>
              onAction("open-file", {
                relativePath: snapshot.selected?.relativePath,
              })}>打开工作副本文件</button
          >
        </div>
      </div>
      <div class="conflict-tabs" role="tablist" aria-label="冲突版本">
        {#each ["working", "mine", "theirs", "base"] as pane (pane)}
          <button
            role="tab"
            aria-selected={activePane === pane}
            class:active={activePane === pane}
            onclick={() => (activePane = pane as typeof activePane)}
            >{paneLabels[pane as keyof typeof paneLabels]}</button
          >
        {/each}
      </div>
      {#if activePane === "working"}
        <div class="merge-block-toolbar">
          <div>
            <strong>块级合并</strong><span
              >{conflictBlocks.length > 0
                ? `仍有 ${conflictBlocks.length} 个冲突块`
                : "未检测到冲突标记"}</span
            >
          </div>
          {#if conflictBlocks.length > 0}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -- 冲突块列表需要获得键盘焦点以便滚动。 -->
            <div
              class="merge-block-list scroll-region"
              role="region"
              aria-label="冲突块操作"
              tabindex="0"
              data-scroll-region
            >
              {#each conflictBlocks as block, index (block.start)}
                <article>
                  <span>块 {index + 1}</span><small
                    >{block.mine.split(/\r?\n/).filter(Boolean).length} 行本地 / {block.theirs
                      .split(/\r?\n/)
                      .filter(Boolean).length} 行对方</small
                  >
                  <div>
                    <button
                      class="button button--secondary"
                      onclick={() => applyBlock(index, "mine")}
                      >采用我的修改</button
                    ><button
                      class="button button--secondary"
                      onclick={() => applyBlock(index, "theirs")}
                      >采用对方修改</button
                    ><button
                      class="button button--secondary"
                      onclick={() => applyBlock(index, "both")}>保留两者</button
                    >
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </div>
        {#if snapshot.selected.mergeEditor.feedback}<div
            class="notice notice--success"
            role="status"
          >
            {snapshot.selected.mergeEditor.feedback}
          </div>{/if}
        {#each snapshot.selected.mergeEditor.issues as issue, issueIndex (issueIndex)}<div
            class="notice notice--warning"
          >
            {issue}
          </div>{/each}
        <div
          class="conflict-editor conflict-editor--editable"
          role="region"
          aria-label="可编辑工作副本合并区域"
        >
          <div class="conflict-codemirror-host" bind:this={editorHost}></div>
        </div>
        <div class="merge-save-bar">
          <span
            >{workingDirty
              ? "有尚未保存的合并修改"
              : "工作副本与已保存内容一致"}</span
          ><button
            class="button button--primary"
            disabled={!snapshot.selected.mergeEditor.editable || !workingDirty}
            onclick={() =>
              onAction("conflict/save-working", {
                editToken: snapshot.selected?.mergeEditor.token,
                content: mergeDraft,
              })}>保存工作副本合并结果</button
          >
        </div>
      {:else}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -- 冲突正文需要获得键盘焦点以便滚动。 -->
        <div
          class="conflict-editor scroll-region"
          role="region"
          aria-label={`${paneLabels[activePane]}内容`}
          tabindex="0"
          data-scroll-region
        >
          {#if content?.readError}
            <div class="module-state module-state--error">
              <span class="codicon codicon-error"></span>
              <div>
                <strong>读取失败</strong>
                <p>{content.readError}</p>
              </div>
            </div>
          {:else}
            <pre><code>{content?.content ?? "（没有可用内容）"}</code></pre>
            {#if content?.truncated}<div class="notice notice--warning">
                内容已截断，仅用于辅助判断。
              </div>{/if}
          {/if}
        </div>
      {/if}

      <div class="conflict-bottom">
        <section class="conflict-advice">
          <div class="section-heading">
            <div>
              <span class="eyebrow">冲突建议来源</span>
              <h2>合并建议</h2>
            </div>
            {#if snapshot.advice}<span
                class={`confidence confidence--${snapshot.advice.confidence}`}
                >{confidenceLabels[snapshot.advice.confidence]}</span
              >{/if}
          </div>
          {#if snapshot.aiPrivacy}<div class="privacy-note">
              <strong>外发预览</strong><span
                >{snapshot.aiPrivacy.data}；{snapshot.aiPrivacy
                  .characters}/{snapshot.aiPrivacy.maxCharacters} 个字符；模型 {snapshot
                  .aiPrivacy.model}；不含历史。{conflictAdviceConfigured
                  ? "点击“AI 分析”后才会发送。"
                  : "未配置外部模型，将运行本地规则，不会外发。"}</span
              >
            </div>{/if}
          {#if snapshot.advice}
            <strong
              >{recommendationLabels[snapshot.advice.recommendation]}</strong
            >
            <small class="ai-source"
              >{sourceLabels[snapshot.advice.source]}</small
            >
            <p>{snapshot.advice.summary}</p>
            {#if snapshot.advice.fallbackReason}<div
                class="notice notice--warning"
              >
                降级原因：{snapshot.advice.fallbackReason}
              </div>{/if}
            {#if snapshot.advice.risks.length}<h3>风险</h3>
              <ul>
                {#each snapshot.advice.risks as risk, riskIndex (riskIndex)}<li>
                    {risk}
                  </li>{/each}
              </ul>{/if}
            {#if snapshot.advice.steps.length}<h3>验证步骤</h3>
              <ol>
                {#each snapshot.advice.steps as step, stepIndex (stepIndex)}<li>
                    {step}
                  </li>{/each}
              </ol>{/if}
          {:else}
            <div class="preview-empty">
              <span class="codicon codicon-sparkle"></span>
              <p>AI 只提供解释和候选，不会自动标记解决。</p>
              <button
                class="button button--secondary"
                onclick={() =>
                  onAction("conflict/advise", {
                    relativePath: snapshot.selected?.relativePath,
                  })}>分析两侧意图</button
              >
            </div>
          {/if}
        </section>
        <section class="resolve-panel">
          <div class="section-heading">
            <div>
              <span class="eyebrow">解决确认</span>
              <h2>标记为已解决</h2>
            </div>
          </div>
          {#if snapshot.resolvePreview}
            <div class="notice">
              <span class="codicon codicon-terminal"></span><code
                >{snapshot.resolvePreview.command}</code
              >
            </div>
            {#each snapshot.resolvePreview.issues as issue, issueIndex (issueIndex)}<div
                class="issue-list"
              >
                <div>{issue}</div>
              </div>{/each}
            <button
              class="button button--primary commit-button"
              disabled={!snapshot.resolvePreview.canResolve}
              onclick={() =>
                onAction("conflict/resolve", {
                  previewToken: snapshot.resolvePreview?.token,
                })}>确认使用当前工作副本内容并标记解决</button
            >
          {:else}
            <p class="muted">
              请先在内嵌工作副本编辑器完成合并并保存。解决预览不会修改文件。
            </p>
            <button
              class="button button--secondary"
              onclick={() =>
                onAction("conflict/preview-resolve", {
                  relativePath: snapshot.selected?.relativePath,
                })}>生成解决预览</button
            >
          {/if}
        </section>
      </div>
    {:else}
      <div class="empty-state empty-state--large">
        <span class="codicon codicon-merge"></span>
        <div>
          <strong>选择一个冲突文件</strong>
          <p>比较本地、远端、BASE 和当前工作副本内容。</p>
        </div>
      </div>
    {/if}
  </ScrollArea>
</section>
