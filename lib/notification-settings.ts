import { dbFetch } from "@/lib/db-client";

/** Cấu hình gửi thông báo thật (trang Cấu hình → Cấu hình thông báo). Trường bí mật trả về dạng che. */
export type NotificationSettings = {
  email: { enabled: boolean; host: string; port: number; secure: boolean; user: string; password: string; from: string };
  telegram: { enabled: boolean; botToken: string };
  zalo: { enabled: boolean; appId: string; secretKey: string; accessToken: string; refreshToken: string };
  sms: { enabled: boolean; apiKey: string; secretKey: string; brandname: string; smsType: string; unicode: boolean };
};

export type NotificationChannelId = "Email" | "SMS" | "Zalo" | "Telegram";

export const EMPTY_NOTIFICATION_SETTINGS: NotificationSettings = {
  email: { enabled: false, host: "", port: 587, secure: false, user: "", password: "", from: "" },
  telegram: { enabled: false, botToken: "" },
  zalo: { enabled: false, appId: "", secretKey: "", accessToken: "", refreshToken: "" },
  sms: { enabled: false, apiKey: "", secretKey: "", brandname: "", smsType: "2", unicode: false },
};

export function loadNotificationSettings() {
  return dbFetch<NotificationSettings>("notification-settings");
}

export function saveNotificationSettings(settings: NotificationSettings) {
  return dbFetch<NotificationSettings>("notification-settings", {
    method: "POST",
    body: JSON.stringify(settings),
  });
}

export function sendTestNotification(channel: NotificationChannelId, target: string) {
  return dbFetch<{ ok: boolean }>("notification-test", {
    method: "POST",
    body: JSON.stringify({ channel, target }),
  });
}

export function loadTelegramChats() {
  return dbFetch<{ chatId: string; name: string; type: string }[]>("telegram-chats");
}
