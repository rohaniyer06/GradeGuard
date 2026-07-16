import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const BOOT = window.GRADEGUARD_BOOT || { settings: {}, uploadedSyllabi: [] };

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const json = contentType.includes("application/json")
    ? await response.json()
    : { error: await response.text() };
  if (!response.ok) throw new Error(json.error || "Request failed");
  if (!contentType.includes("application/json")) {
    throw new Error("Expected JSON but received a page. Restart npm run start:ui and try again.");
  }
  return json;
}

function formatDue(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatTimeAgo(iso) {
  if (!iso) return "-";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60 * 1000) return "just now";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function toDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function relativeTime(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) {
    const hours = Math.max(1, Math.round(Math.abs(ms) / 3600000));
    const days = Math.floor(hours / 24);
    return {
      label: days >= 1 ? `${days} day${days === 1 ? "" : "s"} late` : `${hours} hr${hours === 1 ? "" : "s"} late`,
      level: "danger"
    };
  }
  const hours = Math.round(ms / 3600000);
  const days = Math.floor(hours / 24);
  if (days >= 1) {
    return {
      label: `${days} day${days === 1 ? "" : "s"}`,
      level: days > 5 ? "safe" : days >= 2 ? "warning" : "danger"
    };
  }
  return { label: `${Math.max(1, hours)} hr${hours === 1 ? "" : "s"}`, level: "danger" };
}

function isCompleted(row) {
  return row.isSubmitted === 1 || row.isSubmitted === true;
}

function assignmentState(row) {
  const isPastDue = new Date(row.dueAt).getTime() < Date.now();
  if (isPastDue && isCompleted(row)) return { key: "past", label: "Past" };
  if (isPastDue) return { key: "overdue", label: "Overdue" };
  return { key: "active", label: isCompleted(row) ? "Done" : "Active" };
}

function courseKey(row) {
  return row.courseCode || row.courseName || "Unknown course";
}

function courseLabel(course) {
  if (!course) return "";
  if (course.courseCode && course.name && course.courseCode !== course.name) {
    return `${course.courseCode} - ${course.name}`;
  }
  return course.courseCode || course.name || "";
}

function HealthCard({ status }) {
  const health = status?.health || {};
  const checks = [
    ["Canvas", health.canvasConfigured],
    ["Discord", health.discordConfigured],
    ["Digest", health.digestConfigured],
    ["Alerts", health.newAssignmentAlerts]
  ];
  const lastDigest = health.lastDigest?.deliveredAt
    ? `${health.lastDigest.status} ${formatTimeAgo(health.lastDigest.deliveredAt)}`
    : "none yet";

  return (
    <section className="side-card">
      <h3>Health Check</h3>
      {checks.map(([label, ok]) => (
        <div className="health-row" key={label}>
          <span>{label}</span>
          <span className={`health-dot ${ok ? "ok" : ""}`} title={ok ? "OK" : "Needs setup"} />
        </div>
      ))}
      <div className="health-meta">
        Digest: {status?.digestTime || "-"}
        <br />
        Last digest: {lastDigest}
        <br />
        Assignments: {status?.counts?.total ?? 0} total, {status?.counts?.overdue ?? 0} overdue
      </div>
    </section>
  );
}

function Workload({ assignments, selectedDayKey, setSelectedDayKey, courseFilter, mode, setMode }) {
  const scoped = assignments.filter((row) => courseFilter === "all" || courseKey(row) === courseFilter);
  const counts = {};
  for (const row of scoped) {
    if (assignmentState(row).key !== "active") continue;
    const key = toDayKey(new Date(row.dueAt));
    counts[key] = (counts[key] || 0) + 1;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: mode }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });

  return (
    <section className="section">
      <div className="section-heading">
        <h2>Workload</h2>
        <div className="view-toggle" aria-label="Workload range">
          {[7, 14, 28].map((value) => (
            <button
              className={`filter-btn ${mode === value ? "active" : ""}`}
              key={value}
              type="button"
              onClick={() => setMode(value)}
            >
              {value === 7 ? "7 days" : value === 14 ? "2 weeks" : "4 weeks"}
            </button>
          ))}
        </div>
      </div>
      <div className={mode === 7 ? "strip" : "calendar-grid"}>
        {days.map((d, i) => {
          const key = toDayKey(d);
          const count = counts[key] || 0;
          const classes = [mode === 7 ? "day-card" : "calendar-day"];
          if (i === 0) classes.push("today");
          if (selectedDayKey === key) classes.push("selected");
          if (count >= 1 && count <= 2) classes.push("level-mid");
          if (count >= 3) classes.push("level-high");
          return (
            <button
              className={classes.join(" ")}
              key={key}
              type="button"
              onClick={() => setSelectedDayKey(selectedDayKey === key ? null : key)}
            >
              <div className="day-name">{d.toLocaleDateString(undefined, { weekday: "short" })}</div>
              <div className="day-date">{d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
              {count > 0 && <span className={mode === 7 ? "badge" : "calendar-count"}>{count}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AssignmentTable({ assignments, filter, setFilter, courseFilter, setCourseFilter, selectedDayKey, onToggleDone, onOpen }) {
  const courses = useMemo(() => Array.from(new Set(assignments.map(courseKey))).sort(), [assignments]);
  const scoped = assignments.filter((row) => courseFilter === "all" || courseKey(row) === courseFilter);
  const counts = {
    active: scoped.filter((row) => assignmentState(row).key === "active").length,
    overdue: scoped.filter((row) => assignmentState(row).key === "overdue").length,
    past: scoped.filter((row) => assignmentState(row).key === "past").length
  };
  const visible = scoped
    .filter((row) => assignmentState(row).key === filter)
    .filter((row) => !selectedDayKey || toDayKey(new Date(row.dueAt)) === selectedDayKey);

  return (
    <section className="section" id="upcomingSection">
      <h2>Assignments</h2>
      <div className="assignment-toolbar">
        <div className="assignment-filters" aria-label="Assignment filters">
          {["active", "overdue", "past"].map((key) => (
            <button className={`filter-btn ${filter === key ? "active" : ""}`} key={key} type="button" onClick={() => setFilter(key)}>
              {key[0].toUpperCase() + key.slice(1)}
            </button>
          ))}
        </div>
        <select className="select course-filter" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}>
          <option value="all">All courses</option>
          {courses.map((course) => (
            <option key={course} value={course}>{course}</option>
          ))}
        </select>
        <div className="small summary-line">{visible.length} shown | {counts.active} active | {counts.overdue} overdue | {counts.past} past</div>
      </div>

      {!visible.length ? (
        <div className="empty">No assignments match this view.</div>
      ) : (
        <div className="table-shell">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Done</th>
                  <th>Course</th>
                  <th>Assignment</th>
                  <th>Due</th>
                  <th>In</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const state = assignmentState(row);
                  const rel = relativeTime(row.dueAt);
                  return (
                    <tr className={`${state.key}${isCompleted(row) ? " checked" : ""}`} key={row.id}>
                      <td>
                        <input
                          className="assignment-check"
                          type="checkbox"
                          checked={isCompleted(row)}
                          onChange={(event) => onToggleDone(row.id, event.target.checked)}
                          aria-label={`Mark ${row.name} complete`}
                        />
                      </td>
                      <td><span className="course-code">{courseKey(row)}</span></td>
                      <td>
                        <button className="assignment-link assignment-title" type="button" onClick={() => onOpen(row.id)}>
                          {row.name}
                        </button>
                      </td>
                      <td>{formatDue(row.dueAt)}</td>
                      <td><span className={`countdown ${rel.level}`}>{isCompleted(row) && state.key === "active" ? "done" : rel.label}</span></td>
                      <td><span className={`status-pill ${state.key}`}>{state.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function AssignmentDrawer({ assignment, onClose, onToggleDone }) {
  if (!assignment) return null;
  const state = assignmentState(assignment);
  const rel = relativeTime(assignment.dueAt);
  const detail = [
    ["Due", formatDue(assignment.dueAt)],
    ["Time Remaining", isCompleted(assignment) && state.key === "active" ? "done" : rel.label],
    ["Description", assignment.description || "No description saved."],
    ["Points", assignment.pointsPossible ?? "-"],
    ["Submission Type", assignment.submissionTypes || "-"],
    ["Calendar Sync", assignment.calendarEventId ? "Synced to Google Calendar" : "No calendar event recorded"],
    ["First Seen", assignment.firstSeenAt ? formatTimeAgo(assignment.firstSeenAt) : "-"],
    ["Notification", assignment.notifiedAt ? `Notified ${formatTimeAgo(assignment.notifiedAt)}` : "Not notified"]
  ];

  return (
    <>
      <div className="drawer-backdrop open" onClick={onClose} />
      <aside className="detail-drawer open" aria-hidden="false">
        <div className="drawer-top">
          <div>
            <div className="small drawer-course">{courseKey(assignment)}</div>
            <h2 className="drawer-title">{assignment.name}</h2>
          </div>
          <button className="btn" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-status"><span className={`status-pill ${state.key}`}>{state.label}</span></div>
        <div className="toggle-wrap">
          <label className="switch">
            <input type="checkbox" checked={isCompleted(assignment)} onChange={(event) => onToggleDone(assignment.id, event.target.checked)} />
            <span className="slider" />
          </label>
          <span className="small no-margin">Marked done</span>
        </div>
        <div className="detail-list">
          {detail.map(([label, value]) => (
            <div className="detail-item" key={label}>
              <div className="detail-label">{label}</div>
              <div className="detail-value">{value}</div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

function Settings({ settings, courses, uploadedSyllabi, onReload, onSettingsChange }) {
  const [icalUrl, setIcalUrl] = useState(settings.canvasIcalUrl || settings.canvasIcalMasked || "");
  const [target, setTarget] = useState(settings.notificationTargetMasked || "");
  const [iMessage, setIMessage] = useState(settings.iMessageTarget || "");
  const [digestTime, setDigestTime] = useState(settings.digestTime || "08:00");
  const [alerts, setAlerts] = useState(settings.newAssignmentAlerts !== false);
  const [theme, setTheme] = useState(settings.theme === "dark");
  const [status, setStatus] = useState("");
  const [notifyStatus, setNotifyStatus] = useState("");
  const [syncStatus, setSyncStatus] = useState("");
  const [digestPreview, setDigestPreview] = useState("");
  const [syllabusCourse, setSyllabusCourse] = useState("");
  const [customCourse, setCustomCourse] = useState("");
  const [syllabusFile, setSyllabusFile] = useState(null);
  const [syllabusStatus, setSyllabusStatus] = useState("");
  const [syllabusResult, setSyllabusResult] = useState(null);

  useEffect(() => {
    setIcalUrl(settings.canvasIcalUrl || settings.canvasIcalMasked || "");
    setTarget(settings.notificationTargetMasked || "");
    setIMessage(settings.iMessageTarget || "");
    setDigestTime(settings.digestTime || "08:00");
    setAlerts(settings.newAssignmentAlerts !== false);
    setTheme(settings.theme === "dark");
  }, [settings]);

  function settingPatchFor(key, value) {
    if (key === "CANVAS_ICAL_URL") {
      return { canvasIcalUrl: value, canvasIcalMasked: value };
    }
    if (key === "OPENCLAW_TARGET") {
      return { notificationTargetMasked: value };
    }
    if (key === "IMESSAGE_TARGET") {
      return { iMessageTarget: value };
    }
    if (key === "DIGEST_SCHEDULE_CRON") {
      return { digestTime: value };
    }
    if (key === "NEW_ASSIGNMENT_ALERTS") {
      return { newAssignmentAlerts: value === "true" };
    }
    if (key === "UI_THEME") {
      return { theme: value };
    }
    return {};
  }

  async function saveSetting(key, value, message) {
    setStatus(`Saving ${message}...`);
    await fetchJson("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value })
    });
    onSettingsChange(settingPatchFor(key, value));
    setStatus(`${message} updated.`);
    await onReload();
  }

  async function uploadSyllabus() {
    const course = customCourse.trim() || syllabusCourse.trim();
    if (!course || !syllabusFile) {
      setSyllabusStatus("Choose an existing course or type a new one, and select a PDF.");
      return;
    }
    setSyllabusStatus("Uploading...");
    const form = new FormData();
    form.append("course", course);
    form.append("file", syllabusFile);
    const body = await fetchJson("/api/syllabus", { method: "POST", body: form });
    setSyllabusStatus(body.message || "Upload complete.");
    setSyllabusResult(body);
    setSyllabusCourse("");
    setCustomCourse("");
    setSyllabusFile(null);
    await onReload();
  }

  return (
    <section className="view active">
      <h1>Settings</h1>
      <section className="settings-group open">
        <div className="settings-toggle">Canvas iCal</div>
        <div className="settings-content show">
          <label className="label">Canvas iCal URL</label>
          <div className="row">
            <textarea className="input" rows="2" value={icalUrl} onChange={(event) => setIcalUrl(event.target.value)} />
            <button className="btn" type="button" onClick={() => saveSetting("CANVAS_ICAL_URL", icalUrl.trim(), "Canvas URL")}>Update</button>
          </div>
          <button
            className="btn"
            type="button"
            onClick={async () => {
              setSyncStatus("Syncing...");
              const body = await fetchJson("/api/sync", { method: "POST" });
              setSyncStatus(body.message || "Done");
              await onReload();
            }}
          >
            Sync Now
          </button>
          <div className="status-line">{syncStatus}</div>
        </div>
      </section>

      <section className="settings-group open">
        <div className="settings-toggle">Notifications</div>
        <div className="settings-content show">
          <label className="label">Webhook / Target</label>
          <div className="row">
            <input className="input" value={target} onChange={(event) => setTarget(event.target.value)} />
            <button className="btn" type="button" onClick={() => saveSetting("OPENCLAW_TARGET", target.trim(), "notification target")}>Update</button>
          </div>
          <label className="label">Apple ID</label>
          <div className="row">
            <input
              className="input"
              value={iMessage}
              onChange={(event) => setIMessage(event.target.value)}
              placeholder="you@icloud.com"
            />
            <button className="btn" type="button" onClick={() => saveSetting("IMESSAGE_TARGET", iMessage.trim(), "iMessage target")}>Update</button>
          </div>
          <label className="label">Daily Digest Time</label>
          <div className="row">
            <input className="time" type="time" value={digestTime} onChange={(event) => setDigestTime(event.target.value)} />
            <button className="btn" type="button" onClick={() => saveSetting("DIGEST_SCHEDULE_CRON", digestTime, "daily digest time")}>Update</button>
          </div>
          <div className="toggle-wrap">
            <label className="switch">
              <input
                type="checkbox"
                checked={alerts}
                onChange={async (event) => {
                  setAlerts(event.target.checked);
                  await saveSetting("NEW_ASSIGNMENT_ALERTS", event.target.checked ? "true" : "false", "assignment alerts");
                }}
              />
              <span className="slider" />
            </label>
            <span className="small no-margin">New Assignment Alerts</span>
          </div>
          <button
            className="btn"
            type="button"
            onClick={async () => {
              setNotifyStatus("Sending...");
              await saveSetting("SEND_TEST_MESSAGE", "1", "test message");
              setNotifyStatus("Test message sent.");
            }}
          >
            Send Test Message
          </button>
          <button
            className="btn"
            type="button"
            onClick={async () => {
              setDigestPreview("Generating tomorrow's digest preview...");
              const body = await fetchJson("/api/digest/preview");
              const startLabel = body.previewStart ? `Preview window starts ${formatDue(body.previewStart)}\n\n` : "";
              setDigestPreview(`${startLabel}${body.digest || ""}`);
            }}
          >
            Preview Tomorrow's Digest
          </button>
          <div className="status-line">{notifyStatus || status}</div>
          {digestPreview && <div className="digest-preview">{digestPreview}</div>}
        </div>
      </section>

      <section className="settings-group open">
        <div className="settings-toggle">Syllabus Upload</div>
        <div className="settings-content show">
          <label className="label">Existing course</label>
          <div className="row">
            <select className="select" value={syllabusCourse} onChange={(event) => setSyllabusCourse(event.target.value)}>
              <option value="">Choose an existing course</option>
              {courses.map((course) => {
                const value = course.courseCode || course.name || "";
                return value ? <option key={course.id || value} value={value}>{courseLabel(course)}</option> : null;
              })}
            </select>
          </div>
          <div className="small">If the course is not listed, type a new one below.</div>
          <label className="label">New course</label>
          <div className="row">
            <input className="input" value={customCourse} onChange={(event) => setCustomCourse(event.target.value)} placeholder="Type a new course name" />
          </div>
          <div className="row">
            <input className="input" type="file" accept=".pdf" onChange={(event) => setSyllabusFile(event.target.files?.[0] || null)} />
            <button className="btn" type="button" onClick={uploadSyllabus}>Upload & Parse</button>
          </div>
          <div className="status-line">{syllabusStatus}</div>
          {syllabusResult && (
            <div className="digest-preview">
              <strong>Upload summary</strong>
              {"\n"}
              Found {syllabusResult.found ?? 0} item(s), matched {syllabusResult.matched ?? 0} existing assignment(s), created/updated {syllabusResult.created ?? 0} dashboard assignment(s).
              {"\n\n"}
              <strong>Extracted syllabus items</strong>
              {"\n"}
              {(syllabusResult.items || []).length
                ? syllabusResult.items
                    .map((item) => `- ${item.name}${item.dueDate ? ` (${item.dueDate})` : " (no date)"}`)
                    .join("\n")
                : "No items returned by parser."}
              {"\n\n"}
              <strong>Matched existing dashboard assignments</strong>
              {"\n"}
              {(syllabusResult.matchedAssignments || []).length
                ? syllabusResult.matchedAssignments
                    .map((item) => `- ${item.syllabusName}${item.syllabusDueDate ? ` (${item.syllabusDueDate})` : ""} -> ${item.assignmentName} [score ${item.score}]`)
                    .join("\n")
                : "No existing assignments were matched/enriched."}
              {"\n\n"}
              <strong>Created/updated dashboard assignments</strong>
              {"\n"}
              {(syllabusResult.createdAssignments || []).length
                ? syllabusResult.createdAssignments
                    .map((item) => `- ${item.name} (${item.dueDate})`)
                    .join("\n")
                : "No new dated assignments were created."}
              {"\n\n"}
              <strong>Unmatched parser items</strong>
              {"\n"}
              {(syllabusResult.unmatched || []).length
                ? syllabusResult.unmatched
                    .map((item) => `- ${item.name}${item.dueDate ? ` (${item.dueDate})` : " (no date)"}`)
                    .join("\n")
                : "No unmatched parser items."}
              {syllabusResult.skippedNoDate ? `\n\nSkipped ${syllabusResult.skippedNoDate} unmatched item(s) with no date.` : ""}
            </div>
          )}
          <div className="small">
            {uploadedSyllabi.length
              ? uploadedSyllabi.map((item) => `${item.course} - uploaded ${new Date(item.uploadedAt).toLocaleDateString()}`).join("\n")
              : "No syllabi uploaded yet."}
          </div>
        </div>
      </section>

      <section className="settings-group open">
        <div className="settings-content show">
          <div className="toggle-wrap">
            <label className="switch">
              <input
                type="checkbox"
                checked={theme}
                onChange={async (event) => {
                  const next = event.target.checked;
                  setTheme(next);
                  document.body.classList.toggle("dark-mode", next);
                  await saveSetting("UI_THEME", next ? "dark" : "light", `${next ? "dark" : "light"} mode`);
                }}
              />
              <span className="slider" />
            </label>
            <span className="small no-margin">Dark Mode (deep blue)</span>
          </div>
        </div>
      </section>
    </section>
  );
}

function App() {
  const [view, setView] = useState("dashboard");
  const [assignments, setAssignments] = useState([]);
  const [recentAssignments, setRecentAssignments] = useState([]);
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState(BOOT.settings || {});
  const [uploadedSyllabi, setUploadedSyllabi] = useState(BOOT.uploadedSyllabi || []);
  const [courses, setCourses] = useState([]);
  const [selectedDayKey, setSelectedDayKey] = useState(null);
  const [assignmentFilter, setAssignmentFilter] = useState("active");
  const [courseFilter, setCourseFilter] = useState("all");
  const [workloadMode, setWorkloadMode] = useState(7);
  const [drawerId, setDrawerId] = useState(null);
  const [askInput, setAskInput] = useState("");
  const [askResponse, setAskResponse] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadData() {
    const [a, r, s, c] = await Promise.all([
      fetchJson("/api/assignments"),
      fetchJson("/api/assignments/recent"),
      fetchJson("/api/status"),
      fetchJson("/api/courses")
    ]);
    setAssignments(Array.isArray(a.assignments) ? a.assignments : []);
    setRecentAssignments(Array.isArray(r.assignments) ? r.assignments : []);
    setStatus(s);
    setCourses(Array.isArray(c.courses) ? c.courses : []);
    setLoading(false);
  }

  useEffect(() => {
    document.body.classList.toggle("dark-mode", settings.theme === "dark");
  }, [settings.theme]);

  useEffect(() => {
    loadData().catch((error) => {
      setAskResponse(error.message || String(error));
      setLoading(false);
    });
  }, []);

  async function toggleDone(id, isSubmitted) {
    const previous = assignments;
    setAssignments((rows) => rows.map((row) => row.id === id ? { ...row, isSubmitted: isSubmitted ? 1 : 0 } : row));
    try {
      await fetchJson(`/api/assignments/${encodeURIComponent(id)}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isSubmitted })
      });
    } catch (error) {
      setAssignments(previous);
      window.alert(error.message || "Could not update assignment.");
    }
  }

  const drawerAssignment = assignments.find((row) => row.id === drawerId) || null;

  return (
    <div className="app">
      <aside className="sidebar">
        <p className="brand">GradeGuard</p>
        <nav className="nav">
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>Dashboard</button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>Settings</button>
        </nav>
        <hr className="divider" />
        <HealthCard status={status} />
        <section className="ask-box">
          <h3>Ask GradeGuard</h3>
          <textarea rows="2" value={askInput} onChange={(event) => setAskInput(event.target.value)} placeholder="Ask anything about your workload..." />
          <div className="ask-actions">
            <button
              className="btn btn-primary"
              disabled={!askInput.trim()}
              onClick={async () => {
                const message = askInput.trim();
                if (!message) return;
                setAskResponse("");
                const body = await fetchJson("/api/query", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ message })
                });
                setAskResponse(body.response || "");
              }}
            >
              Ask
            </button>
          </div>
          <div className="ask-response">{askResponse}</div>
        </section>
      </aside>

      <main className="main">
        {view === "dashboard" ? (
          <section className="view active">
            <h1>Dashboard</h1>
            {loading ? (
              <div className="empty">Loading dashboard...</div>
            ) : (
              <>
                <Workload
                  assignments={assignments}
                  selectedDayKey={selectedDayKey}
                  setSelectedDayKey={setSelectedDayKey}
                  courseFilter={courseFilter}
                  mode={workloadMode}
                  setMode={setWorkloadMode}
                />
                {recentAssignments.length > 0 && (
                  <section className="section">
                    <div className="recent-header">
                      <span className="pulse-dot" />
                      <h2>Recently Added</h2>
                    </div>
                    <ul className="recent-list">
                      {recentAssignments.slice(0, 5).map((row) => (
                        <li key={row.id}>[{courseKey(row)}] {row.name} - due {formatDue(row.dueAt)}</li>
                      ))}
                    </ul>
                    {recentAssignments.length > 5 && <div className="small">and {recentAssignments.length - 5} more</div>}
                  </section>
                )}
                <AssignmentTable
                  assignments={assignments}
                  filter={assignmentFilter}
                  setFilter={setAssignmentFilter}
                  courseFilter={courseFilter}
                  setCourseFilter={(value) => {
                    setCourseFilter(value);
                    setSelectedDayKey(null);
                  }}
                  selectedDayKey={selectedDayKey}
                  onToggleDone={toggleDone}
                  onOpen={setDrawerId}
                />
              </>
            )}
          </section>
        ) : (
          <Settings
            settings={settings}
            courses={courses}
            uploadedSyllabi={uploadedSyllabi}
            onSettingsChange={(patch) => {
              setSettings((current) => ({ ...current, ...patch }));
            }}
            onReload={async () => {
              await loadData();
            }}
          />
        )}
      </main>
      <AssignmentDrawer assignment={drawerAssignment} onClose={() => setDrawerId(null)} onToggleDone={toggleDone} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
