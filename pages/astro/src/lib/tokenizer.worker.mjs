const loadEncodings = {
  o200k_base: () => import('gpt-tokenizer/encoding/o200k_base'),
  cl100k_base: () => import('gpt-tokenizer/encoding/cl100k_base'),
};

self.addEventListener('message', async ({ data }) => {
  const { encoding, text, revision } = data;
  try {
    if (!Object.hasOwn(loadEncodings, encoding) || typeof text !== 'string' || text.length > 20_000) {
      throw new Error('Invalid tokenizer input');
    }
    const { encode } = await loadEncodings[encoding]();
    const ids = encode(text, { disallowedSpecial: new Set() });
    self.postMessage({ revision, count: ids.length, ids: ids.slice(0, 64) });
  } catch {
    self.postMessage({ revision, error: true });
  }
});
