import { runSvnCommand } from '../svn/svnCommandRunner';

export interface SvnPropertyItem {
  name: string;
  value: string;
}

export async function collectSvnProperties(svnPath: string, target: string, cwd: string): Promise<{
  items: SvnPropertyItem[];
  error?: string;
}> {
  const result = await runSvnCommand(svnPath, ['proplist', '--xml', '-v', target], cwd);
  if (result.exitCode !== 0) {
    return { items: [], error: result.stderr || result.stdout || 'SVN 属性读取失败。' };
  }
  return { items: parseSvnPropertiesXml(result.stdout) };
}

export function parseSvnPropertiesXml(xml: string): SvnPropertyItem[] {
  const items: SvnPropertyItem[] = [];
  const expression = /<property\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/property>/g;
  for (const match of xml.matchAll(expression)) {
    items.push({ name: decodeXml(match[1]), value: decodeXml(match[2]) });
  }
  return items.sort((left, right) => left.name.localeCompare(right.name));
}

export function validatePropertyEdit(name: string, value: string, remove: boolean, existing: SvnPropertyItem[]): string[] {
  const issues: string[] = [];
  if (!name || !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) {
    issues.push('属性名不能为空，且只能包含字母、数字、点、下划线、冒号和连字符。');
  }
  if (Buffer.byteLength(value, 'utf8') > 64 * 1024) {
    issues.push('属性值超过 64 KB，请使用 SVN CLI 和属性文件处理。');
  }
  if (remove && !existing.some((item) => item.name === name)) {
    issues.push('该属性当前不存在，无法删除。');
  }
  return issues;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
