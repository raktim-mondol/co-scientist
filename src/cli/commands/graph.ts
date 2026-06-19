import chalk from "chalk";
import { writeFileSync } from "fs";
import { getContextStore } from "../../memory/contextStore.js";
import { KnowledgeGraphAgent } from "../../agents/knowledgeGraph.js";
import { runMigrations } from "../../db/migrate.js";

export async function graphCommand(
  sessionId: string,
  options: { format?: string; output?: string }
): Promise<void> {
  await runMigrations();
  const memory = getContextStore();

  const session = memory.resolveSession(sessionId);
  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}\nRun \`co-scientist list\` to see available sessions (UUID or name accepted).`));
    process.exit(1);
  }
  sessionId = session.id;

  const nodes = memory.getKgNodes(sessionId);
  const edges = memory.getKgEdges(sessionId);

  if (nodes.length === 0) {
    console.log(chalk.yellow("Knowledge graph is empty. The graph is built during proximity analysis — run a longer session or increase --max-rounds."));
    return;
  }

  const fmt = options.format ?? "text";

  if (fmt === "json") {
    const data = JSON.stringify({ nodes, edges }, null, 2);
    if (options.output) {
      writeFileSync(options.output, data, "utf-8");
      console.log(chalk.green(`JSON written to ${options.output}`));
    } else {
      console.log(data);
    }
    return;
  }

  if (fmt === "dot") {
    const dot = buildDot(sessionId, nodes, edges);
    if (options.output) {
      writeFileSync(options.output, dot, "utf-8");
      console.log(chalk.green(`DOT written to ${options.output}`));
    } else {
      console.log(dot);
    }
    return;
  }

  // ── text summary (default) ────────────────────────────────────────────────
  const kg = new KnowledgeGraphAgent();
  const unexplored = kg.getUnexploredConcepts(sessionId, 15);

  const byType = (t: string) => nodes.filter((n) => n.type === t);
  const byRel  = (r: string) => edges.filter((e) => e.relation === r);

  console.log(chalk.bold.cyan("\n🕸  Knowledge Graph Summary\n"));
  console.log(chalk.gray("─".repeat(60)));
  console.log(`  ${chalk.bold("Session:")}  ${session.name} (${sessionId})`);
  console.log(chalk.gray("─".repeat(60)));

  console.log(chalk.bold("\nNodes"));
  console.log(`  Hypotheses : ${chalk.yellow(byType("hypothesis").length)}`);
  console.log(`  Concepts   : ${chalk.cyan(byType("concept").length)}`);
  console.log(`  Citations  : ${chalk.gray(byType("citation").length)}`);
  console.log(`  Total      : ${chalk.white(nodes.length)}`);

  console.log(chalk.bold("\nEdges"));
  console.log(`  evolved_from : ${chalk.magenta(byRel("evolved_from").length)}`);
  console.log(`  related_to   : ${chalk.blue(byRel("related_to").length)}`);
  console.log(`  supports     : ${chalk.green(byRel("supports").length)}`);
  console.log(`  contradicts  : ${chalk.red(byRel("contradicts").length)}`);
  console.log(`  Total        : ${chalk.white(edges.length)}`);

  if (unexplored.length > 0) {
    console.log(chalk.bold("\n🔍 Unexplored Concept Clusters"));
    unexplored.forEach((c) => console.log(`  • ${chalk.cyan(c)}`));
  } else {
    console.log(chalk.gray("\nAll concept clusters are covered by at least one hypothesis."));
  }

  console.log(chalk.gray("\n─".repeat(60)));
  console.log(chalk.gray(`  Export: co-scientist graph ${sessionId} --format dot -o graph.dot`));
  console.log(chalk.gray(`          co-scientist graph ${sessionId} --format json -o graph.json\n`));
}

function buildDot(
  sessionId: string,
  nodes: Array<{ id: string; type: string; label: string }>,
  edges: Array<{ fromNodeId: string; toNodeId: string; relation: string }>
): string {
  const nodeColor: Record<string, string> = {
    hypothesis: "lightblue",
    concept: "lightyellow",
    citation: "lightgray",
  };
  const edgeStyle: Record<string, string> = {
    evolved_from: "dashed",
    related_to: "dotted",
    supports: "solid",
    contradicts: "bold",
  };

  const nodeLines = nodes.map((n) => {
    const label = n.label.replace(/"/g, "'").slice(0, 40);
    const color = nodeColor[n.type] ?? "white";
    return `  "${n.id}" [label="${label}" style=filled fillcolor="${color}" shape=${n.type === "hypothesis" ? "box" : "ellipse"}]`;
  });

  const edgeLines = edges.map((e) => {
    const style = edgeStyle[e.relation] ?? "solid";
    return `  "${e.fromNodeId}" -> "${e.toNodeId}" [label="${e.relation}" style=${style}]`;
  });

  return [
    `digraph co_scientist_${sessionId.slice(0, 8)} {`,
    "  rankdir=LR",
    "  node [fontsize=10]",
    "  edge [fontsize=8]",
    ...nodeLines,
    ...edgeLines,
    "}",
  ].join("\n");
}
