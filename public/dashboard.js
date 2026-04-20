async function fetchStatus() {
  const response = await fetch("/api/status");
  if (!response.ok) {
    throw new Error(`Status failed: ${response.status}`);
  }
  return response.json();
}

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
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action })
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.message || "Action failed");
  }
  setText("lastAction", JSON.stringify(body.result, null, 2));
  renderStatus(body.status);
}

async function init() {
  const status = await fetchStatus();
  renderStatus(status);

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
}

init().catch((error) => {
  setText("statusJson", `Error: ${error.message || String(error)}`);
});
