// Formatters that read from ContextStore and produce TranscriptEntry blocks
// for the on-demand results commands (/results, /overview, /graph, /activity,
// /help, /compare, /diff). Each returns a complete TranscriptEntry ready to be
// pushed to the Static scrollback — no React, just plain string arrays.

import type { ContextStore } from "../../memory/contextStore.js";
import type { TranscriptEntry, ToastTone } from "./Transcript.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

// Produce sequentially numbered IDs for batch-generated blocks (see buildMultiBlock).
let _nextId = 0;
function nextBlockId(prefix: string): string {
  return `${prefix}_${_nextId++}_${Math.random().toString(36).slice(2, 6)}`;
}

let _nextActivityId = 0;
function nextActivityId(): string {
  return `act_${_nextActivityId++}`;
}

// One TranscriptEntry's worth of output. Each block *title* is shown as a
// header line inside the block, so callers just build the body.
function toLines(message: string): string[] {
  return message.split("\n").filter((l) => l.trim() !== "");
}

// ── Public formatters ───────────────────────────────────────────────────────

export function formatActivityEntry(
  agent: string | undefined,
  activity: string,
): TranscriptEntry {
  return {
    id: nextActivityId(),
    kind: "activity",
    agent,
    text: activity,
  };
}

export function formatSystemNotice(
  text: string,
  tone: ToastTone = "info",
): TranscriptEntry {
  return {
    id: nextActivityId(),
    kind: "system",
    text,
    tone,
  };
}

export function formatUserGoal(goal: string): TranscriptEntry {
  return { id: `user_${_nextId++}`, kind: "user", text: goal };
}

export function formatWelcome(): TranscriptEntry {
  return { id: "welcome", kind: "welcome" };
}

// ── Results (ranked hypotheses) ─────────────────────────────────────────────

function statusGlyph(status: string): string {
  switch (status) {
    case "active": return "✓";
    case "pending_review":
    case "reviewing": return "⧖";
    case "rejected": return "✗";
    case "evolved": return "✨";
    default: return "·";
  }
}

export function formatResults(
  memory: ContextStore,
  sessionId: string,
): TranscriptEntry {
  const hyps = memory.getAllActiveHypotheses(sessionId);
  if (hyps.length === 0) {
    return {
      id: nextBlockId("results"),
      kind: "block",
      title: "Ranked Hypotheses",
      lines: ["(no hypotheses yet)"],
    };
  }

  const lines: string[] = [];
  lines.push(`${"#".padEnd(3)} ${"Elo".padEnd(6)} ${"St".padEnd(3)} Hypothesis`);
  lines.push("─".repeat(72));

  for (let i = 0; i < hyps.length; i++) {
    const h = hyps[i];
    const rank = String(i + 1).padStart(2);
    const elo = String(Math.round(h.eloRating)).padStart(4);
    const glyph = statusGlyph(h.status);
    const keyClaim = (h.summary || h.title).replace(/\s+/g, " ").trim().slice(0, 80);
    lines.push(` ${rank}  ${elo}  ${glyph}  ${h.title}`);
    lines.push(`         ${keyClaim}`);
  }

  return {
    id: nextBlockId("results"),
    kind: "block",
    title: `Ranked Hypotheses (${hyps.length})`,
    lines,
  };
}

/**
 * Like {@link formatResults} but for an arbitrary (possibly non-active) session:
 * prepends a metadata header (full id, status, date, hypothesis count) and a
 * divider, and titles the block with the session name. Used by the sessions picker.
 */
export function formatSessionResults(
  memory: ContextStore,
  sessionId: string,
): TranscriptEntry {
  const base = formatResults(memory, sessionId);
  const session = memory.getSession(sessionId);
  if (!session) {
    return { ...base, title: `Results · ${sessionId.slice(0, 8)}` };
  }
  const count = session.stats?.totalHypotheses ?? 0;
  const date = session.createdAt.toISOString().slice(0, 10);
  const header = [
    `${session.id}  ·  ${session.status}  ·  ${date}  ·  ${count} hypotheses`,
    "─".repeat(72),
  ];
  return {
    ...base,
    title: session.name,
    lines: [...header, ...(base.lines ?? [])],
  };
}

// ── Overview ────────────────────────────────────────────────────────────────

export function formatOverview(
  memory: ContextStore,
  sessionId: string,
): TranscriptEntry[] {
  const session = memory.getSession(sessionId);
  if (!session) {
    return [{
      id: nextBlockId("overview"),
      kind: "block",
      title: "Research Overview",
      lines: ["No session loaded."],
    }];
  }

  if (session.status !== "completed" && !session.researchOverview) {
    return [{
      id: nextBlockId("overview"),
      kind: "block",
      title: "Research Overview",
      lines: ["Session is still running — overview will be available when complete."],
    }];
  }

  const blocks: TranscriptEntry[] = [];

  if (session.researchOverview) {
    const lines = toLines(session.researchOverview);
    blocks.push({
      id: nextBlockId("overview"),
      kind: "block",
      title: "Research Summary",
      lines: lines.slice(0, 30),
      color: "claude",
    });
  }

  if (session.metaReviewCritique) {
    const lines = toLines(session.metaReviewCritique);
    blocks.push({
      id: nextBlockId("meta"),
      kind: "block",
      title: "Meta-Review Critique",
      lines: lines.slice(0, 20),
      color: "warning",
    });
  }

  return blocks;
}

// ── Graph ───────────────────────────────────────────────────────────────────

export function formatGraph(
  memory: ContextStore,
  sessionId: string,
): TranscriptEntry {
  const hyps = memory.getAllActiveHypotheses(sessionId);
  if (hyps.length === 0) {
    return {
      id: nextBlockId("graph"),
      kind: "block",
      title: "Hypothesis Graph",
      lines: ["No hypotheses to graph yet."],
    };
  }

  // Build adjacency map: parentId → children
  const children = new Map<string, typeof hyps>();
  for (const h of hyps) {
    for (const pid of h.parentIds) {
      const list = children.get(pid) ?? [];
      list.push(h);
      children.set(pid, list);
    }
  }

  const roots = hyps.filter((h) => h.parentIds.length === 0);

  function renderTree(hypId: string, depth = 0): string[] {
    const hyp = hyps.find((h) => h.id === hypId);
    if (!hyp) return [];
    const prefix = "  ".repeat(depth) + (depth > 0 ? "├─ " : "");
    const kids = children.get(hypId) ?? [];
    const out: string[] = [
      `${prefix}${hyp.title.slice(0, 50)} [${Math.round(hyp.eloRating)}]`,
    ];
    for (const child of kids) {
      out.push(...renderTree(child.id, depth + 1));
    }
    return out;
  }

  const lines: string[] = [`${roots.length} root(s), ${hyps.length} nodes`];
  for (const root of roots) {
    lines.push(...renderTree(root.id));
  }

  return {
    id: nextBlockId("graph"),
    kind: "block",
    title: "Hypothesis Graph",
    lines,
  };
}

// ── Activity log ────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  llm_call: "permission",
  search: "success",
  tool_call: "suggestion",
  generation: "claude",
  reflection: "warning",
  ranking: "warning",
  evolution: "suggestion",
  meta_review: "text",
  experiment_design: "success",
  proximity: "permission",
  knowledge_graph: "claude",
  session_lifecycle: "inactive",
  report: "text",
};

export function formatActivity(
  memory: ContextStore,
  sessionId: string,
  scroll = 0,
  limit = 30,
): TranscriptEntry {
  const entries = memory.getSessionActivity(sessionId);
  if (entries.length === 0) {
    return {
      id: nextBlockId("activity"),
      kind: "block",
      title: "Activity Log",
      lines: ["No activity recorded for this session."],
    };
  }

  const visible = entries.slice(scroll, scroll + limit);

  const lines: string[] = [
    `${entries.length} entries (showing ${scroll + 1}–${Math.min(scroll + limit, entries.length)})`,
    "",
  ];

  for (const e of visible) {
    const ts = e.createdAt.toISOString().slice(11, 19);
    const tokens = e.tokensIn !== null || e.tokensOut !== null
      ? ` [${e.tokensIn ?? 0}↑ ${e.tokensOut ?? 0}↓]`
      : "";
    const meta = TYPE_COLORS[e.type] ?? "text";
    lines.push(
      `[${ts}] ${e.agent.padEnd(14)} ${e.type.padEnd(18)} ${e.message.slice(0, 70)} ${tokens}`,
    );
  }

  return {
    id: nextBlockId("activity"),
    kind: "block",
    title: "Activity Log",
    lines,
  };
}

// ── Compare ─────────────────────────────────────────────────────────────────

export function formatCompare(
  memory: ContextStore,
  sessionId: string,
  idA: string,
  idB: string,
): TranscriptEntry {
  const hyps = memory.getAllActiveHypotheses(sessionId);
  const h1 = hyps.find((h) => h.id.startsWith(idA));
  const h2 = hyps.find((h) => h.id.startsWith(idB));

  if (!h1) {
    return { id: nextBlockId("compare"), kind: "block", title: "Compare", lines: [`Hypothesis not found: ${idA}`] };
  }
  if (!h2) {
    return { id: nextBlockId("compare"), kind: "block", title: "Compare", lines: [`Hypothesis not found: ${idB}`] };
  }

  const fmt = (h: typeof h1) => [
    `Title:    ${h.title}`,
    `Elo:      ${Math.round(h.eloRating)}`,
    `Status:   ${h.status}`,
    `Matches:  ${h.matchesPlayed} (W${h.wins}/L${h.losses}/D${h.draws})`,
    `Strategy: ${h.generationStrategy}`,
    `Summary:  ${h.summary.slice(0, 200)}`,
  ];

  return {
    id: nextBlockId("compare"),
    kind: "block",
    title: `Comparing: ${h1.title.slice(0, 40)} vs ${h2.title.slice(0, 40)}`,
    lines: [
      `─── ${idA} ───`,
      ...fmt(h1),
      "",
      `─── ${idB} ───`,
      ...fmt(h2),
    ],
  };
}

// ── Diff (evolution lineage) ────────────────────────────────────────────────

export function formatDiff(
  memory: ContextStore,
  sessionId: string,
  hypId: string,
): TranscriptEntry {
  const hyps = memory.getAllActiveHypotheses(sessionId);
  const hyp = hyps.find((h) => h.id.startsWith(hypId));
  if (!hyp) {
    return { id: nextBlockId("diff"), kind: "block", title: "Evolution Lineage", lines: [`Hypothesis not found: ${hypId}`] };
  }

  // Reconstruct the parent chain
  const chain: Array<{ id: string; title: string; strategy: string }> = [];
  const visited = new Set<string>();
  let current: typeof hyp | null = hyp;

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    chain.unshift({
      id: current.id,
      title: current.title,
      strategy: current.generationStrategy,
    });
    const pid = current.parentIds?.[0];
    current = pid ? memory.getHypothesis(pid) : null;
  }

  const lines = chain.map(
    (h, i) => `${i === chain.length - 1 ? "└─" : "├─"} ${h.title.slice(0, 60)} [${h.strategy}]`,
  );

  return {
    id: nextBlockId("diff"),
    kind: "block",
    title: `Lineage: ${hyp.title.slice(0, 50)} (${chain.length} nodes)`,
    lines,
  };
}

// ── Help ────────────────────────────────────────────────────────────────────

const CATEGORY_ORDER = ["Lifecycle", "Control", "Results", "Actions", "System"];

export function formatHelp(
  commands: Array<{
    name: string;
    description: string;
    category: string;
    activeWhen?: (ctx: { sessionId: string | null; supervisor: unknown; paused: boolean }) => boolean;
  }>,
  ctx: { sessionId: string | null; supervisor: unknown; paused: boolean },
): TranscriptEntry {
  const byCategory = new Map<string, typeof commands>();
  for (const cmd of commands) {
    const cat = cmd.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(cmd);
  }

  const lines: string[] = [""];

  for (const cat of CATEGORY_ORDER) {
    const cmds = byCategory.get(cat);
    if (!cmds || cmds.length === 0) continue;
    lines.push(`  ${cat}:`);
    for (const c of cmds) {
      const isActive = !c.activeWhen || c.activeWhen(ctx);
      const mark = isActive ? " " : "✗";
      const prefix = isActive ? `/${c.name}` : `✗ /${c.name} (unavailable)`;
      lines.push(`    ${mark} ${prefix.padEnd(28)} ${c.description}`);
    }
  }

  lines.push("");
  lines.push('Type a research topic to begin a session, or "/" for autocomplete.');

  return {
    id: nextBlockId("help"),
    kind: "block",
    title: "Available Commands",
    lines,
  };
}
