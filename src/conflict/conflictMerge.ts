export interface TextConflictBlock {
  index: number;
  start: number;
  end: number;
  mine: string;
  base?: string;
  theirs: string;
}

const conflictBlockPattern =
  /^<<<<<<<[^\r\n]*(?:\r?\n)([\s\S]*?)(?:^\|\|\|\|\|\|\|[^\r\n]*(?:\r?\n)([\s\S]*?))?^=======[^\r\n]*(?:\r?\n)([\s\S]*?)^>>>>>>>[^\r\n]*(?:\r?\n|$)/gm;

export function parseTextConflictBlocks(content: string): TextConflictBlock[] {
  return [...content.matchAll(conflictBlockPattern)].map((match, index) => ({
    index,
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    mine: match[1],
    base: match[2],
    theirs: match[3],
  }));
}

export function applyTextConflictResolution(
  content: string,
  blockIndex: number,
  resolution: "mine" | "theirs" | "both",
): string {
  const block = parseTextConflictBlocks(content)[blockIndex];
  if (!block) return content;
  const replacement =
    resolution === "mine"
      ? block.mine
      : resolution === "theirs"
        ? block.theirs
        : joinBoth(block.mine, block.theirs);
  return `${content.slice(0, block.start)}${replacement}${content.slice(block.end)}`;
}

function joinBoth(mine: string, theirs: string): string {
  if (!mine) return theirs;
  if (!theirs) return mine;
  return `${mine}${mine.endsWith("\n") || theirs.startsWith("\n") ? "" : "\n"}${theirs}`;
}
