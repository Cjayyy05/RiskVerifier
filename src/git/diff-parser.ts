import type { ChangedFileStatus, DiffLineCount } from "../domain/index.js";

import { MalformedGitOutputError, UnsupportedGitChangeError } from "./errors.js";

export interface ParsedGitChangedFile {
  readonly path: string;
  readonly previousPath?: string;
  readonly status: ChangedFileStatus;
  readonly additions: DiffLineCount;
  readonly deletions: DiffLineCount;
  readonly isBinary: boolean;
}

interface ParsedStatus {
  readonly key: string;
  readonly path: string;
  readonly previousPath?: string;
  readonly status: ChangedFileStatus;
}

interface ParsedStatistics {
  readonly key: string;
  readonly additions: DiffLineCount;
  readonly deletions: DiffLineCount;
  readonly isBinary: boolean;
}

// A leading U+FEFF is part of a Git filename, not an encoding marker.
const utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function decodeField(value: Buffer): string {
  try {
    return utf8Decoder.decode(value);
  } catch {
    throw new MalformedGitOutputError("Git output contains invalid UTF-8");
  }
}

function splitNulFields(output: Buffer, label: string): readonly Buffer[] {
  if (output.length === 0) {
    return [];
  }
  if (output.at(-1) !== 0) {
    throw new MalformedGitOutputError(`${label} output is not NUL terminated`);
  }

  const fields: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] === 0) {
      fields.push(output.subarray(start, index));
      start = index + 1;
    }
  }
  return fields;
}

function changeKey(path: string, previousPath?: string): string {
  return previousPath === undefined ? `path\0${path}` : `pair\0${previousPath}\0${path}`;
}

function parseStatusToken(token: string): {
  readonly status: ChangedFileStatus;
  readonly hasTwoPaths: boolean;
} {
  const match = /^([A-Z])(\d{1,3})?$/u.exec(token);
  if (match === null) {
    throw new MalformedGitOutputError("Git name-status output contains an invalid status token");
  }
  const code = match[1];
  const score = match[2];
  if (score !== undefined && Number(score) > 100) {
    throw new MalformedGitOutputError("Git rename/copy score is outside the valid range");
  }

  switch (code) {
    case "A":
      if (score !== undefined) break;
      return { status: "ADDED", hasTwoPaths: false };
    case "M":
      if (score !== undefined) break;
      return { status: "MODIFIED", hasTwoPaths: false };
    case "D":
      if (score !== undefined) break;
      return { status: "DELETED", hasTwoPaths: false };
    case "T":
      if (score !== undefined) break;
      return { status: "TYPE_CHANGED", hasTwoPaths: false };
    case "U":
      if (score !== undefined) break;
      return { status: "UNMERGED", hasTwoPaths: false };
    case "R":
      if (score !== undefined) return { status: "RENAMED", hasTwoPaths: true };
      break;
    case "C":
      if (score !== undefined) return { status: "COPIED", hasTwoPaths: true };
      break;
    case "B":
    case "X":
      throw new UnsupportedGitChangeError(token);
    default:
      throw new UnsupportedGitChangeError(token);
  }
  throw new MalformedGitOutputError("Git status token has an invalid similarity score");
}

function parseNameStatus(output: Buffer): readonly ParsedStatus[] {
  const fields = splitNulFields(output, "name-status");
  const results: ParsedStatus[] = [];
  let index = 0;
  while (index < fields.length) {
    const statusField = fields[index++];
    if (statusField === undefined || statusField.length === 0) {
      throw new MalformedGitOutputError("Git name-status output is missing a status");
    }
    const parsedStatus = parseStatusToken(decodeField(statusField));
    const firstPathField = fields[index++];
    if (firstPathField === undefined || firstPathField.length === 0) {
      throw new MalformedGitOutputError("Git name-status output is missing a path");
    }
    const firstPath = decodeField(firstPathField);

    if (parsedStatus.hasTwoPaths) {
      const secondPathField = fields[index++];
      if (secondPathField === undefined || secondPathField.length === 0) {
        throw new MalformedGitOutputError("Git rename/copy output is missing its destination path");
      }
      const secondPath = decodeField(secondPathField);
      results.push({
        key: changeKey(secondPath, firstPath),
        path: secondPath,
        previousPath: firstPath,
        status: parsedStatus.status,
      });
    } else {
      results.push({
        key: changeKey(firstPath),
        path: firstPath,
        status: parsedStatus.status,
      });
    }
  }
  return results;
}

function parseLineCount(token: string): DiffLineCount {
  if (token === "-") {
    return null;
  }
  if (!/^(?:0|[1-9]\d*)$/u.test(token)) {
    throw new MalformedGitOutputError("Git numstat output contains an invalid line count");
  }
  const count = Number(token);
  if (!Number.isSafeInteger(count)) {
    throw new MalformedGitOutputError("Git numstat line count exceeds the safe integer range");
  }
  return count;
}

function parseStatisticsHeader(value: Buffer): {
  readonly additions: DiffLineCount;
  readonly deletions: DiffLineCount;
  readonly path: string;
} {
  const firstTab = value.indexOf(0x09);
  const secondTab = firstTab < 0 ? -1 : value.indexOf(0x09, firstTab + 1);
  if (firstTab < 0 || secondTab < 0) {
    throw new MalformedGitOutputError("Git numstat output is missing required tab delimiters");
  }

  const additions = parseLineCount(decodeField(value.subarray(0, firstTab)));
  const deletions = parseLineCount(decodeField(value.subarray(firstTab + 1, secondTab)));
  if ((additions === null) !== (deletions === null)) {
    throw new MalformedGitOutputError("Git numstat output has inconsistent binary line counts");
  }
  return {
    additions,
    deletions,
    path: decodeField(value.subarray(secondTab + 1)),
  };
}

function parseNumstat(output: Buffer): readonly ParsedStatistics[] {
  const fields = splitNulFields(output, "numstat");
  const results: ParsedStatistics[] = [];
  let index = 0;
  while (index < fields.length) {
    const header = fields[index++];
    if (header === undefined) {
      throw new MalformedGitOutputError("Git numstat output is incomplete");
    }
    const parsed = parseStatisticsHeader(header);
    let key: string;
    if (parsed.path.length === 0) {
      const previousPathField = fields[index++];
      const pathField = fields[index++];
      if (
        previousPathField === undefined ||
        previousPathField.length === 0 ||
        pathField === undefined ||
        pathField.length === 0
      ) {
        throw new MalformedGitOutputError("Git rename/copy numstat output is incomplete");
      }
      key = changeKey(decodeField(pathField), decodeField(previousPathField));
    } else {
      key = changeKey(parsed.path);
    }
    results.push({
      key,
      additions: parsed.additions,
      deletions: parsed.deletions,
      isBinary: parsed.additions === null,
    });
  }
  return results;
}

export function parseGitDiff(
  nameStatusOutput: Buffer,
  numstatOutput: Buffer,
): readonly ParsedGitChangedFile[] {
  const statuses = parseNameStatus(nameStatusOutput);
  if (new Set(statuses.map((status) => status.path)).size !== statuses.length) {
    throw new MalformedGitOutputError("Git status output contains contradictory destination paths");
  }
  if (statuses.some((status) => status.previousPath === status.path)) {
    throw new MalformedGitOutputError("Git rename/copy source and destination must differ");
  }
  const statistics = parseNumstat(numstatOutput);
  const statisticsByKey = new Map<string, ParsedStatistics>();
  for (const item of statistics) {
    if (statisticsByKey.has(item.key)) {
      throw new MalformedGitOutputError("Git numstat output contains a duplicate path");
    }
    statisticsByKey.set(item.key, item);
  }

  const results = statuses.map((status): ParsedGitChangedFile => {
    const itemStatistics = statisticsByKey.get(status.key);
    if (itemStatistics === undefined) {
      throw new MalformedGitOutputError(
        "Git status and numstat outputs do not describe the same paths",
      );
    }
    statisticsByKey.delete(status.key);
    return {
      path: status.path,
      ...(status.previousPath === undefined ? {} : { previousPath: status.previousPath }),
      status: status.status,
      additions: itemStatistics.additions,
      deletions: itemStatistics.deletions,
      isBinary: itemStatistics.isBinary,
    };
  });

  if (statisticsByKey.size > 0) {
    throw new MalformedGitOutputError(
      "Git numstat output contains paths absent from status output",
    );
  }
  results.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  return Object.freeze(results.map((result) => Object.freeze(result)));
}
