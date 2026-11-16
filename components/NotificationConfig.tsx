"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  EMPTY_NOTIFICATION_SETTINGS,
  loadNotificationSettings,
  loadTelegramChats,
  saveNotificationSettings,
  sendTestNotification,
  type NotificationChannelId,
  type NotificationSettings,
} from "@/lib/notification-settings";

type ChannelKey = keyof NotificationSettings;

const CHANNEL_ID: Record<ChannelKey, NotificationChannelId> = {
  email: "Email",
  telegram: "Telegram",
  zalo: "Zalo",
  sms: "SMS",
};

const TEST_PLACEHOLDER: Record<ChannelKey, string> = {
  email: "Email nhận thử",
  telegram: "Chat ID nhận thử",
  zalo: "Zalo user ID nhận thử",
  sms: "Số điện thoại nhận thử",
};

export function NotificationConfig() {
  const [settings, setSettings] = useState<NotificationSettings>(EMPTY_NOTIFICATION_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [testTarget, setTestTarget] = useState<Record<ChannelKey, string>>({ email: "", telegram: "", zalo: "", sms: "" });
  const [testState, setTestState] = useState<Partial<Record<ChannelKey, { busy?: boolean; ok?: boolean; text?: string }>>>({});
  const [telegramChats, setTelegramChats] = useState<{ chatId: string; name: string; type: string }[] | null>(null);
  const [telegramError, setTelegramError] = useState("");

  useEffect(() => {
    let active = true;
    loadNotificationSettings()
      .then((data) => {
        if (active) setSettings(data);
      })
      .catch((error) => {
        if (active) setMessage({ type: "error", text: error instanceof Error ? error.message : "Không tải được cấu hình." });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function update<K extends ChannelKey>(channel: K, patch: Partial<NotificationSettings[K]>) {
    setSettings((current) => ({ ...current, [channel]: { ...current[channel], ...patch } }));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      setSettings(await saveNotificationSettings(settings));
      setMessage({ type: "ok", text: "Đã lưu cấu hình thông báo." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Không lưu được cấu hình." });
    } finally {
      setSaving(false);
    }
  }

  async function test(channel: ChannelKey) {
    setTestState((current) => ({ ...current, [channel]: { busy: true } }));
    try {
      // Lưu trước để gửi thử đúng với cấu hình đang nhập.
      setSettings(await saveNotificationSettings(settings));
      await sendTestNotification(CHANNEL_ID[channel], testTarget[channel]);
      setTestState((current) => ({ ...current, [channel]: { ok: true, text: "Đã gửi thử thành công." } }));
    } catch (error) {
      setTestState((current) => ({
        ...current,
        [channel]: { ok: false, text: error instanceof Error ? error.message : "Gửi thử thất bại." },
      }));
    }
  }

  async function fetchTelegramChats() {
    setTelegramError("");
    try {
      setSettings(await saveNotificationSettings(settings));
      setTelegramChats(await loadTelegramChats());
    } catch (error) {
      setTelegramError(error instanceof Error ? error.message : "Không lấy được danh sách.");
    }
  }

  function testRow(channel: ChannelKey) {
    const state = testState[channel];
    return (
      <div className="mt-4 border-t border-slate-100 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input max-w-xs"
            value={testTarget[channel]}
            onChange={(e) => setTestTarget((current) => ({ ...current, [channel]: e.target.value }))}
            placeholder={TEST_PLACEHOLDER[channel]}
          />
          <button
            type="button"
            onClick={() => void test(channel)}
            disabled={state?.busy || !testTarget[channel].trim()}
            className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {state?.busy ? "Đang gửi..." : "Gửi thử"}
          </button>
        </div>
        {state?.text ? (
          <p className={`mt-2 text-xs font-medium ${state.ok ? "text-emerald-700" : "text-rose-600"}`}>{state.text}</p>
        ) : null}
      </div>
    );
  }

  if (loading) {
    return <div className="p-8 text-sm text-slate-500">Đang tải cấu hình thông báo...</div>;
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-4 font-sans sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Cấu hình thông báo</h1>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="h-10 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
        >
          {saving ? "Đang lưu..." : "Lưu cấu hình"}
        </button>
      </div>
      {message ? (
        <p
          className={`rounded-lg px-3 py-2 text-xs font-medium ${
            message.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <ChannelCard
        title="Email (SMTP)"
        enabled={settings.email.enabled}
        onToggle={(enabled) => update("email", { enabled })}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Máy chủ SMTP">
            <input className="input" value={settings.email.host} onChange={(e) => update("email", { host: e.target.value })} placeholder="VD: smtp.gmail.com" />
          </Field>
          <Field label="Cổng">
            <input
              className="input"
              inputMode="numeric"
              value={String(settings.email.port || "")}
              onChange={(e) => update("email", { port: Number(e.target.value.replace(/\D/g, "")) || 0 })}
              placeholder="587 hoặc 465"
            />
          </Field>
          <Field label="Tài khoản đăng nhập">
            <input className="input" value={settings.email.user} onChange={(e) => update("email", { user: e.target.value })} placeholder="VD: canhbao@congty.vn" />
          </Field>
          <Field label="Mật khẩu (mật khẩu ứng dụng)">
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={settings.email.password}
              onChange={(e) => update("email", { password: e.target.value })}
            />
          </Field>
          <Field label="Người gửi (From)">
            <input className="input" value={settings.email.from} onChange={(e) => update("email", { from: e.target.value })} placeholder="VD: EMS Cảnh báo <canhbao@congty.vn>" />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-emerald-600"
              checked={settings.email.secure}
              onChange={(e) => update("email", { secure: e.target.checked })}
            />
            Kết nối SSL/TLS ngay (cổng 465)
          </label>
        </div>
        {testRow("email")}
      </ChannelCard>

      <ChannelCard
        title="Telegram"
        enabled={settings.telegram.enabled}
        onToggle={(enabled) => update("telegram", { enabled })}
      >
        <Field label="Bot Token (lấy từ @BotFather)">
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={settings.telegram.botToken}
            onChange={(e) => update("telegram", { botToken: e.target.value })}
            placeholder="VD: 123456789:AA..."
          />
        </Field>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void fetchTelegramChats()}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Lấy Chat ID của người đã nhắn bot
          </button>
          {telegramError ? <p className="mt-2 text-xs font-medium text-rose-600">{telegramError}</p> : null}
          {telegramChats ? (
            telegramChats.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">Chưa có ai nhắn bot. Người nhận cần mở bot và gửi /start trước.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-100 text-xs">
                {telegramChats.map((chat) => (
                  <li key={chat.chatId} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-slate-700">{chat.name}</span>
                    <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-800">{chat.chatId}</code>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
        {testRow("telegram")}
      </ChannelCard>

      <ChannelCard title="Zalo OA" enabled={settings.zalo.enabled} onToggle={(enabled) => update("zalo", { enabled })}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="App ID">
            <input className="input" value={settings.zalo.appId} onChange={(e) => update("zalo", { appId: e.target.value })} />
          </Field>
          <Field label="Secret Key">
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={settings.zalo.secretKey}
              onChange={(e) => update("zalo", { secretKey: e.target.value })}
            />
          </Field>
          <Field label="Access Token">
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={settings.zalo.accessToken}
              onChange={(e) => update("zalo", { accessToken: e.target.value })}
            />
          </Field>
          <Field label="Refresh Token">
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={settings.zalo.refreshToken}
              onChange={(e) => update("zalo", { refreshToken: e.target.value })}
            />
          </Field>
        </div>
        {testRow("zalo")}
      </ChannelCard>

      <ChannelCard title="SMS (eSMS.vn)" enabled={settings.sms.enabled} onToggle={(enabled) => update("sms", { enabled })}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ApiKey">
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={settings.sms.apiKey}
              onChange={(e) => update("sms", { apiKey: e.target.value })}
            />
          </Field>
          <Field label="SecretKey">
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={settings.sms.secretKey}
              onChange={(e) => update("sms", { secretKey: e.target.value })}
            />
          </Field>
          <Field label="Brandname">
            <input className="input" value={settings.sms.brandname} onChange={(e) => update("sms", { brandname: e.target.value })} placeholder="Tên thương hiệu đã đăng ký" />
          </Field>
          <Field label="Loại tin (SmsType)">
            <input className="input" value={settings.sms.smsType} onChange={(e) => update("sms", { smsType: e.target.value })} placeholder="2 = CSKH brandname" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-emerald-600"
              checked={settings.sms.unicode}
              onChange={(e) => update("sms", { unicode: e.target.checked })}
            />
            Gửi tiếng Việt có dấu (Unicode)
          </label>
        </div>
        {testRow("sms")}
      </ChannelCard>
    </div>
  );
}

function ChannelCard({
  title,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => onToggle(!enabled)}
          className={`inline-flex h-8 items-center gap-2 rounded-full px-3 text-xs font-semibold transition-colors ${
            enabled ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${enabled ? "bg-white" : "bg-slate-400"}`} />
          {enabled ? "Đang bật" : "Đang tắt"}
        </button>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}
