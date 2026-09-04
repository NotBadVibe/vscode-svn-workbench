<script lang="ts">
  /*
   * v0.1.6 V016-E CommitMessageEditor：提交说明编辑区独立组件。
   * - 从 CommitModule 抽出模板行 + textarea + 字数/快捷键 meta +
   *   messageIssues + IME 保护的提交预览快捷键，不产生第二套状态机：
   *   `message` 由父模块权威持有（`bind:message`），本组件只做受控展示
   *   与事件透传（输入/失焦同步草稿、Ctrl/⌘+Enter 请求预览、模板套用）。
   * - 快捷键复用 `isExplicitSubmitShortcut`（IME 候选阶段 Enter 不触发）。
   * - 样式沿用全局 `.template-row`/`.compose-meta`/`.issue-list`，
   *   本文件不声明全局 overflow。
   */
  import { isExplicitSubmitShortcut } from "../../i18n/keyboard";

  /** 提交说明模板（Host 下发，id/label/body）。 */
  export interface CommitMessageTemplate {
    id: string;
    label: string;
    body: string;
  }

  let {
    message = $bindable(""),
    templates = [],
    messageIssues = [],
    conventionHint,
    maxlength = 2000,
    onApplyTemplate,
    onDraftUpdate,
    onPreviewRequest,
  }: {
    /** 提交说明草稿：父模块权威，本组件只经 `bind:message` 受控展示。 */
    message: string;
    /** 可套用模板列表。 */
    templates?: CommitMessageTemplate[];
    /** 提交说明规范问题（本地规则/团队规范）。 */
    messageIssues?: string[];
    /** 团队规范提示（有则在 meta 区展示“团队规范已加载”）。 */
    conventionHint?: string;
    /** 最大字符数，缺省 2000（与 Host 校验一致）。 */
    maxlength?: number;
    /** 模板套用：透传 templateId，由父模块映射 Host 动作。 */
    onApplyTemplate: (templateId: string) => void;
    /** 草稿同步：输入/失焦时透传当前文本，由父模块写 Host。 */
    onDraftUpdate: (next: string) => void;
    /** 预览请求：显式 Ctrl/⌘+Enter 时透传，由父模块携带选择生成预览。 */
    onPreviewRequest: () => void;
  } = $props();

  /** IME 保护的提交预览快捷键：候选阶段 Enter 不触发（`keyboard.ts` 同模式）。 */
  function handleMessageKeydown(event: KeyboardEvent): void {
    if (!isExplicitSubmitShortcut(event)) return;
    event.preventDefault();
    onPreviewRequest();
  }
</script>

<div class="commit-message-editor">
  <div class="template-row" aria-label="提交说明模板">
    {#each templates as template (template.id)}
      <button title={template.body} onclick={() => onApplyTemplate(template.id)}
        >{template.label}</button
      >
    {/each}
  </div>
  <textarea
    bind:value={message}
    onblur={() => onDraftUpdate(message)}
    oninput={() => onDraftUpdate(message)}
    onkeydown={handleMessageKeydown}
    aria-label="提交说明"
    aria-describedby="commit-message-shortcut"
    placeholder="说明改动意图、范围与影响…"
    {maxlength}></textarea>
  <div class="compose-meta">
    <span>{message.length}/{maxlength} 个字符</span>
    <span id="commit-message-shortcut">按 Ctrl/⌘ + Enter 生成提交预览</span>
    {#if conventionHint}<span title={conventionHint}>团队规范已加载</span>{/if}
  </div>
  {#if messageIssues.length > 0}
    <div class="issue-list" role="alert">
      {#each messageIssues as issue, issueIndex (issueIndex)}
        <div>
          <span class="codicon codicon-warning" aria-hidden="true"
          ></span>{issue}
        </div>
      {/each}
    </div>
  {/if}
</div>
