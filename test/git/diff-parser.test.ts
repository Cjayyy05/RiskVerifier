import assert from "node:assert/strict";
import test from "node:test";

import { parseGitDiff } from "../../src/git/diff-parser.js";
import { MalformedGitOutputError, UnsupportedGitChangeError } from "../../src/git/errors.js";

function nulFields(...fields: readonly string[]): Buffer {
  return Buffer.from(`${fields.join("\0")}\0`, "utf8");
}

void test("parses NUL-delimited paths, rename pairs, binary counts, and type changes", () => {
  const nameStatus = nulFields(
    "A",
    "file with spaces.txt",
    "M",
    "ユニコード\nname.txt",
    "R090",
    "-old\tname.txt",
    "new\nname.txt",
    "C100",
    "source.txt",
    "copy.txt",
    "T",
    "link",
    "M",
    "binary.bin",
  );
  const numstat = nulFields(
    "1\t0\tfile with spaces.txt",
    "2\t1\tユニコード\nname.txt",
    "3\t2\t",
    "-old\tname.txt",
    "new\nname.txt",
    "0\t0\t",
    "source.txt",
    "copy.txt",
    "0\t0\tlink",
    "-\t-\tbinary.bin",
  );

  assert.deepEqual(
    parseGitDiff(nameStatus, numstat),
    [
      {
        path: "file with spaces.txt",
        status: "ADDED",
        additions: 1,
        deletions: 0,
        isBinary: false,
      },
      {
        path: "ユニコード\nname.txt",
        status: "MODIFIED",
        additions: 2,
        deletions: 1,
        isBinary: false,
      },
      {
        path: "new\nname.txt",
        previousPath: "-old\tname.txt",
        status: "RENAMED",
        additions: 3,
        deletions: 2,
        isBinary: false,
      },
      {
        path: "copy.txt",
        previousPath: "source.txt",
        status: "COPIED",
        additions: 0,
        deletions: 0,
        isBinary: false,
      },
      {
        path: "link",
        status: "TYPE_CHANGED",
        additions: 0,
        deletions: 0,
        isBinary: false,
      },
      {
        path: "binary.bin",
        status: "MODIFIED",
        additions: null,
        deletions: null,
        isBinary: true,
      },
    ].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))),
  );
});

void test("preserves BOM-prefixed filenames, rejects invalid UTF-8 and reconciles shuffled streams", () => {
  const result = parseGitDiff(
    nulFields("M", "\uFEFFfile", "M", "file"),
    nulFields("1\t0\tfile", "2\t0\t\uFEFFfile"),
  );
  assert.deepEqual(
    result.map((item) => [item.path, item.additions]),
    [
      ["file", 1],
      ["\uFEFFfile", 2],
    ],
  );
  for (const bytes of [[0xff], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xe2, 0x82]]) {
    const name = Buffer.concat([Buffer.from("M\0"), Buffer.from(bytes), Buffer.from([0])]);
    assert.throws(() => parseGitDiff(name, nulFields("1\t0\tfile")), MalformedGitOutputError);
    const stats = Buffer.concat([Buffer.from("1\t0\t"), Buffer.from(bytes), Buffer.from([0])]);
    assert.throws(() => parseGitDiff(nulFields("M", "file"), stats), MalformedGitOutputError);
  }
  assert.deepEqual(parseGitDiff(nulFields("M", " "), nulFields("0\t0\t "))[0]?.path, " ");
});

void test("rejects truncated, excess, duplicate and contradictory records", () => {
  for (const [status, stats] of [
    [nulFields("R100", "old"), nulFields("0\t0\t", "old", "new")],
    [nulFields("M", "file", "extra"), nulFields("0\t0\tfile")],
    [nulFields("M", "file", "M", "file"), nulFields("0\t0\tfile")],
    [nulFields("M", "file"), nulFields("0\t0\tfile", "0\t0\tfile")],
    [nulFields("M", "new", "R100", "old", "new"), nulFields("0\t0\tnew", "0\t0\t", "old", "new")],
    [nulFields("C100", "same", "same"), nulFields("0\t0\t", "same", "same")],
  ] as const)
    assert.throws(() => parseGitDiff(status, stats), MalformedGitOutputError);
});

void test("fails closed on malformed, mismatched, oversized, and unsupported output", () => {
  assert.throws(
    () => parseGitDiff(Buffer.from("M\0file"), nulFields("1\t0\tfile")),
    MalformedGitOutputError,
  );
  assert.throws(
    () => parseGitDiff(nulFields("M", "file"), nulFields("1\t0\tother")),
    MalformedGitOutputError,
  );
  assert.throws(
    () => parseGitDiff(nulFields("M", "file"), nulFields("-\t0\tfile")),
    MalformedGitOutputError,
  );
  assert.throws(
    () => parseGitDiff(nulFields("M", "file"), nulFields(`${Number.MAX_SAFE_INTEGER}0\t0\tfile`)),
    MalformedGitOutputError,
  );
  assert.throws(
    () => parseGitDiff(nulFields("X", "file"), nulFields("0\t0\tfile")),
    UnsupportedGitChangeError,
  );
});
