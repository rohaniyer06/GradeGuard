import {
  listAssignmentsBetween,
  listAssignmentSnapshotForLlm,
  listOverdueAssignments
} from "./db";
import { generateText, isLlmConfigured } from "./llm";
import { formatMetadataSuffix } from "./syllabusMetadata";

function normalize(input: string): string {
  return input.trim().toLowerCase();
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function formatLine(item: {
  name: string;
  dueAt: string;
  courseName: string;
  pointsPossible?: number | null;
  submissionTypes?: string | null;
}): string {
  const base = `${item.name} (${item.courseName}) due ${new Date(item.dueAt).toLocaleString()}`;
  return `${base}${formatMetadataSuffix({
    pointsPossible: item.pointsPossible,
    submissionTypes: item.submissionTypes
  })}`;
}

function answerDueThisWeek(): string {
  const rows = listAssignmentsBetween(new Date().toISOString(), isoDaysFromNow(7));
  if (!rows.length) {
    return "You have no assignments due in the next 7 days.";
  }
  return ["Assignments due this week:", ...rows.map(formatLine)].join("\n");
}

function answerNextExamForCourse(userMessage: string): string {
  const allRows = listAssignmentsBetween(new Date().toISOString(), isoDaysFromNow(45));
  const msg = normalize(userMessage);
  const courseFiltered = allRows.filter((row) => normalize(row.courseName).includes(msg) || msg.includes(normalize(row.courseName)));
  const examFiltered = (courseFiltered.length ? courseFiltered : allRows).filter((row) =>
    /(exam|midterm|final|quiz)/i.test(row.name)
  );
  if (!examFiltered.length) {
    return "I couldn't find an upcoming exam or quiz matching that course.";
  }
  const next = examFiltered[0];
  return `Your next exam/quiz is ${formatLine(next)}.`;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function answerHeaviestWeek(): string {
  const rows = listAssignmentsBetween(new Date().toISOString(), isoDaysFromNow(120));
  if (!rows.length) {
    return "I don't see upcoming assignments to analyze yet.";
  }
  const counts = new Map<string, number>();
  for (const row of rows) {
    const week = startOfWeek(new Date(row.dueAt)).toISOString().slice(0, 10);
    counts.set(week, (counts.get(week) || 0) + 1);
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const [week, count] = sorted[0];
  return `Your heaviest upcoming week starts ${week} with ${count} assignments due.`;
}

function answerMissedItems(): string {
  const rows = listOverdueAssignments();
  if (!rows.length) {
    return "You don't have any missed assignments right now.";
  }
  return ["You may have missed:", ...rows.map(formatLine)].join("\n");
}

function fallbackAnswer(userMessage: string): string {
  const message = normalize(userMessage);
  if (/what('?s| is)? due (this|next)? ?week/.test(message) || message.includes("due this week")) {
    return answerDueThisWeek();
  }
  if (message.includes("next exam") || message.includes("next quiz") || message.includes("midterm")) {
    return answerNextExamForCourse(userMessage);
  }
  if (message.includes("heaviest week")) {
    return answerHeaviestWeek();
  }
  if (message.includes("what did i miss") || message.includes("overdue") || message.includes("missed")) {
    return answerMissedItems();
  }

  return "I can help with due dates, next exams/quizzes, heaviest week, and missed assignments.";
}

export async function handleQuery(userMessage: string): Promise<string> {
  if (!isLlmConfigured()) {
    return fallbackAnswer(userMessage);
  }

  const dbSnapshot = listAssignmentSnapshotForLlm();
  const prompt = `You are a college academic assistant. Answer the student's question using ONLY the data below. Be direct and conversational. No markdown formatting.

Student's courses and assignments (JSON):
${JSON.stringify(dbSnapshot, null, 2)}

Student's question: "${userMessage}"`;

  try {
    return await generateText(prompt);
  } catch {
    return fallbackAnswer(userMessage);
  }
}
