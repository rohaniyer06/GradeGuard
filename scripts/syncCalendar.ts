import dotenv from "dotenv";
import { syncAllToCalendar } from "../src/calendarSync";

dotenv.config();

async function main(): Promise<void> {
  await syncAllToCalendar();
  console.log(
    JSON.stringify(
      {
        event: "calendar_sync_complete",
        status: "ok"
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("calendar_sync_failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
