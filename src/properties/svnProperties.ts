import { runSvnCommand } from "../svn/svnCommandRunner";

export interface SvnPropertyItem {
  name: string;
  value: string;
}

export async function collectSvnProperties(
  svnPath: string,
  target: string,
  cwd: string,
): Promise<{
  items: SvnPropertyItem[];
  error?: string;
}> {
  const result = await runSvnCommand(
    svnPath,
    ["proplist", "--xml", "-v", target],
    cwd,
  );
  if (result.exitCode !== 0) {
    return {
      items: [],
      error: result.stderr || result.stdout || "SVN 属性读取失败。",
    };
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

/**
 * 解析 svn:externals 属性值中的本地目标名（v0.0.6 页内编辑边界）。
 * 新语法 `URL[@PEG] target` 与旧语法 `-rN URL target` 的本地目标都是
 * 最后一个空白分隔词元；空行与 # 注释忽略。file external 的 status 标记
 * 在个别历史场景（删除后以同名重新挂载）下不可靠，必须以父目录的
 * svn:externals 定义为准。
 */
export function parseSvnExternalsTargetNames(value: string): string[] {
  const names: string[] = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const tokens = line.split(/\s+/);
    const target = tokens[tokens.length - 1];
    if (target !== undefined && target !== "") names.push(target);
  }
  return names;
}

export function validatePropertyEdit(
  name: string,
  value: string,
  remove: boolean,
  existing: SvnPropertyItem[],
): string[] {
  const issues: string[] = [];
  if (!name || !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) {
    issues.push(
      "属性名不能为空，且只能包含字母、数字、点、下划线、冒号和连字符。",
    );
  }
  if (Buffer.byteLength(value, "utf8") > 64 * 1024) {
    issues.push("属性值超过 64 KB，请使用 SVN CLI 和属性文件处理。");
  }
  if (remove && !existing.some((item) => item.name === name)) {
    issues.push("该属性当前不存在，无法删除。");
  }
  return issues;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
