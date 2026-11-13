import { dbFetch, emitDbChange } from "@/lib/db-client";
import { formatAppNumber, parseAppNumber } from "@/lib/number-format";

export type GasKey = "co2" | "ch4" | "n2o";

export type GasValue = {
  key: GasKey | string;
  label: string;
  value: number;
  unit: string;
};

export type FactorGroup = {
  id: string;
  name: string;
  source: string;
  gases: GasValue[];
};

let factorGroupsCache: FactorGroup[] = [];
let factorsHydration: Promise<FactorGroup[]> | null = null;

export function parseFactorNumber(value: string) {
  return parseAppNumber(value, 0);
}

export function formatFactorValue(value: number) {
  return formatAppNumber(value, { maxDecimals: 6 });
}

export function loadFactorGroups(): FactorGroup[] {
  return factorGroupsCache;
}

export function saveFactorGroups(groups: FactorGroup[]) {
  factorGroupsCache = groups;
  emitDbChange("emission-factors");
  for (const group of groups) {
    void dbFetch("emission-factors", {
      method: "POST",
      body: JSON.stringify(group),
    }).catch((error) => console.error("Không thể lưu hệ số phát thải", error));
  }
}

export function hydrateFactorGroups() {
  if (typeof window === "undefined") return Promise.resolve(loadFactorGroups());
  if (factorsHydration) return factorsHydration;
  factorsHydration = dbFetch<FactorGroup[]>("emission-factors")
    .then((groups) => {
      const prevJson = JSON.stringify(factorGroupsCache);
      factorGroupsCache = groups;
      if (prevJson !== JSON.stringify(groups)) {
        emitDbChange("emission-factors");
      }
      return factorGroupsCache;
    })
    .catch(() => factorGroupsCache)
    .finally(() => {
      factorsHydration = null;
    });
  return factorsHydration;
}

export function upsertFactorGroup(group: FactorGroup) {
  const groups = loadFactorGroups();
  const exists = groups.some((item) => item.id === group.id);
  const next = exists
    ? groups.map((item) => (item.id === group.id ? group : item))
    : [group, ...groups];
  saveFactorGroups(next);
  return next;
}

export function removeFactorGroup(id: string) {
  const next = loadFactorGroups().filter((item) => item.id !== id);
  factorGroupsCache = next;
  emitDbChange("emission-factors");
  void dbFetch("emission-factors", {
    method: "DELETE",
    query: { id },
  }).catch((error) => console.error("Không thể xóa nhóm hệ số phát thải", error));
  return next;
}

export type LibraryFactor = {
  id: string;
  groupId: string;
  name: string;
  source: string;
  gasKey: GasKey | string;
  gasLabel: string;
  value: number;
  unit: string;
};

export function flattenFactorGroups(groups: FactorGroup[]): LibraryFactor[] {
  return groups.flatMap((group) =>
    group.gases.map((gas) => ({
      id: `${group.id}:${gas.key}`,
      groupId: group.id,
      name: group.name,
      source: group.source,
      gasKey: gas.key,
      gasLabel: gas.label,
      value: gas.value,
      unit: gas.unit,
    })),
  );
}
