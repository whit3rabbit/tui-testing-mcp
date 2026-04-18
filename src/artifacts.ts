import * as fs from "fs";
import * as path from "path";
import type { Session, SessionIsolationState, SessionMode, SessionTraceEvent } from "./core/session.js";
import type { SecurityPolicyManager } from "./security/manager.js";

/** Bundle version for artifact discovery and compatibility checks. */
export const ARTIFACT_BUNDLE_VERSION = 1;
/** Directory segments used to root artifacts within the workspace. */
export const ARTIFACT_ROOT_SEGMENTS = ["artifacts", "tui-test"] as const;

/**
 * File and directory permissions for artifacts. Bundles can contain raw
 * terminal transcripts which may include credentials that leaked through
 * redaction, so restrict them to the owning user even on shared hosts.
 */
const ARTIFACT_FILE_MODE = 0o600;
const ARTIFACT_DIR_MODE = 0o700;
const MAX_RENDERED_SCREEN_BYTES = 1024 * 1024; // 1MB rendered HTML cap

/**
 * Default redactors applied to transcript and screen artifacts. These
 * scrub the most obvious token shapes before bytes hit disk. Callers can
 * extend via `security.artifactRedactions`.
 */
const DEFAULT_REDACTORS: ReadonlyArray<RegExp> = [
  // Provider-prefixed tokens (sk-*, ghp_*, xoxb-*, xoxp-*, etc.)
  /\b(?:sk|ghp|ghs|gho|xox[baprs])[-_][A-Za-z0-9]{20,}\b/g,
  // AWS access key IDs
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Bearer tokens in transcripts
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
  // password=...  /  password: ...
  /\bpassword\s*[:=]\s*\S+/gi,
  // api key style
  /\bapi[_-]?key\s*[:=]\s*\S+/gi,
];

const REDACTED = "[REDACTED]";

/** Map of artifact kind to its absolute path on disk. */
export interface ArtifactFileMap {
  metadata: string;
  trace: string;
  screen: string;
  transcript: string;
}

/** Metadata for a rendered HTML screenshot. */
export interface RenderedArtifactMetadata {
  format: "html";
  path: string;
  relativePath: string;
}

/** Full metadata for a captured session artifact bundle. */
export interface SessionArtifactMetadata {
  version: number;
  sessionId: string;
  capturedAt: string;
  mode: SessionMode;
  exitCode: number | null;
  dimensions: {
    cols: number;
    rows: number;
  };
  workspaceRoot: string;
  artifactDir: string;
  relativeArtifactDir: string;
  files: ArtifactFileMap;
  relativeFiles: ArtifactFileMap;
  traceEventCount: number;
  rendered?: RenderedArtifactMetadata;
  isolation?: SessionIsolationState;
}

/** Complete in-memory bundle of all artifacts for a session. */
export interface SessionArtifactBundle {
  metadata: SessionArtifactMetadata;
  trace: SessionTraceEvent[];
  screen: string;
  transcript: string;
  renderedScreen?: string;
}

/**
 * Capture all artifacts for a live or exited session into an in-memory bundle.
 * Does NOT write to disk - see {@link persistArtifacts}.
 */
export function captureArtifacts(session: Session, timestamp: number = Date.now()): SessionArtifactBundle {
  const trace = session.trace;
  return {
    metadata: buildArtifactMetadata(session, timestamp, trace.length),
    trace,
    screen: session.capture(false),
    transcript: session.transcript,
    ...(session.buffer ? { renderedScreen: session.buffer.getScreenHtml(MAX_RENDERED_SCREEN_BYTES) } : {}),
  };
}

/**
 * Write an artifact bundle to disk. Per-file permissions are tightened
 * and sensitive data is redacted using the session's security policy.
 */
export function persistArtifacts(
  bundle: SessionArtifactBundle,
  security: SecurityPolicyManager
): SessionArtifactMetadata {
  return persistArtifactFiles(bundle.metadata, bundle, security);
}

/**
 * Capture and write artifacts in a single step. Shorthand for
 * `persistArtifacts(captureArtifacts(session, timestamp), security)`.
 */
export function captureAndPersistArtifacts(
  session: Session,
  security: SecurityPolicyManager,
  timestamp?: number
): SessionArtifactMetadata {
  const metadata = buildArtifactMetadata(session, timestamp ?? Date.now(), session.traceEventCount);
  return persistSessionArtifactFiles(metadata, session, security);
}

/**
 * Redact sensitive substrings from an artifact string. Patterns that
 * fail to compile are dropped silently; a bad caller-supplied regex
 * should not break artifact capture.
 */
export function redactArtifact(text: string, patterns: ReadonlyArray<RegExp>): string {
  let out = text;
  for (const pattern of patterns) {
    out = replaceIfMatched(out, pattern);
  }
  return out;
}

/**
 * Recursively redact sensitive information from a trace event array.
 */
function redactTrace(trace: SessionTraceEvent[], patterns: ReadonlyArray<RegExp>): SessionTraceEvent[] {
  let redacted: SessionTraceEvent[] | undefined;

  for (const [index, event] of trace.entries()) {
    const details = recursiveRedact(event.details, patterns) as Record<string, unknown>;
    const nextEvent = details === event.details ? event : { ...event, details };

    if (redacted) {
      redacted.push(nextEvent);
      continue;
    }

    if (nextEvent !== event) {
      redacted = trace.slice(0, index);
      redacted.push(nextEvent);
    }
  }

  return redacted ?? trace;
}

/**
 * Deep-scans an object or array for string values and redacts them.
 */
function recursiveRedact(obj: unknown, patterns: ReadonlyArray<RegExp>): unknown {
  if (typeof obj === "string") {
    return redactArtifact(obj, patterns);
  }
  if (Array.isArray(obj)) {
    let redacted: unknown[] | undefined;

    for (const [index, item] of obj.entries()) {
      const next = recursiveRedact(item, patterns);
      if (redacted) {
        redacted.push(next);
        continue;
      }
      if (next !== item) {
        redacted = obj.slice(0, index);
        redacted.push(next);
      }
    }

    return redacted ?? obj;
  }
  if (obj !== null && typeof obj === "object") {
    let redacted: Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(obj)) {
      const next = recursiveRedact(value, patterns);
      if (redacted) {
        redacted[key] = next;
        continue;
      }
      if (next !== value) {
        redacted = { ...(obj as Record<string, unknown>) };
        redacted[key] = next;
      }
    }
    return redacted ?? obj;
  }
  return obj;
}

function replaceIfMatched(text: string, pattern: RegExp): string {
  pattern.lastIndex = 0;
  const matched = pattern.test(text);
  pattern.lastIndex = 0;
  if (!matched) {
    return text;
  }
  return text.replace(pattern, REDACTED);
}

function writeJsonFileSync(filePath: string, value: unknown, mode: number): void {
  const fd = fs.openSync(filePath, "w", mode);
  try {
    writeJsonValueSync(fd, value, 0);
    fs.writeSync(fd, "\n");
  } finally {
    fs.closeSync(fd);
  }
}

function writeJsonValueSync(fd: number, value: unknown, depth: number): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    fs.writeSync(fd, JSON.stringify(value));
    return;
  }

  if (Array.isArray(value)) {
    writeJsonArraySync(fd, value, depth);
    return;
  }

  if (value && typeof value === "object") {
    writeJsonObjectSync(fd, value as Record<string, unknown>, depth);
    return;
  }

  fs.writeSync(fd, "null");
}

function writeJsonArraySync(fd: number, value: unknown[], depth: number): void {
  if (value.length === 0) {
    fs.writeSync(fd, "[]");
    return;
  }

  fs.writeSync(fd, "[\n");
  for (const [index, item] of value.entries()) {
    fs.writeSync(fd, indent(depth + 1));
    writeJsonValueSync(fd, item ?? null, depth + 1);
    fs.writeSync(fd, index === value.length - 1 ? "\n" : ",\n");
  }
  fs.writeSync(fd, `${indent(depth)}]`);
}

function writeJsonObjectSync(fd: number, value: Record<string, unknown>, depth: number): void {
  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
  if (entries.length === 0) {
    fs.writeSync(fd, "{}");
    return;
  }

  fs.writeSync(fd, "{\n");
  for (const [index, [key, entryValue]] of entries.entries()) {
    fs.writeSync(fd, `${indent(depth + 1)}${JSON.stringify(key)}: `);
    writeJsonValueSync(fd, entryValue, depth + 1);
    fs.writeSync(fd, index === entries.length - 1 ? "\n" : ",\n");
  }
  fs.writeSync(fd, `${indent(depth)}}`);
}

function writeTraceEventsJsonFileSync(
  filePath: string,
  session: Session,
  redactors: ReadonlyArray<RegExp>,
  mode: number
): void {
  const fd = fs.openSync(filePath, "w", mode);
  try {
    if (session.traceEventCount === 0) {
      fs.writeSync(fd, "[]\n");
      return;
    }

    fs.writeSync(fd, "[\n");
    let index = 0;
    session.forEachTraceEvent((event) => {
      fs.writeSync(fd, indent(1));
      writeJsonValueSync(fd, redactTraceEvent(event, redactors), 1);
      fs.writeSync(fd, index === session.traceEventCount - 1 ? "\n" : ",\n");
      index += 1;
    });
    fs.writeSync(fd, "]\n");
  } finally {
    fs.closeSync(fd);
  }
}

function redactTraceEvent(event: SessionTraceEvent, patterns: ReadonlyArray<RegExp>): SessionTraceEvent {
  const details = recursiveRedact(event.details, patterns) as Record<string, unknown>;
  return details === event.details ? event : { ...event, details };
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}

function buildArtifactMetadata(
  session: Session,
  timestamp: number,
  traceEventCount: number = session.traceEventCount
): SessionArtifactMetadata {
  const artifactPaths = buildArtifactPaths(session.workspaceRoot, session.id, timestamp);
  const isolation = session.getIsolationMetadata();
  const rendered = session.buffer
    ? {
        format: "html" as const,
        path: artifactPaths.renderedScreen,
        relativePath: artifactPaths.relativeRenderedScreen,
      }
    : undefined;

  return {
    version: ARTIFACT_BUNDLE_VERSION,
    sessionId: session.id,
    capturedAt: new Date(timestamp).toISOString(),
    mode: session.mode,
    exitCode: session.pty.exitCode,
    dimensions: {
      cols: session.info.cols,
      rows: session.info.rows,
    },
    workspaceRoot: session.workspaceRoot,
    artifactDir: artifactPaths.artifactDir,
    relativeArtifactDir: artifactPaths.relativeArtifactDir,
    files: artifactPaths.files,
    relativeFiles: artifactPaths.relativeFiles,
    traceEventCount,
    ...(rendered ? { rendered } : {}),
    ...(isolation ? { isolation } : {}),
  };
}

function persistSessionArtifactFiles(
  metadata: SessionArtifactMetadata,
  session: Session,
  security: SecurityPolicyManager
): SessionArtifactMetadata {
  security.checkWorkspace(metadata.artifactDir);

  const redactors = buildRedactors(security.policy.artifactRedactions);
  fs.mkdirSync(metadata.artifactDir, { recursive: true, mode: ARTIFACT_DIR_MODE });

  writeTraceEventsJsonFileSync(metadata.files.trace, session, redactors, ARTIFACT_FILE_MODE);
  fs.writeFileSync(metadata.files.screen, redactArtifact(session.capture(false), redactors), {
    encoding: "utf-8",
    mode: ARTIFACT_FILE_MODE,
  });
  fs.writeFileSync(metadata.files.transcript, redactArtifact(session.transcript, redactors), {
    encoding: "utf-8",
    mode: ARTIFACT_FILE_MODE,
  });
  if (metadata.rendered && session.buffer) {
    fs.writeFileSync(
      metadata.rendered.path,
      boundRenderedScreen(redactArtifact(session.buffer.getScreenHtml(MAX_RENDERED_SCREEN_BYTES), redactors)),
      {
        encoding: "utf-8",
        mode: ARTIFACT_FILE_MODE,
      }
    );
  }
  writeJsonFileSync(metadata.files.metadata, metadata, ARTIFACT_FILE_MODE);

  applyRetentionPolicy(metadata, security);
  return metadata;
}

function persistArtifactFiles(
  metadata: SessionArtifactMetadata,
  content: {
    trace: SessionTraceEvent[];
    screen: string;
    transcript: string;
    renderedScreen?: string;
  },
  security: SecurityPolicyManager
): SessionArtifactMetadata {
  security.checkWorkspace(metadata.artifactDir);

  const redactors = buildRedactors(security.policy.artifactRedactions);
  fs.mkdirSync(metadata.artifactDir, { recursive: true, mode: ARTIFACT_DIR_MODE });

  writeJsonFileSync(metadata.files.trace, redactTrace(content.trace, redactors), ARTIFACT_FILE_MODE);
  fs.writeFileSync(metadata.files.screen, redactArtifact(content.screen, redactors), {
    encoding: "utf-8",
    mode: ARTIFACT_FILE_MODE,
  });
  fs.writeFileSync(metadata.files.transcript, redactArtifact(content.transcript, redactors), {
    encoding: "utf-8",
    mode: ARTIFACT_FILE_MODE,
  });
  if (metadata.rendered && content.renderedScreen !== undefined) {
    fs.writeFileSync(metadata.rendered.path, boundRenderedScreen(redactArtifact(content.renderedScreen, redactors)), {
      encoding: "utf-8",
      mode: ARTIFACT_FILE_MODE,
    });
  }
  writeJsonFileSync(metadata.files.metadata, metadata, ARTIFACT_FILE_MODE);

  applyRetentionPolicy(metadata, security);
  return metadata;
}

function boundRenderedScreen(renderedScreen: string): string {
  const bytes = Buffer.byteLength(renderedScreen, "utf8");
  if (bytes <= MAX_RENDERED_SCREEN_BYTES) {
    return renderedScreen;
  }

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    "  <title>Rendered snapshot omitted</title>",
    "</head>",
    "<body>",
    `  <pre>Rendered snapshot omitted: exceeded ${MAX_RENDERED_SCREEN_BYTES} bytes after redaction (${bytes} bytes).</pre>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function buildRedactors(extra?: ReadonlyArray<string>): RegExp[] {
  const result: RegExp[] = [...DEFAULT_REDACTORS];
  if (!extra) return result;
  for (const src of extra) {
    // Fail closed on invalid patterns - silent skipping is a security risk
    // because callers may incorrectly believe their redactions are active.
    try {
      result.push(new RegExp(src, "g"));
    } catch (cause) {
      throw new Error(
        `Invalid artifact redaction pattern: ${src}. ` +
        `Patterns must be valid JavaScript regex syntax.`,
        { cause }
      );
    }
  }
  return result;
}

/**
 * Delete sibling bundles per retention policy. Retention is bounded to
 * the session's own artifact subtree and guarded by checkWorkspace so a
 * misconfigured policy can't walk out of the workspace.
 */
function applyRetentionPolicy(metadata: SessionArtifactMetadata, security: SecurityPolicyManager): void {
  const retention = security.policy.artifactRetention;
  if (!retention || (!retention.maxAgeHours && !retention.maxBundles)) {
    return;
  }

  const sessionRoot = path.dirname(metadata.artifactDir);
  try {
    security.checkWorkspace(sessionRoot);
  } catch {
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sessionRoot, { withFileTypes: true });
  } catch {
    return;
  }

  const bundles = entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const full = path.join(sessionRoot, e.name);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(full).mtimeMs;
      } catch {
        // fall through with mtimeMs=0
      }
      return { path: full, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const now = Date.now();
  const keep = new Set<string>();

  if (retention.maxBundles && retention.maxBundles > 0) {
    for (const b of bundles.slice(0, retention.maxBundles)) {
      keep.add(b.path);
    }
  } else {
    for (const b of bundles) keep.add(b.path);
  }

  for (const b of bundles) {
    let drop = false;
    if (!keep.has(b.path)) drop = true;
    if (retention.maxAgeHours && retention.maxAgeHours > 0) {
      const ageMs = now - b.mtimeMs;
      if (ageMs > retention.maxAgeHours * 60 * 60 * 1000) drop = true;
    }
    // Never delete the bundle we just wrote, even if maxAgeHours would
    // otherwise cull it (clock skew between the session and the FS).
    if (b.path === metadata.artifactDir) drop = false;
    if (drop) {
      try {
        fs.rmSync(b.path, { recursive: true, force: true });
      } catch {
        // Best-effort: if we can't remove it, leave it and move on.
      }
    }
  }
}

function buildArtifactPaths(
  workspaceRoot: string,
  sessionId: string,
  timestamp: number
): {
  artifactDir: string;
  relativeArtifactDir: string;
  files: ArtifactFileMap;
  relativeFiles: ArtifactFileMap;
  renderedScreen: string;
  relativeRenderedScreen: string;
} {
  const safeSessionId = sanitizePathSegment(sessionId);
  const timestampDir = formatTimestamp(timestamp);
  const relativeArtifactDir = path.join(...ARTIFACT_ROOT_SEGMENTS, safeSessionId, timestampDir);
  const artifactDir = path.join(workspaceRoot, relativeArtifactDir);
  const relativeFiles = {
    metadata: path.join(relativeArtifactDir, "metadata.json"),
    trace: path.join(relativeArtifactDir, "trace.json"),
    screen: path.join(relativeArtifactDir, "screen.txt"),
    transcript: path.join(relativeArtifactDir, "transcript.ansi"),
  };
  const relativeRenderedScreen = path.join(relativeArtifactDir, "screen.html");

  return {
    artifactDir,
    relativeArtifactDir,
    renderedScreen: path.join(artifactDir, "screen.html"),
    relativeRenderedScreen,
    files: {
      metadata: path.join(artifactDir, "metadata.json"),
      trace: path.join(artifactDir, "trace.json"),
      screen: path.join(artifactDir, "screen.txt"),
      transcript: path.join(artifactDir, "transcript.ansi"),
    },
    relativeFiles,
  };
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/[:.]/g, "-");
}
