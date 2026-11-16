import "server-only";
import { emsDb, queryRows } from "@/lib/server-db";
import { METER_MODEL_BY_CODE } from "@/lib/gateway-protocol";
import type { MeterModelDef } from "@/lib/meter-catalog";

type Row = Record<string, unknown>;

/** Lỗi nghiệp vụ trả nguyên văn cho người dùng (route EMS chuyển thành HTTP 400). */
export class CatalogUserError extends Error {}

const SEED_VERSION = "2026-11-16-meter-catalog";

/** Mã nhận dạng loại (MT) mặc định theo yêu cầu: 1 điện, 2 nước, 3 hơi, 4 nhiệt. */
const DEFAULT_TYPE_CODES: Record<string, number> = { "Điện": 1, "Nước": 2, "Hơi": 3, "Nhiệt": 4 };

let catalogReady: Promise<void> | null = null;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function codeOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0 || num > 255) {
    throw new CatalogUserError("Mã nhận dạng phải là số nguyên từ 0 đến 255.");
  }
  return num;
}

/**
 * Bảng danh mục đồng hồ (tự tạo khi chạy):
 * - meter_types.gateway_code: mã nhận dạng loại (MT) gateway gửi lên.
 * - meter_models: thương hiệu, tên model, mã model (MM), giao thức, thuộc một loại đồng hồ.
 * - devices.model_id: đồng hồ thật (có serial) tham chiếu tới model.
 */
export function ensureMeterCatalogSchema() {
  catalogReady ??= (async () => {
    await emsDb.query("ALTER TABLE meter_types ADD COLUMN gateway_code SMALLINT NULL").catch(() => undefined);
    await emsDb.query(
      `CREATE TABLE IF NOT EXISTS meter_models (
        id VARCHAR(64) NOT NULL,
        meter_type_name VARCHAR(100) NOT NULL,
        brand VARCHAR(120) NOT NULL,
        model_name VARCHAR(150) NOT NULL,
        model_code SMALLINT NULL,
        protocol VARCHAR(80) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_meter_models_name (meter_type_name, brand, model_name),
        KEY idx_meter_models_type (meter_type_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );
    await emsDb.query("ALTER TABLE devices ADD COLUMN model_id VARCHAR(64) NULL").catch(() => undefined);
    await emsDb.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (version)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );
    const done = await queryRows("SELECT version FROM schema_migrations WHERE version = ? LIMIT 1", [SEED_VERSION]);
    if (done.length === 0) {
      await seedCatalog();
      await emsDb.execute("INSERT IGNORE INTO schema_migrations (version) VALUES (?)", [SEED_VERSION]);
    }
  })().catch((error) => {
    catalogReady = null;
    throw error;
  });
  return catalogReady;
}

/** Lần đầu: gán mã MT mặc định và tạo model từ các đồng hồ đã khai báo trước đây. */
async function seedCatalog() {
  for (const [name, code] of Object.entries(DEFAULT_TYPE_CODES)) {
    await emsDb.execute("UPDATE meter_types SET gateway_code = ? WHERE name = ? AND gateway_code IS NULL", [code, name]);
  }

  const typeRows = await queryRows<Row>("SELECT name FROM meter_types");
  const typeNames = new Set(typeRows.map((row) => text(row.name)));
  const devices = await queryRows<Row>(
    "SELECT id, name, brand, category, protocol, model_id AS modelId FROM devices ORDER BY id",
  );
  const modelIdByKey = new Map<string, string>();
  for (const device of devices) {
    if (text(device.modelId)) continue;
    const category = text(device.category).toUpperCase();
    const meterType =
      category === "WATER_METER" || category === "FLOW_METER"
        ? "Nước"
        : category === "PRESSURE_METER"
          ? "Hơi"
          : "Điện";
    if (!typeNames.has(meterType)) continue;
    const brand = text(device.brand) || "Chưa rõ";
    const modelName = text(device.name) || text(device.category) || "Model";
    const legacyCode = Object.entries(METER_MODEL_BY_CODE).find(([, label]) => label.toUpperCase() === category)?.[0];
    const key = `${meterType}|${brand.toLowerCase()}|${modelName.toLowerCase()}`;
    let modelId = modelIdByKey.get(key);
    if (!modelId) {
      modelId = `mdl-${Date.now()}-${modelIdByKey.size}`;
      await emsDb.execute(
        `INSERT IGNORE INTO meter_models (id, meter_type_name, brand, model_name, model_code, protocol)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [modelId, meterType, brand, modelName, legacyCode != null ? Number(legacyCode) : null, text(device.protocol) || null],
      );
      modelIdByKey.set(key, modelId);
    }
    await emsDb.execute("UPDATE devices SET model_id = ?, device_type = ? WHERE id = ?", [
      modelId,
      meterType,
      text(device.id),
    ]);
  }
}

export async function listMeterModels(): Promise<MeterModelDef[]> {
  await ensureMeterCatalogSchema();
  const rows = await queryRows<Row>(
    `SELECT id, meter_type_name AS meterType, brand, model_name AS modelName, model_code AS modelCode, protocol
       FROM meter_models ORDER BY meter_type_name, brand, model_name`,
  );
  return rows.map((row) => ({
    id: text(row.id),
    meterType: text(row.meterType),
    brand: text(row.brand),
    modelName: text(row.modelName),
    modelCode: row.modelCode == null ? null : Number(row.modelCode),
    protocol: text(row.protocol) || null,
  }));
}

export async function saveMeterModel(body: Row) {
  await ensureMeterCatalogSchema();
  const id = text(body.id) || `mdl-${Date.now()}`;
  const meterType = text(body.meterType);
  const brand = text(body.brand);
  const modelName = text(body.modelName);
  const modelCode = codeOrNull(body.modelCode);
  const protocol = text(body.protocol) || null;
  if (!meterType || !brand || !modelName) {
    throw new CatalogUserError("Vui lòng chọn loại đồng hồ và nhập thương hiệu, tên model.");
  }
  const typeRows = await queryRows("SELECT name FROM meter_types WHERE name = ? LIMIT 1", [meterType]);
  if (typeRows.length === 0) throw new CatalogUserError("Loại đồng hồ không tồn tại.");

  const sameName = await queryRows<Row>(
    "SELECT id FROM meter_models WHERE meter_type_name = ? AND brand = ? AND model_name = ? AND id <> ? LIMIT 1",
    [meterType, brand, modelName, id],
  );
  if (sameName.length) throw new CatalogUserError("Model này đã có trong danh mục.");
  if (modelCode != null) {
    const sameCode = await queryRows<Row>(
      "SELECT model_name AS modelName FROM meter_models WHERE meter_type_name = ? AND model_code = ? AND id <> ? LIMIT 1",
      [meterType, modelCode, id],
    );
    if (sameCode.length) {
      throw new CatalogUserError(
        `Mã model ${modelCode} đã dùng cho "${text(sameCode[0].modelName)}" trong loại ${meterType}.`,
      );
    }
  }

  await emsDb.execute(
    `INSERT INTO meter_models (id, meter_type_name, brand, model_name, model_code, protocol)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE meter_type_name = VALUES(meter_type_name), brand = VALUES(brand),
       model_name = VALUES(model_name), model_code = VALUES(model_code), protocol = VALUES(protocol)`,
    [id, meterType, brand, modelName, modelCode, protocol],
  );
  // Đồng hồ đã tham chiếu model này nhận lại thông tin mới (thương hiệu, tên, giao thức, loại).
  await emsDb.execute(
    `UPDATE devices SET brand = ?, name = ?, brand_model = ?, category = ?, protocol = ?, device_type = ?
      WHERE model_id = ?`,
    [brand, modelName, `${brand} ${modelName}`, modelName, protocol, meterType, id],
  );
  invalidateCatalogCache();
  return listMeterModels();
}

export async function deleteMeterModel(id: string) {
  await ensureMeterCatalogSchema();
  const used = await queryRows<Row>("SELECT serial_number AS sn FROM devices WHERE model_id = ? LIMIT 5", [id]);
  if (used.length) {
    throw new CatalogUserError(
      `Model đang được dùng cho đồng hồ có serial: ${used.map((row) => text(row.sn)).join(", ")}. Hãy xóa hoặc đổi model của các đồng hồ đó trước.`,
    );
  }
  await emsDb.execute("DELETE FROM meter_models WHERE id = ?", [id]);
  invalidateCatalogCache();
  return { ok: true };
}

/** Kiểm tra mã MT của loại đồng hồ không trùng loại khác. */
export async function assertTypeCodeAvailable(name: string, code: number | null) {
  if (code == null) return;
  const rows = await queryRows<Row>(
    "SELECT name FROM meter_types WHERE gateway_code = ? AND name <> ? LIMIT 1",
    [code, name],
  );
  if (rows.length) throw new CatalogUserError(`Mã nhận dạng ${code} đã dùng cho loại "${text(rows[0].name)}".`);
}

/** Mã nhận dạng loại (MT): 1–9 (cột gateway_*.meter_type chỉ chứa 1 ký tự). */
export function parseTypeCode(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 9) {
    throw new CatalogUserError("Mã nhận dạng loại đồng hồ phải là số nguyên từ 1 đến 9.");
  }
  return num;
}

/** Không cho xóa loại đồng hồ đang được dự án hoặc model sử dụng. */
export async function assertTypeDeletable(name: string) {
  await ensureMeterCatalogSchema();
  const [projects, models] = await Promise.all([
    queryRows<Row>("SELECT COUNT(*) AS cnt FROM project_meter_types WHERE meter_type_name = ?", [name]),
    queryRows<Row>("SELECT COUNT(*) AS cnt FROM meter_models WHERE meter_type_name = ?", [name]),
  ]);
  const projectCount = Number(projects[0]?.cnt ?? 0);
  const modelCount = Number(models[0]?.cnt ?? 0);
  if (projectCount || modelCount) {
    const parts = [
      projectCount ? `${projectCount} dự án` : "",
      modelCount ? `${modelCount} model đồng hồ` : "",
    ].filter(Boolean);
    throw new CatalogUserError(`Loại "${name}" đang được dùng bởi ${parts.join(" và ")}, không thể xóa.`);
  }
}

/* ---------------- Dịch mã MT/MM gateway sang tên cấu hình (chỉ để hiển thị) ---------------- */

type CatalogSnapshot = {
  typeByCode: Map<number, string>;
  modelByTypeAndCode: Map<string, string>;
  expiresAt: number;
};

let catalogCache: CatalogSnapshot | null = null;

export function invalidateCatalogCache() {
  catalogCache = null;
}

async function loadCatalogSnapshot(): Promise<CatalogSnapshot> {
  if (catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache;
  await ensureMeterCatalogSchema();
  const [types, models] = await Promise.all([
    queryRows<Row>("SELECT name, gateway_code AS code FROM meter_types WHERE gateway_code IS NOT NULL"),
    queryRows<Row>(
      "SELECT meter_type_name AS meterType, brand, model_name AS modelName, model_code AS code FROM meter_models WHERE model_code IS NOT NULL",
    ),
  ]);
  const typeByCode = new Map<number, string>();
  for (const row of types) typeByCode.set(Number(row.code), text(row.name));
  const modelByTypeAndCode = new Map<string, string>();
  for (const row of models) {
    modelByTypeAndCode.set(`${text(row.meterType)}|${Number(row.code)}`, `${text(row.brand)} ${text(row.modelName)}`);
  }
  catalogCache = { typeByCode, modelByTypeAndCode, expiresAt: Date.now() + 30_000 };
  return catalogCache;
}

/** Chữ cái loại cũ (E/W/P/F) hoặc chữ số lưu trong gateway_* → mã MT. */
const LEGACY_TYPE_LETTER_CODE: Record<string, number> = { E: 1, W: 2, P: 3, F: 4 };

export function typeCodeFromStored(value: string | null | undefined): number | null {
  const textValue = (value ?? "").trim().toUpperCase();
  if (!textValue) return null;
  if (/^\d+$/.test(textValue)) return Number(textValue);
  return LEGACY_TYPE_LETTER_CODE[textValue] ?? null;
}

/** Nhãn model lưu trong gateway_* ("PM2230", "MODEL_5", "5") → mã MM. */
export function modelCodeFromStored(value: string | null | undefined): number | null {
  const textValue = (value ?? "").trim();
  if (!textValue) return null;
  if (/^\d+$/.test(textValue)) return Number(textValue);
  const prefixed = /^MODEL_(\d+)$/i.exec(textValue);
  if (prefixed) return Number(prefixed[1]);
  const legacy = Object.entries(METER_MODEL_BY_CODE).find(([, label]) => label.toLowerCase() === textValue.toLowerCase());
  return legacy ? Number(legacy[0]) : null;
}

export async function resolveMeterNames(
  storedType: string | null | undefined,
  storedModel: string | null | undefined,
): Promise<{ meterTypeName: string | null; meterModelName: string | null }> {
  try {
    const snapshot = await loadCatalogSnapshot();
    const typeCode = typeCodeFromStored(storedType);
    const meterTypeName = typeCode != null ? snapshot.typeByCode.get(typeCode) ?? null : null;
    const modelCode = modelCodeFromStored(storedModel);
    const meterModelName =
      meterTypeName && modelCode != null ? snapshot.modelByTypeAndCode.get(`${meterTypeName}|${modelCode}`) ?? null : null;
    return { meterTypeName, meterModelName };
  } catch {
    return { meterTypeName: null, meterModelName: null };
  }
}
