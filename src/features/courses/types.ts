// Відповіді API модуля (див. server/courses/router.ts)
export type ISODate = string;
/** done — курс закінчився, а повтор лише за рішенням (manualRepeat) */
export type Status = 'active' | 'due' | 'break' | 'done';

export interface Person { id: string; name: string }

export interface Drug {
  id: number;
  name: string;
  kind: 'supplement' | 'peptide';
  /** null — без срока: курс идёт, пока его не завершат */
  courseDays: number | null;
  breakDays: number;
  coursesPerYear: number | null;
  /** Не повторять автоматически: после курса — «завершён», а не «пора начинать» */
  manualRepeat: boolean;
  notes: string;
  archived: boolean;
  /** Комплекс; схема і afterDrugId/afterGroupId тоді скопійовані з нього */
  groupId: number | null;
  afterDrugId: number | null;
  afterGroupId: number | null;
  /** Контроль аналізом: який і коли від старту курсу; null — не потрібен */
  check: CheckScheme | null;
}

/** «25(OH)D через 42–56 днів від старту» */
export interface CheckScheme { name: string; fromDays: number; toDays: number }

/** Аналіз у межах курсу: GET /history (здані) */
export interface LabCheck {
  id: number;
  name: string;
  /** Вікно, коли здати; null — не призначалося */
  dueFrom: ISODate | null;
  dueTo: ISODate | null;
  doneOn: ISODate | null;
  result: string;
  note: string;
}

/** Аналіз, що чекає на здачу в курсі, який іде; id = null — перший, за схемою препарату */
export interface PendingCheck {
  id: number | null;
  courseId: number;
  name: string;
  dueFrom: ISODate | null;
  dueTo: ISODate | null;
}

/** Комплекс: GET /groups */
export interface DrugGroup {
  id: number;
  name: string;
  courseDays: number | null;
  breakDays: number;
  coursesPerYear: number | null;
  manualRepeat: boolean;
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
  courseDays: number | null;
  breakDays: number;
  coursesPerYear: number | null;
  manualRepeat: boolean;
  afterDrugId: number | null;
  afterGroupId: number | null;
  check: CheckScheme | null;
  notes: string;
  prescriptions: { personId: string; dosage: string }[];
}

/** Рядок курсу як його віддає сервер: GET /prescriptions/:id/courses, PATCH /courses/:id */
export interface CourseRow {
  id: number;
  prescription_id: number;
  start_date: ISODate;
  /** null — курс без срока */
  planned_end_date: ISODate | null;
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
  /** Фактичний кінець (з урахуванням дострокового); null — без строку, ще йде */
  endDate: ISODate | null;
  /** Здані аналізи */
  checks: LabCheck[];
}

export interface Forecast {
  status: Status;
  /** endDate и totalDays — null, если курс без срока */
  activeCourse: { startDate: ISODate; endDate: ISODate | null; day: number; totalDays: number | null } | null;
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
  /** Аналіз, який треба здати в курсі, що йде */
  check: PendingCheck | null;
}

export interface Overview { today: ISODate; items: OverviewItem[] }

/** Відрізок на діаграмі: actual — був або йде, forecast — прогноз за схемою (обрізані межами періоду) */
export interface PlanCourse { startDate: ISODate; endDate: ISODate; kind: 'actual' | 'forecast' }

export interface PlanRow {
  prescriptionId: number;
  personId: string;
  drugId: number;
  drugName: string;
  group: { id: number; name: string } | null;
  courses: PlanCourse[];
}

/** GET /plan?from=&to=&person= */
export interface Plan { today: ISODate; from: ISODate; to: ISODate; rows: PlanRow[] }
