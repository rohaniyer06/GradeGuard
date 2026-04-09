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
