import type { OverviewItem } from './types';

/**
 * «Одиниця» на екранах: комплекс, а якщо препарат не в комплексі — сам препарат.
 * Призначення однієї одиниці (різні препарати × люди) показуються одним рядком.
 */
export const unitKey = (i: OverviewItem) => (i.group ? `g${i.group.id}` : `d${i.drug.id}`);
export const unitName = (i: OverviewItem) => i.group?.name ?? i.drug.name;

export function groupByUnit(items: OverviewItem[]) {
  const map = new Map<string, OverviewItem[]>();
  for (const i of items) map.set(unitKey(i), [...(map.get(unitKey(i)) ?? []), i]);
  return [...map.values()];
}

/** Препарати одиниці без повторів: «NMN — 500 мг утром» (дозування першої людини, як і раніше) */
export function drugLines(items: OverviewItem[]) {
  const seen = new Map<number, { name: string; dosage: string }>();
  for (const i of items) if (!seen.has(i.drug.id)) seen.set(i.drug.id, { name: i.drug.name, dosage: i.dosage });
  return [...seen.values()];
}

/** Унікальні люди одиниці — для бейджів */
export function uniquePeople(items: OverviewItem[]) {
  return items.filter((i, n) => items.findIndex((x) => x.personId === i.personId) === n);
}

export const afterText = (i: OverviewItem) => (i.after ? `после «${i.after.name}»` : '');
