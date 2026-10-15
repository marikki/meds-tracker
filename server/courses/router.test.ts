import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCoursesRouter, openMedsDb, upsertPeople } from '.';

let base = '';
let close: () => void;

beforeAll(async () => {
  const db = openMedsDb(':memory:');
  upsertPeople(db, [
    { id: 'marina', name: 'Марина' },
    { id: 'husband', name: 'Муж' },
  ]);
  const app = express();
  app.use('/api/courses', createCoursesRouter({ db, today: () => '2026-10-14' }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/courses`;
  close = () => server.close();
});
afterAll(() => close());

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: res.status === 204 ? null : await res.json() };
};

describe('courses router', () => {
  let magnesiumIds: number[] = [];

  it('створює препарат з призначеннями для двох людей', async () => {
    const r = await call('POST', '/drugs', {
      name: 'Магний',
      kind: 'supplement',
      courseDays: 30,
      breakDays: 60,
      coursesPerYear: 3,
      prescriptions: [
        { personId: 'marina', dosage: '1 капс. вечером' },
        { personId: 'husband', dosage: '2 капс. вечером' },
      ],
    });
    expect(r.status).toBe(201);
    const drugs = (await call('GET', '/drugs')).json;
    magnesiumIds = drugs[0].prescriptions.map((p: { id: number }) => p.id);
    expect(magnesiumIds).toHaveLength(2);
  });

  it('не приймали — статус due', async () => {
    const { json } = await call('GET', '/overview');
    expect(json.items.map((i: any) => i.forecast.status)).toEqual(['due', 'due']);
  });

  it('стартує курс для обох однією датою', async () => {
    const r = await call('POST', '/courses', { startDate: '2026-10-14', prescriptionIds: magnesiumIds });
    expect(r.status).toBe(201);
    expect(r.json[0].planned_end_date).toBe('2026-11-12');
    const { json } = await call('GET', '/overview?person=marina');
    expect(json.items).toHaveLength(1);
    expect(json.items[0].forecast).toMatchObject({ status: 'active', nextStartDate: '2027-01-12' });
  });

  it('не дає створити курс, що перетинається', async () => {
    const r = await call('POST', '/courses', { startDate: '2026-11-01', prescriptionIds: [magnesiumIds[0]] });
    expect(r.status).toBe(409);
  });

  it('дострокове завершення зсуває прогноз', async () => {
    const courses = (await call('GET', `/prescriptions/${magnesiumIds[0]}/courses`)).json;
    const id = courses[0].id;
    // дату в майбутньому не приймаємо
    expect((await call('PATCH', `/courses/${id}`, { endedEarlyOn: '2026-10-20' })).status).toBe(400);
    // переносимо старт назад (забули внести вчасно) — плановий кінець зсувається разом
    const moved = await call('PATCH', `/courses/${id}`, { startDate: '2026-10-01' });
    expect(moved.json.planned_end_date).toBe('2026-10-30');
    const r = await call('PATCH', `/courses/${id}`, { endedEarlyOn: '2026-10-10' });
    expect(r.status).toBe(200);
    const { json } = await call('GET', '/overview?person=marina');
    expect(json.items[0].forecast).toMatchObject({ status: 'break', nextStartDate: '2026-12-10' });
  });

  it('валідує вхід', async () => {
    expect((await call('POST', '/drugs', { name: 'X', kind: 'pill', courseDays: 1, breakDays: 0 })).status).toBe(400);
    expect((await call('POST', '/courses', { startDate: '2026-02-30', prescriptionIds: [1] })).status).toBe(400);
  });

  it('назва унікальна без урахування регістру — і для кирилиці теж', async () => {
    expect((await call('POST', '/drugs', { name: 'МАГНИЙ', kind: 'supplement', courseDays: 1, breakDays: 0 })).status).toBe(409);
    const omega = await call('POST', '/drugs', { name: 'Омега-3', kind: 'supplement', courseDays: 60, breakDays: 30 });
    expect(omega.status).toBe(201);
    expect((await call('PATCH', `/drugs/${omega.json.id}`, { name: 'магний' })).status).toBe(409);
    // власну назву можна змінити лише регістром
    expect((await call('PATCH', `/drugs/${omega.json.id}`, { name: 'ОМЕГА-3' })).status).toBe(200);
  });
});
