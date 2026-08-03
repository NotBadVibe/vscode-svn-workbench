import { describe, expect, it } from "vitest";
import { parseSvnLogXml } from "../../src/history/svnHistoryParser";

describe("SVN history parser", () => {
  it("parses revisions, messages and changed paths", () => {
    const revisions = parseSvnLogXml(`<?xml version="1.0"?>
      <log>
        <logentry revision="42">
          <author>yang&amp;nan</author>
          <date>2026-07-30T10:00:00.000000Z</date>
          <paths><path action="M">/trunk/src/a.ts</path><path action="A" copyfrom-path="/branches/x" copyfrom-rev="40">/trunk/src/b.ts</path></paths>
          <msg>feat: &lt;Svelte&gt; UI</msg>
        </logentry>
      </log>`);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].author).toBe("yang&nan");
    expect(revisions[0].message).toBe("feat: <Svelte> UI");
    expect(revisions[0].changedPaths[1]).toMatchObject({
      action: "A",
      copyFromRevision: "40",
    });
  });
});
