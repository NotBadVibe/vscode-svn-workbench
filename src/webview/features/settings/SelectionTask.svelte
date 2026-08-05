<!--
  提交选择规则设置任务（v0.0.3 阶段 3，规划 4.1）。

  页面只编辑当前仓库层规则：状态策略选择“继承”时不写入仓库配置；
  路径规则表格按“第一条命中生效”排序展示合并结果，内置规则可禁用或以同 ID 覆盖。
  实时预览在 Webview 端本地计算：编辑中的草稿经纯函数评估器对快照候选清单评估，
  编辑输入 debounce 后才重算，不向 Host 发送高频请求；预览不调用 AI、不改提交篮。

  文本输入不绑定任何 Enter 行为，也不包裹在 form 中，因此中文 IME composition
  候选阶段的 Enter 不可能触发保存或确认（设计与交互基线 3.5）。
-->
<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import type {
    SettingsSnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import {
    commitSelectionDecisionLabels,
    commitSelectionReasonKeyLabels,
    commitSelectionRuleSourceLabels,
    commitSelectionStatusKeyLabels,
    fileStatusLabels,
  } from "../../i18n/terminology";
  import {
    COMMIT_SELECTION_CONFIG_VERSION,
    MAX_COMMIT_SELECTION_PATH_RULES,
    blockedCommitSelectionStatuses,
    builtinCommitSelectionPathRules,
    configurableCommitSelectionStatusKeys,
    defaultCommitSelectionStatusRules,
    forcedExcludedCommitSelectionStatuses,
    isValidCommitSelectionPathRuleId,
    validateCommitSelectionPattern,
    type CommitSelectionLayerConfig,
    type CommitSelectionPathRule,
    type CommitSelectionRuleSource,
    type CommitSelectionStatusKey,
    type ConfigurableCommitSelectionDecision,
  } from "../../../commit/commitSelectionRules";
  import { resolveCommitSelectionRules } from "../../../commit/commitSelectionRuleResolver";
  import {
    createCommitSelectionEvaluator,
    type EffectiveCommitSelectionRules,
  } from "../../../commit/commitSelectionRuleEvaluator";
  import type { SvnStatus } from "../../../svn/svnTypes";

  let {
    snapshot,
    onAction,
  }: {
    snapshot: SettingsSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  const PREVIEW_DEBOUNCE_MS = 250;
  const INHERIT_VALUE = "inherit";
  const builtinIds = new SvelteSet(
    builtinCommitSelectionPathRules.map((rule) => rule.id),
  );

  const selection = $derived(snapshot.selection);

  const statusKeyHints: Partial<Record<CommitSelectionStatusKey, string>> = {
    propertyModified: "status 为 normal、仅 SVN 属性被修改",
    normal: "不会影响仅属性变化的文件",
    missing: "受控文件在磁盘中不存在",
    unversioned: "尚未加入版本控制的文件",
  };

  const safetyNotes: Record<string, string> = {
    conflicted: "存在冲突，必须先解决后才能提交。",
    obstructed: "路径受阻，提交被阻止。",
    incomplete: "状态不完整（工作副本中断），提交被阻止。",
    external: "外部工作副本不能进入当前仓库提交。",
    ignored: "已忽略路径不能通过建议选择隐式加入 SVN。",
  };

  const safetyRows: Array<{
    status: SvnStatus;
    decision: "blocked" | "excluded";
  }> = [
    ...blockedCommitSelectionStatuses.map((status) => ({
      status: status as SvnStatus,
      decision: "blocked" as const,
    })),
    ...forcedExcludedCommitSelectionStatuses.map((status) => ({
      status: status as SvnStatus,
      decision: "excluded" as const,
    })),
  ];

  // ---- 仓库层编辑草稿 ----

  let statusDraft = $state<
    Partial<
      Record<CommitSelectionStatusKey, ConfigurableCommitSelectionDecision>
    >
  >({});
  let pathDraft = $state<CommitSelectionPathRule[]>([]);
  let dirty = $state(false);
  // 非响应式同步标记：避免快照回声把用户未保存的编辑冲掉。
  let syncedConfig: unknown;
  let syncedFeedback: unknown;

  function initDraft(config: CommitSelectionLayerConfig | undefined): void {
    statusDraft = { ...(config?.statusRules ?? {}) };
    pathDraft = (config?.pathRules ?? []).map((rule) => ({ ...rule }));
  }

  $effect(() => {
    const repositoryConfig = selection.layers.repository.config;
    const feedback = selection.feedback;
    // 保存/恢复成功（新反馈且非失败）后，以 Host 持久化结果重置草稿；
    // 校验失败时保留草稿，让用户修正后重试。
    const actionCompleted =
      feedback !== undefined &&
      feedback !== syncedFeedback &&
      feedback.tone !== "error";
    if (!dirty || actionCompleted) {
      if (repositoryConfig !== syncedConfig || actionCompleted) {
        initDraft(repositoryConfig);
        dirty = false;
      }
    }
    syncedConfig = repositoryConfig;
    syncedFeedback = feedback;
  });

  function markDirty(): void {
    dirty = true;
  }

  // ---- 本地合并与校验（纯函数，与 Host 共用同一套领域逻辑） ----

  /** 不含仓库层的合并结果，用于状态策略“继承”选项显示当前生效值。 */
  const baseResolution = $derived(
    resolveCommitSelectionRules({
      user: selection.layers.user.config,
      workspace: selection.layers.workspace.config,
    }),
  );

  /**
   * 预览用的草稿清理：剔除行内校验已标出的非法规则（非法 ID、重复 ID、
   * 非法 glob），保证合并结果有效；超限部分截断。被剔除的行仍在表格中
   * 显示行内错误，不会静默消失。
   */
  function sanitizedDraftConfig(): CommitSelectionLayerConfig {
    const seen = new SvelteSet<string>();
    const pathRules: CommitSelectionPathRule[] = [];
    for (const rule of pathDraft) {
      if (!isValidCommitSelectionPathRuleId(rule.id) || seen.has(rule.id)) {
        continue;
      }
      if (validateCommitSelectionPattern(rule.pattern)) {
        continue;
      }
      seen.add(rule.id);
      pathRules.push({ ...rule });
      if (pathRules.length >= MAX_COMMIT_SELECTION_PATH_RULES) {
        break;
      }
    }
    return {
      version: COMMIT_SELECTION_CONFIG_VERSION,
      statusRules: { ...statusDraft },
      pathRules,
    };
  }

  const draftResolution = $derived(
    resolveCommitSelectionRules({
      user: selection.layers.user.config,
      workspace: selection.layers.workspace.config,
      repository: sanitizedDraftConfig(),
    }),
  );

  /** 合并数量上限等表级警告；层级配置警告在作用域卡展示，遮蔽警告行内展示。 */
  const mergeWarnings = $derived(
    draftResolution.warnings.filter((warning) =>
      warning.startsWith("合并后的"),
    ),
  );

  // ---- 实时预览：编辑输入 debounce 后在 Webview 端本地评估 ----

  // 初始值仅为挂载瞬时的占位；首个 effect 会同步应用当前草稿的合并结果。
  let previewRules = $state<EffectiveCommitSelectionRules>({
    statusRules: { ...defaultCommitSelectionStatusRules },
    pathRules: [],
  });
  let previewPrimed = false;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const statusRules = draftResolution.statusRules;
    const pathRules = draftResolution.pathRules;
    clearTimeout(previewTimer);
    if (!previewPrimed) {
      // 首次同步应用，保证进入页面时预览立即可用。
      previewPrimed = true;
      previewRules = { statusRules, pathRules };
      return;
    }
    previewTimer = setTimeout(() => {
      previewRules = { statusRules, pathRules };
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(previewTimer);
  });

  const previewEvaluator = $derived(
    createCommitSelectionEvaluator(previewRules),
  );

  const previewRows = $derived(
    selection.preview.items.map((item) => ({
      ...item,
      evaluation: previewEvaluator.evaluate({
        relativePath: item.relativePath,
        status: item.status,
        propStatus: item.propStatus,
      }),
    })),
  );

  const previewSummary = $derived.by(() => {
    const counts = {
      recommended: 0,
      needsReview: 0,
      excluded: 0,
      blocked: 0,
    };
    for (const row of previewRows) {
      counts[row.evaluation.decision] += 1;
    }
    return counts;
  });

  // ---- 路径规则表格行模型：草稿自定义规则 → 下层自定义规则 → 内置槽位 ----

  interface SelectionRuleRow {
    key: string;
    slot: "custom" | "builtin";
    source: CommitSelectionRuleSource;
    /** 来自仓库草稿、可直接编辑。 */
    editable: boolean;
    /** 草稿中以同 ID 覆盖了内置规则。 */
    isOverride: boolean;
    /** 在 pathDraft 中的下标；不可编辑行为 -1。 */
    draftIndex: number;
    /** 在草稿自定义规则中的位置（用于上移/下移）。 */
    customPosition: number;
    customCount: number;
    rule: CommitSelectionPathRule;
  }

  const ruleRows = $derived.by((): SelectionRuleRow[] => {
    const rows: SelectionRuleRow[] = [];
    const customs = pathDraft
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule }) => !builtinIds.has(rule.id));
    const customIdSet = new SvelteSet(customs.map(({ rule }) => rule.id));
    customs.forEach(({ rule, index }, position) => {
      rows.push({
        key: `draft-${index}`,
        slot: "custom",
        source: "repository",
        editable: true,
        isOverride: false,
        draftIndex: index,
        customPosition: position,
        customCount: customs.length,
        rule,
      });
    });
    for (const layer of ["workspace", "user"] as const) {
      for (const rule of selection.layers[layer].config?.pathRules ?? []) {
        // 同 ID 的仓库草稿优先，下层行不再重复展示。
        if (builtinIds.has(rule.id) || customIdSet.has(rule.id)) {
          continue;
        }
        rows.push({
          key: `${layer}-${rule.id}`,
          slot: "custom",
          source: layer,
          editable: false,
          isOverride: false,
          draftIndex: -1,
          customPosition: -1,
          customCount: 0,
          rule,
        });
      }
    }
    for (const builtinRule of builtinCommitSelectionPathRules) {
      const draftIndex = pathDraft.findIndex(
        (rule) => rule.id === builtinRule.id,
      );
      if (draftIndex >= 0) {
        rows.push({
          key: `draft-${draftIndex}`,
          slot: "builtin",
          source: "repository",
          editable: true,
          isOverride: true,
          draftIndex,
          customPosition: -1,
          customCount: 0,
          rule: pathDraft[draftIndex],
        });
        continue;
      }
      const workspaceRule = selection.layers.workspace.config?.pathRules?.find(
        (rule) => rule.id === builtinRule.id,
      );
      const userRule = selection.layers.user.config?.pathRules?.find(
        (rule) => rule.id === builtinRule.id,
      );
      const effective = workspaceRule ?? userRule ?? builtinRule;
      rows.push({
        key: `builtin-${builtinRule.id}`,
        slot: "builtin",
        source: workspaceRule ? "workspace" : userRule ? "user" : "builtin",
        editable: false,
        isOverride: false,
        draftIndex: -1,
        customPosition: -1,
        customCount: 0,
        rule: effective,
      });
    }
    return rows;
  });

  function rowIssues(row: SelectionRuleRow): {
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!row.editable) {
      return { errors, warnings };
    }
    if (!row.isOverride) {
      if (!isValidCommitSelectionPathRuleId(row.rule.id)) {
        errors.push(
          "规则 ID 需以字母或数字开头，只能包含字母、数字、“-”和“_”，最长 64 字符。",
        );
      } else if (
        pathDraft.filter((rule) => rule.id === row.rule.id).length > 1
      ) {
        errors.push(`规则 ID “${row.rule.id}” 重复。`);
      }
    }
    const patternError = validateCommitSelectionPattern(row.rule.pattern);
    if (patternError) {
      errors.push(patternError);
    }
    for (const warning of draftResolution.warnings) {
      if (warning.startsWith(`规则 "${row.rule.id}" `)) {
        warnings.push(warning);
      }
    }
    return { errors, warnings };
  }

  const hasRowErrors = $derived(
    ruleRows.some((row) => rowIssues(row).errors.length > 0),
  );

  // ---- 编辑操作 ----

  function setStatusPolicy(key: CommitSelectionStatusKey, value: string): void {
    if (value === INHERIT_VALUE) {
      delete statusDraft[key];
    } else if (
      value === "recommended" ||
      value === "needsReview" ||
      value === "excluded"
    ) {
      statusDraft[key] = value;
    }
    markDirty();
  }

  function addRule(): void {
    let index = pathDraft.length + 1;
    let id = `team-rule-${index}`;
    while (pathDraft.some((rule) => rule.id === id) || builtinIds.has(id)) {
      index += 1;
      id = `team-rule-${index}`;
    }
    pathDraft.push({
      id,
      enabled: true,
      pattern: "",
      decision: "needsReview",
      reason: "",
    });
    markDirty();
  }

  function removeRule(row: SelectionRuleRow): void {
    if (row.draftIndex < 0) {
      return;
    }
    pathDraft.splice(row.draftIndex, 1);
    markDirty();
  }

  function moveRule(row: SelectionRuleRow, direction: -1 | 1): void {
    const customs = pathDraft
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule }) => !builtinIds.has(rule.id));
    const position = customs.findIndex(({ index }) => index === row.draftIndex);
    const target = position + direction;
    if (position < 0 || target < 0 || target >= customs.length) {
      return;
    }
    const other = customs[target].index;
    [pathDraft[row.draftIndex], pathDraft[other]] = [
      pathDraft[other],
      pathDraft[row.draftIndex],
    ];
    markDirty();
  }

  function toggleRuleEnabled(row: SelectionRuleRow): void {
    if (row.editable && row.draftIndex >= 0) {
      pathDraft[row.draftIndex].enabled = !pathDraft[row.draftIndex].enabled;
    } else if (row.slot === "builtin") {
      // 内置/下层规则：以同 ID 仓库级覆盖翻转启用状态（规划 4.1）。
      pathDraft.push({ ...row.rule, enabled: !row.rule.enabled });
    }
    markDirty();
  }

  function overrideBuiltinRule(row: SelectionRuleRow): void {
    if (row.editable || row.slot !== "builtin") {
      return;
    }
    pathDraft.push({ ...row.rule });
    markDirty();
  }

  function updateRuleField(
    row: SelectionRuleRow,
    field: "id" | "pattern" | "reason",
    value: string,
  ): void {
    if (row.draftIndex < 0) {
      return;
    }
    pathDraft[row.draftIndex][field] = value;
    markDirty();
  }

  function updateRuleDecision(row: SelectionRuleRow, value: string): void {
    if (row.draftIndex < 0) {
      return;
    }
    if (
      value === "recommended" ||
      value === "needsReview" ||
      value === "excluded"
    ) {
      pathDraft[row.draftIndex].decision = value;
      markDirty();
    }
  }

  function saveSelection(): void {
    onAction("settings/save-selection", {
      scope: "repository",
      statusRules: { ...statusDraft },
      pathRules: pathDraft.map((rule) => ({ ...rule })),
    });
  }

  // ---- 展示辅助 ----

  const scopeCards = $derived.by(() => {
    const order: Array<{
      key: "user" | "workspace" | "repository";
      title: string;
      hint: string;
    }> = [
      {
        key: "user",
        title: "用户默认",
        hint: "适用于所有仓库，由 VS Code 用户设置承载，可随设置同步。",
      },
      {
        key: "workspace",
        title: "当前工作区",
        hint: "覆盖用户默认，由 VS Code 工作区设置承载。",
      },
      {
        key: "repository",
        title: "当前仓库",
        hint: `写入 ${selection.configPath}，可随仓库共享，优先级最高。`,
      },
    ];
    return order.map((item) => {
      const layer = selection.layers[item.key];
      return {
        ...item,
        layer,
        statusCount: Object.keys(layer.config?.statusRules ?? {}).length,
        pathCount: layer.config?.pathRules?.length ?? 0,
      };
    });
  });

  function layerStateText(card: (typeof scopeCards)[number]): string {
    if (card.layer.state === "empty") {
      return "未配置";
    }
    if (card.layer.state === "failed") {
      return "校验失败，已忽略该层配置";
    }
    return `已应用：${card.statusCount} 条状态策略 · ${card.pathCount} 条路径规则`;
  }

  function hitRuleText(row: (typeof previewRows)[number]): string {
    const evaluation = row.evaluation;
    if (evaluation.reasonKey === "pathRule") {
      return evaluation.matchedRuleId ?? "路径规则";
    }
    if (evaluation.reasonKey === "statusPolicy") {
      return evaluation.statusPolicyKey
        ? `状态策略：${commitSelectionStatusKeyLabels[evaluation.statusPolicyKey]}`
        : "状态策略";
    }
    return "安全规则";
  }

  function ruleSourceText(row: (typeof previewRows)[number]): string {
    const evaluation = row.evaluation;
    if (evaluation.reasonKey === "pathRule" && evaluation.ruleSource) {
      return commitSelectionRuleSourceLabels[evaluation.ruleSource];
    }
    if (evaluation.reasonKey === "statusPolicy") {
      return "状态默认策略";
    }
    return "安全规则（不可覆盖）";
  }

  function previewStatusText(row: (typeof previewRows)[number]): string {
    const base = fileStatusLabels[row.status];
    return row.propStatus === "modified" ? `${base}（含属性变更）` : base;
  }
</script>

<div class="settings-grid selection-settings">
  <section class="settings-card settings-card--wide">
    <div class="section-heading">
      <div>
        <span class="eyebrow">配置作用域</span>
        <h2>规则来源与覆盖关系</h2>
      </div>
      {#if dirty}<span class="status-badge status-badge--modified"
          >有未保存的修改</span
        >{/if}
    </div>
    <p class="muted">
      优先级：不可修改的安全规则 &gt; 当前仓库 &gt; 当前工作区 &gt; 用户默认
      &gt; 内置默认。本页只编辑当前仓库层；用户与工作区层请在 VS Code
      设置中编辑。
    </p>
    <div class="selection-scope-grid">
      {#each scopeCards as card (card.key)}
        <div
          class="selection-scope-card"
          class:selection-scope-card--active={card.key ===
            selection.editingScope}
        >
          <h3>
            {card.title}{card.key === selection.editingScope
              ? "（本页编辑）"
              : ""}
          </h3>
          <span class="selection-scope-meta">{layerStateText(card)}</span>
          <span class="selection-scope-meta">{card.hint}</span>
          {#each card.layer.errors as error, errorIndex (errorIndex)}<div
              class="notice notice--error"
            >
              {error}
            </div>{/each}
          {#each card.layer.warnings as warning, warningIndex (warningIndex)}<div
              class="notice notice--warning"
            >
              {warning}
            </div>{/each}
          {#if card.key === "user" || card.key === "workspace"}
            <div>
              <button
                class="button button--secondary"
                onclick={() =>
                  onAction("settings/open-selection-vscode-settings", {
                    layer: card.key,
                  })}>在 VS Code 设置中编辑</button
              >
            </div>
          {/if}
        </div>
      {/each}
    </div>
    {#if selection.layers.repository.state === "failed"}
      <div class="notice notice--error">
        仓库层配置解析失败，下方表单按内置默认初始化；保存将以表单内容覆盖损坏的
        commitSelection 段，文件其他配置保持不变。
      </div>
    {/if}
  </section>

  <section class="settings-card">
    <div class="section-heading">
      <div>
        <span class="eyebrow">SVN 状态策略</span>
        <h2>按状态的默认决策</h2>
      </div>
    </div>
    <p class="muted">
      路径规则优先于状态策略。选择“继承”时不写入仓库配置，沿用下层配置与内置默认。
    </p>
    <div class="selection-status-list">
      {#each configurableCommitSelectionStatusKeys as key (key)}
        <div class="selection-status-row">
          <span>
            <strong>{commitSelectionStatusKeyLabels[key]}</strong>
            {#if statusKeyHints[key]}<small class="muted"
                >{statusKeyHints[key]}</small
              >{/if}
          </span>
          <select
            aria-label={`${commitSelectionStatusKeyLabels[key]}的默认决策`}
            value={statusDraft[key] ?? INHERIT_VALUE}
            onchange={(event) =>
              setStatusPolicy(key, event.currentTarget.value)}
          >
            <option value={INHERIT_VALUE}
              >继承（当前：{commitSelectionDecisionLabels[
                baseResolution.statusRules[key]
              ]}）</option
            >
            <option value="recommended">推荐提交</option>
            <option value="needsReview">需要确认</option>
            <option value="excluded">排除</option>
          </select>
        </div>
      {/each}
    </div>
  </section>

  <section class="settings-card">
    <div class="section-heading">
      <div>
        <span class="eyebrow">安全规则</span>
        <h2>不可配置的状态</h2>
      </div>
      <span class="codicon codicon-shield" aria-hidden="true"></span>
    </div>
    <p class="muted">以下状态由安全规则固定，不能被配置或 AI 覆盖。</p>
    <div class="selection-safety-list">
      {#each safetyRows as row (row.status)}
        <div class="selection-safety-row">
          <span class={`decision-badge decision-badge--${row.decision}`}
            >{commitSelectionDecisionLabels[row.decision]}</span
          >
          <span>
            <strong>{fileStatusLabels[row.status]}</strong>
            <small class="muted">{safetyNotes[row.status]}</small>
          </span>
        </div>
      {/each}
    </div>
  </section>

  <section class="settings-card settings-card--wide">
    <div class="section-heading">
      <div>
        <span class="eyebrow">路径规则</span>
        <h2>
          Glob 路径规则（{draftResolution.pathRules
            .length}/{MAX_COMMIT_SELECTION_PATH_RULES}）
        </h2>
      </div>
      <button class="button button--secondary" onclick={addRule}
        >新增规则</button
      >
    </div>
    <p class="muted">
      按从上到下的顺序匹配，第一条命中规则生效，优先于状态策略。表达式相对仓库根、使用“/”分隔、支持“**”；自定义规则排在内置规则之前，可用相同规则
      ID 覆盖内置规则。
    </p>
    {#each mergeWarnings as warning, warningIndex (warningIndex)}<div
        class="notice notice--warning"
      >
        {warning}
      </div>{/each}
    <ScrollArea class="selection-rule-list" label="提交选择路径规则列表">
      <div class="selection-rule-header" aria-hidden="true">
        <span>启用</span><span>规则 ID / 来源</span><span>决策</span><span
          >操作</span
        >
      </div>
      {#each ruleRows as row (row.key)}
        {@const issues = rowIssues(row)}
        <div
          class="selection-rule-row"
          class:selection-rule-row--disabled={!row.rule.enabled}
        >
          <div class="selection-rule-line">
            <input
              type="checkbox"
              aria-label={`启用规则 ${row.rule.id || "（未命名）"}`}
              checked={row.rule.enabled}
              disabled={!row.editable && row.slot !== "builtin"}
              onchange={() => toggleRuleEnabled(row)}
            />
            <div class="selection-rule-id">
              {#if row.editable && !row.isOverride}
                <input
                  class="selection-rule-id-input"
                  aria-label="规则 ID"
                  value={row.rule.id}
                  placeholder="rule-id"
                  oninput={(event) =>
                    updateRuleField(row, "id", event.currentTarget.value)}
                />
              {:else}
                <code title={row.rule.id}>{row.rule.id}</code>
              {/if}
              <span class="source-badge"
                >{commitSelectionRuleSourceLabels[row.source]}{row.isOverride
                  ? "（覆盖内置）"
                  : ""}</span
              >
            </div>
            {#if row.editable}
              <select
                aria-label={`规则 ${row.rule.id} 的决策`}
                value={row.rule.decision}
                onchange={(event) =>
                  updateRuleDecision(row, event.currentTarget.value)}
              >
                <option value="recommended">推荐提交</option>
                <option value="needsReview">需要确认</option>
                <option value="excluded">排除</option>
              </select>
            {:else}
              <span
                class={`decision-badge decision-badge--${row.rule.decision}`}
                >{commitSelectionDecisionLabels[row.rule.decision]}</span
              >
            {/if}
            <div class="selection-rule-actions">
              {#if row.editable}
                {#if !row.isOverride}
                  <button
                    class="icon-button icon-button--small"
                    aria-label={`上移规则 ${row.rule.id}`}
                    disabled={row.customPosition <= 0}
                    onclick={() => moveRule(row, -1)}
                    ><span class="codicon codicon-arrow-up" aria-hidden="true"
                    ></span></button
                  >
                  <button
                    class="icon-button icon-button--small"
                    aria-label={`下移规则 ${row.rule.id}`}
                    disabled={row.customPosition < 0 ||
                      row.customPosition >= row.customCount - 1}
                    onclick={() => moveRule(row, 1)}
                    ><span class="codicon codicon-arrow-down" aria-hidden="true"
                    ></span></button
                  >
                {/if}
                <button
                  class="icon-button icon-button--small"
                  aria-label={row.isOverride
                    ? `恢复内置规则 ${row.rule.id}`
                    : `删除规则 ${row.rule.id}`}
                  title={row.isOverride
                    ? "删除仓库级覆盖，恢复内置定义"
                    : "删除该规则"}
                  onclick={() => removeRule(row)}
                  ><span class="codicon codicon-trash" aria-hidden="true"
                  ></span></button
                >
              {:else if row.slot === "builtin"}
                <button
                  class="button button--secondary"
                  onclick={() => overrideBuiltinRule(row)}>覆盖编辑</button
                >
              {/if}
            </div>
          </div>
          <div class="selection-rule-line selection-rule-line--fields">
            {#if row.editable}
              <label class="field selection-rule-field"
                ><span>Glob 表达式</span><input
                  value={row.rule.pattern}
                  placeholder="**/dist/**"
                  oninput={(event) =>
                    updateRuleField(row, "pattern", event.currentTarget.value)}
                /></label
              >
              <label class="field selection-rule-field"
                ><span>中文原因</span><input
                  value={row.rule.reason}
                  placeholder="说明这条规则的原因"
                  oninput={(event) =>
                    updateRuleField(row, "reason", event.currentTarget.value)}
                /></label
              >
            {:else}
              <span class="selection-rule-pattern" title={row.rule.pattern}
                ><code>{row.rule.pattern}</code></span
              >
              <span class="muted">{row.rule.reason || "（无原因说明）"}</span>
            {/if}
          </div>
          {#each issues.errors as error, errorIndex (errorIndex)}<div
              class="selection-rule-issue selection-rule-issue--error"
            >
              <span class="codicon codicon-error" aria-hidden="true"
              ></span>{error}
            </div>{/each}
          {#each issues.warnings as warning, warningIndex (warningIndex)}<div
              class="selection-rule-issue selection-rule-issue--warning"
            >
              <span class="codicon codicon-warning" aria-hidden="true"
              ></span>{warning}
            </div>{/each}
        </div>
      {/each}
    </ScrollArea>
  </section>

  <section class="settings-card settings-card--wide">
    <div class="section-heading">
      <div>
        <span class="eyebrow">实时预览</span>
        <h2>当前仓库候选命中结果</h2>
      </div>
      <button
        class="button button--secondary"
        onclick={() => onAction("settings/refresh-selection-preview")}
        >重新采集候选</button
      >
    </div>
    <p class="muted">
      预览使用编辑中的规则草稿在本地计算，不调用 AI，也不会修改当前提交篮。
    </p>
    {#if selection.preview.state === "error"}
      <div class="notice notice--error" role="alert">
        无法生成规则预览：{selection.preview.error ??
          "未知错误"}。请确认工作副本状态正常后，点击“重新采集候选”重试。
      </div>
    {:else if selection.preview.state === "empty"}
      <div class="preview-empty">
        <span class="codicon codicon-inbox" aria-hidden="true"></span>
        <p>
          当前仓库没有可预览的候选文件。工作副本产生修改后，点击“重新采集候选”即可查看最新命中结果。
        </p>
      </div>
    {:else}
      <div class="selection-summary" role="status">
        <span
          ><span class="decision-badge decision-badge--recommended"
            >推荐提交</span
          >{previewSummary.recommended} 个</span
        >
        <span
          ><span class="decision-badge decision-badge--needsReview"
            >需要确认</span
          >{previewSummary.needsReview} 个</span
        >
        <span
          ><span class="decision-badge decision-badge--excluded">排除</span
          >{previewSummary.excluded} 个</span
        >
        <span
          ><span class="decision-badge decision-badge--blocked">阻止提交</span
          >{previewSummary.blocked} 个</span
        >
      </div>
      <ScrollArea class="selection-preview-list" label="提交选择规则预览结果">
        <div class="selection-preview-header" aria-hidden="true">
          <span>文件</span><span>SVN 状态</span><span>命中规则</span><span
            >规则来源</span
          ><span>最终决策</span>
        </div>
        {#each previewRows as row (row.relativePath)}
          <div class="selection-preview-row">
            <span class="selection-preview-path" title={row.relativePath}
              >{row.relativePath}</span
            >
            <span>{previewStatusText(row)}</span>
            <span
              title={commitSelectionReasonKeyLabels[row.evaluation.reasonKey]}
              >{hitRuleText(row)}</span
            >
            <span>{ruleSourceText(row)}</span>
            <span>
              <span
                class={`decision-badge decision-badge--${row.evaluation.decision}`}
                >{#if row.evaluation.safetyLocked}<span
                    class="codicon codicon-shield"
                    aria-hidden="true"
                  ></span>{/if}{commitSelectionDecisionLabels[
                  row.evaluation.decision
                ]}</span
              >
            </span>
          </div>
        {/each}
      </ScrollArea>
    {/if}
  </section>

  <section class="settings-card settings-card--wide selection-actions-card">
    {#if selection.feedback}
      <div class={`notice notice--${selection.feedback.tone}`} role="status">
        {selection.feedback.message}
      </div>
    {/if}
    {#if selection.saveErrors?.length}
      <div class="notice notice--error" role="alert">
        <span>保存被拒绝，请修正以下问题后重试：</span>
        <ul>
          {#each selection.saveErrors as error, errorIndex (errorIndex)}<li>
              {error}
            </li>{/each}
        </ul>
      </div>
    {/if}
    <div class="toolbar-actions">
      <button
        class="button button--primary"
        disabled={hasRowErrors}
        title={hasRowErrors
          ? "请先修正规则列表中的错误"
          : "将状态策略与路径规则写入当前仓库 .svn-workbench.json"}
        onclick={saveSelection}>保存当前仓库规则</button
      >
      <button
        class="button button--secondary"
        title="删除 .svn-workbench.json 中的 commitSelection 配置，恢复为用户/工作区配置与内置默认"
        onclick={() => onAction("settings/restore-selection-defaults")}
        >恢复当前仓库规则为默认值</button
      >
      <button
        class="button button--secondary"
        onclick={() => onAction("settings/open-selection-file")}
        >打开 .svn-workbench.json</button
      >
    </div>
    <p class="muted selection-save-hint">
      保存只更新规则配置，不会改动提交页当前已勾选的文件。
    </p>
  </section>
</div>
