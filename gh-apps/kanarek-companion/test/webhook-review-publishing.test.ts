import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyReviewJudge,
  parseReviewJson,
  reviewDisposition,
  reviewJudgeThreshold,
  reviewSourceLabel,
  sweepReviewProviders,
  verifyReviewFindings,
  type ReviewRouterOutcome,
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
  assert.equal(
    reviewSourceLabel('vercel', 'alibaba/qwen3-coder-30b-a3b'),
    'Vercel AI Gateway · `alibaba/qwen3-coder-30b-a3b`',
  );
  assert.equal(
    reviewSourceLabel('huggingface-publicai', 'aisingapore/Qwen-SEA-LION-v4-32B-IT:publicai'),
    'Hugging Face PublicAI · `aisingapore/Qwen-SEA-LION-v4-32B-IT:publicai`',
  );
  assert.equal(
    reviewSourceLabel('deepseek', 'deepseek-flash'),
    'DeepSeek · `deepseek-flash`',
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

test('L1 verifier keeps exact existing_code and anchors it to the added RIGHT-side line', () => {
  const parsed = parseReviewJson(JSON.stringify({
    summary: '发现问题。',
    findings: [{
      severity: 'high',
      path: 'src/auth.ts',
      line: 11,
      existing_code: '  const result = unsafeCall(input);',
      title: '输入未经校验',
      body: '正常路径会把未经校验的输入传给下游调用。',
    }],
  }));
  assert.ok(parsed);

  const findings = verifyReviewFindings(parsed, [{
    path: 'src/auth.ts',
    patch: '@@ -10,2 +10,3 @@\n const input = request.body;\n+  const result = unsafeCall(input);\n return result;',
    rightLines: new Set([11]),
    sha: null,
  }]);

  assert.deepEqual(findings, [{
    severity: 'high',
    path: 'src/auth.ts',
    line: 11,
    existingCode: '  const result = unsafeCall(input);',
    title: '输入未经校验',
    body: '正常路径会把未经校验的输入传给下游调用。',
  }]);
});

test('L1 verifier re-homes a finding when existing_code uniquely matches another changed file', () => {
  const parsed = parseReviewJson(JSON.stringify({
    summary: '发现问题。',
    findings: [{
      severity: 'medium',
      path: 'src/wrong.ts',
      line: 21,
      existing_code: 'const value = brokenCall();',
      title: '错误调用位置',
      body: '该调用会在普通执行路径返回错误结果。',
    }],
  }));
  assert.ok(parsed);

  const findings = verifyReviewFindings(parsed, [
    {
      path: 'src/wrong.ts',
      patch: '@@ -1 +1 @@\n+const unrelated = true;',
      rightLines: new Set([1]),
      sha: null,
    },
    {
      path: 'src/right.ts',
      patch: '@@ -20,1 +20,2 @@\n const before = true;\n+const value = brokenCall();',
      rightLines: new Set([21]),
      sha: null,
    },
  ]);

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.path, 'src/right.ts');
  assert.equal(findings[0]?.line, 21);
});

test('L1 verifier rejects missing or ambiguous existing_code instead of trusting model coordinates', () => {
  const review = (existingCode: string) => parseReviewJson(JSON.stringify({
    summary: '发现问题。',
    findings: [{
      severity: 'high',
      path: 'src/missing.ts',
      line: 1,
      existing_code: existingCode,
      title: '无法验证的位置',
      body: '该问题必须先通过确定性的代码定位验证。',
    }],
  }));

  const files = [
    {
      path: 'src/a.ts',
      patch: '@@ -0,0 +1 @@\n+const duplicate = risky();',
      rightLines: new Set([1]),
      sha: null,
    },
    {
      path: 'src/b.ts',
      patch: '@@ -0,0 +1 @@\n+const duplicate = risky();',
      rightLines: new Set([1]),
      sha: null,
    },
  ];

  const absent = review('const absent = risky();');
  const ambiguous = review('const duplicate = risky();');
  assert.ok(absent);
  assert.ok(ambiguous);
  assert.deepEqual(verifyReviewFindings(absent, files), []);
  assert.deepEqual(verifyReviewFindings(ambiguous, files), []);
});

test('L1 verifier deduplicates repeated findings for the same exact code locator', () => {
  const parsed = parseReviewJson(JSON.stringify({
    summary: '发现问题。',
    findings: [
      {
        severity: 'high',
        path: 'src/demo.ts',
        line: 5,
        existing_code: 'const value = risky();',
        title: '第一次报告',
        body: '这是同一个根因的第一次报告。',
      },
      {
        severity: 'medium',
        path: 'src/demo.ts',
        line: 5,
        existing_code: 'const value = risky();',
        title: '重复报告',
        body: '这是同一个根因的重复报告。',
      },
    ],
  }));
  assert.ok(parsed);

  const findings = verifyReviewFindings(parsed, [{
    path: 'src/demo.ts',
    patch: '@@ -4,1 +4,2 @@\n const before = true;\n+const value = risky();',
    rightLines: new Set([5]),
    sha: null,
  }]);

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.title, '第一次报告');
});

test('L2 judge clusters confident duplicates but fails open on low-confidence groups', () => {
  const findings = [
    {
      severity: 'high' as const,
      path: 'src/a.ts',
      line: 10,
      existingCode: 'const value = risky();',
      title: '第一个症状',
      body: '这是同一个根因的第一个症状。',
    },
    {
      severity: 'medium' as const,
      path: 'src/a.ts',
      line: 12,
      existingCode: 'return value;',
      title: '第二个症状',
      body: '这是同一个根因的第二个症状。',
    },
    {
      severity: 'low' as const,
      path: 'src/b.ts',
      line: 3,
      existingCode: 'const style = true;',
      title: '低价值问题',
      body: '这个问题没有足够证据支持。',
    },
  ];
  const judged = applyReviewJudge(findings, JSON.stringify({
    groups: [
      {
        member_ids: [0, 1],
        representative_id: 1,
        confidence: 0.95,
        keep: true,
        root_cause: 'same bug',
        reason: 'verified',
      },
      {
        member_ids: [2],
        representative_id: 2,
        confidence: 0.4,
        keep: true,
        root_cause: 'weak',
        reason: 'speculative',
      },
    ],
  }), 0.7);

  assert.deepEqual(judged, [findings[1], findings[2]]);
});

test('L2 judge fails open when a covered rejection is not highly confident', () => {
  const findings = [{
    severity: 'high' as const,
    path: 'src/a.ts',
    line: 1,
    existingCode: 'const a = risky();',
    title: '问题 A',
    body: '这是一个需要保留的问题。',
  }];
  const judged = applyReviewJudge(findings, JSON.stringify({
    groups: [{
      member_ids: [0],
      representative_id: 0,
      confidence: 0.7,
      keep: false,
      root_cause: 'uncertain rejection',
      reason: 'not enough context',
    }],
  }), 0.9);

  assert.deepEqual(judged, findings);
});

test('L2 judge never lets a high-confidence veto erase a distinct L1 finding', () => {
  const findings = [{
    severity: 'low' as const,
    path: 'src/a.ts',
    line: 1,
    existingCode: 'const a = true;',
    title: '问题 A',
    body: '这是一个可以被明确反驳的问题。',
  }];
  const judged = applyReviewJudge(findings, JSON.stringify({
    groups: [{
      member_ids: [0],
      representative_id: 0,
      confidence: 0.98,
      keep: false,
      root_cause: 'contradicted',
      reason: 'review context directly disproves the claim',
    }],
  }), 0.9);

  assert.deepEqual(judged, findings);
});

test('L2 judge deduplicates a high-confidence vetoed cluster without erasing its root cause', () => {
  const findings = [
    {
      severity: 'medium' as const,
      path: 'src/a.ts',
      line: 1,
      existingCode: 'const a = risky();',
      title: '问题 A',
      body: '同一个根因的第一个定位。',
    },
    {
      severity: 'medium' as const,
      path: 'src/b.ts',
      line: 2,
      existingCode: 'const b = risky();',
      title: '问题 B',
      body: '同一个根因的第二个定位。',
    },
  ];
  const judged = applyReviewJudge(findings, JSON.stringify({
    groups: [{
      member_ids: [0, 1],
      representative_id: 1,
      confidence: 0.98,
      keep: false,
      root_cause: 'duplicate',
      reason: 'same root cause',
    }],
  }), 0.9);

  assert.deepEqual(judged, [findings[1]]);
});

test('L2 judge fails open for findings it did not classify', () => {
  const findings = [
    {
      severity: 'high' as const,
      path: 'src/a.ts',
      line: 1,
      existingCode: 'const a = risky();',
      title: '问题 A',
      body: '这是一个需要保留的问题。',
    },
    {
      severity: 'medium' as const,
      path: 'src/b.ts',
      line: 2,
      existingCode: 'const b = risky();',
      title: '问题 B',
      body: '这个问题没有被 judge 分类。',
    },
  ];
  const judged = applyReviewJudge(findings, JSON.stringify({
    groups: [{
      member_ids: [0],
      representative_id: 0,
      confidence: 0.2,
      keep: false,
      root_cause: 'drop A',
      reason: 'not convincing',
    }],
  }), 0.7);

  assert.deepEqual(judged, findings);
});

test('L2 judge rejects malformed overlapping groups instead of silently losing findings', () => {
  const findings = [{
    severity: 'high' as const,
    path: 'src/a.ts',
    line: 1,
    existingCode: 'const a = risky();',
    title: '问题 A',
    body: '这是一个需要审查的问题。',
  }];
  assert.equal(
    applyReviewJudge(findings, JSON.stringify({
      groups: [
        { member_ids: [0], representative_id: 0, confidence: 0.9, keep: true },
        { member_ids: [0], representative_id: 0, confidence: 0.9, keep: true },
      ],
    })),
    null,
  );
  assert.equal(applyReviewJudge(findings, '{"groups":"nope"}'), null);
});

test('L2 judge threshold is strict and bounded', () => {
  assert.equal(reviewJudgeThreshold(undefined), 0.9);
  assert.equal(reviewJudgeThreshold('0'), 0);
  assert.equal(reviewJudgeThreshold('0.85'), 0.85);
  assert.equal(reviewJudgeThreshold('1.0'), 1);
  assert.equal(reviewJudgeThreshold('1.1'), 0.9);
  assert.equal(reviewJudgeThreshold('0.7oops'), 0.9);
});

const sweepFiles = [{
  path: 'src/auth.ts',
  patch: '@@ -10,2 +10,3 @@\n const input = request.body;\n+  const result = unsafeCall(input);\n return result;',
  rightLines: new Set([11]),
  sha: null,
}];

function sweepReview(existingCode: string) {
  return {
    model: 'm',
    provider: 'p',
    parsed: {
      summary: '发现问题。',
      findings: [{
        severity: 'high' as const,
        path: 'src/auth.ts',
        line: 11,
        existing_code: existingCode,
        title: '输入未经校验',
        body: '正常路径会把未经校验的输入传给下游调用。',
      }],
    },
  };
}

test('provider sweep excludes providers with unusable output until one verifies', async () => {
  const seen: string[][] = [];
  const outcomes: ReviewRouterOutcome[] = [
    { kind: 'invalid', provider: 'aihubmix' },
    { kind: 'ok', review: { ...sweepReview('not in the diff'), provider: 'orcarouter' } },
    { kind: 'ok', review: { ...sweepReview('  const result = unsafeCall(input);'), provider: 'openrouter' } },
  ];
  const result = await sweepReviewProviders((excluded) => {
    seen.push([...excluded]);
    return Promise.resolve<ReviewRouterOutcome>(outcomes.shift() ?? { kind: 'unavailable' });
  }, sweepFiles);

  assert.deepEqual(seen, [[], ['aihubmix'], ['aihubmix', 'orcarouter']]);
  assert.equal(result.disposition, 'publish');
  assert.equal(result.generated?.provider, 'openrouter');
  assert.equal(result.findings.length, 1);
});

test('provider sweep stops on an exhausted pool and keeps the last rejected review', async () => {
  const outcomes: ReviewRouterOutcome[] = [
    { kind: 'ok', review: { ...sweepReview('not in the diff'), provider: 'groq' } },
    { kind: 'unavailable' },
  ];
  const result = await sweepReviewProviders(
    () => Promise.resolve(outcomes.shift() ?? { kind: 'unavailable' }),
    sweepFiles,
  );
  assert.equal(result.attempts, 2);
  assert.equal(result.disposition, 'invalid_findings');
  assert.equal(result.generated?.provider, 'groq');
});

test('provider sweep accepts a clean review without asking anyone else', async () => {
  let calls = 0;
  const result = await sweepReviewProviders(() => {
    calls += 1;
    return Promise.resolve<ReviewRouterOutcome>({ kind: 'ok', review: { model: null, provider: 'vercel', parsed: { summary: '', findings: [] } } });
  }, sweepFiles);
  assert.equal(calls, 1);
  assert.equal(result.disposition, 'clean');
});

test('provider sweep cannot loop on an unidentified or repeated provider', async () => {
  let calls = 0;
  const unknown = await sweepReviewProviders(() => {
    calls += 1;
    return Promise.resolve<ReviewRouterOutcome>({ kind: 'invalid', provider: 'free-router' });
  }, sweepFiles);
  assert.equal(calls, 1);
  assert.equal(unknown.generated, null);

  calls = 0;
  await sweepReviewProviders(() => {
    calls += 1;
    return Promise.resolve<ReviewRouterOutcome>({ kind: 'invalid', provider: 'groq' });
  }, sweepFiles);
  assert.equal(calls, 2);
});

test('provider sweep respects attempt and time budgets', async () => {
  let calls = 0;
  let clock = 0;
  await sweepReviewProviders(() => {
    calls += 1;
    clock += 4 * 60_000;
    return Promise.resolve<ReviewRouterOutcome>({ kind: 'invalid', provider: `p${calls}` });
  }, sweepFiles, { now: () => clock });
  assert.equal(calls, 2);

  calls = 0;
  await sweepReviewProviders(() => {
    calls += 1;
    return Promise.resolve<ReviewRouterOutcome>({ kind: 'invalid', provider: `p${calls}` });
  }, sweepFiles, { maxAttempts: 3 });
  assert.equal(calls, 3);
});

test('provider sweep aborts a follow-up attempt at the sweep deadline', async () => {
  const signals: Array<AbortSignal | undefined> = [];
  const result = await sweepReviewProviders((_excluded, signal) => {
    signals.push(signal);
    if (!signal) return Promise.resolve<ReviewRouterOutcome>({ kind: 'invalid', provider: 'aihubmix' });
    return new Promise<ReviewRouterOutcome>((resolve) => {
      signal.addEventListener('abort', () => resolve({ kind: 'unavailable' }));
    });
  }, sweepFiles, { budgetMs: 20 });

  assert.equal(signals.length, 2);
  assert.equal(typeof signals[0], 'undefined');
  assert.equal(signals[1]?.aborted, true);
  assert.equal(result.generated, null);
});
