import "server-only";
import net from "node:net";
import tls from "node:tls";
import { randomUUID } from "node:crypto";
import { emsDb, queryRows } from "@/lib/server-db";
import { formatStoredVietnam } from "@/lib/vietnam-time";

/**
 * Gửi thông báo cảnh báo thật qua Email (SMTP), Telegram (bot), Zalo (tin nhắn OA tới người quan tâm)
 * và SMS (eSMS.vn). Cấu hình lưu ở bảng notification_settings (trang Cấu hình → Cấu hình thông báo);
 * người nhận + kênh của từng người lấy từ alert_recipients của dự án.
 * Mỗi lần gửi được ghi vào notification_log để trang Cảnh báo hiển thị trạng thái gửi thực tế.
 */

type Row = Record<string, unknown>;

export type NotificationChannel = "Email" | "SMS" | "Zalo" | "Telegram";

export type NotificationSettings = {
  email: { enabled: boolean; host: string; port: number; secure: boolean; user: string; password: string; from: string };
  telegram: { enabled: boolean; botToken: string };
  zalo: { enabled: boolean; appId: string; secretKey: string; accessToken: string; refreshToken: string };
  sms: { enabled: boolean; apiKey: string; secretKey: string; brandname: string; smsType: string; unicode: boolean };
};

export const SECRET_MASK = "••••••••";

const EMPTY_SETTINGS: NotificationSettings = {
  email: { enabled: false, host: "", port: 587, secure: false, user: "", password: "", from: "" },
  telegram: { enabled: false, botToken: "" },
  zalo: { enabled: false, appId: "", secretKey: "", accessToken: "", refreshToken: "" },
  sms: { enabled: false, apiKey: "", secretKey: "", brandname: "", smsType: "2", unicode: false },
};

/** Trường bí mật: không bao giờ trả nguyên văn về trình duyệt. */
const SECRET_FIELDS: { [K in keyof NotificationSettings]?: (keyof NotificationSettings[K])[] } = {
  email: ["password"],
  telegram: ["botToken"],
  zalo: ["secretKey", "accessToken", "refreshToken"],
  sms: ["apiKey", "secretKey"],
};

let schemaReady: Promise<void> | null = null;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

export function ensureNotifierSchema() {
  schemaReady ??= (async () => {
    await emsDb.query(
      `CREATE TABLE IF NOT EXISTS notification_settings (
        id TINYINT UNSIGNED NOT NULL,
        payload LONGTEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );
    await emsDb.query(
      `CREATE TABLE IF NOT EXISTS notification_log (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        alert_event_id VARCHAR(64) NULL,
        project_id VARCHAR(64) NULL,
        channel VARCHAR(20) NOT NULL,
        recipient VARCHAR(255) NOT NULL,
        status VARCHAR(10) NOT NULL,
        error VARCHAR(500) NULL,
        sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_notification_log_event (alert_event_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );
    for (const sql of [
      "ALTER TABLE alert_recipients ADD COLUMN channels VARCHAR(100) NULL",
      "ALTER TABLE alert_recipients ADD COLUMN telegram_chat_id VARCHAR(64) NULL",
      "ALTER TABLE alert_recipients ADD COLUMN zalo_user_id VARCHAR(64) NULL",
    ]) {
      await emsDb.query(sql).catch(() => undefined);
    }
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

/* ---------------- Cấu hình ---------------- */

function mergeSettings(raw: unknown): NotificationSettings {
  const source = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof NotificationSettings, Row>>;
  const out = structuredClone(EMPTY_SETTINGS);
  for (const channel of Object.keys(out) as (keyof NotificationSettings)[]) {
    const target = out[channel] as Record<string, unknown>;
    const incoming = source[channel] ?? {};
    for (const key of Object.keys(target)) {
      const value = incoming[key];
      if (value === undefined || value === null) continue;
      if (typeof target[key] === "boolean") target[key] = value === true || value === "true" || value === 1;
      else if (typeof target[key] === "number") target[key] = Number(value) || target[key];
      else target[key] = text(value);
    }
  }
  return out;
}

async function loadSettings(): Promise<NotificationSettings> {
  await ensureNotifierSchema();
  const rows = await queryRows<Row>("SELECT payload FROM notification_settings WHERE id = 1 LIMIT 1");
  if (!rows[0]) return structuredClone(EMPTY_SETTINGS);
  try {
    return mergeSettings(JSON.parse(text(rows[0].payload)));
  } catch {
    return structuredClone(EMPTY_SETTINGS);
  }
}

async function storeSettings(settings: NotificationSettings) {
  await emsDb.execute(
    `INSERT INTO notification_settings (id, payload) VALUES (1, ?)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
    [JSON.stringify(settings)],
  );
}

/** Cấu hình cho trình duyệt: trường bí mật đã đặt thì thay bằng dấu che. */
export async function getMaskedSettings() {
  const settings = await loadSettings();
  const masked = structuredClone(settings) as unknown as Record<string, Record<string, unknown>>;
  for (const [channel, fields] of Object.entries(SECRET_FIELDS)) {
    for (const field of fields as string[]) {
      if (masked[channel][field]) masked[channel][field] = SECRET_MASK;
    }
  }
  return masked as unknown as NotificationSettings;
}

/** Lưu cấu hình; trường bí mật để nguyên dấu che thì giữ giá trị cũ. */
export async function saveSettings(input: unknown) {
  const current = await loadSettings();
  const next = mergeSettings(input) as unknown as Record<string, Record<string, unknown>>;
  const old = current as unknown as Record<string, Record<string, unknown>>;
  for (const [channel, fields] of Object.entries(SECRET_FIELDS)) {
    for (const field of fields as string[]) {
      if (next[channel][field] === SECRET_MASK) next[channel][field] = old[channel][field];
    }
  }
  await storeSettings(next as unknown as NotificationSettings);
  return getMaskedSettings();
}

/* ---------------- Email (SMTP, không cần thư viện ngoài) ---------------- */

type SmtpReply = { code: number; text: string };

function createSmtpReader(socket: net.Socket | tls.TLSSocket) {
  let buffer = "";
  let lines: string[] = [];
  const ready: SmtpReply[] = [];
  const waiters: { resolve: (reply: SmtpReply) => void; reject: (error: Error) => void }[] = [];
  let failure: Error | null = null;

  const onData = (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let index = buffer.indexOf("\r\n");
    while (index >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      lines.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), text: lines.join("\n") };
        lines = [];
        const waiter = waiters.shift();
        if (waiter) waiter.resolve(reply);
        else ready.push(reply);
      }
      index = buffer.indexOf("\r\n");
    }
  };
  const onError = (error: Error) => {
    failure = error;
    while (waiters.length) waiters.shift()!.reject(error);
  };
  socket.on("data", onData);
  socket.on("error", onError);

  return {
    read(): Promise<SmtpReply> {
      if (ready.length) return Promise.resolve(ready.shift()!);
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    detach() {
      socket.off("data", onData);
      socket.off("error", onError);
    },
  };
}

function encodeHeader(value: string) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function parseAddress(value: string) {
  const match = /^(.*)<([^>]+)>\s*$/.exec(value.trim());
  if (match) return { name: match[1].trim().replace(/^"|"$/g, ""), address: match[2].trim() };
  return { name: "", address: value.trim() };
}

async function sendSmtpMail(
  cfg: NotificationSettings["email"],
  to: string,
  subject: string,
  body: string,
) {
  const host = cfg.host.trim();
  const port = Number(cfg.port) || 587;
  if (!host) throw new Error("Chưa cấu hình máy chủ SMTP.");
  const from = parseAddress(cfg.from || cfg.user);
  if (!from.address) throw new Error("Chưa cấu hình địa chỉ gửi (From).");
  const implicitTls = cfg.secure || port === 465;

  let socket: net.Socket | tls.TLSSocket = await new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    const s = implicitTls
      ? tls.connect({ host, port, servername: host }, () => resolve(s))
      : net.connect({ host, port }, () => resolve(s));
    s.once("error", onError);
    s.setTimeout(20_000, () => s.destroy(new Error("SMTP quá thời gian chờ.")));
  });
  let reader = createSmtpReader(socket);
  const write = (line: string) => socket.write(`${line}\r\n`);
  const expect = async (codes: number[], step: string) => {
    const reply = await reader.read();
    if (!codes.includes(reply.code)) throw new Error(`SMTP ${step}: ${reply.text}`);
    return reply;
  };

  try {
    await expect([220], "kết nối");
    write("EHLO ems-console");
    let ehlo = await expect([250], "EHLO");
    if (!implicitTls && /STARTTLS/i.test(ehlo.text)) {
      write("STARTTLS");
      await expect([220], "STARTTLS");
      reader.detach();
      socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const secured = tls.connect({ socket: socket as net.Socket, servername: host }, () => resolve(secured));
        secured.once("error", reject);
      });
      reader = createSmtpReader(socket);
      write("EHLO ems-console");
      ehlo = await expect([250], "EHLO sau STARTTLS");
    }
    if (cfg.user) {
      write("AUTH LOGIN");
      await expect([334], "AUTH");
      write(Buffer.from(cfg.user, "utf8").toString("base64"));
      await expect([334], "AUTH user");
      write(Buffer.from(cfg.password, "utf8").toString("base64"));
      await expect([235], "đăng nhập (sai tài khoản/mật khẩu ứng dụng?)");
    }
    write(`MAIL FROM:<${from.address}>`);
    await expect([250], "MAIL FROM");
    write(`RCPT TO:<${to}>`);
    await expect([250, 251], "RCPT TO");
    write("DATA");
    await expect([354], "DATA");
    const fromHeader = from.name ? `${encodeHeader(from.name)} <${from.address}>` : from.address;
    const bodyBase64 = (Buffer.from(body, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
    const message = [
      `From: ${fromHeader}`,
      `To: <${to}>`,
      `Subject: ${encodeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@ems-console>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      bodyBase64,
    ].join("\r\n");
    socket.write(`${message}\r\n.\r\n`);
    await expect([250], "gửi nội dung");
    write("QUIT");
  } finally {
    reader.detach();
    socket.end();
  }
}

/* ---------------- Telegram ---------------- */

async function sendTelegram(cfg: NotificationSettings["telegram"], chatId: string, body: string) {
  if (!cfg.botToken) throw new Error("Chưa cấu hình Bot Token Telegram.");
  const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: body, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!res.ok || !data.ok) throw new Error(`Telegram: ${data.description || `HTTP ${res.status}`}`);
}

/** Danh sách chat đã nhắn cho bot (để lấy Chat ID gán cho người nhận). */
export async function listTelegramChats() {
  const settings = await loadSettings();
  if (!settings.telegram.botToken) throw new Error("Chưa cấu hình Bot Token Telegram.");
  const res = await fetch(`https://api.telegram.org/bot${settings.telegram.botToken}/getUpdates?limit=100`, {
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
    result?: { message?: { chat?: Row }; my_chat_member?: { chat?: Row } }[];
  };
  if (!data.ok) throw new Error(`Telegram: ${data.description || `HTTP ${res.status}`}`);
  const chats = new Map<string, { chatId: string; name: string; type: string }>();
  for (const update of data.result ?? []) {
    const chat = update.message?.chat ?? update.my_chat_member?.chat;
    if (!chat) continue;
    const chatId = text(chat.id);
    const name =
      text(chat.title) || [text(chat.first_name), text(chat.last_name)].filter(Boolean).join(" ") || text(chat.username);
    chats.set(chatId, { chatId, name: name || chatId, type: text(chat.type) });
  }
  return [...chats.values()];
}

/* ---------------- Zalo OA (tin nhắn tư vấn tới người quan tâm) ---------------- */

async function refreshZaloToken(settings: NotificationSettings) {
  const cfg = settings.zalo;
  if (!cfg.appId || !cfg.secretKey || !cfg.refreshToken) {
    throw new Error("Access token Zalo hết hạn và chưa đủ App ID / Secret Key / Refresh Token để làm mới.");
  }
  const res = await fetch("https://oauth.zaloapp.com/v4/oa/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", secret_key: cfg.secretKey },
    body: new URLSearchParams({ refresh_token: cfg.refreshToken, app_id: cfg.appId, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    error?: number;
    error_name?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(`Zalo làm mới token: ${data.error_description || data.error_name || `HTTP ${res.status}`}`);
  }
  settings.zalo.accessToken = data.access_token;
  if (data.refresh_token) settings.zalo.refreshToken = data.refresh_token;
  await storeSettings(settings);
}

async function sendZalo(settings: NotificationSettings, userId: string, body: string, retried = false) {
  if (!settings.zalo.accessToken) throw new Error("Chưa cấu hình Access Token Zalo OA.");
  const res = await fetch("https://openapi.zalo.me/v3.0/oa/message/cs", {
    method: "POST",
    headers: { "Content-Type": "application/json", access_token: settings.zalo.accessToken },
    body: JSON.stringify({ recipient: { user_id: userId }, message: { text: body.slice(0, 2000) } }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: number; message?: string };
  if (data.error === 0) return;
  // -216 / -124: access token không hợp lệ / hết hạn → làm mới rồi thử lại một lần.
  if (!retried && (data.error === -216 || data.error === -124)) {
    await refreshZaloToken(settings);
    return sendZalo(settings, userId, body, true);
  }
  throw new Error(`Zalo: ${data.message || `HTTP ${res.status}`} (mã ${data.error ?? "?"})`);
}

/* ---------------- SMS (eSMS.vn) ---------------- */

function removeVietnameseMarks(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function normalizePhone(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+84")) return `0${digits.slice(3)}`;
  if (digits.startsWith("84") && digits.length >= 11) return `0${digits.slice(2)}`;
  return digits;
}

async function sendEsms(cfg: NotificationSettings["sms"], phone: string, body: string) {
  if (!cfg.apiKey || !cfg.secretKey) throw new Error("Chưa cấu hình ApiKey / SecretKey eSMS.");
  const content = cfg.unicode ? body : removeVietnameseMarks(body);
  const res = await fetch("https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ApiKey: cfg.apiKey,
      SecretKey: cfg.secretKey,
      Phone: normalizePhone(phone),
      Content: content,
      Brandname: cfg.brandname || undefined,
      SmsType: cfg.smsType || "2",
      IsUnicode: cfg.unicode ? "1" : "0",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { CodeResult?: string; ErrorMessage?: string };
  if (String(data.CodeResult) !== "100") {
    throw new Error(`eSMS: ${data.ErrorMessage || `mã ${data.CodeResult ?? res.status}`}`);
  }
}

/* ---------------- Điều phối ---------------- */

async function deliver(
  settings: NotificationSettings,
  channel: NotificationChannel,
  target: string,
  subject: string,
  body: string,
) {
  if (channel === "Email") return sendSmtpMail(settings.email, target, subject, body);
  if (channel === "Telegram") return sendTelegram(settings.telegram, target, body);
  if (channel === "Zalo") return sendZalo(settings, target, body);
  return sendEsms(settings.sms, target, body);
}

function channelEnabled(settings: NotificationSettings, channel: NotificationChannel) {
  if (channel === "Email") return settings.email.enabled;
  if (channel === "Telegram") return settings.telegram.enabled;
  if (channel === "Zalo") return settings.zalo.enabled;
  return settings.sms.enabled;
}

async function logDelivery(entry: {
  alertEventId: string | null;
  projectId: string | null;
  channel: NotificationChannel;
  recipient: string;
  error: string | null;
}) {
  await emsDb
    .execute(
      `INSERT INTO notification_log (alert_event_id, project_id, channel, recipient, status, error)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entry.alertEventId,
        entry.projectId,
        entry.channel,
        entry.recipient.slice(0, 255),
        entry.error ? "failed" : "sent",
        entry.error ? entry.error.slice(0, 500) : null,
      ],
    )
    .catch((error) => console.error("notification_log insert failed", error));
}

/** Gửi thử một kênh tới một địa chỉ (email / SĐT / chat ID / Zalo user ID). */
export async function sendTestNotification(channel: NotificationChannel, target: string) {
  const settings = await loadSettings();
  const to = target.trim();
  if (!to) throw new Error("Vui lòng nhập nơi nhận để gửi thử.");
  const body = `[EMS] Tin nhắn thử kênh ${channel} lúc ${formatStoredVietnam(new Date().toISOString()) ?? ""}. Cấu hình thông báo hoạt động bình thường.`;
  try {
    await deliver(settings, channel, to, "[EMS] Tin nhắn thử", body);
    await logDelivery({ alertEventId: null, projectId: null, channel, recipient: to, error: null });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logDelivery({ alertEventId: null, projectId: null, channel, recipient: to, error: message });
    throw new Error(message);
  }
}

export type AlertNotice = {
  eventId: string;
  projectId: string;
  pointName: string;
  parameter: string;
  severity: string;
  message: string;
  occurredAt: string;
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: "NGHIÊM TRỌNG",
  warning: "CẢNH BÁO",
  info: "THÔNG TIN",
};

/** Gửi cảnh báo vừa phát sinh tới người nhận của dự án theo kênh từng người đã chọn. Không ném lỗi. */
export async function notifyAlertEvent(notice: AlertNotice) {
  try {
    const settings = await loadSettings();
    const anyEnabled = (["Email", "SMS", "Zalo", "Telegram"] as NotificationChannel[]).some((channel) =>
      channelEnabled(settings, channel),
    );
    if (!anyEnabled) return;

    const [projectRows, recipients] = await Promise.all([
      queryRows<Row>("SELECT name FROM projects WHERE id = ? LIMIT 1", [notice.projectId]),
      queryRows<Row>(
        `SELECT name, email, phone, channels, telegram_chat_id AS telegramChatId, zalo_user_id AS zaloUserId
           FROM alert_recipients WHERE project_id = ?`,
        [notice.projectId],
      ),
    ]);
    if (!recipients.length) return;
    const projectName = text(projectRows[0]?.name) || notice.projectId;
    const severity = SEVERITY_LABEL[notice.severity] ?? notice.severity.toUpperCase();
    const at = formatStoredVietnam(notice.occurredAt) ?? notice.occurredAt;
    const subject = `[EMS] ${severity} – ${notice.parameter} – ${projectName}`;
    const body = [
      `[EMS] ${severity}: ${notice.parameter}`,
      `Dự án: ${projectName}`,
      `Điểm đo: ${notice.pointName}`,
      notice.message,
      `Thời điểm: ${at}`,
    ].join("\n");

    for (const recipient of recipients) {
      const channels = text(recipient.channels)
        ? text(recipient.channels).split(",").map((item) => item.trim())
        : [...(text(recipient.email) ? ["Email"] : []), ...(text(recipient.phone) ? ["SMS"] : [])];
      for (const channel of channels as NotificationChannel[]) {
        if (!channelEnabled(settings, channel)) continue;
        const target =
          channel === "Email"
            ? text(recipient.email)
            : channel === "Telegram"
              ? text(recipient.telegramChatId)
              : channel === "Zalo"
                ? text(recipient.zaloUserId)
                : text(recipient.phone);
        if (!target) continue;
        let error: string | null = null;
        try {
          await deliver(settings, channel, target, subject, body);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        await logDelivery({
          alertEventId: notice.eventId,
          projectId: notice.projectId,
          channel,
          recipient: `${text(recipient.name) || target} (${target})`,
          error,
        });
      }
    }
  } catch (error) {
    console.error("notifyAlertEvent failed", error);
  }
}

/** Trạng thái gửi thật của các sự kiện cảnh báo (cho trang Cảnh báo). */
export async function listDeliveries(eventIds: string[]) {
  const map = new Map<string, { channel: string; recipient: string; delivered: boolean; error?: string }[]>();
  if (!eventIds.length) return map;
  await ensureNotifierSchema();
  for (let i = 0; i < eventIds.length; i += 500) {
    const chunk = eventIds.slice(i, i + 500);
    const rows = await queryRows<Row>(
      `SELECT alert_event_id AS eventId, channel, recipient, status, error
         FROM notification_log WHERE alert_event_id IN (${chunk.map(() => "?").join(",")})
        ORDER BY id`,
      chunk,
    );
    for (const row of rows) {
      const id = text(row.eventId);
      const list = map.get(id) ?? [];
      list.push({
        channel: text(row.channel),
        recipient: text(row.recipient),
        delivered: text(row.status) === "sent",
        ...(text(row.error) ? { error: text(row.error) } : {}),
      });
      map.set(id, list);
    }
  }
  return map;
}
