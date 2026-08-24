import assert from "node:assert/strict";
import jsoncParser from "jsonc-parser";

const { parseTree } = jsoncParser;
const source = `{
  "huge": 9007199254740993,
  "exponent": 1e400,
  "escaped": "\\u0061"
}`;
const errors = [];
const root = parseTree(source, errors, {
  allowTrailingComma: false,
  disallowComments: true,
});

assert.ok(root);
assert.deepEqual(errors, []);
assert.equal(root.type, "object");

function propertyValue(name) {
  const property = root.children.find((node) => node.children?.[0]?.value === name);
  assert.ok(property, `missing ${name} property`);
  return property.children[1];
}

function lexeme(node) {
  return source.slice(node.offset, node.offset + node.length);
}

assert.equal(lexeme(propertyValue("huge")), "9007199254740993");
assert.equal(lexeme(propertyValue("exponent")), "1e400");
assert.equal(lexeme(propertyValue("escaped")), '"\\u0061"');
assert.notEqual(JSON.parse(source).huge.toString(), lexeme(propertyValue("huge")));

console.log("Doc Bench document preview tests passed.");
