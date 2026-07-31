import { describe, expect, it } from 'vitest';
import { parseSvnChangelistsXml } from '../../src/changelist/svnChangelistParser';

describe('SVN changelist XML parser', () => {
  it('解析并合并 Changelist 路径', () => {
    const groups = parseSvnChangelistsXml(`<status><target path="."><changelist name="workbench"><entry path="src/a.ts"><wc-status item="modified"/></entry><entry path="src/b.ts"><wc-status item="modified"/></entry></changelist></target></status>`, '/repo');
    expect(groups).toEqual([{ name: 'workbench', paths: ['src/a.ts', 'src/b.ts'] }]);
  });
});
