export interface ParsedSyllabusMetadata {
  source?: string;
  type?: string | null;
  weight?: number | null;
  rawText?: string | null;
}

export function parseSyllabusMetadata(submissionTypes: string | null): ParsedSyllabusMetadata | null {
  if (!submissionTypes || !submissionTypes.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(submissionTypes) as ParsedSyllabusMetadata;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function formatMetadataSuffix(params: {
  pointsPossible?: number | null;
  submissionTypes?: string | null;
}): string {
  const bits: string[] = [];
  if (typeof params.pointsPossible === "number" && Number.isFinite(params.pointsPossible)) {
    bits.push(`${params.pointsPossible} pts`);
  }
  const metadata = parseSyllabusMetadata(params.submissionTypes ?? null);
  if (metadata?.type) {
    bits.push(String(metadata.type));
  }
  if (typeof metadata?.weight === "number" && Number.isFinite(metadata.weight)) {
    bits.push(`${metadata.weight}%`);
  }
  return bits.length ? ` [${bits.join(" · ")}]` : "";
}
