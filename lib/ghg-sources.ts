import { dbFetch, emitDbChange } from "@/lib/db-client";
import { loadFactorGroups } from "@/lib/emission-factors";
import { parseAppNumber } from "@/lib/number-format";
import { vietnamNow } from "@/lib/vietnam-time";

export type ScopeId = 1 | 2 | 3;
export type GhgScopeId = ScopeId;
export type GhgInputMethod = "meter" | "manual" | "file";

export const GHG_SCOPES: { id: ScopeId; label: string; short: string; desc: string }[] = [
  {
    id: 1,
    label: "Phạm vi 1",
    short: "Scope 1",
    desc: "Phát thải trực tiếp từ nhiên liệu đốt tại chỗ",
  },
  {
    id: 2,
    label: "Phạm vi 2",
    short: "Scope 2",
    desc: "Phát thải gián tiếp từ điện năng mua ngoài",
  },
  {
    id: 3,
    label: "Phạm vi 3",
    short: "Scope 3",
    desc: "Phát thải gián tiếp khác trong chuỗi giá trị",
  },
];

export function scopeLabel(scope: ScopeId) {
  return GHG_SCOPES.find((item) => item.id === scope)?.label ?? `Phạm vi ${scope}`;
}

export type GhgMultiplier = {
  id: string;
  label: string;
  symbol: string;
  value: number;
  unit: string;
};

export type GhgGasFactor = {
  key: string;
  label: string;
  value: number;
  unit?: string;
};

export type GhgEmissionSource = {
  id: string;
  scope: GhgScopeId;
  name: string;
  method: GhgInputMethod;
  factorId: string;
  factorValue: number;
  gases?: GhgGasFactor[];
  multipliers?: GhgMultiplier[];
  formula: string;
  appliedAt: string;
  meterPointId?: string;
  manualValue?: number;
  manualUnit?: string;
  /** Số liệu hoạt động theo từng tháng, key dạng "YYYY-MM" (VD: "2026-01": 120, "2026-11": 59) */
  manualMonthly?: Record<string, number>;
  tons?: number;
};

const sourcesByProject = new Map<string, GhgEmissionSource[]>();

function factorUnitDivisor(factorId: string | undefined) {
  if (!factorId || factorId.startsWith("none:")) return 1;
  const [groupId, gasKey] = factorId.split(":");
  const unit = loadFactorGroups()
    .find((group) => group.id === groupId)
    ?.gases.find((gas) => gas.key === gasKey)?.unit;
  if (!unit) return 1000;
  const normalized = unit.toLowerCase();
  if (normalized.startsWith("t") && normalized.includes("/mwh")) return 1000;
  if (normalized.startsWith("kg")) return 1000;
  return 1;
}

function normalizeTokenExact(raw: string): string {
  return raw
    .trim()
    .replace(/₂/g, "2")
    .replace(/₃/g, "3")
    .replace(/₄/g, "4")
    .replace(/[\s_-]+/g, "")
    .toUpperCase();
}

function normalizeTokenFuzzy(raw: string): string {
  return normalizeTokenExact(raw).replace(/0/g, "O");
}

function isActivityTokenName(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  if (!lower) return false;
  return (
    lower.includes("giá trị") ||
    lower.includes("gia tri") ||
    lower.includes("thủ công") ||
    lower.includes("thu cong") ||
    lower.includes("điểm đo") ||
    lower.includes("diem do") ||
    lower.includes("số liệu") ||
    lower.includes("so lieu") ||
    lower.includes("khối lượng") ||
    lower.includes("khoi luong") ||
    lower.includes("tiêu thụ") ||
    lower.includes("tieu thu") ||
    lower.includes("điện năng") ||
    lower.includes("dien nang") ||
    lower.includes("tải file") ||
    lower.includes("tai file") ||
    lower === "activity" ||
    lower === "manual" ||
    lower === "meter" ||
    lower === "value" ||
    lower === "kwh"
  );
}

/**
 * Đánh giá biểu thức công thức cấu hình của nguồn phát thải.
 * Hỗ trợ:
 * - Token hoạt động: {Giá trị điểm đo}, {Giá trị thủ công}, {Số liệu}, ...
 * - Token khí thành phần: [CO2], [CH4], [N2O] (hoặc {CO2}, {CH4}, {N2O})
 * - Token hệ số nhân: {Q}, {GWPN2O}, {GWPN20}, {GWPCH4}, ...
 * - Toán tử lũy thừa ^ (VD: 10^9 -> 10**9), số thập phân dấu phẩy (0,85 -> 0.85), tự cân bằng ngoặc đơn.
 */
export function evaluateGhgFormula(
  formula: string | undefined,
  activityValue: number,
  factorValue: number,
  multipliers: GhgMultiplier[] | undefined,
  gases?: GhgGasFactor[],
  factorId?: string,
): number | null {
  if (!formula || !formula.trim()) return null;

  const exactMap = new Map<string, number>();
  const fuzzyMap = new Map<string, number>();

  const registerToken = (name: string | undefined, val: number) => {
    if (!name || !name.trim() || !Number.isFinite(val)) return;
    exactMap.set(normalizeTokenExact(name), val);
    fuzzyMap.set(normalizeTokenFuzzy(name), val);
  };

  const safeFactor = Number.isFinite(factorValue) ? factorValue : 0;

  // Khởi tạo giá trị mặc định cho bộ khí IPCC nếu nguồn dùng hệ số dầu DO / nhiên liệu (74 100)
  if (Math.round(safeFactor) === 74100) {
    registerToken("CO2", 74100);
    registerToken("CH4", 3);
    registerToken("N2O", 0.6);
  }

  registerToken("CO2", safeFactor);
  registerToken("EF", safeFactor);
  registerToken("HESOPHATTHAI", safeFactor);
  registerToken("Hệ số phát thải", safeFactor);

  if (factorId && !factorId.startsWith("none:")) {
    const [groupId, gasKey] = factorId.split(":");
    if (gasKey && gasKey !== "none") {
      registerToken(gasKey, safeFactor);
    }
    const groupFromStore = loadFactorGroups().find((g) => g.id === groupId);
    if (groupFromStore?.gases) {
      for (const g of groupFromStore.gases) {
        const gVal = parseAppNumber(g.value, 0);
        registerToken(g.key, gVal);
        registerToken(g.label, gVal);
      }
    }
  }

  if (gases && gases.length > 0) {
    for (const g of gases) {
      const gVal = parseAppNumber(g.value, 0);
      registerToken(g.key, gVal);
      registerToken(g.label, gVal);
    }
  }

  for (const m of multipliers ?? []) {
    const mVal = parseAppNumber(m.value, 0);
    registerToken(m.symbol, mVal);
    registerToken(m.label, mVal);
  }

  const safeActivity = Number.isFinite(activityValue) ? activityValue : 0;

  // Thay thế toàn bộ token {...} và [...]
  let expr = formula.replace(/(\{[^}]+\}|\[[^\]]+\])/g, (token) => {
    const isBracket = token.startsWith("[");
    const inner = token.slice(1, -1).trim();
    if (!inner) return "(0)";

    if (isActivityTokenName(inner)) {
      return `(${safeActivity})`;
    }

    const exactVal = exactMap.get(normalizeTokenExact(inner));
    if (exactVal !== undefined) {
      return `(${exactVal})`;
    }

    const fuzzyVal = fuzzyMap.get(normalizeTokenFuzzy(inner));
    if (fuzzyVal !== undefined) {
      return `(${fuzzyVal})`;
    }

    return isBracket ? `(${safeFactor})` : `(${safeActivity})`;
  });

  // Chuẩn hóa toán tử nhân/chia và định dạng số trong công thức
  expr = expr.replace(/[×xX]/g, "*").replace(/÷/g, "/");
  // Bỏ dấu cách ngăn cách hàng nghìn giữa các chữ số (VD: "43 215" -> "43215")
  expr = expr.replace(/(\d)\s+(?=\d)/g, "$1");
  // Đổi dấu phẩy thập phân giữa các chữ số sang dấu chấm (VD: "0,85" -> "0.85")
  expr = expr.replace(/(\d),(\d)/g, "$1.$2");

  // Tự động cân bằng ngoặc đơn nếu người dùng gõ thừa ")" ở cuối hoặc thiếu ")"
  let depth = 0;
  let prependOpen = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      if (depth > 0) depth -= 1;
      else prependOpen += 1;
    }
  }
  if (prependOpen > 0) {
    expr = "(".repeat(prependOpen) + expr;
  }
  if (depth > 0) {
    expr = expr + ")".repeat(depth);
  }

  // Hỗ trợ toán tử lũy thừa ^ (VD: 10^9 -> 10**9)
  expr = expr.replace(/\^/g, "**");

  if (!/^[0-9+\-*/().\s]+$/.test(expr)) return null;

  try {
    const result = Function(`"use strict"; return (${expr});`)();
    return typeof result === "number" && Number.isFinite(result) ? Math.max(0, result) : null;
  } catch {
    return null;
  }
}

/**
 * Lấy giá trị hoạt động (lít, kg...) của nguồn nhập số liệu / import file cho 1 tháng cụ thể (month: 1..12).
 */
export function getSourceMonthActivity(
  source: Pick<GhgEmissionSource, "manualMonthly" | "manualValue" | "appliedAt">,
  year: number,
  month: number,
): number {
  const mm = String(month).padStart(2, "0");
  const key = `${year}-${mm}`;
  const monthly = source.manualMonthly;

  if (monthly && Object.keys(monthly).length > 0) {
    const val = monthly[key];
    return typeof val === "number" && Number.isFinite(val) ? Math.max(0, val) : 0;
  }

  // Tương thích dữ liệu cũ khi chưa có manualMonthly: gán manualValue vào tháng của appliedAt (hoặc tháng hiện tại)
  if (source.manualValue != null && Number.isFinite(source.manualValue) && source.manualValue > 0) {
    const fallbackMonthKey =
      source.appliedAt && /^\d{4}-\d{2}/.test(source.appliedAt)
        ? source.appliedAt.slice(0, 7)
        : vietnamNow().monthKey;
    if (key === fallbackMonthKey) {
      return source.manualValue;
    }
  }

  return 0;
}

/**
 * Lấy tổng giá trị hoạt động của cả 12 tháng trong năm `year`.
 */
export function getSourceYearActivity(
  source: Pick<GhgEmissionSource, "manualMonthly" | "manualValue" | "appliedAt">,
  year: number,
): number {
  let sum = 0;
  for (let m = 1; m <= 12; m += 1) {
    sum += getSourceMonthActivity(source, year, m);
  }
  return Number(sum.toFixed(6));
}

export function computeManualTons(
  source: Pick<
    GhgEmissionSource,
    "method" | "manualValue" | "factorId" | "factorValue" | "gases" | "multipliers" | "formula"
  >,
  overrideActivityValue?: number,
): number | undefined {
  if (source.method === "meter") return undefined;
  const val =
    overrideActivityValue !== undefined
      ? overrideActivityValue
      : source.manualValue;
  if (val == null || !Number.isFinite(val)) return undefined;
  if (val <= 0) return 0;

  const factor = Number.isFinite(source.factorValue) ? source.factorValue : 0;
  const trimmedFormula = (source.formula ?? "").trim();
  const isDefaultSimpleFormula =
    !trimmedFormula ||
    trimmedFormula === "{Giá trị thủ công} * {Hệ số phát thải}" ||
    trimmedFormula === "{Giá trị thủ công} * [CO2]";

  if (!isDefaultSimpleFormula) {
    const fromFormula = evaluateGhgFormula(
      source.formula,
      val,
      factor,
      source.multipliers,
      source.gases,
      source.factorId,
    );
    if (fromFormula != null) return Number(fromFormula.toFixed(6));
  }

  const divisor = factorUnitDivisor(source.factorId);
  const tons = (val * factor) / divisor;
  return Number(tons.toFixed(6));
}

export function computeMeterSourceTons(
  source: Pick<
    GhgEmissionSource,
    "method" | "meterPointId" | "factorId" | "factorValue" | "gases" | "multipliers" | "formula"
  >,
  kwhByPointId: Record<string, number>,
  fallbackTotalKwh = 0,
): number | undefined {
  if (source.method !== "meter") return undefined;
  const pointKwh = source.meterPointId
    ? (kwhByPointId[source.meterPointId] ?? 0)
    : fallbackTotalKwh;
  const factor = Number.isFinite(source.factorValue) ? source.factorValue : 0;

  const defaultMeterFormula =
    !source.formula ||
    source.formula.trim() === "{Giá trị điểm đo} * {Hệ số phát thải}" ||
    source.formula.trim() === "{Giá trị điểm đo} * [CO2]";
  if (!defaultMeterFormula) {
    const fromFormula = evaluateGhgFormula(
      source.formula,
      pointKwh,
      factor,
      source.multipliers,
      source.gases,
      source.factorId,
    );
    if (fromFormula != null) return Number(fromFormula.toFixed(6));
  }

  const mul = (source.multipliers ?? []).reduce(
    (acc, item) => acc * (Number.isFinite(item.value) ? item.value : 1),
    1,
  );
  const divisor = factorUnitDivisor(source.factorId);
  return Number(((pointKwh * factor * mul) / divisor).toFixed(6));
}

export function computeSourceTons(
  source: GhgEmissionSource,
  kwhByPointId: Record<string, number>,
  fallbackTotalKwh = 0,
  period?: { mode?: "month" | "year"; year?: number; month?: number | string },
): number {
  const fromMeter = computeMeterSourceTons(source, kwhByPointId, fallbackTotalKwh);
  if (fromMeter !== undefined) return fromMeter;

  if (period) {
    const y = period.year ?? vietnamNow().year;
    if (period.mode === "year") {
      const act = getSourceYearActivity(source, y);
      return computeManualTons(source, act) ?? 0;
    }
    if (period.month !== undefined) {
      const m =
        typeof period.month === "string" && period.month.includes("-")
          ? Number(period.month.split("-")[1])
          : Number(period.month);
      if (Number.isFinite(m) && m >= 1 && m <= 12) {
        const act = getSourceMonthActivity(source, y, m);
        return computeManualTons(source, act) ?? 0;
      }
    }
  }

  return computeManualTons(source) ?? source.tons ?? 0;
}

export function loadGhgSources(projectId = "default"): GhgEmissionSource[] {
  return sourcesByProject.get(projectId) ?? [];
}

export function saveGhgSources(sources: GhgEmissionSource[], projectId = "default") {
  const normalized = sources.map((source) => ({
    ...source,
    tons:
      source.method !== "meter"
        ? (computeManualTons(source) ?? source.tons)
        : source.tons,
  }));
  sourcesByProject.set(projectId, normalized);
  emitDbChange("ghg-sources");
  void dbFetch("ghg-sources", {
    method: "POST",
    body: JSON.stringify({ projectId, sources: normalized }),
  }).catch((error) => console.error("Failed to save GHG sources", error));
}

export async function hydrateGhgSources(projectId = "default"): Promise<GhgEmissionSource[]> {
  try {
    const rows = await dbFetch<GhgEmissionSource[]>("ghg-sources", {
      query: { projectId },
    });
    const normalized = rows.map((source) => ({
      ...source,
      tons:
        source.method !== "meter"
          ? (computeManualTons(source) ?? source.tons)
          : source.tons,
    }));
    const prevJson = JSON.stringify(sourcesByProject.get(projectId) ?? null);
    sourcesByProject.set(projectId, normalized);
    if (prevJson !== JSON.stringify(normalized)) {
      emitDbChange("ghg-sources");
    }
    return normalized;
  } catch (error) {
    console.error("Failed to load GHG sources from MySQL", error);
    return sourcesByProject.get(projectId) ?? [];
  }
}
