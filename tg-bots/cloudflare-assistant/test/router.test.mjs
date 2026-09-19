import assert from "node:assert/strict";
import test from "node:test";

import {
  definePredicateRoute,
  routeFirst,
} from "../src/router.ts";

test("routes to the first matching predicate", async () => {
  const calls = [];
  const routes = [
    definePredicateRoute(
      "first",
      (context) => context.value === 1 ? context.value : undefined,
      (_context, match) => {
        calls.push("first");
        return `first:${match}`;
      },
    ),
    definePredicateRoute(
      "second",
      () => true,
      () => {
        calls.push("second");
        return "second";
      },
    ),
  ];

  assert.deepEqual(await routeFirst({ value: 1 }, routes), {
    matched: true,
    route: "first",
    value: "first:1",
  });
  assert.deepEqual(calls, ["first"]);
});

test("passes extracted match data to the typed handler", async () => {
  const route = definePredicateRoute(
    "task",
    ({ callback }) => callback.startsWith("task:")
      ? { taskId: callback.slice(5), action: "refresh" }
      : undefined,
    (_context, match) => `${match.action}:${match.taskId}`,
  );

  assert.deepEqual(await routeFirst(
    { callback: "task:abc" },
    [route],
  ), {
    matched: true,
    route: "task",
    value: "refresh:abc",
  });
});

test("a matched route may return null without falling through", async () => {
  let fallbackCalled = false;
  const routes = [
    definePredicateRoute(
      "handled-without-reply",
      () => true,
      () => null,
    ),
    definePredicateRoute(
      "fallback",
      () => true,
      () => {
        fallbackCalled = true;
        return "fallback";
      },
    ),
  ];

  assert.deepEqual(await routeFirst({}, routes), {
    matched: true,
    route: "handled-without-reply",
    value: null,
  });
  assert.equal(fallbackCalled, false);
});

test("reports a clean miss when no predicate matches", async () => {
  const route = definePredicateRoute(
    "never",
    () => undefined,
    () => "nope",
  );

  assert.deepEqual(await routeFirst({}, [route]), { matched: false });
});

test("rejects unnamed routes", () => {
  assert.throws(
    () => definePredicateRoute("   ", () => true, () => "nope"),
    /route name must not be empty/u,
  );
});
