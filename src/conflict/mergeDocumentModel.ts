/**
 * v0.1.2 V012-A 合并文档模型（纯函数，不读 DOM、不依赖 VS Code、不改协议）。
 *
 * 职责（对照 docs/releases/v0.1.2/README.md §3.1）：
 * - 单一文本主权：draftContents 是唯一编辑结果，authoritativeContents 只来自 Host 确认；
 * - draftRevision 单调递增：每次编辑/动作产生新 revision；旧 revision 重放或乱序到达 fail-closed 拒绝；
 * - conflictRegions 绑定内容 hash 的稳定 identity；tracked 区间随编辑逐次漂移重映射，
 *   结构被破坏或被删除时明确失效，绝不跨文本变化盲用旧行号；
 * - 程序化动作先解析 region，再生成最小 TextEdit[]；应用前复核预期旧文本（块级，呼应 VS Code Issue #159189）；
 * - 所有文本操作保留 BOM/EOL/末尾换行语义（纯字符串切片 + 文末换行保留规则，不做行数组规范化）；
 * - both 两种顺序对称实现：mine-first=先我的后对方（沿用 git 冲突标记 mine 段在前的语义），
 *   theirs-first=先对方后我的（对称拼接，非字符串反转）；
 * - 提供“当前块已手工修改”判定（不盲目再次采用）与“恢复当前冲突块到打开时状态”；
 * - editorState 仅界面状态，不参与 SVN 写入身份。
 *
 * 复用 conflictDiffModel 的 parseConflictRegions / buildConflictFileIdentity / hashText 与品牌类型；
 * 不降低现有 scope/hash/identity 契约。
 */
import {
  buildConflictFileIdentity,
  hashText,
  parseConflictRegions,
  type ConflictFileIdentity,
  type ConflictRegion,
  type ConflictRegionIdentity,
  type ContentHash,
} from "./conflictDiffModel";

/* ============================== 基础类型 ============================== */

/** both 顺序：mine-first=先我的后对方（沿用 git 冲突标记 mine 段在前的语义）；theirs-first=先对方后我的 */
export type BothOrder = "mine-first" | "theirs-first";

/** 程序化合并动作语义 */
export type MergeAction =
  "take-mine" | "take-theirs" | "take-both" | "restore-original";

export interface TextEdit {
  /** 左闭右开的 UTF-16 偏移区间 */
  start: number;
  end: number;
  newText: string;
}

/** 编辑态 region：start/end 为当前 draft 内的偏移（解析视图，供 UI/动作消费） */
export interface MergeDocumentRegion extends ConflictRegion {
  /** 与打开时对应块的 identity；打开时不存在（全新块）则为 undefined */
  baseIdentity: ConflictRegionIdentity | undefined;
}

/**
 * 跟踪态 region：位置主权。区间随每次编辑/动作按偏移增量漂移；
 * manuallyModified=区间被编辑触及或内容与打开时不一致；
 * resolved=已被程序化动作采用；invalidated=marker 结构被破坏或块被整体删除。
 */
export interface TrackedConflictRegion {
  baseIdentity: ConflictRegionIdentity;
  start: number;
  end: number;
  manuallyModified: boolean;
  resolved: boolean;
  invalidated: boolean;
}

/** 打开时捕获的原始 region 快照 */
export interface MergeRegionSnapshot {
  baseIdentity: ConflictRegionIdentity;
  /** 打开时含 marker 的整块原文（预期旧文本复核基准） */
  anchorText: string;
  mine: string;
  base?: string;
  theirs: string;
  /** 打开时内容相同的块数量（重复块共享同一 identity 与快照） */
  duplicateCount: number;
}

/** 编辑上下文状态：当前块、selection、视口；仅界面状态，不参与 SVN 写入身份 */
export interface MergeEditorState {
  activeRegionBaseIdentity: ConflictRegionIdentity | undefined;
  selection: { start: number; end: number };
  viewport: { top: number; left: number };
}

/** 合并文档状态（纯数据；Host/Webview 均可持有） */
export interface MergeDocumentState {
  /** Host 最近一次确认的工作副本内容 */
  authoritativeContents: string;
  /** 当前编辑结果（单一文本主权） */
  draftContents: string;
  /** 每次编辑/动作单调递增 */
  draftRevision: number;
  baseContentHash: ContentHash;
  workingContentHash: ContentHash;
  draftContentHash: ContentHash;
  scopeHash: string;
  workingCopyRevision: string;
  fileIdentity: ConflictFileIdentity;
  /** 当前草稿的解析视图（供 UI 渲染）；marker 损坏时为空数组 */
  regions: MergeDocumentRegion[];
  /** 位置跟踪（动作/恢复主权；跨文本变化漂移重映射） */
  tracked: TrackedConflictRegion[];
  /** 打开时 region 快照（key=baseIdentity），用于恢复与手工修改判定 */
  originalRegions: Record<string, MergeRegionSnapshot>;
  editorState: MergeEditorState;
}

/* ============================== 拒绝原因（结构化，fail-closed） ============================== */

export type MergeModelRejectionCode =
  | "stale-revision"
  | "stale-identity"
  | "parse-error"
  | "region-not-found"
  | "region-invalidated"
  | "region-manually-modified"
  | "expected-content-mismatch"
  | "anchor-not-unique"
  | "invalid-action";

export interface MergeModelRejection {
  ok: false;
  code: MergeModelRejectionCode;
  message: string;
}

export interface MergeDocumentSuccess {
  ok: true;
  state: MergeDocumentState;
  /** 本次动作实际应用的最小编辑集（相对旧草稿） */
  edits: TextEdit[];
  /** 动作作用的目标 region（当前草稿内的解析结果） */
  region?: MergeDocumentRegion;
}

export type MergeDocumentResult = MergeDocumentSuccess | MergeModelRejection;

export interface RegionRemapSuccess {
  ok: true;
  state: MergeDocumentState;
  /** 按 baseIdentity 重映射后的 region 映射：baseIdentity -> 新 region（undefined=已失效/已解决） */
  mapping: Record<string, MergeDocumentRegion | undefined>;
}

export type RegionRemapResult = RegionRemapSuccess | MergeModelRejection;

/* ============================== 状态创建 ============================== */

export interface CreateMergeDocumentInput {
  repositoryRoot: string;
  relativePath: string;
  /** Host 确认的工作副本内容（打开时的冲突文本） */
  authoritativeContents: string;
  /** Host 确认的 BASE 内容（用于 baseContentHash；可为空串） */
  baseContents: string;
  scopeHash: string;
  workingCopyRevision: string;
  /** 可选：恢复既有草稿（必须仍与当前 scope/revision 匹配，由调用方保证） */
  existingDraftContents?: string;
  existingDraftRevision?: number;
}

export function createMergeDocument(
  input: CreateMergeDocumentInput,
): MergeDocumentResult {
  const fileIdentity = buildConflictFileIdentity(
    input.repositoryRoot,
    input.relativePath,
  );
  const draftContents =
    input.existingDraftContents ?? input.authoritativeContents;
  const draftRevision = input.existingDraftRevision ?? 0;
  const parsed = parseConflictRegions(draftContents);
  if (parsed.error) {
    return {
      ok: false,
      code: "parse-error",
      message: `打开合并文档失败：${parsed.error.message}（第 ${parsed.error.line + 1} 行）`,
    };
  }
  const originalParsed = parseConflictRegions(input.authoritativeContents);
  const originalRegions: Record<string, MergeRegionSnapshot> = {};
  if (!originalParsed.error) {
    for (const region of originalParsed.regions) {
      const anchorText = input.authoritativeContents.slice(
        region.start,
        region.end,
      );
      /* 内容 hash 相同的块共享同一 identity；重复块登记计数 */
      const existing = originalRegions[region.identity];
      originalRegions[region.identity] = {
        baseIdentity: region.identity,
        anchorText,
        mine: region.mine,
        base: region.base,
        theirs: region.theirs,
        duplicateCount: (existing?.duplicateCount ?? 0) + 1,
      };
    }
  }
  const isRestoredDraft = input.existingDraftContents !== undefined;
  const tracked: TrackedConflictRegion[] = parsed.regions.map((region) => {
    const known = originalRegions[region.identity] !== undefined;
    return {
      baseIdentity: region.identity,
      start: region.start,
      end: region.end,
      /* 恢复既有草稿时，与打开时不一致的块标记为已手工修改 */
      manuallyModified: isRestoredDraft && !known,
      resolved: false,
      invalidated: false,
    };
  });
  const regions = buildRegionsView(draftContents, tracked, originalRegions);
  return {
    ok: true,
    state: {
      authoritativeContents: input.authoritativeContents,
      draftContents,
      draftRevision,
      baseContentHash: hashText(input.baseContents),
      workingContentHash: hashText(input.authoritativeContents),
      draftContentHash: hashText(draftContents),
      scopeHash: input.scopeHash,
      workingCopyRevision: input.workingCopyRevision,
      fileIdentity,
      regions,
      tracked,
      originalRegions,
      editorState: {
        activeRegionBaseIdentity: regions[0]?.baseIdentity,
        selection: { start: 0, end: 0 },
        viewport: { top: 0, left: 0 },
      },
    },
    edits: [],
  };
}

/* ============================== 内部工具 ============================== */

function reject(
  code: MergeModelRejectionCode,
  message: string,
): MergeModelRejection {
  return { ok: false, code, message };
}

/** 校验 Host 确认身份（scope/revision/authoritative 任一不匹配即拒绝，fail-closed） */
function checkIdentity(
  state: MergeDocumentState,
  expected: {
    scopeHash: string;
    workingCopyRevision: string;
    expectedAuthoritativeContents: string;
  },
): MergeModelRejection | undefined {
  if (expected.scopeHash !== state.scopeHash) {
    return reject(
      "stale-identity",
      "操作范围已变化（scopeHash 不匹配），旧编辑身份已失效",
    );
  }
  if (expected.workingCopyRevision !== state.workingCopyRevision) {
    return reject(
      "stale-identity",
      "工作副本 revision 已变化，旧编辑身份已失效",
    );
  }
  if (expected.expectedAuthoritativeContents !== state.authoritativeContents) {
    return reject(
      "stale-identity",
      "Host 确认的工作副本内容已变化，旧编辑身份已失效",
    );
  }
  return undefined;
}

/** 应用最小 TextEdit 集（按 start 降序逐个替换，纯字符串切片，保留 BOM/EOL/末尾换行） */
export function applyTextEdits(text: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let next = text;
  for (const edit of sorted) {
    next = next.slice(0, edit.start) + edit.newText + next.slice(edit.end);
  }
  return next;
}

/**
 * 应用前预期旧文本复核（供 Host/Editor 在异步应用 TextEdit 前做块级双检，
 * 呼应 VS Code Issue #159189）：目标区间的当前文本必须与计算编辑时的预期旧文本逐字节一致。
 */
export function verifyExpectedContent(
  documentText: string,
  edit: TextEdit,
  expectedOldText: string,
): boolean {
  return documentText.slice(edit.start, edit.end) === expectedOldText;
}

/**
 * 末尾换行保留：region 位于文末且原文本无末尾换行时，
 * 去掉替换文本末尾多余的一个换行（\r\n 或 \n），不引入新的末尾换行。
 */
function preserveFinalNewlineSemantics(
  documentText: string,
  editStart: number,
  editEnd: number,
  replacement: string,
): string {
  if (editEnd !== documentText.length) return replacement;
  if (documentText.endsWith("\n")) return replacement;
  if (replacement.endsWith("\r\n")) return replacement.slice(0, -2);
  if (replacement.endsWith("\n")) return replacement.slice(0, -1);
  return replacement;
}

/** 中文注释：简单单条缓存的解析结果，避免同一文本在单次编辑中被重复解析 100 次（100 块 O(n²) 场景） */
let cachedParseText: string | undefined;
let cachedParseResult: ReturnType<typeof parseConflictRegions> | undefined;
function cachedParseConflictRegions(
  text: string,
): ReturnType<typeof parseConflictRegions> {
  if (cachedParseText === text && cachedParseResult !== undefined) {
    return cachedParseResult;
  }
  const result = parseConflictRegions(text);
  cachedParseText = text;
  cachedParseResult = result;
  return result;
}

/** 编辑后 tracked 区间漂移重映射：编辑触及区间即标记手工修改；整体覆盖且不再是合法块则失效 */
function updateTrackedForEdit(
  tracked: TrackedConflictRegion[],
  edit: TextEdit,
): TrackedConflictRegion[] {
  const delta = edit.newText.length - (edit.end - edit.start);
  // 中文注释：对 edit.newText 的解析结果只算一次，消除 100 块时的 100 次重复全量解析
  let parsedOnce: ReturnType<typeof parseConflictRegions> | undefined;
  let parsedOnceChecked = false;
  let parsedOnceIsSingleBlock = false;
  function isSingleBlock(): boolean {
    if (!parsedOnceChecked) {
      parsedOnceChecked = true;
      parsedOnce = cachedParseConflictRegions(edit.newText);
      const only =
        parsedOnce.regions.length === 1 ? parsedOnce.regions[0] : undefined;
      parsedOnceIsSingleBlock =
        !parsedOnce.error &&
        !!only &&
        only.start === 0 &&
        only.end === edit.newText.length;
    }
    return parsedOnceIsSingleBlock;
  }
  return tracked.map((entry) => {
    if (edit.end <= entry.start) {
      return { ...entry, start: entry.start + delta, end: entry.end + delta };
    }
    if (edit.start >= entry.end) {
      return entry;
    }
    /* 重叠：区间扩展为并集 */
    const coversAll = edit.start <= entry.start && edit.end >= entry.end;
    const next: TrackedConflictRegion = {
      ...entry,
      start: Math.min(entry.start, edit.start),
      end: Math.max(entry.end, edit.end) + delta,
      manuallyModified: true,
    };
    if (coversAll && !entry.resolved) {
      /* 整块被替换：替换内容必须仍恰好是一个完整冲突块，否则结构失效 */
      if (!isSingleBlock()) {
        next.invalidated = true;
      }
    }
    return next;
  });
}

/** 由解析结果 + tracked 位置构建 UI 视图；marker 损坏时返回空数组（regions 明确失效） */
function buildRegionsView(
  draftContents: string,
  tracked: TrackedConflictRegion[],
  originalRegions: Record<string, MergeRegionSnapshot>,
): MergeDocumentRegion[] {
  const parsed = cachedParseConflictRegions(draftContents);
  if (parsed.error) return [];
  // 中文注释：建 baseIdentity→tracked 的索引，消除 regions.map × tracked.find 的 O(n²)
  const trackedMap = new Map<string, TrackedConflictRegion>();
  for (const candidate of tracked) {
    if (candidate.invalidated || candidate.resolved) continue;
    const key = `${candidate.start}:${candidate.end}`;
    if (!trackedMap.has(key)) trackedMap.set(key, candidate);
  }
  return parsed.regions.map((region) => {
    const entry = trackedMap.get(`${region.start}:${region.end}`);
    const known = originalRegions[region.identity] !== undefined;
    return {
      ...region,
      baseIdentity:
        entry?.baseIdentity ?? (known ? region.identity : undefined),
    };
  });
}

/**
 * 定位目标 region：优先从全局解析视图按 tracked 区间命中；
 * 全局解析失败（用户编辑破坏了别处 marker）时退化为对 tracked 区间切片独立解析。
 */
function locateRegion(
  state: MergeDocumentState,
  entry: TrackedConflictRegion,
): MergeDocumentRegion | undefined {
  const viewHit = state.regions.find(
    (region) => region.start === entry.start && region.end === entry.end,
  );
  if (viewHit) return viewHit;
  const slice = state.draftContents.slice(entry.start, entry.end);
  const parsed = parseConflictRegions(slice);
  const only = parsed.regions.length === 1 ? parsed.regions[0] : undefined;
  if (parsed.error || !only || only.start !== 0 || only.end !== slice.length) {
    return undefined;
  }
  return {
    ...only,
    start: entry.start,
    end: entry.end,
    startLine: -1,
    endLine: -1,
    baseIdentity: entry.baseIdentity,
  };
}

/** 查找可动作的跟踪块（未解决、未失效） */
function findActionableEntry(
  state: MergeDocumentState,
  baseIdentity: ConflictRegionIdentity,
): TrackedConflictRegion | undefined {
  return state.tracked.find(
    (entry) =>
      entry.baseIdentity === baseIdentity &&
      !entry.resolved &&
      !entry.invalidated,
  );
}

/** 判定当前块是否已被手工修改（两侧内容与打开时不一致或区间被编辑触及），供“不盲目再次采用”提示 */
export function isRegionManuallyModified(
  state: MergeDocumentState,
  baseIdentity: ConflictRegionIdentity,
): boolean {
  const entry = state.tracked.find(
    (candidate) => candidate.baseIdentity === baseIdentity,
  );
  if (!entry) return false;
  if (entry.invalidated) return true;
  if (entry.manuallyModified) return true;
  if (entry.resolved) return false;
  /* 防御：未被编辑触及但内容与打开时不一致（理论上不应发生）也按手工修改处理 */
  const snapshot = state.originalRegions[baseIdentity];
  if (!snapshot) return false;
  return (
    state.draftContents.slice(entry.start, entry.end) !== snapshot.anchorText
  );
}

/* ============================== 漂移重映射 ============================== */

/**
 * region 漂移重映射：复核基准文本后按 baseIdentity 重新定位当前草稿中的 region，
 * 已解决/已失效的 region 明确映射为 undefined，绝不按旧行号写入。
 */
export function remapRegionsAfterEdit(
  state: MergeDocumentState,
  expectedDraftContents: string,
): RegionRemapResult {
  if (expectedDraftContents !== state.draftContents) {
    return reject(
      "expected-content-mismatch",
      "重映射基准文本与当前草稿不一致，拒绝基于过期文本重映射",
    );
  }
  const mapping: Record<string, MergeDocumentRegion | undefined> = {};
  for (const baseIdentity of Object.keys(state.originalRegions)) {
    const entry = findActionableEntry(
      state,
      baseIdentity as ConflictRegionIdentity,
    );
    mapping[baseIdentity] = entry ? locateRegion(state, entry) : undefined;
  }
  return { ok: true, state, mapping };
}

/* ============================== 手工编辑 ============================== */

export interface ApplyMergeEditOptions {
  /** 调用方认定的前置 revision；与当前不一致则拒绝（防乱序/重放） */
  expectedRevision: number;
  edit: TextEdit;
}

/**
 * 手工编辑：应用任意范围 TextEdit 并推进 draftRevision。
 * 乱序/旧 revision fail-closed；编辑后 tracked 区间漂移重映射或明确失效；
 * 允许产生暂时损坏的 marker（用户有权任意编辑），此时 regions 视图为空、
 * 被触及的块标记失效，后续程序化动作按结构化原因拒绝。
 */
export function applyMergeEdit(
  state: MergeDocumentState,
  options: ApplyMergeEditOptions,
): MergeDocumentResult {
  if (options.expectedRevision !== state.draftRevision) {
    return reject(
      "stale-revision",
      `期望 revision ${options.expectedRevision} 与当前 ${state.draftRevision} 不一致，拒绝乱序/旧 revision 重放`,
    );
  }
  const { start, end } = options.edit;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > state.draftContents.length
  ) {
    return reject("invalid-action", "编辑区间越界或非法");
  }
  const nextContents = applyTextEdits(state.draftContents, [options.edit]);
  let nextTracked = updateTrackedForEdit(state.tracked, options.edit);
  // 若编辑后区间内容恰好恢复为打开时原文，则清除手工标记（避免后续 restore 误判）
  nextTracked = nextTracked.map((candidate) => {
    const snapshot = state.originalRegions[candidate.baseIdentity];
    if (!snapshot || candidate.invalidated) return candidate;
    const slice = nextContents.slice(candidate.start, candidate.end);
    if (slice === snapshot.anchorText && candidate.manuallyModified) {
      return { ...candidate, manuallyModified: false };
    }
    return candidate;
  });
  return {
    ok: true,
    state: {
      ...state,
      draftContents: nextContents,
      draftRevision: state.draftRevision + 1,
      draftContentHash: hashText(nextContents),
      tracked: nextTracked,
      regions: buildRegionsView(
        nextContents,
        nextTracked,
        state.originalRegions,
      ),
    },
    edits: [options.edit],
  };
}

/* ============================== 程序化动作（先解析 region，再生成最小 TextEdit，应用前复核） ============================== */

export interface ApplyMergeActionOptions {
  expectedRevision: number;
  action: MergeAction;
  /** 目标 region（打开时 identity）；undefined 表示使用 editorState 当前块 */
  regionBaseIdentity?: ConflictRegionIdentity;
  /** both 顺序；仅 action=take-both 时有效，缺省 mine-first */
  order?: BothOrder;
  /** 手工改写后是否仍强制采用；缺省 false（fail-closed 拒绝） */
  allowManuallyModified?: boolean;
  /** Host 身份复核：scope/revision/authoritative 必须仍匹配 */
  expected: {
    scopeHash: string;
    workingCopyRevision: string;
    expectedAuthoritativeContents: string;
  };
}

/** 计算 both 结果文本：保留两侧原始 EOL 语义；相邻边界无换行时补一个 \n */
function joinBoth(first: string, second: string): string {
  if (!first) return second;
  if (!second) return first;
  const needsNewline = !first.endsWith("\n") && !second.startsWith("\n");
  return needsNewline ? `${first}\n${second}` : `${first}${second}`;
}

/**
 * 程序化动作统一入口：
 * 1) 复核 Host 身份与 revision（fail-closed）；
 * 2) 先解析 region（按 tracked 区间漂移定位，拒绝旧行号）；
 * 3) 生成最小 TextEdit[]（仅覆盖 region 区间）；
 * 4) 应用前复核预期旧文本（块级切片必须与计算编辑时的基准逐字节一致）。
 */
export function applyMergeAction(
  state: MergeDocumentState,
  options: ApplyMergeActionOptions,
): MergeDocumentResult {
  const identityError = checkIdentity(state, options.expected);
  if (identityError) return identityError;
  if (options.expectedRevision !== state.draftRevision) {
    return reject(
      "stale-revision",
      `期望 revision ${options.expectedRevision} 与当前 ${state.draftRevision} 不一致，拒绝乱序/旧 revision 重放`,
    );
  }

  const targetBaseIdentity =
    options.regionBaseIdentity ?? state.editorState.activeRegionBaseIdentity;
  if (!targetBaseIdentity) {
    return reject("region-not-found", "未指定目标冲突块且无当前块");
  }
  const snapshot = state.originalRegions[targetBaseIdentity];
  if (!snapshot) {
    return reject(
      "region-not-found",
      "目标块在打开时的快照中不存在，拒绝基于未知块动作",
    );
  }

  /* 恢复动作：按 tracked 区间把当前内容换回打开时原文 */
  if (options.action === "restore-original") {
    /* 打开时存在内容相同的多个块：tracked 区间无法区分目标，锚点天然不唯一，拒绝盲目恢复 */
    if (snapshot.duplicateCount > 1) {
      return reject(
        "anchor-not-unique",
        "打开时存在内容相同的多个冲突块，锚点天然不唯一，拒绝盲目恢复",
      );
    }
    const entry = state.tracked.find(
      (candidate) =>
        candidate.baseIdentity === targetBaseIdentity && !candidate.invalidated,
    );
    if (!entry) {
      return reject(
        "region-invalidated",
        "目标块结构已被破坏或整体删除，无法安全恢复到打开时状态",
      );
    }
    const expectedOldText = state.draftContents.slice(entry.start, entry.end);
    const newText = preserveFinalNewlineSemantics(
      state.draftContents,
      entry.start,
      entry.end,
      snapshot.anchorText,
    );
    const edit: TextEdit = { start: entry.start, end: entry.end, newText };
    /* 应用前复核预期旧文本（块级） */
    if (!verifyExpectedContent(state.draftContents, edit, expectedOldText)) {
      return reject(
        "expected-content-mismatch",
        "应用前复核失败：目标区间文本与预期不一致，拒绝恢复",
      );
    }
    const nextContents = applyTextEdits(state.draftContents, [edit]);
    // 恢复后必须清除手工标记；updateTrackedForEdit 已克隆对象，引用比较不可靠，按 baseIdentity 匹配
    const nextTracked = updateTrackedForEdit(state.tracked, edit).map(
      (candidate) =>
        candidate.baseIdentity === entry.baseIdentity
          ? {
              ...candidate,
              start: edit.start,
              end: edit.start + newText.length,
              manuallyModified: false,
              resolved: false,
              invalidated: false,
            }
          : candidate,
    );
    const nextState: MergeDocumentState = {
      ...state,
      draftContents: nextContents,
      draftRevision: state.draftRevision + 1,
      draftContentHash: hashText(nextContents),
      tracked: nextTracked,
      regions: buildRegionsView(
        nextContents,
        nextTracked,
        state.originalRegions,
      ),
    };
    const region = locateRegion(nextState, {
      ...entry,
      end: edit.start + newText.length,
    });
    return { ok: true, state: nextState, edits: [edit], region };
  }

  /* 采用类动作：先定位跟踪块 */
  const entry = findActionableEntry(state, targetBaseIdentity);
  if (!entry) {
    const known = state.tracked.some(
      (candidate) => candidate.baseIdentity === targetBaseIdentity,
    );
    return reject(
      "region-invalidated",
      known
        ? "目标冲突块已解决或结构已失效，拒绝按旧行号写入"
        : "目标冲突块在当前草稿中不存在，拒绝按旧行号写入",
    );
  }

  /* 手工修改判定：不盲目再次采用 */
  if (entry.manuallyModified && !options.allowManuallyModified) {
    return reject(
      "region-manually-modified",
      "当前块已手工修改，不盲目再次采用；请先预览或恢复到打开时状态",
    );
  }

  /* 先解析 region，取得两侧内容 */
  const region = locateRegion(state, entry);
  if (!region) {
    return reject(
      "region-invalidated",
      "目标冲突块结构已失效，无法解析两侧内容，拒绝写入",
    );
  }

  let replacement: string;
  if (options.action === "take-mine") replacement = region.mine;
  else if (options.action === "take-theirs") replacement = region.theirs;
  else if (options.action === "take-both") {
    const order = options.order ?? "mine-first";
    replacement =
      order === "mine-first"
        ? joinBoth(region.mine, region.theirs)
        : joinBoth(region.theirs, region.mine);
  } else {
    return reject("invalid-action", `不支持的程序化动作：${options.action}`);
  }

  replacement = preserveFinalNewlineSemantics(
    state.draftContents,
    entry.start,
    entry.end,
    replacement,
  );

  /* 应用前复核预期旧文本（块级，呼应 VS Code Issue #159189） */
  const expectedOldText = state.draftContents.slice(entry.start, entry.end);
  const edit: TextEdit = {
    start: entry.start,
    end: entry.end,
    newText: replacement,
  };
  if (!verifyExpectedContent(state.draftContents, edit, expectedOldText)) {
    return reject(
      "expected-content-mismatch",
      "应用前复核失败：目标区间文本与预期不一致，拒绝写入",
    );
  }

  const nextContents = applyTextEdits(state.draftContents, [edit]);
  const nextTracked = updateTrackedForEdit(state.tracked, edit).map(
    (candidate) =>
      candidate.baseIdentity === entry.baseIdentity &&
      candidate.start === edit.start
        ? {
            ...candidate,
            start: edit.start,
            end: edit.start + replacement.length,
            manuallyModified: false,
            resolved: true,
            invalidated: false,
          }
        : candidate,
  );
  return {
    ok: true,
    state: {
      ...state,
      draftContents: nextContents,
      draftRevision: state.draftRevision + 1,
      draftContentHash: hashText(nextContents),
      tracked: nextTracked,
      regions: buildRegionsView(
        nextContents,
        nextTracked,
        state.originalRegions,
      ),
    },
    edits: [edit],
    region,
  };
}

/* ============================== Host 回执接管 ============================== */

export interface AuthoritativeAck {
  scopeHash: string;
  workingCopyRevision: string;
  /** Host 接管的 draft revision（只能等于当前，不得覆盖后续输入） */
  acceptedDraftRevision: number;
  /** Host 最新确认的工作副本内容（通常等于被接管的草稿） */
  authoritativeContents: string;
  baseContents: string;
}

/**
 * Host 回执：只接管匹配的 draft revision；旧回执不得覆盖后续输入（fail-closed）。
 * Webview 不能自行宣布草稿已保存，只能等 Host 回执更新 authoritativeContents。
 */
export function acceptAuthoritativeAck(
  state: MergeDocumentState,
  ack: AuthoritativeAck,
): MergeDocumentResult {
  if (ack.scopeHash !== state.scopeHash) {
    return reject("stale-identity", "回执 scopeHash 不匹配，拒绝接管");
  }
  if (ack.workingCopyRevision !== state.workingCopyRevision) {
    return reject(
      "stale-identity",
      "回执 workingCopyRevision 不匹配，拒绝接管",
    );
  }
  if (ack.acceptedDraftRevision !== state.draftRevision) {
    return reject(
      "stale-revision",
      `回执 revision ${ack.acceptedDraftRevision} 与当前 ${state.draftRevision} 不一致，旧回执不得覆盖后续输入`,
    );
  }
  if (ack.authoritativeContents !== state.draftContents) {
    return reject(
      "expected-content-mismatch",
      "回执内容与当前草稿不一致，拒绝接管",
    );
  }
  return {
    ok: true,
    state: {
      ...state,
      authoritativeContents: ack.authoritativeContents,
      workingContentHash: hashText(ack.authoritativeContents),
      baseContentHash: hashText(ack.baseContents),
    },
    edits: [],
  };
}

/* ============================== editorState（仅界面状态） ============================== */

/** 更新界面状态：只改 editorState，不推进 draftRevision，不参与写入身份 */
export function updateEditorState(
  state: MergeDocumentState,
  editorState: Partial<MergeEditorState>,
): MergeDocumentState {
  return {
    ...state,
    editorState: { ...state.editorState, ...editorState },
  };
}
