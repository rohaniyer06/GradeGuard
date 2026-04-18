import dotenv from "dotenv";
import { pollForNewAssignments } from "../src/icalPoller";

dotenv.config();

async function main(): Promise<void> {
  const assignments = await pollForNewAssignments();
  console.log(
    JSON.stringify(
      {
        event: "poll_complete",
        newAssignments: assignments.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("poll_failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
