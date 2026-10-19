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

  it('комплекс: спільна схема і один прогноз для всіх препаратів', async () => {
    const mk = (name: string) =>
      call('POST', '/drugs', {
        name, kind: 'supplement', courseDays: 90, breakDays: 0,
        prescriptions: [{ personId: 'marina', dosage: '' }],
      });
    const b9 = (await mk('B9')).json;
    const b12 = (await mk('B12')).json;
    const nmn = (await mk('NMN')).json;
    const nr = (await mk('NR')).json;

    const vitB = await call('POST', '/groups', {
      name: 'Витамины B', courseDays: 90, breakDays: 0, coursesPerYear: 2, drugIds: [b9.id, b12.id],
    });
    expect(vitB.status).toBe(201);
    const nad = await call('POST', '/groups', {
      name: 'NAD+', courseDays: 42, breakDays: 60, afterGroupId: vitB.json.id, drugIds: [nmn.id, nr.id],
    });
    expect(nad.status).toBe(201);
    expect(nad.json.drugIds.sort()).toEqual([nmn.id, nr.id].sort());

    // схема комплексу скопійована в препарати, і правка препарату її не перебиває
    await call('PATCH', `/drugs/${nmn.id}`, { courseDays: 5 });
    const drugs = (await call('GET', '/drugs')).json;
    expect(drugs.find((d: any) => d.id === nmn.id)).toMatchObject({
      courseDays: 42, breakDays: 60, groupId: nad.json.id, afterGroupId: vitB.json.id,
    });

    // стартуємо вітаміни B — NAD+ переїжджає на день після їх кінця
    const bIds = (await call('GET', '/overview?person=marina')).json.items
      .filter((i: any) => i.group?.id === vitB.json.id)
      .map((i: any) => i.prescriptionId);
    await call('POST', '/courses', { startDate: '2026-10-01', prescriptionIds: bIds });
    const nadItems = (await call('GET', '/overview?person=marina')).json.items.filter(
      (i: any) => i.group?.id === nad.json.id,
    );
    expect(nadItems).toHaveLength(2);
    for (const i of nadItems) {
      expect(i.after).toEqual({ kind: 'group', id: vitB.json.id, name: 'Витамины B' });
      expect(i.forecast).toMatchObject({ status: 'break', nextStartDate: '2026-12-30' });
    }
  });

  it('комплекс: валідація і розформування', async () => {
    const groups = (await call('GET', '/groups')).json;
    const nad = groups.find((g: any) => g.name === 'NAD+');
    // не можна після самого себе чи свого препарату
    expect((await call('PATCH', `/groups/${nad.id}`, { afterGroupId: nad.id })).status).toBe(400);
    expect((await call('PATCH', `/groups/${nad.id}`, { afterDrugId: nad.drugIds[0] })).status).toBe(400);
    expect((await call('POST', '/groups', { name: 'nad+', courseDays: 1, breakDays: 0 })).status).toBe(409);

    expect((await call('DELETE', `/groups/${nad.id}`)).status).toBe(204);
    const nmn = (await call('GET', '/drugs')).json.find((d: any) => d.name === 'NMN');
    // препарат лишився зі схемою комплексу, але вже сам по собі
    expect(nmn).toMatchObject({ groupId: null, courseDays: 42 });
  });

  it('препарат сам по собі теж може починатися після іншого', async () => {
    const drugs = (await call('GET', '/drugs')).json;
    const nmn = drugs.find((d: any) => d.name === 'NMN');
    const b12 = drugs.find((d: any) => d.name === 'B12');
    expect((await call('PATCH', `/drugs/${nmn.id}`, { afterDrugId: nmn.id })).status).toBe(400);
    const r = await call('PATCH', `/drugs/${nmn.id}`, { afterDrugId: b12.id });
    expect(r.json).toMatchObject({ afterDrugId: b12.id, afterGroupId: null });
    const item = (await call('GET', '/overview?person=marina')).json.items.find((i: any) => i.drug.id === nmn.id);
    expect(item.forecast.nextStartDate).toBe('2026-12-30');
  });

  it('минулий курс заднім числом: свій кінець, правка і історія', async () => {
    const drug = (await call('POST', '/drugs', {
      name: 'Цинк', kind: 'supplement', courseDays: 60, breakDays: 30,
      prescriptions: [{ personId: 'marina', dosage: '' }, { personId: 'husband', dosage: '' }],
    })).json;
    const pids = (await call('GET', '/drugs')).json.find((d: any) => d.id === drug.id).prescriptions.map((p: any) => p.id);

    // кінець раніше старту — не можна
    expect((await call('POST', '/courses', { startDate: '2026-03-01', endDate: '2026-02-01', prescriptionIds: pids })).status).toBe(400);

    const r = await call('POST', '/courses', { startDate: '2026-03-01', endDate: '2026-04-10', prescriptionIds: pids });
    expect(r.status).toBe(201);
    expect(r.json[0].planned_end_date).toBe('2026-04-10');
    const { json } = await call('GET', '/overview?person=marina');
    // прогноз від фактичного кінця: 10.04 + 30 днів перерви
    expect(json.items.find((i: any) => i.drug.id === drug.id).forecast).toMatchObject({ status: 'due', nextStartDate: '2026-05-11' });

    const h = (await call('GET', `/history?drug=${drug.id}`)).json;
    expect(h.courses).toHaveLength(2);
    expect(h.courses[0]).toMatchObject({ startDate: '2026-03-01', endDate: '2026-04-10', drugName: 'Цинк' });

    // правка кінця напряму
    const id = h.courses[0].id;
    expect((await call('PATCH', `/courses/${id}`, { startDate: '2026-03-01', endDate: '2026-02-01' })).status).toBe(400);
    const e = await call('PATCH', `/courses/${id}`, { startDate: '2026-03-05', endDate: '2026-05-01' });
    expect(e.json).toMatchObject({ start_date: '2026-03-05', planned_end_date: '2026-05-01', ended_early_on: null });

    expect((await call('GET', '/history')).status).toBe(400);
    const groups = (await call('GET', '/groups')).json;
    const vitB = groups.find((g: any) => g.name === 'Витамины B');
    expect((await call('GET', `/history?group=${vitB.id}`)).json.courses.length).toBeGreaterThan(0);
  });
});
