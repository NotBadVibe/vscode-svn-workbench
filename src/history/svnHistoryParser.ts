export interface SvnChangedPath {
  action: string;
  path: string;
  copyFromPath?: string;
  copyFromRevision?: string;
}

export interface SvnRevision {
  revision: string;
  author: string;
  date: string;
  message: string;
  changedPaths: SvnChangedPath[];
}

export function parseSvnLogXml(xml: string): SvnRevision[] {
  const revisions: SvnRevision[] = [];
  const entryPattern = /<logentry\s+revision="([^"]+)"\s*>([\s\S]*?)<\/logentry>/g;
  let entry: RegExpExecArray | null;
  while ((entry = entryPattern.exec(xml)) !== null) {
    const body = entry[2];
    revisions.push({
      revision: decodeXml(entry[1]),
      author: readTag(body, 'author') || '未知作者',
      date: readTag(body, 'date'),
      message: readTag(body, 'msg'),
      changedPaths: parseChangedPaths(body)
    });
  }
  return revisions;
}

function parseChangedPaths(body: string): SvnChangedPath[] {
  const pathsBody = /<paths>([\s\S]*?)<\/paths>/.exec(body)?.[1] ?? '';
  const paths: SvnChangedPath[] = [];
  const pattern = /<path\s+([^>]*)>([\s\S]*?)<\/path>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(pathsBody)) !== null) {
    const attributes = match[1];
    paths.push({
      action: getAttribute(attributes, 'action') || '?',
      path: decodeXml(match[2].trim()),
      copyFromPath: getAttribute(attributes, 'copyfrom-path'),
      copyFromRevision: getAttribute(attributes, 'copyfrom-rev')
    });
  }
  return paths;
}

function readTag(source: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(source);
  return match ? decodeXml(match[1].trim()) : '';
}

function getAttribute(source: string, name: string): string | undefined {
  const match = new RegExp(`${name}="([^"]*)"`).exec(source);
  return match ? decodeXml(match[1]) : undefined;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
