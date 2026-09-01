import assert from 'node:assert/strict';
import test from 'node:test';

import { gptomekRepositoryAllowed } from '../src/gptomek.ts';

test('allows GPTomek targets only in maintained owners', () => {
  assert.equal(gptomekRepositoryAllowed('trvny/feedseek'), true);
  assert.equal(gptomekRepositoryAllowed('twojstar/llmbench'), true);

  assert.equal(gptomekRepositoryAllowed('someone/llmbench'), false);
  assert.equal(gptomekRepositoryAllowed('twojstar/llmbench/extra'), false);
  assert.equal(gptomekRepositoryAllowed('twojstar/'), false);
});
