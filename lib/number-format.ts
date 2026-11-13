/**
 * Quy chuẩn định dạng số xuyên suốt toàn hệ thống:
 * - Ngăn cách hàng nghìn: dấu cách (" ") -> ví dụ: 43 215 ; 1 234 567
 * - Ngăn cách hàng đơn vị (thập phân): dấu phẩy (",") -> ví dụ: 27,9 ; 0,161128 ; 43 215,5
 */

export type FormatNumberOptions = {
  minDecimals?: number;
  maxDecimals?: number;
  fallback?: string;
};

/**
 * Định dạng số theo chuẩn: dấu cách ngăn cách hàng nghìn, dấu phẩy ngăn cách phần thập phân.
 */
export function formatAppNumber(
  value: number | null | undefined,
  options?: FormatNumberOptions | number,
): string {
  const opts: FormatNumberOptions =
    typeof options === "number"
      ? { maxDecimals: options, minDecimals: 0 }
      : (options ?? {});

  const fallback = opts.fallback ?? "0";
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  const maxDecimals = Math.max(0, Math.min(12, opts.maxDecimals ?? 6));
  const minDecimals = Math.max(0, Math.min(maxDecimals, opts.minDecimals ?? 0));

  const factor = 10 ** maxDecimals;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;

  const isNegative = normalized < 0;
  const abs = Math.abs(normalized);

  const fixed = abs.toFixed(maxDecimals);
  const [rawInt, rawFrac = ""] = fixed.split(".");

  const intFormatted = rawInt.replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  let frac = rawFrac;
  if (maxDecimals > minDecimals) {
    frac = frac.replace(/0+$/, "");
    if (frac.length < minDecimals) {
      frac = frac.padEnd(minDecimals, "0");
    }
  }

  const sign = isNegative ? "-" : "";
  return frac.length > 0 ? `${sign}${intFormatted},${frac}` : `${sign}${intFormatted}`;
}

/**
 * Phân tích chuỗi số từ người dùng nhập hoặc từ file Excel/CSV về kiểu number chuẩn.
 * Hỗ trợ:
 * - Định dạng chuẩn hệ thống: "43 215", "27,9", "43 215,85", "0,161128"
 * - Định dạng kế thừa dùng dấu chấm phân tách nghìn: "43.215", "74.100", "1.000.000"
 * - Định dạng số thực tiếng Anh / Excel: "0.85", "27.9", "0.161128", "1,234.56"
 */
export function parseAppNumber(raw: unknown, fallback = 0): number {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : fallback;
  }
  if (typeof raw !== "string") return fallback;

  // Bỏ khoảng trắng đầu/cuối và các ký tự khoảng trắng ngăn cách hàng nghìn
  const compact = raw
    .trim()
    .replace(/[\s\u00A0\u202F_]+/g, "");
  if (!compact) return fallback;

  const hasComma = compact.includes(",");
  const hasDot = compact.includes(".");

  let normalized = compact;

  if (hasComma && hasDot) {
    const lastComma = compact.lastIndexOf(",");
    const lastDot = compact.lastIndexOf(".");
    if (lastComma > lastDot) {
      // Dạng "1.234,56" -> "." là nghìn, "," là thập phân
      normalized = compact.replace(/\./g, "").replace(",", ".");
    } else {
      // Dạng "1,234.56" -> "," là nghìn, "." là thập phân
      normalized = compact.replace(/,/g, "");
    }
  } else if (hasComma) {
    const parts = compact.split(",");
    if (parts.length > 2) {
      // Nhiều dấu phẩy -> dấu phẩy là phân cách hàng nghìn (VD: "1,234,567")
      normalized = parts.join("");
    } else {
      // Một dấu phẩy -> chuẩn hệ thống là dấu thập phân (VD: "27,9", "0,85", "0,161128")
      normalized = `${parts[0]}.${parts[1] ?? ""}`;
    }
  } else if (hasDot) {
    // Chỉ có dấu chấm:
    // Nếu khớp mẫu phân tách hàng nghìn nguyên (ví dụ "43.215", "74.100", "1.234.567" với phần đầu khác 0)
    if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(compact)) {
      normalized = compact.replace(/\./g, "");
    } else {
      const parts = compact.split(".");
      if (parts.length > 2) {
        normalized = parts.join("");
      }
      // Ngược lại giữ nguyên "." làm dấu thập phân (VD: "0.85", "27.9", "0.6", "0.161128")
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Chuyển đổi chuỗi số bất kỳ (từ Excel, paste hoặc input) sang chuỗi định dạng chuẩn
 * (ngăn cách nghìn bằng dấu cách, thập phân bằng dấu phẩy).
 */
export function formatAppNumberInput(raw: unknown, maxDecimals = 6): string {
  if (raw === null || raw === undefined) return "";
  const str = String(raw).trim();
  if (!str) return "";
  const num = parseAppNumber(str, Number.NaN);
  if (!Number.isFinite(num)) return str;
  return formatAppNumber(num, { maxDecimals });
}

/**
 * Định dạng giá trị đang gõ trong ô input:
 * Cho phép người dùng đang gõ dở dấu "," ở cuối hoặc các số 0 sau dấu "," (VD: "27,", "0,0")
 * nhưng vẫn tự động tách hàng nghìn bằng dấu cách ở phần nguyên.
 */
export function formatLiveNumberInput(raw: string): string {
  // Chỉ giữ chữ số, dấu trừ ở đầu, dấu phẩy hoặc dấu chấm
  const cleaned = raw.replace(/[^\d.,-]/g, "");
  if (!cleaned) return "";

  const isNeg = cleaned.startsWith("-");
  const unsigned = cleaned.replace(/-/g, "");

  // Nếu người dùng gõ dấu chấm để nhập số thập phân (VD "0.85" hoặc "27.9"), đổi sang dấu phẩy
  // Trừ trường hợp chuỗi có dạng kế thừa "43.215" khi vừa paste vào
  let working = unsigned;
  if (working.includes(".") && !working.includes(",")) {
    if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(working)) {
      working = working.replace(/\./g, "");
    } else {
      const firstDot = working.indexOf(".");
      working =
        working.slice(0, firstDot) +
        "," +
        working.slice(firstDot + 1).replace(/\./g, "");
    }
  } else {
    working = working.replace(/\./g, "");
  }

  const commaIdx = working.indexOf(",");
  const intRaw = (commaIdx >= 0 ? working.slice(0, commaIdx) : working).replace(
    /^0+(?=\d)/,
    "",
  );
  const intFormatted = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  if (commaIdx >= 0) {
    const fracRaw = working.slice(commaIdx + 1).replace(/,/g, "");
    return `${isNeg ? "-" : ""}${intFormatted || "0"},${fracRaw}`;
  }

  return `${isNeg ? "-" : ""}${intFormatted}`;
}

/**
 * Giải nén dữ liệu từ file ZIP (.xlsx) trên trình duyệt để đọc bảng tính.
 */
async function unzipXlsxEntries(buffer: ArrayBuffer): Promise<Map<string, string>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const entries = new Map<string, string>();
  const decoder = new TextDecoder("utf-8");

  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;

    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > bytes.length) break;

    const rawSlice = bytes.subarray(dataStart, dataEnd);
    if (
      name === "xl/sharedStrings.xml" ||
      name.startsWith("xl/worksheets/sheet")
    ) {
      if (method === 0) {
        entries.set(name, decoder.decode(rawSlice));
      } else if (method === 8 && typeof DecompressionStream !== "undefined") {
        try {
          const ds = new DecompressionStream("deflate-raw");
          const writer = ds.writable.getWriter();
          void writer.write(rawSlice);
          void writer.close();
          const decompressed = await new Response(ds.readable).arrayBuffer();
          entries.set(name, decoder.decode(new Uint8Array(decompressed)));
        } catch {
          // Bỏ qua nếu không giải nén được entry này
        }
      }
    }

    offset = dataEnd;
  }

  return entries;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractRowsFromXlsxXml(entries: Map<string, string>): string[][] {
  const sharedStrings: string[] = [];
  const sstXml = entries.get("xl/sharedStrings.xml") ?? "";
  if (sstXml) {
    const siMatches = sstXml.match(/<si[\s>][\s\S]*?<\/si>/g) ?? [];
    for (const si of siMatches) {
      const texts = Array.from(si.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)).map((m) =>
        decodeXmlEntities(m[1]),
      );
      sharedStrings.push(texts.join(""));
    }
  }

  const sheetXml =
    entries.get("xl/worksheets/sheet1.xml") ??
    Array.from(entries.entries()).find(([k]) => k.startsWith("xl/worksheets/sheet"))?.[1] ??
    "";
  if (!sheetXml) return [];

  const rows: string[][] = [];
  const rowMatches = sheetXml.match(/<row[\s>][\s\S]*?<\/row>/g) ?? [];
  for (const rowXml of rowMatches) {
    const cells: string[] = [];
    const cellMatches = rowXml.match(/<c[\s>][\s\S]*?(?:<\/c>|\/>)/g) ?? [];
    for (const cellXml of cellMatches) {
      const refMatch = /\br="([A-Z]+)\d+"/.exec(cellXml);
      const colLetters = refMatch?.[1] ?? "";
      let colIndex = 0;
      for (let i = 0; i < colLetters.length; i += 1) {
        colIndex = colIndex * 26 + (colLetters.charCodeAt(i) - 64);
      }
      const targetIdx = colIndex > 0 ? colIndex - 1 : cells.length;
      while (cells.length < targetIdx) cells.push("");

      const typeMatch = /\bt="([^"]+)"/.exec(cellXml);
      const cellType = typeMatch?.[1] ?? "";
      let val = "";
      if (cellType === "inlineStr") {
        const tMatch = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(cellXml);
        val = tMatch ? decodeXmlEntities(tMatch[1]) : "";
      } else {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(cellXml);
        const rawV = vMatch ? decodeXmlEntities(vMatch[1].trim()) : "";
        if (cellType === "s") {
          const sIdx = Number(rawV);
          val = Number.isFinite(sIdx) ? (sharedStrings[sIdx] ?? "") : rawV;
        } else {
          val = rawV;
        }
      }
      cells[targetIdx] = val.trim();
    }
    if (cells.some((c) => c !== "")) {
      rows.push(cells);
    }
  }
  return rows;
}

function detectMonthFromLabel(text: string): number | null {
  const clean = text.trim().toLowerCase();
  if (!clean) return null;
  // Khớp "Tháng 1" .. "Tháng 12", "T1" .. "T12", "Thang 01", "01/2026", "2026-01"
  const m1 = /(?:tháng|thang|month|t)\s*0?(1[0-2]|[1-9])\b/i.exec(clean);
  if (m1) return Number(m1[1]);
  const m2 = /^0?(1[0-2]|[1-9])(?:\/\d{4})?$/.exec(clean);
  if (m2) return Number(m2[1]);
  const m3 = /^\d{4}-0?(1[0-2]|[1-9])$/.exec(clean);
  if (m3) return Number(m3[1]);
  return null;
}

/**
 * Đọc bảng số liệu 12 tháng từ file Excel (.xlsx) hoặc CSV (.csv, .txt)
 * và trả về Map tháng (1..12) -> giá trị số đã chuẩn hóa.
 */
export async function parseMonthlyExcelOrCsvFile(
  file: File,
): Promise<Record<number, number>> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  let rows: string[][] = [];

  if (ext === "xlsx") {
    const buffer = await file.arrayBuffer();
    const entries = await unzipXlsxEntries(buffer);
    rows = extractRowsFromXlsxXml(entries);
  } else {
    const text = await file.text();
    rows = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
        if (line.includes(";")) return line.split(";").map((c) => c.trim());
        return line.split(",").map((c) => c.trim());
      });
  }

  const result: Record<number, number> = {};

  // Cách 1: Dò theo dòng có nhãn Tháng 1..12 ở cột đầu
  for (const row of rows) {
    if (row.length < 2) continue;
    const month = detectMonthFromLabel(row[0] ?? "");
    if (month && month >= 1 && month <= 12) {
      // Tìm ô đầu tiên sau cột tháng có chứa giá trị số hợp lệ
      for (let c = 1; c < row.length; c += 1) {
        const cell = (row[c] ?? "").trim();
        if (!cell) continue;
        // Bỏ qua cột nếu nó chỉ là chữ đơn vị (VD: "lít", "kg")
        if (!/\d/.test(cell)) continue;
        const val = parseAppNumber(cell, Number.NaN);
        if (Number.isFinite(val)) {
          result[month] = val;
          break;
        }
      }
    }
  }

  if (Object.keys(result).length > 0) {
    return result;
  }

  // Cách 2: Dò bảng ngang (dòng tiêu đề có T1..T12 và dòng dưới là 12 số)
  for (let r = 0; r < rows.length - 1; r += 1) {
    const header = rows[r];
    const nextRow = rows[r + 1];
    let matchedCols = 0;
    const colToMonth = new Map<number, number>();
    header.forEach((cell, cIdx) => {
      const m = detectMonthFromLabel(cell);
      if (m) {
        matchedCols += 1;
        colToMonth.set(cIdx, m);
      }
    });
    if (matchedCols >= 3) {
      colToMonth.forEach((m, cIdx) => {
        const val = parseAppNumber(nextRow[cIdx] ?? "", Number.NaN);
        if (Number.isFinite(val)) result[m] = val;
      });
      if (Object.keys(result).length > 0) return result;
    }
  }

  // Cách 3: Lấy tối đa 12 dòng số liệu liên tiếp
  let monthCursor = 1;
  for (const row of rows) {
    if (monthCursor > 12) break;
    for (const cell of row) {
      if (!/\d/.test(cell)) continue;
      const val = parseAppNumber(cell, Number.NaN);
      if (Number.isFinite(val)) {
        result[monthCursor] = val;
        monthCursor += 1;
        break;
      }
    }
  }

  return result;
}

