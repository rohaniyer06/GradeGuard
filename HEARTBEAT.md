# College Manager Heartbeat

## Steps

1. **Poll Canvas iCal feed** — call `icalPoller.pollForNewAssignments()`
   - If new assignments found: sync to Google Calendar, send notification via notifier
   - If no new assignments: continue to digest + overdue checks, then output `HEARTBEAT_OK` if no actions

2. **Check digest schedule** — has a daily digest been sent today?
   - If not and current local time is after configured digest schedule (`DIGEST_SCHEDULE_CRON`, default 8:00am): generate and send daily digest
   - If yes: skip

3. **Check for overdue items** — any assignments now past due with `is_submitted = 0` and `notified_at IS NULL`?
   - If yes: send a gentle reminder and set `notified_at`
   - If no: no reminder action

## Output
- New items / digest / overdue reminders found → send notifications and log outcome
- Nothing new → output: `HEARTBEAT_OK`
