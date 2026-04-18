export interface Course {
  id: string;
  name: string;
  courseCode: string | null;
  term: string | null;
  isActive: number;
}

export interface Assignment {
  id: string;
  courseId: string;
  name: string;
  description: string | null;
  dueAt: string;
  pointsPossible: number | null;
  submissionTypes: string | null;
  isSubmitted: number;
  calendarEventId: string | null;
  notifiedAt: string | null;
}

export interface AssignmentWithCourse extends Assignment {
  courseName: string;
  courseCode: string | null;
}

export type SyllabusItemType = "assignment" | "exam" | "quiz" | "project";

export interface SyllabusItem {
  name: string;
  type: SyllabusItemType;
  dueDate: string | null;
  points: number | null;
  weight: number | null;
  rawText: string;
}
