async function fetchStatus() {
  const response = await fetch("/api/status");
  if (!response.ok) {
    throw new Error(`Status failed: ${response.status}`);
  }
  return response.json();
}

async function fetchAssignments() {
  const response = await fetch("/api/assignments");
  if (!response.ok) {
    throw new Error(`Assignments fetch failed: ${response.status}`);
  }
  return response.json();
}

let latestSyllabusPreview = null;
let latestAssignments = [];

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = String(value);
}

function renderStatus(status) {
  setText("assignmentsCount", status.totals.assignments);
  setText("dueSoonCount", status.totals.dueSoon48h);
  setText("overdueCount", status.totals.overdue);
  setText("unsyncedCount", status.totals.unsyncedCalendar);
  setText("statusJson", JSON.stringify(status, null, 2));
}

async function runAction(action) {
  return runActionWithPayload(action, {});
}

async function runActionWithPayload(action, payload) {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload })
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.message || "Action failed");
  }
  setText("lastAction", JSON.stringify(body.result, null, 2));
  renderStatus(body.status);
  await refreshAssignments();
  return body.result;
}

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDueAt(value) {
  if (!value) return "(no due date)";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString();
}

function getAssignmentControls() {
  const search = (document.getElementById("assignmentSearch")?.value || "").trim().toLowerCase();
  const sortBy = document.getElementById("assignmentSort")?.value || "dueAt";
  const order = document.getElementById("assignmentOrder")?.value || "asc";
  const upcomingOnly = Boolean(document.getElementById("assignmentUpcomingOnly")?.checked);
  const groupByCourse = Boolean(document.getElementById("assignmentGroupByCourse")?.checked);
  return { search, sortBy, order, upcomingOnly, groupByCourse };
}

function compareValues(a, b, sortBy, order) {
  let base = 0;
  if (sortBy === "dueAt") {
    const aTime = Date.parse(a.dueAt || "");
    const bTime = Date.parse(b.dueAt || "");
    base = (Number.isNaN(aTime) ? Number.MAX_SAFE_INTEGER : aTime) - (Number.isNaN(bTime) ? Number.MAX_SAFE_INTEGER : bTime);
  } else if (sortBy === "courseName") {
    base = String(a.courseName || "").localeCompare(String(b.courseName || ""));
  } else {
    base = String(a.name || "").localeCompare(String(b.name || ""));
  }
  return order === "desc" ? -base : base;
}

function filterAndSortAssignments(rows) {
  const controls = getAssignmentControls();
  const now = Date.now();
  const filtered = rows.filter((row) => {
    if (controls.search) {
      const haystack = `${row.name || ""} ${row.courseName || ""}`.toLowerCase();
      if (!haystack.includes(controls.search)) {
        return false;
      }
    }
    if (controls.upcomingOnly) {
      const dueAt = Date.parse(row.dueAt || "");
      if (!Number.isNaN(dueAt) && dueAt < now) {
        return false;
      }
    }
    return true;
  });
  filtered.sort((a, b) => compareValues(a, b, controls.sortBy, controls.order));
  return filtered;
}

function renderAssignmentsTable(rows) {
  const wrap = document.getElementById("assignmentsTableWrap");
  if (!wrap) return;
  if (!rows.length) {
    wrap.innerHTML = '<p class="empty">No assignments match current filters.</p>';
    return;
  }

  const controls = getAssignmentControls();
  if (!controls.groupByCourse) {
    const tableRows = rows
      .map(
        (row) => `
      <tr>
        <td>${escapeHtml(row.courseName || row.courseId || "(unknown)")}</td>
        <td>${escapeHtml(row.name)}</td>
        <td>${escapeHtml(formatDueAt(row.dueAt))}</td>
        <td>${row.calendarEventId ? "yes" : "no"}</td>
        <td>${row.pointsPossible == null ? "-" : escapeHtml(row.pointsPossible)}</td>
      </tr>`
      )
      .join("");
    wrap.innerHTML = `
      <table class="assignment-table">
        <thead>
          <tr><th>Course</th><th>Assignment</th><th>Due</th><th>Synced</th><th>Points</th></tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    `;
    return;
  }

  const grouped = new Map();
  for (const row of rows) {
    const key = row.courseName || row.courseId || "(unknown)";
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(row);
  }

  const sections = Array.from(grouped.entries())
    .map(([course, groupRows]) => {
      const tableRows = groupRows
        .map(
          (row) => `
          <tr>
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(formatDueAt(row.dueAt))}</td>
            <td>${row.calendarEventId ? "yes" : "no"}</td>
            <td>${row.pointsPossible == null ? "-" : escapeHtml(row.pointsPossible)}</td>
          </tr>`
        )
        .join("");
      return `
        <section class="course-group">
          <h3>${escapeHtml(course)} <span>(${groupRows.length})</span></h3>
          <table class="assignment-table">
            <thead>
              <tr><th>Assignment</th><th>Due</th><th>Synced</th><th>Points</th></tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </section>
      `;
    })
    .join("");

  wrap.innerHTML = sections;
}

function renderAssignmentSummary(total, shown) {
  setText("assignmentSummary", `Showing ${shown} of ${total} assignments.`);
}

function applyAssignmentView() {
  const filtered = filterAndSortAssignments(latestAssignments);
  renderAssignmentSummary(latestAssignments.length, filtered.length);
  renderAssignmentsTable(filtered);
}

async function refreshAssignments() {
  const payload = await fetchAssignments();
  latestAssignments = Array.isArray(payload.assignments) ? payload.assignments : [];
  applyAssignmentView();
}

function selectedApprovedAssignmentIds() {
  return Array.from(document.querySelectorAll('input[data-approval-id]'))
    .filter((el) => el.checked)
    .map((el) => el.getAttribute("data-approval-id"))
    .filter(Boolean);
}

function renderSyllabusMatches(result) {
  latestSyllabusPreview = result;
  const container = document.getElementById("syllabusMatches");
  if (!container) return;

  if (!result?.matches?.length) {
    container.innerHTML = '<p class="empty">No candidate matches met the score threshold.</p>';
    return;
  }

  const cards = result.matches
    .map((match, idx) => {
      const assignment = `${match.assignmentName} (${match.assignmentId})`;
      const syllabusName = match.syllabusItem?.name || "(missing syllabus name)";
      const checked = idx < 50 ? "checked" : "";
      return `
        <label class="match-row">
          <input type="checkbox" data-approval-id="${escapeHtml(match.assignmentId)}" ${checked} />
          <span>
            <strong>${escapeHtml(syllabusName)}</strong>
            <small>→ ${escapeHtml(assignment)} | score ${escapeHtml(match.score)} | ${escapeHtml(match.reason)}</small>
          </span>
        </label>
      `;
    })
    .join("");

  container.innerHTML = cards;
}

async function runQuery() {
  const input = document.getElementById("queryInput");
  const button = document.getElementById("runQueryButton");
  if (!input || !button) return;
  const message = input.value.trim();
  if (!message) {
    setText("queryOutput", "Please enter a question.");
    return;
  }

  setBusy(button, true);
  try {
    const result = await runActionWithPayload("query", { message });
    setText("queryOutput", result.answer || "(no response)");
  } catch (error) {
    setText("queryOutput", `Error: ${error.message || String(error)}`);
  } finally {
    setBusy(button, false);
  }
}

async function runDigest(type) {
  const action = type === "weekly" ? "digestWeekly" : "digestDaily";
  const button = document.getElementById(type === "weekly" ? "weeklyDigestButton" : "dailyDigestButton");
  setBusy(button, true);
  try {
    const result = await runActionWithPayload(action, {});
    setText("digestOutput", result.digest || "(empty digest)");
  } catch (error) {
    setText("digestOutput", `Error: ${error.message || String(error)}`);
  } finally {
    setBusy(button, false);
  }
}

function getSyllabusInputs() {
  const filePathInput = document.getElementById("syllabusFilePath");
  const minScoreInput = document.getElementById("syllabusMinScore");
  const forceInput = document.getElementById("syllabusForce");
  const filePath = filePathInput?.value?.trim() || "";
  const minScore = Number(minScoreInput?.value || "0.45");
  const force = Boolean(forceInput?.checked);
  return { filePath, minScore, force };
}

function formatSyllabusSummary(result) {
  return JSON.stringify(
    {
      filePath: result.filePath,
      extractedCount: result.extractedCount,
      matchedCount: result.matchedCount,
      rejectedMatchesCount: result.rejectedMatchesCount,
      unmatchedSyllabusCount: result.unmatchedSyllabusCount,
      unmatchedAssignmentsCount: result.unmatchedAssignmentsCount,
      applyResult: result.applyResult
    },
    null,
    2
  );
}

async function previewSyllabus() {
  const button = document.getElementById("syllabusPreviewButton");
  const { filePath, minScore, force } = getSyllabusInputs();
  if (!filePath) {
    setText("syllabusSummary", "Please enter a syllabus file path.");
    return;
  }

  setBusy(button, true);
  try {
    const result = await runActionWithPayload("syllabusPreview", { filePath, minScore, force });
    setText("syllabusSummary", formatSyllabusSummary(result));
    renderSyllabusMatches(result);
  } catch (error) {
    setText("syllabusSummary", `Error: ${error.message || String(error)}`);
  } finally {
    setBusy(button, false);
  }
}

async function applySyllabus() {
  const button = document.getElementById("syllabusApplyButton");
  const { filePath, minScore, force } = getSyllabusInputs();
  if (!filePath) {
    setText("syllabusSummary", "Please enter a syllabus file path.");
    return;
  }
  if (!latestSyllabusPreview) {
    setText("syllabusSummary", "Run Preview Matches first, then apply.");
    return;
  }

  const approvedAssignmentIds = selectedApprovedAssignmentIds();
  if (approvedAssignmentIds.length === 0) {
    setText("syllabusSummary", "Select at least one approved match before apply.");
    return;
  }

  setBusy(button, true);
  try {
    const result = await runActionWithPayload("syllabusApply", {
      filePath,
      minScore,
      force,
      approvedAssignmentIds
    });
    setText("syllabusSummary", formatSyllabusSummary(result));
    renderSyllabusMatches(result);
  } catch (error) {
    setText("syllabusSummary", `Error: ${error.message || String(error)}`);
  } finally {
    setBusy(button, false);
  }
}

async function init() {
  const status = await fetchStatus();
  renderStatus(status);
  await refreshAssignments();

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.getAttribute("data-action");
      if (!action) return;
      button.disabled = true;
      try {
        await runAction(action);
      } catch (error) {
        setText("lastAction", `Error: ${error.message || String(error)}`);
      } finally {
        button.disabled = false;
      }
    });
  });

  const runQueryButton = document.getElementById("runQueryButton");
  runQueryButton?.addEventListener("click", runQuery);
  document.getElementById("queryInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runQuery();
    }
  });

  document.getElementById("dailyDigestButton")?.addEventListener("click", () => runDigest("daily"));
  document.getElementById("weeklyDigestButton")?.addEventListener("click", () => runDigest("weekly"));
  document.getElementById("syllabusPreviewButton")?.addEventListener("click", previewSyllabus);
  document.getElementById("syllabusApplyButton")?.addEventListener("click", applySyllabus);
  document.getElementById("refreshAssignmentsButton")?.addEventListener("click", refreshAssignments);

  ["assignmentSearch", "assignmentSort", "assignmentOrder", "assignmentUpcomingOnly", "assignmentGroupByCourse"].forEach(
    (id) => {
      document.getElementById(id)?.addEventListener("input", applyAssignmentView);
      document.getElementById(id)?.addEventListener("change", applyAssignmentView);
    }
  );
}

init().catch((error) => {
  setText("statusJson", `Error: ${error.message || String(error)}`);
});
