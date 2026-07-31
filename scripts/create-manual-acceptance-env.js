const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const validationRoot = path.resolve(
  process.env.SVN_WORKBENCH_MANUAL_ENV ||
  (process.platform === 'win32' ? 'C:\\svn-workbench-manual-ui-acceptance-v2' : '/tmp/svn-workbench-manual-ui-acceptance-v2')
);
const svnRepo = path.join(validationRoot, 'repo');
const seedDir = path.join(validationRoot, 'seed');
const localWc = path.join(validationRoot, 'wc');
const remoteWc = path.join(validationRoot, 'remote-wc');
const repoUrl = `${pathToFileURL(svnRepo).href}/trunk`;

ensureSafeValidationPath(validationRoot);
fs.rmSync(validationRoot, { recursive: true, force: true });
fs.mkdirSync(validationRoot, { recursive: true });

run('svnadmin', ['create', svnRepo]);
createSeedProject(seedDir);
run('svn', ['import', seedDir, repoUrl, '-m', '初始化 SVN Workbench 手工验收项目', '--encoding', 'utf-8']);
run('svn', ['checkout', repoUrl, localWc]);
run('svn', ['checkout', repoUrl, remoteWc]);

prepareLocalChanges(localWc);
prepareRemoteChanges(remoteWc);
prepareTextConflict(localWc);

const localStatus = run('svn', ['status', localWc]).stdout.trim();
const remoteStatus = run('svn', ['status', '--show-updates', localWc], { allowFailure: true }).stdout.trim();
const readme = buildReadme({ localStatus, remoteStatus });
fs.writeFileSync(path.join(validationRoot, 'README-manual-acceptance.md'), readme, 'utf8');

console.log(readme);

function createSeedProject(root) {
  writeFile(root, 'src/pages/order/OrderList.vue', [
    '<template>',
    '  <section class="order-list">订单列表</section>',
    '</template>',
    '',
    '<script setup lang="ts">',
    'const moduleName = "order";',
    '</script>',
    ''
  ].join('\n'));
  writeFile(root, 'src/pages/user/UserList.vue', [
    '<template>',
    '  <section class="user-list">用户列表</section>',
    '</template>',
    ''
  ].join('\n'));
  writeFile(root, 'src/api/order.ts', [
    'export function fetchOrders() {',
    '  return [];',
    '}',
    ''
  ].join('\n'));
  writeFile(root, 'src/pages/order/DeletedByLocal.ts', [
    'export const deprecatedOrderPage = true;',
    ''
  ].join('\n'));
  writeFile(root, 'src/pages/conflict/ConflictDemo.vue', [
    '<template>',
    '  <section class="conflict-demo">base conflict content</section>',
    '</template>',
    '',
    '<script setup lang="ts">',
    'const owner = "base";',
    '</script>',
    ''
  ].join('\n'));
  writeFile(root, 'config/app.json', `${JSON.stringify({ name: 'svn-workbench-manual-test', env: 'test' }, null, 2)}\n`);
  writeFile(root, 'docs/readme.md', '# SVN Workbench 手工验收项目\n\n这是初始文档。\n');
  writeFile(root, '特殊 路径/订单(#1).ts', 'export const price = 100;\n');
  writeFile(root, 'docs/empty-target.txt', '该内容将在本地被清空。\n');
  writeFile(root, 'data/large.txt', `${'large-line\n'.repeat(530000)}`);
  writeBuffer(root, 'assets/sample.bin', Buffer.from([0x00, 0x01, 0x02, 0xff]));
  writeFile(root, '.svn-workbench.json', `${JSON.stringify({
    commitConvention: {
      enabled: true,
      requiredPrefix: true,
      allowedPrefixes: ['feat', 'fix', 'docs', 'config', 'chore'],
      requiredModule: true,
      allowedModules: ['order', 'user', 'config', 'docs']
    },
    commitCandidateFilterPresets: [
      {
        id: 'frontend-order',
        label: '前端订单模块',
        filters: {
          search: 'src/pages/order',
          fileType: 'all',
          templateGroup: 'frontend',
          hideGenerated: true
        }
      },
      {
        id: 'config-only',
        label: '只看配置文件',
        filters: {
          search: 'config',
          fileType: 'json',
          templateGroup: 'config',
          hideGenerated: true
        }
      }
    ]
  }, null, 2)}\n`);
}

function prepareLocalChanges(wc) {
  fs.appendFileSync(path.join(wc, 'src/pages/order/OrderList.vue'), '\n<!-- local: 手工验收本地改动 -->\n', 'utf8');
  fs.appendFileSync(path.join(wc, 'config/app.json'), '\n', 'utf8');
  writeFile(wc, 'src/pages/conflict/ConflictDemo.vue', [
    '<template>',
    '  <section class="conflict-demo">local conflict content</section>',
    '</template>',
    '',
    '<script setup lang="ts">',
    'const owner = "local";',
    '</script>',
    ''
  ].join('\n'));
  writeFile(wc, 'src/pages/user/UserProfile.vue', '<template><section>用户详情</section></template>\n');
  run('svn', ['add', path.join(wc, 'src/pages/user/UserProfile.vue')]);
  run('svn', ['delete', path.join(wc, 'src/pages/order/DeletedByLocal.ts')]);
  fs.rmSync(path.join(wc, 'docs/readme.md'), { force: true });
  writeFile(wc, 'src/pages/order/debug.log', 'debug log should be excluded\n');
  writeFile(wc, 'src/pages/order/NewFeature.ts', 'export const enabled = true;\n');
  writeFile(wc, 'dist/bundle.js', 'console.log("generated bundle");\n');
  writeFile(wc, 'obj/cache.tmp', 'generated object cache\n');
  writeFile(wc, 'bin/Debug/app.exe', 'fake binary placeholder\n');
  writeFile(wc, 'config/local.dev.json', `${JSON.stringify({ local: true }, null, 2)}\n`);
  fs.appendFileSync(path.join(wc, '特殊 路径/订单(#1).ts'), '// 中文、空格、括号与 # 路径验收\n', 'utf8');
  fs.writeFileSync(path.join(wc, 'docs/empty-target.txt'), '', 'utf8');
  fs.appendFileSync(path.join(wc, 'data/large.txt'), 'local large diff\n', 'utf8');
  fs.appendFileSync(path.join(wc, 'assets/sample.bin'), Buffer.from([0x00, 0x03]));
}

function prepareRemoteChanges(wc) {
  fs.appendFileSync(path.join(wc, 'src/pages/order/OrderList.vue'), '\n<!-- remote: 远端同路径改动 -->\n', 'utf8');
  writeFile(wc, 'src/pages/conflict/ConflictDemo.vue', [
    '<template>',
    '  <section class="conflict-demo">remote conflict content</section>',
    '</template>',
    '',
    '<script setup lang="ts">',
    'const owner = "remote";',
    '</script>',
    ''
  ].join('\n'));
  writeFile(wc, 'src/pages/order/RemoteOnly.vue', '<template><section>远端新增页面</section></template>\n');
  run('svn', ['add', path.join(wc, 'src/pages/order/RemoteOnly.vue')]);
  run('svn', ['commit', wc, '-m', '远端制造订单模块更新', '--encoding', 'utf-8']);
}

function prepareTextConflict(wc) {
  const conflictPath = path.join(wc, 'src/pages/conflict/ConflictDemo.vue');
  run('svn', ['update', conflictPath, '--accept', 'postpone'], { allowFailure: true });

  const conflictStatus = run('svn', ['status', conflictPath]).stdout;
  if (!/^C\s+/m.test(conflictStatus)) {
    throw new Error(`Failed to create expected text conflict for ${conflictPath}.\n${conflictStatus}`);
  }
}

function buildReadme({ localStatus, remoteStatus }) {
  return [
    '# SVN Workbench 手工验收环境',
    '',
    `创建时间：${new Date().toISOString()}`,
    '',
    '## 路径',
    '',
    `- SVN 仓库：${svnRepo}`,
    `- 本地工作副本：${localWc}`,
    `- 远端模拟工作副本：${remoteWc}`,
    '',
    '## 当前本地状态',
    '',
    '```text',
    localStatus || '(empty)',
    '```',
    '',
    '## 当前远端更新状态',
    '',
    '```text',
    remoteStatus || '(empty)',
    '```',
    '',
    '## 推荐打开方式',
    '',
    '```powershell',
    `code "${localWc}"`,
    '```',
    '',
    '## 预置验收点',
    '',
    '- `src/pages/conflict/ConflictDemo.vue`：已制造真实 SVN 文本冲突，用于测试冲突中心和 AI 冲突建议。',
    '- `src/pages/order/OrderList.vue`：本地和远端都有改动，用于测试更新风险与同路径重叠。',
    '- `src/pages/user/UserProfile.vue`：已 `svn add`，用于测试新增文件提交。',
    '- `src/pages/order/DeletedByLocal.ts`：已 `svn delete`，用于测试计划删除文件。',
    '- `docs/readme.md`：本地缺失，用于测试 missing 文件。',
    '- `src/pages/order/debug.log`、`dist/bundle.js`、`obj/cache.tmp`、`bin/Debug/app.exe`：未版本控制生成物，用于测试默认排除。',
    '- `src/pages/order/NewFeature.ts`、`config/local.dev.json`：未版本控制普通文件，用于测试待确认/筛选。',
    '- `.svn-workbench.json`：包含团队提交规范和仓库级筛选预设。',
    '- `特殊 路径/订单(#1).ts`：覆盖中文、空格、括号和 `#` 路径。',
    '- `docs/empty-target.txt`、`assets/sample.bin`、`data/large.txt`：覆盖空文本、二进制和超过 5 MB 的 Diff 降级。',
    ''
  ].join('\n');
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeBuffer(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error([
      `${command} ${args.join(' ')} failed with exit code ${result.status}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join('\n'));
  }

  return result;
}

function ensureSafeValidationPath(target) {
  const resolved = path.resolve(target);
  const allowed = process.platform === 'win32'
    ? /^([A-Z]:\\)?svn-workbench-manual-ui-acceptance-v2$/i.test(resolved) || /\\svn-workbench-manual-ui-acceptance-v2$/i.test(resolved)
    : resolved === '/tmp/svn-workbench-manual-ui-acceptance-v2' || resolved.endsWith('/svn-workbench-manual-ui-acceptance-v2');
  if (!allowed) {
    throw new Error(`Refusing to recreate unexpected manual acceptance path: ${resolved}`);
  }
}
