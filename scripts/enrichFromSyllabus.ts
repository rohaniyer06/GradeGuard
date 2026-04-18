import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { extractSyllabusItemsFromFile } from "../src/syllabusParser";
import { planAndApplySyllabusItems } from "../src/syllabusEnrichment";

dotenv.config();

function parseArgs(argv: string[]): { filePath: string; apply: boolean; force: boolean } {
  const apply = argv.includes("--apply");
  const force = argv.includes("--force");
  const filePath = argv.find((arg) => !arg.startsWith("--")) || "";
  if (!filePath) {
    throw new Error("Usage: npm run syllabus:enrich -- <file.pdf|file.txt> [--apply] [--force]");
  }
  return { filePath, apply, force };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const absolutePath = path.resolve(process.cwd(), args.filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Input file does not exist: ${absolutePath}`);
  }

  const items = await extractSyllabusItemsFromFile(absolutePath);
  const result = planAndApplySyllabusItems(items, { apply: args.apply, force: args.force });

  console.log(
    JSON.stringify(
      {
        event: "syllabus_enrichment_complete",
        file: absolutePath,
        extractedCount: items.length,
        matchedCount: result.plan.matches.length,
        unmatchedSyllabusCount: result.plan.unmatchedSyllabusItems.length,
        unmatchedAssignmentsCount: result.plan.unmatchedAssignments.length,
        apply: args.apply,
        force: args.force,
        applyResult: result.applyResult ?? null,
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
