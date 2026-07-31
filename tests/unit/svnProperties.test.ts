import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/diagnostics/outputChannel', () => ({
  appendOutput: vi.fn(),
  sanitizeDiagnostic: (value: string) => value
}));

import { parseSvnPropertiesXml, validatePropertyEdit } from '../../src/properties/svnProperties';

describe('SVN properties', () => {
  it('parses and decodes verbose proplist XML', () => {
    const items = parseSvnPropertiesXml(`<?xml version="1.0"?><properties><target path="."><property name="svn:ignore">dist&amp;cache\nobj</property><property name="custom:owner">研发&lt;组&gt;</property></target></properties>`);
    expect(items).toEqual([
      { name: 'custom:owner', value: '研发<组>' },
      { name: 'svn:ignore', value: 'dist&cache\nobj' }
    ]);
  });

  it('rejects invalid, oversized and missing delete operations', () => {
    expect(validatePropertyEdit('bad name', 'x'.repeat(70_000), true, [])).toHaveLength(3);
    expect(validatePropertyEdit('svn:ignore', 'dist', false, [])).toEqual([]);
  });
});
