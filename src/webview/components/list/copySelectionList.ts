import { fileStatusLabels } from "../../i18n/terminology";

/*
 * V023-R24：主要列表统一复制已选清单的共享纯逻辑。
 * - 只复制仓库内相对展示路径（projectRelativePath ?? relativePath），
 *   绝不复制 selectionKey（身份键）、本地绝对路径与仓库地址。
 * - 输出顺序与当前列表一致；隐藏选择（已选但不在当前列表）按
 *   relativePath 排序稳定追加，并在调用方按钮/反馈中明示数量。
 * - 同名跨项目可辨识：同一展示路径出现在多个归属时，加项目/仓库前缀。
 */

export interface CopyableListFile {
  relativePath: string;
  projectRelativePath?: string;
  projectName?: string;
  repositoryName?: string;
  status?: string;
}

function displayOf(file: CopyableListFile): string {
  return file.projectRelativePath ?? file.relativePath;
}

function ownerOf(file: CopyableListFile): string {
  return file.projectName ?? file.repositoryName ?? "";
}

/** 同一展示路径多归属时加前缀，保证中文/空格/#/同名跨项目可辨识。 */
export function copyPathOf(
  file: CopyableListFile,
  duplicateDisplays: ReadonlySet<string>,
): string {
  const display = displayOf(file);
  if (!duplicateDisplays.has(display)) return display;
  const owner = ownerOf(file);
  return owner ? `${owner}/${display}` : display;
}

function duplicateDisplaySet(files: readonly CopyableListFile[]): Set<string> {
  const owners = new Map<string, Set<string>>();
  for (const file of files) {
    const display = displayOf(file);
    let set = owners.get(display);
    if (!set) {
      set = new Set();
      owners.set(display, set);
    }
    set.add(`${ownerOf(file)}::${file.relativePath}`);
  }
  const duplicates = new Set<string>();
  for (const [display, set] of owners) {
    if (set.size > 1) duplicates.add(display);
  }
  return duplicates;
}

/**
 * 按当前列表顺序排列已选：可见已选保持列表顺序；
 * 隐藏已选（不在当前列表）按 relativePath 排序稳定追加。
 * selectedPaths 为仓库内相对路径集合（relativePath），不含身份键。
 */
export function orderSelectedForCopy(
  listInCurrentOrder: readonly CopyableListFile[],
  allFilesInStableOrder: readonly CopyableListFile[],
  selectedPaths: ReadonlySet<string> | readonly string[],
): CopyableListFile[] {
  const selected = new Set(selectedPaths);
  const ordered: CopyableListFile[] = [];
  const seen = new Set<string>();
  for (const file of listInCurrentOrder) {
    if (selected.has(file.relativePath) && !seen.has(file.relativePath)) {
      ordered.push(file);
      seen.add(file.relativePath);
    }
  }
  const hidden = allFilesInStableOrder
    .filter(
      (file) => selected.has(file.relativePath) && !seen.has(file.relativePath),
    )
    .sort((left, right) =>
      left.relativePath < right.relativePath
        ? -1
        : left.relativePath > right.relativePath
          ? 1
          : 0,
    );
  for (const file of hidden) {
    if (!seen.has(file.relativePath)) {
      ordered.push(file);
      seen.add(file.relativePath);
    }
  }
  return ordered;
}

/** 复制已选相对路径清单（一行一个，不含身份键/绝对路径/仓库地址）。 */
export function buildPathListText(
  orderedSelected: readonly CopyableListFile[],
): string {
  const duplicates = duplicateDisplaySet(orderedSelected);
  return orderedSelected.map((file) => copyPathOf(file, duplicates)).join("\n");
}

/** 复制状态+路径清单（状态为中文标签，一行一个）。 */
export function buildStatusPathListText(
  orderedSelected: readonly CopyableListFile[],
): string {
  const duplicates = duplicateDisplaySet(orderedSelected);
  return orderedSelected
    .map((file) => {
      const status = file.status ?? "";
      const label =
        (fileStatusLabels as Record<string, string>)[status] ?? status;
      return `${label} ${copyPathOf(file, duplicates)}`;
    })
    .join("\n");
}
