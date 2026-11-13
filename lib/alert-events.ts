import { dbFetch, emitDbChange } from "@/lib/db-client";
import { METER_PARAMETERS } from "@/lib/meter-parameters";

export type AlertEvent = {
  id: string;
  projectId: string;
  meterPointId?: string;
  occurredAt: string;
  parameter: string;
  value: number;
  unit?: string;
  severity: "critical" | "warning" | "info" | string;
  status: "open" | "active" | "acknowledged" | "resolved" | string;
  note?: string;
  category?: string;
  message?: string;
  thresholdValue?: number;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  pointCode?: string;
  pointName?: string;
  utility?: string;
};

const cache: Record<string, AlertEvent[]> = {};
const hydration: Record<string, Promise<AlertEvent[]> | undefined> = {};

export function loadAlertEvents(projectId: string): AlertEvent[] {
  return cache[projectId] ?? [];
}

export function hydrateAlertEvents(projectId: string, options?: { force?: boolean }) {
  if (typeof window === "undefined") return Promise.resolve(loadAlertEvents(projectId));
  if (options?.force || !hydration[projectId]) {
    hydration[projectId] = dbFetch<AlertEvent[]>("alert-events", { query: { projectId } })
      .then((events) => {
        const prev = cache[projectId];
        cache[projectId] = events;
        if (!prev || JSON.stringify(prev) !== JSON.stringify(events)) {
          emitDbChange("alert-events");
        }
        return events;
      })
      .finally(() => {
        hydration[projectId] = undefined;
      });
  }
  return hydration[projectId]!;
}

export async function updateAlertEvent(
  projectId: string,
  id: string,
  patch: Partial<AlertEvent>,
) {
  const current = loadAlertEvents(projectId);
  cache[projectId] = current.map((event) =>
    event.id === id ? { ...event, ...patch } : event,
  );
  const events = await dbFetch<AlertEvent[]>("alert-events", {
    method: "POST",
    body: JSON.stringify({ projectId, id, ...patch }),
  });
  cache[projectId] = events;
  emitDbChange("alert-events");
  return events;
}

export function alertStatus(status: AlertEvent["status"]): "active" | "acknowledged" | "resolved" {
  if (status === "resolved") return "resolved";
  if (status === "acknowledged") return "acknowledged";
  return "active";
}

const CONNECTIVITY_PARAMETERS = new Set(["Mất kết nối", "Kết nối trở lại"]);

/** Nhóm cảnh báo suy ra từ mã thông số đo (Van → điện áp, THDCa → sóng hài, ...). */
function categoryFromParameter(parameter: string) {
  const key = parameter.trim();
  if (CONNECTIVITY_PARAMETERS.has(key)) return "connectivity";
  const meta = METER_PARAMETERS.find((item) => item.key === key);
  if (meta) {
    if (meta.chart === "harm") return "harmonics";
    if (meta.chart === "unbalance") return "unbalance";
    if (meta.chart === "freq") return "frequency";
    if (meta.unit === "A") return "current";
    if (meta.unit === "V") return "voltage";
    return "power";
  }
  if (/^THD/i.test(key)) return "harmonics";
  if (key.startsWith("F")) return "frequency";
  if (key.startsWith("U") || key.startsWith("V")) return "voltage";
  if (key.startsWith("I")) return "current";
  return "power";
}

export function alertCategory(parameter: string, category?: string) {
  // Bản cũ gán mặc định "connectivity" cho mọi thông số không bắt đầu bằng F/U/I/P (VD: Van, THDVan),
  // nên dữ liệu đã lưu có thể sai: chỉ tin "connectivity" khi đúng là sự kiện kết nối.
  if (category && !(category === "connectivity" && !CONNECTIVITY_PARAMETERS.has(parameter.trim()))) {
    return category;
  }
  return categoryFromParameter(parameter);
}

/** Sự kiện kết nối gateway (không phải giá trị đo): giá trị lưu là số phút gián đoạn. */
export function isConnectivityEvent(event: Pick<AlertEvent, "parameter" | "category">) {
  return CONNECTIVITY_PARAMETERS.has(event.parameter.trim());
}

/** Chuỗi hiển thị cột "Giá trị" của nhật ký cảnh báo. */
export function alertValueText(event: Pick<AlertEvent, "parameter" | "category" | "value" | "unit" | "status">) {
  if (isConnectivityEvent(event)) {
    const minutes = Number(event.value);
    const duration = Number.isFinite(minutes) && minutes > 0 ? `${minutes} phút` : "";
    if (event.parameter === "Kết nối trở lại") {
      return duration ? `Sau ${duration} gián đoạn` : "Đã kết nối";
    }
    if (!duration) return "Không có dữ liệu";
    return event.status === "resolved" || event.status === "acknowledged"
      ? `Gián đoạn ${duration}`
      : `Đã mất ${duration}`;
  }
  return `${event.value}${event.unit ? ` ${event.unit}` : ""}`;
}
