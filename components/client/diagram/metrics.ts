import {
  METER_PARAMETERS,
  registerToKwh,
  type MeterParameter,
} from "@/lib/meter-parameters";
import { formatAppNumber } from "@/lib/number-format";
import type { DiagramNodeDisplay, DiagramParamOption, MeterMetric, MeterStatus } from "./types";

/** Thông số mặc định trên thẻ sơ đồ (điện áp / dòng / công suất). */
export const DEFAULT_DIAGRAM_METRIC_KEYS = ["Van", "Ia", "Papt"] as const;

/** Thông số không hiển thị trên sơ đồ (tần số F đã bỏ khỏi sơ đồ). */
const HIDDEN_DIAGRAM_KEYS = new Set(["F"]);

/** Bỏ qua sóng hài bậc cao (quá dài cho picker sơ đồ) và các thông số ẩn. */
export const DIAGRAM_PICKER_PARAMETERS: MeterParameter[] = METER_PARAMETERS.filter(
  (item) => item.id <= 61 && !HIDDEN_DIAGRAM_KEYS.has(item.key),
);

const SHORT_LABELS: Record<string, string> = {
  Van: "Ua",
  Vbn: "Ub",
  Vcn: "Uc",
  Vab: "Uab",
  Vbc: "Ubc",
  Vca: "Uca",
  VLNavg: "Uavg",
  VLLavg: "Ull",
  Ia: "Ia",
  Ib: "Ib",
  Ic: "Ic",
  In: "In",
  Iavg: "Iavg",
  Papt: "P",
  Papa: "Pa",
  Papb: "Pb",
  Papc: "Pc",
  Qrpt: "Q",
  Sapt: "S",
  F: "f",
  PFt: "PF",
  EPaed: "E",
};

const ENERGY_KEYS = new Set(["EPaed", "EPaer", "EQred", "EQrer", "ESaed", "ESaer"]);

export const DIAGRAM_ONLINE_MS = 15 * 60 * 1000;

export function normalizeMetricKeys(keys: string[] | null | undefined): string[] {
  const cleaned = (keys ?? []).filter(
    (key) => typeof key === "string" && key.trim() && !HIDDEN_DIAGRAM_KEYS.has(key),
  );
  return cleaned.length ? [...new Set(cleaned)] : [...DEFAULT_DIAGRAM_METRIC_KEYS];
}

/**
 * Thông số hiện trên thẻ. Đồng hồ có danh sách thông số riêng (Nước, Khí nén, Nhiệt, Hơi…): chỉ giữ các thông số
 * đã chọn nằm trong danh sách đó, chưa chọn thì hiện tối đa 4 thông số đầu. Đồng hồ điện: như cũ (mặc định Ua / Ia / P).
 */
export function resolveMetricKeys(display?: DiagramNodeDisplay): string[] {
  const options = display?.paramOptions;
  if (options?.length) {
    const allowed = new Set(options.map((option) => option.key));
    const kept = (display?.metricKeys ?? []).filter((key) => allowed.has(key));
    return kept.length ? [...new Set(kept)] : options.slice(0, 4).map((option) => option.key);
  }
  return normalizeMetricKeys(display?.metricKeys);
}

export function metricLabel(key: string) {
  return SHORT_LABELS[key] ?? key;
}

export function formatMetricReading(
  key: string,
  values: Record<string, number> | undefined,
  /** Đơn vị khai báo ở Hàm nhận dữ liệu của đồng hồ (ưu tiên hơn đơn vị chuẩn). */
  unitOverride?: string,
) {
  const raw = values?.[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return "—";

  const param = METER_PARAMETERS.find((item) => item.key === key);
  let num = raw;
  let unit = unitOverride || param?.unit || "";

  if (ENERGY_KEYS.has(key)) {
    num = registerToKwh(raw);
    unit = "kWh";
  }

  const abs = Math.abs(num);
  const digits = abs >= 100 ? 1 : abs >= 10 ? 2 : abs >= 1 ? 2 : 3;
  const text = formatAppNumber(num, {
    maxDecimals: digits,
    minDecimals: Number.isInteger(num) ? 0 : Math.min(digits, 1),
  });
  return unit ? `${text} ${unit}` : text;
}

export function buildLiveMetrics(
  keys: string[],
  values: Record<string, number> | undefined,
  options: {
    hasDevice: boolean;
    online: boolean;
    code: string;
    paramOptions?: DiagramParamOption[];
  },
): { metrics: MeterMetric[]; status: MeterStatus; statusLabel?: string } {
  if (!options.hasDevice) {
    return {
      status: "offline",
      statusLabel: "CHƯA GÁN ĐỒNG HỒ",
      metrics: [
        { key: "status", label: "Trạng thái", value: "Chưa gán đồng hồ" },
        { key: "code", label: "Mã", value: options.code || "—" },
      ],
    };
  }

  const resolved = normalizeMetricKeys(keys);
  const hasAnyValue = resolved.some((key) => {
    const value = values?.[key];
    return typeof value === "number" && Number.isFinite(value);
  });

  if (!hasAnyValue) {
    return {
      status: "offline",
      statusLabel: "CHƯA CÓ DỮ LIỆU",
      metrics: [
        { key: "data", label: "Dữ liệu", value: "Chưa có bản tin" },
        { key: "code", label: "Mã", value: options.code || "—" },
      ],
    };
  }

  return {
    status: options.online ? "normal" : "warning",
    statusLabel: options.online ? undefined : "MẤT KẾT NỐI",
    metrics: resolved.map((key) => ({
      key,
      label: metricLabel(key),
      value: formatMetricReading(key, values, options.paramOptions?.find((item) => item.key === key)?.unit),
    })),
  };
}

export function parameterGroups(params: MeterParameter[] = DIAGRAM_PICKER_PARAMETERS) {
  const groups = new Map<string, MeterParameter[]>();
  for (const param of params) {
    const list = groups.get(param.group) ?? [];
    list.push(param);
    groups.set(param.group, list);
  }
  return [...groups.entries()];
}

