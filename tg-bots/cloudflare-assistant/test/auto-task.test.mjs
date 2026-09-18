import assert from "node:assert/strict";
import test from "node:test";

import { automaticTaskRequest, looksLikeAutomaticTaskCandidate } from "../src/auto-task.ts";

test("prefilters only action-like ordinary text", () => {
  assert.equal(looksLikeAutomaticTaskCandidate("sprawdź trvny/trvny i odpal testy"), true);
  assert.equal(looksLikeAutomaticTaskCandidate("napraw trvny"), true);
  assert.equal(looksLikeAutomaticTaskCandidate("co sądzisz o trvny/trvny?"), false);
  assert.equal(looksLikeAutomaticTaskCandidate("/task trvny test"), false);
});

test("routes explicit owner/repo paths only when the repo alias is configured", () => {
  assert.deepEqual(
    automaticTaskRequest("sprawdź trvny/feedseek i odpal testy", ["feedseek", "trvny"]),
    { repo: "feedseek", goal: "sprawdź trvny/feedseek i odpal testy", profile: "inspect" },
  );
  assert.equal(automaticTaskRequest("sprawdź trvny/feedseek", ["trvny"]), null);
});

test("routes a configured bare alias and infers write profile conservatively", () => {
  assert.deepEqual(
    automaticTaskRequest("napraw trvny i uruchom testy", ["trvny"]),
    { repo: "trvny", goal: "napraw trvny i uruchom testy", profile: "code" },
  );
  assert.deepEqual(
    automaticTaskRequest("zaudytuj trvny", ["trvny"]),
    { repo: "trvny", goal: "zaudytuj trvny", profile: "inspect" },
  );
});

test("does not route unrelated action requests without a configured repo mention", () => {
  assert.equal(automaticTaskRequest("sprawdź pogodę na jutro", ["trvny"]), null);
  assert.equal(automaticTaskRequest("uruchom timer na 5 minut", ["trvny"]), null);
});
