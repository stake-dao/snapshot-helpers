import assert from "node:assert";
import { DUPLICATE_WINDOW, hasProposalWithTitle } from "./snapshotUtils";

const TITLE = "BlackPool DAO — Final Wind-Down and Treasury Distribution";
const NOW = 1786384727;

// Existing active proposal with the same title, created just now -> duplicate
// detected, mirror skips.
assert.strictEqual(
    hasProposalWithTitle([{ title: "Other", created: NOW }, { title: TITLE, created: NOW - 30 }], TITLE, NOW),
    true,
    "should detect an existing proposal with the same title",
);

// No existing proposals -> not a duplicate.
assert.strictEqual(
    hasProposalWithTitle([], TITLE, NOW),
    false,
    "empty space should not report a duplicate",
);

// Only different titles -> not a duplicate.
assert.strictEqual(
    hasProposalWithTitle([{ title: "Something else", created: NOW }], TITLE, NOW),
    false,
    "different titles should not match",
);

// Same title but created outside the window -> another source vote reusing the
// same text, it must still be mirrored.
assert.strictEqual(
    hasProposalWithTitle([{ title: TITLE, created: NOW - DUPLICATE_WINDOW - 1 }], TITLE, NOW),
    false,
    "same title created outside the window should not be treated as a duplicate",
);

// Edge of the window is still considered a duplicate.
assert.strictEqual(
    hasProposalWithTitle([{ title: TITLE, created: NOW - DUPLICATE_WINDOW }], TITLE, NOW),
    true,
    "a proposal created exactly at the window bound is a duplicate",
);

// Hub indexing can report a created timestamp slightly ahead of our clock.
assert.strictEqual(
    hasProposalWithTitle([{ title: TITLE, created: NOW + 60 }], TITLE, NOW),
    true,
    "clock skew should not defeat the guard",
);

console.log("dedup.test.ts: all assertions passed");
