// Відповіді API модуля (див. server/courses/router.ts)
export type ISODate = string;
export type Status = 'active' | 'due' | 'break';

export interface Person { id: string; name: string }

export interface Drug {
  id: number;
  name: string;
  kind: 'supplement' | 'peptide';
  courseDays: number;
  breakDays: number;
  coursesPerYear: number | null;
  notes: string;
  archived: boolean;
}

export interface DrugPrescription { id: number; personId: string; dosage: string }

/** Елемент довідника: GET /drugs */
export interface DrugWithPrescriptions extends Drug { prescriptions: DrugPrescription[] }

/** Тіло POST /drugs і PATCH /drugs/:id */
export interface DrugInput {
  name: string;
  kind: Drug['kind'];
  courseDays: number;
  breakDays: number;
  coursesPerYear: number | null;
  notes: string;
  prescriptions: { personId: string; dosage: string }[];
}

export interface Forecast {
  status: Status;
  activeCourse: { startDate: ISODate; endDate: ISODate; day: number; totalDays: number } | null;
  lastEndDate: ISODate | null;
  nextStartDate: ISODate | null;
  overdueDays: number;
}

export interface OverviewItem {
  prescriptionId: number;
  personId: string;
  dosage: string;
  drug: Drug;
  forecast: Forecast;
}

export interface Overview { today: ISODate; items: OverviewItem[] }
