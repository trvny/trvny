import assert from 'node:assert/strict';
import test from 'node:test';

import { CodedError, DetailedCodedError } from '../src/tools/common.ts';
import { ZipEntryError } from '../src/zip-entry.ts';

class AlphaError extends CodedError {}
class BetaError extends DetailedCodedError {}

test('coded errors keep code, status, subclass name and instanceof scoping', () => {
  const alpha = new AlphaError('alpha_failed');
  assert.equal(alpha.code, 'alpha_failed');
  assert.equal(alpha.message, 'alpha_failed');
  assert.equal(alpha.status, 400);
  assert.equal(alpha.name, 'AlphaError');
  assert.ok(alpha instanceof AlphaError && alpha instanceof CodedError && alpha instanceof Error);
  assert.ok(!(alpha instanceof BetaError));

  const beta = new BetaError('beta_failed', 409, { head: 'abc' });
  assert.equal(beta.status, 409);
  assert.deepEqual(beta.details, { head: 'abc' });
  assert.deepEqual(new BetaError('x').details, {});
  assert.ok(!(beta instanceof AlphaError));
});

test('per-module default status survives the base class', () => {
  const error = new ZipEntryError('zip_invalid');
  assert.equal(error.status, 422);
  assert.equal(error.name, 'ZipEntryError');
});
