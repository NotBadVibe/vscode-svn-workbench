import { describe, expect, it } from "vitest";
import type { WorkbenchFileView } from "../../src/protocol/workbenchProtocol";
import {
  buildKeyPathMap,
  isActionableForMode,
  pathsFromKeys,
  toSelectableItems,
} from "../../src/webview/app/fileSelection";

/* v0.0.8 选择适配层：actionability 按动作权威决定，不伪造 identity。 */

function file(
  relativePath: string,
  selection: WorkbenchFileView["selection"],
): WorkbenchFileView {
  return {
    relativePath,
    selectionKey: `wc::${relativePath}` as never,
    status: "modified",
    selection,
  };
}

describe("文件选择适配层（v0.0.8）", () => {
  it("blocked 在两种模式下都不可操作", () => {
    expect(isActionableForMode(file("a.ts", "blocked"), "commit")).toBe(false);
    expect(isActionableForMode(file("a.ts", "blocked"), "changes")).toBe(false);
  });

  it("Commit 下 excluded 不可操作；Changes 下 excluded 不进入批量但可逐项选择", () => {
    expect(isActionableForMode(file("a.ts", "excluded"), "commit")).toBe(false);
    expect(isActionableForMode(file("a.ts", "excluded"), "changes")).toBe(
      false,
    );
  });

  it("needsReview 可显式选择并进入可操作集", () => {
    expect(isActionableForMode(file("a.ts", "needsReview"), "commit")).toBe(
      true,
    );
    expect(isActionableForMode(file("a.ts", "selected"), "commit")).toBe(true);
  });

  it("toSelectableItems 携带动作权威判定与内核标志", () => {
    const items = toSelectableItems(
      [
        file("a.ts", "selected"),
        file("b.ts", "needsReview"),
        file("c.ts", "excluded"),
        file("d.ts", "blocked"),
      ],
      "commit",
    );
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      actionable: true,
      recommended: true,
    });
    expect(items[1]).toMatchObject({ actionable: true, needsReview: true });
    expect(items[2]).toMatchObject({ actionable: false, excluded: true });
    expect(items[3]).toMatchObject({ actionable: false, blocked: true });
  });

  it("key ↔ relativePath 往返查表；消失项被丢弃", () => {
    const files = [file("a.ts", "selected"), file("b.ts", "modified" as never)];
    const map = buildKeyPathMap(files);
    expect(map.get(files[0].selectionKey)).toBe("a.ts");
    const paths = pathsFromKeys(
      [files[0].selectionKey, "wc::gone.ts" as never],
      map,
    );
    expect(paths).toEqual(["a.ts"]);
  });
});
