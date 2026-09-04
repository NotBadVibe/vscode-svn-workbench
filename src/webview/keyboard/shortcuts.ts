/**
 * V017-B 上下文快捷帮助：集中 keymap 单一来源。
 *
 * - 以「区域 × 按键 × 条件」声明全部真实绑定，与 `useFileList`、
 *   `CommitMessageEditor`、Diff/Conflicts 工具区、`SearchInput`、
 *   预设名输入与意向单对话框的实际 `keydown` 处理对齐。
 * - 按钮 `title` 与帮助面板必须从此源生成（`title`/`display`），
 *   禁止在组件内另写硬编码快捷键文案。
 * - 平台归一：通用展示统一使用 `Ctrl/⌘`；macOS 上对应 `⌘`，
 *   其余平台对应 `Ctrl`。键盘事件判定一律接受 `ctrlKey || metaKey`，
 *   因此断言必须平台无关（不得断言 `navigator.platform`）。
 * - IME 例外：全部条目默认 `imeGuarded: true`，候选阶段
 *   （`isComposing || keyCode === 229`）不触发，文本输入上下文
 *   由各组件闸门放行原文（见 `listModel.shouldHandleListKeydown`）。
 */

export type ShortcutRegion =
  | "list"
  | "search"
  | "commitMessage"
  | "filterPreset"
  | "diff"
  | "conflicts"
  | "dialog";

export interface ShortcutDef {
  /** 稳定标识（区域内唯一）。 */
  readonly id: string;
  readonly region: ShortcutRegion;
  /** 中文名称。 */
  readonly label: string;
  /** 按键展示（平台归一，如 `Ctrl/⌘+S`、`Alt+↑`）。 */
  readonly display: string;
  /** 按钮 title / 帮助文案（由 label + display 生成，禁止另写）。 */
  readonly title: string;
  /** 归一化按键 token（用于一致性说明，非 DOM 绑定）。 */
  readonly keys: readonly string[];
  /** 紧凑提示条短语（仅进入提示条的条目填写）。 */
  readonly hintLabel?: string;
  /** 触发条件 / 语义差异说明。 */
  readonly note?: string;
  /** IME 候选阶段是否屏蔽（缺省 true，全部真实绑定均为 true）。 */
  readonly imeGuarded: boolean;
}

function define(def: ShortcutDef): ShortcutDef {
  return def;
}

const LIST_SHORTCUTS = [
  define({
    id: "move",
    region: "list",
    label: "移动活动行",
    display: "↑/↓",
    title: "移动活动行（↑/↓）",
    keys: ["ArrowUp", "ArrowDown"],
    imeGuarded: true,
  }),
  define({
    id: "page",
    region: "list",
    label: "分页导航",
    display: "PageUp/PageDown",
    title: "分页导航（PageUp/PageDown）",
    keys: ["PageUp", "PageDown"],
    note: "无活动行时保留原生区域滚动；有活动行时按一页可见行数移动",
    imeGuarded: true,
  }),
  define({
    id: "edge",
    region: "list",
    label: "跳到首行/末行",
    display: "Home/End",
    title: "跳到首行/末行（Home/End）",
    keys: ["Home", "End"],
    imeGuarded: true,
  }),
  define({
    id: "range",
    region: "list",
    label: "连续选择",
    display: "Shift+↑/↓/Home/End",
    title: "连续选择（Shift+↑/↓/Home/End）",
    keys: ["Shift+ArrowUp", "Shift+ArrowDown", "Shift+Home", "Shift+End"],
    note: "只加入调用方判定的可操作项",
    imeGuarded: true,
  }),
  define({
    id: "selectAll",
    region: "list",
    label: "全选当前筛选可操作项",
    display: "Ctrl/⌘+A",
    title: "全选当前筛选可操作项（Ctrl/⌘+A）",
    keys: ["Ctrl+A", "Cmd+A"],
    note: "幂等：连按不反向清空；搜索框、文本域与 IME 候选中不触发",
    imeGuarded: true,
  }),
  define({
    id: "toggle",
    region: "list",
    label: "切换选择",
    display: "Space",
    title: "切换选择（Space）",
    keys: ["Space"],
    hintLabel: "选择",
    imeGuarded: true,
  }),
  define({
    id: "menu",
    region: "list",
    label: "打开行菜单",
    display: "Shift+F10",
    title: "打开行菜单（Shift+F10）",
    keys: ["Shift+F10", "ContextMenu"],
    hintLabel: "更多",
    note: "无活动行时放行原生行为",
    imeGuarded: true,
  }),
  define({
    id: "activate",
    region: "list",
    label: "打开当前行",
    display: "Enter",
    title: "打开当前行（Enter）",
    keys: ["Enter"],
    hintLabel: "看差异",
    note: "IME 候选阶段不触发；目标由各模块决定（如查看差异）",
    imeGuarded: true,
  }),
  define({
    id: "closeDetail",
    region: "list",
    label: "关闭详情",
    display: "Esc",
    title: "关闭详情（Esc）",
    keys: ["Escape"],
    note: "先于空列表早退处理；关闭后焦点返回触发点，滚动位置不变",
    imeGuarded: true,
  }),
  define({
    id: "searchFocus",
    region: "list",
    label: "聚焦搜索",
    display: "/",
    title: "聚焦搜索（/）",
    keys: ["/"],
    hintLabel: "搜索",
    note: "仅有搜索框的列表；输入框与 IME 候选中不触发",
    imeGuarded: true,
  }),
  define({
    id: "help",
    region: "list",
    label: "快捷键帮助",
    display: "?",
    title: "快捷键帮助（?）",
    keys: ["?"],
    note: "只显示当前区域绑定",
    imeGuarded: true,
  }),
] as const;

const SEARCH_SHORTCUTS = [
  define({
    id: "clear",
    region: "search",
    label: "清除筛选",
    display: "Esc",
    title: "清除筛选（Esc）",
    keys: ["Escape"],
    note: "清空并保持焦点；IME 候选中先处理输入法，不清除",
    imeGuarded: true,
  }),
] as const;

const COMMIT_MESSAGE_SHORTCUTS = [
  define({
    id: "preview",
    region: "commitMessage",
    label: "生成提交预览",
    display: "Ctrl/⌘+Enter",
    title: "生成提交预览（Ctrl/⌘+Enter）",
    keys: ["Ctrl+Enter", "Cmd+Enter"],
    note: "IME 候选阶段不触发；普通 Enter 仅换行",
    imeGuarded: true,
  }),
] as const;

const FILTER_PRESET_SHORTCUTS = [
  define({
    id: "save",
    region: "filterPreset",
    label: "保存预设",
    display: "Enter",
    title: "保存预设（Enter）",
    keys: ["Enter"],
    note: "IME 候选阶段不触发",
    imeGuarded: true,
  }),
] as const;

const DIFF_SHORTCUTS = [
  define({
    id: "save",
    region: "diff",
    label: "保存到工作副本",
    display: "Ctrl/⌘+S",
    title: "保存到工作副本（Ctrl/⌘+S）",
    keys: ["Ctrl+S", "Cmd+S"],
    note: "仅编辑态；写入工作副本；IME 候选中不触发",
    imeGuarded: true,
  }),
  define({
    id: "prevHunk",
    region: "diff",
    label: "上一处差异",
    display: "Alt+↑",
    title: "上一处差异（Alt+↑）",
    keys: ["Alt+ArrowUp"],
    imeGuarded: true,
  }),
  define({
    id: "nextHunk",
    region: "diff",
    label: "下一处差异",
    display: "Alt+↓",
    title: "下一处差异（Alt+↓）",
    keys: ["Alt+ArrowDown"],
    imeGuarded: true,
  }),
  define({
    id: "closeSettings",
    region: "diff",
    label: "关闭显示设置",
    display: "Esc",
    title: "关闭显示设置（Esc）",
    keys: ["Escape"],
    note: "关闭浮层并返回触发按钮，不退出任务",
    imeGuarded: true,
  }),
  define({
    id: "help",
    region: "diff",
    label: "快捷键帮助",
    display: "?",
    title: "快捷键帮助（?）",
    keys: ["?"],
    note: "只显示当前区域绑定",
    imeGuarded: true,
  }),
] as const;

const CONFLICT_SHORTCUTS = [
  define({
    id: "saveCheckpoint",
    region: "conflicts",
    label: "保存检查点",
    display: "Ctrl/⌘+S",
    title: "保存检查点（Ctrl/⌘+S，不写入工作副本）",
    keys: ["Ctrl+S", "Cmd+S"],
    note: "仅保存 Host 检查点，不写入工作副本（与 Diff 语义不同）",
    imeGuarded: true,
  }),
  define({
    id: "prevBlock",
    region: "conflicts",
    label: "上一个块",
    display: "Alt+↑",
    title: "上一个块（Alt+↑）",
    keys: ["Alt+ArrowUp"],
    imeGuarded: true,
  }),
  define({
    id: "nextBlock",
    region: "conflicts",
    label: "下一个块",
    display: "Alt+↓",
    title: "下一个块（Alt+↓）",
    keys: ["Alt+ArrowDown"],
    imeGuarded: true,
  }),
  define({
    id: "undo",
    region: "conflicts",
    label: "撤销",
    display: "Ctrl/⌘+Z",
    title: "撤销（Ctrl/⌘+Z）",
    keys: ["Ctrl+Z", "Cmd+Z"],
    imeGuarded: true,
  }),
  define({
    id: "redo",
    region: "conflicts",
    label: "重做",
    display: "Ctrl/⌘+Shift+Z / Ctrl+Y",
    title: "重做（Ctrl/⌘+Shift+Z / Ctrl+Y）",
    keys: ["Ctrl+Shift+Z", "Cmd+Shift+Z", "Ctrl+Y"],
    imeGuarded: true,
  }),
  define({
    id: "find",
    region: "conflicts",
    label: "查找",
    display: "Ctrl/⌘+F",
    title: "查找（Ctrl/⌘+F）",
    keys: ["Ctrl+F", "Cmd+F"],
    note: "经编辑器 keymap 打开查找面板；替换已延期",
    imeGuarded: true,
  }),
  define({
    id: "help",
    region: "conflicts",
    label: "快捷键帮助",
    display: "?",
    title: "快捷键帮助（?）",
    keys: ["?"],
    note: "只显示当前区域绑定",
    imeGuarded: true,
  }),
] as const;

const DIALOG_SHORTCUTS = [
  define({
    id: "cancel",
    region: "dialog",
    label: "取消",
    display: "Esc",
    title: "取消（Esc）",
    keys: ["Escape"],
    note: "与取消按钮相同；IME 候选中先处理输入法",
    imeGuarded: true,
  }),
  define({
    id: "tabLoop",
    region: "dialog",
    label: "焦点循环",
    display: "Tab",
    title: "焦点循环（Tab）",
    keys: ["Tab", "Shift+Tab"],
    note: "首尾循环，不形成键盘陷阱",
    imeGuarded: true,
  }),
] as const;

/** 全部真实绑定（区域内顺序即帮助面板展示顺序）。 */
export const ALL_SHORTCUTS: readonly ShortcutDef[] = [
  ...LIST_SHORTCUTS,
  ...SEARCH_SHORTCUTS,
  ...COMMIT_MESSAGE_SHORTCUTS,
  ...FILTER_PRESET_SHORTCUTS,
  ...DIFF_SHORTCUTS,
  ...CONFLICT_SHORTCUTS,
  ...DIALOG_SHORTCUTS,
];

export const SHORTCUTS_BY_REGION: Record<ShortcutRegion, ShortcutDef[]> = {
  list: [...LIST_SHORTCUTS],
  search: [...SEARCH_SHORTCUTS],
  commitMessage: [...COMMIT_MESSAGE_SHORTCUTS],
  filterPreset: [...FILTER_PRESET_SHORTCUTS],
  diff: [...DIFF_SHORTCUTS],
  conflicts: [...CONFLICT_SHORTCUTS],
  dialog: [...DIALOG_SHORTCUTS],
};

export interface RegionShortcutOptions {
  /**
   * 列表聚焦搜索（`/`）仅在有搜索框的列表中是真实绑定；
   * 无搜索框的区域不得在帮助中出现该条目。
   */
  searchAvailable?: boolean;
}

/** 取某区域的帮助条目（只显示该区域绑定，不显示无关命令）。 */
export function getShortcutsForRegion(
  region: ShortcutRegion,
  options: RegionShortcutOptions = {},
): ShortcutDef[] {
  const all = SHORTCUTS_BY_REGION[region] ?? [];
  if (region === "list" && !options.searchAvailable) {
    return all.filter((def) => def.id !== "searchFocus");
  }
  return [...all];
}

/** 紧凑提示条的条目 ID（按区域实际绑定生成）。 */
const COMPACT_HINT_IDS: Record<ShortcutRegion, readonly string[]> = {
  list: ["toggle", "activate", "menu", "searchFocus"],
  search: ["clear"],
  commitMessage: ["preview"],
  filterPreset: ["save"],
  diff: ["prevHunk", "nextHunk", "save"],
  conflicts: ["prevBlock", "nextBlock", "saveCheckpoint", "find"],
  dialog: ["cancel"],
};

/** 紧凑提示条目（仅含带 `hintLabel` 或提示 ID 的真实绑定）。 */
export function getCompactHintItems(
  region: ShortcutRegion,
  options: RegionShortcutOptions = {},
): ShortcutDef[] {
  const ids = COMPACT_HINT_IDS[region] ?? [];
  const byId = new Map(
    getShortcutsForRegion(region, options).map((def) => [def.id, def]),
  );
  return ids.flatMap((id) => {
    const def = byId.get(id);
    return def ? [def] : [];
  });
}

/** 平台无关断言辅助：事件是否命中某条目的修饰键组合。 */
export function matchesModShortcut(
  event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "key">,
  key: string,
): boolean {
  return Boolean(event.ctrlKey || event.metaKey) && event.key === key;
}
