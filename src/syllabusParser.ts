import fs from "node:fs";
import path from "node:path";
import pdfParse from "pdf-parse";
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

function buildPrompt(rawText: string): string {
  return `Extract all assignments, exams, quizzes, and projects from this syllabus text.
Return ONLY a JSON array matching this exact schema:
[{ "name": string, "type": "assignment"|"exam"|"quiz"|"project", "dueDate": "YYYY-MM-DD or null if unclear", "points": number|null, "weight": number|null, "rawText": string }]

Rules:
- Do not include markdown fences.
- Keep dates in YYYY-MM-DD when clear, otherwise null.
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
  return parsed.map(normalizeItem).filter((item): item is SyllabusItem => item !== null);
}

export async function extractSyllabusTextFromFile(filePath: string): Promise<string> {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const ext = path.extname(absolutePath).toLowerCase();

  if (ext === ".txt" || ext === ".md") {
    return fs.readFileSync(absolutePath, "utf8");
  }

  if (ext === ".pdf") {
    const buffer = fs.readFileSync(absolutePath);
    const parsed = await pdfParse(buffer);
    return parsed.text || "";
  }

  throw new Error(`Unsupported syllabus file extension "${ext}". Use .pdf or .txt.`);
}

export async function extractSyllabusItemsFromFile(filePath: string): Promise<SyllabusItem[]> {
  const rawText = await extractSyllabusTextFromFile(filePath);
  return extractSyllabusItemsFromText(rawText);
}
