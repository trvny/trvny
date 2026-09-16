import assert from "node:assert/strict";
import test from "node:test";
import { autkaVerdict, feedVerdict } from "../src/status-logic.ts";

test("feeds degrades when registry or inventory cannot be checked", () => {
  assert.equal(feedVerdict({ pipelineOk: true, registryAvailable: false, inventoryAvailable: false, missing: 0, tiny: 0 }), "degraded");
  assert.equal(feedVerdict({ pipelineOk: true, registryAvailable: true, inventoryAvailable: false, missing: 0, tiny: 0 }), "degraded");
});

test("feeds keeps existing pipeline and content failure semantics", () => {
  assert.equal(feedVerdict({ pipelineOk: false, registryAvailable: true, inventoryAvailable: true, missing: 0, tiny: 0 }), "down");
  assert.equal(feedVerdict({ pipelineOk: true, registryAvailable: true, inventoryAvailable: true, missing: 1, tiny: 0 }), "degraded");
  assert.equal(feedVerdict({ pipelineOk: true, registryAvailable: true, inventoryAvailable: true, missing: 0, tiny: 0 }), "ok");
});

test("autka degrades when feature endpoints are unavailable", () => {
  assert.equal(autkaVerdict({ healthy: true, offersAvailable: false, sourcesAvailable: false, offers: null }), "degraded");
  assert.equal(autkaVerdict({ healthy: true, offersAvailable: true, sourcesAvailable: false, offers: 42 }), "degraded");
});

test("autka distinguishes backend failure, empty offers and healthy service", () => {
  assert.equal(autkaVerdict({ healthy: false, offersAvailable: false, sourcesAvailable: false, offers: null }), "down");
  assert.equal(autkaVerdict({ healthy: true, offersAvailable: true, sourcesAvailable: true, offers: 0 }), "degraded");
  assert.equal(autkaVerdict({ healthy: true, offersAvailable: true, sourcesAvailable: true, offers: 42 }), "ok");
});
