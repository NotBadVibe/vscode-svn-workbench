import * as path from "node:path";

export interface SvnChangelistGroup {
  name: string;
  paths: string[];
}

export function parseSvnChangelistsXml(
  xml: string,
  repositoryRoot: string,
): SvnChangelistGroup[] {
  const groups: SvnChangelistGroup[] = [];
  const pattern = /<changelist\s+name="([^"]*)"\s*>([\s\S]*?)<\/changelist>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const paths: string[] = [];
    const entryPattern = /<entry\s+path="([^"]+)"/g;
    let entry: RegExpExecArray | null;
    while ((entry = entryPattern.exec(match[2])) !== null) {
      const decoded = decodeXml(entry[1]);
      const absolutePath = path.isAbsolute(decoded)
        ? path.resolve(decoded)
        : path.resolve(repositoryRoot, decoded);
      paths.push(
        normalizeRelative(path.relative(repositoryRoot, absolutePath)),
      );
    }
    groups.push({
      name: decodeXml(match[1]),
      paths: [...new Set(paths)].sort(),
    });
  }
  return groups.sort((left, right) => left.name.localeCompare(right.name));
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, "/") || ".";
}
