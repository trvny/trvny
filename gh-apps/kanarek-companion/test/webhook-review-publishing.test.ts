import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseReviewJson,
  reviewDisposition,
  reviewSourceLabel,
} from '../src/webhook-review.ts';

test('review source label includes provider and concrete upstream model', () => {
  assert.equal(
    reviewSourceLabel('openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free'),
    'OpenRouter · `nvidia/nemotron-3-ultra-550b-a55b:free`',
  );
  assert.equal(
    reviewSourceLabel('aihubmix', 'deepseek-v4-flash-ga-260731'),
    'AIHubMix · `deepseek-v4-flash-ga-260731`',
  );
  assert.equal(
    reviewSourceLabel('gemini-flex', 'gemini-3.8-flash'),
    'Gemini Flex · `gemini-3.8-flash`',
  );
});

test('review source label falls back to the provider when model is unavailable', () => {
  assert.equal(reviewSourceLabel('openrouter', null), 'OpenRouter');
  assert.equal(reviewSourceLabel('workers-ai', null), 'Workers AI');
});

test('only genuinely clean reviews stay silent', () => {
  assert.equal(reviewDisposition([], []), 'clean');
  assert.equal(reviewDisposition([{}], []), 'invalid_findings');
  assert.equal(reviewDisposition([{}], [{}]), 'publish');
});

test('Orca-style existing_code survives the fake review envelope', () => {
  const existingCode = 'if (!tenantId) return unauthorized();';
  const payload = JSON.stringify({
    summary: '发现一个需要确认的问题。',
    findings: [{
      severity: 'high',
      path: 'src/auth.ts',
      line: 41,
      title: '租户校验被跳过',
      body: '正常请求路径会在访问数据之前跳过租户校验，应在读取记录前拒绝缺少租户标识的请求。',
      existing_code: existingCode,
    }],
  });

  const parsed = parseReviewJson(payload);
  assert.ok(parsed);
  assert.equal(parsed.findings.length, 1);
  assert.equal(
    (parsed.findings[0] as unknown as Record<string, unknown>).existing_code,
    existingCode,
  );
});

test('truncated Orca-style review output fails closed instead of becoming a clean review', () => {
  const full = JSON.stringify({
    summary: '发现问题。',
    findings: [{
      severity: 'medium',
      path: 'src/demo.ts',
      line: 7,
      title: '错误路径未处理',
      body: '失败分支会返回错误结果。',
      existing_code: 'return result.value;',
    }],
  });
  assert.ok(parseReviewJson(full));
  assert.equal(parseReviewJson(full.slice(0, -12)), null);
});

test('compact Orca-style fake judge input stays small even with the full finding count', () => {
  const findings = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    severity: 'P1',
    path: `src/file-${index}.ts`,
    line: 100 + index,
    title: '具体缺陷标题'.repeat(5).slice(0, 50),
    body: '这个缺陷会在正常执行路径产生错误结果，需要在合并前修复。'.repeat(8).slice(0, 180),
    existing_code: `const result${index} = unsafeCall(input);`.padEnd(160, ' '),
  }));
  const judgeInput = JSON.stringify({ findings });
  const bytes = new TextEncoder().encode(judgeInput).byteLength;

  assert.equal(findings.length, 8);
  assert.ok(bytes < 12_000, `fake judge input unexpectedly grew to ${bytes} bytes`);
});
