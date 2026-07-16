import fs from "node:fs";
import path from "node:path";
import { generateText, isLlmConfigured } from "./llm";
import type { SyllabusItem, SyllabusItemType } from "./types";

const ALLOWED_TYPES: SyllabusItemType[] = ["assignment", "exam", "quiz", "project"];

function extractJsonArray(text: string): unknown[] {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced ?? trimmed;

  const first = candidate.indexOf("[");
  const last = candidate.lastIndexOf("]");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("Syllabus parser did not return a JSON array.");
  }

  const jsonSlice = candidate.slice(first, last + 1);
  const parsed = JSON.parse(jsonSlice);
  if (!Array.isArray(parsed)) {
    throw new Error("Syllabus parser JSON root must be an array.");
  }
  return parsed;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNullableDueDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const v = value.trim();
  if (!v) {
    return null;
  }
  // Accept strict YYYY-MM-DD from prompt; relax to null for anything else.
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function normalizeType(value: unknown): SyllabusItemType {
  if (typeof value !== "string") {
    return "assignment";
  }
  const normalized = value.trim().toLowerCase();
  return ALLOWED_TYPES.includes(normalized as SyllabusItemType)
    ? (normalized as SyllabusItemType)
    : "assignment";
}

function normalizeItem(input: unknown): SyllabusItem | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const row = input as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const rawText = typeof row.rawText === "string" ? row.rawText.trim() : "";
  if (!name || !rawText) {
    return null;
  }

  return {
    name,
    type: normalizeType(row.type),
    dueDate: toNullableDueDate(row.dueDate),
    points: toNullableNumber(row.points),
    weight: toNullableNumber(row.weight),
    rawText
  };
}

function normalizeNameKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\bexam\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function monthNumber(month: string): string | null {
  const months: Record<string, string> = {
    january: "01",
    jan: "01",
    february: "02",
    feb: "02",
    march: "03",
    mar: "03",
    april: "04",
    apr: "04",
    may: "05",
    june: "06",
    jun: "06",
    july: "07",
    jul: "07",
    august: "08",
    aug: "08",
    september: "09",
    sep: "09",
    sept: "09",
    october: "10",
    oct: "10",
    november: "11",
    nov: "11",
    december: "12",
    dec: "12"
  };
  return months[month.trim().toLowerCase().replace(/\.$/, "")] ?? null;
}

function parseLongDate(value: string): string | null {
  const match = value.match(
    /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)?,?\s*([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i
  );
  if (!match) {
    return null;
  }

  const month = monthNumber(match[1]);
  if (!month) {
    return null;
  }
  return `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

function normalizeScheduleItemName(value: string): string | null {
  const cleaned = value.replace(/^[-•●➢\s]+/, "").replace(/\s+/g, " ").trim();
  if (!cleaned || /review|section|lecture|class|slides|chapter|reading|q&a/i.test(cleaned)) {
    return null;
  }
  if (/^final$/i.test(cleaned)) {
    return "Final Exam";
  }
  if (/^mid[-\s]?term(?:\s+exam)?$/i.test(cleaned)) {
    return "Midterm Exam";
  }
  if (/\b(final|mid[-\s]?term|homework\s*\d+|assignment\s*\d+|project\s*\d+|quiz\s*\d+)\b/i.test(cleaned)) {
    return cleaned;
  }
  return null;
}

function typeFromName(name: string): SyllabusItemType {
  if (/mid[-\s]?term|final|exam/i.test(name)) {
    return "exam";
  }
  if (/quiz/i.test(name)) {
    return "quiz";
  }
  if (/project/i.test(name)) {
    return "project";
  }
  return "assignment";
}

function extractExplicitDatedScheduleItems(rawText: string): SyllabusItem[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const items: SyllabusItem[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const dueDate = parseLongDate(lines[index]);
    if (!dueDate) {
      continue;
    }

    let name: string | null = normalizeScheduleItemName(lines[index]);
    for (let lookback = 1; !name && lookback <= 4 && index - lookback >= 0; lookback += 1) {
      name = normalizeScheduleItemName(lines[index - lookback]);
    }

    if (!name) {
      continue;
    }

    items.push({
      name,
      type: typeFromName(name),
      dueDate,
      points: null,
      weight: null,
      rawText: `${name} ${lines[index]}`
    });
  }

  return items;
}

function mergeSyllabusItems(items: SyllabusItem[]): SyllabusItem[] {
  const byName = new Map<string, SyllabusItem>();

  for (const item of items) {
    const key = normalizeNameKey(item.name);
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, item);
      continue;
    }

    if (!existing.dueDate && item.dueDate) {
      byName.set(key, {
        ...existing,
        dueDate: item.dueDate,
        type: item.type,
        rawText: item.rawText || existing.rawText
      });
    }
  }

  return Array.from(byName.values());
}

function buildPrompt(rawText: string): string {
  return `Extract all assignments, exams, quizzes, and projects from this syllabus text.
Return ONLY a JSON array matching this exact schema:
[{ "name": string, "type": "assignment"|"exam"|"quiz"|"project", "dueDate": "YYYY-MM-DD or null if unclear", "points": number|null, "weight": number|null, "rawText": string }]

Rules:
- Do not include markdown fences.
- Keep dates in YYYY-MM-DD when clear, otherwise null.
- If an assignment/exam name appears on one schedule line and the date appears on the next line, pair them.
- Keep rawText concise and directly attributable to syllabus content.

Syllabus text:
${rawText}`;
}

export async function extractSyllabusItemsFromText(rawText: string): Promise<SyllabusItem[]> {
  if (!rawText.trim()) {
    return [];
  }
  if (!isLlmConfigured()) {
    throw new Error("LLM is not configured; syllabus extraction requires an LLM key.");
  }

  const response = await generateText(buildPrompt(rawText));
  const parsed = extractJsonArray(response);
  const llmItems = parsed.map(normalizeItem).filter((item): item is SyllabusItem => item !== null);
  return mergeSyllabusItems([...llmItems, ...extractExplicitDatedScheduleItems(rawText)]);
}

export async function extractSyllabusTextFromFile(filePath: string): Promise<string> {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const ext = path.extname(absolutePath).toLowerCase();

  if (ext === ".txt" || ext === ".md") {
    return fs.readFileSync(absolutePath, "utf8");
  }

  if (ext === ".pdf") {
    const buffer = fs.readFileSync(absolutePath);
    const { default: pdfParse } = await import("pdf-parse");
    const parsed = await pdfParse(buffer);
    return parsed.text || "";
  }

  throw new Error(`Unsupported syllabus file extension "${ext}". Use .pdf or .txt.`);
}

export async function extractSyllabusItemsFromFile(filePath: string): Promise<SyllabusItem[]> {
  const rawText = await extractSyllabusTextFromFile(filePath);
  return extractSyllabusItemsFromText(rawText);
}
