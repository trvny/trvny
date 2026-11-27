import assert from 'node:assert/strict';
import test from 'node:test';

import { applyFindingPolicy, isCiCheckedClaim } from '../src/companion/webhook-review-policy.ts';
import { reviewDisposition } from '../src/companion/webhook-review.ts';

// Modelled on findings Kanarek posted on 2026-11-26/27; bodies are shortened.
const falseClaims = [
  {
    path: 'app/src/androidTest/java/ais/tee/ui/WebChatBookmarkEditorTest.kt',
    title: '缺少 Compose 断言导入',
    body: '当前代码无法解析这些断言调用，androidTest 会编译失败。',
  },
  {
    path: '.github/scripts/test_codeql_matrix.py',
    title: '导入模块路径错误',
    body: '该目录未加入 PYTHONPATH。',
  },
  {
    path: '.github/scripts/test_release_verified_jobs.py',
    title: '模块导入路径错误',
    body: '直接使用 `from release_verified_jobs import verified` 会查找失败。',
  },
  {
    path: 'app/src/main/java/com/autka/data/repository/DefaultIndexedPreviewRepository.kt',
    title: '构造函数参数尾部多余逗号',
    body: '该行会导致编译错误。',
  },
  {
    path: 'app/src/test/java/ais/tee/ui/screens/WebFilePickerSlotTest.kt',
    title: '测试 Registry 未实现 ActivityResultRegistry.onLaunch',
    body: 'Registry 仍是抽象类，WebFilePickerSlotTest 无法编译。',
  },
];

const keptClaims = [
  {
    path: 'pages/build.sh',
    title: '构建产物覆盖被 ?raw 引用的手写源文件',
    body: '第二次 `astro build` 会把已生成的输出当作源再次导入，构建不再幂等。',
  },
  {
    path: 'benches/streambench/client/app.ts',
    title: '后续播放继承了 muted fallback 的静音状态',
    body: '`stopPlayback()` 和 `playStream()` 都不会重置 `media.muted`。',
  },
  {
    path: 'src/bookmarks.ts',
    title: '导入书签时覆盖已有数据',
    body: '导入会清空现有列表。',
  },
  {
    path: 'tools/loader.py',
    title: '回退分支吞掉异常',
    body: '`except ImportError` 分支返回空对象，调用方之后读到空配置。',
  },
  {
    path: '.github/workflows/release.yml',
    title: 'YAML 语法错误',
    body: '该工作流无法解析。',
  },
  // Counterexamples raised in review of the first version.
  { path: 'src/bookmarks.ts', title: '未校验备份内容就导入书签', body: '损坏的备份会覆盖现有数据。' },
  { path: 'src/bookmarks.ts', title: '缺少导入数据校验', body: '任意字段都会写入存储。' },
  {
    path: 'src/rules.ts',
    title: '解析失败时清空规则',
    body: '用户规则包含语法错误时，catch 分支把空数组写回存储，覆盖已有有效规则。',
  },
  { path: 'src/rules.ts', title: '语法错误时覆盖已有规则', body: '原有规则丢失。' },
  { path: 'src/cache.ts', title: '缓存键错误', body: '该改动不会导致编译失败，但会读到旧值。' },
  { path: 'src/auth.ts', title: '鉴权缺失', body: '这不会使代码无法编译，但会允许未认证用户读取数据。' },
  { path: 'src/auth.ts', title: '这个改动不会导致编译失败', body: '未认证用户可以读取数据。' },
  { path: 'src/auth.ts', title: '鉴权缺失', body: '这不使得编译失败，却会跳过鉴权。' },
  { path: 'src/rules.ts', title: '有效规则被误判为语法错误', body: '合法输入会被拒绝。' },
  { path: 'pages/eslint.config.mjs', title: '代码语法错误', body: '该行会导致编译错误。' },
  { path: 'app/build.gradle.kts', title: '代码语法错误', body: '该行会导致编译错误。' },
  {
    path: '.github/scripts/gptomek-mailbox-fallback.py',
    title: '代码语法错误',
    body: '脚本无法运行。',
  },
];

test('compile, syntax and import breakage claims about source files are dropped', () => {
  for (const finding of falseClaims) assert.equal(isCiCheckedClaim(finding), true, finding.title);
});

test('behaviour findings and claims about files CI may never parse are kept', () => {
  for (const finding of keptClaims) assert.equal(isCiCheckedClaim(finding), false, finding.title);
});

test('a reply holding only dropped claims reads as clean, so it cannot escalate to paid', () => {
  const policy = applyFindingPolicy({ summary: '发现语法错误', findings: falseClaims });
  assert.equal(policy.dropped, falseClaims.length);
  assert.equal(reviewDisposition(policy.parsed.findings, []), 'clean');
});

test('a summary is discarded only when something was dropped', () => {
  const mixed = applyFindingPolicy({ summary: '发现语法错误', findings: [falseClaims[0], keptClaims[1]] });
  assert.deepEqual(mixed.parsed, { summary: '', findings: [keptClaims[1]] });
  const untouched = { summary: '静音状态未重置', findings: [keptClaims[1]] };
  assert.equal(applyFindingPolicy(untouched).parsed, untouched);
});
