import assert from "node:assert";
import { hasProposalWithTitle } from "./snapshotUtils";

const TITLE = "BlackPool DAO — Final Wind-Down and Treasury Distribution";

// Existing active proposal with the same title -> duplicate detected, mirror skips.
assert.strictEqual(
    hasProposalWithTitle([{ title: "Other" }, { title: TITLE }], TITLE),
    true,
    "should detect an existing proposal with the same title",
);

// No existing proposals -> not a duplicate.
assert.strictEqual(
    hasProposalWithTitle([], TITLE),
    false,
    "empty space should not report a duplicate",
);

// Only different titles -> not a duplicate.
assert.strictEqual(
    hasProposalWithTitle([{ title: "Something else" }], TITLE),
    false,
    "different titles should not match",
);

console.log("dedup.test.ts: all assertions passed");
