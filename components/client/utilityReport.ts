/**
 * Báo cáo cho loại điểm đo không phải điện (Nước, Nhiệt, Hơi, Khí nén …).
 * Số liệu lấy từ mẫu gateway theo các thông số khai báo ở "Hàm nhận dữ liệu từ gateway" của đồng hồ:
 * - sản lượng tiêu thụ: từ thông số đánh dấu "Cộng dồn" (chỉ số tích lũy);
 * - các thông số còn lại: trung bình / nhỏ nhất / lớn nhất theo kỳ.
 */
import type { ClientMeter } from "@/lib/client-meters";
import type { CatalogDevice } from "@/lib/devices";
import type { ExcelCellValue } from "@/lib/excel-export";
import type { ProjectGatewaySample } from "@/lib/gateway-series";
import { formatAppNumber } from "@/lib/number-format";
import { PARAM_FIELD_PREFIX, type DeclaredReportParam, type ReportTypeId } from "@/lib/report-config";

export type ReportCell = { display: string; raw: ExcelCellValue };
export type ReportRow = Record<string, ReportCell>;
export type BuiltReport = {
  kpis: { label: string; value: string }[];
  chartBars: { label: string; value: number; unit: string }[];
  summaryRows: ReportRow[];
  detailRows: ReportRow[];
};

type Stat = { sum: number; count: number; min: number; max: number };
type Index = { first: number | null; last: number | null; delta: number };

type PeriodCalc = { label: string; index: Index; stats: Record<string, Stat>; samples: number };

export type UtilityMeterCalc = {
  meter: ClientMeter;
  /** Đồng hồ có khai báo chỉ số cộng dồn và có dữ liệu của chỉ số đó trong kỳ. */
  hasIndex: boolean;
  index: Index;
  stats: Record<string, Stat>;
  samples: number;
  byPeriod: PeriodCalc[];
};

function emptyIndex(): Index {
  return { first: null, last: null, delta: 0 };
}

/** Cộng dồn phần tăng; chỉ số giảm (thay / reset đồng hồ) thì bắt đầu lại từ giá trị mới, không trừ ra âm. */
function pushIndex(index: Index, value: number) {
  if (index.first === null) index.first = value;
  if (index.last !== null && value > index.last) index.delta += value - index.last;
  index.last = value;
}

function pushStat(stats: Record<string, Stat>, key: string, value: number) {
  const stat = stats[key];
  if (!stat) {
    stats[key] = { sum: value, count: 1, min: value, max: value };
    return;
  }
  stat.sum += value;
  stat.count += 1;
  if (value < stat.min) stat.min = value;
  if (value > stat.max) stat.max = value;
}

export function computeUtilityCalcs(input: {
  meters: ClientMeter[];
  devices: CatalogDevice[];
  samples: ProjectGatewaySample[];
  params: DeclaredReportParam[];
  periods: { key: string | number; label: string }[];
  periodIndex: (at: string) => number;
}): UtilityMeterCalc[] {
  const statKeys = input.params.filter((param) => !param.cumulative).map((param) => param.key);
  return input.meters.map((meter) => {
    const device = meter.deviceId ? input.devices.find((item) => item.id === meter.deviceId) : undefined;
    const indexKey = device?.registers?.find((row) => row.cumulative && row.address?.trim())?.address.trim();
    const rows = input.samples
      .filter((sample) => sample.meterPointId === meter.id)
      .sort((a, b) => a.at.localeCompare(b.at));

    const index = emptyIndex();
    const stats: Record<string, Stat> = {};
    const byPeriod: PeriodCalc[] = input.periods.map((period) => ({
      label: period.label,
      index: emptyIndex(),
      stats: {},
      samples: 0,
    }));

    for (const sample of rows) {
      const bucket = byPeriod[input.periodIndex(sample.at)];
      if (bucket) bucket.samples += 1;
      if (indexKey) {
        const value = sample.values[indexKey];
        if (typeof value === "number" && Number.isFinite(value)) {
          const previous = index.last;
          pushIndex(index, value);
          if (bucket) {
            // Kỳ mới bắt đầu từ chỉ số cuối của kỳ trước: phần tăng giữa hai mẫu tính vào kỳ này (như báo cáo điện).
            if (bucket.index.first === null && previous !== null && value >= previous) {
              bucket.index.first = previous;
              bucket.index.last = previous;
            }
            pushIndex(bucket.index, value);
          }
        }
      }
      for (const key of statKeys) {
        const value = sample.values[key];
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        pushStat(stats, key, value);
        if (bucket) pushStat(bucket.stats, key, value);
      }
    }

    return {
      meter,
      hasIndex: Boolean(indexKey) && index.first !== null,
      index,
      stats,
      samples: rows.length,
      byPeriod,
    };
  });
}

function num(value: number, digits = 3) {
  return formatAppNumber(value, { minDecimals: 0, maxDecimals: digits });
}

function withUnit(text: string, unit: string) {
  return unit ? `${text} ${unit}` : text;
}

const EMPTY: ReportCell = { display: "—", raw: "" };

function amountCell(value: number | null, unit: string): ReportCell {
  if (value === null || !Number.isFinite(value)) return EMPTY;
  return { display: withUnit(num(value), unit), raw: Number(value.toFixed(3)) };
}

function pointCell(meter: ClientMeter): ReportCell {
  const text = `(${meter.code}) ${meter.name}`;
  return { display: text, raw: text };
}

function statCells(stats: Record<string, Stat>, params: DeclaredReportParam[]): ReportRow {
  const row: ReportRow = {};
  for (const param of params) {
    if (param.cumulative) continue;
    const stat = stats[param.key];
    const base = `${PARAM_FIELD_PREFIX}${param.key}`;
    row[`${base}:avg`] = stat ? amountCell(stat.sum / stat.count, param.unit) : EMPTY;
    row[`${base}:min`] = stat ? amountCell(stat.min, param.unit) : EMPTY;
    row[`${base}:max`] = stat ? amountCell(stat.max, param.unit) : EMPTY;
  }
  return row;
}

export function buildUtilityReport(input: {
  reportId: ReportTypeId;
  utility: string;
  unit: string;
  params: DeclaredReportParam[];
  calcs: UtilityMeterCalc[];
  periodLabel: string;
  alertCountFor: (meter: ClientMeter) => number;
  totalAlerts: number;
  betweenMeters: boolean;
}): BuiltReport {
  const { calcs, unit, params, utility } = input;
  const anyIndex = calcs.some((calc) => calc.hasIndex);
  const grandTotal = calcs.reduce((sum, calc) => sum + (calc.hasIndex ? calc.index.delta : 0), 0);
  const totalText = anyIndex ? withUnit(num(grandTotal), unit) : "Chưa có chỉ số cộng dồn";
  const firstStatParam = params.find((param) => !param.cumulative);

  // Biểu đồ: sản lượng nếu có chỉ số cộng dồn, không thì trung bình thông số đầu tiên.
  const barFor = (calc: UtilityMeterCalc, label: string) =>
    anyIndex
      ? { label, value: Number(calc.index.delta.toFixed(3)), unit }
      : firstStatParam && calc.stats[firstStatParam.key]
        ? {
            label,
            value: Number((calc.stats[firstStatParam.key].sum / calc.stats[firstStatParam.key].count).toFixed(3)),
            unit: firstStatParam.unit,
          }
        : { label, value: 0, unit };

  if (input.reportId === "overview") {
    const rows: ReportRow[] = calcs.map((calc) => {
      const alerts = input.alertCountFor(calc.meter);
      return {
        point: pointCell(calc.meter),
        utility: { display: calc.meter.utility || utility, raw: calc.meter.utility || utility },
        kwhTotal: calc.hasIndex ? amountCell(calc.index.delta, unit) : EMPTY,
        alertCount: { display: `${alerts} sự kiện`, raw: alerts },
      };
    });
    return {
      kpis: [
        { label: `Tổng tiêu thụ ${utility}`, value: totalText },
        { label: "Số điểm đo", value: `${calcs.length} điểm đo` },
        { label: "Số mẫu dữ liệu trong kỳ", value: `${calcs.reduce((sum, calc) => sum + calc.samples, 0)} mẫu` },
        { label: "Tổng cảnh báo ghi nhận", value: `${input.totalAlerts} sự kiện` },
      ],
      chartBars: calcs.map((calc) => barFor(calc, calc.meter.name)),
      summaryRows: rows,
      detailRows: rows,
    };
  }

  if (input.reportId === "energy") {
    const summaryRows: ReportRow[] = calcs.map((calc) => ({
      period: { display: input.periodLabel, raw: input.periodLabel },
      point: pointCell(calc.meter),
      firstKwh: calc.hasIndex ? amountCell(calc.index.first, "") : EMPTY,
      lastKwh: calc.hasIndex ? amountCell(calc.index.last, "") : EMPTY,
      deltaKwh: calc.hasIndex ? amountCell(calc.index.delta, "") : EMPTY,
      meterSwap: EMPTY,
      ...statCells(calc.stats, params),
    }));
    const detailRows: ReportRow[] = calcs.flatMap((calc) =>
      calc.byPeriod
        .filter((period) => period.samples > 0)
        .map((period) => ({
          period: { display: period.label, raw: period.label },
          point: pointCell(calc.meter),
          firstKwh: period.index.first !== null ? amountCell(period.index.first, "") : EMPTY,
          lastKwh: period.index.last !== null ? amountCell(period.index.last, "") : EMPTY,
          deltaKwh: period.index.first !== null ? amountCell(period.index.delta, "") : EMPTY,
          meterSwap: EMPTY,
          ...statCells(period.stats, params),
        })),
    );
    // KPI: tổng tiêu hao + trung bình các thông số đo (gộp mọi điểm đo).
    const statKpis = params
      .filter((param) => !param.cumulative)
      .slice(0, 3)
      .map((param) => {
        let sum = 0;
        let count = 0;
        for (const calc of calcs) {
          const stat = calc.stats[param.key];
          if (!stat) continue;
          sum += stat.sum;
          count += stat.count;
        }
        return {
          label: `${param.key} trung bình${param.label && param.label !== param.key ? ` (${param.label})` : ""}`,
          value: count ? withUnit(num(sum / count), param.unit) : "Chưa có dữ liệu",
        };
      });
    const first = calcs[0];
    const periodBars = (first?.byPeriod ?? [])
      .filter((period) => period.samples > 0)
      .slice(0, 31)
      .map((period) =>
        anyIndex
          ? { label: period.label, value: Number(period.index.delta.toFixed(3)), unit }
          : firstStatParam && period.stats[firstStatParam.key]
            ? {
                label: period.label,
                value: Number(
                  (period.stats[firstStatParam.key].sum / period.stats[firstStatParam.key].count).toFixed(3),
                ),
                unit: firstStatParam.unit,
              }
            : { label: period.label, value: 0, unit },
      );
    return {
      kpis: [{ label: `Tổng ${utility.toLowerCase()} tiêu hao`, value: totalText }, ...statKpis],
      chartBars: periodBars,
      summaryRows,
      detailRows,
    };
  }

  // comparison: đối chiếu sản lượng (nửa sau so với nửa đầu kỳ, hoặc so với trung bình các điểm đo)
  const avg = calcs.length ? grandTotal / calcs.length : 0;
  const rows: ReportRow[] = calcs.map((calc) => {
    if (!calc.hasIndex) {
      return {
        target: pointCell(calc.meter),
        currentKwh: EMPTY,
        baseKwh: EMPTY,
        diffKwh: EMPTY,
        diffPct: EMPTY,
        trend: { display: "Chưa có chỉ số cộng dồn", raw: "" },
      };
    }
    const withData = calc.byPeriod.filter((period) => period.index.first !== null);
    const half = Math.max(1, Math.floor(withData.length / 2));
    const firstHalf = withData.slice(0, half).reduce((sum, period) => sum + period.index.delta, 0);
    const current = calc.index.delta;
    const base = input.betweenMeters ? avg : withData.length >= 2 && firstHalf > 0 ? firstHalf : current;
    const diff = current - base;
    const pct = base > 0 ? (diff / base) * 100 : 0;
    const trend =
      Math.abs(pct) < 1 ? "Ổn định (~0%)" : pct > 0 ? `Tăng +${num(pct, 1)}%` : `Giảm ${num(pct, 1)}%`;
    return {
      target: pointCell(calc.meter),
      currentKwh: amountCell(current, unit),
      baseKwh: amountCell(base, unit),
      diffKwh: { display: `${diff >= 0 ? "+" : ""}${withUnit(num(diff), unit)}`, raw: Number(diff.toFixed(3)) },
      diffPct: { display: `${pct >= 0 ? "+" : ""}${num(pct, 1)}%`, raw: Number(pct.toFixed(1)) },
      trend: { display: trend, raw: trend },
    };
  });
  return {
    kpis: [
      { label: "Sản lượng kỳ báo cáo", value: totalText },
      { label: "Số điểm đo đối chiếu", value: `${calcs.length} điểm đo` },
      { label: "Chế độ đối chiếu", value: input.betweenMeters ? "Giữa các điểm đo" : "Nửa sau so với nửa đầu kỳ" },
    ],
    chartBars: calcs.map((calc) => barFor(calc, calc.meter.name)),
    summaryRows: rows,
    detailRows: rows,
  };
}
