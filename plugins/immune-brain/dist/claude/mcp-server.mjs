import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// plugins/immune-brain/runtime/claude/mcp_server.ts
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";

// plugins/immune-brain/runtime/claude/capability.ts
var MIN_CLAUDE_CODE_VERSION = "2.1.199";
var HOST_ID = "claude-code";
var CORE_CONTRACT = "assurance_kernel/host_adapter/claude-code/v1";
function parseSemver(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value.trim());
  if (!match)
    return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b)
    throw new Error(`invalid semver: ${!a ? left : right}`);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
function parsePermissionMode(raw) {
  if (raw === "manual" || raw === "acceptEdits" || raw === "auto" || raw === "bypassPermissions" || raw === "dontAsk")
    return raw;
  return null;
}
function probeHost(env = process.env, platform = process.platform, hostVersion) {
  const version = hostVersion ?? env.CLAUDE_CODE_VERSION ?? env.CLAUDE_CLI_VERSION;
  if (!version)
    return { ok: false, reason: "Claude Code version is unavailable" };
  if (!parseSemver(version))
    return { ok: false, reason: `Claude Code version is invalid: ${version}` };
  if (compareSemver(version, MIN_CLAUDE_CODE_VERSION) < 0) {
    return {
      ok: false,
      reason: `Claude Code ${version} is below the minimum supported ${MIN_CLAUDE_CODE_VERSION}`
    };
  }
  if (platform !== "darwin" && platform !== "linux") {
    return { ok: false, reason: `unsupported platform ${platform}; native Windows is out of scope` };
  }
  const rawPermissionMode = env.CLAUDE_CODE_PERMISSION_MODE;
  if (rawPermissionMode !== undefined && rawPermissionMode !== "") {
    const permissionMode = parsePermissionMode(rawPermissionMode);
    if (!permissionMode)
      return { ok: false, reason: `unsupported permission mode ${rawPermissionMode}` };
    return { ok: true, version, permissionMode, platform };
  }
  return { ok: true, version, permissionMode: "manual", platform };
}

// plugins/immune-brain/runtime/plugin_version.ts
var PLUGIN_VERSION = "3.2.2";

// plugins/immune-brain/runtime/claude/interaction.ts
import { createHash, randomUUID } from "node:crypto";
var PRIVILEGED_OPERATIONS = [
  "enroll",
  "request_authorization",
  "approve_breaking_intent_revision",
  "stop"
];
function isPrivilegedOperation(operation) {
  return PRIVILEGED_OPERATIONS.includes(operation);
}
function privilegedAnnotations() {
  return {
    destructiveHint: true,
    "anthropic/requiresUserInteraction": true
  };
}
function evaluateNativeGate(input) {
  if (!isPrivilegedOperation(input.operation))
    return { ok: true };
  if (!input.interactive)
    return { ok: false, reason: "non-interactive execution cannot mint authority" };
  const mode = parsePermissionMode(input.permissionMode);
  if (!mode)
    return { ok: false, reason: `unsupported permission mode ${String(input.permissionMode)}` };
  if (mode === "dontAsk")
    return { ok: false, reason: "dontAsk cannot mint authority" };
  if (!input.requiresUserInteraction) {
    return { ok: false, reason: "privileged operation requires anthropic/requiresUserInteraction" };
  }
  if (input.decision === "deny")
    return { ok: false, reason: "native interaction denied" };
  if (input.decision === "cancel")
    return { ok: false, reason: "native interaction cancelled" };
  if (input.decision !== "accept")
    return { ok: false, reason: "native interaction missing" };
  return { ok: true };
}
function confirmationRef(input) {
  return `claude-confirm-${createHash("sha256").update(`${input.sessionId}\x00${input.toolCallId}\x00${input.operation}\x00${input.taskId}\x00${input.intentRevision ?? ""}\x00${input.intentContentHash ?? ""}\x00${input.bindingDigest ?? ""}`).digest("hex").slice(0, 16)}`;
}
function enrollmentNonce() {
  return randomUUID();
}

// plugins/immune-brain/runtime/claude/review_host.ts
import { createHash as createHash2 } from "node:crypto";
import { constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, rmSync, writeSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
var REVIEWER_AGENT = "immune-brain-reviewer";
var CLAUDE_REVIEWER_AGENT = "immune-brain:immune-brain-reviewer";
var AGENT_TOOL = "Agent";

class MemoryHookEventLog {
  events = [];
  consumed = [];
  append(event) {
    this.events.push(event);
    return true;
  }
  list(sessionId) {
    return sessionId ? this.events.filter((event) => event.sessionId === sessionId) : [...this.events];
  }
  sessions() {
    return [...new Set(this.events.map((event) => event.sessionId))];
  }
  clear(sessionId) {
    if (!sessionId) {
      this.events.length = 0;
      return;
    }
    for (let i = this.events.length - 1;i >= 0; i--) {
      if (this.events[i].sessionId === sessionId)
        this.events.splice(i, 1);
    }
  }
  consumeElicitation(sessionId, toolCallId) {
    this.consumed.push(`${sessionId}\x00${toolCallId}`);
    this.events.push({ type: "ElicitationConsumed", sessionId, toolCallId });
    return true;
  }
  consumedKeys() {
    return [...this.consumed];
  }
}
var CACHE_DIR = "immune-brain-claude";
var CONSUMED_FILE = "consumed.jsonl";
var CONSUMED_DIR = "consumed";
function sessionHash(sessionId) {
  return createHash2("sha256").update(sessionId).digest("hex");
}
function cacheDir(root) {
  return join(root, CACHE_DIR);
}
function ownedByUs(stat) {
  if (stat.isSymbolicLink())
    return false;
  const uid = process.getuid?.();
  return uid === undefined || stat.uid === uid;
}
function ensurePrivateDir(dir) {
  try {
    const existing = lstatSync(dir);
    return existing.isDirectory() && ownedByUs(existing) && (existing.mode & 511) === 448;
  } catch (error) {
    if (error.code !== "ENOENT")
      return false;
  }
  try {
    mkdirSync(dir, { mode: 448 });
  } catch {
    return false;
  }
  try {
    const created = lstatSync(dir);
    return created.isDirectory() && ownedByUs(created) && (created.mode & 511) === 448;
  } catch {
    return false;
  }
}
function claimAtomicKey(dir, keyName) {
  const claimsDir = join(dir, CONSUMED_DIR);
  if (!ensurePrivateDir(claimsDir))
    return false;
  const claimPath = join(claimsDir, `${keyName}.claim`);
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  let fd;
  try {
    fd = openSync(claimPath, flags, 384);
  } catch (error) {
    return false;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || !ownedByUs(stat) || (stat.mode & 511) !== 384)
      return false;
    return true;
  } finally {
    closeSync(fd);
  }
}
function appendPrivate(path, dir, line) {
  if (!ensurePrivateDir(dir))
    return false;
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  let fd;
  try {
    fd = openSync(path, flags, 384);
  } catch {
    return false;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || !ownedByUs(stat) || (stat.mode & 511) !== 384)
      return false;
    return writeSync(fd, line) === Buffer.byteLength(line);
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}
function readPrivate(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || !ownedByUs(stat) || (stat.mode & 511) !== 384)
      return;
    const buf = Buffer.alloc(stat.size);
    readSync(fd, buf, 0, stat.size, 0);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}
function hookEventPath(sessionId, root = tmpdir()) {
  return join(cacheDir(root), `${sessionHash(sessionId)}.jsonl`);
}

class FileHookEventLog {
  root;
  constructor(root = tmpdir()) {
    this.root = root;
  }
  append(event) {
    const path = hookEventPath(event.sessionId, this.root);
    return appendPrivate(path, dirname(path), `${JSON.stringify(event)}
`);
  }
  list(sessionId) {
    if (sessionId)
      return this.readSession(sessionId);
    const dir = cacheDir(this.root);
    if (!ensurePrivateDir(dir))
      return [];
    try {
      return readdirSync(dir).filter((name) => name.endsWith(".jsonl") && name !== CONSUMED_FILE).flatMap((name) => this.readFile(join(dir, name)));
    } catch {
      return [];
    }
  }
  sessions() {
    const ids = new Set;
    for (const event of this.list())
      if (event.sessionId)
        ids.add(event.sessionId);
    return [...ids];
  }
  readFile(path) {
    const text = readPrivate(path);
    if (!text)
      return [];
    try {
      return text.split(`
`).filter(Boolean).map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }
  readSession(sessionId) {
    if (!ensurePrivateDir(cacheDir(this.root)))
      return [];
    return this.readFile(hookEventPath(sessionId, this.root));
  }
  clear(sessionId) {
    if (!sessionId || !ensurePrivateDir(cacheDir(this.root)))
      return;
    const path = hookEventPath(sessionId, this.root);
    try {
      const stat = lstatSync(path);
      if (!ownedByUs(stat) || stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 511) !== 384)
        return;
      rmSync(path, { force: true });
    } catch {}
  }
  consumeElicitation(sessionId, toolCallId) {
    const dir = cacheDir(this.root);
    const claimKey = createHash2("sha256").update(`${sessionId}\x00${toolCallId}`).digest("hex");
    const keyClaimed = claimAtomicKey(dir, claimKey);
    if (!keyClaimed)
      return false;
    if (!appendPrivate(join(dir, CONSUMED_FILE), dir, `${JSON.stringify({ sessionId, toolCallId })}
`)) {
      try {
        rmSync(join(dir, CONSUMED_DIR, `${claimKey}.claim`), { force: true });
      } catch {}
      return false;
    }
    if (!this.consumedKeys().includes(`${sessionId}\x00${toolCallId}`))
      return false;
    return this.append({ type: "ElicitationConsumed", sessionId, toolCallId });
  }
  consumedKeys() {
    if (!ensurePrivateDir(cacheDir(this.root)))
      return [];
    const text = readPrivate(join(cacheDir(this.root), CONSUMED_FILE));
    if (!text)
      return [];
    try {
      return text.split(`
`).filter(Boolean).map((line) => JSON.parse(line)).map((item) => `${item.sessionId}\x00${item.toolCallId}`);
    } catch {
      return [];
    }
  }
}
function bindsStart(event, pending) {
  if (event.taskId && event.taskId !== pending.request.taskId)
    return false;
  if (event.prompt !== undefined) {
    const match = /<!-- immune-brain:operation_id=([^\s]+)\s+task_id=([^\s]+)\s+-->/.exec(event.prompt);
    if (match) {
      if (match[1] !== pending.request.operationId || match[2] !== pending.request.taskId)
        return false;
    } else if (event.prompt !== pending.request.prompt) {
      return false;
    }
  }
  if (event.operationId)
    return event.operationId === pending.request.operationId;
  return event.prompt !== undefined && event.prompt === pending.request.prompt;
}

class ClaudeReviewHost {
  log;
  host = "claude-code";
  pending = new Map;
  appliedBySession = new Map;
  consumedElicitations = new Set;
  constructor(log = new MemoryHookEventLog) {
    this.log = log;
  }
  confirmations = new Map;
  prepareReview(request) {
    const initialCursors = new Map;
    const sessionCursors = new Map;
    for (const sessionId of this.log.sessions()) {
      const len = this.log.list(sessionId).length;
      initialCursors.set(sessionId, len);
      sessionCursors.set(sessionId, len);
    }
    this.pending.set(request.operationId, {
      request,
      initialCursors,
      sessionCursors,
      consumed: false
    });
    return {
      id: request.operationId,
      dispatch: {
        name: CLAUDE_REVIEWER_AGENT,
        prompt: `<!-- immune-brain:operation_id=${request.operationId} task_id=${request.taskId} -->
${request.prompt}`,
        max_turns: request.maxTurns,
        run_in_background: false
      }
    };
  }
  observe(event) {
    this.log.append(event);
  }
  drain() {
    for (const key of this.log.consumedKeys())
      this.consumedElicitations.add(key);
    for (const sessionId of this.log.sessions()) {
      const events = this.log.list(sessionId);
      let start = this.appliedBySession.get(sessionId) ?? 0;
      if (start > events.length)
        start = 0;
      let ended = false;
      for (let i = start;i < events.length; i++) {
        const event = events[i];
        if (event.type === "ElicitationResult") {
          const key = `${event.sessionId}\x00${event.toolCallId}`;
          if (this.consumedElicitations.has(key))
            continue;
          if (this.confirmations.has(key)) {
            if (this.log.consumeElicitation(event.sessionId, event.toolCallId)) {
              this.confirmations.delete(key);
              this.consumedElicitations.add(key);
            }
            continue;
          }
          this.confirmations.set(key, event.decision);
          continue;
        }
        if (event.type === "ElicitationConsumed") {
          const key = `${event.sessionId}\x00${event.toolCallId}`;
          this.consumedElicitations.add(key);
          this.confirmations.delete(key);
          continue;
        }
        if (event.type === "SessionEnd") {
          this.log.clear(event.sessionId);
          ended = true;
          this.appliedBySession.delete(event.sessionId);
          for (const key of this.confirmations.keys()) {
            if (key.startsWith(`${event.sessionId}\x00`))
              this.confirmations.delete(key);
          }
          for (const [id, state] of this.pending) {
            if (state.startEvent?.sessionId === event.sessionId || state.postEvent?.sessionId === event.sessionId || state.stopEvent?.sessionId === event.sessionId) {
              this.pending.delete(id);
            }
          }
          break;
        }
        for (const state of this.pending.values()) {
          if (state.consumed || state.error || i < (state.initialCursors.get(sessionId) ?? 0))
            continue;
          this.applyReviewEvent(event, state);
        }
      }
      if (ended) {
        this.appliedBySession.delete(sessionId);
        for (const state of this.pending.values())
          state.sessionCursors.delete(sessionId);
      } else {
        this.appliedBySession.set(sessionId, events.length);
        for (const state of this.pending.values())
          state.sessionCursors.set(sessionId, events.length);
        for (const state of this.pending.values()) {
          if (state.consumed || state.error || !state.postEvent || state.postEvent.sessionId !== sessionId)
            continue;
          if (!state.startEvent || !state.stopEvent) {
            const from = state.initialCursors.get(sessionId) ?? 0;
            for (let j = from;j < events.length; j++) {
              this.applyReviewEvent(events[j], state);
              if (state.error)
                break;
            }
          }
        }
      }
    }
  }
  peekConfirmation(sessionId, toolCallId) {
    this.drain();
    return this.confirmations.has(`${sessionId}\x00${toolCallId}`);
  }
  takeConfirmation(sessionId, toolCallId) {
    this.drain();
    const key = `${sessionId}\x00${toolCallId}`;
    const decision = this.confirmations.get(key);
    if (!decision)
      return;
    if (!this.log.consumeElicitation(sessionId, toolCallId)) {
      this.confirmations.delete(key);
      return;
    }
    this.confirmations.delete(key);
    this.consumedElicitations.add(key);
    this.drain();
    return decision;
  }
  sessionOfElicitation(toolCallId) {
    this.drain();
    const sessions = [];
    for (const key of this.confirmations.keys()) {
      const sep = key.lastIndexOf("\x00");
      if (sep >= 0 && key.slice(sep + 1) === toolCallId)
        sessions.push(key.slice(0, sep));
    }
    if (sessions.length !== 1)
      return;
    return sessions[0];
  }
  applyReviewEvent(event, state) {
    if (state.error)
      return;
    if (event.type === "SubagentStart") {
      if (event.agent !== REVIEWER_AGENT && event.agent !== CLAUDE_REVIEWER_AGENT)
        return;
      if (event.operationId || event.prompt !== undefined) {
        if (!bindsStart(event, state))
          return;
      }
      if (state.postEvent) {
        if (event.sessionId !== state.postEvent.sessionId || event.agentId !== state.postEvent.agentId)
          return;
      }
      if (state.stopEvent) {
        if (event.sessionId !== state.stopEvent.sessionId || event.agentId !== state.stopEvent.agentId)
          return;
      }
      if (!event.operationId && event.prompt === undefined && !state.postEvent && !state.stopEvent) {
        return;
      }
      if (state.startEvent) {
        if (state.startEvent === event)
          return;
        state.error = "reserved Review already has a native tool call";
        return;
      }
      state.startEvent = event;
      return;
    }
    if (event.type === "PostToolUse") {
      if (event.toolName !== AGENT_TOOL)
        return;
      if (!event.agentId || !event.operationId || event.operationId !== state.request.operationId)
        return;
      if ("taskId" in event && event.taskId && event.taskId !== state.request.taskId)
        return;
      if (state.startEvent && event.sessionId !== state.startEvent.sessionId)
        return;
      if (state.startEvent && event.agentId !== state.startEvent.agentId)
        return;
      if (state.stopEvent && event.sessionId !== state.stopEvent.sessionId)
        return;
      if (state.stopEvent && event.agentId !== state.stopEvent.agentId)
        return;
      if (state.postEvent !== undefined) {
        if (state.postEvent === event)
          return;
        state.error = "duplicate PostToolUse result observed for review reservation";
        return;
      }
      state.postEvent = event;
      return;
    }
    if (event.type === "SubagentStop") {
      if (event.agent !== REVIEWER_AGENT && event.agent !== CLAUDE_REVIEWER_AGENT)
        return;
      if (!event.agentId)
        return;
      if ("operationId" in event && event.operationId && event.operationId !== state.request.operationId)
        return;
      if ("taskId" in event && event.taskId && event.taskId !== state.request.taskId)
        return;
      if (state.startEvent && (event.sessionId !== state.startEvent.sessionId || event.agentId !== state.startEvent.agentId))
        return;
      if (state.postEvent && (event.sessionId !== state.postEvent.sessionId || event.agentId !== state.postEvent.agentId))
        return;
      if (!event.operationId && !state.startEvent && !state.postEvent) {
        return;
      }
      if (state.stopEvent) {
        if (state.stopEvent === event)
          return;
        state.error = "duplicate SubagentStop observed for review reservation";
        return;
      }
      state.stopEvent = event;
    }
  }
  inspectReview(reservation) {
    this.drain();
    const state = this.pending.get(reservation.id);
    if (!state)
      return { ok: false, reason: "reserved foreground Agent was not observed", release: false };
    if (state.consumed)
      return { ok: false, reason: "review receipt already consumed", release: true };
    if (state.error)
      return { ok: false, reason: state.error, release: true };
    if (!state.startEvent)
      return { ok: false, reason: "reserved foreground Agent was not observed", release: false };
    if (!state.stopEvent || !state.postEvent?.result?.trim()) {
      return { ok: false, reason: "foreground Agent terminal event order is incomplete", release: false };
    }
    if (state.startEvent.sessionId !== state.postEvent.sessionId || state.startEvent.sessionId !== state.stopEvent.sessionId || state.startEvent.agentId !== state.postEvent.agentId || state.startEvent.agentId !== state.stopEvent.agentId) {
      return { ok: false, reason: "foreground Agent terminal event correlation mismatch", release: true };
    }
    return {
      ok: true,
      receipt: {
        actorId: `claude:${state.startEvent.agentId ?? reservation.id}`,
        result: state.postEvent.result
      }
    };
  }
  consumeReview(reservation) {
    const result = this.inspectReview(reservation);
    if (result.ok) {
      const pending = this.pending.get(reservation.id);
      if (pending)
        pending.consumed = true;
    }
    return result;
  }
  inspectReviewForTask(taskId) {
    this.drain();
    const entry = [...this.pending.entries()].find(([, state]) => state.request.taskId === taskId);
    if (!entry)
      return { ok: false, reason: "reserved foreground Agent was not observed", release: false };
    return this.inspectReview({ id: entry[0], dispatch: entry[1].request });
  }
  releaseReview(reservation) {
    this.pending.delete(reservation.id);
  }
}
function parseHookStdin(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  const hookType = String(payload.hook_event_name ?? payload.type ?? "");
  if (hookType === "ElicitationResult" && (typeof payload.session_id !== "string" || !payload.session_id))
    return null;
  const sessionId = String(payload.session_id ?? payload.sessionId ?? process.env.CLAUDE_SESSION_ID ?? "");
  if (!sessionId)
    return null;
  const agent = String(payload.agent_type ?? payload.agent ?? payload.subagent_type ?? "");
  const agentId = String(payload.agent_id ?? payload.agentId ?? "");
  const taskId = typeof payload.task_id === "string" ? payload.task_id : undefined;
  const operationId = typeof payload.operation_id === "string" ? payload.operation_id : undefined;
  let prompt = typeof payload.prompt === "string" ? payload.prompt : undefined;
  if (!prompt && typeof payload.input === "object" && payload.input !== null) {
    const inputObj = payload.input;
    if (typeof inputObj.prompt === "string")
      prompt = inputObj.prompt;
  }
  if (!prompt && typeof payload.tool_input === "object" && payload.tool_input !== null) {
    const toolInputObj = payload.tool_input;
    if (typeof toolInputObj.prompt === "string")
      prompt = toolInputObj.prompt;
  }
  let extractedOpId = operationId;
  let extractedTaskId = taskId;
  for (const candidate of [payload.input, payload.tool_input, payload.tool_response, payload.toolResponse, payload.response, payload.result]) {
    if (candidate && typeof candidate === "object" && candidate !== null) {
      const obj = candidate;
      const nestedOp = typeof obj.operation_id === "string" ? obj.operation_id : typeof obj.operationId === "string" ? obj.operationId : undefined;
      const nestedTask = typeof obj.task_id === "string" ? obj.task_id : typeof obj.taskId === "string" ? obj.taskId : undefined;
      if (nestedOp) {
        if (extractedOpId && extractedOpId !== nestedOp)
          return null;
        extractedOpId = nestedOp;
      }
      if (nestedTask) {
        if (extractedTaskId && extractedTaskId !== nestedTask)
          return null;
        extractedTaskId = nestedTask;
      }
    }
  }
  if (prompt) {
    const match = /<!-- immune-brain:operation_id=([^\s]+)\s+task_id=([^\s]+)\s+-->/.exec(prompt);
    if (match) {
      if (extractedOpId && extractedOpId !== match[1])
        return null;
      if (extractedTaskId && extractedTaskId !== match[2])
        return null;
      extractedOpId = match[1];
      extractedTaskId = match[2];
    }
  }
  if (hookType === "SubagentStart" || hookType === "SubagentStop") {
    return {
      type: hookType,
      sessionId,
      agent,
      agentId,
      taskId: extractedTaskId,
      operationId: extractedOpId,
      ...hookType === "SubagentStart" ? { prompt } : {}
    };
  }
  if (hookType === "PostToolUse") {
    const toolName = String(payload.tool_name ?? payload.toolName ?? payload.tool ?? "");
    const response = payload.tool_response ?? payload.toolResponse ?? payload.response ?? payload.result;
    let result = typeof response === "string" ? response : JSON.stringify(response ?? "");
    let extractedAgentId = agentId;
    if (response && typeof response === "object" && response !== null) {
      const respObj = response;
      if (typeof respObj.agentId === "string" && respObj.agentId) {
        if (extractedAgentId && extractedAgentId !== respObj.agentId)
          return null;
        extractedAgentId = respObj.agentId;
      }
      if (Array.isArray(respObj.content)) {
        const textItem = respObj.content.find((c) => typeof c === "object" && c !== null && c.type === "text");
        if (textItem && typeof textItem.text === "string") {
          result = textItem.text;
        }
      }
    }
    return {
      type: "PostToolUse",
      sessionId,
      agentId: extractedAgentId,
      toolName,
      result,
      taskId: extractedTaskId,
      operationId: extractedOpId,
      prompt
    };
  }
  if (hookType === "SessionEnd")
    return { type: "SessionEnd", sessionId };
  if (hookType === "ElicitationResult") {
    const rawToolCallId = payload.tool_use_id ?? payload.toolCallId;
    if (typeof rawToolCallId !== "string" || !rawToolCallId)
      return null;
    const toolCallId = rawToolCallId;
    const raw2 = payload.decision ?? payload.result ?? payload.action;
    const decision = raw2 === "accept" ? "accept" : raw2 === "deny" ? "deny" : raw2 === "cancel" ? "cancel" : null;
    if (!toolCallId || !decision)
      return null;
    return { type: "ElicitationResult", sessionId, toolCallId, decision };
  }
  return null;
}

// plugins/immune-brain/runtime/claude/kernel_ports.ts
import { randomUUID as randomUUID5 } from "node:crypto";
import { existsSync as existsSync3, readFileSync as readFileSync7, writeFileSync as writeFileSync3 } from "node:fs";
import { execFileSync as execFileSync4 } from "node:child_process";
import { join as join7 } from "node:path";

// plugins/immune-brain/runtime/assurance/coordinator.ts
import { createHash as createHash5, randomUUID as randomUUID2 } from "node:crypto";

// plugins/immune-brain/runtime/assurance/verification.ts
import { createHash as createHash3 } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute as isAbsolute2, resolve, sep as sep2, relative } from "node:path";

// plugins/immune-brain/runtime/verification_descriptor.ts
import { isAbsolute, sep } from "node:path";
var VERIFICATION_DESCRIPTOR_CONTRACT = "assurance_kernel/verification_descriptor/v1";
var DESCRIPTOR_FIELDS = [
  "contract",
  "runner_id",
  "runner_version",
  "argv",
  "cwd",
  "timeout_ms",
  "max_output_bytes"
];
var MAX_ARGV_TOKENS = 64;
var MAX_ARGV_TOKEN_BYTES = 512;
var MAX_CWD_DEPTH = 32;
var MAX_TIMEOUT_MS = 600000;
var MAX_OUTPUT_BYTES = 262144;

class VerificationDescriptorError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationDescriptorError";
  }
}
function parseVerificationDescriptor(text) {
  const trimmed = text.trim();
  if (!trimmed)
    throw new VerificationDescriptorError("verification string is empty");
  let raw;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    throw new VerificationDescriptorError("verification string is not valid JSON");
  }
  const unknown = Object.keys(raw).filter((key) => !DESCRIPTOR_FIELDS.includes(key));
  if (unknown.length > 0)
    throw new VerificationDescriptorError(`verification descriptor has unknown field: ${unknown[0]}`);
  if (raw.contract !== VERIFICATION_DESCRIPTOR_CONTRACT)
    throw new VerificationDescriptorError("verification descriptor contract is invalid");
  if (raw.runner_id !== "bun")
    throw new VerificationDescriptorError(`verification runner must be bun; got ${String(raw.runner_id)}`);
  if (typeof raw.runner_version !== "string" || !raw.runner_version.trim())
    throw new VerificationDescriptorError("verification runner_version is invalid");
  if (!Array.isArray(raw.argv) || raw.argv.length === 0)
    throw new VerificationDescriptorError("verification argv must be a non-empty array");
  if (raw.argv.length > MAX_ARGV_TOKENS)
    throw new VerificationDescriptorError("verification argv exceeds the token bound");
  for (const token of raw.argv) {
    if (typeof token !== "string" || !token.trim())
      throw new VerificationDescriptorError("verification argv tokens must be non-empty strings");
    if (Buffer.byteLength(token) > MAX_ARGV_TOKEN_BYTES)
      throw new VerificationDescriptorError("verification argv token exceeds the byte bound");
    if (/[\x00-\x1f\x7f]/.test(token))
      throw new VerificationDescriptorError("verification argv token contains control characters");
    if (token.includes("..") || token.includes("\\") || token.startsWith("/") || token.startsWith("~") || token.includes("$") || token.includes(";") || token.includes("&") || token.includes("|") || token.includes(">") || token.includes("<") || token.includes("`") || token.includes("*") || token.includes("?") || token.includes("[") || token.includes("]") || token.includes("{") || token.includes("}") || token.includes("(") || token.includes(")") || token.includes(" ") || token.includes("\t"))
      throw new VerificationDescriptorError(`verification argv token is not a safe literal: ${token}`);
  }
  if (typeof raw.cwd !== "string" || !raw.cwd.trim())
    throw new VerificationDescriptorError("verification cwd is invalid");
  if (isAbsolute(raw.cwd) || raw.cwd.includes("\\"))
    throw new VerificationDescriptorError("verification cwd must be repository-relative");
  if (raw.cwd === ".." || raw.cwd.startsWith(`..${sep}`) || raw.cwd.split(sep).includes(".."))
    throw new VerificationDescriptorError("verification cwd escapes the repository");
  if (raw.cwd.split(sep).filter(Boolean).length > MAX_CWD_DEPTH)
    throw new VerificationDescriptorError("verification cwd exceeds the depth bound");
  if (typeof raw.timeout_ms !== "number" || !Number.isFinite(raw.timeout_ms) || raw.timeout_ms < 1)
    throw new VerificationDescriptorError("verification timeout_ms must be a finite positive integer");
  if (!Number.isInteger(raw.timeout_ms) || raw.timeout_ms > MAX_TIMEOUT_MS)
    throw new VerificationDescriptorError("verification timeout_ms exceeds the host ceiling");
  if (typeof raw.max_output_bytes !== "number" || !Number.isFinite(raw.max_output_bytes) || raw.max_output_bytes < 1)
    throw new VerificationDescriptorError("verification max_output_bytes must be a finite positive integer");
  if (!Number.isInteger(raw.max_output_bytes) || raw.max_output_bytes > MAX_OUTPUT_BYTES)
    throw new VerificationDescriptorError("verification max_output_bytes exceeds the host ceiling");
  return {
    contract: VERIFICATION_DESCRIPTOR_CONTRACT,
    runner_id: "bun",
    runner_version: raw.runner_version,
    argv: raw.argv,
    cwd: raw.cwd,
    timeout_ms: raw.timeout_ms,
    max_output_bytes: raw.max_output_bytes
  };
}
var VERIFICATION_DESCRIPTOR_BOUNDS = {
  max_arg_tokens: MAX_ARGV_TOKENS,
  max_arg_token_bytes: MAX_ARGV_TOKEN_BYTES,
  max_cwd_depth: MAX_CWD_DEPTH,
  max_timeout_ms: MAX_TIMEOUT_MS,
  max_output_bytes: MAX_OUTPUT_BYTES
};
// plugins/immune-brain/runtime/assurance/verification.ts
function resolveBunRunner() {
  let executable;
  try {
    executable = execFileSync("which", ["bun"], { encoding: "utf8" }).trim();
  } catch {
    throw new VerificationDescriptorError("bun runner is unavailable on this host");
  }
  let real;
  try {
    real = realpathSync(executable);
  } catch {
    throw new VerificationDescriptorError("bun runner realpath is unresolvable");
  }
  let stat;
  try {
    stat = statSync(real);
  } catch {
    throw new VerificationDescriptorError("bun runner is unreadable");
  }
  if (!stat.isFile())
    throw new VerificationDescriptorError("bun runner is not a regular file");
  const { readFileSync } = __require("node:fs");
  const contentHash = `sha256:${createHash3("sha256").update(readFileSync(real)).digest("hex")}`;
  let version = "";
  try {
    version = execFileSync(real, ["--version"], { encoding: "utf8" }).trim();
  } catch {
    throw new VerificationDescriptorError("bun runner version is unreadable");
  }
  return {
    runner_id: "bun",
    path: real,
    dev: stat.dev,
    ino: stat.ino,
    content_hash: contentHash,
    version
  };
}
function assertRunnerCompatible(descriptor, runner) {
  if (descriptor.runner_version !== runner.version)
    throw new VerificationDescriptorError(`frozen runner version mismatch: descriptor claims ${descriptor.runner_version}, host has ${runner.version}; assurance unavailable`);
}

class VerificationAbortedError extends Error {
  constructor() {
    super("fixed verification aborted");
    this.name = "VerificationAbortedError";
  }
}
async function runFixedVerification(root, descriptor, runner, options = {}) {
  const canonicalRoot = resolve(root);
  const cwd = resolve(canonicalRoot, descriptor.cwd);
  if (cwd === canonicalRoot ? false : !relative(canonicalRoot, cwd).startsWith(".") === false)
    throw new VerificationDescriptorError("verification cwd escapes the repository");
  if (isAbsolute2(descriptor.cwd) || relative(canonicalRoot, cwd).startsWith(`..${sep2}`) || cwd === resolve(canonicalRoot, ".."))
    throw new VerificationDescriptorError("verification cwd escapes the repository");
  if (options.signal?.aborted)
    throw new VerificationAbortedError;
  if (process.platform === "win32")
    throw new VerificationDescriptorError("fixed verification process-group isolation requires a POSIX host");
  const maxOutput = Math.min(descriptor.max_output_bytes, VERIFICATION_DESCRIPTOR_BOUNDS.max_output_bytes);
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let capturedBytes = 0;
    const child = spawn(runner.path, descriptor.argv, {
      cwd,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const killTree = () => {
      if (child.pid === undefined)
        return;
      try {
        if (process.platform !== "win32")
          process.kill(-child.pid, "SIGKILL");
        else
          child.kill("SIGKILL");
      } catch {}
    };
    const cleanup = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const resolveOnce = (result) => {
      if (settled)
        return;
      settled = true;
      cleanup();
      resolvePromise(result);
    };
    const rejectOnce = (error) => {
      if (settled)
        return;
      settled = true;
      cleanup();
      rejectPromise(error);
    };
    const appendBounded = (current, chunk) => {
      const available = Math.max(0, maxOutput - capturedBytes);
      const accepted = chunk.subarray(0, available);
      capturedBytes += accepted.length;
      return {
        content: accepted.length > 0 ? Buffer.concat([current, accepted]) : current,
        exceeded: chunk.length > available
      };
    };
    const outputLimitExceeded = () => {
      const marker = Buffer.from(`verification output limit exceeded
`, "utf8");
      stdout = stdout.subarray(0, Math.max(0, maxOutput - marker.length));
      stderr = marker.subarray(0, maxOutput - stdout.length);
      capturedBytes = stdout.length + stderr.length;
      killTree();
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolveOnce({
        exit_code: 1,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        timed_out: false
      });
    };
    child.stdout?.on("data", (chunk) => {
      const appended = appendBounded(stdout, chunk);
      stdout = appended.content;
      if (appended.exceeded)
        outputLimitExceeded();
    });
    child.stderr?.on("data", (chunk) => {
      const appended = appendBounded(stderr, chunk);
      stderr = appended.content;
      if (appended.exceeded)
        outputLimitExceeded();
    });
    child.once("error", (error) => {
      resolveOnce({
        exit_code: 1,
        stdout: stdout.toString("utf8"),
        stderr: `${stderr.toString("utf8")}runner spawn failed: ${error.message}`.slice(0, maxOutput),
        timed_out: false
      });
    });
    child.once("close", (code) => {
      resolveOnce({
        exit_code: code ?? 1,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        timed_out: false
      });
    });
    const onAbort = () => {
      killTree();
      child.stdout?.destroy();
      child.stderr?.destroy();
      rejectOnce(new VerificationAbortedError);
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => {
      killTree();
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolveOnce({
        exit_code: 1,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        timed_out: true
      });
    }, descriptor.timeout_ms);
  });
}
function findingsDigest(findings) {
  const normalized = findings.map((f) => JSON.stringify({
    acceptance_id: f.acceptance_id,
    id: f.id,
    kind: f.kind,
    summary: f.summary
  }));
  return `sha256:${createHash3("sha256").update(`[${normalized.join(",")}]`).digest("hex")}`;
}

// plugins/immune-brain/runtime/assurance/invocations.ts
function createInvocationRegistry() {
  const states = new Map;
  function tokenOf(taskId, nonce) {
    return Object.freeze({ task_id: taskId, nonce });
  }
  function entryOf(token) {
    const entry = states.get(token.task_id);
    if (!entry || entry.token.nonce !== token.nonce)
      throw new Error("invocation token is not recognized for this task");
    return entry;
  }
  return {
    open(taskId) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId))
        throw new Error("task id is not a safe file identity");
      const existing = states.get(taskId);
      if (existing && existing.state === "open") {
        throw new Error(`task ${taskId} already has an open invocation; concurrent assure/authorize is rejected`);
      }
      const token = tokenOf(taskId, `${taskId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`);
      states.set(taskId, { token, state: "open" });
      return token;
    },
    commit(token) {
      const entry = entryOf(token);
      if (entry.state !== "open")
        throw new Error(`invocation for task ${token.task_id} is already ${entry.state}; a new invocation is required`);
      entry.state = "committed";
    },
    cancel(token) {
      const entry = entryOf(token);
      if (entry.state === "open")
        entry.state = "cancelled";
    },
    stateOf(token) {
      return entryOf(token).state;
    },
    isOpen(taskId) {
      return states.get(taskId)?.state === "open";
    },
    states() {
      const out = {};
      for (const [taskId, entry] of states)
        out[taskId] = entry.state;
      return out;
    }
  };
}

// plugins/immune-brain/runtime/role_prompt_bridge.ts
import { createHash as createHash4 } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join as join3, dirname as dirname2 } from "node:path";
import { fileURLToPath } from "node:url";

// plugins/immune-brain/runtime/canonical_json.ts
function stableStringify(value) {
  if (value === null || value === undefined)
    return "null";
  if (typeof value !== "object")
    return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(", ")}]`;
  }
  const obj = value;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}: ${stableStringify(obj[key])}`).join(", ")}}`;
}

// plugins/immune-brain/runtime/role_prompt_bridge.ts
var RUNTIME_DIR = dirname2(fileURLToPath(import.meta.url));
var INTERNAL_ROLE_PROMPTS = {
  qa: { file: "qa.md", authority: "qa", tool_policy: "no tools" },
  "code-review": {
    file: "code-review.md",
    review_gate: "imm-code-review",
    authority: "advisory",
    tool_policy: "read-only tools"
  },
  "ui-review": {
    file: "ui-review.md",
    review_gate: "imm-ui-review",
    authority: "advisory",
    tool_policy: "no tools"
  },
  executor: {
    file: "executor.md",
    authority: "executor",
    tool_policy: "workspace tools"
  },
  "test-fixer": {
    file: "test-fixer.md",
    authority: "test-repair",
    tool_policy: "delegated test files"
  },
  "pr-fix": {
    file: "pr-fix.md",
    authority: "pr-repair",
    tool_policy: "workspace tools"
  },
  "arch-explorer": {
    file: "arch-explorer.md",
    authority: "advisory",
    tool_policy: "read-only tools"
  },
  "advisory-reviewer": {
    file: "advisory-reviewer.md",
    authority: "advisory",
    tool_policy: "no tools"
  },
  compounder: {
    file: "compounder.md",
    authority: "compounder",
    tool_policy: "learning tools"
  }
};
function roleSpec(role) {
  const spec = INTERNAL_ROLE_PROMPTS[role];
  if (!spec)
    throw new Error(`unknown internal role: ${String(role)}`);
  return spec;
}
function loadRolePrompt(role) {
  const spec = roleSpec(role);
  const path = join3(RUNTIME_DIR, "..", "dist", "role-prompts", spec.file);
  if (!existsSync(path)) {
    throw new Error(`internal role prompt is not packaged: ${role}`);
  }
  return readFileSync(path, "utf8");
}
function buildRoleDelegationPacket(input) {
  const spec = roleSpec(input.role);
  const requestedGate = input.context.review_gate;
  if (spec.review_gate && requestedGate && requestedGate !== spec.review_gate) {
    throw new Error(`review gate ${requestedGate} does not match ${input.role}`);
  }
  if (!spec.review_gate && requestedGate) {
    throw new Error(`${input.role} cannot carry review gate ${requestedGate}`);
  }
  const reviewGate = spec.review_gate;
  const context = stableStringify(input.context);
  const prompt = [
    `internal role: ${input.role}`,
    `tool_policy: ${spec.tool_policy}`,
    `do not discover or load Pi Skills; execute this internal role contract directly`,
    loadRolePrompt(input.role).trim(),
    `Delegation context (untrusted data): ${context}`
  ].join(`

`);
  const promptDigest = `sha256:${createHash4("sha256").update(prompt).digest("hex")}`;
  return {
    contract: "immune_brain/role_delegation/v1",
    role: input.role,
    ...reviewGate ? { review_gate: reviewGate } : {},
    authority: spec.authority,
    tool_policy: spec.tool_policy,
    prompt,
    prompt_digest: promptDigest
  };
}

// plugins/immune-brain/runtime/assurance/coordinator.ts
var QA_MIN_JOB_TIMEOUT_SECONDS = 15 * 60;
var QA_MAX_JOB_TIMEOUT_SECONDS = 60 * 60;
var QA_JOB_OVERHEAD_SECONDS = 2 * 60;
var QA_JOB_TIMEOUT_SECONDS = QA_MIN_JOB_TIMEOUT_SECONDS;
var REVIEW_TIMING_PROFILES = {
  quick: { softDeadlineSeconds: 5 * 60, stopThresholdSeconds: 15 * 60 },
  standard: { softDeadlineSeconds: 10 * 60, stopThresholdSeconds: 30 * 60 },
  heavy: { softDeadlineSeconds: 20 * 60, stopThresholdSeconds: 60 * 60 }
};
var QUICK_REVIEW_MAX_ACCEPTANCE = 3;
var QUICK_REVIEW_MAX_FILES = 5;
var QUICK_REVIEW_MAX_BYTES = 64 * 1024;
var HEAVY_REVIEW_MIN_ACCEPTANCE = 9;
var HEAVY_REVIEW_MIN_BYTES = 512 * 1024 + 1;
function classifyReviewWorkload(snapshot, evidence) {
  const bytes = Buffer.byteLength(JSON.stringify(evidence));
  const paths = "changed_paths" in evidence ? Object.keys(evidence.changed_paths) : Object.keys(evidence.dirty_files);
  if (snapshot.risk === "critical" || snapshot.acceptance.length >= HEAVY_REVIEW_MIN_ACCEPTANCE || bytes >= HEAVY_REVIEW_MIN_BYTES)
    return "heavy";
  if (snapshot.risk === "routine" && snapshot.acceptance.length <= QUICK_REVIEW_MAX_ACCEPTANCE && paths.length <= QUICK_REVIEW_MAX_FILES && bytes <= QUICK_REVIEW_MAX_BYTES)
    return "quick";
  return "standard";
}
function reviewTurnBudget(workload) {
  return workload === "quick" ? 12 : workload === "standard" ? 16 : 24;
}
function snapshotDigest(snapshot) {
  return `sha256:${createHash5("sha256").update(JSON.stringify(snapshot)).digest("hex")}`;
}
function buildReviewPrompt(snapshot, evidencePath) {
  if (snapshot.role !== "review")
    throw new Error("native review prompt requires review role");
  const acceptance = snapshot.acceptance.map((item) => `- ${item.id}: ${item.assertion}`).join(`
`);
  const digest = snapshotDigest(snapshot);
  const rolePacket = buildRoleDelegationPacket({
    role: "code-review",
    context: {
      task_id: snapshot.task_id,
      review_gate: "imm-code-review",
      changed_files_signature: snapshot.diff_hash,
      snapshot_digest: digest
    }
  });
  const revision = snapshot.review_revision;
  const evidenceContract = revision ? [
    `Review evidence contract: assurance_kernel/review_manifest/v5. The manifest is metadata only; source is read from immutable Git objects.`,
    `Review one immutable Git revision, not live workspace bytes. Read the metadata manifest at ${evidencePath ?? "<evidence-path>"} first; it carries no source. Verify that git rev-parse ${revision.base_head} and git rev-parse ${revision.review_commit} both resolve, that ${revision.review_commit}^{} is a commit whose only parent is ${revision.base_head}, and that its tree is ${revision.review_tree}.`,
    `Analyze the change with git diff ${revision.base_head} ${revision.review_commit} (and git show ${revision.review_commit}:<path> for full files). Every path in changed_paths is the task's work: added, modified, or deleted since Enrollment. Deleted paths have a null oid. Never treat a path that is absent from ${revision.base_head} as pre-existing, and never review files outside the revision.`,
    `Unchanged files are not part of the mutation authority. Read one only when it is directly required by an acceptance assertion, a changed caller, or the same state machine, and cite the path plus the reason in your finding. Repository-wide exploration is out of scope.`,
    `The user-selected worktree may contain staged or committed work that is not in this revision, and revision objects may not be checked out anywhere. Do not read working-tree files as evidence; git object reads against the shared object database are the only source of truth.`
  ] : [
    `Verify immutable bundle provenance before analyzing findings. Review the immutable evidence JSON at ${evidencePath ?? "<evidence-path>"}. Read that file first; verify that git rev-parse HEAD in the isolated reviewer worktree equals bundle.head. For every tracked dirty_files entry, verify git rev-parse HEAD:<path> equals base_oid, then compare that immutable HEAD blob with current_content. A null base_oid denotes an untracked current file; a null current_content denotes a deletion. Do not inspect or depend on live task bytes outside the immutable bundle.`,
    `Limit repository inspection to the acceptance assertions and dirty_files contents in the immutable bundle. Do not explore unrelated repository paths.`,
    `The user-selected worktree may contain staged task changes that are absent from the isolated reviewer worktree. Review authority is bound only to the bundle dirty_files current_content bytes and committed HEAD provenance. Analyze code exclusively from those bundle bytes; repository file reads are permitted only for the provenance git commands above. A symbol present in current_content but absent from HEAD is the task change, not an absence.`
  ];
  return [
    rolePacket.prompt,
    ...evidenceContract,
    `Do not edit files, create files, run mutating commands, or change Git state. Focus on correctness, regressions, security, and missing tests.`,
    `Execution outcomes for every acceptance were verified deterministically by the Kernel QA layer before this review and are embedded in this bundle under outcomes (the immutable evidence file, acceptance_id -> {status, summary}); do not re-execute descriptors and do not treat the absence of local test runs as a finding. Your review covers evidence provenance, code correctness, regressions, security, and missing tests against the embedded assertions and code.`,
    `Snapshot digest: ${digest}`,
    `TaskRecord revision: ${snapshot.record_revision}`,
    revision ? `Intent revision ${snapshot.intent_revision} (hash ${snapshot.intent_content_hash}), diff ${snapshot.diff_hash}, review revision ${revision.review_commit} (base ${revision.base_head}, tree ${revision.review_tree}, manifest ${revision.manifest_digest}), state ${snapshot.lifecycle}:${snapshot.artifact_state}.` : `Intent revision ${snapshot.intent_revision} (hash ${snapshot.intent_content_hash}), diff ${snapshot.diff_hash}, review bundle ${snapshot.review_bundle_digest}, state ${snapshot.lifecycle}:${snapshot.artifact_state}.`,
    "Acceptance assertions:",
    acceptance,
    "Reserve the final turn for exactly one strict JSON verdict. Reply with ONLY that object, without markdown fences or commentary.",
    `PASS shape: {"contract":"assurance_kernel/assurance_verdict/v2","role":"review","task_id":"${snapshot.task_id}","snapshot_digest":"${digest}","decision":"pass","approval":{"kind":"review","authority_role":"reviewer","summary":"<one line>"}}`,
    `REWORK shape: {"contract":"assurance_kernel/assurance_verdict/v2","role":"review","task_id":"${snapshot.task_id}","snapshot_digest":"${digest}","decision":"rework","findings":[{"id":"review-1","kind":"blocking|advisory","acceptance_id":"<id|null>","summary":"<one line>"}]}`,
    `REWORK verdicts must omit the approval field entirely; do not emit "approval": null.`
  ].join(`
`);
}
function parseAssuranceVerdict(input, snapshot) {
  let raw;
  if (typeof input === "string") {
    const cleaned = input.split(`
`).map((line) => line.trim()).filter((line) => line.startsWith("{") && line.endsWith("}")).join("");
    if (!cleaned)
      throw new Error("reviewer returned no strict JSON verdict");
    try {
      raw = JSON.parse(cleaned);
    } catch {
      throw new Error("reviewer verdict is not valid JSON");
    }
  } else if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    raw = input;
  } else {
    throw new Error("reviewer verdict must be a JSON object");
  }
  const allowed = ["contract", "role", "task_id", "snapshot_digest", "decision", "approval", "findings"];
  const unknown = Object.keys(raw).find((key) => !allowed.includes(key));
  if (unknown)
    throw new Error(`child verdict has unknown field: ${unknown}`);
  if (raw.contract !== "assurance_kernel/assurance_verdict/v2")
    throw new Error("assurance verdict contract is invalid");
  if (raw.role !== snapshot.role)
    throw new Error("child verdict role mismatch");
  if (raw.task_id !== snapshot.task_id)
    throw new Error("child verdict task mismatch");
  if (raw.snapshot_digest !== snapshotDigest(snapshot))
    throw new Error("child verdict snapshot digest mismatch");
  if (raw.decision !== "pass" && raw.decision !== "rework")
    throw new Error("child verdict decision must be pass or rework");
  if (raw.decision === "pass") {
    const approval = raw.approval;
    const expectedKind = snapshot.role === "qa" ? "qa" : "review";
    const expectedRole = snapshot.role === "qa" ? "qa" : "reviewer";
    if (!approval || approval.kind !== expectedKind || approval.authority_role !== expectedRole || typeof approval.summary !== "string" || !approval.summary.trim())
      throw new Error("pass verdict approval is invalid");
    const unknownApproval = Object.keys(approval).find((key) => !["kind", "authority_role", "summary"].includes(key));
    if (unknownApproval)
      throw new Error(`pass verdict approval has unknown field: ${unknownApproval}`);
    if (raw.findings !== undefined)
      throw new Error("pass verdict must omit findings");
    return { contract: "assurance_kernel/assurance_verdict/v2", role: snapshot.role, task_id: snapshot.task_id, snapshot_digest: snapshotDigest(snapshot), decision: "pass", approval: { kind: expectedKind, authority_role: expectedRole, summary: approval.summary } };
  }
  if (!Array.isArray(raw.findings) || raw.findings.length === 0)
    throw new Error("rework verdict findings are invalid");
  if (raw.approval !== undefined && raw.approval !== null)
    throw new Error("rework verdict must omit approval");
  const findings = raw.findings.map((item, index) => {
    const finding = item;
    const unknownFinding = Object.keys(finding).find((key) => !["id", "kind", "acceptance_id", "summary"].includes(key));
    if (unknownFinding)
      throw new Error(`finding ${index} has unknown field: ${unknownFinding}`);
    if (typeof finding.id !== "string" || !finding.id.trim() || finding.kind !== "blocking" && finding.kind !== "advisory" || finding.acceptance_id !== null && typeof finding.acceptance_id !== "string" || typeof finding.summary !== "string" || !finding.summary.trim())
      throw new Error(`finding ${index} is invalid`);
    const id = `review-${snapshotDigest(snapshot).slice(7, 19)}-${index + 1}-${finding.id.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 48)}`;
    const normalized = { id, kind: finding.kind, acceptance_id: finding.acceptance_id, summary: finding.summary };
    return { ...normalized, findings_digest: findingsDigest([normalized]) };
  });
  return { contract: "assurance_kernel/assurance_verdict/v2", role: snapshot.role, task_id: snapshot.task_id, snapshot_digest: snapshotDigest(snapshot), decision: "rework", findings };
}
var invocationRegistry = createInvocationRegistry();

class AssuranceCoordinator {
  ports;
  activeOperations = new Map;
  operationControllers = new Map;
  reviewReservations = new Map;
  rejectedReviewOperations = new Map;
  unknownOperations = new Map;
  sessionInvocations = new Set;
  sessionActive = true;
  sessionGeneration = 0;
  constructor(ports) {
    this.ports = ports;
  }
  onSessionStart() {
    this.sessionActive = true;
    this.sessionGeneration += 1;
  }
  async onSessionShutdown() {
    this.sessionActive = false;
    this.sessionGeneration += 1;
    for (const { controller } of this.operationControllers.values()) {
      if (!controller.signal.aborted)
        controller.abort(new Error("session shutdown"));
    }
    this.operationControllers.clear();
    this.activeOperations.clear();
    this.rejectedReviewOperations.clear();
    for (const reservation of this.reviewReservations.values()) {
      try {
        this.ports.host.releaseReview(reservation.hostReservation);
      } catch {}
      this.removeEvidence(reservation);
    }
    this.reviewReservations.clear();
    for (const invocation of [...this.sessionInvocations])
      this.closeSessionInvocation(invocation);
  }
  active(taskId) {
    const operationId = this.activeOperations.get(taskId);
    if (operationId)
      return { state: "running", operation: "qa", operation_id: operationId, deadline_seconds: QA_JOB_TIMEOUT_SECONDS };
    const reservation = this.reviewReservations.get(taskId);
    if (reservation)
      return { state: "review_ready", operation: "review", operation_id: reservation.operationId };
    const unknown = this.unknownOperations.get(taskId);
    if (unknown)
      return { state: "settlement_unknown", operation: unknown.operation, operation_id: unknown.operationId, reason: unknown.reason };
    return null;
  }
  openInvocation(taskId) {
    const invocation = invocationRegistry.open(taskId);
    this.sessionInvocations.add(invocation);
    return invocation;
  }
  closeInvocation(invocation) {
    this.closeSessionInvocation(invocation);
  }
  closeSessionInvocation(invocation) {
    try {
      invocationRegistry.cancel(invocation);
    } catch {}
    this.sessionInvocations.delete(invocation);
  }
  commitInvocation(invocation) {
    invocationRegistry.commit(invocation);
  }
  invocationState(invocation) {
    return invocationRegistry.stateOf(invocation);
  }
  isInvocationOpen(taskId) {
    return invocationRegistry.isOpen(taskId);
  }
  sessionActiveValue() {
    return this.sessionActive;
  }
  sessionGenerationValue() {
    return this.sessionGeneration;
  }
  async advance(taskId, ctx, signal, onUpdate) {
    const active = this.active(taskId);
    if (active?.state === "review_ready") {
      const reservation = this.reviewReservations.get(taskId);
      let projection;
      try {
        projection = await this.ports.projectTask(ctx.cwd, taskId);
      } catch (error) {
        return { state: "blocked", reason: `cannot validate Review reservation: ${boundedAssuranceError(error)}` };
      }
      const current = projection.projection;
      const matches = !projection.error && projection.claim?.task_id === taskId && current.lifecycle === "active" && current.next_obligation === "run_review" && reservation !== undefined && reservation.snapshot.record_revision === current.record_revision && reservation.snapshot.workspace_revision === current.workspace_revision && reservation.snapshot.intent_revision === current.intent_revision && reservation.snapshot.intent_content_hash === current.intent_content_hash && reservation.snapshot.diff_hash === current.diff_hash;
      if (matches)
        return this.reviewReadyResult(taskId);
      if (reservation)
        this.releaseReviewReservation(taskId, reservation);
      this.rejectedReviewOperations.delete(taskId);
    }
    const refreshed = this.active(taskId);
    if (refreshed?.state === "settlement_unknown")
      return refreshed;
    if (refreshed?.state === "running")
      return { state: "blocked", reason: `assurance operation ${refreshed.operation_id} is already running` };
    const operationId = randomUUID2();
    const operationGeneration = this.sessionGeneration;
    const operationController = new AbortController;
    const relayExternalAbort = () => operationController.abort(signal?.reason instanceof Error ? signal.reason : new Error("assurance operation cancelled"));
    signal?.addEventListener("abort", relayExternalAbort, { once: true });
    if (signal?.aborted)
      relayExternalAbort();
    this.activeOperations.set(taskId, operationId);
    this.operationControllers.set(taskId, { operationId, controller: operationController });
    this.rejectedReviewOperations.delete(taskId);
    let authorityCommitted = false;
    let authorityBoundaryStarted = false;
    let reviewPreparationStarted = false;
    let phase = "preparing";
    const operationLive = () => this.sessionActive && this.sessionGeneration === operationGeneration && this.activeOperations.get(taskId) === operationId && !operationController.signal.aborted;
    const ensureOperationLive = () => {
      if (!operationLive())
        throw new VerificationAbortedError;
    };
    const progress = (stage, summary, details = {}) => {
      phase = stage;
      onUpdate?.({ content: [{ type: "text", text: summary }], details: { state: "running", operation: "qa", operation_id: operationId, stage, ...details } });
    };
    const aborted = () => operationController.signal.aborted;
    try {
      ensureOperationLive();
      progress(phase, `Preparing deterministic QA for ${taskId}`);
      await this.ports.advanceBeforeProjection?.();
      ensureOperationLive();
      let projection = await this.ports.projectTask(ctx.cwd, taskId);
      ensureOperationLive();
      if (projection.error)
        return { state: "blocked", reason: projection.error };
      if (projection.projection.lifecycle === "done")
        return { state: "completed" };
      if (projection.projection.lifecycle === "stopped")
        return { state: "stopped" };
      if (!projection.claim)
        return { state: "blocked", reason: "no active backend claim" };
      if (projection.claim.task_id !== taskId)
        return { state: "blocked", reason: `backend claim belongs to ${projection.claim.task_id}, not ${taskId}` };
      const parked = await this.ports.readTaskRecord(ctx.cwd, taskId);
      ensureOperationLive();
      if (parked.record?.findings.some((finding) => finding.kind === "replan_required" && finding.status === "open"))
        return { state: "blocked", reason: "review rework limit reached; a durable replan is required" };
      if (projection.projection.artifact_state === "active") {
        if (projection.projection.next_obligation !== "submit_assurance")
          return { state: "blocked", reason: `Kernel requires ${projection.projection.next_obligation}` };
        if (aborted())
          return this.cancelled("qa", operationId, "host cancellation before artifact freeze");
        progress("freezing_artifacts", "Freezing planning artifacts for deterministic assurance");
        const freeze = this.ports.applyOrdinaryOperation(ctx, { taskId, operation: { op: "freeze_artifacts", actor_id: "executor" } });
        authorityBoundaryStarted = true;
        await freeze;
        ensureOperationLive();
        projection = await this.ports.projectTask(ctx.cwd, taskId);
        ensureOperationLive();
        if (projection.error || projection.projection.lifecycle !== "active" || projection.projection.artifact_state !== "frozen")
          return this.unknownAfterCommit(taskId, "qa", operationId, projection.error ?? "artifact freeze did not settle");
        authorityBoundaryStarted = false;
      }
      if (projection.projection.next_obligation === "complete") {
        progress("completing", "Completing the routine task after deterministic QA");
        try {
          await this.ports.applyOrdinaryOperation(ctx, { taskId, operation: { op: "complete", actor_id: "kernel-assurance" } });
          return { state: "completed" };
        } catch (error) {
          return this.unknownAfterCommit(taskId, "qa", operationId, boundedAssuranceError(error));
        }
      }
      if (projection.projection.next_obligation !== "run_qa" && projection.projection.next_obligation !== "run_review")
        return { state: "blocked", reason: `Kernel requires ${projection.projection.next_obligation}` };
      const qaAlreadySettled = projection.projection.next_obligation === "run_review";
      if (qaAlreadySettled)
        reviewPreparationStarted = true;
      const runner = await this.ports.frozenRunner();
      ensureOperationLive();
      if (!qaAlreadySettled && projection.projection.risk !== "routine") {
        progress("preparing_review_revision", "Proving the immutable Review revision before QA");
        try {
          if (parked.record?.contract === "assurance_kernel/task_record/v4") {
            if (!this.ports.ensureReviewRevision)
              throw new Error("v4 Review revision preparation is unavailable");
            await this.ports.ensureReviewRevision(ctx.cwd, taskId, projection);
          }
        } catch (error) {
          return { state: "blocked", reason: `review revision preparation failed: ${boundedAssuranceError(error)}` };
        }
        ensureOperationLive();
      }
      let qaVerdict;
      if (qaAlreadySettled) {
        progress("resuming_review", "Resuming Review preparation from the Kernel assurance projection");
      } else {
        progress("capturing_snapshot", "Capturing the immutable QA snapshot");
        await this.ports.qaBeforeProjection?.();
        ensureOperationLive();
        const assurance = await this.ports.buildAssurance(ctx.cwd, taskId, "qa", projection, runner);
        ensureOperationLive();
        qaVerdict = await this.ports.runQa(assurance.snapshot, assurance.descriptors, runner, {
          signal: operationController.signal,
          onProgress: (item) => progress("verifying", `QA ${item.index}/${item.total} ${item.acceptance_id} ${item.phase}`, { current: item.index, total: item.total, acceptance_id: item.acceptance_id })
        });
        ensureOperationLive();
        const invocation = this.openInvocation(taskId);
        try {
          progress("settling_qa", "Settling deterministic QA through the Kernel revision boundary");
          authorityBoundaryStarted = true;
          await this.ports.applyVerdict(ctx, {
            taskId,
            snapshot: assurance.snapshot,
            verdict: qaVerdict,
            invocation,
            actorId: "deterministic-qa",
            hooks: {
              beforeCommit: async () => {
                ensureOperationLive();
                await this.ports.qaBeforeAuthorityCommit?.();
                ensureOperationLive();
              },
              onCommit: () => {
                authorityCommitted = true;
                this.ports.qaOnAuthorityCommit?.();
              },
              afterCommit: async () => {
                await this.ports.qaAfterAuthorityCommit?.();
              }
            }
          });
          if (!(authorityCommitted && aborted())) {
            ensureOperationLive();
            authorityBoundaryStarted = false;
          }
        } catch (error) {
          if (!authorityCommitted && (aborted() || error instanceof VerificationAbortedError))
            return this.cancelled("qa", operationId, "host cancellation before QA authority commit");
          return authorityCommitted ? this.unknownAfterCommit(taskId, "qa", operationId, boundedAssuranceError(error)) : { state: "failed", operation: "qa", operation_id: operationId, reason: boundedAssuranceError(error) };
        } finally {
          if (this.invocationState(invocation) === "open")
            this.closeInvocation(invocation);
        }
      }
      if (qaVerdict?.decision === "rework")
        return { state: "rework", operation: "qa", operation_id: operationId, summary: qaVerdict.findings?.map((finding) => finding.summary).join("; ") ?? "deterministic QA requested rework" };
      if (!(authorityCommitted && aborted()))
        ensureOperationLive();
      progress("preparing_review", "Preparing the reserved foreground Review bundle");
      let fresh;
      try {
        fresh = await this.ports.projectTask(ctx.cwd, taskId);
      } catch (error) {
        return this.reviewPreparationFailed(taskId, operationId, boundedAssuranceError(error));
      }
      if (fresh.error || !fresh.claim) {
        if (qaAlreadySettled)
          return this.reviewPreparationFailed(taskId, operationId, fresh.error ?? "claim disappeared after QA settlement");
        return this.unknownAfterCommit(taskId, "qa", operationId, fresh.error ?? "claim disappeared after QA settlement");
      }
      if (fresh.projection.next_obligation === "complete") {
        progress("completing", "Deterministic QA passed; completing the routine task");
        try {
          await this.ports.applyOrdinaryOperation(ctx, { taskId, operation: { op: "complete", actor_id: "kernel-assurance" } });
          return { state: "completed" };
        } catch (error) {
          return this.unknownAfterCommit(taskId, "qa", operationId, boundedAssuranceError(error));
        }
      }
      if (fresh.projection.next_obligation !== "run_review") {
        if (authorityCommitted && aborted())
          return this.unknownAfterCommit(taskId, "qa", operationId, "QA settlement projection did not require Review after cancellation");
        return { state: "blocked", reason: `Kernel requires ${fresh.projection.next_obligation} after QA` };
      }
      reviewPreparationStarted = true;
      authorityCommitted = false;
      authorityBoundaryStarted = false;
      if (aborted())
        return this.reviewPreparationFailed(taskId, operationId, "host cancellation after QA authority settlement");
      progress("preparing_review", "Preparing the reserved foreground Review evidence");
      let review;
      let evidence;
      try {
        review = await this.ports.buildAssurance(ctx.cwd, taskId, "review", fresh, runner);
        const payload = review.reviewManifest ?? review.reviewBundle;
        if (!payload)
          throw new Error("review evidence is missing after QA settlement");
        evidence = this.ports.writeReviewEvidence({ snapshot: review.snapshot, evidence: payload });
      } catch (error) {
        return this.reviewPreparationFailed(taskId, operationId, boundedAssuranceError(error));
      }
      try {
        ensureOperationLive();
      } catch (error) {
        try {
          evidence.remove();
        } catch {}
        throw error;
      }
      let hostReservation;
      try {
        ensureOperationLive();
        const workload = classifyReviewWorkload(review.snapshot, review.reviewManifest ?? review.reviewBundle);
        hostReservation = this.ports.host.prepareReview({
          taskId,
          operationId,
          prompt: buildReviewPrompt(review.snapshot, evidence.path),
          evidencePath: evidence.path,
          maxTurns: reviewTurnBudget(workload)
        });
        ensureOperationLive();
      } catch (error) {
        try {
          evidence.remove();
        } catch {}
        return this.reviewPreparationFailed(taskId, operationId, boundedAssuranceError(error));
      }
      const reservation = {
        taskId,
        operationId,
        correlation: { record_revision: review.snapshot.record_revision, intent_content_hash: review.snapshot.intent_content_hash, diff_hash: review.snapshot.diff_hash },
        snapshot: review.snapshot,
        hostReservation,
        verdictCorrectionRequired: false,
        evidence
      };
      this.reviewReservations.set(taskId, reservation);
      progress("review_ready", "QA passed; invoke the reserved foreground Agent, then call submit_review", { snapshot_digest: snapshotDigest(review.snapshot), review_bundle_digest: review.snapshot.review_bundle_digest ?? "", agent_params: hostReservation.dispatch });
      return { state: "review_ready", operation: "review", operation_id: operationId, snapshot_digest: snapshotDigest(review.snapshot), review_bundle_digest: review.snapshot.review_bundle_digest ?? "", agent_params: hostReservation.dispatch };
    } catch (error) {
      if (reviewPreparationStarted) {
        const reason = aborted() || error instanceof VerificationAbortedError ? `${phase}: host cancellation` : `${phase}: ${boundedAssuranceError(error)}`;
        return this.reviewPreparationFailed(taskId, operationId, reason);
      }
      if (authorityCommitted || authorityBoundaryStarted)
        return this.unknownAfterCommit(taskId, "qa", operationId, `${phase}: ${boundedAssuranceError(error)}`);
      if (aborted() || error instanceof VerificationAbortedError)
        return this.cancelled("qa", operationId, `${phase}: host cancellation`);
      return { state: "failed", operation: "qa", operation_id: operationId, reason: `${phase}: ${boundedAssuranceError(error)}` };
    } finally {
      if (this.activeOperations.get(taskId) === operationId)
        this.activeOperations.delete(taskId);
      const controller = this.operationControllers.get(taskId);
      if (controller?.operationId === operationId)
        this.operationControllers.delete(taskId);
      signal?.removeEventListener("abort", relayExternalAbort);
    }
  }
  async submitReview(taskId, ctx, verdictInput) {
    const unknown = this.unknownOperations.get(taskId);
    if (unknown) {
      this.unknownOperations.delete(taskId);
      return { state: "settlement_unknown", operation: unknown.operation, operation_id: unknown.operationId, reason: unknown.reason };
    }
    const rejected = this.rejectedReviewOperations.get(taskId);
    if (rejected)
      return { state: "blocked", reason: rejected.reason };
    const reservation = this.reviewReservations.get(taskId);
    if (!reservation)
      return { state: "blocked", reason: "no active Review operation" };
    let fresh;
    try {
      fresh = await this.ports.projectTask(ctx.cwd, taskId);
    } catch (error) {
      const reason = boundedAssuranceError(error);
      this.releaseReviewReservation(taskId, reservation, reason);
      return { state: "blocked", reason };
    }
    if (fresh.error || !fresh.claim || fresh.claim.task_id !== taskId || fresh.projection.record_revision !== reservation.snapshot.record_revision || fresh.projection.workspace_revision !== reservation.snapshot.workspace_revision || fresh.projection.intent_revision !== reservation.snapshot.intent_revision || fresh.projection.intent_content_hash !== reservation.snapshot.intent_content_hash || fresh.projection.diff_hash !== reservation.snapshot.diff_hash || fresh.projection.lifecycle !== reservation.snapshot.lifecycle || fresh.projection.artifact_state !== reservation.snapshot.artifact_state) {
      const reason = fresh.error ?? "assurance snapshot changed before Review submission";
      this.releaseReviewReservation(taskId, reservation, reason);
      return { state: "blocked", reason };
    }
    if (reservation.snapshot.review_revision) {
      try {
        if (!this.ports.ensureReviewRevision)
          throw new Error("v4 Review revision verification is unavailable");
        const revision = await this.ports.ensureReviewRevision(ctx.cwd, taskId, fresh);
        if (!revision || revision.base_head !== reservation.snapshot.review_revision.base_head || revision.review_commit !== reservation.snapshot.review_revision.review_commit || revision.review_tree !== reservation.snapshot.review_revision.review_tree || revision.manifest_digest !== reservation.snapshot.review_revision.manifest_digest)
          throw new Error("Review revision changed before submission");
      } catch (error) {
        return this.reviewPreparationFailed(taskId, reservation.operationId, boundedAssuranceError(error));
      }
    }
    let verdict;
    try {
      verdict = parseAssuranceVerdict(verdictInput, reservation.snapshot);
    } catch (error) {
      reservation.verdictCorrectionRequired = true;
      return { state: "blocked", code: "verdict_invalid", reason: boundedAssuranceError(error) };
    }
    const invocation = this.openInvocation(taskId);
    this.releaseReviewReservation(taskId, reservation);
    try {
      await this.ports.applyVerdict(ctx, {
        taskId,
        snapshot: reservation.snapshot,
        verdict,
        invocation,
        actorId: "parent-mediated-review"
      });
    } catch (error) {
      const reason = boundedAssuranceError(error);
      return this.invocationState(invocation) === "committed" ? this.unknownAfterCommit(taskId, "review", reservation.operationId, reason) : { state: "blocked", reason };
    } finally {
      this.closeInvocation(invocation);
    }
    if (verdict.decision === "rework") {
      return {
        state: "rework",
        operation: "review",
        operation_id: reservation.operationId,
        summary: verdict.findings?.map((finding) => finding.summary).join("; ") ?? "independent Review requested rework"
      };
    }
    let settled;
    try {
      settled = await this.ports.projectTask(ctx.cwd, taskId);
    } catch (error) {
      return this.unknownAfterCommit(taskId, "review", reservation.operationId, boundedAssuranceError(error));
    }
    if (settled.error || !settled.claim)
      return this.unknownAfterCommit(taskId, "review", reservation.operationId, settled.error ?? "claim disappeared after Review settlement");
    if (settled.projection.next_obligation === "complete") {
      try {
        await this.ports.applyOrdinaryOperation(ctx, { taskId, operation: { op: "complete", actor_id: "kernel-assurance" } });
        return { state: "completed" };
      } catch (error) {
        return this.unknownAfterCommit(taskId, "review", reservation.operationId, boundedAssuranceError(error));
      }
    }
    return { state: "blocked", reason: `Kernel requires ${settled.projection.next_obligation} after Review` };
  }
  abandonReview(taskId, reason) {
    const reservation = this.reviewReservations.get(taskId);
    if (!reservation)
      return { state: "blocked", reason };
    this.releaseReviewReservation(taskId, reservation, reason);
    return { state: "blocked", reason };
  }
  reviewReadyResult(taskId) {
    const reservation = this.reviewReservations.get(taskId);
    if (!reservation)
      return { state: "blocked", reason: "Review reservation disappeared" };
    if (reservation.verdictCorrectionRequired)
      return { state: "blocked", code: "verdict_invalid", reason: "Review verdict correction is required before advancing" };
    return { state: "review_ready", operation: "review", operation_id: reservation.operationId, snapshot_digest: snapshotDigest(reservation.snapshot), review_bundle_digest: reservation.snapshot.review_bundle_digest ?? "", agent_params: reservation.hostReservation.dispatch };
  }
  releaseReviewReservation(taskId, reservation, rejectionReason) {
    if (this.reviewReservations.get(taskId) !== reservation)
      return;
    this.reviewReservations.delete(taskId);
    try {
      this.ports.host.releaseReview(reservation.hostReservation);
    } catch {}
    if (rejectionReason)
      this.rejectedReviewOperations.set(taskId, { operationId: reservation.operationId, reason: rejectionReason });
    this.removeEvidence(reservation);
  }
  removeEvidence(reservation) {
    try {
      reservation.evidence.remove();
    } catch {}
  }
  cancelled(operation, operationId, reason) {
    return { state: "cancelled", operation, operation_id: operationId, reason };
  }
  reviewPreparationFailed(taskId, operationId, reason) {
    const reservation = this.reviewReservations.get(taskId);
    if (reservation)
      this.releaseReviewReservation(taskId, reservation);
    this.rejectedReviewOperations.delete(taskId);
    return { state: "review_preparation_failed", operation: "review", operation_id: operationId, reason };
  }
  unknownAfterCommit(taskId, operation, operationId, reason) {
    this.unknownOperations.set(taskId, { operation, operationId, reason });
    return { state: "settlement_unknown", operation, operation_id: operationId, reason };
  }
}
function boundedAssuranceError(error) {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.replace(/\s+/g, " ").trim() || "unknown error";
  return normalized.length <= 300 ? normalized : `${normalized.slice(0, 299)}...`;
}

// plugins/immune-brain/runtime/assurance/review_evidence.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { createHash as createHash7 } from "node:crypto";
import {
  mkdtempSync,
  rmSync as rmSync2,
  writeFileSync,
  statSync as statSync2,
  readFileSync as readFileSync3,
  realpathSync as realpathSync3,
  chmodSync
} from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { join as join4 } from "node:path";

// plugins/immune-brain/runtime/workspace_scope.ts
import { spawnSync } from "node:child_process";
import { createHash as createHash6 } from "node:crypto";
import {
  existsSync as existsSync2,
  lstatSync as lstatSync2,
  readFileSync as readFileSync2,
  readlinkSync,
  realpathSync as realpathSync2
} from "node:fs";
import { resolve as resolve2 } from "node:path";
function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return result.status === 0 ? result.stdout : null;
}
function comparePaths(left, right) {
  if (left < right)
    return -1;
  if (left > right)
    return 1;
  return 0;
}
var GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
var TASK_GIT_MODES = new Set(["100644", "100755", "120000"]);
var fatalUtf8 = new TextDecoder("utf-8", { fatal: true });
var portablePathCollator = new Intl.Collator("und", {
  usage: "search",
  sensitivity: "base",
  numeric: false,
  ignorePunctuation: false
});
var gitTaskSnapshotTestHook;
function gitBytes(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error(`Git task snapshot command failed: git ${args.join(" ")}`);
  }
  return result.stdout;
}
function decodeCanonicalGitPath(bytes, label) {
  let value;
  try {
    value = fatalUtf8.decode(bytes);
  } catch {
    throw new Error(`${label} contains invalid UTF-8 path bytes`);
  }
  if (!Buffer.from(value, "utf8").equals(bytes))
    throw new Error(`${label} path does not round-trip through UTF-8`);
  if (value.normalize("NFC") !== value)
    throw new Error(`${label} path is not NFC-normalized: ${value}`);
  if (!value || value.includes("\x00") || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:\//.test(value) || value.split("/").some((part) => !part || part === "." || part === ".."))
    throw new Error(`${label} is not a canonical project-relative path: ${value}`);
  return value;
}
function decodeNullPaths(bytes, label) {
  if (bytes.length === 0)
    return [];
  if (bytes[bytes.length - 1] !== 0)
    throw new Error(`${label} is not NUL-terminated`);
  const paths = [];
  let start = 0;
  for (let index = 0;index < bytes.length; index += 1) {
    if (bytes[index] !== 0)
      continue;
    if (index === start)
      throw new Error(`${label} contains an empty path`);
    paths.push(decodeCanonicalGitPath(bytes.subarray(start, index), label));
    start = index + 1;
  }
  return paths;
}
function decodeIndexFlaggedPaths(bytes, label) {
  if (bytes.length === 0)
    return [];
  if (bytes[bytes.length - 1] !== 0)
    throw new Error(`${label} is not NUL-terminated`);
  const flagged = [];
  let start = 0;
  for (let index = 0;index < bytes.length; index += 1) {
    if (bytes[index] !== 0)
      continue;
    const record = bytes.subarray(start, index);
    if (record.length < 3 || record[1] !== 32)
      throw new Error(`${label} contains a malformed entry`);
    const tag = String.fromCharCode(record[0]);
    if (tag === "h" || tag === "S") {
      flagged.push({
        path: decodeCanonicalGitPath(record.subarray(2), label),
        flag: tag === "h" ? "assume-unchanged" : "skip-worktree"
      });
    }
    start = index + 1;
  }
  return flagged;
}
function assertNoScopedIndexFlags(root, scope, label) {
  const flagged = decodeIndexFlaggedPaths(gitBytes(root, ["ls-files", "-v", "-z", "--"]), "Git index flags").filter(({ path }) => taskPathMatchesScope(path, scope));
  if (flagged.length > 0)
    throw new Error(`${label} contains unsupported index flags: ${flagged.map(({ path, flag }) => `${path} (${flag})`).join(", ")}`);
}
function assertNoCaseFoldCollisions(paths, label) {
  const prefixes = [];
  for (const path of paths) {
    let prefix = "";
    for (const component of path.split("/")) {
      prefix = prefix ? `${prefix}/${component}` : component;
      const prior = prefixes.find((candidate) => candidate !== prefix && portablePathCollator.compare(candidate, prefix) === 0);
      if (prior !== undefined)
        throw new Error(`${label} contains a case-fold path collision: ${prior} and ${prefix}`);
      if (!prefixes.includes(prefix))
        prefixes.push(prefix);
    }
  }
}
function assertCanonicalTaskScope(scope) {
  if (!Array.isArray(scope) || scope.length === 0)
    throw new Error("task scope must contain at least one canonical path");
  const paths = scope.map((entry, index) => {
    if (typeof entry !== "string")
      throw new Error(`task scope entry ${index} must be a string`);
    return decodeCanonicalGitPath(Buffer.from(entry, "utf8"), `task scope entry ${index}`);
  });
  assertNoCaseFoldCollisions(paths, "task scope");
  const canonical = [...new Set(paths)].sort(comparePaths).filter((path, _index, all) => !all.some((candidate) => candidate !== path && !candidate.includes("*") && !candidate.includes("?") && path.startsWith(`${candidate}/`)));
  if (JSON.stringify(canonical) !== JSON.stringify(paths))
    throw new Error("task scope must already be canonical, sorted, and non-overlapping");
  return paths;
}
function parseGitTreeEntry(bytes, path, kind) {
  if (bytes.length === 0)
    return null;
  if (bytes[bytes.length - 1] !== 0)
    throw new Error(`${kind} entry for ${path} is not NUL-terminated`);
  const record = bytes.subarray(0, bytes.length - 1);
  if (record.includes(0))
    throw new Error(`${kind} returned multiple entries for ${path}`);
  const tab = record.indexOf(9);
  if (tab < 0)
    throw new Error(`${kind} entry for ${path} is malformed`);
  const metadata = record.subarray(0, tab).toString("ascii").split(" ");
  const returnedPath = decodeCanonicalGitPath(record.subarray(tab + 1), `${kind} entry`);
  if (returnedPath !== path)
    throw new Error(`${kind} returned an unexpected path: ${returnedPath}`);
  const mode = metadata[0];
  const oid = kind === "index" ? metadata[1] : metadata[2];
  const stage = kind === "index" ? metadata[2] : undefined;
  if (!TASK_GIT_MODES.has(mode))
    throw new Error(`${kind} entry for ${path} has unsupported mode ${mode}`);
  if (!oid || !GIT_OBJECT_ID.test(oid) || /^0+$/.test(oid))
    throw new Error(`${kind} entry for ${path} has invalid object identity`);
  if (stage !== undefined && stage !== "0")
    throw new Error(`index entry for ${path} is not at stage zero`);
  return { mode, oid };
}
function indexEntry(root, path) {
  return parseGitTreeEntry(gitBytes(root, ["ls-files", "--stage", "-z", "--", path]), path, "index");
}
function headEntry(root, head, path) {
  return parseGitTreeEntry(gitBytes(root, ["ls-tree", "-z", head, "--", path]), path, "HEAD");
}
function taskPathMatchesScope(path, scope) {
  return scope.some((scopePath) => pathMatchesScope(path, scopePath));
}
function taskSnapshotOnce(root, scope) {
  const repositoryRoot = git(root, ["rev-parse", "--show-toplevel"])?.trim();
  const head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"])?.trim();
  if (!repositoryRoot || !head || !GIT_OBJECT_ID.test(head))
    throw new Error("cannot derive task snapshot outside a committed Git workspace");
  if (realpathSync2(resolve2(repositoryRoot)) !== root)
    throw new Error("task snapshot repository root does not match the project root");
  const sparseCheckout = git(root, ["config", "--bool", "core.sparseCheckout"])?.trim();
  const sparseIndex = git(root, ["config", "--bool", "index.sparse"])?.trim();
  if (sparseCheckout === "true" || sparseIndex === "true")
    throw new Error("task snapshot does not support sparse checkout or sparse index");
  if (gitBytes(root, ["ls-files", "--unmerged", "-z"]).length > 0)
    throw new Error("task snapshot does not support unmerged index entries");
  assertNoScopedIndexFlags(root, scope, "task snapshot");
  const stagedPaths = decodeNullPaths(gitBytes(root, ["diff", "--cached", "--no-renames", "--name-only", "-z", head, "--"]), "staged task paths");
  const unstagedPaths = decodeNullPaths(gitBytes(root, ["diff", "--no-renames", "--name-only", "-z", "--"]), "unstaged task paths");
  const untrackedPaths = decodeNullPaths(gitBytes(root, ["ls-files", "--others", "--exclude-standard", "-z", "--"]), "untracked task paths");
  assertNoCaseFoldCollisions([...stagedPaths, ...unstagedPaths, ...untrackedPaths], "Git task paths");
  const uncommittedInScope = [...new Set([...unstagedPaths, ...untrackedPaths])].filter((path) => taskPathMatchesScope(path, scope)).sort(comparePaths);
  if (uncommittedInScope.length > 0)
    throw new Error(`task scope contains unstaged or untracked changes: ${uncommittedInScope.join(", ")}`);
  const taskPaths = [...new Set(stagedPaths)].filter((path) => taskPathMatchesScope(path, scope)).sort(comparePaths);
  const stagedFiles = {};
  for (const path of taskPaths) {
    const current = indexEntry(root, path);
    const base = headEntry(root, head, path);
    if (!current && !base)
      throw new Error(`task path has no index or HEAD identity: ${path}`);
    stagedFiles[path] = {
      status: !base ? "added" : !current ? "deleted" : "modified",
      mode: current?.mode ?? null,
      oid: current?.oid ?? null,
      base_mode: base?.mode ?? null,
      base_oid: base?.oid ?? null
    };
  }
  return {
    kind: "git-task-index-v1",
    repository_root: root,
    head,
    scope,
    staged_files: stagedFiles
  };
}
function captureGitTaskSnapshot(projectRoot, scopeHint) {
  const requestedRoot = resolve2(projectRoot);
  const requestedStat = lstatSync2(requestedRoot);
  if (requestedStat.isSymbolicLink() || !requestedStat.isDirectory())
    throw new Error("task snapshot root must be a real directory");
  const root = realpathSync2(requestedRoot);
  const scope = assertCanonicalTaskScope(scopeHint);
  const before = taskSnapshotOnce(root, scope);
  gitTaskSnapshotTestHook?.();
  const after = taskSnapshotOnce(root, scope);
  if (JSON.stringify(after) !== JSON.stringify(before))
    throw new Error("Git task snapshot changed while being captured");
  return before;
}
function hashTaskSnapshot(snapshot) {
  return `sha256:${createHash6("sha256").update(JSON.stringify(snapshot)).digest("hex")}`;
}
function taskDiffIdentity(projectRoot, scopeHint) {
  const snapshot = captureGitTaskSnapshot(projectRoot, scopeHint);
  return {
    diff_hash: hashTaskSnapshot(snapshot),
    changed_paths: Object.keys(snapshot.staged_files).sort(comparePaths)
  };
}
function taskDiffHash(projectRoot, scopeHint) {
  return taskDiffIdentity(projectRoot, scopeHint).diff_hash;
}
function gitRequired(root, args, failure) {
  const output = git(root, args);
  if (output === null)
    throw new Error(failure);
  return output.trim();
}
function taskRevisionSnapshotOnce(root, scope, baseHead) {
  const repositoryRoot = git(root, ["rev-parse", "--show-toplevel"])?.trim();
  const head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"])?.trim();
  if (!repositoryRoot || !head || !GIT_OBJECT_ID.test(head))
    throw new Error("cannot derive a task revision outside a committed Git workspace");
  if (realpathSync2(resolve2(repositoryRoot)) !== root)
    throw new Error("task revision repository root does not match the project root");
  if (gitRequired(root, ["cat-file", "-t", baseHead], `task revision base is unreadable: ${baseHead}`) !== "commit")
    throw new Error(`task revision base is not a commit: ${baseHead}`);
  if (git(root, ["merge-base", "--is-ancestor", baseHead, head]) === null)
    throw new Error(`task revision base ${baseHead} is no longer an ancestor of HEAD; rewrite the task history or re-enroll`);
  const baseTree = gitRequired(root, ["rev-parse", `${baseHead}^{tree}`], "task revision base tree is unreadable");
  if (!GIT_OBJECT_ID.test(baseTree))
    throw new Error("task revision base tree has invalid identity");
  const sparseCheckout = git(root, ["config", "--bool", "core.sparseCheckout"])?.trim();
  const sparseIndex = git(root, ["config", "--bool", "index.sparse"])?.trim();
  if (sparseCheckout === "true" || sparseIndex === "true")
    throw new Error("task revision does not support sparse checkout or sparse index");
  if (gitBytes(root, ["ls-files", "--unmerged", "-z"]).length > 0)
    throw new Error("task revision does not support unmerged index entries");
  assertNoScopedIndexFlags(root, scope, "task revision");
  const stagedPaths = decodeNullPaths(gitBytes(root, ["diff", "--cached", "--no-renames", "--name-only", "-z", baseHead, "--"]), "task revision paths");
  const unstagedPaths = decodeNullPaths(gitBytes(root, ["diff", "--no-renames", "--name-only", "-z", "--"]), "unstaged task revision paths");
  const untrackedPaths = decodeNullPaths(gitBytes(root, ["ls-files", "--others", "--exclude-standard", "-z", "--"]), "untracked task revision paths");
  const scopedStagedPaths = stagedPaths.filter((path) => taskPathMatchesScope(path, scope));
  const scopedUnstagedPaths = unstagedPaths.filter((path) => taskPathMatchesScope(path, scope));
  const scopedUntrackedPaths = untrackedPaths.filter((path) => taskPathMatchesScope(path, scope));
  assertNoCaseFoldCollisions([...scopedStagedPaths, ...scopedUnstagedPaths, ...scopedUntrackedPaths], "Git task revision paths");
  const drift = [...new Set([...scopedUnstagedPaths, ...scopedUntrackedPaths])].sort(comparePaths);
  if (drift.length > 0)
    throw new Error(`task scope contains unstaged or untracked changes: ${drift.join(", ")}`);
  const changed = [...new Set(scopedStagedPaths)].sort(comparePaths);
  const changedPaths = {};
  for (const path of changed) {
    const current = indexEntry(root, path);
    const base = headEntry(root, baseHead, path);
    if (!current && !base)
      throw new Error(`task revision path has no index or base identity: ${path}`);
    if (current && base && current.oid === base.oid && current.mode === base.mode)
      throw new Error(`task revision path is not actually changed: ${path}`);
    changedPaths[path] = {
      status: !base ? "added" : !current ? "deleted" : "modified",
      mode: current?.mode ?? null,
      oid: current?.oid ?? null,
      base_mode: base?.mode ?? null,
      base_oid: base?.oid ?? null
    };
  }
  return {
    kind: "git-task-revision-v1",
    repository_root: root,
    base_head: baseHead,
    base_tree: baseTree,
    scope,
    changed_paths: changedPaths
  };
}
function captureGitTaskRevisionSnapshot(projectRoot, scopeHint, baseHead) {
  const requestedRoot = resolve2(projectRoot);
  const requestedStat = lstatSync2(requestedRoot);
  if (requestedStat.isSymbolicLink() || !requestedStat.isDirectory())
    throw new Error("task revision root must be a real directory");
  const root = realpathSync2(requestedRoot);
  if (typeof baseHead !== "string" || !GIT_OBJECT_ID.test(baseHead.toLowerCase()))
    throw new Error("task revision base must be a Git commit id");
  const scope = assertCanonicalTaskScope(scopeHint);
  const normalizedBase = baseHead.toLowerCase();
  const before = taskRevisionSnapshotOnce(root, scope, normalizedBase);
  gitTaskSnapshotTestHook?.();
  const after = taskRevisionSnapshotOnce(root, scope, normalizedBase);
  if (JSON.stringify(after) !== JSON.stringify(before))
    throw new Error("Git task revision changed while being captured");
  return before;
}
function taskRevisionIdentity(projectRoot, scopeHint, baseHead) {
  const snapshot = captureGitTaskRevisionSnapshot(projectRoot, scopeHint, baseHead);
  return {
    diff_hash: hashTaskSnapshot(snapshot),
    changed_paths: Object.keys(snapshot.changed_paths).sort(comparePaths)
  };
}
function normalizeBoundaryPath(value) {
  return value.trim().replace(/^\.\//, "").replace(/\\/g, "/").replace(/\/+$/, "");
}
function globMatches(path, pattern) {
  const memo = new Map;
  const match = (pathIndex, patternIndex) => {
    const key = `${pathIndex}:${patternIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined)
      return cached;
    let result;
    if (patternIndex === pattern.length)
      result = pathIndex === path.length;
    else if (pattern[patternIndex] === "*") {
      const recursive = pattern[patternIndex + 1] === "*";
      const nextPatternIndex = patternIndex + (recursive ? 2 : 1);
      result = match(pathIndex, nextPatternIndex);
      if (!result && pathIndex < path.length) {
        result = (recursive || path[pathIndex] !== "/") && match(pathIndex + 1, patternIndex);
      }
    } else if (pathIndex === path.length)
      result = false;
    else if (pattern[patternIndex] === "?") {
      result = path[pathIndex] !== "/" && match(pathIndex + 1, patternIndex + 1);
    } else {
      result = path[pathIndex] === pattern[patternIndex] && match(pathIndex + 1, patternIndex + 1);
    }
    memo.set(key, result);
    return result;
  };
  return match(0, 0);
}
function pathMatchesScope(path, scopePath) {
  const normalizedPath = normalizeBoundaryPath(path);
  const normalizedScope = normalizeBoundaryPath(scopePath);
  if (!normalizedPath || !normalizedScope)
    return false;
  if (normalizedScope.includes("*") || normalizedScope.includes("?")) {
    return globMatches(normalizedPath, normalizedScope);
  }
  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

// plugins/immune-brain/runtime/assurance/review_evidence.ts
var MAX_REVIEW_BUNDLE_BYTES = 2 * 1024 * 1024;
function bundleDigest(bundle) {
  return `sha256:${createHash7("sha256").update(JSON.stringify(bundle)).digest("hex")}`;
}
var reviewUtf8 = new TextDecoder("utf-8", { fatal: true });
function readIndexBlob(root, path, entry) {
  if (!entry.oid)
    return null;
  const type = execFileSync2("git", ["cat-file", "-t", entry.oid], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 16,
    timeout: 1e4
  }).trim();
  if (type !== "blob")
    throw new Error(`index object is not a blob for ${path}`);
  const sizeText = execFileSync2("git", ["cat-file", "-s", entry.oid], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64,
    timeout: 1e4
  }).trim();
  const size = Number(sizeText);
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_REVIEW_BUNDLE_BYTES)
    throw new Error(`review file exceeds bounded size: ${path}`);
  const bytes = execFileSync2("git", ["cat-file", "blob", entry.oid], {
    cwd: root,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: MAX_REVIEW_BUNDLE_BYTES + 1,
    timeout: 1e4
  });
  if (bytes.length !== size)
    throw new Error(`index blob size changed during capture: ${path}`);
  let content;
  try {
    content = reviewUtf8.decode(bytes);
  } catch {
    throw new Error(`review file is not valid UTF-8: ${path}`);
  }
  if (!Buffer.from(content, "utf8").equals(bytes))
    throw new Error(`review file does not round-trip through UTF-8: ${path}`);
  return content;
}
var GIT_OBJECT_ID2 = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
var REVIEW_MODES = new Set(["100644", "100755", "120000"]);
function nullRecords(bytes) {
  if (bytes.length === 0)
    return [];
  if (bytes[bytes.length - 1] !== 0)
    throw new Error("git index listing is not NUL-terminated");
  const records = [];
  let start = 0;
  for (let index = 0;index < bytes.length; index += 1) {
    if (bytes[index] !== 0)
      continue;
    if (index === start)
      throw new Error("git index listing contains an empty record");
    records.push(bytes.subarray(start, index));
    start = index + 1;
  }
  return records;
}
function scopedNeighborhoodFiles(root, scope, dirtyPaths) {
  const listing = execFileSync2("git", ["ls-files", "--stage", "-z"], {
    cwd: root,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 32 * 1024 * 1024,
    timeout: 1e4
  });
  const entries = [];
  for (const record of nullRecords(listing)) {
    const tab = record.indexOf(9);
    if (tab < 0)
      throw new Error("git index entry is malformed");
    const [mode, oid, stage] = record.subarray(0, tab).toString("ascii").split(" ");
    let path;
    try {
      path = reviewUtf8.decode(record.subarray(tab + 1));
    } catch {
      throw new Error("git index path is not valid UTF-8");
    }
    if (!Buffer.from(path, "utf8").equals(record.subarray(tab + 1)))
      throw new Error("git index path does not round-trip through UTF-8");
    if (!scope.some((scopePath) => pathMatchesScope(path, scopePath)) || dirtyPaths.has(path))
      continue;
    if (!REVIEW_MODES.has(mode))
      throw new Error(`review neighborhood file has unsupported mode: ${path}`);
    if (!GIT_OBJECT_ID2.test(oid ?? "") || /^0+$/.test(oid ?? "") || stage !== "0")
      throw new Error(`review neighborhood file has invalid index identity: ${path}`);
    const content = readIndexBlob(root, path, { oid });
    if (content === null)
      throw new Error(`review neighborhood file is missing index content: ${path}`);
    entries.push([path, {
      mode,
      oid,
      base_mode: mode,
      base_oid: oid,
      fingerprint: `index:${mode}:${oid}`,
      current_content: content
    }]);
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}
function captureReviewBundle(root, scopeHint, expectedDiffHash, outcomes) {
  const before = captureGitTaskSnapshot(root, scopeHint);
  if (taskDiffHash(root, before.scope) !== expectedDiffHash)
    throw new Error("review task snapshot does not match assurance snapshot");
  const dirtyFiles = Object.fromEntries(Object.entries(before.staged_files).map(([path, entry]) => [path, {
    ...entry,
    fingerprint: `index:${entry.mode ?? "missing"}:${entry.oid ?? "missing"}`,
    current_content: readIndexBlob(before.repository_root, path, entry)
  }]));
  const neighborhoodFiles = scopedNeighborhoodFiles(before.repository_root, before.scope, new Set(Object.keys(dirtyFiles)));
  const pathProvenance = Object.fromEntries([
    ...Object.keys(dirtyFiles).map((path) => [path, "diff"]),
    ...Object.keys(neighborhoodFiles).map((path) => [path, "neighborhood"])
  ].sort(([left], [right]) => left.localeCompare(right)));
  const after = captureGitTaskSnapshot(root, before.scope);
  if (JSON.stringify(after) !== JSON.stringify(before) || taskDiffHash(root, before.scope) !== expectedDiffHash) {
    throw new Error("task snapshot changed while capturing immutable review bundle");
  }
  const unsigned = {
    contract: "assurance_kernel/review_bundle/v4",
    root: before.repository_root,
    head: before.head,
    scope: before.scope,
    diff_hash: expectedDiffHash,
    dirty_files: dirtyFiles,
    neighborhood_files: neighborhoodFiles,
    path_provenance: pathProvenance,
    outcomes: Object.fromEntries(Object.entries(outcomes).map(([id, outcome]) => [id, { ...outcome }]))
  };
  if (Buffer.byteLength(JSON.stringify(unsigned)) > MAX_REVIEW_BUNDLE_BYTES) {
    throw new Error("immutable review bundle exceeds bounded output limit");
  }
  return { ...unsigned, bundle_digest: bundleDigest(unsigned) };
}
var GIT_COMMIT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
var REVIEW_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var REVISION_DIFF_HASH = /^sha256:[a-f0-9]{64}$/;
var REVIEW_REF_NAMESPACE = "refs/immune-brain/reviews";
var SNAPSHOT_IDENTITY = {
  name: "Immune-Brain Assurance",
  email: "assurance@immune-brain.local",
  date: "1970-01-01T00:00:00 +0000"
};
function manifestDigest(manifest) {
  return `sha256:${createHash7("sha256").update(JSON.stringify(manifest)).digest("hex")}`;
}
function gitEvidenceBytes(root, args, extraEnv = {}) {
  return execFileSync2("git", args, {
    cwd: root,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30000,
    env: { ...process.env, ...extraEnv }
  });
}
function gitEvidence(root, args, extraEnv = {}) {
  return gitEvidenceBytes(root, args, extraEnv).toString("utf8").trim();
}
function decodeNullPaths2(bytes, label) {
  if (bytes.length === 0)
    return [];
  if (bytes[bytes.length - 1] !== 0)
    throw new Error(`${label} is not NUL-terminated`);
  const paths = [];
  let start = 0;
  for (let index = 0;index < bytes.length; index += 1) {
    if (bytes[index] !== 0)
      continue;
    if (index === start)
      throw new Error(`${label} contains an empty path`);
    const raw = bytes.subarray(start, index);
    let path;
    try {
      path = reviewUtf8.decode(raw);
    } catch {
      throw new Error(`${label} contains invalid UTF-8 path bytes`);
    }
    if (!Buffer.from(path, "utf8").equals(raw))
      throw new Error(`${label} path does not round-trip through UTF-8`);
    paths.push(path);
    start = index + 1;
  }
  return paths;
}
function reviewRefTaskSegment(taskId) {
  if (!REVIEW_TASK_ID.test(taskId))
    throw new Error("review task id has invalid identity");
  if (!taskId.includes("..") && !taskId.endsWith("."))
    return taskId;
  return `_${Buffer.from(taskId, "utf8").toString("base64url")}`;
}
function reviewRef(taskId, reviewCommit) {
  const taskSegment = reviewRefTaskSegment(taskId);
  if (!GIT_COMMIT_ID.test(reviewCommit))
    throw new Error("review commit has invalid identity");
  return `${REVIEW_REF_NAMESPACE}/${taskSegment}/${reviewCommit}`;
}
function revisionDelta(snapshot) {
  return Object.keys(snapshot.changed_paths).sort(compareRevisionPaths);
}
function compareRevisionPaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function publishReviewRevision(root, snapshot, diffHash, taskId) {
  if (snapshot.base_head !== snapshot.base_head.toLowerCase() || !GIT_COMMIT_ID.test(snapshot.base_head))
    throw new Error("review revision base has invalid identity");
  if (!REVISION_DIFF_HASH.test(diffHash))
    throw new Error("review revision diff hash has invalid identity");
  const indexDirectory = mkdtempSync(join4(tmpdir2(), "imm-review-index-"));
  try {
    const indexFile = join4(indexDirectory, "index");
    const env = { GIT_INDEX_FILE: indexFile };
    gitEvidence(root, ["read-tree", snapshot.base_tree], env);
    for (const [path, entry] of Object.entries(snapshot.changed_paths)) {
      if (entry.oid && entry.mode)
        gitEvidence(root, ["update-index", "--add", "--cacheinfo", `${entry.mode},${entry.oid},${path}`], env);
      else
        gitEvidence(root, ["update-index", "--force-remove", "--", path], env);
    }
    const reviewTree = gitEvidence(root, ["write-tree"], env);
    if (!GIT_COMMIT_ID.test(reviewTree))
      throw new Error("review synthetic tree write failed");
    const message = `Immune-Brain review snapshot task=${taskId} base=${snapshot.base_head} diff=${diffHash}`;
    const reviewCommit = gitEvidence(root, ["commit-tree", reviewTree, "-p", snapshot.base_head, "-m", message], {
      ...env,
      GIT_AUTHOR_NAME: SNAPSHOT_IDENTITY.name,
      GIT_AUTHOR_EMAIL: SNAPSHOT_IDENTITY.email,
      GIT_AUTHOR_DATE: SNAPSHOT_IDENTITY.date,
      GIT_COMMITTER_NAME: SNAPSHOT_IDENTITY.name,
      GIT_COMMITTER_EMAIL: SNAPSHOT_IDENTITY.email,
      GIT_COMMITTER_DATE: SNAPSHOT_IDENTITY.date,
      GPG_PROGRAM: ""
    });
    if (!GIT_COMMIT_ID.test(reviewCommit))
      throw new Error("review synthetic commit write failed");
    const ref = reviewRef(taskId, reviewCommit);
    const expected = revisionDelta(snapshot);
    const actual = decodeNullPaths2(gitEvidenceBytes(root, ["diff", "--no-renames", "--name-only", "-z", snapshot.base_head, reviewCommit]), "review synthetic commit paths").sort(compareRevisionPaths);
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(`review synthetic commit delta mismatch: expected ${expected.length} paths, got ${actual.length}`);
    const existing = (() => {
      try {
        return gitEvidence(root, ["rev-parse", "--verify", ref]);
      } catch {
        return null;
      }
    })();
    if (existing !== null && existing !== reviewCommit)
      throw new Error(`review ref ${ref} resolves to ${existing}, not ${reviewCommit}`);
    if (existing === null)
      gitEvidence(root, ["update-ref", ref, reviewCommit, ""]);
    return {
      contract: "assurance_kernel/review_revision/v1",
      base_head: snapshot.base_head,
      review_tree: reviewTree,
      review_commit: reviewCommit,
      review_ref: ref,
      diff_hash: diffHash
    };
  } finally {
    rmSync2(indexDirectory, { recursive: true, force: true });
  }
}
function publishInput(root, input) {
  if (typeof input.baseHead !== "string" || !GIT_COMMIT_ID.test(input.baseHead))
    throw new Error("review requires a TaskRecord v4 git_base_head");
  if (!REVISION_DIFF_HASH.test(input.expectedDiffHash))
    throw new Error("review task revision hash has invalid identity");
  const snapshot = captureGitTaskRevisionSnapshot(root, input.scopeHint, input.baseHead);
  const recomputed = `sha256:${createHash7("sha256").update(JSON.stringify(snapshot)).digest("hex")}`;
  if (recomputed !== input.expectedDiffHash)
    throw new Error("review task revision does not match assurance snapshot");
  return { snapshot, revision: publishReviewRevision(snapshot.repository_root, snapshot, recomputed, input.taskId) };
}
function captureReviewManifest(root, input) {
  const { snapshot, revision } = publishInput(root, input);
  const unsigned = {
    contract: "assurance_kernel/review_manifest/v5",
    task_id: input.taskId,
    intent_revision: input.intentRevision,
    intent_content_hash: input.intentContentHash,
    scope: snapshot.scope,
    base_head: revision.base_head,
    review_tree: revision.review_tree,
    review_commit: revision.review_commit,
    review_ref: revision.review_ref,
    changed_paths: snapshot.changed_paths,
    diff_hash: revision.diff_hash,
    outcomes: Object.fromEntries(Object.entries(input.outcomes).map(([id, outcome]) => [id, { ...outcome }])),
    record_revision: input.recordRevision,
    workspace_revision: input.workspaceRevision,
    lifecycle: input.lifecycle,
    artifact_state: input.artifactState,
    risk: input.risk
  };
  const manifest = { ...unsigned, manifest_digest: manifestDigest(unsigned) };
  if (Buffer.byteLength(JSON.stringify(manifest)) > MAX_REVIEW_BUNDLE_BYTES)
    throw new Error("immutable review manifest metadata exceeds bounded output limit");
  return manifest;
}
function ensureReviewRevision(root, input) {
  return publishInput(root, input).revision;
}
function writeNativeReviewEvidence(payload) {
  const rawDirectory = mkdtempSync(join4(tmpdir2(), "imm-canary-native-review-"));
  try {
    const directory = realpathSync3(rawDirectory);
    chmodSync(directory, 493);
    const path = join4(directory, "evidence.json");
    writeFileSync(path, JSON.stringify(payload), { encoding: "utf8", mode: 420, flag: "wx" });
    assertReviewArtifact(path);
    return {
      path,
      remove: () => rmSync2(directory, { recursive: true, force: true })
    };
  } catch (error) {
    rmSync2(rawDirectory, { recursive: true, force: true });
    throw error;
  }
}
function assertReviewArtifact(path) {
  const targetPath = realpathSync3(path);
  let stat;
  try {
    stat = statSync2(targetPath);
  } catch {
    throw new Error(`review evidence artifact is missing or empty: ${path}`);
  }
  if (!stat.isFile() || stat.size === 0)
    throw new Error(`review evidence artifact is missing or empty: ${path}`);
  const read = readFileSync3(targetPath, { encoding: "utf8" });
  if (read.trim().length === 0)
    throw new Error(`review evidence artifact is empty: ${path}`);
}

// plugins/immune-brain/runtime/kernel/backend_claim.ts
import { lstatSync as lstatSync3, readFileSync as readFileSync4 } from "node:fs";
import { join as join5, resolve as resolve3 } from "node:path";

// plugins/immune-brain/runtime/kernel/storage_paths.ts
var STATE_RELATIVE = ".imm/state";
var AUDIT_RELATIVE = ".imm/audit";
function validateTaskId(taskId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId))
    throw new Error(`task id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}: ${taskId}`);
}
function stateTaskRecordPath(taskId) {
  validateTaskId(taskId);
  return `${STATE_RELATIVE}/tasks/${taskId}.json`;
}
function stateWorkspacePath() {
  return `${STATE_RELATIVE}/workspace.json`;
}
function stateClaimPath() {
  return `${STATE_RELATIVE}/active-claim.json`;
}
function stateStoreLockPath() {
  return `${STATE_RELATIVE}/locks/kernel-store.lock`;
}
function stateTransactionPath(name) {
  if (!/^[A-Za-z0-9._-]+\.json$/.test(name))
    throw new Error(`invalid transaction marker name: ${name}`);
  return `${STATE_RELATIVE}/transactions/${name}`;
}
function auditTaskDirPath(taskId) {
  validateTaskId(taskId);
  return `${AUDIT_RELATIVE}/${taskId}`;
}
function auditTaskRecordPath(taskId) {
  return `${auditTaskDirPath(taskId)}/task-record.json`;
}
function auditTerminalProofPath(taskId) {
  return `${auditTaskDirPath(taskId)}/terminal-proof.json`;
}

// plugins/immune-brain/runtime/kernel/backend_claim.ts
var CLAIM_PATH = stateClaimPath();
var ALLOWED = [
  "contract",
  "backend",
  "task_id",
  "intent_revision",
  "intent_content_hash",
  "enrollment_event_id",
  "lifecycle_status",
  "created_at",
  "updated_at"
];
var TASK_TOMBSTONE_CONTRACT = "assurance_kernel/task_tombstone/v2";
var LEGACY_TASK_TOMBSTONE_CONTRACT = "assurance_kernel/task_tombstone/v1";
var TOMBSTONE_ALLOWED = [
  "contract",
  "task_id",
  "lifecycle_status",
  "terminal_lifecycle",
  "terminal_event_id",
  "final_record_hash",
  "terminalized_at"
];

class KernelBackendClaimError extends Error {
  constructor(message) {
    super(message);
    this.name = "KernelBackendClaimError";
  }
}
function validateTaskId2(taskId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId))
    throw new KernelBackendClaimError("task_id is not a safe file identity");
}
function readJsonOrNull(path) {
  try {
    const stat = lstatSync3(path);
    if (stat.isSymbolicLink())
      throw new KernelBackendClaimError("owner file must not be a symlink");
    if (!stat.isFile())
      throw new KernelBackendClaimError("owner file is not a regular file");
  } catch (error) {
    if (error.code === "ENOENT")
      return null;
    throw error;
  }
  return JSON.parse(readFileSync4(path, "utf8"));
}
function parseBackendClaim(raw) {
  const unknown = Object.keys(raw).filter((key) => !ALLOWED.includes(key));
  if (unknown.length > 0)
    throw new KernelBackendClaimError(`backend claim has unknown field: ${unknown[0]}`);
  if (raw.contract !== "assurance_kernel/backend_claim/v2")
    throw new KernelBackendClaimError("backend claim contract is invalid");
  if (raw.backend !== "kernel")
    throw new KernelBackendClaimError("backend claim backend must be kernel");
  if (typeof raw.task_id !== "string" || !raw.task_id.trim())
    throw new KernelBackendClaimError("backend claim task_id is invalid");
  validateTaskId2(raw.task_id);
  if (typeof raw.intent_revision !== "number" || !Number.isInteger(raw.intent_revision) || raw.intent_revision < 1)
    throw new KernelBackendClaimError("backend claim intent_revision is invalid");
  for (const field of ["intent_content_hash", "enrollment_event_id", "created_at", "updated_at"]) {
    if (typeof raw[field] !== "string" || !String(raw[field]).trim())
      throw new KernelBackendClaimError(`backend claim ${field} is invalid`);
  }
  if (raw.lifecycle_status !== "active" && raw.lifecycle_status !== "draining")
    throw new KernelBackendClaimError(`backend claim lifecycle_status must be active or draining; terminal state lives only in the task tombstone`);
  return raw;
}
function readBackendClaim(root) {
  const raw = readJsonOrNull(join5(root, CLAIM_PATH));
  if (!raw)
    return null;
  return parseBackendClaim(raw);
}
function serializeBackendClaim(claim) {
  parseBackendClaim(claim);
  return `${JSON.stringify(claim, null, 2)}
`;
}
function parseTaskTombstone(raw) {
  const legacy = raw.contract === LEGACY_TASK_TOMBSTONE_CONTRACT;
  const allowed = legacy ? TOMBSTONE_ALLOWED.map((field) => field === "terminal_lifecycle" ? "terminal_phase" : field) : TOMBSTONE_ALLOWED;
  const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    throw new KernelBackendClaimError(`task tombstone has unknown field: ${unknown[0]}`);
  if (!legacy && raw.contract !== TASK_TOMBSTONE_CONTRACT)
    throw new KernelBackendClaimError("task tombstone contract is invalid");
  if (typeof raw.task_id !== "string" || !raw.task_id.trim())
    throw new KernelBackendClaimError("task tombstone task_id is invalid");
  validateTaskId2(raw.task_id);
  if (raw.lifecycle_status !== "terminal")
    throw new KernelBackendClaimError("task tombstone lifecycle_status must be terminal");
  const terminalLifecycle = legacy ? raw.terminal_phase : raw.terminal_lifecycle;
  if (terminalLifecycle !== "done" && terminalLifecycle !== "stopped")
    throw new KernelBackendClaimError("task tombstone terminal_lifecycle must be done or stopped");
  for (const field of ["terminal_event_id", "final_record_hash", "terminalized_at"]) {
    if (typeof raw[field] !== "string" || !String(raw[field]).trim())
      throw new KernelBackendClaimError(`task tombstone ${field} is invalid`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(raw.final_record_hash))
    throw new KernelBackendClaimError("task tombstone final_record_hash must be a canonical sha256 hash");
  return {
    contract: TASK_TOMBSTONE_CONTRACT,
    task_id: raw.task_id,
    lifecycle_status: "terminal",
    terminal_lifecycle: terminalLifecycle,
    terminal_event_id: raw.terminal_event_id,
    final_record_hash: raw.final_record_hash,
    terminalized_at: raw.terminalized_at
  };
}
function readTaskTombstone(root, taskId) {
  validateTaskId2(taskId);
  const raw = readJsonOrNull(join5(resolve3(root), auditTerminalProofPath(taskId)));
  if (!raw)
    return null;
  const tombstone = parseTaskTombstone(raw);
  if (tombstone.task_id !== taskId)
    throw new KernelBackendClaimError("task tombstone identity is inconsistent");
  return tombstone;
}
function serializeTaskTombstone(tombstone) {
  parseTaskTombstone(tombstone);
  return `${JSON.stringify(tombstone, null, 2)}
`;
}

// plugins/immune-brain/runtime/kernel/storage.ts
import { createHash as createHash9, randomUUID as randomUUID3 } from "node:crypto";
import {
  closeSync as closeSync3,
  constants as constants2,
  fstatSync as fstatSync3,
  fsyncSync,
  lstatSync as lstatSync5,
  mkdirSync as mkdirSync2,
  openSync as openSync3,
  readFileSync as readFileSync6,
  realpathSync as realpathSync5,
  renameSync,
  rmSync as rmSync3,
  writeFileSync as writeFileSync2
} from "node:fs";
import { basename, dirname as dirname3, isAbsolute as isAbsolute3, relative as relative2, resolve as resolve5, sep as sep4 } from "node:path";

// plugins/immune-brain/runtime/kernel/types.ts
var TASK_PHASES = ["working", "review", "done", "stopped"];
var TASK_LIFECYCLES = ["active", "done", "stopped"];
var TASK_ARTIFACT_STATES = ["active", "frozen"];
var TASK_RISKS = ["routine", "material", "critical"];
var TASK_INTENT_CONTRACT_V1 = "assurance_kernel/task_intent/v1";
var TASK_RECORD_CONTRACT_V2 = "assurance_kernel/task_record/v2";
var TASK_RECORD_CONTRACT_V3 = "assurance_kernel/task_record/v3";
var TASK_RECORD_CONTRACT_V4 = "assurance_kernel/task_record/v4";
var REVIEW_REVISION_IDENTITY_CONTRACT = "assurance_kernel/review_revision_identity/v1";
var REDUCED_MUTATION_BRAND = Symbol("assurance-kernel-reduced-mutation-v2");
var MUTATION_AUTHORITY_CAPABILITY_BRAND = Symbol("assurance-kernel-mutation-authority-capability");

// plugins/immune-brain/runtime/kernel/intent.ts
import { createHash as createHash8 } from "node:crypto";
import {
  closeSync as closeSync2,
  constants as fsConstants,
  fstatSync as fstatSync2,
  lstatSync as lstatSync4,
  openSync as openSync2,
  readFileSync as readFileSync5,
  realpathSync as realpathSync4
} from "node:fs";
import { execFileSync as execFileSync3 } from "node:child_process";
import { join as join6, resolve as resolve4, sep as sep3 } from "node:path";

// plugins/immune-brain/runtime/kernel/intent_token_registry.ts
var TOKEN_BRAND = Symbol("assurance-kernel-task-intent-identity-token");
var tokenIdentities = new WeakMap;
var consumedTokens = new WeakSet;
function isIntentIdentityToken(value) {
  return !!value && typeof value === "object" && value[TOKEN_BRAND] === true;
}
function mintToken(identity) {
  const token = Object.freeze(Object.defineProperty({}, TOKEN_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false
  }));
  tokenIdentities.set(token, identity);
  return token;
}
function identityOf(token) {
  const identity = tokenIdentities.get(token);
  if (!identity)
    throw new Error("intent identity token is not recognized");
  return identity;
}
function inspectIntentTokenPair(prior, current) {
  if (!isIntentIdentityToken(prior) || !isIntentIdentityToken(current))
    throw new Error("intent identity tokens are required");
  if (consumedTokens.has(prior) || consumedTokens.has(current))
    throw new Error("intent identity token is already consumed");
  const priorIdentity = identityOf(prior);
  const currentIdentity = identityOf(current);
  if (priorIdentity.canonical_root !== currentIdentity.canonical_root)
    throw new Error("intent token canonical root mismatch");
  return { prior: priorIdentity, current: currentIdentity };
}
function consumeIntentToken(token) {
  if (!isIntentIdentityToken(token))
    throw new Error("intent identity token is required");
  if (consumedTokens.has(token))
    throw new Error("intent identity token is already consumed");
  const identity = identityOf(token);
  consumedTokens.add(token);
  return identity;
}

// plugins/immune-brain/runtime/kernel/intent.ts
var INTENT_MAX_BYTES = 64 * 1024;
var INTENT_SIDECAR_RELATIVE_PREFIX = "docs/plans/";
var RISK_FLOOR_SCOPE_PREFIXES = [
  "plugins/immune-brain/runtime/kernel",
  "plugins/immune-brain/runtime/authority_commit_receipts.ts",
  "plugins/immune-brain/.pi-extension"
];
var CHANGED_PATH_RISK_FLOOR_PREFIXES = [
  "plugins/immune-brain/runtime/kernel",
  "plugins/immune-brain/.pi-extension",
  "docs/specs",
  "docs/plans"
];
function segmentMatches(e, s) {
  if (e === "*")
    return true;
  if (!e.includes("*") && !e.includes("?"))
    return e === s;
  const rx = new RegExp(`^${e.split("*").map((p) => p.split("?").map((q) => q.replace(/[.\\+^${}()|[\]\\/]/g, "\\$&")).join(".")).join(".*")}$`);
  return rx.test(s);
}
function scopeEntryTouchesPrefixSegments(es, ps) {
  const memo = new Map;
  const m = (pi, ei) => {
    const key = `${pi}:${ei}`;
    const cached = memo.get(key);
    if (cached !== undefined)
      return cached;
    let result;
    if (ei === es.length) {
      result = true;
    } else {
      const e = es[ei];
      if (e === "**") {
        if (pi >= ps.length)
          result = true;
        else
          result = m(pi, ei + 1) || m(pi + 1, ei);
      } else if (pi < ps.length && segmentMatches(e, ps[pi])) {
        result = m(pi + 1, ei + 1);
      } else if (pi >= ps.length) {
        result = m(pi + 1, ei + 1);
      } else {
        result = false;
      }
    }
    memo.set(key, result);
    return result;
  };
  return m(0, 0);
}
function scopeEntryTouchesRiskFloorPaths(entry) {
  if (!entry)
    return false;
  const es = entry.split("/");
  return RISK_FLOOR_SCOPE_PREFIXES.some((prefix) => scopeEntryTouchesPrefixSegments(es, prefix.split("/")));
}
function riskFloorForScope(scopeHint) {
  return scopeHint.some(scopeEntryTouchesRiskFloorPaths) ? "material" : null;
}
var TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var portablePathCollator2 = new Intl.Collator("und", {
  usage: "search",
  sensitivity: "base",
  numeric: false,
  ignorePunctuation: false
});
function sha256Hex(bytes) {
  return createHash8("sha256").update(bytes).digest("hex");
}
function objectAt(value, path, violations) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    violations.push(`${path} must be an object`);
    return {};
  }
  return value;
}
function rejectUnknown(record, allowed, path, violations) {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key))
      violations.push(`unknown field: ${path}.${key}`);
  }
}
function nonEmptyString(value, path, violations, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    violations.push(`${path} must be a non-empty string no longer than ${max}`);
    return "";
  }
  return value;
}
function positiveInteger(value, path, violations) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    violations.push(`${path} must be a positive integer`);
    return 0;
  }
  return value;
}
function parseAcceptanceItemV1(value, index, violations) {
  const item = objectAt(value, `intent.acceptance[${index}]`, violations);
  rejectUnknown(item, ["id", "assertion", "verification"], `intent.acceptance[${index}]`, violations);
  return {
    id: nonEmptyString(item.id, `intent.acceptance[${index}].id`, violations, 64),
    assertion: nonEmptyString(item.assertion, `intent.acceptance[${index}].assertion`, violations, 2000),
    verification: nonEmptyString(item.verification, `intent.acceptance[${index}].verification`, violations, 2000)
  };
}
function parseScopeHintV1(value, violations) {
  if (!Array.isArray(value) || value.length === 0) {
    violations.push("intent.scope_hint must contain at least one path");
    return [];
  }
  const entries = [];
  for (let index = 0;index < value.length; index += 1) {
    const path = `intent.scope_hint[${index}]`;
    const raw = nonEmptyString(value[index], path, violations, 200);
    if (!raw)
      continue;
    if (raw !== raw.trim())
      violations.push(`${path} must not contain surrounding whitespace`);
    let entry = raw.trim();
    while (entry.endsWith("/"))
      entry = entry.slice(0, -1);
    if (!entry || entry === "." || entry === "*" || entry === "**" || entry === "**/*" || entry.includes("\x00") || entry.includes("\\") || entry.startsWith("/") || /^[A-Za-z]:\//.test(entry) || entry.split("/").some((part) => !part || part === "." || part === "..")) {
      violations.push(`${path} must be a canonical project-relative path or pattern`);
      continue;
    }
    if (Buffer.from(entry, "utf8").toString("utf8") !== entry) {
      violations.push(`${path} must contain valid round-trippable UTF-8`);
      continue;
    }
    if (entry.normalize("NFC") !== entry) {
      violations.push(`${path} must use NFC Unicode normalization`);
      continue;
    }
    entries.push(entry);
  }
  const componentIdentities = [];
  for (const entry of entries) {
    let prefix = "";
    for (const component of entry.split("/")) {
      prefix = prefix ? `${prefix}/${component}` : component;
      const prior = componentIdentities.find((candidate) => candidate !== prefix && portablePathCollator2.compare(candidate, prefix) === 0);
      if (prior !== undefined) {
        violations.push(`intent.scope_hint contains a case-fold path collision: ${prior} and ${prefix}`);
      } else if (!componentIdentities.includes(prefix)) {
        componentIdentities.push(prefix);
      }
    }
  }
  const unique = [...new Set(entries)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return unique.filter((entry) => !unique.some((candidate) => candidate !== entry && !candidate.includes("*") && !candidate.includes("?") && entry.startsWith(`${candidate}/`)));
}
function parseTaskIntentV1(raw) {
  const violations = [];
  const value = objectAt(raw, "intent", violations);
  rejectUnknown(value, ["contract", "task_id", "goal", "acceptance", "scope_hint", "risk", "revision", "owner"], "intent", violations);
  if (value.contract !== TASK_INTENT_CONTRACT_V1)
    violations.push(`contract must equal ${TASK_INTENT_CONTRACT_V1}`);
  const acceptanceRaw = value.acceptance;
  if (!Array.isArray(acceptanceRaw) || acceptanceRaw.length === 0) {
    violations.push("intent.acceptance must contain at least one item");
  } else {
    const acceptance2 = acceptanceRaw.map((item, index) => parseAcceptanceItemV1(item, index, violations));
    const ids = new Set;
    for (const item of acceptance2) {
      if (ids.has(item.id))
        violations.push(`duplicate acceptance id: ${item.id}`);
      ids.add(item.id);
    }
  }
  const scopeHint = parseScopeHintV1(value.scope_hint, violations);
  const risk = value.risk;
  if (typeof risk !== "string" || !TASK_RISKS.includes(risk))
    violations.push(`intent.risk must be one of ${TASK_RISKS.join(", ")}`);
  if (value.owner !== "user")
    violations.push("intent.owner must equal user");
  const taskId = nonEmptyString(value.task_id, "intent.task_id", violations, 128);
  const goal = nonEmptyString(value.goal, "intent.goal", violations, 2000);
  const revision = positiveInteger(value.revision, "intent.revision", violations);
  if (violations.length > 0)
    throw new Error(violations.join("; "));
  const acceptance = acceptanceRaw.map((item, index) => parseAcceptanceItemV1(item, index, []));
  const declaredRisk = risk;
  const flooredRisk = riskFloorForScope(scopeHint);
  return {
    contract: TASK_INTENT_CONTRACT_V1,
    task_id: taskId,
    goal,
    acceptance,
    scope_hint: scopeHint,
    risk: flooredRisk !== null && RISK_RANK[declaredRisk] < RISK_RANK[flooredRisk] ? flooredRisk : declaredRisk,
    revision,
    owner: "user"
  };
}
function canonicalIntentHash(intent) {
  return `sha256:${sha256Hex(stableStringify(intent))}`;
}
var RISK_RANK = { routine: 0, material: 1, critical: 2 };
function classifyTaskRisk(changedPaths, declaredRisk) {
  const pathFloor = changedPaths.some((path) => CHANGED_PATH_RISK_FLOOR_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) ? "material" : "routine";
  return RISK_RANK[declaredRisk] >= RISK_RANK[pathFloor] ? declaredRisk : pathFloor;
}
function contentHashWithoutRevision(intent) {
  const { revision: _revision, ...rest } = intent;
  return canonicalIntentHash(rest);
}
function classifyIntentRevision(previous, next) {
  if (contentHashWithoutRevision(previous) === contentHashWithoutRevision(next))
    return "unchanged";
  const breaking = previous.contract !== next.contract || previous.task_id !== next.task_id || previous.owner !== next.owner || previous.goal !== next.goal || JSON.stringify(previous.scope_hint) !== JSON.stringify(next.scope_hint) || RISK_RANK[next.risk] < RISK_RANK[previous.risk] || previous.acceptance.some((prior) => {
    const current = next.acceptance.find((item) => item.id === prior.id);
    return !current || current.assertion !== prior.assertion;
  });
  if (breaking)
    return "breaking";
  return next.revision > previous.revision ? "compatible" : "breaking";
}
var intentReaderTestHook = null;
function validateTaskId3(taskId) {
  if (!TASK_ID_PATTERN.test(taskId))
    throw new Error("task id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}");
}
function statIdentity(stat) {
  if (!stat)
    throw new Error("stat identity is unavailable");
  return {
    dev: Number(stat.dev),
    ino: Number(stat.ino),
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs)
  };
}
function assertSameIdentity(before, after, what) {
  const current = statIdentity(after);
  if (current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size || current.mtimeMs !== before.mtimeMs)
    throw new Error(`${what} changed while being read`);
}
function resolveCanonicalRoot(root) {
  const resolved = resolve4(root);
  const rootStat = lstatSync4(resolved);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw new Error("project root must be a real directory, not a symlink");
  return realpathSync4(resolved);
}
function collectPathIdentities(canonicalRoot, relativePath) {
  const identities = [];
  let current = canonicalRoot;
  for (const part of relativePath.split("/")) {
    current = join6(current, part);
    const stat = lstatSync4(current);
    if (stat.isSymbolicLink())
      throw new Error("intent sidecar path contains a symlink");
    identities.push({ dev: stat.dev, ino: stat.ino });
  }
  return identities;
}
function assertIdentitiesUnchanged(expected, canonicalRoot, relativePath) {
  let current = canonicalRoot;
  const parts = relativePath.split("/");
  for (let index = 0;index < parts.length; index += 1) {
    current = join6(current, parts[index]);
    const stat = lstatSync4(current);
    if (stat.dev !== expected[index].dev || stat.ino !== expected[index].ino)
      throw new Error(`path component changed while being read: ${parts.slice(0, index + 1).join("/")}`);
  }
}
function readTaskIntent(root, taskId, requestedPath) {
  validateTaskId3(taskId);
  const canonicalRoot = resolveCanonicalRoot(root);
  const activePath = `${INTENT_SIDECAR_RELATIVE_PREFIX}${taskId}.intent.json`;
  const archivedPath = `${INTENT_SIDECAR_RELATIVE_PREFIX}archive/${taskId}.intent.json`;
  const sidecarPath = requestedPath ?? activePath;
  if (sidecarPath !== activePath && sidecarPath !== archivedPath)
    throw new Error("intent sidecar path is not the active or archived task path");
  const target = join6(canonicalRoot, sidecarPath);
  if (!target.startsWith(canonicalRoot + sep3))
    throw new Error("intent sidecar escapes project root");
  const pathIdentities = collectPathIdentities(canonicalRoot, sidecarPath);
  const fileIdentity = pathIdentities[pathIdentities.length - 1];
  try {
    execFileSync3("git", ["ls-files", "--error-unmatch", "--", sidecarPath], { cwd: canonicalRoot, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error("TaskIntent sidecar is not Git-tracked");
  }
  const before = lstatSync4(target);
  if (!before.isFile() || before.size > INTENT_MAX_BYTES)
    throw new Error("TaskIntent sidecar must be a regular file no larger than 64 KiB");
  const fd = openSync2(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  let bytes;
  try {
    const fdStat = fstatSync2(fd);
    assertSameIdentity(statIdentity(before), fdStat, "intent sidecar descriptor");
    intentReaderTestHook?.onBeforeDescriptorRead?.();
    bytes = readFileSync5(fd);
  } finally {
    closeSync2(fd);
  }
  if (bytes.byteLength > INTENT_MAX_BYTES)
    throw new Error("TaskIntent sidecar exceeds 64 KiB");
  const after = lstatSync4(target);
  assertSameIdentity(statIdentity(before), after, "intent sidecar");
  assertIdentitiesUnchanged(pathIdentities, canonicalRoot, sidecarPath);
  const canonicalAgain = realpathSync4(root);
  if (canonicalAgain !== canonicalRoot)
    throw new Error("canonical project root drifted while being read");
  if (lstatSync4(canonicalAgain).isSymbolicLink())
    throw new Error("canonical project root became a symlink while being read");
  const sourceBytesSha256 = sha256Hex(bytes);
  let intent;
  try {
    intent = parseTaskIntentV1(JSON.parse(bytes.toString("utf8")));
  } catch (error) {
    throw new Error(`TaskIntent sidecar is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (intent.task_id !== taskId)
    throw new Error("intent.task_id does not match the sidecar filename task id");
  const contentHash = canonicalIntentHash(intent);
  const token = mintToken({
    canonical_root: canonicalRoot,
    sidecar_path: sidecarPath,
    path_dev: fileIdentity.dev,
    path_ino: fileIdentity.ino,
    fd_dev: before.dev,
    fd_ino: before.ino,
    fd_size: before.size,
    fd_mtime_ms: before.mtimeMs,
    source_bytes_sha256: sourceBytesSha256,
    intent_content_hash: contentHash
  });
  return {
    intent,
    content_hash: contentHash,
    intent_ref: {
      path: sidecarPath,
      revision: intent.revision,
      content_hash: contentHash
    },
    token
  };
}

// plugins/immune-brain/runtime/kernel/validation.ts
var GIT_OBJECT_ID3 = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

class KernelValidationError extends Error {
  violations;
  code = "kernel_schema_invalid";
  constructor(violations) {
    super(violations.join("; "));
    this.violations = violations;
    this.name = "KernelValidationError";
  }
}

class KernelInvariantError extends Error {
  violations;
  code = "kernel_invariant_violation";
  constructor(violations) {
    super(violations.join("; "));
    this.violations = violations;
    this.name = "KernelInvariantError";
  }
}
function objectAt2(value, path, violations) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    violations.push(`${path} must be an object`);
    return {};
  }
  return value;
}
function rejectUnknown2(record, allowed, path, violations) {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key))
      violations.push(path === "record" ? `unknown field: ${key}` : `unknown field: ${path}.${key}`);
  }
}
function stringAt(value, path, violations) {
  if (typeof value !== "string" || !value.trim()) {
    violations.push(`${path} must be a non-empty string`);
    return "";
  }
  return value;
}
function positiveInteger2(value, path, violations) {
  if (!Number.isInteger(value) || Number(value) < 1) {
    violations.push(`${path} must be a positive integer`);
    return 0;
  }
  return Number(value);
}
function nullableString(value, path, violations) {
  if (value === null)
    return null;
  return stringAt(value, path, violations);
}
function nullablePositiveInteger(value, path, violations) {
  if (value === null)
    return null;
  return positiveInteger2(value, path, violations);
}
function enumAt(value, allowed, path, violations) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    violations.push(`${path} must be one of ${allowed.join(", ")}`);
    return allowed[0];
  }
  return value;
}
function arrayAt(value, path, violations) {
  if (!Array.isArray(value)) {
    violations.push(`${path} must be an array`);
    return [];
  }
  return value;
}
function uniqueIds(items, path, violations) {
  const seen = new Set;
  for (const item of items) {
    if (seen.has(item.id))
      violations.push(`${path} contains duplicate id ${item.id}`);
    seen.add(item.id);
  }
}
var EVIDENCE_STATUSES = ["passed", "failed", "blocked"];
var FINDING_KINDS = [
  "blocking",
  "advisory",
  "unresolved_user_decision",
  "replan_required"
];
var FINDING_STATUSES = ["open", "resolved"];
var FINDING_SOURCES = [
  "execution",
  "review",
  "kernel",
  "migration"
];
var APPROVAL_KINDS = ["review", "qa", "user"];
var APPROVAL_AUTHORITY_ROLES = [
  "reviewer",
  "qa",
  "user"
];
function parseFinding(value, index, violations) {
  const path = `record.findings[${index}]`;
  const item = objectAt2(value, path, violations);
  rejectUnknown2(item, ["id", "kind", "status", "acceptance_id", "source", "review_round", "summary"], path, violations);
  return {
    id: stringAt(item.id, `${path}.id`, violations),
    kind: enumAt(item.kind, FINDING_KINDS, `${path}.kind`, violations),
    status: enumAt(item.status, FINDING_STATUSES, `${path}.status`, violations),
    acceptance_id: nullableString(item.acceptance_id, `${path}.acceptance_id`, violations),
    source: enumAt(item.source, FINDING_SOURCES, `${path}.source`, violations),
    review_round: nullablePositiveInteger(item.review_round, `${path}.review_round`, violations),
    summary: stringAt(item.summary, `${path}.summary`, violations)
  };
}
function parseHistoryV2(value, index, violations) {
  const item = objectAt2(value, `record.history[${index}]`, violations);
  rejectUnknown2(item, ["id", "at", "type", "from_phase", "to_phase", "reason", "authority"], `record.history[${index}]`, violations);
  let authority;
  if (item.authority !== undefined) {
    const auth = objectAt2(item.authority, `record.history[${index}].authority`, violations);
    rejectUnknown2(auth, ["authority_kind", "actor_id", "confirmation_ref", "issued_at", "expires_at"], `record.history[${index}].authority`, violations);
    const kind = enumAt(auth.authority_kind, ["review", "qa", "user"], `record.history[${index}].authority.authority_kind`, violations);
    authority = {
      authority_kind: kind,
      actor_id: stringAt(auth.actor_id, `record.history[${index}].authority.actor_id`, violations),
      confirmation_ref: stringAt(auth.confirmation_ref, `record.history[${index}].authority.confirmation_ref`, violations),
      issued_at: stringAt(auth.issued_at, `record.history[${index}].authority.issued_at`, violations),
      expires_at: stringAt(auth.expires_at, `record.history[${index}].authority.expires_at`, violations)
    };
  }
  return {
    id: stringAt(item.id, `record.history[${index}].id`, violations),
    at: stringAt(item.at, `record.history[${index}].at`, violations),
    type: stringAt(item.type, `record.history[${index}].type`, violations),
    from_phase: enumAt(item.from_phase, TASK_PHASES, `record.history[${index}].from_phase`, violations),
    to_phase: enumAt(item.to_phase, TASK_PHASES, `record.history[${index}].to_phase`, violations),
    reason: stringAt(item.reason, `record.history[${index}].reason`, violations),
    ...authority ? { authority } : {}
  };
}
function parseHistoryV3(value, index, violations) {
  const path = `record.history[${index}]`;
  const item = objectAt2(value, path, violations);
  rejectUnknown2(item, ["id", "at", "type", "from_state", "to_state", "reason", "authority"], path, violations);
  let authority;
  if (item.authority !== undefined) {
    const auth = objectAt2(item.authority, `${path}.authority`, violations);
    rejectUnknown2(auth, ["authority_kind", "actor_id", "confirmation_ref", "issued_at", "expires_at"], `${path}.authority`, violations);
    authority = {
      authority_kind: enumAt(auth.authority_kind, ["review", "qa", "user"], `${path}.authority.authority_kind`, violations),
      actor_id: stringAt(auth.actor_id, `${path}.authority.actor_id`, violations),
      confirmation_ref: stringAt(auth.confirmation_ref, `${path}.authority.confirmation_ref`, violations),
      issued_at: stringAt(auth.issued_at, `${path}.authority.issued_at`, violations),
      expires_at: stringAt(auth.expires_at, `${path}.authority.expires_at`, violations)
    };
  }
  return {
    id: stringAt(item.id, `${path}.id`, violations),
    at: stringAt(item.at, `${path}.at`, violations),
    type: stringAt(item.type, `${path}.type`, violations),
    from_state: stringAt(item.from_state, `${path}.from_state`, violations),
    to_state: stringAt(item.to_state, `${path}.to_state`, violations),
    reason: stringAt(item.reason, `${path}.reason`, violations),
    ...authority ? { authority } : {}
  };
}
var SHA256_HEX = /^sha256:[a-f0-9]{64}$/;
function parseEvidenceV2(value, index, acceptanceIds, violations) {
  const item = objectAt2(value, `record.evidence[${index}]`, violations);
  rejectUnknown2(item, ["id", "acceptance_id", "task_revision", "intent_content_hash", "diff_hash", "status", "actor_id", "summary"], `record.evidence[${index}]`, violations);
  const acceptanceId = stringAt(item.acceptance_id, `record.evidence[${index}].acceptance_id`, violations);
  if (acceptanceIds && !acceptanceIds.has(acceptanceId))
    violations.push(`evidence ${String(item.id)} references unknown acceptance ${acceptanceId}`);
  const intentContentHash = stringAt(item.intent_content_hash, `record.evidence[${index}].intent_content_hash`, violations);
  if (!SHA256_HEX.test(intentContentHash))
    violations.push(`record.evidence[${index}].intent_content_hash must be sha256:<64 hex>`);
  const diffHash = stringAt(item.diff_hash, `record.evidence[${index}].diff_hash`, violations);
  if (!SHA256_HEX.test(diffHash))
    violations.push(`record.evidence[${index}].diff_hash must be sha256:<64 hex>`);
  return {
    id: stringAt(item.id, `record.evidence[${index}].id`, violations),
    acceptance_id: acceptanceId,
    task_revision: positiveInteger2(item.task_revision, `record.evidence[${index}].task_revision`, violations),
    intent_content_hash: intentContentHash,
    diff_hash: diffHash,
    status: enumAt(item.status, EVIDENCE_STATUSES, `record.evidence[${index}].status`, violations),
    actor_id: stringAt(item.actor_id, `record.evidence[${index}].actor_id`, violations),
    summary: stringAt(item.summary, `record.evidence[${index}].summary`, violations)
  };
}
function parseApprovalV2(value, index, violations, allowReviewRevision = false) {
  const item = objectAt2(value, `record.approvals[${index}]`, violations);
  rejectUnknown2(item, [
    "id",
    "kind",
    "authority_role",
    "task_revision",
    "intent_content_hash",
    "diff_hash",
    "actor_id",
    "summary",
    ...allowReviewRevision ? ["review_revision"] : []
  ], `record.approvals[${index}]`, violations);
  const intentContentHash = stringAt(item.intent_content_hash, `record.approvals[${index}].intent_content_hash`, violations);
  if (!SHA256_HEX.test(intentContentHash))
    violations.push(`record.approvals[${index}].intent_content_hash must be sha256:<64 hex>`);
  const diffHash = stringAt(item.diff_hash, `record.approvals[${index}].diff_hash`, violations);
  if (!SHA256_HEX.test(diffHash))
    violations.push(`record.approvals[${index}].diff_hash must be sha256:<64 hex>`);
  return {
    id: stringAt(item.id, `record.approvals[${index}].id`, violations),
    kind: enumAt(item.kind, APPROVAL_KINDS, `record.approvals[${index}].kind`, violations),
    authority_role: enumAt(item.authority_role, APPROVAL_AUTHORITY_ROLES, `record.approvals[${index}].authority_role`, violations),
    task_revision: positiveInteger2(item.task_revision, `record.approvals[${index}].task_revision`, violations),
    intent_content_hash: intentContentHash,
    diff_hash: diffHash,
    actor_id: stringAt(item.actor_id, `record.approvals[${index}].actor_id`, violations),
    summary: stringAt(item.summary, `record.approvals[${index}].summary`, violations),
    ...allowReviewRevision && item.review_revision !== undefined ? { review_revision: parseReviewRevisionIdentity(item.review_revision, `record.approvals[${index}].review_revision`, violations) } : {}
  };
}
function parseReviewRevisionIdentity(value, path, violations) {
  const item = objectAt2(value, path, violations);
  rejectUnknown2(item, ["contract", "base_head", "review_commit", "review_tree", "manifest_digest"], path, violations);
  if (item.contract !== REVIEW_REVISION_IDENTITY_CONTRACT)
    violations.push(`${path}.contract must equal ${REVIEW_REVISION_IDENTITY_CONTRACT}`);
  const identity = {
    contract: REVIEW_REVISION_IDENTITY_CONTRACT,
    base_head: stringAt(item.base_head, `${path}.base_head`, violations),
    review_commit: stringAt(item.review_commit, `${path}.review_commit`, violations),
    review_tree: stringAt(item.review_tree, `${path}.review_tree`, violations),
    manifest_digest: stringAt(item.manifest_digest, `${path}.manifest_digest`, violations)
  };
  for (const field of ["base_head", "review_commit", "review_tree"])
    if (!GIT_OBJECT_ID3.test(identity[field]))
      violations.push(`${path}.${field} must be a lowercase Git object id`);
  if (!SHA256_HEX.test(identity.manifest_digest))
    violations.push(`${path}.manifest_digest must be sha256:<64 hex>`);
  return identity;
}
function parseAttestationV3(value, index, acceptanceIds, violations, allowReviewRevision = false) {
  const path = `record.attestations[${index}]`;
  const item = objectAt2(value, path, violations);
  rejectUnknown2(item, [
    "id",
    "kind",
    "authority_role",
    "task_revision",
    "intent_content_hash",
    "diff_hash",
    "actor_id",
    "summary",
    "acceptance_results",
    ...allowReviewRevision ? ["review_revision"] : []
  ], path, violations);
  const kind = enumAt(item.kind, APPROVAL_KINDS, `${path}.kind`, violations);
  const intentContentHash = stringAt(item.intent_content_hash, `${path}.intent_content_hash`, violations);
  const diffHash = stringAt(item.diff_hash, `${path}.diff_hash`, violations);
  if (!SHA256_HEX.test(intentContentHash))
    violations.push(`${path}.intent_content_hash must be sha256:<64 hex>`);
  if (!SHA256_HEX.test(diffHash))
    violations.push(`${path}.diff_hash must be sha256:<64 hex>`);
  const acceptanceResults = arrayAt(item.acceptance_results, `${path}.acceptance_results`, violations).map((raw, resultIndex) => {
    const resultPath = `${path}.acceptance_results[${resultIndex}]`;
    const result = objectAt2(raw, resultPath, violations);
    rejectUnknown2(result, ["acceptance_id", "status", "summary"], resultPath, violations);
    const acceptanceId = stringAt(result.acceptance_id, `${resultPath}.acceptance_id`, violations);
    if (!acceptanceIds.has(acceptanceId))
      violations.push(`${resultPath}.acceptance_id is not in the current intent`);
    return {
      acceptance_id: acceptanceId,
      status: enumAt(result.status, EVIDENCE_STATUSES, `${resultPath}.status`, violations),
      summary: stringAt(result.summary, `${resultPath}.summary`, violations)
    };
  });
  if (kind !== "qa" && acceptanceResults.length > 0)
    violations.push(`${path}.acceptance_results is only valid for qa attestations`);
  if (kind === "qa") {
    const resultIds = acceptanceResults.map((result) => result.acceptance_id);
    if (resultIds.length !== acceptanceIds.size || new Set(resultIds).size !== acceptanceIds.size)
      violations.push(`${path}.acceptance_results must cover every acceptance exactly once`);
  }
  const reviewRevision = item.review_revision === undefined ? undefined : parseReviewRevisionIdentity(item.review_revision, `${path}.review_revision`, violations);
  if (reviewRevision && kind !== "review")
    violations.push(`${path}.review_revision is only valid on review attestations`);
  if (allowReviewRevision && kind === "review" && !reviewRevision)
    violations.push(`${path}.review_revision is required for v4 review attestations`);
  return {
    id: stringAt(item.id, `${path}.id`, violations),
    kind,
    authority_role: enumAt(item.authority_role, APPROVAL_AUTHORITY_ROLES, `${path}.authority_role`, violations),
    task_revision: positiveInteger2(item.task_revision, `${path}.task_revision`, violations),
    intent_content_hash: intentContentHash,
    diff_hash: diffHash,
    actor_id: stringAt(item.actor_id, `${path}.actor_id`, violations),
    summary: stringAt(item.summary, `${path}.summary`, violations),
    acceptance_results: acceptanceResults,
    ...reviewRevision ? { review_revision: reviewRevision } : {}
  };
}
function parseTaskRecordV2(raw) {
  const violations = [];
  const value = objectAt2(raw, "record", violations);
  rejectUnknown2(value, ["contract", "task_id", "intent_revision", "intent_snapshot", "intent_ref", "artifact_ref", "phase", "baseline", "evidence", "findings", "approvals", "history"], "record", violations);
  if (value.contract !== TASK_RECORD_CONTRACT_V2)
    violations.push(`contract must equal ${TASK_RECORD_CONTRACT_V2}`);
  let snapshot = null;
  try {
    snapshot = parseTaskIntentV1(value.intent_snapshot);
  } catch {
    violations.push("record.intent_snapshot must be a valid TaskIntent v1");
  }
  const taskId = stringAt(value.task_id, "record.task_id", violations);
  const intentRevision = positiveInteger2(value.intent_revision, "record.intent_revision", violations);
  const refRaw = objectAt2(value.intent_ref, "record.intent_ref", violations);
  rejectUnknown2(refRaw, ["path", "revision", "content_hash"], "record.intent_ref", violations);
  const refPath = stringAt(refRaw.path, "record.intent_ref.path", violations);
  const refRevision = positiveInteger2(refRaw.revision, "record.intent_ref.revision", violations);
  const refContentHash = stringAt(refRaw.content_hash, "record.intent_ref.content_hash", violations);
  if (!SHA256_HEX.test(refContentHash))
    violations.push("record.intent_ref.content_hash must be sha256:<64 hex>");
  let artifactRef;
  if (value.artifact_ref !== undefined) {
    const artifactRaw = objectAt2(value.artifact_ref, "record.artifact_ref", violations);
    rejectUnknown2(artifactRaw, ["state", "spec_path"], "record.artifact_ref", violations);
    const state = enumAt(artifactRaw.state, ["active", "frozen"], "record.artifact_ref.state", violations);
    const specPath = artifactRaw.spec_path === undefined ? undefined : stringAt(artifactRaw.spec_path, "record.artifact_ref.spec_path", violations);
    if (specPath !== undefined && (!/^docs\/specs\/(?!archive\/)[A-Za-z0-9._/-]+\.spec\.md$/.test(specPath) || specPath.includes("..")))
      violations.push("record.artifact_ref.spec_path must be one canonical active Spec path");
    artifactRef = { state, ...specPath === undefined ? {} : { spec_path: specPath } };
  }
  const activeIntentPath = `docs/plans/${taskId}.intent.json`;
  const frozenIntentPath = `docs/plans/archive/${taskId}.intent.json`;
  if (snapshot && (snapshot.task_id !== taskId || snapshot.revision !== intentRevision || snapshot.revision !== refRevision || refPath !== activeIntentPath && refPath !== frozenIntentPath))
    violations.push("intent_snapshot and intent_ref must match record identity");
  if (artifactRef?.state === "active" && refPath !== activeIntentPath)
    violations.push("active artifact_ref requires the active intent path");
  if (artifactRef?.state === "frozen" && refPath !== frozenIntentPath)
    violations.push("frozen artifact_ref requires the archived intent path");
  if (snapshot && refContentHash !== "" && canonicalIntentHash(snapshot) !== refContentHash)
    violations.push("intent_ref.content_hash must equal the snapshot canonical hash");
  const baseline = stringAt(value.baseline, "record.baseline", violations);
  if (!SHA256_HEX.test(baseline))
    violations.push("record.baseline must be sha256:<64 hex>");
  const acceptanceIds = new Set(snapshot ? snapshot.acceptance.map((item) => item.id) : []);
  const evidence = arrayAt(value.evidence, "record.evidence", violations).map((item, index) => parseEvidenceV2(item, index, acceptanceIds, violations));
  const findings = arrayAt(value.findings, "record.findings", violations).map((item, index) => parseFinding(item, index, violations));
  const approvals = arrayAt(value.approvals, "record.approvals", violations).map((item, index) => parseApprovalV2(item, index, violations));
  const history = arrayAt(value.history, "record.history", violations).map((item, index) => parseHistoryV2(item, index, violations));
  uniqueIds(evidence, "record.evidence", violations);
  uniqueIds(findings, "record.findings", violations);
  uniqueIds(approvals, "record.approvals", violations);
  uniqueIds(history, "record.history", violations);
  const phase = enumAt(value.phase, TASK_PHASES, "phase", violations);
  if (violations.length > 0)
    throw new KernelValidationError(violations);
  return {
    contract: TASK_RECORD_CONTRACT_V2,
    task_id: taskId,
    intent_revision: intentRevision,
    intent_snapshot: snapshot,
    intent_ref: {
      path: refPath,
      revision: refRevision,
      content_hash: refContentHash
    },
    ...artifactRef ? { artifact_ref: artifactRef } : {},
    phase,
    baseline,
    evidence,
    findings,
    approvals,
    history
  };
}
function parseTaskRecordAtVersion(raw, version) {
  const violations = [];
  const value = objectAt2(raw, "record", violations);
  rejectUnknown2(value, [
    "contract",
    "task_id",
    "intent_snapshot",
    "intent_ref",
    "lifecycle",
    "artifact_state",
    "baseline",
    "attestations",
    "findings",
    "history",
    ...version === 4 ? ["git_base_head"] : []
  ], "record", violations);
  const expectedContract = version === 4 ? TASK_RECORD_CONTRACT_V4 : TASK_RECORD_CONTRACT_V3;
  if (value.contract !== expectedContract)
    violations.push(`contract must equal ${expectedContract}`);
  let snapshot = null;
  try {
    snapshot = parseTaskIntentV1(value.intent_snapshot);
  } catch {
    violations.push("record.intent_snapshot must be a valid TaskIntent v1");
  }
  const taskId = stringAt(value.task_id, "record.task_id", violations);
  const refRaw = objectAt2(value.intent_ref, "record.intent_ref", violations);
  rejectUnknown2(refRaw, ["path", "content_hash"], "record.intent_ref", violations);
  const refPath = stringAt(refRaw.path, "record.intent_ref.path", violations);
  const refContentHash = stringAt(refRaw.content_hash, "record.intent_ref.content_hash", violations);
  if (!SHA256_HEX.test(refContentHash))
    violations.push("record.intent_ref.content_hash must be sha256:<64 hex>");
  const lifecycle = enumAt(value.lifecycle, TASK_LIFECYCLES, "record.lifecycle", violations);
  const artifactState = enumAt(value.artifact_state, TASK_ARTIFACT_STATES, "record.artifact_state", violations);
  const activeIntentPath = `docs/plans/${taskId}.intent.json`;
  const frozenIntentPath = `docs/plans/archive/${taskId}.intent.json`;
  if (snapshot && (snapshot.task_id !== taskId || refPath !== activeIntentPath && refPath !== frozenIntentPath))
    violations.push("intent_snapshot and intent_ref must match record identity");
  if (artifactState === "active" && refPath !== activeIntentPath)
    violations.push("active artifact_state requires the active intent path");
  if (artifactState === "frozen" && refPath !== frozenIntentPath)
    violations.push("frozen artifact_state requires the archived intent path");
  if (snapshot && refContentHash !== "" && canonicalIntentHash(snapshot) !== refContentHash)
    violations.push("intent_ref.content_hash must equal the snapshot canonical hash");
  if (lifecycle !== "active" && artifactState !== "frozen")
    violations.push("terminal lifecycle requires frozen artifacts");
  const baseline = stringAt(value.baseline, "record.baseline", violations);
  if (!SHA256_HEX.test(baseline))
    violations.push("record.baseline must be sha256:<64 hex>");
  let gitBaseHead = "";
  if (version === 4) {
    const rawGitBaseHead = stringAt(value.git_base_head, "record.git_base_head", violations);
    if (rawGitBaseHead !== rawGitBaseHead.toLowerCase())
      violations.push("record.git_base_head must be lowercase");
    gitBaseHead = rawGitBaseHead;
    if (!GIT_OBJECT_ID3.test(gitBaseHead))
      violations.push("record.git_base_head must be a lowercase Git commit id");
  }
  const acceptanceIds = new Set(snapshot ? snapshot.acceptance.map((item) => item.id) : []);
  const attestations = arrayAt(value.attestations, "record.attestations", violations).map((item, index) => parseAttestationV3(item, index, acceptanceIds, violations, version === 4));
  if (version === 4) {
    for (const [index, attestation] of attestations.entries()) {
      if (attestation.kind === "review" && attestation.review_revision && attestation.review_revision.base_head !== gitBaseHead)
        violations.push(`record.attestations[${index}].review_revision.base_head must equal record.git_base_head`);
    }
  }
  const findings = arrayAt(value.findings, "record.findings", violations).map((item, index) => parseFinding(item, index, violations));
  const history = arrayAt(value.history, "record.history", violations).map((item, index) => parseHistoryV3(item, index, violations));
  uniqueIds(attestations, "record.attestations", violations);
  uniqueIds(findings, "record.findings", violations);
  uniqueIds(history, "record.history", violations);
  if (violations.length > 0)
    throw new KernelValidationError(violations);
  const record = {
    contract: expectedContract,
    task_id: taskId,
    intent_snapshot: snapshot,
    intent_ref: { path: refPath, content_hash: refContentHash },
    lifecycle,
    artifact_state: artifactState,
    baseline,
    ...version === 4 ? { git_base_head: gitBaseHead } : {},
    attestations,
    findings,
    history
  };
  return record;
}
function parseTaskRecordV3(raw) {
  return parseTaskRecordAtVersion(raw, 3);
}
function parseTaskRecordV4(raw) {
  return parseTaskRecordAtVersion(raw, 4);
}
function parseTaskRecord(raw) {
  const contract = raw?.contract;
  if (contract === TASK_RECORD_CONTRACT_V4)
    return parseTaskRecordV4(raw);
  return parseTaskRecordV3(raw);
}
function assertKernelInvariantsV3(intentRaw, recordRaw) {
  const intent = parseTaskIntentV1(intentRaw);
  const record = parseTaskRecord(recordRaw);
  const violations = [];
  if (intent.task_id !== record.task_id)
    violations.push("intent and record task_id must match");
  if (intent.revision !== record.intent_snapshot.revision)
    violations.push("intent revision must match record snapshot");
  if (canonicalIntentHash(record.intent_snapshot) !== record.intent_ref.content_hash)
    violations.push("record intent_ref.content_hash must match its snapshot");
  const requiredRole = { review: "reviewer", qa: "qa", user: "user" };
  for (const approval of record.attestations) {
    if (approval.authority_role !== requiredRole[approval.kind])
      violations.push(`approval ${approval.id} kind ${approval.kind} requires authority_role ${requiredRole[approval.kind]}`);
  }
  if (violations.length > 0)
    throw new KernelInvariantError(violations);
}
var ACTION_V2_TYPES = [
  "record_finding",
  "resolve_finding",
  "record_approval",
  "revise_intent",
  "approve_breaking_intent_revision",
  "request_rework",
  "complete",
  "stop",
  "resolve_user_decision"
];
var ACTION_BASE_FIELDS = [
  "type",
  "event_id",
  "at",
  "actor_id",
  "expected_record_hash",
  "expected_workspace_hash",
  "diff_hash"
];
function parseActionBase(value, path, violations) {
  const type = enumAt(value.type, ACTION_V2_TYPES, `${path}.type`, violations);
  for (const field of ACTION_BASE_FIELDS) {
    if (field !== "type" && !(field in value))
      violations.push(`${path}.${field} is required`);
  }
  return {
    type,
    event_id: stringAt(value.event_id, `${path}.event_id`, violations),
    at: stringAt(value.at, `${path}.at`, violations),
    actor_id: stringAt(value.actor_id, `${path}.actor_id`, violations),
    expected_record_hash: stringAt(value.expected_record_hash, `${path}.expected_record_hash`, violations),
    expected_workspace_hash: stringAt(value.expected_workspace_hash, `${path}.expected_workspace_hash`, violations),
    diff_hash: stringAt(value.diff_hash, `${path}.diff_hash`, violations)
  };
}
function parseTaskAction(raw) {
  const violations = [];
  const value = objectAt2(raw, "action", violations);
  const base = parseActionBase(value, "action", violations);
  if (!SHA256_HEX.test(base.expected_record_hash))
    violations.push("action.expected_record_hash must be sha256:<64 hex>");
  if (!SHA256_HEX.test(base.expected_workspace_hash))
    violations.push("action.expected_workspace_hash must be sha256:<64 hex>");
  if (!SHA256_HEX.test(base.diff_hash))
    violations.push("action.diff_hash must be sha256:<64 hex>");
  let action = null;
  switch (base.type) {
    case "record_finding": {
      rejectUnknown2(value, [...ACTION_BASE_FIELDS, "finding"], "action", violations);
      action = {
        ...base,
        type: "record_finding",
        finding: parseFinding(value.finding, 0, violations)
      };
      break;
    }
    case "resolve_finding": {
      rejectUnknown2(value, [...ACTION_BASE_FIELDS, "finding_id"], "action", violations);
      action = {
        ...base,
        type: "resolve_finding",
        finding_id: stringAt(value.finding_id, "action.finding_id", violations)
      };
      break;
    }
    case "record_approval": {
      rejectUnknown2(value, [...ACTION_BASE_FIELDS, "approval"], "action", violations);
      const approval = parseApprovalV2(value.approval, 0, violations, true);
      if (approval.review_revision && approval.kind !== "review")
        violations.push("action.approval.review_revision is only valid on review approvals");
      action = {
        ...base,
        type: base.type,
        approval
      };
      break;
    }
    case "revise_intent":
    case "approve_breaking_intent_revision": {
      rejectUnknown2(value, [...ACTION_BASE_FIELDS, "next_intent", "next_intent_ref"], "action", violations);
      let nextIntent = null;
      try {
        nextIntent = parseTaskIntentV1(value.next_intent);
      } catch {
        violations.push("action.next_intent must be a valid TaskIntent v1");
      }
      const refRaw = objectAt2(value.next_intent_ref, "action.next_intent_ref", violations);
      rejectUnknown2(refRaw, ["path", "content_hash"], "action.next_intent_ref", violations);
      const refPath = stringAt(refRaw.path, "action.next_intent_ref.path", violations);
      const refContentHash = stringAt(refRaw.content_hash, "action.next_intent_ref.content_hash", violations);
      if (!SHA256_HEX.test(refContentHash))
        violations.push("action.next_intent_ref.content_hash must be sha256:<64 hex>");
      action = {
        ...base,
        type: base.type,
        next_intent: nextIntent,
        next_intent_ref: {
          path: refPath,
          content_hash: refContentHash
        }
      };
      break;
    }
    case "complete": {
      rejectUnknown2(value, [...ACTION_BASE_FIELDS], "action", violations);
      action = { ...base, type: base.type };
      break;
    }
    case "request_rework": {
      rejectUnknown2(value, [...ACTION_BASE_FIELDS, "findings"], "action", violations);
      const findings = arrayAt(value.findings, "action.findings", violations).map((item, index) => parseFinding(item, index, violations));
      if (findings.length === 0)
        violations.push("action.findings must contain at least one finding");
      action = { ...base, type: "request_rework", findings };
      break;
    }
    case "stop": {
      rejectUnknown2(value, [...ACTION_BASE_FIELDS, "reason"], "action", violations);
      action = {
        ...base,
        type: "stop",
        reason: stringAt(value.reason, "action.reason", violations)
      };
      break;
    }
    case "resolve_user_decision": {
      rejectUnknown2(value, [...ACTION_BASE_FIELDS, "finding_id", "resolution"], "action", violations);
      action = {
        ...base,
        type: "resolve_user_decision",
        finding_id: stringAt(value.finding_id, "action.finding_id", violations),
        resolution: stringAt(value.resolution, "action.resolution", violations)
      };
      break;
    }
  }
  if (violations.length > 0)
    throw new KernelValidationError(violations);
  return action;
}
function assertTaskRecordUpdateV3(previousRaw, nextRaw, action) {
  const previous = parseTaskRecord(previousRaw);
  const next = parseTaskRecord(nextRaw);
  const violations = [];
  if (next.contract !== previous.contract)
    violations.push("record contract must remain immutable");
  if (next.task_id !== previous.task_id)
    violations.push("record task_id must remain immutable");
  if (next.baseline !== previous.baseline)
    violations.push("record baseline must remain immutable");
  if (previous.contract === TASK_RECORD_CONTRACT_V4 && next.contract === TASK_RECORD_CONTRACT_V4 && next.git_base_head !== previous.git_base_head)
    violations.push("record git_base_head must remain immutable");
  const isIntentAction = action.type === "revise_intent" || action.type === "approve_breaking_intent_revision";
  if (isIntentAction) {
    if (next.intent_snapshot.task_id !== previous.intent_snapshot.task_id || next.intent_snapshot.goal !== previous.intent_snapshot.goal || next.intent_snapshot.owner !== previous.intent_snapshot.owner)
      violations.push("intent revision cannot change task identity, goal, or owner");
  } else {
    if (next.intent_snapshot.task_id !== previous.intent_snapshot.task_id || next.intent_snapshot.goal !== previous.intent_snapshot.goal || next.intent_snapshot.risk !== previous.intent_snapshot.risk || next.intent_snapshot.revision !== previous.intent_snapshot.revision || next.intent_snapshot.owner !== previous.intent_snapshot.owner || canonicalIntentHash(next.intent_snapshot) !== canonicalIntentHash(previous.intent_snapshot))
      violations.push("non-intent action cannot change the intent snapshot");
    if (next.intent_ref.content_hash !== previous.intent_ref.content_hash)
      violations.push("non-intent action cannot change intent_ref content hash");
    if (next.intent_ref.path !== previous.intent_ref.path && action.type !== "request_rework" && action.type !== "stop")
      violations.push("only artifact transitions may change intent_ref path");
  }
  if (next.attestations.length < previous.attestations.length)
    violations.push("attestations are append-only");
  if (next.history.length !== previous.history.length + 1)
    violations.push("exactly one history entry must be appended");
  for (const prior of previous.attestations) {
    const current = next.attestations.find((item) => item.id === prior.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(prior))
      violations.push(`attestation ${prior.id} was rewritten`);
  }
  const resolvingFindingIds = action.type === "resolve_finding" ? [action.finding_id] : action.type === "resolve_user_decision" ? [action.finding_id] : action.type === "approve_breaking_intent_revision" ? previous.findings.filter((item) => item.kind === "replan_required" && item.status === "open").map((item) => item.id) : [];
  const reworkFindingIds = action.type === "request_rework" ? new Set(action.findings.map((item) => item.id)) : new Set;
  for (const prior of previous.findings) {
    const current = next.findings.find((item) => item.id === prior.id);
    if (!current)
      violations.push(`finding item ${prior.id} was removed`);
    else if (JSON.stringify(current) !== JSON.stringify(prior) && !(resolvingFindingIds.includes(prior.id) && prior.status === "open" && current.status === "resolved") && !(reworkFindingIds.has(prior.id) && current.review_round !== null))
      violations.push(`finding item ${prior.id} was rewritten`);
  }
  if (violations.length > 0)
    throw new KernelInvariantError(violations);
}

// plugins/immune-brain/runtime/kernel/storage.ts
var MISSING_REVISION = "missing";

class KernelStoreConflictError extends Error {
  code = "kernel_store_conflict";
  constructor(message) {
    super(message);
    this.name = "KernelStoreConflictError";
  }
}

class KernelStoreSecurityError extends Error {
  code = "kernel_store_security_error";
  constructor(message) {
    super(message);
    this.name = "KernelStoreSecurityError";
  }
}
function revisionFor(content) {
  return `sha256:${createHash9("sha256").update(content).digest("hex")}`;
}
function canonicalRoot(root) {
  try {
    return realpathSync5(root);
  } catch {
    throw new KernelStoreSecurityError("project root is unavailable");
  }
}
function withinRoot(root, candidate) {
  const rel = relative2(root, candidate);
  return rel === "" || !isAbsolute3(rel) && rel !== ".." && !rel.startsWith(`..${sep4}`);
}
function safeCandidate(root, relativePath) {
  if (!relativePath || relativePath.includes("\x00") || isAbsolute3(relativePath) || relativePath.includes("\\"))
    throw new KernelStoreSecurityError("project-relative path is invalid");
  const canonical = canonicalRoot(root);
  const candidate = resolve5(canonical, relativePath);
  if (!withinRoot(canonical, candidate))
    throw new KernelStoreSecurityError("path escapes the project root");
  return { root: canonical, path: candidate };
}
function pathStatOrNull(path) {
  try {
    return lstatSync5(path);
  } catch (error) {
    const code = error.code;
    if (code === "ENOENT" || code === "ENOTDIR")
      return null;
    throw error;
  }
}
function assertNoSymlinkSegments(root, candidate) {
  const rel = relative2(root, candidate);
  let current = root;
  for (const segment of rel.split(sep4).filter(Boolean)) {
    current = resolve5(current, segment);
    const stat = pathStatOrNull(current);
    if (!stat)
      continue;
    if (stat.isSymbolicLink())
      throw new KernelStoreSecurityError(`symlink storage segment is forbidden: ${relative2(root, current)}`);
  }
}
function capturePathIdentities(root, candidate) {
  const paths = [root];
  let current = root;
  for (const segment of relative2(root, candidate).split(sep4).filter(Boolean)) {
    current = resolve5(current, segment);
    paths.push(current);
  }
  return paths.map((path) => {
    const stat = lstatSync5(path);
    if (stat.isSymbolicLink())
      throw new KernelStoreSecurityError(`symlink storage segment is forbidden: ${relative2(root, path)}`);
    return { path, dev: stat.dev, ino: stat.ino };
  });
}
function assertPathIdentitiesUnchanged(before) {
  for (const identity of before) {
    const after = lstatSync5(identity.path);
    if (after.isSymbolicLink() || after.dev !== identity.dev || after.ino !== identity.ino)
      throw new KernelStoreSecurityError(`path identity changed during access: ${identity.path}`);
  }
}
function ensureSecureDirectory(root, relativePath) {
  const target = safeCandidate(root, relativePath);
  const rel = relative2(target.root, target.path);
  let current = target.root;
  for (const segment of rel.split(sep4).filter(Boolean)) {
    current = resolve5(current, segment);
    const stat = pathStatOrNull(current);
    if (stat) {
      if (stat.isSymbolicLink())
        throw new KernelStoreSecurityError(`symlink storage segment is forbidden: ${relative2(target.root, current)}`);
      if (!stat.isDirectory())
        throw new KernelStoreSecurityError(`storage segment is not a directory: ${relative2(target.root, current)}`);
      continue;
    }
    mkdirSync2(current);
  }
  return target.path;
}
function readSecureProjectFile(root, relativePath) {
  const candidate = safeCandidate(root, relativePath);
  assertNoSymlinkSegments(candidate.root, candidate.path);
  const before = pathStatOrNull(candidate.path);
  if (!before)
    throw new Error(`source_missing: ${relativePath}`);
  const identities = capturePathIdentities(candidate.root, candidate.path);
  if (!before.isFile())
    throw new KernelStoreSecurityError(`source is not a regular file: ${relativePath}`);
  const noFollow = constants2.O_NOFOLLOW ?? 0;
  let fd = null;
  try {
    fd = openSync3(candidate.path, constants2.O_RDONLY | noFollow);
    const opened = fstatSync3(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino)
      throw new KernelStoreSecurityError(`source identity changed: ${relativePath}`);
    const content = readFileSync6(fd, "utf8");
    const after = lstatSync5(candidate.path);
    if (after.dev !== opened.dev || after.ino !== opened.ino)
      throw new KernelStoreSecurityError(`source identity changed: ${relativePath}`);
    assertPathIdentitiesUnchanged(identities);
    return content;
  } finally {
    if (fd !== null)
      closeSync3(fd);
  }
}
function currentRevision(root, relativePath) {
  const candidate = safeCandidate(root, relativePath);
  const stat = pathStatOrNull(candidate.path);
  if (!stat)
    return MISSING_REVISION;
  if (stat.isSymbolicLink())
    throw new KernelStoreSecurityError(`symlink storage target is forbidden: ${relativePath}`);
  return revisionFor(readSecureProjectFile(root, relativePath));
}
function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}
function clearStaleLock(lockPath) {
  const before = pathStatOrNull(lockPath);
  if (!before)
    return true;
  if (before.isSymbolicLink() || !before.isFile())
    throw new KernelStoreSecurityError("kernel store lock is not a regular file");
  let stale = false;
  let fd = null;
  try {
    fd = openSync3(lockPath, constants2.O_RDONLY | (constants2.O_NOFOLLOW ?? 0));
    const raw = JSON.parse(readFileSync6(fd, "utf8"));
    stale = Number.isInteger(raw.pid) && Number(raw.pid) > 0 && !processIsAlive(Number(raw.pid));
  } catch {
    stale = Date.now() - Number(before.mtimeMs) > 30000;
  } finally {
    if (fd !== null)
      closeSync3(fd);
  }
  if (!stale)
    return false;
  const after = lstatSync5(lockPath);
  if (after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino)
    throw new KernelStoreSecurityError("kernel store lock identity changed during recovery");
  rmSync3(lockPath);
  return true;
}
function withExclusiveLock(lockPath, operation) {
  const noFollow = constants2.O_NOFOLLOW ?? 0;
  let fd = null;
  for (let attempt = 0;attempt < 2; attempt += 1) {
    try {
      fd = openSync3(lockPath, constants2.O_WRONLY | constants2.O_CREAT | constants2.O_EXCL | noFollow, 384);
      break;
    } catch (error) {
      if (attempt === 0 && error.code === "EEXIST" && clearStaleLock(lockPath))
        continue;
      throw new KernelStoreConflictError(`kernel store lock is busy: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (fd === null)
    throw new KernelStoreConflictError("kernel store lock could not be acquired");
  const identity = fstatSync3(fd);
  try {
    writeFileSync2(fd, `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}
`, "utf8");
    fsyncSync(fd);
    return operation();
  } finally {
    closeSync3(fd);
    const current = pathStatOrNull(lockPath);
    if (current && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino)
      rmSync3(lockPath);
  }
}
function fsyncDirectory(path) {
  const fd = openSync3(path, constants2.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync3(fd);
  }
}
function atomicCasWrite(root, relativePath, content, expectedRevision) {
  const candidate = safeCandidate(root, relativePath);
  const parentRelative = relative2(candidate.root, dirname3(candidate.path));
  ensureSecureDirectory(root, parentRelative);
  assertNoSymlinkSegments(candidate.root, candidate.path);
  return withExclusiveLock(`${candidate.path}.lock`, () => {
    const actualRevision = currentRevision(root, relativePath);
    if (actualRevision !== expectedRevision)
      throw new KernelStoreConflictError(`CAS mismatch for ${relativePath}: expected ${expectedRevision}, got ${actualRevision}`);
    const tempPath = `${candidate.path}.${randomUUID3()}.tmp`;
    let fd = null;
    try {
      fd = openSync3(tempPath, constants2.O_WRONLY | constants2.O_CREAT | constants2.O_EXCL, 384);
      writeFileSync2(fd, content, "utf8");
      fsyncSync(fd);
      closeSync3(fd);
      fd = null;
      assertNoSymlinkSegments(candidate.root, candidate.path);
      renameSync(tempPath, candidate.path);
      fsyncDirectory(dirname3(candidate.path));
    } finally {
      if (fd !== null)
        closeSync3(fd);
      rmSync3(tempPath, { force: true });
    }
    return revisionFor(content);
  });
}
function validateTaskId4(taskId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId))
    throw new KernelStoreSecurityError("task_id is not a safe file identity");
}
var JOURNAL_READ_LIMIT = 64 * 1024 * 1024;
var TRANSACTION_PATH = ".imm/tasks/.workspace-transaction.json";
var V1_TRANSACTION_RETIRED = "workspace_transaction/v1 is retired after v4 storage retirement; use TaskRecord v3 + workspace_transaction/v2";
var afterTaskTransactionWriteForTest = null;
function runAfterTaskTransactionWriteHook() {
  const hook = afterTaskTransactionWriteForTest;
  afterTaskTransactionWriteForTest = null;
  hook?.();
}
var terminalSettlementStepHookForTest = null;
function runTerminalSettlementStepHook(stepIndex) {
  const hook = terminalSettlementStepHookForTest;
  if (!hook)
    return;
  hook(stepIndex);
}
function parseWorkspaceContent(content) {
  const raw = JSON.parse(content);
  const unknown = Object.keys(raw).filter((key) => !["contract", "current_working"].includes(key));
  if (unknown.length > 0)
    throw new KernelStoreSecurityError(`workspace has unknown field: ${unknown[0]}`);
  if (raw.contract !== "assurance_kernel/workspace/v1")
    throw new KernelStoreSecurityError("workspace contract is invalid");
  if (raw.current_working !== null && (typeof raw.current_working !== "string" || !raw.current_working.trim()))
    throw new KernelStoreSecurityError("workspace current_working is invalid");
  if (typeof raw.current_working === "string")
    validateTaskId4(raw.current_working);
  return raw;
}
function serializeWorkspace(state) {
  return `${JSON.stringify(state, null, 2)}
`;
}
function readWorkspaceStateRaw(root) {
  const relativePath = stateWorkspacePath();
  if (currentRevision(root, relativePath) === MISSING_REVISION)
    return {
      revision: MISSING_REVISION,
      state: {
        contract: "assurance_kernel/workspace/v1",
        current_working: null
      }
    };
  const content = readSecureProjectFile(root, relativePath);
  return { revision: revisionFor(content), state: parseWorkspaceContent(content) };
}
function convergeFile(root, relativePath, expectedRevision, nextContent) {
  const nextRevision = revisionFor(nextContent);
  const actualRevision = currentRevision(root, relativePath);
  if (actualRevision === nextRevision)
    return nextRevision;
  if (actualRevision !== expectedRevision)
    throw new KernelStoreConflictError(`transaction conflict for ${relativePath}: expected ${expectedRevision} or ${nextRevision}, got ${actualRevision}`);
  return atomicCasWrite(root, relativePath, nextContent, expectedRevision);
}
var TRANSACTION_PATH_V2 = stateTransactionPath("workspace-transaction-v2.json");
var ENROLLMENT_MARKER_PATH = stateTransactionPath("enrollment-marker.json");
var DRAIN_MARKER_PATH = stateTransactionPath("drain-transaction.json");
var TERMINAL_MARKER_PATH = stateTransactionPath("terminal-transaction.json");
var AUTHORITY_REPAIR_MARKER_PATH = stateTransactionPath("authority-repair-transaction.json");
function revisionForContent(content) {
  return revisionFor(content);
}
function parseWorkspaceTransactionV2(raw) {
  const allowed = [
    "contract",
    "task_id",
    "expected_record_hash",
    "next_record_content",
    "expected_workspace_hash",
    "next_workspace_content",
    "artifact_relocations"
  ];
  const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    throw new KernelStoreSecurityError(`workspace transaction v2 has unknown field: ${unknown[0]}`);
  if (raw.contract !== "assurance_kernel/workspace_transaction/v2")
    throw new KernelStoreSecurityError("workspace transaction v2 contract is invalid");
  for (const field of allowed.slice(1, 6)) {
    if (typeof raw[field] !== "string" || !String(raw[field]).trim())
      throw new KernelStoreSecurityError(`workspace transaction v2 ${field} is invalid`);
  }
  const relocationRaw = raw.artifact_relocations;
  if (relocationRaw !== undefined && !Array.isArray(relocationRaw))
    throw new KernelStoreSecurityError("workspace transaction v2 artifact_relocations is invalid");
  const artifactRelocations = (relocationRaw ?? []).map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new KernelStoreSecurityError(`artifact relocation ${index} is invalid`);
    const value = item;
    const unknownFields = Object.keys(value).filter((key) => !["from_path", "to_path", "content_hash"].includes(key));
    if (unknownFields.length > 0)
      throw new KernelStoreSecurityError(`artifact relocation has unknown field: ${unknownFields[0]}`);
    for (const field of ["from_path", "to_path", "content_hash"])
      if (typeof value[field] !== "string" || !String(value[field]).trim())
        throw new KernelStoreSecurityError(`artifact relocation ${field} is invalid`);
    const relocation = value;
    assertArtifactRelocation(relocation);
    return relocation;
  });
  const transaction = {
    ...raw,
    ...artifactRelocations.length > 0 ? { artifact_relocations: artifactRelocations } : {}
  };
  validateTaskId4(transaction.task_id);
  const record = parseTaskRecord(JSON.parse(transaction.next_record_content));
  if (record.task_id !== transaction.task_id)
    throw new KernelStoreSecurityError("workspace transaction v2 task identity is inconsistent");
  parseWorkspaceContent(transaction.next_workspace_content);
  return transaction;
}
function readPendingTransactionV2(root) {
  if (currentRevision(root, TRANSACTION_PATH_V2) === MISSING_REVISION)
    return null;
  const raw = JSON.parse(readSecureProjectFile(root, TRANSACTION_PATH_V2));
  return parseWorkspaceTransactionV2(raw);
}
function removeTransactionMarkerV2(root) {
  const candidate = safeCandidate(root, TRANSACTION_PATH_V2);
  assertNoSymlinkSegments(candidate.root, candidate.path);
  const stat = pathStatOrNull(candidate.path);
  if (!stat)
    return;
  if (!stat.isFile())
    throw new KernelStoreSecurityError("workspace transaction v2 marker is not a regular file");
  rmSync3(candidate.path);
  fsyncDirectory(dirname3(candidate.path));
}
function archiveArtifactPath(path) {
  const matched = path.match(/^docs\/(plans|specs)\/([^/]+)$/);
  return matched ? `docs/${matched[1]}/archive/${matched[2]}` : null;
}
function assertArtifactRelocation(relocation) {
  if (!/^sha256:[a-f0-9]{64}$/.test(relocation.content_hash))
    throw new KernelStoreSecurityError("artifact relocation content_hash is invalid");
  if (archiveArtifactPath(relocation.from_path) !== relocation.to_path && archiveArtifactPath(relocation.to_path) !== relocation.from_path)
    throw new KernelStoreSecurityError("artifact relocation paths must be one active/archive pair");
}
function convergeArtifactRelocation(root, relocation) {
  assertArtifactRelocation(relocation);
  const fromRevision = currentRevision(root, relocation.from_path);
  const toRevision = currentRevision(root, relocation.to_path);
  if (fromRevision === MISSING_REVISION && toRevision === relocation.content_hash)
    return;
  if (fromRevision !== relocation.content_hash || toRevision !== MISSING_REVISION)
    throw new KernelStoreConflictError(`artifact relocation conflict for ${relocation.from_path} -> ${relocation.to_path}`);
  const from = safeCandidate(root, relocation.from_path);
  const to = safeCandidate(root, relocation.to_path);
  ensureSecureDirectory(root, relative2(to.root, dirname3(to.path)));
  assertNoSymlinkSegments(from.root, from.path);
  assertNoSymlinkSegments(to.root, to.path);
  renameSync(from.path, to.path);
  fsyncDirectory(dirname3(from.path));
  if (dirname3(from.path) !== dirname3(to.path))
    fsyncDirectory(dirname3(to.path));
}
function completeTransactionV2Locked(root, transaction, invokeTestHook) {
  for (const relocation of transaction.artifact_relocations ?? [])
    convergeArtifactRelocation(root, relocation);
  const taskPath = stateTaskRecordPath(transaction.task_id);
  const taskRevision = convergeFile(root, taskPath, transaction.expected_record_hash, transaction.next_record_content);
  if (invokeTestHook)
    runAfterTaskTransactionWriteHook();
  const workspaceRevision = convergeFile(root, stateWorkspacePath(), transaction.expected_workspace_hash, transaction.next_workspace_content);
  const record = parseTaskRecord(JSON.parse(transaction.next_record_content));
  const workspace = parseWorkspaceContent(transaction.next_workspace_content);
  removeTransactionMarkerV2(root);
  return {
    revision: taskRevision,
    record,
    workspace: { revision: workspaceRevision, state: workspace }
  };
}
function recoverPendingTransactionV2Locked(root) {
  const transaction = readPendingTransactionV2(root);
  if (transaction)
    completeTransactionV2Locked(root, transaction, false);
}
function assertNoRetiredV1Marker(root) {
  if (currentRevision(root, TRANSACTION_PATH) !== MISSING_REVISION)
    throw new KernelStoreSecurityError(V1_TRANSACTION_RETIRED);
}
function recoverAnyPendingTransactionLocked(root) {
  const hasV1 = currentRevision(root, TRANSACTION_PATH) !== MISSING_REVISION;
  const hasV2 = currentRevision(root, TRANSACTION_PATH_V2) !== MISSING_REVISION;
  const hasEnrollment = currentRevision(root, ENROLLMENT_MARKER_PATH) !== MISSING_REVISION;
  const hasDrain = currentRevision(root, DRAIN_MARKER_PATH) !== MISSING_REVISION;
  const hasTerminal = currentRevision(root, TERMINAL_MARKER_PATH) !== MISSING_REVISION;
  const hasAuthorityRepair = currentRevision(root, AUTHORITY_REPAIR_MARKER_PATH) !== MISSING_REVISION;
  if (hasV1)
    throw new KernelStoreSecurityError(V1_TRANSACTION_RETIRED);
  const markers = [hasV2, hasEnrollment, hasDrain, hasTerminal, hasAuthorityRepair].filter(Boolean).length;
  if (markers > 1)
    throw new KernelStoreSecurityError("simultaneous workspace transaction markers are forbidden");
  if (hasV2)
    recoverPendingTransactionV2Locked(root);
  if (hasEnrollment)
    recoverPendingEnrollmentLocked(root);
  if (hasDrain)
    recoverPendingDrainLocked(root);
  if (hasTerminal)
    recoverPendingTerminalLocked(root, false);
  if (hasAuthorityRepair)
    recoverPendingAuthorityRepairLocked(root);
}
function readTaskRecordRaw(root, taskId) {
  validateTaskId4(taskId);
  const relativePath = stateTaskRecordPath(taskId);
  if (currentRevision(root, relativePath) === MISSING_REVISION)
    return { revision: MISSING_REVISION, record: null };
  const content = readSecureProjectFile(root, relativePath);
  const raw = JSON.parse(content);
  if (raw.contract === "assurance_kernel/task_record/v2")
    throw new KernelStoreSecurityError("TaskRecord v2 is not supported in the state layout; v2 records belong to the historical audit layout");
  const record = parseTaskRecord(raw);
  if (record.task_id !== taskId)
    throw new KernelStoreSecurityError("task record v3 identity is inconsistent");
  return { revision: revisionFor(content), record };
}
function readAuditTaskPair(root, taskId) {
  validateTaskId4(taskId);
  const recordPath = auditTaskRecordPath(taskId);
  const proofPath = auditTerminalProofPath(taskId);
  const recordRevision = currentRevision(root, recordPath);
  const proofRevision = currentRevision(root, proofPath);
  if (recordRevision === MISSING_REVISION && proofRevision === MISSING_REVISION)
    return null;
  if (recordRevision === MISSING_REVISION || proofRevision === MISSING_REVISION)
    throw new KernelStoreSecurityError("terminal audit pair is incomplete");
  const recordContent = readSecureProjectFile(root, recordPath);
  const proof = parseTaskTombstone(JSON.parse(readSecureProjectFile(root, proofPath)));
  if (proof.task_id !== taskId)
    throw new KernelStoreSecurityError("terminal audit proof identity is inconsistent");
  if (proof.final_record_hash !== recordRevision)
    throw new KernelStoreSecurityError("terminal audit proof does not match its task record");
  const raw = JSON.parse(recordContent);
  let record;
  if (raw.contract === "assurance_kernel/task_record/v2") {
    const legacy = parseTaskRecordV2(raw);
    if (legacy.task_id !== taskId || legacy.phase !== "done" && legacy.phase !== "stopped")
      throw new KernelStoreSecurityError("historical audit TaskRecord v2 must be terminal and identity-consistent");
    record = legacy;
  } else {
    const current = parseTaskRecord(raw);
    if (current.task_id !== taskId || current.lifecycle !== "done" && current.lifecycle !== "stopped")
      throw new KernelStoreSecurityError("audit TaskRecord v3 must be terminal and identity-consistent");
    record = current;
  }
  return { recordRevision, record, proof };
}
function readTaskRecord(root, taskId) {
  return withKernelStoreLock(root, () => readTaskRecordRaw(root, taskId));
}
function commitTaskRecordLocked(root, taskId, expectedRecordHash, nextRecord, expectedWorkspaceHash, nextWorkspace, artifactRelocations = []) {
  const transaction = {
    contract: "assurance_kernel/workspace_transaction/v2",
    task_id: taskId,
    expected_record_hash: expectedRecordHash,
    next_record_content: `${JSON.stringify(nextRecord, null, 2)}
`,
    expected_workspace_hash: expectedWorkspaceHash,
    next_workspace_content: serializeWorkspace(nextWorkspace),
    ...artifactRelocations.length > 0 ? { artifact_relocations: artifactRelocations } : {}
  };
  atomicCasWrite(root, TRANSACTION_PATH_V2, `${JSON.stringify(transaction, null, 2)}
`, MISSING_REVISION);
  try {
    return completeTransactionV2Locked(root, transaction, true);
  } catch (error) {
    try {
      return completeTransactionV2Locked(root, transaction, false);
    } catch (recoveryError) {
      throw new KernelStoreConflictError(`kernel v2 transaction failed and remains recoverable: ${error instanceof Error ? error.message : error}; recovery: ${recoveryError instanceof Error ? recoveryError.message : recoveryError}`);
    }
  }
}
function withKernelStoreLock(root, operation) {
  const locksDirectory = ensureSecureDirectory(root, dirname3(stateStoreLockPath()));
  return withExclusiveLock(resolve5(locksDirectory, basename(stateStoreLockPath())), () => {
    assertNoRetiredV1Marker(root);
    recoverAnyPendingTransactionLocked(root);
    return operation();
  });
}
function projectKernelAuthorityLocked(root, taskId) {
  try {
    const claim = readBackendClaim(root);
    const ownerTaskId = claim?.task_id ?? null;
    const inspectedTaskId = ownerTaskId ?? taskId;
    const stateRecord = readTaskRecordRaw(root, inspectedTaskId);
    const auditPair = readAuditTaskPair(root, inspectedTaskId);
    const workspace = readWorkspaceStateRaw(root).state;
    const record = stateRecord.record;
    const auditRecord = auditPair?.record;
    const authorityRecord = record ? {
      task_id: record.task_id,
      lifecycle: record.lifecycle,
      intent_revision: record.intent_snapshot.revision,
      intent_content_hash: record.intent_ref.content_hash
    } : auditRecord ? "phase" in auditRecord ? {
      task_id: auditRecord.task_id,
      lifecycle: auditRecord.phase,
      intent_revision: auditRecord.intent_revision,
      intent_content_hash: auditRecord.intent_ref.content_hash
    } : {
      task_id: auditRecord.task_id,
      lifecycle: auditRecord.lifecycle,
      intent_revision: auditRecord.intent_snapshot.revision,
      intent_content_hash: auditRecord.intent_ref.content_hash
    } : null;
    const terminal = auditPair !== null;
    const duplicateStateAndAudit = Boolean(stateRecord.record && auditPair);
    const matchingTerminalProof = Boolean(auditPair && workspace.current_working === null);
    const matchingClaimIdentity = Boolean(claim && authorityRecord && claim.task_id === authorityRecord.task_id && claim.intent_revision === authorityRecord.intent_revision && claim.intent_content_hash === authorityRecord.intent_content_hash);
    const sameOwner = claim ? workspace.current_working === claim.task_id : workspace.current_working === null;
    const revision = revisionForContent(JSON.stringify({ claim, stateRecord, auditPair, workspace }));
    if (duplicateStateAndAudit)
      return {
        contract: "assurance_kernel/authority_projection/v1",
        requested_task_id: taskId,
        state: "authority_conflict",
        owner_task_id: claim?.task_id ?? null,
        owner_lifecycle: authorityRecord?.lifecycle ?? null,
        claim_lifecycle_status: claim?.lifecycle_status ?? null,
        diagnostic: `simultaneous state record and terminal audit pair for ${inspectedTaskId}; resolve or recover before authority interpretation`,
        revision
      };
    if (claim && !sameOwner && !matchingTerminalProof)
      return {
        contract: "assurance_kernel/authority_projection/v1",
        requested_task_id: taskId,
        state: "authority_conflict",
        owner_task_id: claim.task_id,
        owner_lifecycle: authorityRecord?.lifecycle ?? null,
        claim_lifecycle_status: claim.lifecycle_status,
        diagnostic: `workspace owner ${workspace.current_working ?? "null"} contradicts claim ${claim.task_id}`,
        revision
      };
    if (claim && !authorityRecord)
      return {
        contract: "assurance_kernel/authority_projection/v1",
        requested_task_id: taskId,
        state: "authority_conflict",
        owner_task_id: claim.task_id,
        owner_lifecycle: null,
        claim_lifecycle_status: claim.lifecycle_status,
        diagnostic: `claim ${claim.task_id} has no TaskRecord`,
        revision
      };
    if (claim && matchingTerminalProof && matchingClaimIdentity)
      return {
        contract: "assurance_kernel/authority_projection/v1",
        requested_task_id: taskId,
        state: "repairable_stale_claim",
        owner_task_id: claim.task_id,
        owner_lifecycle: authorityRecord?.lifecycle ?? null,
        claim_lifecycle_status: claim.lifecycle_status,
        diagnostic: null,
        revision
      };
    if (claim && terminal)
      return {
        contract: "assurance_kernel/authority_projection/v1",
        requested_task_id: taskId,
        state: "authority_conflict",
        owner_task_id: claim.task_id,
        owner_lifecycle: authorityRecord?.lifecycle ?? null,
        claim_lifecycle_status: claim.lifecycle_status,
        diagnostic: `claim ${claim.task_id} has contradictory terminal ownership evidence`,
        revision
      };
    if (claim)
      return {
        contract: "assurance_kernel/authority_projection/v1",
        requested_task_id: taskId,
        state: "active_owner",
        owner_task_id: claim.task_id,
        owner_lifecycle: authorityRecord?.lifecycle ?? null,
        claim_lifecycle_status: claim.lifecycle_status,
        diagnostic: null,
        revision
      };
    if (matchingTerminalProof)
      return {
        contract: "assurance_kernel/authority_projection/v1",
        requested_task_id: taskId,
        state: "terminal_owner",
        owner_task_id: inspectedTaskId,
        owner_lifecycle: authorityRecord?.lifecycle ?? null,
        claim_lifecycle_status: null,
        diagnostic: null,
        revision
      };
    if (authorityRecord || workspace.current_working !== null)
      return {
        contract: "assurance_kernel/authority_projection/v1",
        requested_task_id: taskId,
        state: "authority_conflict",
        owner_task_id: workspace.current_working,
        owner_lifecycle: authorityRecord?.lifecycle ?? null,
        claim_lifecycle_status: null,
        diagnostic: "nonterminal owner state exists without a backend claim",
        revision
      };
    return {
      contract: "assurance_kernel/authority_projection/v1",
      requested_task_id: taskId,
      state: "unowned",
      owner_task_id: null,
      owner_lifecycle: null,
      claim_lifecycle_status: null,
      diagnostic: null,
      revision
    };
  } catch (error) {
    return {
      contract: "assurance_kernel/authority_projection/v1",
      requested_task_id: taskId,
      state: "authority_conflict",
      owner_task_id: null,
      owner_lifecycle: null,
      claim_lifecycle_status: null,
      diagnostic: error instanceof Error ? error.message : String(error),
      revision: ""
    };
  }
}
function reconcileKernelAuthority(root, taskId) {
  validateTaskId4(taskId);
  return withKernelStoreLock(root, () => projectKernelAuthorityLocked(root, taskId));
}
function readPendingAuthorityRepairMarker(root) {
  if (currentRevision(root, AUTHORITY_REPAIR_MARKER_PATH) === MISSING_REVISION)
    return null;
  const raw = JSON.parse(readSecureProjectFile(root, AUTHORITY_REPAIR_MARKER_PATH));
  const allowed = [
    "contract",
    "task_id",
    "expected_projection_revision",
    "expected_claim_content",
    "at"
  ];
  const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    throw new KernelStoreSecurityError(`authority repair marker has unknown field: ${unknown[0]}`);
  if (raw.contract !== "assurance_kernel/authority_repair_transaction/v1")
    throw new KernelStoreSecurityError("authority repair marker contract is invalid");
  for (const field of ["task_id", "expected_projection_revision", "expected_claim_content", "at"]) {
    if (typeof raw[field] !== "string" || !String(raw[field]).trim())
      throw new KernelStoreSecurityError(`authority repair marker ${field} is invalid`);
  }
  const marker = raw;
  validateTaskId4(marker.task_id);
  const claim = parseBackendClaim(JSON.parse(marker.expected_claim_content));
  if (claim.task_id !== marker.task_id)
    throw new KernelStoreSecurityError("authority repair claim identity is inconsistent");
  return marker;
}
function removeAuthorityRepairMarker(root) {
  const candidate = safeCandidate(root, AUTHORITY_REPAIR_MARKER_PATH);
  assertNoSymlinkSegments(candidate.root, candidate.path);
  const stat = pathStatOrNull(candidate.path);
  if (!stat)
    return;
  if (!stat.isFile())
    throw new KernelStoreSecurityError("authority repair marker is not a regular file");
  rmSync3(candidate.path);
  fsyncDirectory(dirname3(candidate.path));
}
function recoverPendingAuthorityRepairLocked(root) {
  const marker = readPendingAuthorityRepairMarker(root);
  if (!marker)
    return;
  const projection = projectKernelAuthorityLocked(root, marker.task_id);
  const claimRevision = currentRevision(root, CLAIM_RELATIVE_PATH);
  if (claimRevision === MISSING_REVISION) {
    if (projection.state !== "terminal_owner" || projection.owner_task_id !== marker.task_id)
      throw new KernelStoreConflictError("authority repair committed claim removal but terminal proof changed");
    removeAuthorityRepairMarker(root);
    return;
  }
  if (projection.state !== "repairable_stale_claim" || projection.owner_task_id !== marker.task_id || projection.revision !== marker.expected_projection_revision || claimRevision !== revisionFor(marker.expected_claim_content))
    throw new KernelStoreConflictError("authority repair facts changed after confirmation");
  const claimCandidate = safeCandidate(root, CLAIM_RELATIVE_PATH);
  assertNoSymlinkSegments(claimCandidate.root, claimCandidate.path);
  rmSync3(claimCandidate.path);
  fsyncDirectory(dirname3(claimCandidate.path));
  removeAuthorityRepairMarker(root);
}
function repairKernelAuthority(root, taskId, expectedProjectionRevision, at = new Date().toISOString()) {
  validateTaskId4(taskId);
  return withKernelStoreLock(root, () => {
    const projection = projectKernelAuthorityLocked(root, taskId);
    if (projection.state !== "repairable_stale_claim" || projection.owner_task_id !== taskId || projection.revision !== expectedProjectionRevision)
      throw new KernelStoreConflictError("authority repair requires exact stale terminal proof");
    const marker = {
      contract: "assurance_kernel/authority_repair_transaction/v1",
      task_id: taskId,
      expected_projection_revision: expectedProjectionRevision,
      expected_claim_content: readSecureProjectFile(root, CLAIM_RELATIVE_PATH),
      at
    };
    atomicCasWrite(root, AUTHORITY_REPAIR_MARKER_PATH, `${JSON.stringify(marker, null, 2)}
`, MISSING_REVISION);
    try {
      recoverPendingAuthorityRepairLocked(root);
    } catch (error) {
      throw new KernelStoreConflictError(`authority repair failed and remains recoverable: ${error instanceof Error ? error.message : error}`);
    }
    return projectKernelAuthorityLocked(root, taskId);
  });
}
function readPendingEnrollmentMarker(root) {
  if (currentRevision(root, ENROLLMENT_MARKER_PATH) === MISSING_REVISION)
    return null;
  const raw = JSON.parse(readSecureProjectFile(root, ENROLLMENT_MARKER_PATH));
  const allowed = ["contract", "task_id", "transaction", "claim"];
  const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    throw new KernelStoreSecurityError(`enrollment marker has unknown field: ${unknown[0]}`);
  if (raw.contract !== "assurance_kernel/enrollment_transaction/v1")
    throw new KernelStoreSecurityError("enrollment marker contract is invalid");
  if (typeof raw.task_id !== "string" || !raw.task_id.trim())
    throw new KernelStoreSecurityError("enrollment marker task_id is invalid");
  const transaction = parseWorkspaceTransactionV2(raw.transaction);
  if (transaction.task_id !== raw.task_id)
    throw new KernelStoreSecurityError("enrollment marker task identity is inconsistent");
  return {
    contract: "assurance_kernel/enrollment_transaction/v1",
    task_id: raw.task_id,
    transaction,
    claim: raw.claim
  };
}
function removeEnrollmentMarker(root) {
  const candidate = safeCandidate(root, ENROLLMENT_MARKER_PATH);
  assertNoSymlinkSegments(candidate.root, candidate.path);
  const stat = pathStatOrNull(candidate.path);
  if (!stat)
    return;
  if (!stat.isFile())
    throw new KernelStoreSecurityError("enrollment marker is not a regular file");
  rmSync3(candidate.path);
  fsyncDirectory(dirname3(candidate.path));
}
function recoverPendingEnrollmentLocked(root) {
  const marker = readPendingEnrollmentMarker(root);
  if (!marker)
    return;
  const transaction = marker.transaction;
  convergeFile(root, stateTaskRecordPath(transaction.task_id), transaction.expected_record_hash, transaction.next_record_content);
  convergeFile(root, stateWorkspacePath(), transaction.expected_workspace_hash, transaction.next_workspace_content);
  atomicCasWrite(root, stateClaimPath(), `${JSON.stringify(marker.claim, null, 2)}
`, MISSING_REVISION);
  removeEnrollmentMarker(root);
}
function commitEnrollmentLocked(root, taskId, transaction, claim) {
  const marker = {
    contract: "assurance_kernel/enrollment_transaction/v1",
    task_id: taskId,
    transaction,
    claim
  };
  atomicCasWrite(root, ENROLLMENT_MARKER_PATH, `${JSON.stringify(marker, null, 2)}
`, MISSING_REVISION);
  try {
    recoverPendingEnrollmentLocked(root);
  } catch (error) {
    throw new KernelStoreConflictError(`enrollment transaction failed and remains recoverable: ${error instanceof Error ? error.message : error}`);
  }
  return {
    record: parseTaskRecord(JSON.parse(transaction.next_record_content)),
    workspace: parseWorkspaceContent(transaction.next_workspace_content)
  };
}
function parseArtifactRelocationsV1(raw) {
  if (raw === undefined)
    return [];
  if (!Array.isArray(raw))
    throw new KernelStoreSecurityError("artifact_relocations is invalid");
  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new KernelStoreSecurityError(`artifact relocation ${index} is invalid`);
    const value = item;
    const unknownFields = Object.keys(value).filter((key) => !["from_path", "to_path", "content_hash"].includes(key));
    if (unknownFields.length > 0)
      throw new KernelStoreSecurityError(`artifact relocation has unknown field: ${unknownFields[0]}`);
    for (const field of ["from_path", "to_path", "content_hash"])
      if (typeof value[field] !== "string" || !String(value[field]).trim())
        throw new KernelStoreSecurityError(`artifact relocation ${field} is invalid`);
    const relocation = value;
    assertArtifactRelocation(relocation);
    return relocation;
  });
}
var CLAIM_RELATIVE_PATH = stateClaimPath();
function parseDrainMarker(raw) {
  const allowed = [
    "contract",
    "task_id",
    "expected_claim_content",
    "next_claim_content",
    "at"
  ];
  const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    throw new KernelStoreSecurityError(`drain marker has unknown field: ${unknown[0]}`);
  if (raw.contract !== "assurance_kernel/drain_transaction/v1")
    throw new KernelStoreSecurityError("drain marker contract is invalid");
  if (typeof raw.task_id !== "string" || !raw.task_id.trim())
    throw new KernelStoreSecurityError("drain marker task_id is invalid");
  for (const field of ["expected_claim_content", "next_claim_content", "at"]) {
    if (typeof raw[field] !== "string" || !String(raw[field]).trim())
      throw new KernelStoreSecurityError(`drain marker ${field} is invalid`);
  }
  const marker = raw;
  validateTaskId4(marker.task_id);
  const expected = parseBackendClaim(JSON.parse(marker.expected_claim_content));
  const next = parseBackendClaim(JSON.parse(marker.next_claim_content));
  if (expected.task_id !== marker.task_id || next.task_id !== marker.task_id)
    throw new KernelStoreSecurityError("drain marker claim identity is inconsistent");
  if (expected.lifecycle_status !== "active" || next.lifecycle_status !== "draining")
    throw new KernelStoreSecurityError("drain marker must transition active -> draining");
  return marker;
}
function readPendingDrainMarker(root) {
  if (currentRevision(root, DRAIN_MARKER_PATH) === MISSING_REVISION)
    return null;
  const raw = JSON.parse(readSecureProjectFile(root, DRAIN_MARKER_PATH));
  return parseDrainMarker(raw);
}
function removeDrainMarker(root) {
  const candidate = safeCandidate(root, DRAIN_MARKER_PATH);
  assertNoSymlinkSegments(candidate.root, candidate.path);
  const stat = pathStatOrNull(candidate.path);
  if (!stat)
    return;
  if (!stat.isFile())
    throw new KernelStoreSecurityError("drain marker is not a regular file");
  rmSync3(candidate.path);
  fsyncDirectory(dirname3(candidate.path));
}
function recoverPendingDrainLocked(root) {
  const marker = readPendingDrainMarker(root);
  if (!marker)
    return;
  convergeFile(root, CLAIM_RELATIVE_PATH, revisionFor(marker.expected_claim_content), marker.next_claim_content);
  removeDrainMarker(root);
}
function commitDrainLocked(root, taskId, expectedClaimContent, nextClaimContent, at) {
  validateTaskId4(taskId);
  const expected = parseBackendClaim(JSON.parse(expectedClaimContent));
  const next = parseBackendClaim(JSON.parse(nextClaimContent));
  if (expected.task_id !== taskId || next.task_id !== taskId)
    throw new KernelStoreSecurityError("drain claim identity is inconsistent");
  if (expected.lifecycle_status !== "active" || next.lifecycle_status !== "draining")
    throw new KernelStoreSecurityError("drain transaction must transition active -> draining");
  const marker = {
    contract: "assurance_kernel/drain_transaction/v1",
    task_id: taskId,
    expected_claim_content: expectedClaimContent,
    next_claim_content: nextClaimContent,
    at
  };
  atomicCasWrite(root, DRAIN_MARKER_PATH, `${JSON.stringify(marker, null, 2)}
`, MISSING_REVISION);
  try {
    recoverPendingDrainLocked(root);
  } catch (error) {
    throw new KernelStoreConflictError(`drain transaction failed and remains recoverable: ${error instanceof Error ? error.message : error}`);
  }
  return next;
}
function parseTerminalMarker(raw) {
  const allowed = [
    "contract",
    "task_id",
    "expected_state_record_hash",
    "audit_record_content",
    "proof_content",
    "expected_workspace_hash",
    "next_workspace_content",
    "artifact_relocations",
    "expected_claim_sha256",
    "at"
  ];
  const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    throw new KernelStoreSecurityError(`terminal marker has unknown field: ${unknown[0]}`);
  if (raw.contract !== "assurance_kernel/terminal_transaction/v2")
    throw new KernelStoreSecurityError("terminal marker contract is invalid");
  if (typeof raw.task_id !== "string" || !raw.task_id.trim())
    throw new KernelStoreSecurityError("terminal marker task_id is invalid");
  validateTaskId4(raw.task_id);
  for (const field of ["expected_state_record_hash", "audit_record_content", "proof_content", "expected_workspace_hash", "next_workspace_content", "at"]) {
    if (typeof raw[field] !== "string" || !String(raw[field]).trim())
      throw new KernelStoreSecurityError(`terminal marker ${field} is invalid`);
  }
  const expectedClaim = raw.expected_claim_sha256;
  if (typeof expectedClaim !== "string" || !/^sha256:[a-f0-9]{64}$/.test(expectedClaim))
    throw new KernelStoreSecurityError("terminal marker expected_claim_sha256 is required");
  const marker = {
    contract: "assurance_kernel/terminal_transaction/v2",
    task_id: raw.task_id,
    expected_state_record_hash: raw.expected_state_record_hash,
    audit_record_content: raw.audit_record_content,
    proof_content: raw.proof_content,
    expected_workspace_hash: raw.expected_workspace_hash,
    next_workspace_content: raw.next_workspace_content,
    artifact_relocations: parseArtifactRelocationsV1(raw.artifact_relocations),
    expected_claim_sha256: expectedClaim,
    at: raw.at
  };
  const record = parseTaskRecord(JSON.parse(marker.audit_record_content));
  if (record.task_id !== marker.task_id)
    throw new KernelStoreSecurityError("terminal marker task identity is inconsistent");
  if (record.lifecycle !== "done" && record.lifecycle !== "stopped")
    throw new KernelStoreSecurityError("terminal marker record must be terminal");
  const proof = parseTaskTombstone(JSON.parse(marker.proof_content));
  if (proof.task_id !== marker.task_id)
    throw new KernelStoreSecurityError("terminal marker proof identity is inconsistent");
  if (proof.final_record_hash !== revisionFor(marker.audit_record_content))
    throw new KernelStoreSecurityError("terminal marker proof does not match the terminal record bytes");
  if (proof.terminal_lifecycle !== record.lifecycle)
    throw new KernelStoreSecurityError("terminal marker proof lifecycle contradicts the terminal record");
  const workspaceState = parseWorkspaceContent(marker.next_workspace_content);
  if (workspaceState.current_working !== null)
    throw new KernelStoreSecurityError("terminal marker requires a cleared workspace owner");
  return marker;
}
function readPendingTerminalMarker(root) {
  if (currentRevision(root, TERMINAL_MARKER_PATH) === MISSING_REVISION)
    return null;
  const raw = JSON.parse(readSecureProjectFile(root, TERMINAL_MARKER_PATH));
  return parseTerminalMarker(raw);
}
function removeTerminalMarker(root) {
  const candidate = safeCandidate(root, TERMINAL_MARKER_PATH);
  assertNoSymlinkSegments(candidate.root, candidate.path);
  const stat = pathStatOrNull(candidate.path);
  if (!stat)
    return;
  if (!stat.isFile())
    throw new KernelStoreSecurityError("terminal marker is not a regular file");
  rmSync3(candidate.path);
  fsyncDirectory(dirname3(candidate.path));
}
function convergeStateRecordRemoval(root, taskId, expectedHash) {
  const relativePath = stateTaskRecordPath(taskId);
  const actual = currentRevision(root, relativePath);
  if (actual === MISSING_REVISION)
    return;
  if (actual !== expectedHash)
    throw new KernelStoreConflictError(`state record changed during terminal settlement: expected ${expectedHash}, got ${actual}`);
  const candidate = safeCandidate(root, relativePath);
  assertNoSymlinkSegments(candidate.root, candidate.path);
  const stat = pathStatOrNull(candidate.path);
  if (!stat || !stat.isFile())
    throw new KernelStoreSecurityError("state task record is not a regular file");
  rmSync3(candidate.path);
  fsyncDirectory(dirname3(candidate.path));
}
function recoverPendingTerminalLocked(root, invokeStepHook = false) {
  const marker = readPendingTerminalMarker(root);
  if (!marker)
    return;
  for (const relocation of marker.artifact_relocations ?? [])
    convergeArtifactRelocation(root, relocation);
  if (invokeStepHook)
    runTerminalSettlementStepHook(0);
  convergeFile(root, auditTaskRecordPath(marker.task_id), MISSING_REVISION, marker.audit_record_content);
  convergeFile(root, auditTerminalProofPath(marker.task_id), MISSING_REVISION, marker.proof_content);
  if (invokeStepHook)
    runTerminalSettlementStepHook(1);
  convergeFile(root, stateWorkspacePath(), marker.expected_workspace_hash, marker.next_workspace_content);
  if (invokeStepHook)
    runTerminalSettlementStepHook(2);
  const claimCandidate = safeCandidate(root, stateClaimPath());
  assertNoSymlinkSegments(claimCandidate.root, claimCandidate.path);
  const claimStat = pathStatOrNull(claimCandidate.path);
  if (claimStat) {
    if (!claimStat.isFile())
      throw new KernelStoreSecurityError("backend claim is not a regular file");
    const claimBytes = readSecureProjectFile(root, stateClaimPath());
    if (revisionFor(claimBytes) !== marker.expected_claim_sha256)
      throw new KernelStoreConflictError(`backend claim changed during terminal settlement: expected ${marker.expected_claim_sha256}, got ${revisionFor(claimBytes)}`);
    rmSync3(claimCandidate.path);
    fsyncDirectory(dirname3(claimCandidate.path));
  }
  if (invokeStepHook)
    runTerminalSettlementStepHook(3);
  convergeStateRecordRemoval(root, marker.task_id, marker.expected_state_record_hash);
  if (invokeStepHook)
    runTerminalSettlementStepHook(4);
  terminalSettlementStepHookForTest = null;
  removeTerminalMarker(root);
}
function commitTerminalLocked(root, taskId, transaction, tombstone) {
  validateTaskId4(taskId);
  if (transaction.task_id !== taskId)
    throw new KernelStoreSecurityError("terminal transaction task identity is inconsistent");
  if (tombstone.task_id !== taskId)
    throw new KernelStoreSecurityError("terminal tombstone task identity is inconsistent");
  const nextWorkspaceState = parseWorkspaceContent(transaction.next_workspace_content);
  if (nextWorkspaceState.current_working !== null)
    throw new KernelStoreSecurityError("terminal settlement requires a cleared workspace owner");
  if (tombstone.final_record_hash !== revisionFor(transaction.next_record_content))
    throw new KernelStoreSecurityError("terminal proof must match the terminal record bytes");
  const terminalRecord = parseTaskRecord(JSON.parse(transaction.next_record_content));
  if (tombstone.terminal_lifecycle !== terminalRecord.lifecycle)
    throw new KernelStoreSecurityError("terminal proof lifecycle contradicts the terminal TaskRecord");
  const claimBytes = readSecureProjectFile(root, stateClaimPath());
  const claim = parseBackendClaim(JSON.parse(claimBytes));
  if (claim.task_id !== taskId)
    throw new KernelStoreSecurityError(`terminal settlement claim belongs to ${claim.task_id}, not ${taskId}`);
  if (claim.lifecycle_status !== "active" && claim.lifecycle_status !== "draining")
    throw new KernelStoreSecurityError("terminal settlement claim must be active or draining");
  const expectedClaimSha256 = revisionFor(claimBytes);
  const marker = {
    contract: "assurance_kernel/terminal_transaction/v2",
    task_id: taskId,
    expected_state_record_hash: transaction.expected_record_hash,
    audit_record_content: transaction.next_record_content,
    proof_content: serializeTaskTombstone(tombstone),
    expected_workspace_hash: transaction.expected_workspace_hash,
    next_workspace_content: transaction.next_workspace_content,
    ...transaction.artifact_relocations ? { artifact_relocations: transaction.artifact_relocations } : {},
    expected_claim_sha256: expectedClaimSha256,
    at: tombstone.terminalized_at
  };
  atomicCasWrite(root, TERMINAL_MARKER_PATH, `${JSON.stringify(marker, null, 2)}
`, MISSING_REVISION);
  try {
    recoverPendingTerminalLocked(root, true);
  } catch (error) {
    throw new KernelStoreConflictError(`terminal transaction failed and remains recoverable: ${error instanceof Error ? error.message : error}`);
  }
  return {
    record: parseTaskRecord(JSON.parse(transaction.next_record_content)),
    workspace: parseWorkspaceContent(transaction.next_workspace_content)
  };
}

// plugins/immune-brain/runtime/kernel/completion.ts
var REQUIRED_ATTESTATIONS = {
  routine: ["qa"],
  material: ["qa", "review"],
  critical: ["qa", "review"]
};
function archiveActivePlanningPath(path) {
  const matched = path.match(/^docs\/(plans|specs)\/([^/]+)$/);
  return matched ? `docs/${matched[1]}/archive/${matched[2]}` : null;
}
function ownSidecarPaths(intent) {
  const activeIntent = `docs/plans/${intent.task_id}.intent.json`;
  const archivedIntent = archiveActivePlanningPath(activeIntent);
  const excluded = new Set([activeIntent]);
  if (archivedIntent)
    excluded.add(archivedIntent);
  const specs = intent.scope_hint.filter((path) => {
    const archived = archiveActivePlanningPath(path);
    return archived !== null && /^docs\/specs\/[^/]+\.spec\.md$/.test(path) && intent.scope_hint.includes(archived);
  });
  if (specs.length > 1) {
    throw new KernelInvariantError([
      `artifact transition requires at most one scope-bound Spec; found ${specs.length}`
    ]);
  }
  const spec = specs[0];
  if (spec) {
    excluded.add(spec);
    const archived = archiveActivePlanningPath(spec);
    if (archived)
      excluded.add(archived);
  }
  return excluded;
}
function asTaskDiffSnapshot(value) {
  if (typeof value === "string")
    return { diff_hash: value };
  return { diff_hash: value.diff_hash, changed_paths: value.changed_paths };
}
function resolveProjectedRisk(intent, changedPaths = []) {
  const excluded = ownSidecarPaths(intent);
  return classifyTaskRisk(changedPaths.filter((path) => !excluded.has(path)), intent.risk);
}
function hasDistinctAuthorityAssignment(required, candidates, index = 0, usedActors = new Set) {
  if (index >= required.length)
    return true;
  for (const attestation of candidates.filter((item) => item.kind === required[index])) {
    if (usedActors.has(attestation.actor_id))
      continue;
    const nextActors = new Set(usedActors);
    nextActors.add(attestation.actor_id);
    if (hasDistinctAuthorityAssignment(required, candidates, index + 1, nextActors))
      return true;
  }
  return false;
}
function completionDecision(intent, record, currentDiffHash, currentIntentContentHash, changedPaths = []) {
  assertKernelInvariantsV3(intent, record);
  const freshAttestations = record.attestations.filter((item) => item.task_revision === intent.revision && item.intent_content_hash === currentIntentContentHash && item.diff_hash === currentDiffHash);
  const freshQaResults = freshAttestations.filter((item) => item.kind === "qa").flatMap((item) => item.acceptance_results).filter((item) => item.status === "passed");
  const freshAcceptanceIds = intent.acceptance.map((item) => item.id).filter((id) => freshQaResults.some((result) => result.acceptance_id === id));
  const freshAcceptanceSet = new Set(freshAcceptanceIds);
  const missingAcceptanceIds = intent.acceptance.map((item) => item.id).filter((id) => !freshAcceptanceSet.has(id));
  const staleAttestationIds = record.attestations.filter((item) => item.task_revision !== intent.revision || item.intent_content_hash !== currentIntentContentHash || item.diff_hash !== currentDiffHash).map((item) => item.id);
  const requiredKinds = REQUIRED_ATTESTATIONS[resolveProjectedRisk(intent, changedPaths)];
  const candidates = freshAttestations.filter((item) => requiredKinds.includes(item.kind));
  const missingApprovalKinds = requiredKinds.filter((kind) => !candidates.some((attestation) => attestation.kind === kind));
  const separationFailure = missingApprovalKinds.length === 0 && !hasDistinctAuthorityAssignment(requiredKinds, candidates);
  const repeatedActors = new Set;
  if (separationFailure) {
    for (const attestation of candidates) {
      const kinds = new Set(candidates.filter((candidate) => candidate.actor_id === attestation.actor_id).map((candidate) => candidate.kind));
      if (kinds.size > 1)
        repeatedActors.add(attestation.actor_id);
    }
  }
  const independenceViolations = candidates.filter((item) => repeatedActors.has(item.actor_id)).map((item) => item.id);
  const blockingFindingIds = record.findings.filter((item) => item.status === "open" && item.kind === "blocking").map((item) => item.id);
  const unresolvedUserDecisionIds = record.findings.filter((item) => item.status === "open" && item.kind === "unresolved_user_decision").map((item) => item.id);
  const replanRequiredIds = record.findings.filter((item) => item.status === "open" && item.kind === "replan_required").map((item) => item.id);
  return {
    complete: missingAcceptanceIds.length === 0 && missingApprovalKinds.length === 0 && blockingFindingIds.length === 0 && unresolvedUserDecisionIds.length === 0 && replanRequiredIds.length === 0 && independenceViolations.length === 0,
    fresh_acceptance_ids: freshAcceptanceIds,
    missing_acceptance_ids: missingAcceptanceIds,
    stale_attestation_ids: staleAttestationIds,
    missing_approval_kinds: missingApprovalKinds,
    blocking_finding_ids: blockingFindingIds,
    unresolved_user_decision_ids: unresolvedUserDecisionIds,
    replan_required_ids: replanRequiredIds,
    independence_violations: independenceViolations
  };
}
function projectTask(intent, record, currentDiffHash, currentIntentContentHash, changedPaths = []) {
  const decision = completionDecision(intent, record, currentDiffHash, currentIntentContentHash, changedPaths);
  const blocked = decision.blocking_finding_ids.length > 0 || decision.unresolved_user_decision_ids.length > 0 || decision.replan_required_ids.length > 0 || decision.independence_violations.length > 0;
  let nextObligation = "none";
  if (record.lifecycle === "active") {
    if (decision.unresolved_user_decision_ids.length > 0) {
      nextObligation = "resolve_user_decision";
    } else if (decision.replan_required_ids.length > 0) {
      nextObligation = "revise_intent";
    } else if (decision.blocking_finding_ids.length > 0 || decision.independence_violations.length > 0) {
      nextObligation = "resolve_findings";
    } else if (record.artifact_state === "active") {
      nextObligation = "submit_assurance";
    } else if (decision.missing_acceptance_ids.length > 0 || decision.missing_approval_kinds.includes("qa")) {
      nextObligation = "run_qa";
    } else if (decision.missing_approval_kinds.includes("review")) {
      nextObligation = "run_review";
    } else if (decision.complete) {
      nextObligation = "complete";
    }
  }
  return {
    contract: "assurance_kernel/projection/v3",
    task_id: record.task_id,
    intent_revision: record.intent_snapshot.revision,
    lifecycle: record.lifecycle,
    artifact_state: record.artifact_state,
    blocked,
    next_obligation: nextObligation,
    ...decision
  };
}

// plugins/immune-brain/runtime/kernel/assurance_projection.ts
function deriveAssuranceAuthorization(input) {
  if (input.open_user_decision_count === 1)
    return { state: "resolve_user_decision", blocked: null };
  if (input.open_user_decision_count > 1)
    return {
      state: "none",
      blocked: `resolve-user-decision requires exactly one open user decision; found ${input.open_user_decision_count}`
    };
  return { state: "none", blocked: null };
}
function emptyProjection() {
  return {
    record_revision: "",
    workspace_revision: "",
    intent_revision: 0,
    intent_content_hash: "",
    diff_hash: "",
    lifecycle: "",
    artifact_state: "",
    risk: "",
    next_obligation: "none",
    fresh_acceptance_ids: [],
    missing_acceptance_ids: [],
    stale_attestation_ids: [],
    fresh_approval_kinds: [],
    missing_approval_kinds: [],
    blocking_finding_ids: [],
    unresolved_user_decision_ids: [],
    replan_required_ids: [],
    independence_violations: [],
    open_user_decision_count: 0,
    completion_ready: false,
    authorization: { state: "none", blocked: null }
  };
}
function projectHistoricalTerminal(record, recordRevision, workspaceRevision) {
  const approvalKinds = [...new Set(record.approvals.map((item) => item.kind))];
  return {
    ...emptyProjection(),
    record_revision: recordRevision,
    workspace_revision: workspaceRevision,
    intent_revision: record.intent_revision,
    intent_content_hash: record.intent_ref.content_hash,
    lifecycle: record.phase,
    artifact_state: "frozen",
    risk: record.intent_snapshot.risk,
    fresh_acceptance_ids: [...new Set(record.evidence.filter((item) => item.status === "passed").map((item) => item.acceptance_id))],
    fresh_approval_kinds: approvalKinds,
    completion_ready: record.phase === "done"
  };
}
function freshApprovalKinds(record, currentIntentContentHash, diffHash) {
  const kinds = [];
  const seen = new Set;
  for (const approval of record.attestations) {
    if (approval.task_revision !== record.intent_snapshot.revision || approval.intent_content_hash !== currentIntentContentHash || approval.diff_hash !== diffHash)
      continue;
    if (seen.has(approval.kind))
      continue;
    seen.add(approval.kind);
    kinds.push(approval.kind);
  }
  return kinds;
}
function projectFromRecord(record, recordRevision, workspaceRevision, snapshot) {
  const intent = record.intent_snapshot;
  const decision = projectTask(intent, record, snapshot.diff_hash, record.intent_ref.content_hash, snapshot.changed_paths);
  const approvalKinds = freshApprovalKinds(record, record.intent_ref.content_hash, snapshot.diff_hash);
  const openUserDecisionCount = record.findings.filter((finding) => finding.kind === "unresolved_user_decision" && finding.status === "open").length;
  return {
    record_revision: recordRevision,
    workspace_revision: workspaceRevision,
    intent_revision: record.intent_snapshot.revision,
    intent_content_hash: record.intent_ref.content_hash,
    diff_hash: snapshot.diff_hash,
    lifecycle: record.lifecycle,
    artifact_state: record.artifact_state,
    risk: resolveProjectedRisk(intent, snapshot.changed_paths),
    next_obligation: decision.next_obligation,
    fresh_acceptance_ids: decision.fresh_acceptance_ids,
    missing_acceptance_ids: decision.missing_acceptance_ids,
    stale_attestation_ids: decision.stale_attestation_ids,
    fresh_approval_kinds: approvalKinds,
    missing_approval_kinds: decision.missing_approval_kinds,
    blocking_finding_ids: decision.blocking_finding_ids,
    unresolved_user_decision_ids: decision.unresolved_user_decision_ids,
    replan_required_ids: decision.replan_required_ids,
    independence_violations: decision.independence_violations,
    open_user_decision_count: openUserDecisionCount,
    completion_ready: decision.complete,
    authorization: deriveAssuranceAuthorization({
      next_obligation: decision.next_obligation,
      open_user_decision_count: openUserDecisionCount
    })
  };
}
async function projectAssurance(root, taskId, diffProvider) {
  const fail = (error, claim = null) => ({
    contract: "assurance_kernel/assurance_projection/v1",
    task_id: taskId,
    error,
    claim,
    projection: emptyProjection()
  });
  try {
    const claim = readBackendClaim(root);
    let terminalOwner = false;
    if (claim?.task_id !== undefined && claim.task_id !== taskId)
      return fail(`backend claim belongs to ${claim.task_id}, not ${taskId}`, claim);
    if (claim) {
      const tombstone = readTaskTombstone(root, taskId);
      if (tombstone) {
        const authority = reconcileKernelAuthority(root, taskId);
        if (authority.state === "repairable_stale_claim")
          return fail(`task ${taskId} has a repairable stale backend claim`, claim);
        return fail(authority.diagnostic ?? `authority state conflicts for ${taskId}`, claim);
      }
    } else {
      const authority = reconcileKernelAuthority(root, taskId);
      if (authority.state === "unowned")
        return { contract: "assurance_kernel/assurance_projection/v1", task_id: taskId, error: null, claim: null, projection: emptyProjection() };
      if (authority.state !== "terminal_owner")
        return fail(authority.diagnostic ?? `authority state conflicts for ${taskId}`);
      terminalOwner = true;
      if (readBackendClaim(root))
        return fail(`authority state changed while projecting ${taskId}`);
    }
    let read;
    try {
      read = await readTaskRecord(root, taskId);
    } catch (error) {
      if (!terminalOwner || !(error instanceof Error) || !error.message.startsWith("TaskRecord v2"))
        throw error;
      return fail(error instanceof Error ? error.message : String(error));
    }
    if (!read.record) {
      if (!terminalOwner)
        return fail(`task ${taskId} has no TaskRecord v3`, claim);
      const auditPair = await readAuditTaskPair(root, taskId);
      if (!auditPair)
        return fail(`task ${taskId} has no terminal audit pair`, claim);
      const workspace2 = await readWorkspaceStateRaw(root);
      if (auditPair.record.contract === "assurance_kernel/task_record/v2")
        return {
          contract: "assurance_kernel/assurance_projection/v1",
          task_id: taskId,
          error: null,
          claim: null,
          projection: projectHistoricalTerminal(auditPair.record, auditPair.recordRevision, workspace2.revision)
        };
      return {
        contract: "assurance_kernel/assurance_projection/v1",
        task_id: taskId,
        error: null,
        claim: null,
        projection: projectFromRecord(auditPair.record, auditPair.recordRevision, workspace2.revision, diffProvider(root, auditPair.record))
      };
    }
    if (read.record.task_id !== taskId)
      return fail(`task record identity is inconsistent for ${taskId}`, claim);
    if (claim && read.record.lifecycle !== "active")
      return fail(`terminal task ${taskId} has no matching tombstone proof`, claim);
    const workspace = await readWorkspaceStateRaw(root);
    const snapshot = diffProvider(root, read.record);
    return {
      contract: "assurance_kernel/assurance_projection/v1",
      task_id: taskId,
      error: null,
      claim,
      projection: projectFromRecord(read.record, read.revision, workspace.revision, snapshot)
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

// plugins/immune-brain/runtime/kernel/reducer.ts
import { createHash as createHash10 } from "node:crypto";
var RISK_RANK2 = {
  routine: 0,
  material: 1,
  critical: 2
};
function transitionLifecycle(record, to) {
  if (record.lifecycle !== "active")
    throw new KernelInvariantError([
      `illegal lifecycle transition: ${record.lifecycle} -> ${to}`
    ]);
  record.lifecycle = to;
}
function stateOf(record) {
  return `${record.lifecycle}:${record.artifact_state}`;
}
function stableJson(value) {
  if (Array.isArray(value))
    return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  const primitive = JSON.stringify(value);
  return primitive === undefined ? "null" : primitive;
}
function canonicalRecordHash(record) {
  return `sha256:${createHash10("sha256").update(`${JSON.stringify(record, null, 2)}
`).digest("hex")}`;
}
function actionFingerprint(action, intentRevision, intentContentHash, audit) {
  const { expected_record_hash: _r, expected_workspace_hash: _w, diff_hash: _d, ...payload } = action;
  const base = audit ? { action: payload, intentRevision, intentContentHash, audit } : { action: payload, intentRevision, intentContentHash };
  return createHash10("sha256").update(stableJson(base)).digest("hex");
}
function historyReason(action, intentRevision, intentContentHash, audit, detail) {
  const fingerprint = `action_v2_sha256:${actionFingerprint(action, intentRevision, intentContentHash, audit)}`;
  return detail ? `${detail}
${fingerprint}` : fingerprint;
}
function recordedActionFingerprint(reason) {
  const matched = reason?.match(/(?:^|\n)action_v2_sha256:([a-f0-9]{64})$/);
  return matched?.[1] ?? null;
}
function copyRecord(record) {
  return {
    ...record,
    intent_snapshot: { ...record.intent_snapshot },
    intent_ref: { ...record.intent_ref },
    attestations: record.attestations.map((item) => ({
      ...item,
      acceptance_results: item.acceptance_results.map((result) => ({ ...result }))
    })),
    findings: record.findings.map((item) => ({ ...item })),
    history: record.history.map((item) => ({ ...item }))
  };
}
function reviewRound(record) {
  return Math.max(0, ...record.findings.filter((item) => item.source === "review").map((item) => item.review_round ?? 0)) + 1;
}
function appendHistory(record, action, from, detail, audit) {
  if (record.history.some((entry2) => entry2.id === action.event_id))
    throw new KernelInvariantError([
      `history contains duplicate id ${action.event_id}`
    ]);
  const entry = {
    id: action.event_id,
    at: action.at,
    type: action.type,
    from_state: from,
    to_state: stateOf(record),
    reason: historyReason(action, record.intent_snapshot.revision, record.intent_ref.content_hash, audit, detail)
  };
  if (audit)
    entry.authority = { ...audit };
  record.history.push(entry);
}
function intentRefMatches(intent, ref) {
  return ref.path === `docs/plans/${intent.task_id}.intent.json` && ref.content_hash === canonicalIntentHash(intent);
}
function hasPrivilegedKind(action) {
  return action.type === "record_approval" || action.type === "approve_breaking_intent_revision" || action.type === "request_rework" || action.type === "stop" || action.type === "resolve_user_decision";
}
function findingsDigestV2(findings) {
  const normalized = findings.map((finding) => ({
    id: finding.id,
    kind: finding.kind,
    acceptance_id: finding.acceptance_id,
    summary: finding.summary
  }));
  return `sha256:${createHash10("sha256").update(stableJson(normalized)).digest("hex")}`;
}
function reduceTask(recordRaw, actionRaw, authorityAudit = null, changedPaths) {
  const previous = parseTaskRecord(recordRaw);
  assertKernelInvariantsV3(previous.intent_snapshot, previous);
  const action = parseTaskAction(actionRaw);
  const record = copyRecord(previous);
  const from = stateOf(record);
  if (!action.event_id.trim())
    throw new KernelInvariantError(["event_id must be a non-empty string"]);
  if (!action.at.trim())
    throw new KernelInvariantError(["event timestamp must be a non-empty string"]);
  const privileged = hasPrivilegedKind(action);
  if (privileged && !authorityAudit)
    throw new KernelInvariantError([
      `${action.type} requires an authority audit descriptor`
    ]);
  if (!privileged && authorityAudit)
    throw new KernelInvariantError([
      `${action.type} does not accept an authority audit descriptor`
    ]);
  const recordHash = canonicalRecordHash(previous);
  const intentRevision = previous.intent_snapshot.revision;
  const intentContentHash = previous.intent_ref.content_hash;
  const existingEvent = previous.history.find((entry) => entry.id === action.event_id);
  if (existingEvent) {
    if (existingEvent.type === action.type && existingEvent.at === action.at && recordedActionFingerprint(existingEvent.reason) === actionFingerprint(action, intentRevision, intentContentHash, authorityAudit))
      return brandResult(previous, null);
    throw new KernelInvariantError([
      `event_id ${action.event_id} conflicts with a recorded action`
    ]);
  }
  if (action.expected_record_hash !== recordHash)
    throw new KernelInvariantError([
      `expected record hash mismatch: ${action.expected_record_hash} != ${recordHash}`
    ]);
  const diffHash = action.diff_hash;
  if (!/^sha256:[a-f0-9]{64}$/.test(diffHash))
    throw new KernelInvariantError(["diff_hash must be a canonical sha256 hash"]);
  switch (action.type) {
    case "record_finding": {
      if (record.lifecycle !== "active")
        throw new KernelInvariantError([
          `cannot record findings while lifecycle is ${record.lifecycle}`
        ]);
      const finding = action.finding;
      if (record.findings.some((item) => item.id === finding.id))
        throw new KernelInvariantError([
          `findings contains duplicate id ${finding.id}`
        ]);
      if (finding.kind === "replan_required")
        throw new KernelInvariantError([
          "record_finding cannot create a replan boundary; use request_rework"
        ]);
      if (finding.kind === "unresolved_user_decision" && !/^user-decision-[A-Za-z0-9._-]+$/.test(finding.id))
        throw new KernelInvariantError([
          "unresolved_user_decision findings require a canonical user-decision- id"
        ]);
      record.findings.push({
        ...finding,
        status: "open",
        source: finding.source === "execution" || finding.source === "review" || finding.source === "kernel" ? finding.source : "execution",
        review_round: null
      });
      appendHistory(record, action, from, finding.id, authorityAudit);
      break;
    }
    case "resolve_finding": {
      if (record.lifecycle !== "active")
        throw new KernelInvariantError([
          `cannot resolve findings while lifecycle is ${record.lifecycle}`
        ]);
      const finding = record.findings.find((item) => item.id === action.finding_id);
      if (!finding)
        throw new KernelInvariantError([
          `finding ${action.finding_id} does not exist`
        ]);
      if (finding.kind === "unresolved_user_decision" || finding.kind === "replan_required")
        throw new KernelInvariantError([
          "generic resolve_finding cannot resolve a user decision or replan boundary"
        ]);
      if (finding.status === "resolved")
        throw new KernelInvariantError([
          `finding ${action.finding_id} is already resolved`
        ]);
      finding.status = "resolved";
      appendHistory(record, action, from, action.finding_id, authorityAudit);
      break;
    }
    case "record_approval": {
      if (record.lifecycle !== "active" || record.artifact_state !== "frozen")
        throw new KernelInvariantError([
          `cannot record approval while state is ${stateOf(record)}`
        ]);
      const approval = action.approval;
      if (approval.kind !== "review" && approval.kind !== "qa")
        throw new KernelInvariantError([
          "record_approval accepts only review or qa approvals"
        ]);
      if (!authorityAudit)
        throw new KernelInvariantError([
          "record_approval requires a consumed authority capability"
        ]);
      const expectedRole = authorityAudit.authority_kind === "review" ? "reviewer" : authorityAudit.authority_kind;
      if (approval.authority_role !== expectedRole)
        throw new KernelInvariantError([
          "approval authority_role must match the consumed capability kind"
        ]);
      if (approval.task_revision !== record.intent_snapshot.revision)
        throw new KernelInvariantError(["approval task_revision must equal the current intent revision"]);
      if (approval.intent_content_hash !== record.intent_ref.content_hash)
        throw new KernelInvariantError(["approval intent_content_hash must equal the current intent hash"]);
      if (approval.diff_hash !== diffHash)
        throw new KernelInvariantError(["approval diff_hash must equal the action diff hash"]);
      if (record.attestations.some((item) => item.id === approval.id))
        throw new KernelInvariantError([
          `attestations contains duplicate id ${approval.id}`
        ]);
      const reviewRevision = approval.review_revision;
      if (reviewRevision && approval.kind !== "review")
        throw new KernelInvariantError(["review_revision is only valid on review approvals"]);
      if (record.contract !== TASK_RECORD_CONTRACT_V4) {
        if (reviewRevision)
          throw new KernelInvariantError(["review_revision requires a TaskRecord v4"]);
      } else if (approval.kind === "review") {
        if (!reviewRevision)
          throw new KernelInvariantError(["v4 review approval requires review_revision"]);
        if (reviewRevision.base_head !== record.git_base_head)
          throw new KernelInvariantError(["review_revision.base_head must equal the Enrollment git_base_head"]);
      }
      const { review_revision: storedReviewRevision, ...approvalWithoutRevision } = approval;
      record.attestations.push({
        ...approvalWithoutRevision,
        acceptance_results: approval.kind === "qa" ? record.intent_snapshot.acceptance.map((item) => ({
          acceptance_id: item.id,
          status: "passed",
          summary: `host-attested QA: ${approval.summary}`
        })) : [],
        ...storedReviewRevision ? { review_revision: storedReviewRevision } : {}
      });
      appendHistory(record, action, from, approval.id, authorityAudit);
      break;
    }
    case "revise_intent":
    case "approve_breaking_intent_revision": {
      if (record.lifecycle !== "active")
        throw new KernelInvariantError([
          `cannot revise intent while lifecycle is ${record.lifecycle}`
        ]);
      const revisionClass = classifyIntentRevision(record.intent_snapshot, action.next_intent);
      if (action.type === "revise_intent" && revisionClass !== "compatible")
        throw new KernelInvariantError([
          "revise_intent requires a compatible revision"
        ]);
      if (action.type === "approve_breaking_intent_revision" && revisionClass !== "breaking")
        throw new KernelInvariantError([
          "approve_breaking_intent_revision requires a breaking revision"
        ]);
      if (!authorityAudit && action.type === "approve_breaking_intent_revision")
        throw new KernelInvariantError([
          "breaking intent revision requires user authority"
        ]);
      if (action.next_intent.task_id !== record.task_id || action.next_intent.task_id !== record.intent_snapshot.task_id)
        throw new KernelInvariantError([
          "intent revision cannot change task identity"
        ]);
      if (action.next_intent.goal !== record.intent_snapshot.goal || action.next_intent.owner !== record.intent_snapshot.owner)
        throw new KernelInvariantError([
          "intent revision cannot change goal or owner"
        ]);
      if (RISK_RANK2[action.next_intent.risk] < RISK_RANK2[record.intent_snapshot.risk])
        throw new KernelInvariantError([
          "intent revision cannot reduce risk"
        ]);
      if (!intentRefMatches(action.next_intent, action.next_intent_ref))
        throw new KernelInvariantError([
          "next intent ref must match the next intent"
        ]);
      record.intent_snapshot = { ...action.next_intent };
      record.intent_ref = { ...action.next_intent_ref };
      if (action.type === "approve_breaking_intent_revision") {
        for (const finding of record.findings) {
          if (finding.kind === "replan_required" && finding.status === "open")
            finding.status = "resolved";
        }
        if (record.artifact_state === "frozen")
          record.artifact_state = "active";
      }
      appendHistory(record, action, from, `intent_revision_${record.intent_snapshot.revision}`, authorityAudit);
      break;
    }
    case "request_rework": {
      if (record.lifecycle !== "active" || record.artifact_state !== "frozen")
        throw new KernelInvariantError([
          `cannot request rework while state is ${stateOf(record)}`
        ]);
      if (action.findings.length === 0)
        throw new KernelInvariantError([
          "request_rework requires at least one finding"
        ]);
      if (!authorityAudit)
        throw new KernelInvariantError([
          "request_rework requires an authority audit descriptor"
        ]);
      if (authorityAudit.authority_kind !== "review" && authorityAudit.authority_kind !== "qa" && authorityAudit.authority_kind !== "user")
        throw new KernelInvariantError([
          "request_rework requires review, qa, or user authority"
        ]);
      const round = reviewRound(record);
      const reviewAuthorityReworks = record.history.filter((entry) => entry.type === "request_rework" && entry.authority?.authority_kind === "review").length;
      const parkForReplan = authorityAudit.authority_kind === "review" && reviewAuthorityReworks >= 1;
      if (!parkForReplan) {
        record.artifact_state = "active";
        record.intent_ref.path = `docs/plans/${record.task_id}.intent.json`;
      }
      const findingIds = new Set(record.findings.map((item) => item.id));
      for (const finding of action.findings) {
        if (findingIds.has(finding.id))
          throw new KernelInvariantError([
            `findings contains duplicate id ${finding.id}`
          ]);
        findingIds.add(finding.id);
        record.findings.push({
          ...finding,
          status: "open",
          source: "review",
          review_round: round
        });
      }
      if (parkForReplan && !record.findings.some((item) => item.status === "open" && item.kind === "replan_required")) {
        const disputed = action.findings.find((item) => item.kind === "blocking") ?? action.findings[0];
        const boundary = {
          id: `${action.event_id}:replan-required`,
          kind: "replan_required",
          status: "open",
          acceptance_id: disputed.acceptance_id,
          source: "kernel",
          review_round: round,
          summary: "Review returned this acceptance boundary twice; a durable replan is required."
        };
        if (findingIds.has(boundary.id))
          throw new KernelInvariantError([
            `findings contains duplicate id ${boundary.id}`
          ]);
        record.findings.push(boundary);
      }
      appendHistory(record, action, from, `review_round_${round}`, authorityAudit);
      break;
    }
    case "complete": {
      if (record.lifecycle !== "active" || record.artifact_state !== "frozen")
        throw new KernelInvariantError([
          `cannot complete while state is ${stateOf(record)}`
        ]);
      if (!Array.isArray(changedPaths))
        throw new KernelInvariantError(["complete requires trusted changed paths"]);
      const decision = completionDecision(record.intent_snapshot, record, diffHash, record.intent_ref.content_hash, changedPaths);
      if (!decision.complete)
        throw new KernelInvariantError([
          "task is not eligible for completion"
        ]);
      transitionLifecycle(record, "done");
      appendHistory(record, action, from, null, authorityAudit);
      break;
    }
    case "stop": {
      if (!action.reason.trim())
        throw new KernelInvariantError(["stop requires a reason"]);
      transitionLifecycle(record, "stopped");
      record.artifact_state = "frozen";
      record.intent_ref.path = `docs/plans/archive/${record.task_id}.intent.json`;
      appendHistory(record, action, from, action.reason, authorityAudit);
      break;
    }
    case "resolve_user_decision": {
      if (record.lifecycle !== "active")
        throw new KernelInvariantError([
          `cannot resolve user decisions while lifecycle is ${record.lifecycle}`
        ]);
      if (!action.resolution.trim())
        throw new KernelInvariantError([
          "resolve_user_decision requires a resolution"
        ]);
      const finding = record.findings.find((item) => item.id === action.finding_id);
      if (!finding)
        throw new KernelInvariantError([
          `finding ${action.finding_id} does not exist`
        ]);
      if (finding.kind !== "unresolved_user_decision")
        throw new KernelInvariantError([
          `finding ${action.finding_id} is not a user decision`
        ]);
      if (finding.status === "resolved")
        throw new KernelInvariantError([
          `finding ${action.finding_id} is already resolved`
        ]);
      finding.status = "resolved";
      appendHistory(record, action, from, `${action.finding_id}: ${action.resolution}`, authorityAudit);
      break;
    }
    default: {
      const unreachable = action;
      throw new KernelInvariantError([
        `unsupported task action: ${String(unreachable.type)}`
      ]);
    }
  }
  assertTaskRecordUpdateV3(previous, record, action);
  return brandResult(record, nextWorkingFor(record));
}
function nextWorkingFor(record) {
  return record.lifecycle === "active" ? record.task_id : null;
}
function brandResult(record, nextWorking) {
  const target = {};
  Object.defineProperty(target, REDUCED_MUTATION_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false
  });
  Object.defineProperty(target, "record", {
    value: record,
    enumerable: true,
    writable: false
  });
  Object.defineProperty(target, "next_workspace_working", {
    value: nextWorking,
    enumerable: true,
    writable: false
  });
  return Object.freeze(target);
}
function isReducedMutation(value) {
  return !!value && typeof value === "object" && value[REDUCED_MUTATION_BRAND] === true;
}

// plugins/immune-brain/runtime/kernel/application.ts
function applyTaskAction(input) {
  const { root, task_id, prior_intent_token, registry, capability, diffProvider, now } = input;
  return withKernelStoreLock(root, () => {
    const current = readTaskRecordRaw(root, task_id);
    if (!current.record)
      throw new KernelInvariantError([
        `task ${task_id} has no TaskRecord v3`
      ]);
    const workspace = readWorkspaceStateRaw(root);
    const action = parseTaskAction(input.action);
    const trustedDiff = asTaskDiffSnapshot(diffProvider(root, current.record));
    if (trustedDiff.diff_hash !== action.diff_hash)
      throw new KernelInvariantError([
        `action diff_hash ${action.diff_hash} does not match the trusted diff ${trustedDiff.diff_hash}`
      ]);
    const freshRead = readTaskIntent(root, task_id, current.record.intent_ref.path);
    const { prior: priorIdentity, current: currentIdentity } = inspectIntentTokenPair(prior_intent_token, freshRead.token);
    if (priorIdentity.sidecar_path !== freshRead.intent_ref.path || currentIdentity.sidecar_path !== freshRead.intent_ref.path)
      throw new KernelInvariantError([
        "intent token sidecar path mismatch"
      ]);
    if (priorIdentity.path_dev !== currentIdentity.path_dev || priorIdentity.path_ino !== currentIdentity.path_ino || priorIdentity.fd_dev !== currentIdentity.fd_dev || priorIdentity.fd_ino !== currentIdentity.fd_ino)
      throw new KernelInvariantError([
        "intent sidecar identity changed between reads"
      ]);
    const isRevisionAction = action.type === "revise_intent" || action.type === "approve_breaking_intent_revision";
    if (isRevisionAction) {
      if (priorIdentity.intent_content_hash !== current.record.intent_ref.content_hash)
        throw new KernelInvariantError([
          "prior intent token does not match the committed record intent"
        ]);
      if (freshRead.content_hash !== canonicalIntentHash(action.next_intent) || action.next_intent_ref.content_hash !== freshRead.content_hash || action.next_intent.revision !== freshRead.intent.revision)
        throw new KernelInvariantError([
          "fresh intent token does not match the requested next intent"
        ]);
    } else {
      if (priorIdentity.intent_content_hash !== current.record.intent_ref.content_hash || currentIdentity.intent_content_hash !== current.record.intent_ref.content_hash)
        throw new KernelInvariantError([
          "intent token does not match the committed record intent"
        ]);
    }
    const privileged = action.type === "record_approval" || action.type === "approve_breaking_intent_revision" || action.type === "request_rework" || action.type === "stop" || action.type === "resolve_user_decision";
    const expectedAuthority = privileged ? {
      task_id,
      action,
      expected_record_hash: current.revision,
      intent_revision: isRevisionAction ? action.next_intent.revision : current.record.intent_snapshot.revision,
      intent_content_hash: isRevisionAction ? freshRead.content_hash : current.record.intent_ref.content_hash,
      diff_hash: trustedDiff.diff_hash,
      ...action.type === "request_rework" ? { findings_digest: findingsDigestV2(action.findings) } : {}
    } : null;
    const inspectedAudit = expectedAuthority ? registry.inspect(capability, expectedAuthority, now) : null;
    const mutation = reduceTask(current.record, action, inspectedAudit ? inspectedAudit.audit : null, trustedDiff.changed_paths);
    if (!isReducedMutation(mutation))
      throw new KernelInvariantError(["reducer returned an invalid mutation"]);
    if (canonicalRecordHash(mutation.record) === current.revision)
      return {
        revision: current.revision,
        record: current.record,
        workspace
      };
    if (action.expected_record_hash !== current.revision)
      throw new KernelInvariantError([
        `expected record hash mismatch: ${action.expected_record_hash} != ${current.revision}`
      ]);
    if (action.expected_workspace_hash !== workspace.revision)
      throw new KernelInvariantError([
        `expected workspace hash mismatch: ${action.expected_workspace_hash} != ${workspace.revision}`
      ]);
    if (workspace.state.current_working !== null && workspace.state.current_working !== task_id)
      throw new KernelInvariantError([
        `workspace is already owned by ${workspace.state.current_working}`
      ]);
    consumeIntentToken(prior_intent_token);
    consumeIntentToken(freshRead.token);
    let consumedAudit = null;
    if (expectedAuthority) {
      consumedAudit = registry.consume(capability, expectedAuthority, now);
    }
    const nextWorking = mutation.next_workspace_working;
    const nextRecord = input.artifact_transition ? {
      ...mutation.record,
      intent_ref: {
        ...mutation.record.intent_ref,
        path: input.artifact_transition.next_intent_path
      },
      artifact_state: input.artifact_transition.next_artifact_state
    } : mutation.record;
    let nextWorkspaceState = workspace.state;
    if (nextWorking !== null) {
      nextWorkspaceState = {
        ...workspace.state,
        current_working: task_id
      };
    } else if (workspace.state.current_working === task_id) {
      nextWorkspaceState = {
        ...workspace.state,
        current_working: null
      };
    }
    if (input.terminal) {
      const tombstone = {
        contract: TASK_TOMBSTONE_CONTRACT,
        task_id,
        lifecycle_status: "terminal",
        terminal_lifecycle: nextRecord.lifecycle,
        terminal_event_id: action.event_id,
        final_record_hash: canonicalRecordHash(nextRecord),
        terminalized_at: input.terminal.terminalized_at
      };
      const transaction = {
        contract: "assurance_kernel/workspace_transaction/v2",
        task_id,
        expected_record_hash: current.revision,
        next_record_content: `${JSON.stringify(nextRecord, null, 2)}
`,
        expected_workspace_hash: workspace.revision,
        next_workspace_content: serializeWorkspace(nextWorkspaceState),
        ...input.artifact_transition ? { artifact_relocations: input.artifact_transition.relocations } : {}
      };
      commitTerminalLocked(root, task_id, transaction, tombstone);
      return {
        revision: canonicalRecordHash(nextRecord),
        record: nextRecord,
        workspace: {
          revision: revisionForContent(serializeWorkspace(nextWorkspaceState)),
          state: nextWorkspaceState
        }
      };
    }
    return commitTaskRecordLocked(root, task_id, current.revision, nextRecord, workspace.revision, nextWorkspaceState, input.artifact_transition?.relocations);
  });
}

// plugins/immune-brain/runtime/kernel/canary_application.ts
function beginDrainCapabilityAction(taskId, at) {
  return {
    type: "stop",
    event_id: `begin_drain:${taskId}:${at}`,
    at,
    actor_id: "user",
    expected_record_hash: "",
    expected_workspace_hash: "",
    diff_hash: "",
    reason: "begin_drain"
  };
}
function capabilityActionFor(input) {
  if (input.op === "begin-drain") {
    return beginDrainCapabilityAction(input.task_id, input.at);
  }
  const base = {
    type: input.op,
    event_id: `${input.op}:${input.task_id}:${input.at}`,
    at: input.at,
    actor_id: input.actor_id,
    expected_record_hash: "sha256:" + "0".repeat(64),
    expected_workspace_hash: "sha256:" + "0".repeat(64),
    diff_hash: "sha256:" + "0".repeat(64)
  };
  switch (input.op) {
    case "record_approval":
      return { ...base, approval: input.approval };
    case "request_rework":
      return { ...base, findings: input.findings };
    case "stop":
      return { ...base, reason: input.reason };
    case "approve_breaking_intent_revision":
      return {
        ...base,
        next_intent: input.next_intent,
        next_intent_ref: input.next_intent_ref
      };
    case "resolve_user_decision":
      return {
        ...base,
        finding_id: input.finding_id,
        resolution: input.resolution
      };
    default:
      throw new KernelInvariantError([
        `unsupported capability action: ${input.op}`
      ]);
  }
}
function archivePath(path) {
  const matched = path.match(/^docs\/(plans|specs)\/([^/]+)$/);
  if (!matched)
    throw new KernelInvariantError([`artifact path is not active: ${path}`]);
  return `docs/${matched[1]}/archive/${matched[2]}`;
}
function boundSpecPath(intent) {
  const candidates = intent.scope_hint.filter((path) => /^docs\/specs\/(?!archive\/)[^/]+\.spec\.md$/.test(path) && intent.scope_hint.includes(archivePath(path)));
  if (candidates.length > 1)
    throw new KernelInvariantError([`artifact transition requires at most one scope-bound Spec; found ${candidates.length}`]);
  return candidates[0];
}
function readBoundActiveSpec(root, intent, required = true) {
  const specPath = boundSpecPath(intent);
  if (!specPath) {
    if (required)
      throw new KernelInvariantError(["artifact freeze requires one scope-bound active Spec"]);
    return;
  }
  try {
    return { path: specPath, content: readSecureProjectFile(root, specPath) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("source_missing:") && !required)
      return;
    throw error;
  }
}
function transitionFor(root, record, direction, allowIntentOnly = false) {
  const activeIntent = `docs/plans/${record.intent_snapshot.task_id}.intent.json`;
  const frozenIntent = archivePath(activeIntent);
  if (direction === "freeze") {
    if (record.intent_ref.path !== activeIntent)
      throw new KernelInvariantError(["artifact freeze requires the active intent path"]);
    const spec = readBoundActiveSpec(root, record.intent_snapshot, !allowIntentOnly);
    const intentContent = readSecureProjectFile(root, activeIntent);
    return {
      relocations: [
        { from_path: activeIntent, to_path: frozenIntent, content_hash: revisionForContent(intentContent) },
        ...spec ? [{ from_path: spec.path, to_path: archivePath(spec.path), content_hash: revisionForContent(spec.content) }] : []
      ],
      next_intent_path: frozenIntent,
      next_artifact_state: "frozen"
    };
  }
  if (record.intent_ref.path !== frozenIntent || record.artifact_state !== "frozen")
    throw new KernelInvariantError(["artifact restore requires a frozen TaskRecord"]);
  const specPath = boundSpecPath(record.intent_snapshot);
  return {
    relocations: [
      { from_path: frozenIntent, to_path: activeIntent, content_hash: revisionForContent(readSecureProjectFile(root, frozenIntent)) },
      ...specPath ? [{ from_path: archivePath(specPath), to_path: specPath, content_hash: revisionForContent(readSecureProjectFile(root, archivePath(specPath))) }] : []
    ],
    next_intent_path: activeIntent,
    next_artifact_state: "active"
  };
}
function createCanaryApplication(registry) {
  function freezeArtifacts(input) {
    return withKernelStoreLock(input.root, () => {
      const current = readTaskRecordRaw(input.root, input.task_id);
      if (!current.record)
        throw new KernelInvariantError([`task ${input.task_id} has no TaskRecord v3`]);
      const workspace = readWorkspaceStateRaw(input.root);
      if (current.record.artifact_state === "frozen")
        return { revision: current.revision, record: current.record, workspace };
      if (current.record.lifecycle !== "active")
        throw new KernelInvariantError([`artifact freeze requires active lifecycle, got ${current.record.lifecycle}`]);
      if (workspace.state.current_working !== input.task_id)
        throw new KernelInvariantError([`workspace is not owned by task ${input.task_id}`]);
      const fresh = readTaskIntent(input.root, input.task_id, current.record.intent_ref.path);
      const pair = inspectIntentTokenPair(input.prior_intent_token, fresh.token);
      if (pair.prior.intent_content_hash !== current.record.intent_ref.content_hash || pair.current.intent_content_hash !== current.record.intent_ref.content_hash || pair.prior.sidecar_path !== current.record.intent_ref.path || pair.current.sidecar_path !== current.record.intent_ref.path || pair.prior.path_dev !== pair.current.path_dev || pair.prior.path_ino !== pair.current.path_ino || pair.prior.fd_dev !== pair.current.fd_dev || pair.prior.fd_ino !== pair.current.fd_ino)
        throw new KernelInvariantError(["intent token does not bind the active freeze artifact"]);
      const transition = transitionFor(input.root, current.record, "freeze");
      consumeIntentToken(input.prior_intent_token);
      consumeIntentToken(fresh.token);
      const at = input.now ?? new Date().toISOString();
      const nextRecord = parseTaskRecord({
        ...current.record,
        intent_ref: { ...current.record.intent_ref, path: transition.next_intent_path },
        artifact_state: transition.next_artifact_state,
        history: [
          ...current.record.history,
          {
            id: `freeze_artifacts:${input.task_id}:${at}`,
            at,
            type: "freeze_artifacts",
            from_state: "active:active",
            to_state: "active:frozen",
            reason: `TaskIntent and Spec frozen at ${transition.next_intent_path}`
          }
        ]
      });
      return commitTaskRecordLocked(input.root, input.task_id, current.revision, nextRecord, workspace.revision, workspace.state, transition.relocations);
    });
  }
  function execute(input) {
    if (input.operation.op === "freeze_artifacts")
      return freezeArtifacts(input);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.task_id))
      throw new KernelInvariantError(["task id is not a safe file identity"]);
    const now = input.now ?? new Date().toISOString();
    const operation = input.operation;
    const at = now;
    const snapshot = withKernelStoreLock(input.root, () => {
      const current = readTaskRecordRaw(input.root, input.task_id);
      if (!current.record)
        throw new KernelInvariantError([
          `task ${input.task_id} has no TaskRecord v2`
        ]);
      const workspace = readWorkspaceStateRaw(input.root);
      return {
        record_revision: current.revision,
        workspace_revision: workspace.revision,
        intent_revision: current.record.intent_snapshot.revision,
        intent_content_hash: current.record.intent_ref.content_hash,
        intent_snapshot: current.record.intent_snapshot,
        record: current.record
      };
    });
    const diffHash = asTaskDiffSnapshot(input.diffProvider(input.root, snapshot.record)).diff_hash;
    if (operation.op === "stop" && !("capability" in operation))
      throw new KernelInvariantError(["stop requires user authority capability"]);
    const hasBoundSpec = snapshot.intent_snapshot.scope_hint.some((path) => /^docs\/specs\/(?!archive\/)[^/]+\.spec\.md$/.test(path) && snapshot.intent_snapshot.scope_hint.includes(archivePath(path)));
    if (operation.op === "complete" && hasBoundSpec && snapshot.record.artifact_state !== "frozen")
      throw new KernelInvariantError(["complete requires frozen planning artifacts"]);
    const artifactTransition = snapshot.record.artifact_state === "frozen" && (operation.op === "request_rework" || operation.op === "approve_breaking_intent_revision") ? transitionFor(input.root, snapshot.record, "restore") : operation.op === "stop" && snapshot.record.artifact_state !== "frozen" ? transitionFor(input.root, snapshot.record, "freeze", true) : undefined;
    const event_id = `${operation.op}:${input.task_id}:${at}`;
    const base = {
      event_id,
      at,
      actor_id: operation.actor_id,
      expected_record_hash: snapshot.record_revision,
      expected_workspace_hash: snapshot.workspace_revision,
      diff_hash: diffHash
    };
    let action;
    let capability;
    switch (operation.op) {
      case "record_finding":
        action = {
          ...base,
          type: "record_finding",
          finding: {
            ...operation.finding,
            status: "open",
            source: operation.finding.kind === "unresolved_user_decision" ? "kernel" : "execution",
            review_round: null
          }
        };
        break;
      case "resolve_finding":
        action = { ...base, type: "resolve_finding", finding_id: operation.finding_id };
        break;
      case "request_rework":
        capability = operation.capability;
        action = { ...base, type: "request_rework", findings: operation.findings };
        break;
      case "record_approval":
        capability = operation.capability;
        action = { ...base, type: "record_approval", approval: operation.approval };
        break;
      case "revise_intent":
        action = {
          ...base,
          type: "revise_intent",
          next_intent: operation.next_intent,
          next_intent_ref: {
            path: `docs/plans/${operation.next_intent.task_id}.intent.json`,
            content_hash: canonicalIntentHash(operation.next_intent)
          }
        };
        break;
      case "approve_breaking_intent_revision":
        capability = operation.capability;
        action = {
          ...base,
          type: "approve_breaking_intent_revision",
          next_intent: operation.next_intent,
          next_intent_ref: {
            path: `docs/plans/${operation.next_intent.task_id}.intent.json`,
            content_hash: canonicalIntentHash(operation.next_intent)
          }
        };
        break;
      case "complete":
        action = { ...base, type: "complete" };
        break;
      case "stop":
        capability = operation.capability;
        action = { ...base, type: "stop", reason: operation.reason };
        break;
      case "resolve_user_decision":
        capability = operation.capability;
        action = {
          ...base,
          type: "resolve_user_decision",
          finding_id: operation.finding_id,
          resolution: operation.resolution
        };
        break;
      default: {
        const unreachable = operation;
        throw new KernelInvariantError([
          `unsupported canary operation: ${String(unreachable.op)}`
        ]);
      }
    }
    return applyTaskAction({
      root: input.root,
      task_id: input.task_id,
      action,
      prior_intent_token: input.prior_intent_token,
      registry,
      capability,
      diffProvider: input.diffProvider,
      now: Date.parse(now),
      ...operation.op === "complete" || operation.op === "stop" ? { terminal: { terminalized_at: now } } : {},
      ...artifactTransition ? { artifact_transition: artifactTransition } : {}
    });
  }
  function beginDrain(input) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.task_id))
      throw new KernelInvariantError(["task id is not a safe file identity"]);
    const now = input.now ?? new Date().toISOString();
    return withKernelStoreLock(input.root, () => {
      const current = readTaskRecordRaw(input.root, input.task_id);
      if (!current.record)
        throw new KernelInvariantError([
          `task ${input.task_id} has no TaskRecord v2`
        ]);
      const workspace = readWorkspaceStateRaw(input.root);
      const claim = readBackendClaim(input.root);
      if (!claim)
        throw new KernelInvariantError([
          `task ${input.task_id} has no active backend claim`
        ]);
      if (claim.task_id !== input.task_id)
        throw new KernelInvariantError([
          `backend claim belongs to task ${claim.task_id}, not ${input.task_id}`
        ]);
      if (claim.lifecycle_status === "draining") {
        return claim;
      }
      if (claim.lifecycle_status !== "active")
        throw new KernelInvariantError([
          `backend claim is not active for task ${input.task_id}`
        ]);
      if (current.record.lifecycle !== "active")
        throw new KernelInvariantError([
          `task ${input.task_id} is already terminal; drain is not permitted`
        ]);
      if (workspace.state.current_working !== input.task_id)
        throw new KernelInvariantError([
          `workspace is not owned by task ${input.task_id}`
        ]);
      registry.consume(input.capability, {
        task_id: input.task_id,
        action: beginDrainCapabilityAction(input.task_id, now),
        expected_record_hash: current.revision,
        intent_revision: current.record.intent_snapshot.revision,
        intent_content_hash: current.record.intent_ref.content_hash,
        diff_hash: "sha256:" + "0".repeat(64)
      }, Date.parse(now));
      const nextClaim = {
        ...claim,
        lifecycle_status: "draining",
        updated_at: now
      };
      return commitDrainLocked(input.root, input.task_id, serializeBackendClaim(claim), serializeBackendClaim(nextClaim), now);
    });
  }
  return { registry, execute, beginDrain };
}

// plugins/immune-brain/runtime/kernel/authority_port.ts
import { createHash as createHash11 } from "node:crypto";

// plugins/immune-brain/runtime/kernel/capability_registry.ts
function createCapabilityRegistry(capabilityBrand, hooks, domainLabel) {
  const states = new WeakMap;
  const brand = Symbol(`${domainLabel}-registry`);
  function isCapability(value) {
    return !!value && typeof value === "object" && value[capabilityBrand] === true && value[brand] === true;
  }
  function stateOf2(capability) {
    const state = states.get(capability);
    if (!state)
      throw new Error(`${domainLabel} capability is not recognized by this registry`);
    return state;
  }
  return {
    brand,
    issue(binding, issuedAt = new Date().toISOString()) {
      hooks.validateBinding(binding, issuedAt);
      const capability = Object.freeze(Object.defineProperties({}, {
        [capabilityBrand]: { value: true, enumerable: false, writable: false, configurable: false },
        [brand]: { value: true, enumerable: false, writable: false, configurable: false }
      }));
      states.set(capability, { binding: { ...binding }, issued_at: issuedAt, consumed: false });
      return capability;
    },
    inspect(capability, expected, now = Date.now()) {
      if (!isCapability(capability))
        throw new Error(`${domainLabel} capability is not recognized by this registry`);
      const state = stateOf2(capability);
      if (state.consumed)
        throw new Error(`${domainLabel} capability already consumed`);
      return hooks.validateAndProject({ ...state.binding, issued_at: state.issued_at }, expected, now);
    },
    consume(capability, expected, now = Date.now()) {
      const validated = this.inspect(capability, expected, now);
      stateOf2(capability).consumed = true;
      return validated;
    },
    isConsumed(capability) {
      return stateOf2(capability).consumed;
    }
  };
}

// plugins/immune-brain/runtime/kernel/authority_port.ts
function digestOfAction(action) {
  const { expected_record_hash: _r, expected_workspace_hash: _w, diff_hash: _d, ...rest } = action;
  return createHash11("sha256").update(JSON.stringify(rest)).digest("hex");
}
function createMutationAuthorityRegistry() {
  const inner = createCapabilityRegistry(MUTATION_AUTHORITY_CAPABILITY_BRAND, {
    validateBinding(binding, issuedAt) {
      const missing = [];
      for (const [key, value] of Object.entries(binding)) {
        if (key === "findings_digest")
          continue;
        if (value === undefined || value === null || value === "")
          missing.push(key);
      }
      if (missing.length > 0)
        throw new Error(`authority capability binding is incomplete: ${missing.join(", ")}`);
      if (binding.findings_digest !== null && !/^sha256:[a-f0-9]{64}$/.test(binding.findings_digest))
        throw new Error("authority capability findings_digest must be a canonical sha256 hash");
      if (Number.isNaN(Date.parse(binding.expires_at)) || Date.parse(binding.expires_at) <= Date.parse(issuedAt))
        throw new Error("authority capability must have a future expiry");
    },
    validateAndProject(state, expected, now) {
      if (Date.parse(state.expires_at) <= now)
        throw new Error("authority capability has expired");
      const actionDigest = digestOfAction(expected.action);
      if (state.action_digest !== actionDigest)
        throw new Error("authority capability action digest mismatch");
      if (state.task_id !== expected.task_id)
        throw new Error("authority capability task mismatch");
      if (state.expected_record_hash !== expected.expected_record_hash)
        throw new Error("authority capability record hash mismatch");
      if (state.intent_revision !== expected.intent_revision)
        throw new Error("authority capability intent revision mismatch");
      if (state.intent_content_hash !== expected.intent_content_hash)
        throw new Error("authority capability intent hash mismatch");
      if (state.diff_hash !== expected.diff_hash)
        throw new Error("authority capability diff hash mismatch");
      if (expected.findings_digest !== undefined) {
        if (state.findings_digest === null)
          throw new Error("authority capability is not bound to findings");
        if (state.findings_digest !== expected.findings_digest)
          throw new Error("authority capability findings digest mismatch");
      }
      return {
        audit: {
          authority_kind: state.authority_kind,
          actor_id: state.actor_id,
          confirmation_ref: state.confirmation_ref,
          issued_at: state.issued_at,
          expires_at: state.expires_at
        },
        action_digest: actionDigest,
        expected_record_hash: state.expected_record_hash,
        intent_revision: state.intent_revision,
        intent_content_hash: state.intent_content_hash,
        diff_hash: state.diff_hash,
        task_id: state.task_id
      };
    }
  }, "authority");
  return {
    brand: inner.brand,
    issue: inner.issue.bind(inner),
    inspect(capability, expected, now = Date.now()) {
      if (!capability)
        throw new Error("privileged action requires an opaque authority capability");
      try {
        return inner.inspect(capability, expected, now);
      } catch (err) {
        if (err instanceof Error && err.message.includes("not recognized by this registry"))
          throw new Error("privileged action requires an opaque authority capability");
        throw err;
      }
    },
    consume(capability, expected, now = Date.now()) {
      try {
        return inner.consume(capability, expected, now);
      } catch (err) {
        if (err instanceof Error && err.message.includes("not recognized by this registry"))
          throw new Error("privileged action requires an opaque authority capability");
        throw err;
      }
    },
    isConsumed: inner.isConsumed.bind(inner)
  };
}

// plugins/immune-brain/runtime/kernel/enrollment_authority.ts
var ENROLLMENT_CAPABILITY_BRAND = Symbol.for("assurance-kernel.enrollment-capability-brand");
function createEnrollmentAuthorityRegistry() {
  return createCapabilityRegistry(ENROLLMENT_CAPABILITY_BRAND, {
    validateBinding(binding, issuedAt) {
      const missing = [];
      for (const [key, value] of Object.entries(binding)) {
        if (value === undefined || value === null || value === "")
          missing.push(key);
      }
      if (missing.length > 0)
        throw new Error(`enrollment capability binding is incomplete: ${missing.join(", ")}`);
      if (Number.isNaN(Date.parse(binding.expires_at)) || Date.parse(binding.expires_at) <= Date.parse(issuedAt))
        throw new Error("enrollment capability must have a future expiry");
    },
    validateAndProject(state, expected, now) {
      if (Date.parse(state.expires_at) <= now)
        throw new Error("enrollment capability has expired");
      for (const key of Object.keys(expected)) {
        if (state[key] !== expected[key])
          throw new Error(`enrollment capability ${key} mismatch`);
      }
      return {
        task_id: state.task_id,
        intent_path: state.intent_path,
        intent_revision: state.intent_revision,
        intent_content_hash: state.intent_content_hash,
        preparation_digest: state.preparation_digest,
        actor_id: state.actor_id,
        confirmation_ref: state.confirmation_ref,
        issued_at: state.issued_at,
        expires_at: state.expires_at,
        nonce: state.nonce
      };
    }
  }, "enrollment");
}

// plugins/immune-brain/runtime/kernel/pi_canary_prepare.ts
import { createHash as createHash12 } from "node:crypto";
import { spawnSync as spawnSync2 } from "node:child_process";
import { resolve as resolve6 } from "node:path";
var SOURCE_PATH = ".imm/state/workspace.json";
var GIT_OBJECT_ID4 = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function readGitHead(root) {
  const result = spawnSync2("git", ["-C", root, "rev-parse", "--verify", "HEAD^{commit}"], {
    encoding: "utf8"
  });
  const head = typeof result.stdout === "string" ? result.stdout.trim() : "";
  if (result.status !== 0 || !GIT_OBJECT_ID4.test(head))
    throw new Error("enrollment requires a committed Git HEAD in the project root");
  return head.toLowerCase();
}
function sha256Hex2(bytes) {
  return createHash12("sha256").update(bytes).digest("hex");
}
function stableStringify2(value) {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((entry) => stableStringify2(entry)).join(",")}]`;
  const record = value;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify2(record[key])}`).join(",")}}`;
}
function preparePiCanary(root, input) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.task_id))
    throw new Error("task id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}");
  const canonicalRoot2 = resolve6(root);
  const statePath = resolve6(canonicalRoot2, SOURCE_PATH);
  let intent = null;
  try {
    const read = readTaskIntent(canonicalRoot2, input.task_id);
    intent = {
      path: read.intent_ref.path,
      revision: read.intent_ref.revision,
      content_hash: read.content_hash
    };
  } catch {
    intent = null;
  }
  const claim = readBackendClaim(canonicalRoot2);
  const backend = claim ? {
    present: true,
    task_id: claim.task_id,
    lifecycle_status: claim.lifecycle_status
  } : { present: false, task_id: null, lifecycle_status: null };
  if (claim && claim.task_id !== input.task_id)
    throw new Error(`backend claim belongs to task ${claim.task_id}, not ${input.task_id}`);
  const tombstone = readTaskTombstone(canonicalRoot2, input.task_id);
  const taskTombstone = tombstone ? {
    present: true,
    terminal_lifecycle: tombstone.terminal_lifecycle
  } : { present: false, terminal_lifecycle: null };
  if (tombstone && claim)
    throw new Error(`task ${input.task_id} has both an active backend claim and a terminal tombstone`);
  const current = readTaskRecordRaw(canonicalRoot2, input.task_id);
  const record = current.record ? { present: true, lifecycle: current.record.lifecycle, artifact_state: current.record.artifact_state } : { present: false, lifecycle: null, artifact_state: null };
  if (claim && !current.record)
    throw new Error(`backend claim exists for task ${input.task_id} but its TaskRecord v3 is absent`);
  if (claim && !intent)
    throw new Error(`backend claim exists for task ${input.task_id} but its intent sidecar is unreadable`);
  if (current.record && current.record.task_id !== input.task_id)
    throw new Error(`task record identity is inconsistent for ${input.task_id}`);
  const state = readWorkspaceStateRaw(canonicalRoot2);
  const workspace = {
    current_working: state.state.current_working
  };
  if (claim && state.state.current_working !== claim.task_id)
    throw new Error(`workspace owner ${state.state.current_working} contradicts backend claim task ${claim.task_id}`);
  let gitBaseHead = null;
  let gitError = null;
  try {
    gitBaseHead = readGitHead(canonicalRoot2);
  } catch (error) {
    gitError = error instanceof Error ? error.message : String(error);
  }
  const preparation = {
    contract: "assurance_kernel/pi_canary_preparation/v1",
    task_id: input.task_id,
    generated_at: input.now,
    root_state_path: statePath,
    intent,
    backend_claim: backend,
    task_tombstone: taskTombstone,
    task_record_v3: record,
    git_base_head: gitBaseHead,
    git_error: gitError,
    workspace,
    digest: ""
  };
  preparation.digest = `sha256:${sha256Hex2(stableStringify2(preparation))}`;
  return preparation;
}
function revalidatePiCanary(root, input, previous) {
  const current = preparePiCanary(root, input);
  return { unchanged: current.digest === previous.digest, current };
}

// plugins/immune-brain/runtime/kernel/enrollment.ts
function runEnrollmentPreconditionChecks(root, input, capability, registry, mode, beforeLock, onReady) {
  const blockers = [];
  let validated = null;
  try {
    validated = registry.inspect(capability, input.capability_binding);
    if (mode === "fail_fast" && validated.task_id !== input.task_id)
      throw new Error("enrollment capability task mismatch");
  } catch (error) {
    if (mode === "fail_fast")
      throw error;
    blockers.push(`capability: ${error instanceof Error ? error.message : String(error)}`);
  }
  beforeLock(validated);
  return withKernelStoreLock(root, () => {
    let current = null;
    let workspace = null;
    let intent = null;
    let gitBaseHead = null;
    const fail = (report, error) => {
      if (mode === "fail_fast")
        throw error instanceof Error ? error : new Error(String(error));
      blockers.push(report);
    };
    const tombstone = readTaskTombstone(root, input.task_id);
    if (tombstone) {
      fail("task tombstone exists; same-task re-enrollment is forbidden", new Error(`task ${input.task_id} is terminal; same-task re-enrollment is forbidden`));
    } else {
      current = readTaskRecordRaw(root, input.task_id);
      if (current.record)
        fail("task record already exists", new Error(`task ${input.task_id} already has a TaskRecord`));
    }
    workspace = readWorkspaceStateRaw(root);
    if (workspace.state.current_working !== null)
      fail(`workspace already owned by ${workspace.state.current_working}`, new Error(`workspace is already owned by ${workspace.state.current_working}`));
    try {
      intent = readTaskIntent(root, input.task_id);
    } catch (error) {
      fail(`intent: ${error instanceof Error ? error.message : String(error)}`, error);
    }
    try {
      gitBaseHead = readGitHead(root);
    } catch (error) {
      fail(`git base: ${error instanceof Error ? error.message : String(error)}`, error);
    }
    const state = {
      validated,
      current,
      workspace,
      intent,
      gitBaseHead
    };
    return onReady ? onReady(state) : { ...state, blockers };
  });
}
function buildTaskRecordV4(input, intent, gitBaseHead) {
  return {
    contract: "assurance_kernel/task_record/v4",
    task_id: input.task_id,
    intent_snapshot: intent.intent,
    intent_ref: {
      path: input.intent_path,
      content_hash: intent.content_hash
    },
    lifecycle: "active",
    artifact_state: "active",
    baseline: intent.content_hash,
    git_base_head: gitBaseHead,
    attestations: [],
    findings: [],
    history: []
  };
}
function runEnrollmentRehearsal(root, input, capability, registry) {
  const preconditions = runEnrollmentPreconditionChecks(root, input, capability, registry, "report", () => {
    return;
  });
  return {
    rehearsed: true,
    writes_performed: false,
    evidence: {
      contract: "assurance_kernel/enrollment_rehearsal/v1",
      task_id: input.task_id,
      outcome: preconditions.blockers.length === 0 ? "ready" : "not_ready",
      blockers: preconditions.blockers,
      generated_at: input.now
    }
  };
}
function enrollCanaryTask(root, input, registry) {
  let gitBaseHead = null;
  return runEnrollmentPreconditionChecks(root, input, input.capability, registry, "fail_fast", () => {
    const recomputed = preparePiCanary(root, { task_id: input.task_id, now: input.now });
    if (recomputed.digest !== input.preparation_digest)
      throw new Error("enrollment preparation digest mismatch");
    gitBaseHead = recomputed.git_base_head;
    if (!gitBaseHead)
      throw new Error(recomputed.git_error ?? "enrollment requires a committed Git HEAD");
  }, (checks) => {
    if (!checks.validated || !checks.intent || !checks.workspace || !checks.current)
      throw new Error("enrollment precondition state incomplete");
    if (checks.intent.intent.revision !== input.intent_revision)
      throw new Error("intent revision mismatch");
    if (checks.intent.content_hash !== checks.validated.intent_content_hash)
      throw new Error("intent content hash mismatch");
    if (checks.gitBaseHead !== gitBaseHead)
      throw new Error("Git HEAD moved after the enrollment confirmation");
    registry.consume(input.capability, input.capability_binding);
    const record = buildTaskRecordV4(input, checks.intent, gitBaseHead);
    const nextWorkspace = {
      ...checks.workspace.state,
      current_working: input.task_id
    };
    const claim = {
      contract: "assurance_kernel/backend_claim/v2",
      backend: "kernel",
      task_id: input.task_id,
      intent_revision: input.intent_revision,
      intent_content_hash: checks.intent.content_hash,
      enrollment_event_id: `enroll-${input.task_id}-${input.now}`,
      lifecycle_status: "active",
      created_at: input.now,
      updated_at: input.now
    };
    const mutation = commitEnrollmentLocked(root, input.task_id, {
      contract: "assurance_kernel/workspace_transaction/v2",
      task_id: input.task_id,
      expected_record_hash: checks.current.revision,
      next_record_content: `${JSON.stringify(record, null, 2)}
`,
      expected_workspace_hash: checks.workspace.revision,
      next_workspace_content: `${JSON.stringify(nextWorkspace, null, 2)}
`
    }, claim);
    return {
      record: mutation.record,
      backend_claim: claim,
      workspace: { revision: "", state: mutation.workspace }
    };
  });
}

// plugins/immune-brain/runtime/assurance/qa_findings.ts
import { randomUUID as randomUUID4 } from "node:crypto";
function qaFindingId(acceptanceId, snapshotDigest2) {
  return `qa-${acceptanceId}-${attemptRef(snapshotDigest2)}`;
}
function attemptRef(snapshotDigest2) {
  const digest8 = snapshotDigest2.slice("sha256:".length, "sha256:".length + 8);
  return `${digest8}-${randomUUID4().slice(0, 6)}`;
}

// plugins/immune-brain/runtime/claude/kernel_ports.ts
function diffSnapshotOf(root, record) {
  if (record.contract === "assurance_kernel/task_record/v4") {
    if (!record.git_base_head)
      throw new Error("TaskRecord v4 is missing git_base_head");
    return taskRevisionIdentity(root, record.intent_snapshot.scope_hint, record.git_base_head);
  }
  return taskDiffIdentity(root, record.intent_snapshot.scope_hint);
}
function diffHashOf(root, record) {
  return diffSnapshotOf(root, record).diff_hash;
}
function extractVerdictJson(input) {
  if (typeof input === "string") {
    const cleaned = input.split(`
`).map((line) => line.trim()).filter((line) => line.startsWith("{") && line.endsWith("}")).join("");
    if (!cleaned)
      return null;
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
  if (typeof input === "object" && input !== null && !Array.isArray(input))
    return input;
  return null;
}
function verdictFingerprint(raw) {
  return JSON.stringify({
    contract: raw.contract ?? null,
    role: raw.role ?? null,
    task_id: raw.task_id ?? null,
    snapshot_digest: raw.snapshot_digest ?? null,
    decision: raw.decision ?? null,
    approval: raw.approval ?? null,
    findings: raw.findings ?? null
  });
}
async function submitClaudeReview(host, coordinator, ctx, taskId, verdictInput) {
  if (verdictInput === undefined)
    throw new Error("verdict is required");
  const observed = host.inspectReviewForTask(taskId);
  if (!observed.ok) {
    if (observed.release)
      return coordinator.abandonReview(taskId, observed.reason);
    return { state: "blocked", reason: observed.reason };
  }
  const parentJson = extractVerdictJson(verdictInput);
  const receiptJson = extractVerdictJson(observed.receipt.result);
  if (parentJson && receiptJson && verdictFingerprint(parentJson) !== verdictFingerprint(receiptJson)) {
    return { state: "blocked", reason: "parent verdict does not match reviewer receipt" };
  }
  if (parentJson && !receiptJson) {
    return { state: "blocked", reason: "reviewer receipt is not a valid verdict" };
  }
  return coordinator.submitReview(taskId, ctx, verdictInput);
}
function assertProjectionBinding(before, after, allowDiffChange = false) {
  const fields = allowDiffChange ? ["record_revision", "workspace_revision", "intent_revision", "intent_content_hash"] : ["record_revision", "workspace_revision", "intent_revision", "intent_content_hash", "diff_hash"];
  if (before.error || !before.claim || after.error || !after.claim || before.claim.task_id !== after.claim.task_id || fields.some((field) => before.projection[field] !== after.projection[field])) {
    throw new Error("Task changed after native confirmation; authority aborted before capability issuance");
  }
}
async function runDeterministicQa(snapshot, descriptors, runner, options = {}) {
  if (snapshot.role !== "qa")
    throw new Error("deterministic QA requires qa role");
  if (options.signal?.aborted)
    throw new VerificationAbortedError;
  const findings = [];
  for (const [offset, item] of snapshot.acceptance.entries()) {
    if (options.signal?.aborted)
      throw new VerificationAbortedError;
    const descriptor = descriptors.get(item.id);
    if (!descriptor)
      throw new Error(`verification descriptor missing for ${item.id}`);
    const startedAt = Date.now();
    options.onProgress?.({ index: offset + 1, total: snapshot.acceptance.length, acceptance_id: item.id, phase: "running", elapsed_ms: 0 });
    const result = await runFixedVerification(snapshot.root, descriptor, runner, { signal: options.signal });
    const failed = result.exit_code !== 0 || result.timed_out;
    options.onProgress?.({ index: offset + 1, total: snapshot.acceptance.length, acceptance_id: item.id, phase: failed ? "failed" : "passed", elapsed_ms: Date.now() - startedAt });
    if (failed) {
      findings.push({
        id: qaFindingId(item.id, snapshotDigest(snapshot)),
        kind: "blocking",
        acceptance_id: item.id,
        summary: `verification failed (exit ${result.exit_code}${result.timed_out ? ", timed out" : ""})`,
        findings_digest: ""
      });
    }
  }
  if (findings.length > 0) {
    return { contract: "assurance_kernel/assurance_verdict/v2", role: "qa", task_id: snapshot.task_id, snapshot_digest: snapshotDigest(snapshot), decision: "rework", findings };
  }
  return {
    contract: "assurance_kernel/assurance_verdict/v2",
    role: "qa",
    task_id: snapshot.task_id,
    snapshot_digest: snapshotDigest(snapshot),
    decision: "pass",
    approval: { kind: "qa", authority_role: "qa", summary: `all ${snapshot.acceptance.length} fixed verification descriptor(s) passed` }
  };
}
function qaOutcomes(record) {
  return Object.fromEntries(record.attestations.filter((item) => item.kind === "qa").flatMap((item) => item.acceptance_results).map((result) => [result.acceptance_id, { status: result.status, summary: result.summary }]));
}
async function buildAssuranceSnapshot(root, taskId, role, projection, runner) {
  const record = await readTaskRecord(root, taskId);
  if (!record.record || record.revision !== projection.projection.record_revision)
    throw new Error("TaskRecord changed before assurance snapshot capture");
  const intent = record.record.intent_snapshot;
  const descriptors = new Map;
  for (const item of intent.acceptance) {
    const descriptor = parseVerificationDescriptor(item.verification);
    assertRunnerCompatible(descriptor, runner);
    descriptors.set(item.id, descriptor);
  }
  const v4 = record.record.contract === "assurance_kernel/task_record/v4";
  const reviewBundle = role === "review" && !v4 ? captureReviewBundle(root, intent.scope_hint, projection.projection.diff_hash, qaOutcomes(record.record)) : null;
  const reviewManifest = role === "review" && v4 ? captureReviewManifest(root, {
    taskId,
    baseHead: record.record.git_base_head,
    scopeHint: intent.scope_hint,
    expectedDiffHash: projection.projection.diff_hash,
    intentRevision: projection.projection.intent_revision,
    intentContentHash: projection.projection.intent_content_hash,
    recordRevision: projection.projection.record_revision,
    workspaceRevision: projection.projection.workspace_revision,
    lifecycle: projection.projection.lifecycle,
    artifactState: projection.projection.artifact_state,
    risk: intent.risk,
    outcomes: qaOutcomes(record.record)
  }) : null;
  const dirtyFiles = reviewManifest ? Object.keys(reviewManifest.changed_paths) : reviewBundle ? Object.keys(reviewBundle.dirty_files) : [];
  const snapshot = {
    contract: "assurance_kernel/assurance_snapshot/v2",
    task_id: taskId,
    role,
    record_revision: projection.projection.record_revision,
    workspace_revision: projection.projection.workspace_revision,
    intent_revision: projection.projection.intent_revision,
    intent_content_hash: projection.projection.intent_content_hash,
    diff_hash: projection.projection.diff_hash,
    lifecycle: projection.projection.lifecycle,
    artifact_state: projection.projection.artifact_state,
    risk: intent.risk,
    fresh_acceptance_ids: projection.projection.fresh_acceptance_ids,
    missing_acceptance_ids: projection.projection.missing_acceptance_ids,
    stale_attestation_ids: projection.projection.stale_attestation_ids,
    acceptance: intent.acceptance,
    dirty_files: dirtyFiles,
    review_bundle_digest: reviewManifest?.manifest_digest ?? reviewBundle?.bundle_digest ?? null,
    root,
    ...reviewManifest ? {
      review_revision: {
        contract: "assurance_kernel/review_revision_identity/v1",
        base_head: reviewManifest.base_head,
        review_commit: reviewManifest.review_commit,
        review_tree: reviewManifest.review_tree,
        manifest_digest: reviewManifest.manifest_digest
      }
    } : {}
  };
  return { snapshot, descriptors, reviewBundle, reviewManifest };
}
function stagePlanningArtifactTransition(root, record) {
  const intentActive = record.intent_ref.path.replace("docs/plans/archive/", "docs/plans/");
  const intentArchive = intentActive.replace("docs/plans/", "docs/plans/archive/");
  const specActive = record.intent_snapshot.scope_hint.find((path) => /^docs\/specs\/(?!archive\/)[^/]+\.spec\.md$/.test(path) && record.intent_snapshot.scope_hint.includes(path.replace("docs/specs/", "docs/specs/archive/")));
  const candidates = [
    intentActive,
    intentArchive,
    ...specActive ? [specActive, specActive.replace("docs/specs/", "docs/specs/archive/")] : []
  ];
  const paths = candidates.filter((path) => existsSync3(join7(root, path)) || execFileSync4("git", ["ls-files", "--cached", "--", path], { cwd: root, encoding: "utf8" }).trim().length > 0);
  if (paths.length === 0)
    return;
  execFileSync4("git", ["add", "--", ...paths], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}
async function mintCapability(registry, input) {
  const action = capabilityActionFor({
    op: input.action_kind,
    task_id: input.task_id,
    at: input.now,
    actor_id: input.actor_id,
    ...input.reason !== undefined ? { reason: input.reason } : {},
    ...input.findings !== undefined ? { findings: input.findings } : {},
    ...input.approval !== undefined ? { approval: input.approval } : {},
    ...input.next_intent !== undefined ? { next_intent: input.next_intent } : {},
    ...input.next_intent_ref !== undefined ? { next_intent_ref: input.next_intent_ref } : {},
    ...input.finding_id !== undefined ? { finding_id: input.finding_id } : {},
    ...input.resolution !== undefined ? { resolution: input.resolution } : {}
  });
  const binding = {
    authority_kind: input.authority_kind,
    task_id: input.task_id,
    action_digest: digestOfAction(action),
    expected_record_hash: input.expected_record_hash,
    intent_revision: input.intent_revision,
    intent_content_hash: input.intent_content_hash,
    diff_hash: input.diff_hash,
    actor_id: input.actor_id,
    confirmation_ref: input.confirmation_ref,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    findings_digest: input.action_kind === "request_rework" ? await findingsDigest(input.findings) : null
  };
  return registry.issue(binding);
}

class ClaudeRuntime {
  host;
  coordinator;
  cwd;
  env;
  interactive;
  permissionMode;
  decisions;
  hostVersion;
  mutationRegistry = null;
  enrollmentRegistry = createEnrollmentAuthorityRegistry();
  app = null;
  constructor(options) {
    this.cwd = options.cwd;
    this.env = options.env ?? process.env;
    this.interactive = options.interactive ?? true;
    this.permissionMode = options.permissionMode ?? "manual";
    this.decisions = options.decisions ?? new Map;
    this.host = options.host ?? new ClaudeReviewHost(new FileHookEventLog);
    if (options.ports) {
      this.coordinator = new AssuranceCoordinator({ ...options.ports, host: this.host });
      return;
    }
    this.coordinator = new AssuranceCoordinator(this.createKernelPorts());
  }
  observe(event) {
    this.host.observe(event);
  }
  bindHostVersion(version) {
    this.hostVersion = version || undefined;
  }
  async shutdown() {
    await this.coordinator.onSessionShutdown();
  }
  createKernelPorts() {
    return {
      host: this.host,
      projectTask: (root, taskId) => projectAssurance(root, taskId, diffSnapshotOf),
      readTaskRecord: (root, taskId) => readTaskRecord(root, taskId),
      readTaskIntent: (root, taskId) => readTaskIntent(root, taskId),
      frozenRunner: async () => resolveBunRunner(),
      buildAssurance: (root, taskId, role, projection, runner) => buildAssuranceSnapshot(root, taskId, role, projection, runner),
      ensureReviewRevision: async (root, taskId, projection) => {
        const current = await readTaskRecord(root, taskId);
        if (!current.record)
          throw new Error(`task ${taskId} has no TaskRecord`);
        if (current.record.contract !== "assurance_kernel/task_record/v4")
          return null;
        return ensureReviewRevision(root, {
          taskId,
          baseHead: current.record.git_base_head,
          scopeHint: current.record.intent_snapshot.scope_hint,
          expectedDiffHash: projection.projection.diff_hash
        });
      },
      runQa: (snapshot, descriptors, runner, options) => runDeterministicQa(snapshot, descriptors, runner, options),
      writeReviewEvidence: (input) => writeNativeReviewEvidence(input.evidence),
      applyVerdict: (ctx, input) => this.applyVerdict(ctx, input),
      applyOrdinaryOperation: (ctx, input) => this.executeOrdinary(ctx, input)
    };
  }
  authority() {
    this.mutationRegistry ??= createMutationAuthorityRegistry();
    this.app ??= createCanaryApplication(this.mutationRegistry);
    return { registry: this.mutationRegistry, app: this.app };
  }
  rejectBeforePreparation(operation, meta) {
    const configured = this.decisions.get(operation) ?? meta.decision;
    if (configured === "deny" || configured === "cancel")
      this.gate(operation, meta);
  }
  gate(operation, meta, binding = {}) {
    const probe = probeHost(this.env, process.platform, this.hostVersion);
    if (!probe.ok)
      throw new Error(probe.reason);
    const requiresUserInteraction = Boolean(meta.requiresUserInteraction);
    const permissionMode = meta.permissionMode ?? this.permissionMode;
    const configuredDecision = this.decisions.get(operation) ?? meta.decision;
    const decision = configuredDecision ?? (isPrivilegedOperation(operation) && Boolean(meta.interactive ?? this.interactive) && requiresUserInteraction && permissionMode !== "dontAsk" ? this.host.takeConfirmation(meta.sessionId, meta.toolCallId) : undefined);
    const gate = evaluateNativeGate({
      operation,
      permissionMode,
      requiresUserInteraction,
      interactive: meta.interactive ?? this.interactive,
      decision
    });
    if (!gate.ok)
      throw new Error(gate.reason);
    return {
      confirmation_ref: confirmationRef({
        sessionId: meta.sessionId,
        toolCallId: meta.toolCallId,
        operation,
        taskId: meta.taskId,
        ...binding
      })
    };
  }
  async status(taskId) {
    return projectAssurance(this.cwd, taskId, diffSnapshotOf);
  }
  async enroll(taskId, meta) {
    this.rejectBeforePreparation("enroll", { ...meta, taskId });
    const now = new Date().toISOString();
    const preparation = await preparePiCanary(this.cwd, { task_id: taskId, now });
    const gate = this.gate("enroll", { ...meta, taskId }, {
      intentRevision: preparation.intent?.revision,
      intentContentHash: preparation.intent?.content_hash,
      bindingDigest: preparation.digest
    });
    const { unchanged } = await revalidatePiCanary(this.cwd, { task_id: taskId, now }, preparation);
    if (!unchanged)
      throw new Error("Workspace changed after confirmation; enrollment aborted before authority");
    if (!preparation.intent)
      throw new Error("enrollment requires a readable TaskIntent");
    const nonce = enrollmentNonce();
    const binding = {
      task_id: taskId,
      intent_path: preparation.intent.path,
      intent_revision: preparation.intent.revision,
      intent_content_hash: preparation.intent.content_hash,
      preparation_digest: preparation.digest,
      actor_id: "user",
      confirmation_ref: gate.confirmation_ref,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      nonce
    };
    const capability = this.enrollmentRegistry.issue(binding);
    const input = {
      task_id: taskId,
      intent_path: binding.intent_path,
      intent_revision: binding.intent_revision,
      preparation_digest: binding.preparation_digest,
      capability,
      capability_binding: binding,
      now
    };
    const rehearsal = runEnrollmentRehearsal(this.cwd, input, capability, this.enrollmentRegistry);
    if (!rehearsal.rehearsed || rehearsal.evidence.outcome !== "ready") {
      throw new Error(`Kernel enrollment rehearsal failed: ${rehearsal.evidence.blockers.join("; ")}`);
    }
    return enrollCanaryTask(this.cwd, input, this.enrollmentRegistry);
  }
  async advance(taskId, signal) {
    return this.coordinator.advance(taskId, { cwd: this.cwd }, signal);
  }
  async submitReview(taskId, verdictInput) {
    return submitClaudeReview(this.host, this.coordinator, { cwd: this.cwd }, taskId, verdictInput);
  }
  async authorize(taskId, operation, meta, extra = {}) {
    if (operation === "repair_authority_state") {
      const authority = reconcileKernelAuthority(this.cwd, taskId);
      if (authority.state !== "repairable_stale_claim" || authority.owner_task_id !== taskId) {
        throw new Error(authority.diagnostic ?? "authority repair requires a repairable stale claim");
      }
      return repairKernelAuthority(this.cwd, taskId, authority.revision);
    }
    if (!isPrivilegedOperation(operation) && operation !== "request_authorization")
      throw new Error(`unsupported privileged operation ${operation}`);
    this.rejectBeforePreparation(operation, { ...meta, taskId });
    let op = operation;
    let decisionOp;
    const projection = await this.status(taskId);
    if (projection.error || !projection.claim)
      throw new Error(projection.error ?? "no active backend claim");
    const readiness = projection.projection.authorization;
    if (operation === "request_authorization") {
      if (readiness.state === "resolve_user_decision") {
        const record = await readTaskRecord(this.cwd, taskId);
        const open = (record.record?.findings ?? []).filter((finding) => finding.kind === "unresolved_user_decision" && finding.status === "open");
        if (open.length !== 1)
          throw new Error(`resolve-user-decision requires exactly one open user decision; found ${open.length}`);
        op = "resolve_user_decision";
        decisionOp = { finding_id: open[0].id, resolution: `resume after literal-user decision: ${open[0].summary}` };
      } else {
        throw new Error(readiness.blocked ?? "no unique host-derived authorization operation");
      }
    }
    const priorIntent = await readTaskIntent(this.cwd, taskId);
    const now = new Date().toISOString();
    const actorId = "user";
    const nextIntent = extra.next_intent ? await parseTaskIntentV1(extra.next_intent) : undefined;
    if (op === "approve_breaking_intent_revision" && !nextIntent)
      throw new Error("approve_breaking_intent_revision requires next_intent");
    const nextIntentHash = nextIntent ? canonicalIntentHash(nextIntent) : undefined;
    const nextIntentRef = nextIntent ? { path: `docs/plans/${nextIntent.task_id}.intent.json`, content_hash: nextIntentHash } : undefined;
    const sidecar = nextIntent ? join7(this.cwd, priorIntent.intent_ref.path) : undefined;
    const priorBytes = sidecar ? readFileSync7(sidecar) : undefined;
    const priorIndexState = sidecar ? execFileSync4("git", ["ls-files", "--stage", "-z", "--", priorIntent.intent_ref.path], {
      cwd: this.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    }) : undefined;
    const restoreStagedIntent = () => {
      if (!sidecar || !priorBytes || !priorIndexState)
        return;
      writeFileSync3(sidecar, priorBytes);
      execFileSync4("git", ["update-index", "--force-remove", "--", priorIntent.intent_ref.path], {
        cwd: this.cwd,
        stdio: ["ignore", "pipe", "pipe"]
      });
      if (priorIndexState.length > 0) {
        execFileSync4("git", ["update-index", "-z", "--index-info"], {
          cwd: this.cwd,
          input: priorIndexState,
          stdio: ["pipe", "ignore", "pipe"]
        });
      }
    };
    let preparedDiffHash = projection.projection.diff_hash;
    let gate;
    try {
      if (sidecar && nextIntent) {
        writeFileSync3(sidecar, `${JSON.stringify(nextIntent, null, 2)}
`);
        execFileSync4("git", ["add", "--", priorIntent.intent_ref.path], { cwd: this.cwd, stdio: ["ignore", "pipe", "pipe"] });
        const preparedRecord = await readTaskRecord(this.cwd, taskId);
        if (!preparedRecord.record)
          throw new Error("TaskRecord changed before the breaking revision digest");
        preparedDiffHash = diffHashOf(this.cwd, preparedRecord.record);
      }
      const preparedProjection = await this.status(taskId);
      assertProjectionBinding(projection, preparedProjection, Boolean(nextIntent));
      if (preparedProjection.projection.diff_hash !== preparedDiffHash) {
        throw new Error("Workspace changed while preparing the authority digest");
      }
      gate = this.gate(operation, { ...meta, taskId }, {
        intentRevision: nextIntent?.revision ?? projection.projection.intent_revision,
        intentContentHash: nextIntentHash ?? projection.projection.intent_content_hash,
        bindingDigest: `${preparedDiffHash}:${nextIntentHash ?? ""}`
      });
    } catch (error) {
      if (sidecar && priorBytes && priorIndexState) {
        const current = await readTaskRecord(this.cwd, taskId);
        if (current.record?.intent_snapshot.revision === priorIntent.intent.revision) {
          restoreStagedIntent();
        }
      }
      throw error;
    }
    const { registry, app } = this.authority();
    const confirmation = gate.confirmation_ref;
    try {
      const capabilityProjection = await this.status(taskId);
      assertProjectionBinding(projection, capabilityProjection, Boolean(nextIntent));
      const operationDiffHash = capabilityProjection.projection.diff_hash;
      if (nextIntent && operationDiffHash !== preparedDiffHash) {
        throw new Error("Workspace changed after native confirmation; authority aborted before capability issuance");
      }
      const capability = await mintCapability(registry, {
        authority_kind: "user",
        task_id: taskId,
        action_kind: op,
        expected_record_hash: capabilityProjection.projection.record_revision,
        intent_revision: nextIntent?.revision ?? capabilityProjection.projection.intent_revision,
        intent_content_hash: nextIntentHash ?? capabilityProjection.projection.intent_content_hash,
        diff_hash: operationDiffHash,
        actor_id: actorId,
        now,
        confirmation_ref: confirmation,
        ...op === "approve_breaking_intent_revision" ? { next_intent: nextIntent, next_intent_ref: nextIntentRef } : {},
        ...op === "resolve_user_decision" && decisionOp ? decisionOp : {},
        ...op === "stop" ? { reason: extra.reason ?? "user stop" } : {}
      });
      const result = app.execute({
        root: this.cwd,
        task_id: taskId,
        operation: {
          op,
          capability,
          actor_id: actorId,
          ...op === "approve_breaking_intent_revision" ? { next_intent: nextIntent, next_intent_ref: nextIntentRef } : {},
          ...op === "resolve_user_decision" && decisionOp ? decisionOp : {},
          ...op === "stop" ? { reason: extra.reason ?? "user stop" } : {}
        },
        prior_intent_token: priorIntent.token,
        diffProvider: diffSnapshotOf,
        now
      });
      if (op === "stop" || op === "approve_breaking_intent_revision")
        stagePlanningArtifactTransition(this.cwd, result.record);
      return result;
    } catch (error) {
      if (sidecar && priorBytes && priorIndexState) {
        const current = await readTaskRecord(this.cwd, taskId);
        if (current.record?.intent_snapshot.revision === priorIntent.intent.revision) {
          restoreStagedIntent();
        }
      }
      throw error;
    }
  }
  async applyVerdict(ctx, input) {
    const { registry, app } = await this.authority();
    const priorIntentToken = (await readTaskIntent(ctx.cwd, input.taskId)).token;
    const now = new Date().toISOString();
    const commitAndApply = async (apply) => {
      this.coordinator.commitInvocation(input.invocation);
      const settlement = apply();
      input.hooks?.onCommit?.();
      const result = await settlement;
      await input.hooks?.afterCommit?.();
      return result;
    };
    if (input.verdict.decision === "rework") {
      const findings = input.verdict.findings.map((finding) => ({
        id: finding.id,
        kind: finding.kind,
        status: "open",
        acceptance_id: finding.acceptance_id,
        source: "review",
        review_round: null,
        summary: finding.summary
      }));
      const capability2 = await mintCapability(registry, {
        authority_kind: input.snapshot.role,
        task_id: input.taskId,
        action_kind: "request_rework",
        expected_record_hash: input.snapshot.record_revision,
        intent_revision: input.snapshot.intent_revision,
        intent_content_hash: input.snapshot.intent_content_hash,
        diff_hash: input.snapshot.diff_hash,
        actor_id: input.actorId,
        findings,
        now,
        confirmation_ref: `claude:${input.actorId}`
      });
      await input.hooks?.beforeCommit?.();
      const result = await commitAndApply(async () => app.execute({
        root: ctx.cwd,
        task_id: input.taskId,
        operation: { op: "request_rework", capability: capability2, findings, actor_id: input.actorId },
        prior_intent_token: priorIntentToken,
        diffProvider: diffSnapshotOf,
        now
      }));
      stagePlanningArtifactTransition(ctx.cwd, result.record);
      return;
    }
    const approval = {
      id: `approval-${input.snapshot.role}-${randomUUID5().slice(0, 8)}`,
      kind: input.snapshot.role === "qa" ? "qa" : "review",
      authority_role: input.snapshot.role === "qa" ? "qa" : "reviewer",
      task_revision: input.snapshot.intent_revision,
      intent_content_hash: input.snapshot.intent_content_hash,
      diff_hash: input.snapshot.diff_hash,
      actor_id: input.actorId,
      summary: input.verdict.approval.summary,
      ...input.snapshot.role === "review" && input.snapshot.review_revision ? { review_revision: input.snapshot.review_revision } : {}
    };
    const capability = await mintCapability(registry, {
      authority_kind: input.snapshot.role,
      task_id: input.taskId,
      action_kind: "record_approval",
      expected_record_hash: input.snapshot.record_revision,
      intent_revision: input.snapshot.intent_revision,
      intent_content_hash: input.snapshot.intent_content_hash,
      diff_hash: input.snapshot.diff_hash,
      actor_id: input.actorId,
      approval,
      now,
      confirmation_ref: `claude:${input.actorId}`
    });
    await input.hooks?.beforeCommit?.();
    await commitAndApply(async () => app.execute({
      root: ctx.cwd,
      task_id: input.taskId,
      operation: { op: "record_approval", capability, approval, actor_id: input.actorId },
      prior_intent_token: priorIntentToken,
      diffProvider: diffSnapshotOf,
      now
    }));
  }
  async executeOrdinary(ctx, input) {
    const { app } = await this.authority();
    const operation = input.operation.op === "revise_intent" ? { ...input.operation, next_intent: await parseTaskIntentV1(input.operation.next_intent) } : input.operation;
    const priorIntent = await readTaskIntent(ctx.cwd, input.taskId);
    const sidecar = join7(ctx.cwd, priorIntent.intent_ref.path);
    const priorBytes = operation.op === "revise_intent" ? readFileSync7(sidecar) : null;
    try {
      if (priorBytes)
        writeFileSync3(sidecar, `${JSON.stringify(operation.next_intent, null, 2)}
`);
      const result = await app.execute({
        root: ctx.cwd,
        task_id: input.taskId,
        operation,
        prior_intent_token: priorIntent.token,
        diffProvider: diffSnapshotOf,
        now: new Date().toISOString()
      });
      if (operation.op === "freeze_artifacts" || operation.op === "stop")
        stagePlanningArtifactTransition(ctx.cwd, result.record);
      return result;
    } catch (error) {
      if (priorBytes) {
        const current = await readTaskRecord(ctx.cwd, input.taskId);
        if (current.record?.intent_snapshot.revision === priorIntent.intent.revision)
          writeFileSync3(sidecar, priorBytes);
      }
      throw error;
    }
  }
}

// plugins/immune-brain/runtime/claude/mcp_server.ts
var TOOLS = [
  { name: "status", description: "Read the Kernel Assurance Projection for an exact task.", privileged: false },
  { name: "enroll", description: "Enroll a Git-tracked TaskIntent after native confirmation.", privileged: true },
  { name: "advance_assurance", description: "Advance frozen Assurance through deterministic QA and Review reservation.", privileged: false },
  { name: "submit_review", description: "Submit the Parent-mediated Review verdict bound to the correlated receipt.", privileged: false },
  { name: "request_authorization", description: "Apply exact literal-user authorization.", privileged: true },
  { name: "approve_breaking_intent_revision", description: "Approve a breaking TaskIntent revision.", privileged: true },
  { name: "stop", description: "Stop the active task with literal-user authority.", privileged: true },
  { name: "repair_authority_state", description: "Repair a proven recoverable stale backend claim.", privileged: false }
];
function listMcpTools() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        ...tool.name === "approve_breaking_intent_revision" ? { next_intent: { type: "object" } } : {},
        ...tool.name === "stop" ? { reason: { type: "string" } } : {},
        ...tool.name === "submit_review" ? { verdict: { type: "object" } } : {}
      },
      required: tool.name === "submit_review" ? ["task_id", "verdict"] : ["task_id"]
    },
    annotations: tool.privileged ? privilegedAnnotations() : { readOnlyHint: tool.name === "status" }
  }));
}
function createMcpRuntime(options = {}) {
  const host = options.host ?? new ClaudeReviewHost(new FileHookEventLog);
  const runtime = new ClaudeRuntime({
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    host,
    ports: options.ports,
    interactive: options.interactive,
    decisions: options.decisions
  });
  let negotiatedVersion;
  let negotiatedInteractive = false;
  return {
    runtime,
    host,
    listTools: listMcpTools,
    bindClientHandshake(identity) {
      negotiatedVersion = identity.version || undefined;
      negotiatedInteractive = identity.interactive;
      runtime.bindHostVersion(negotiatedVersion);
    },
    sessionInteractive: () => negotiatedInteractive,
    async callTool(name, args, meta = {}) {
      const taskId = String(args.task_id ?? "");
      if (!taskId)
        throw new Error("task_id is required");
      if ("native_decision" in args)
        throw new Error("native_decision cannot be supplied in tool arguments");
      if (name === "status")
        return { plugin_version: PLUGIN_VERSION, ...await runtime.status(taskId) };
      if (!negotiatedVersion)
        throw new Error("Claude Code version is unavailable");
      if (!negotiatedInteractive && name !== "repair_authority_state")
        throw new Error("non-interactive host session cannot execute authority tools");
      const probe = probeHost(options.env ?? process.env, process.platform, negotiatedVersion);
      if (!probe.ok)
        throw new Error(probe.reason);
      const toolMeta = {
        sessionId: meta.sessionId ?? "session",
        toolCallId: meta.toolCallId ?? `call-${name}`,
        taskId,
        requiresUserInteraction: meta.requiresUserInteraction ?? isPrivilegedOperation(name),
        permissionMode: meta.permissionMode ?? probe.permissionMode,
        interactive: meta.interactive ?? options.interactive ?? false,
        decision: meta.decision
      };
      if (name === "enroll")
        return runtime.enroll(taskId, toolMeta);
      if (name === "advance_assurance")
        return runtime.advance(taskId, toolMeta.signal);
      if (name === "submit_review") {
        if (!Object.hasOwn(args, "verdict"))
          throw new Error("verdict is required");
        return runtime.submitReview(taskId, args.verdict);
      }
      if (name === "request_authorization" || name === "approve_breaking_intent_revision" || name === "stop" || name === "repair_authority_state") {
        return runtime.authorize(taskId, name, toolMeta, args);
      }
      throw new Error(`unknown tool ${name}`);
    },
    observe: (event) => host.observe(event),
    sessionOfElicitation: (toolCallId) => host.sessionOfElicitation(toolCallId),
    shutdown: () => runtime.shutdown(),
    aborts: new Map
  };
}
function hostCallIdentity(meta, resolveSession) {
  if (!meta)
    return;
  const toolCallId = meta["claudecode/toolUseId"];
  if (typeof toolCallId !== "string" || !toolCallId)
    return;
  const sessionId = resolveSession?.(toolCallId);
  return sessionId ? { sessionId, toolCallId } : undefined;
}
function encodeMessage(message) {
  return Buffer.from(`${JSON.stringify(message)}
`);
}
async function handleJsonRpc(message, mcp = createMcpRuntime()) {
  if (message.method === "initialize") {
    const params = message.params ?? {};
    const trustedClient = params.clientInfo?.name === HOST_ID;
    const elicitation = params.capabilities?.elicitation;
    mcp.bindClientHandshake({
      version: trustedClient && typeof params.clientInfo?.version === "string" ? params.clientInfo.version : "",
      interactive: trustedClient && elicitation !== null && typeof elicitation === "object" && !Array.isArray(elicitation)
    });
    return {
      jsonrpc: "2.0",
      id: message.id ?? null,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: {
          name: HOST_ID,
          version: PLUGIN_VERSION,
          contract: CORE_CONTRACT,
          minimumHostVersion: MIN_CLAUDE_CODE_VERSION
        },
        capabilities: { tools: {} }
      }
    };
  }
  if (message.method === "notifications/initialized")
    return null;
  if (message.method === "notifications/cancelled") {
    const requestId = message.params?.requestId;
    if (requestId !== undefined)
      mcp.aborts.get(requestId)?.abort(new Error("notifications/cancelled"));
    return null;
  }
  if (message.method === "tools/list") {
    return { jsonrpc: "2.0", id: message.id ?? null, result: { tools: mcp.listTools() } };
  }
  if (message.method === "tools/call") {
    const params = message.params ?? {};
    const requestId = message.id ?? `anon-${Date.now()}`;
    const ac = new AbortController;
    mcp.aborts.set(requestId, ac);
    try {
      const name = String(params.name ?? "");
      const interactive = mcp.sessionInteractive();
      if (isPrivilegedOperation(name) && !interactive) {
        throw new Error("non-interactive host session cannot mint authority");
      }
      const identity = hostCallIdentity(params._meta, (toolCallId2) => mcp.sessionOfElicitation(toolCallId2));
      if (isPrivilegedOperation(name) && !identity) {
        throw new Error("host correlation metadata missing");
      }
      const sessionId = identity?.sessionId ?? "stdio";
      const toolCallId = identity?.toolCallId ?? String(message.id ?? "stdio");
      const result = await mcp.callTool(name, params.arguments ?? {}, {
        sessionId,
        toolCallId,
        interactive,
        requiresUserInteraction: isPrivilegedOperation(name),
        signal: ac.signal
      });
      return {
        jsonrpc: "2.0",
        id: message.id ?? null,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] }
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        jsonrpc: "2.0",
        id: message.id ?? null,
        error: { code: -32000, message: reason }
      };
    } finally {
      mcp.aborts.delete(requestId);
    }
  }
  if (message.id === undefined)
    return null;
  return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `unknown method ${message.method}` } };
}
async function writeReply(output, reply) {
  const payload = encodeMessage(reply);
  if (output.write(payload))
    return;
  await new Promise((resolve7) => output.once("drain", resolve7));
}
async function serveStdio(options = {}) {
  const input = options.input ?? stdin;
  const output = options.output ?? stdout;
  const mcp = options.runtime ?? createMcpRuntime({ cwd: process.cwd() });
  const exit = options.exit ?? ((code) => {
    process.exit(code);
  });
  let buffer = Buffer.alloc(0);
  let accepting = true;
  const inFlight = new Set;
  let chain = Promise.resolve();
  const runCall = (parsed) => {
    const task = handleJsonRpc(parsed, mcp).then(async (reply) => {
      if (reply)
        await writeReply(output, reply);
    });
    inFlight.add(task);
    task.finally(() => inFlight.delete(task));
  };
  const drainStdio = async () => {
    while (true) {
      const newline = buffer.indexOf(`
`);
      if (newline < 0)
        return;
      const body = buffer.subarray(0, newline).toString("utf8").trim();
      buffer = buffer.subarray(newline + 1);
      if (!body)
        continue;
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        continue;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
        continue;
      }
      const obj = parsed;
      if (obj.jsonrpc !== "2.0") {
        await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: jsonrpc must be '2.0'" } });
        continue;
      }
      if (typeof obj.method !== "string" || !obj.method) {
        const id = obj.id !== undefined && (typeof obj.id === "string" || typeof obj.id === "number") ? obj.id : null;
        await writeReply(output, { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request: missing method" } });
        continue;
      }
      if (obj.id !== undefined && typeof obj.id !== "string" && typeof obj.id !== "number" && obj.id !== null) {
        await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: invalid id type" } });
        continue;
      }
      if (obj.method === "tools/call" && obj.id === undefined) {
        await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: tools/call requires an id" } });
        continue;
      }
      const rpc = parsed;
      if (rpc.method === "notifications/cancelled") {
        const requestId = rpc.params?.requestId;
        if (requestId !== undefined)
          mcp.aborts.get(requestId)?.abort(new Error("notifications/cancelled"));
        continue;
      }
      if (parsed.method === "tools/call") {
        if (!accepting) {
          if (rpc.id !== undefined)
            await writeReply(output, { jsonrpc: "2.0", id: rpc.id, error: { code: -32000, message: "stdio closed" } });
          continue;
        }
        runCall(rpc);
        continue;
      }
      const reply = await handleJsonRpc(rpc, mcp);
      if (reply)
        await writeReply(output, reply);
    }
  };
  let shutdownPromise = null;
  const executeShutdown = (code = 0) => {
    if (shutdownPromise)
      return shutdownPromise;
    shutdownPromise = (async () => {
      accepting = false;
      for (const ac of mcp.aborts.values())
        ac.abort(new Error("stdio closed"));
      await Promise.allSettled([...inFlight]);
      await mcp.shutdown();
      if (output.writable && typeof output.end === "function") {
        await new Promise((cb) => output.end(() => cb()));
      }
      process.exitCode = code;
      exit(code);
    })();
    return shutdownPromise;
  };
  await new Promise((resolve7) => {
    input.on("data", (chunk) => {
      chain = chain.then(async () => {
        buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
        await drainStdio();
      });
    });
    input.on("end", () => {
      chain.then(() => executeShutdown(0)).finally(resolve7);
    });
    input.on("close", () => {
      chain.then(() => executeShutdown(0)).finally(resolve7);
    });
    input.on("error", () => {
      chain.then(() => executeShutdown(1)).finally(resolve7);
    });
  });
}
async function runHook() {
  const lines = [];
  const rl = createInterface({ input: stdin });
  for await (const line of rl)
    lines.push(line);
  const event = parseHookStdin(lines.join(`
`));
  if (!event)
    return;
  new FileHookEventLog().append(event);
}
var entry = process.argv[1] ?? "";
if (entry.endsWith("mcp_server.ts") || entry.endsWith("mcp-server.mjs")) {
  if (process.argv.includes("--hook"))
    runHook();
  else
    serveStdio();
}
export {
  serveStdio,
  listMcpTools,
  handleJsonRpc,
  createMcpRuntime,
  TOOLS
};
