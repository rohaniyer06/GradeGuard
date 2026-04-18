import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { extractSyllabusItemsFromFile } from "../src/syllabusParser";

dotenv.config();

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Usage: npm run syllabus:extract -- <path-to-syllabus-text-file>");
  }

  const absolutePath = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Input file does not exist: ${absolutePath}`);
  }
  const items = await extractSyllabusItemsFromFile(absolutePath);

  console.log(
    JSON.stringify(
      {
        event: "syllabus_extract_complete",
        file: absolutePath,
        count: items.length,
        items
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("syllabus_extract_failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
