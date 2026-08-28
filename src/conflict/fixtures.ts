/**
 * v0.1.1 冲突 marker 固定 fixture 集（确定性，供领域模型与单测复用）。
 * 覆盖：SVN 含 BASE、Git 无 BASE、CRLF、无 BASE、多块、超长行、损坏。
 */

export const SVN_SINGLE = [
  'import { SvnCommandRunner } from "../svn/runner";',
  "export class OrderService {",
  "  submit(order: string) {",
  "<<<<<<< .mine",
  '    const mineValue = "我的修改-本地";',
  "    console.log(mineValue);",
  "||||||| .r127",
  '    const baseValue = "共同基线";',
  "    console.log(baseValue);",
  "=======",
  '    const theirsValue = "对方修改-仓库r128";',
  "    console.log(theirsValue);",
  ">>>>>>> .r127",
  "  }",
  "}",
].join("\n");

export const GIT_SINGLE = [
  'import { a } from "./a";',
  "function foo() {",
  "<<<<<<< HEAD",
  '  const headVal = "我的-HEAD-中文";',
  "=======",
  '  const branchVal = "对方分支-仓库";',
  ">>>>>>> feature-branch",
  "}",
].join("\n");

export const MULTI_BLOCK = [
  "export const header = 1;",
  "<<<<<<< .mine",
  'const block1Mine = "块1我的";',
  "||||||| .r100",
  'const block1Base = "块1基线";',
  "=======",
  'const block1Theirs = "块1对方";',
  ">>>>>>> .r100",
  "export const middle = 2;",
  "<<<<<<< .mine",
  'const block2Mine = "块2我的-中文测试";',
  "||||||| .r101",
  'const block2Base = "块2基线";',
  "=======",
  'const block2Theirs = "块2对方";',
  ">>>>>>> .r101",
  "export const footer = 3;",
  "<<<<<<< HEAD",
  'const block3Head = "块3 HEAD";',
  "=======",
  'const block3Incoming = "块3 incoming";',
  ">>>>>>> branch3",
  "export const tail = 4;",
].join("\n");

export const NO_BASE = [
  "const a = 1;",
  "<<<<<<< HEAD",
  'const onlyMine = "无BASE-我的";',
  "=======",
  'const onlyTheirs = "无BASE-对方";',
  ">>>>>>> origin/main",
  "const b = 2;",
].join("\n");

export const CRLF_SINGLE = SVN_SINGLE.replace(/\n/g, "\r\n");

export const BOM_SINGLE = "\uFEFF" + SVN_SINGLE;

export const NO_TRAILING_NEWLINE = [
  "const a = 1;",
  "<<<<<<< .mine",
  'const mine = "无末尾换行";',
  "=======",
  'const theirs = "对方";',
  ">>>>>>> .r127",
].join("\n");

export const DAMAGED_MISSING_SEPARATOR = [
  "const a = 1;",
  "<<<<<<< .mine",
  'const mineOnly = "损坏-缺分隔符";',
  ">>>>>>> .r127",
  "const b = 2;",
].join("\n");

export const DAMAGED_MISSING_END = [
  "const a = 1;",
  "<<<<<<< .mine",
  'const mineOnly = "损坏-缺结束符";',
  "=======",
  'const theirsOnly = "对方";',
  "const b = 2;",
].join("\n");

export const DAMAGED_NESTED = [
  "const a = 1;",
  "<<<<<<< .mine",
  'const mine = "外层";',
  "<<<<<<< .mine",
  'const nested = "嵌套";',
  "=======",
  'const theirs = "对方";',
  ">>>>>>> .r127",
  "=======",
  'const outerTheirs = "外层对方";',
  ">>>>>>> .r127",
].join("\n");

export const LONG_LINE = (() => {
  const long = "a".repeat(5000);
  return [
    "const a = 1;",
    "<<<<<<< .mine",
    `const mineLong = "${long}";`,
    "||||||| .r127",
    'const baseShort = "基线短";',
    "=======",
    'const theirsShort = "对方短";',
    ">>>>>>> .r127",
    "const b = 2;",
  ].join("\n");
})();

export const SVN_GIT_VARIANT_LABELS = {
  svnStart: "<<<<<<< .mine",
  svnBase: "||||||| .r127",
  svnSep: "=======",
  svnEnd: ">>>>>>> .r127",
  gitStart: "<<<<<<< HEAD",
  gitEnd: ">>>>>>> feature-branch",
};

export function generatePerfFixture(lineCount = 5000, interval = 100): string {
  const lines: string[] = [];
  let conflictIdx = 0;
  for (let i = 0; i < lineCount; i++) {
    if (i % interval === 0 && i !== 0 && i < lineCount - 20) {
      lines.push("<<<<<<< .mine");
      lines.push(
        `const perfMine${conflictIdx} = "性能-我的-${conflictIdx}中文";`,
      );
      lines.push("||||||| .r127");
      lines.push(`const perfBase${conflictIdx} = "性能-基线-${conflictIdx}";`);
      lines.push("=======");
      lines.push(
        `const perfTheirs${conflictIdx} = "性能-对方-${conflictIdx}";`,
      );
      lines.push(">>>>>>> .r127");
      conflictIdx += 1;
      i += 6;
    } else {
      lines.push(`const line${i} = ${i}; // 填充行 ${i} 中文占位`);
    }
  }
  return lines.join("\n");
}

export const PERF_5000 = generatePerfFixture(5000, 98);

// 用于 current/incoming 映射证明：交换内容但标记位置不变，验证按位置判定 Mine/Theirs
// 正常：mine=AAA, theirs=BBB；交换：mine=BBB, theirs=AAA（位置不变，内容互换）
export const SWAP_MINE_THEIRS = {
  normal: [
    "const a = 1;",
    "<<<<<<< .mine",
    "AAA-mine",
    "=======",
    "BBB-theirs",
    ">>>>>>> .r127",
  ].join("\n"),
  swapped: [
    "const a = 1;",
    "<<<<<<< .mine",
    "BBB-theirs",
    "=======",
    "AAA-mine",
    ">>>>>>> .r127",
  ].join("\n"),
};
