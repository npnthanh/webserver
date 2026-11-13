"use client";

import { useEffect, useMemo, useState } from "react";
import {
  INTERNET_LABEL,
  METER_TYPE_LABEL,
  gatewayErrorText,
} from "@/lib/gateway-protocol";
import { formatStoredVietnam } from "@/lib/vietnam-time";

type GatewayDeviceView = {
  gatewayId: string;
  protocolVersion: string | null;
  internet: string | null;
  temperature: string | null;
  humidity: string | null;
  packetNumber: string | null;
  meterType: string | null;
  meterModel: string | null;
  meterId: string | null;
  lastReadingTime: string | null;
  lastIsReplay: boolean | null;
  lastError: number | null;
  lastValues: Record<string, unknown> | null;
  lastDisposition: string | null;
  lastSeenAt: string | null;
  wifi: string | null;
  passWifi: string | null;
  timeUpdate: number;
  hmacEnabled: boolean;
  hmacSecret: string | null;
};

type GatewayConsoleData = {
  serverTime: string;
  gateways: GatewayDeviceView[];
};

type LoadState = {
  data: GatewayConsoleData | null;
  error: string;
  loading: boolean;
};

function isGatewayOnline(device: GatewayDeviceView) {
  if (!device.lastSeenAt) return false;
  const seen = Date.parse(device.lastSeenAt);
  if (!Number.isFinite(seen)) return false;
  const windowMs = Math.max(device.timeUpdate * 4, 180) * 1000;
  return Date.now() - seen <= windowMs;
}

export function GatewayConsole() {
  const [state, setState] = useState<LoadState>({ data: null, error: "", loading: true });
  const [selectedId, setSelectedId] = useState("");
  const [picked, setPicked] = useState(false);
  const [draftId, setDraftId] = useState("");
  const [wifi, setWifi] = useState("");
  const [passWifi, setPassWifi] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [timeUpdate, setTimeUpdate] = useState("30");
  const [hmacSecret, setHmacSecret] = useState("");
  const [showHmac, setShowHmac] = useState(false);
  const [configMessage, setConfigMessage] = useState("");
  const [configError, setConfigError] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  async function load(options?: { silent?: boolean }) {
    if (!options?.silent) setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await fetch(`/api/gateway/console`, { cache: "no-store" });
      const payload = (await response.json()) as GatewayConsoleData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Không thể tải dữ liệu gateway.");
      setState({ data: payload, error: "", loading: false });
    } catch (error) {
      // Lần tự làm mới nền bị lỗi mạng tạm thời: giữ nguyên dữ liệu đang hiển thị.
      if (options?.silent) return;
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : "Không thể tải dữ liệu gateway.",
      });
    }
  }

  useEffect(() => {
    void load();
    // Tự làm mới trạng thái trực tuyến/ngoại tuyến (gateway gửi mặc định 30 giây/lần).
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load({ silent: true });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const device = state.data?.gateways[0];
    if (picked || !device) return;
    setSelectedId(device.gatewayId);
    setDraftId(device.gatewayId);
    setWifi(device.wifi ?? "");
    setPassWifi(device.passWifi ?? "");
    setTimeUpdate(String(device.timeUpdate));
    setHmacSecret(device.hmacSecret ?? "");
    setPicked(true);
  }, [picked, state.data]);

  const selected = useMemo(
    () => state.data?.gateways.find((item) => item.gatewayId === selectedId) ?? null,
    [selectedId, state.data],
  );

  const summary = useMemo(() => {
    const list = state.data?.gateways ?? [];
    const online = list.filter(isGatewayOnline).length;
    return {
      total: list.length,
      online,
      offline: Math.max(0, list.length - online),
    };
  }, [state.data]);

  function chooseGateway(device: GatewayDeviceView) {
    setSelectedId(device.gatewayId);
    setDraftId(device.gatewayId);
    setWifi(device.wifi ?? "");
    setPassWifi(device.passWifi ?? "");
    setTimeUpdate(String(device.timeUpdate));
    setHmacSecret(device.hmacSecret ?? "");
    setPicked(true);
    setConfigMessage("");
    setConfigError("");
  }

  async function saveConfig() {
    setSavingConfig(true);
    setConfigMessage("");
    setConfigError("");
    try {
      await postConsole({
        action: "config",
        gatewayId: draftId.trim(),
        wifi,
        passWifi,
        timeUpdate: Number(timeUpdate),
        hmacSecret: hmacSecret.trim() || null,
      });
      setSelectedId(draftId.trim());
      setPicked(true);
      setConfigMessage("Đã lưu cấu hình cho Gateway.");
      await load();
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : "Không lưu được cấu hình.");
    } finally {
      setSavingConfig(false);
    }
  }

  const data = state.data;

  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8 font-sans">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Quản lý Gateway
            </h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
              {summary.total} thiết bị
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Theo dõi trạng thái kết nối thiết bị Gateway tại nhà máy và cấu hình mạng truyền dữ liệu từ xa.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors"
        >
          Làm mới trạng thái
        </button>
      </div>

      {state.loading && <p className="mb-4 text-xs text-slate-500">Đang tải trạng thái Gateway...</p>}
      {state.error && <p className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{state.error}</p>}

      {data && (
        <>
          <section className="mb-6 grid gap-3 sm:grid-cols-3">
            <StatCard label="TỔNG GATEWAY" value={summary.total} hint="Thiết bị đã kết nối hệ thống" />
            <StatCard
              label="ĐANG TRỰC TUYẾN"
              value={summary.online}
              valueClass="text-emerald-700"
              hint="Đang gửi dữ liệu định kỳ"
            />
            <StatCard
              label="MẤT KẾT NỐI"
              value={summary.offline}
              valueClass={summary.offline > 0 ? "text-amber-600" : "text-slate-700"}
              hint="Tạm ngưng hoặc chưa đồng bộ"
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-sm font-bold text-slate-900">Danh sách thiết bị Gateway</h2>
              <p className="mb-4 text-xs text-slate-500">
                Chọn một Gateway bên dưới để xem trạng thái hoặc thay đổi cấu hình từ xa.
              </p>

              {data.gateways.length === 0 ? (
                <Empty text="Chưa có thiết bị Gateway nào kết nối lên hệ thống." />
              ) : (
                <div className="space-y-3">
                  {data.gateways.map((device) => {
                    const online = isGatewayOnline(device);
                    const active = selectedId === device.gatewayId;
                    return (
                      <button
                        key={device.gatewayId}
                        type="button"
                        onClick={() => chooseGateway(device)}
                        className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                          active
                            ? "border-emerald-500 bg-emerald-50/40 shadow-xs"
                            : "border-slate-200/80 bg-white hover:border-slate-300"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-xs font-bold text-white">
                              GW
                            </span>
                            <div>
                              <p className="text-sm font-bold text-slate-900">
                                Gateway #{device.gatewayId}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                Cập nhật gần nhất: {formatStamp(device.lastSeenAt) ?? "Chưa xác định"}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <InternetBadge internet={device.internet} />
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                online
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  online ? "bg-emerald-500" : "bg-slate-400"
                                }`}
                              />
                              {online ? "Trực tuyến" : "Ngoại tuyến"}
                            </span>
                          </div>
                        </div>

                        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-slate-100 pt-3 text-xs sm:grid-cols-3">
                          <Field
                            label="Đồng hồ đang đọc"
                            value={
                              device.meterModel
                                ? `${device.meterModel}${device.meterId ? ` (SN: ${device.meterId})` : ""}`
                                : null
                            }
                          />
                          <Field label="Loại năng lượng" value={meterTypeText(device.meterType)} />
                          <Field label="Chu kỳ gửi dữ liệu" value={`${device.timeUpdate} giây`} />
                          <Field
                            label="Nhiệt độ / Độ ẩm tủ"
                            value={
                              device.temperature || device.humidity
                                ? `${device.temperature ?? "--"} °C · ${device.humidity ?? "--"} %`
                                : null
                            }
                          />
                          <Field label="Wifi đã cài" value={device.wifi || "Mặc định thiết bị"} />
                          <Field
                            label="Tình trạng phần cứng"
                            value={
                              device.lastError == null
                                ? "Bình thường"
                                : gatewayErrorText(device.lastError)
                            }
                          />
                        </dl>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">Cấu hình từ xa cho Gateway</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Thiết lập thông tin Wifi và chu kỳ đọc dữ liệu phản hồi về cho Gateway khi thiết bị kết nối.
              </p>

              <div className="mt-4 grid gap-3.5">
                <TextField label="Mã Gateway (GID)" value={draftId} onChange={setDraftId} placeholder="VD: 1" />
                <TextField
                  label="Tên mạng Wifi (SSID)"
                  value={wifi}
                  onChange={setWifi}
                  placeholder="Để trống nếu giữ nguyên Wifi hiện tại trên mạch"
                />
                <label className="text-xs font-medium text-slate-600">
                  Mật khẩu Wifi
                  <input
                    type={showPass ? "text" : "password"}
                    value={passWifi}
                    onChange={(event) => setPassWifi(event.target.value)}
                    placeholder="Nhập mật khẩu Wifi mới (nếu đổi)"
                    className="mt-1 block h-10 w-full rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    checked={showPass}
                    onChange={(event) => setShowPass(event.target.checked)}
                  />
                  Hiện mật khẩu Wifi
                </label>
                <TextField
                  label="Chu kỳ gửi dữ liệu (giây)"
                  value={timeUpdate}
                  onChange={setTimeUpdate}
                  placeholder="Mặc định 30 giây"
                />

                <details className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                    Cấu hình bảo mật nâng cao (Chữ ký HMAC)
                  </summary>
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-slate-600">
                      Khóa bí mật (secretKey)
                      <input
                        type={showHmac ? "text" : "password"}
                        value={hmacSecret}
                        onChange={(event) => setHmacSecret(event.target.value)}
                        placeholder="Để trống = tắt kiểm tra HMAC"
                        className="mt-1 block h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-[11px] outline-none focus:border-emerald-500"
                      />
                    </label>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2 text-xs text-slate-500">
                        <input
                          type="checkbox"
                          checked={showHmac}
                          onChange={(event) => setShowHmac(event.target.checked)}
                        />
                        Hiện khóa
                      </label>
                      <button
                        type="button"
                        onClick={() => setHmacSecret(generateClientSecret())}
                        className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Tạo khóa mới
                      </button>
                      <button
                        type="button"
                        onClick={() => setHmacSecret("")}
                        className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"
                      >
                        Xóa khóa
                      </button>
                      {selected?.hmacEnabled ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          Đang bật HMAC
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                          Đang tắt HMAC
                        </span>
                      )}
                    </div>
                  </div>
                </details>

                <button
                  type="button"
                  onClick={() => void saveConfig()}
                  disabled={savingConfig}
                  className="mt-1 h-10 rounded-xl bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                >
                  {savingConfig ? "Đang lưu..." : "Lưu cấu hình Gateway"}
                </button>
                {configMessage && <p className="text-xs font-medium text-emerald-700">{configMessage}</p>}
                {configError && <p className="text-xs font-medium text-rose-700">{configError}</p>}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="mt-0.5 break-all text-xs font-medium text-slate-800">
        {value == null || value === "" ? "—" : value}
      </dd>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="text-xs font-medium text-slate-600">
      {label}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block h-10 w-full rounded-xl border border-slate-200 px-3 text-xs text-slate-800 outline-none focus:border-emerald-500"
      />
    </label>
  );
}

function StatCard({
  label,
  value,
  hint,
  valueClass = "text-slate-900",
}: {
  label: string;
  value: number;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-sm">
      <p className="text-[10px] font-bold tracking-wider uppercase text-slate-400">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold tracking-tight ${valueClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function InternetBadge({ internet }: { internet: string | null }) {
  const label = internet ? INTERNET_LABEL[internet] ?? internet : "Chưa rõ";
  const wifi = internet === "W";
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
        wifi ? "bg-sky-100 text-sky-800" : internet === "S" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-500"
      }`}
    >
      {label}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">{text}</p>;
}

function meterTypeText(value: string | null) {
  if (!value) return null;
  return METER_TYPE_LABEL[value] ?? value;
}

function formatStamp(value: string | null) {
  if (!value) return null;
  return formatStoredVietnam(value) ?? value;
}

function generateClientSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function postConsole(body: Record<string, unknown>) {
  const response = await fetch("/api/gateway/console", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "Không lưu được.");
}
