<script lang="ts">
  /*
   * v0.1.6 V016-E CommitMessageEditor：提交说明编辑区独立组件。
   * - 从 CommitModule 抽出模板行 + textarea + 字数/快捷键 meta +
   *   messageIssues + IME 保护的提交预览快捷键，不产生第二套状态机：
   *   `message` 由父模块权威持有（`bind:message`），本组件只做受控展示
   *   与事件透传（输入/失焦同步草稿、Ctrl/⌘+Enter 请求预览、模板套用）。
   * - 快捷键复用 `isExplicitSubmitShortcut`（IME 候选阶段 Enter 不触发）。
   * - 样式沿用全局 `.template-row`/`.compose-meta`/`.issue-list`
   *   （三者均为无祖先依赖选择器，抽组件后仍有效，已复核），
   *   本文件不声明全局 overflow。
   * - V020-R02：输入框布局归属本组件自身（scoped `.commit-message-editor`
   *   textarea：铺满可用宽度、最小高度 150px、纵向可调），不再依赖
   *   v0.1.4 紧凑模式重构后已不存在的 `.commit-compose` 祖先类
   *   （global.css `.commit-compose textarea` 规则因此失效，
   *   textarea 回退到 UA 默认小尺寸）。
   */
  import { isExplicitSubmitShortcut } from "../../i18n/keyboard";
  import { commitMessageShortcutHint } from "../../i18n/shortcutHelp";
  import { commitMessageEmptyWritingHint } from "../../i18n/terminology";

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
    forceShowValidation = false,
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
    /**
     * V022-R33：父模块主预览按钮被点击后置 true——空表单同样进入“已请求预览”，
     * 字段错误不再保持中性提示。缺省 false（仅编辑区自身失焦/Ctrl+Enter 驱动）。
     */
    forceShowValidation?: boolean;
  } = $props();

  /*
   * V022-R33：空表单先提示再校验。`touched` 在失焦或请求预览后置位；置位前
   * 空表单只展示中性写作提示，不展示字段错误（不做错误色误报、不打断读屏）。
   * 有内容时的规范问题始终立即展示；修正后随 props 即时更新，草稿不重置。
   * `isComposing` 跟踪中文 IME 候选：候选阶段不同步草稿（不提前触发 Host 校验
   * 与错误播报），组合结束后一次性同步；候选阶段 Enter 不触发预览（快捷键守卫）。
   */
  let touched = $state(false);
  let isComposing = $state(false);
  const showIssues = $derived(
    messageIssues.length > 0 &&
      (message.trim().length > 0 || touched || forceShowValidation),
  );

  /** IME 保护的提交预览快捷键：候选阶段 Enter 不触发（`keyboard.ts` 同模式）。 */
  function handleMessageKeydown(event: KeyboardEvent): void {
    if (!isExplicitSubmitShortcut(event)) return;
    event.preventDefault();
    // 请求预览后进入已校验态：空表单字段错误不再保持中性提示。
    touched = true;
    onPreviewRequest();
  }

  /** 候选阶段不同步草稿；组合结束后一次性同步，避免提前错误播报。 */
  function handleCompositionEnd(): void {
    isComposing = false;
    onDraftUpdate(message);
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
    onblur={() => {
      touched = true;
      onDraftUpdate(message);
    }}
    oninput={() => {
      if (!isComposing) onDraftUpdate(message);
    }}
    oncompositionstart={() => (isComposing = true)}
    oncompositionend={handleCompositionEnd}
    onkeydown={handleMessageKeydown}
    aria-label="提交说明"
    aria-describedby="commit-message-shortcut"
    placeholder="说明改动意图、范围与影响…"
    {maxlength}></textarea>
  <div class="compose-meta">
    <span>{message.length}/{maxlength} 个字符</span>
    <span id="commit-message-shortcut">{commitMessageShortcutHint}</span>
    {#if conventionHint}<span title={conventionHint}>团队规范已加载</span>{/if}
  </div>
  {#if showIssues}
    <div class="issue-list" role="alert">
      {#each messageIssues as issue, issueIndex (issueIndex)}
        <div>
          <span class="codicon codicon-warning" aria-hidden="true"
          ></span>{issue}
        </div>
      {/each}
    </div>
  {:else if message.trim().length === 0}
    <p class="compose-hint">{commitMessageEmptyWritingHint}</p>
  {/if}
</div>

<style>
  /*
   * V020-R02：输入框布局归属本组件自身，不依赖已不存在的
   * `.commit-compose` 祖先类。取值与失效前的全局规则一致
   * （宽 100%、最小高 150px、纵向可调），小高度时随页面滚动容器协调。
   */
  .commit-message-editor {
    display: flex;
    flex-direction: column;
    min-width: 0;
    width: 100%;
  }
  .commit-message-editor textarea {
    width: 100%;
    min-height: 150px;
    box-sizing: border-box;
    resize: vertical;
    padding: 9px 10px;
    border: 1px solid var(--vscode-input-border, var(--border));
    border-radius: var(--radius-sm);
    outline: 0;
    color: var(--vscode-input-foreground, inherit);
    background: var(--vscode-input-background, var(--surface-0));
    font-family: var(--vscode-editor-font-family, monospace);
    line-height: 1.5;
  }
  .commit-message-editor textarea:focus {
    border-color: var(--border-strong);
  }
  /*
   * V022-R33：空表单中性写作提示——描述文字色，无警告色，不进入活区播报。
   */
  .compose-hint {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
</style>
