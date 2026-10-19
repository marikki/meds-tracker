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
  /** Комплекс; схема і afterDrugId/afterGroupId тоді скопійовані з нього */
  groupId: number | null;
  afterDrugId: number | null;
  afterGroupId: number | null;
}

/** Комплекс: GET /groups */
export interface DrugGroup {
  id: number;
  name: string;
  courseDays: number;
  breakDays: number;
  coursesPerYear: number | null;
  afterDrugId: number | null;
  afterGroupId: number | null;
  notes: string;
  drugIds: number[];
}

/** Тіло POST /groups і PATCH /groups/:id */
export type GroupInput = Omit<DrugGroup, 'id'>;

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
  afterDrugId: number | null;
  afterGroupId: number | null;
  notes: string;
  prescriptions: { personId: string; dosage: string }[];
}

/** Рядок курсу як його віддає сервер: GET /prescriptions/:id/courses, PATCH /courses/:id */
export interface CourseRow {
  id: number;
  prescription_id: number;
  start_date: ISODate;
  planned_end_date: ISODate;
  ended_early_on: ISODate | null;
}

/** Курс в історії: GET /history?drug= | ?group= */
export interface HistoryCourse {
  id: number;
  prescriptionId: number;
  personId: string;
  drugId: number;
  drugName: string;
  startDate: ISODate;
  /** Фактичний кінець (з урахуванням дострокового) */
  endDate: ISODate;
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
  group: { id: number; name: string } | null;
  /** «Начинать после»: препарат или комплекс */
  after: { kind: 'drug' | 'group'; id: number; name: string } | null;
  forecast: Forecast;
}

export interface Overview { today: ISODate; items: OverviewItem[] }
