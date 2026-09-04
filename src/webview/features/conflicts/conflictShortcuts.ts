/**
 * 冲突结果编辑快捷键（V012-E 建立，V017-B 收敛为集中 keymap 的兼容视图）。
 * - 唯一来源：`src/webview/keyboard/shortcuts.ts`（区域 `conflicts`）。
 *   本文件的 `CONFLICT_SHORTCUTS` / `CONFLICT_SHORTCUT_LIST` 仅是
 *   旧调用点（工具栏标题、模块帮助）的只读视图，禁止在此另写按键文案。
 * - 查找经 Editor keymap 绑定到内部命令 `openSearchPanel` 间接启用（Pierre 无程序化打开 API）。
 * - 替换（`openSearchReplacePanel`）已延期：输入框无 isComposing 保护 + 面板英文硬编码 UI + 只能 keymap 间接打开，不满足中文界面/IME 约束。
 * - 查找面板的英文 placeholder 为第三方库内部 UI，属已知限制，可接受但须如实说明。
 * - 编辑区 keydown 的 IME 守卫由适配层自实现。
 */

import type { EditorKeymap } from "@pierre/diffs/edit";
import {
  getShortcutsForRegion,
  type ShortcutDef,
} from "../../keyboard/shortcuts";
import { replaceDeferredNote } from "../../i18n/shortcutHelp";

interface ConflictShortcutView {
  readonly id: string;
  readonly label: string;
  readonly display: string;
  readonly title: string;
  readonly keys: readonly string[];
}

function toView(def: ShortcutDef): ConflictShortcutView {
  return {
    id: def.id,
    label: def.label,
    display: def.display,
    title: def.title,
    keys: def.keys,
  };
}

/** 快捷键定义（集中 keymap 的只读视图，按钮 title 与帮助面板共用） */
export const CONFLICT_SHORTCUTS = Object.fromEntries(
  getShortcutsForRegion("conflicts").map((def) => [def.id, toView(def)]),
) as {
  readonly saveCheckpoint: ConflictShortcutView;
  readonly prevBlock: ConflictShortcutView;
  readonly nextBlock: ConflictShortcutView;
  readonly undo: ConflictShortcutView;
  readonly redo: ConflictShortcutView;
  readonly find: ConflictShortcutView;
  readonly help: ConflictShortcutView;
};

export type ConflictShortcutId = keyof typeof CONFLICT_SHORTCUTS;

/** 列表形式，便于帮助面板遍历 */
export const CONFLICT_SHORTCUT_LIST: readonly ConflictShortcutView[] =
  Object.values(CONFLICT_SHORTCUTS);

/** 替换延期结论（须在界面或文档中如实说明） */
export const REPLACE_DEFERRED_NOTE = replaceDeferredNote;

/**
 * Pierre Editor 查找 keymap（V012-E）。
 * 通过 EditorOptions.keymap 注入 `openSearchPanel`，优雅降级：绑定失败不报错。
 * 仅交付查找，不交付 `openSearchReplacePanel`。
 */
export const CONFLICT_EDITOR_FIND_KEYMAP: EditorKeymap = [
  {
    bindings: {
      "cmdOrCtrl+f": "openSearchPanel",
    },
  },
] as EditorKeymap;

// 中文注释：V017-C 收敛——本地副本已合并到 `src/webview/keyboard/ime.ts`；
// 名称保留为兼容别名，调用方无需改动导入路径。
export { isImeComposing as isImeComposingEvent } from "../../keyboard/ime";
