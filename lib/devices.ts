import { dbFetch, emitDbChange } from "@/lib/db-client";
import { vietnamNowLabel } from "@/lib/vietnam-time";

export type DeviceKind = "power" | "flow" | "temp" | "steam";
export type DeviceStatus = "active" | "maintenance" | "offline";

export type DeviceRegister = {
  id: string;
  address: string;
  name: string;
  dataType: string;
  multiplier: string;
  /** Đơn vị hiển thị trên biểu đồ / sơ đồ (VD: m³/s, bar, °C). */
  unit?: string;
  /** Chỉ số tích lũy (VD tổng m³ đã chảy qua): báo cáo dùng để tính sản lượng tiêu thụ theo kỳ. */
  cumulative?: boolean;
};

export type DeviceExtraField = {
  id: string;
  label: string;
  value: string;
};

export type DeviceProjectLink = {
  projectId: string;
  projectName: string;
  meterId: string;
  meterName: string;
};

export type CatalogDevice = {
  id: string;
  name: string;
  sn: string;
  brandModel: string;
  brand: string;
  type: string;
  category?: string;
  kind: DeviceKind;
  status: DeviceStatus;
  lastSync: string;
  protocol?: string;
  notes?: string;
  image?: string;
  extraFields?: DeviceExtraField[];
  registers?: DeviceRegister[];
  /** Model trong trang Cấu hình loại đồng hồ (loại, thương hiệu, tên model, giao thức lấy từ đây). */
  modelId?: string | null;
  /** Chỉ đọc: các dự án/điểm đo đang gắn đồng hồ này (server tính). */
  projects?: DeviceProjectLink[];
};

let devicesCache: CatalogDevice[] = [];
let devicesHydration: Promise<CatalogDevice[]> | null = null;

export function deviceSpec(device: CatalogDevice) {
  const protocol = device.protocol?.trim();
  return protocol ? `${protocol} • ${device.type}` : device.type;
}

export function loadDevices(): CatalogDevice[] {
  return devicesCache;
}

export function saveDevices(devices: CatalogDevice[]) {
  devicesCache = devices;
  emitDbChange("devices");
  return dbFetch("devices", {
    method: "POST",
    body: JSON.stringify({ items: devices }),
  }).catch((error) => {
    console.error("Không thể lưu thiết bị", error);
    throw error;
  });
}

export function hydrateDevices() {
  if (typeof window === "undefined") return Promise.resolve(loadDevices());
  if (devicesHydration) return devicesHydration;
  devicesHydration = dbFetch<CatalogDevice[]>("devices")
    .then((devices) => {
      const prevJson = JSON.stringify(devicesCache);
      devicesCache = devices;
      if (prevJson !== JSON.stringify(devices)) {
        emitDbChange("devices");
      }
      return devicesCache;
    })
    .catch(() => devicesCache)
    .finally(() => {
      devicesHydration = null;
    });
  return devicesHydration;
}

export async function upsertDevice(device: CatalogDevice) {
  const saved = await dbFetch<CatalogDevice[]>("devices", {
    method: "POST",
    body: JSON.stringify(device),
  });
  devicesCache = saved;
  emitDbChange("devices");
  return saved;
}

/** Thông số khai báo ở "Hàm nhận dữ liệu từ gateway" của mọi đồng hồ thuộc một loại (gộp, không trùng tên). */
export function declaredParamsForType(devices: CatalogDevice[], meterType: string) {
  const list: { key: string; label: string; unit: string; cumulative: boolean }[] = [];
  for (const device of devices) {
    if (device.type !== meterType) continue;
    for (const row of device.registers ?? []) {
      const key = row.address?.trim();
      if (!key || list.some((item) => item.key === key)) continue;
      list.push({ key, label: row.name?.trim() || key, unit: row.unit?.trim() || "", cumulative: Boolean(row.cumulative) });
    }
  }
  return list;
}

/** Chỉ cập nhật "Hàm nhận dữ liệu" (tên, mô tả, đơn vị…): được phép cả khi đồng hồ đang gắn vào dự án. */
export async function updateDeviceRegisters(id: string, registers: DeviceRegister[]) {
  const saved = await dbFetch<CatalogDevice[]>("devices", {
    method: "POST",
    body: JSON.stringify({ id, registersOnly: true, registers }),
  });
  devicesCache = saved;
  emitDbChange("devices");
  return saved;
}

export async function removeDevice(id: string) {
  await dbFetch("devices", { method: "DELETE", query: { id } });
  const next = loadDevices().filter((item) => item.id !== id);
  devicesCache = next;
  emitDbChange("devices");
  return next;
}

export function todaySyncLabel() {
  return vietnamNowLabel();
}

export function kindFromDeviceType(deviceType: string): DeviceKind {
  const value = deviceType.toLowerCase();
  if (value.includes("nước") || value.includes("water") || value.includes("flow")) {
    return "flow";
  }
  if (value.includes("nhiệt") || value.includes("temp")) return "temp";
  if (value.includes("hơi") || value.includes("steam")) return "steam";
  return "power";
}

export function typeLabelFromDeviceType(deviceType: string) {
  return deviceType.trim() || "Chưa phân loại";
}
