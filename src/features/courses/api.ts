import type {
  CourseRow,
  Drug,
  DrugGroup,
  DrugInput,
  DrugWithPrescriptions,
  GroupInput,
  HistoryCourse,
  Overview,
  Person,
  Plan,
} from './types';

/** Клієнт без глобального стану: базовий URL передає хост (окремий застосунок чи FamilyHub). */
export function createApi(base: string) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(base + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data as T;
  }

  return {
    people: () => request<Person[]>('GET', '/people'),
    drugs: () => request<DrugWithPrescriptions[]>('GET', '/drugs'),
    createDrug: (input: DrugInput) => request<Drug>('POST', '/drugs', input),
    updateDrug: (id: number, patch: Partial<DrugInput> & { archived?: boolean }) =>
      request<Drug>('PATCH', `/drugs/${id}`, patch),
    groups: () => request<DrugGroup[]>('GET', '/groups'),
    createGroup: (input: GroupInput) => request<DrugGroup>('POST', '/groups', input),
    updateGroup: (id: number, patch: Partial<GroupInput>) => request<DrugGroup>('PATCH', `/groups/${id}`, patch),
    deleteGroup: (id: number) => request<void>('DELETE', `/groups/${id}`),
    overview: (person: string) => request<Overview>('GET', `/overview?person=${encodeURIComponent(person)}`),
    plan: (from: string, to: string, person: string) =>
      request<Plan>('GET', `/plan?from=${from}&to=${to}&person=${encodeURIComponent(person)}`),
    /** endDate — для минулого курсу заднім числом */
    startCourses: (startDate: string, prescriptionIds: number[], endDate?: string) =>
      request('POST', '/courses', { startDate, prescriptionIds, endDate }),
    history: (target: { drugId: number } | { groupId: number }) =>
      request<{ today: string; courses: HistoryCourse[] }>(
        'GET',
        'drugId' in target ? `/history?drug=${target.drugId}` : `/history?group=${target.groupId}`,
      ),
    prescriptionCourses: (prescriptionId: number) =>
      request<CourseRow[]>('GET', `/prescriptions/${prescriptionId}/courses`),
    updateCourse: (id: number, patch: { startDate?: string; endDate?: string; endedEarlyOn?: string | null }) =>
      request<CourseRow>('PATCH', `/courses/${id}`, patch),
    deleteCourse: (id: number) => request<void>('DELETE', `/courses/${id}`),
  };
}

export type CoursesApi = ReturnType<typeof createApi>;
