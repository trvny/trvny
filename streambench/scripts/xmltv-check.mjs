import { formatProgramme, parseXmltvDate, scheduleForChannel } from "../public/xmltv.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(parseXmltvDate("20260726120000 +0200") === Date.UTC(2026, 6, 26, 10, 0, 0), "positive XMLTV offset mismatch");
assert(parseXmltvDate("20260726120000 -0500") === Date.UTC(2026, 6, 26, 17, 0, 0), "negative XMLTV offset mismatch");
assert(parseXmltvDate("bad") === null, "invalid XMLTV date was accepted");

const programmes = new Map([["channel.one", [
  { channel: "channel.one", start: 1_000, stop: 2_000, title: "Now" },
  { channel: "channel.one", start: 2_000, stop: 3_000, title: "Next" },
]]]);
const schedule = scheduleForChannel(programmes, "channel.one", 1_500);
assert(schedule.current?.title === "Now", "current programme mismatch");
assert(schedule.next?.title === "Next", "next programme mismatch");
assert(formatProgramme(schedule.current).includes("Now"), "programme formatting mismatch");
assert(scheduleForChannel(programmes, "missing", 1_500).current === null, "missing channel should be empty");

console.log("XMLTV checks passed");
