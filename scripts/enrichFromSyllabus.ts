import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { extractSyllabusItemsFromFile } from "../src/syllabusParser";
import { planAndApplySyllabusItems } from "../src/syllabusEnrichment";

dotenv.config();

function parseArgs(argv: string[]): {
  filePath: string;
  apply: boolean;
  force: boolean;
  outPath: string | null;
  minScore: number;
} {
  const apply = argv.includes("--apply");
  const force = argv.includes("--force");
  const outIndex = argv.findIndex((arg) => arg === "--out");
  const outPath = outIndex >= 0 ? (argv[outIndex + 1] || null) : null;
  const scoreIndex = argv.findIndex((arg) => arg === "--min-score");
  const minScoreRaw = scoreIndex >= 0 ? argv[scoreIndex + 1] : "0.45";
  const minScore = Number(minScoreRaw);
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
    throw new Error(`Invalid --min-score "${minScoreRaw}". Use a number between 0 and 1.`);
  }
  const filePath = argv.find((arg, idx) => !arg.startsWith("--") && argv[idx - 1] !== "--out") || "";
  if (!filePath) {
    throw new Error(
      "Usage: npm run syllabus:enrich -- <file.pdf|file.txt> [--apply] [--force] [--min-score 0.6] [--out report.json]"
    );
  }
  return { filePath, apply, force, outPath, minScore };
}

function buildDefaultReportPath(inputPath: string): string {
  const safeBase = path.basename(inputPath).replace(/[^a-zA-Z0-9._-]+/g, "_");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(process.cwd(), "reports", `syllabus-enrichment-${safeBase}-${stamp}.json`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const absolutePath = path.resolve(process.cwd(), args.filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Input file does not exist: ${absolutePath}`);
  }

  const items = await extractSyllabusItemsFromFile(absolutePath);
  const result = planAndApplySyllabusItems(items, {
    apply: args.apply,
    force: args.force,
    minScore: args.minScore
  });
  const reportPath = path.resolve(process.cwd(), args.outPath ?? buildDefaultReportPath(absolutePath));

  const reportPayload = {
    event: "syllabus_enrichment_complete",
    file: absolutePath,
    extractedCount: items.length,
    matchedCount: result.plan.matches.length,
    unmatchedSyllabusCount: result.plan.unmatchedSyllabusItems.length,
    unmatchedAssignmentsCount: result.plan.unmatchedAssignments.length,
    rejectedMatchesCount: result.plan.rejectedMatches.length,
    apply: args.apply,
    force: args.force,
    minScore: args.minScore,
    applyResult: result.applyResult ?? null,
    matches: result.plan.matches,
    rejectedMatches: result.plan.rejectedMatches,
    unmatchedSyllabusItems: result.plan.unmatchedSyllabusItems,
    unmatchedAssignments: result.plan.unmatchedAssignments
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(reportPayload, null, 2));

  console.log(
    JSON.stringify(
      {
        ...reportPayload,
        reportPath,
        matchesPreview: result.plan.matches.slice(0, 10).map((m) => ({
          syllabusName: m.syllabusItem.name,
          assignmentId: m.assignmentId,
          assignmentName: m.assignmentName,
          score: m.score,
          reason: m.reason
        }))
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("syllabus_enrichment_failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
