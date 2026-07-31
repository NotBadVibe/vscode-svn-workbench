const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const validationRoot = process.platform === 'win32'
  ? 'C:\\svn-workbench-manual-ui-acceptance-v2'
  : '/tmp/svn-workbench-manual-ui-acceptance-v2';
const prepare = spawnSync(process.execPath, [path.join(__dirname, 'create-manual-acceptance-env.js')], {
  cwd: projectRoot,
  encoding: 'utf8',
  env: { ...process.env, SVN_WORKBENCH_MANUAL_ENV: validationRoot }
});
if (prepare.status !== 0) {
  process.stderr.write(prepare.stderr || prepare.stdout || '无法创建 Extension Host SVN 验收夹具。\n');
  process.exit(prepare.status || 1);
}

const result = spawnSync(process.execPath, [path.join(projectRoot, 'out', 'test', 'runTest.js')], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, SVN_WORKBENCH_TEST_WORKSPACE: path.join(validationRoot, 'wc') }
});
process.exit(result.status ?? 1);
