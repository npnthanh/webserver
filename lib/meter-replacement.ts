import { dbFetch, emitDbChange } from "@/lib/db-client";

/** Một lần thay đồng hồ đã ghi biên bản. Thời gian là giờ Việt Nam "YYYY-MM-DD HH:mm". */
export type MeterReplacementRecord = {
  id: number;
  meterPointId: string;
  at: string;
  oldSerial: string;
  newSerial: string;
  /** Chỉ số chốt đồng hồ cũ (kWh); null = lấy lần đọc cuối cùng. */
  finalIndex: number | null;
  /** Chỉ số ban đầu đồng hồ mới (kWh). */
  initialIndex: number | null;
  recordedBy: string;
  canUndo: boolean;
};

/** Lần hệ thống nghi thay đồng hồ: chỉ số tụt và không hồi lại mức cũ. */
export type MeterResetSuspect = {
  id: number;
  meterPointId: string;
  serial: string;
  at: string;
  beforeIndex: number;
  afterIndex: number;
};

export type MeterReplacementState = {
  replacements: MeterReplacementRecord[];
  suspects: MeterResetSuspect[];
};

export type MeterReplacementInput = {
  meterPointId: string;
  /** Giờ Việt Nam "YYYY-MM-DDTHH:mm" (giá trị của ô datetime-local). */
  replacedAt: string;
  finalIndex: number | null;
  initialIndex: number;
  /** Đồng hồ mới (thiết bị khác serial); bỏ trống = đồng hồ mới dùng lại serial cũ. */
  newDeviceId?: string | null;
};

const RESOURCE = "meter-replacements";

export function loadMeterReplacements(projectId: string) {
  return dbFetch<MeterReplacementState>(RESOURCE, { query: { projectId } });
}

async function post(projectId: string, body: Record<string, unknown>) {
  const result = await dbFetch<MeterReplacementState>(RESOURCE, {
    method: "POST",
    body: JSON.stringify({ projectId, ...body }),
  });
  emitDbChange(RESOURCE);
  emitDbChange("client-meters");
  return result;
}

export function saveMeterReplacement(projectId: string, input: MeterReplacementInput) {
  return post(projectId, { action: "replace", ...input });
}

export function undoMeterReplacement(projectId: string, id: number) {
  return post(projectId, { action: "undo", id });
}

export function dismissMeterResetSuspect(projectId: string, id: number) {
  return post(projectId, { action: "dismiss", id });
}
