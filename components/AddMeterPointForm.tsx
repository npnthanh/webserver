"use client";

import Link from "next/link";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { hydrateDevices, loadDevices, type CatalogDevice } from "@/lib/devices";
import {
  loadClientMeters,
  hydrateClientMeters,
  saveClientMeters,
  isMeterDescendant,
  type ClientMeter,
} from "@/lib/client-meters";
import {
  hydrateMeterTypeDefs,
  inferMeterTypeIcon,
  loadMeterTypeDefs,
  type MeterTypeDef,
} from "@/lib/meter-types";

export function AddMeterPointForm({
  cancelHref = "/",
  projectId,
  configuredMeterTypes,
  initialMeter,
}: {
  cancelHref?: string;
  projectId?: string;
  configuredMeterTypes?: string[];
  initialMeter?: ClientMeter;
}) {
  const router = useRouter();
  const [energyTypes, setEnergyTypes] = useState<MeterTypeDef[]>(loadMeterTypeDefs);
  const [energy, setEnergy] = useState(
    initialMeter?.utility ?? (configuredMeterTypes ? configuredMeterTypes.find(Boolean) ?? "" : "Điện"),
  );
  const [parentId, setParentId] = useState(initialMeter?.parentId ?? "");
  const [devices, setDevices] = useState<CatalogDevice[]>([]);
  const [existingMeters, setExistingMeters] = useState<ClientMeter[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(initialMeter?.deviceId ?? null);
  const [pointId, setPointId] = useState(initialMeter?.code ?? "");
  const [pointName, setPointName] = useState(initialMeter?.name ?? "");
  const [error, setError] = useState("");
  const configuredTypeNames = useMemo(
    () =>
      configuredMeterTypes === undefined
        ? undefined
        : Array.from(new Set(configuredMeterTypes.map((item) => item.trim()).filter(Boolean))),
    [configuredMeterTypes],
  );

  const selectableEnergyTypes = (() => {
    if (configuredTypeNames === undefined) return energyTypes;

    const catalog = new Map(energyTypes.map((item) => [item.name, item]));
    const names = [...configuredTypeNames];

    // Keep an existing point's old type visible while editing so saving the
    // form does not silently change data after that type is removed from the project.
    if (initialMeter?.utility && !names.includes(initialMeter.utility)) {
      names.push(initialMeter.utility);
    }

    return names.map(
      (name) =>
        catalog.get(name) ?? {
          name,
          description: "Loại điểm đo đã cấu hình cho dự án",
          icon: inferMeterTypeIcon(name),
          builtin: false,
        },
    );
  })();

  useEffect(() => {
    let active = true;
    void Promise.all([
      hydrateDevices(),
      hydrateMeterTypeDefs(),
      projectId ? hydrateClientMeters(projectId) : Promise.resolve([]),
    ]).then(([devices, energyTypes, meters]) => {
      if (!active) return;
      setDevices(devices);
      setEnergyTypes(energyTypes);
      if (projectId) setExistingMeters(meters);
    }).catch(() => {
      if (!active) return;
      setDevices(loadDevices());
      setEnergyTypes(loadMeterTypeDefs());
      if (projectId) setExistingMeters(loadClientMeters(projectId));
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  // Thêm đồng hồ ở tab khác (trang Thiết bị) rồi quay lại: nạp lại danh sách.
  useEffect(() => {
    const reload = () => {
      void hydrateDevices().then(setDevices).catch(() => undefined);
    };
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, []);

  const parentOptions = useMemo(
    () => existingMeters.filter((meter) =>
      meter.utility === energy &&
      meter.id !== initialMeter?.id &&
      (!initialMeter || !isMeterDescendant(existingMeters, initialMeter.id, meter.id)),
    ),
    [energy, existingMeters, initialMeter],
  );

  const typeNames = useMemo(() => energyTypes.map((item) => item.name), [energyTypes]);

  const compatibleDevices = useMemo(
    () =>
      configuredTypeNames === undefined
        ? devices
        : devices.filter((device) => {
            const deviceEnergy = utilityForDevice(device, typeNames);
            return !deviceEnergy || configuredTypeNames.includes(deviceEnergy);
          }),
    [configuredTypeNames, devices, typeNames],
  );

  const selectedDevice = devices.find((device) => device.id === deviceId) ?? null;

  /** Đồng hồ cùng loại điểm đo; đồng hồ đã gắn ở dự án khác / điểm đo khác thì không chọn được. */
  const deviceOptions = useMemo(
    () =>
      compatibleDevices
        .filter((device) => {
          const deviceEnergy = utilityForDevice(device, typeNames);
          return device.id === deviceId || !deviceEnergy || deviceEnergy === energy;
        })
        .map((device) => {
          const links = (device.projects ?? []).filter((link) => link.meterId !== initialMeter?.id);
          const otherProject = links.find((link) => link.projectId !== projectId);
          const otherPoint = links.find((link) => link.projectId === projectId);
          const usedBy = otherProject
            ? `đang gắn ở dự án ${otherProject.projectName}`
            : otherPoint
              ? `đang gắn ở điểm đo ${otherPoint.meterName}`
              : "";
          // Đồng hồ đang gắn với chính điểm đo này vẫn giữ được (dữ liệu cũ có thể đã trùng).
          return { device, usedBy, disabled: Boolean(usedBy) && device.id !== initialMeter?.deviceId };
        })
        .sort((a, b) => Number(a.disabled) - Number(b.disabled) || a.device.sn.localeCompare(b.device.sn)),
    [compatibleDevices, deviceId, energy, initialMeter, projectId, typeNames],
  );

  function selectDevice(nextId: string) {
    setError("");
    const device = devices.find((item) => item.id === nextId) ?? null;
    setDeviceId(device?.id ?? null);
    if (!device) return;
    const deviceEnergy = utilityForDevice(device, typeNames);
    if (deviceEnergy && deviceEnergy !== energy) {
      setEnergy(deviceEnergy);
      const parent = existingMeters.find((meter) => meter.id === parentId);
      if (parent && parent.utility !== deviceEnergy) setParentId("");
    }
    setPointName((current) => current || device.name);
  }

  function selectParent(nextParentId: string) {
    setParentId(nextParentId);
    if (!nextParentId) return;
    const parent = existingMeters.find((meter) => meter.id === nextParentId);
    if (parent) selectEnergy(parent.utility);
  }

  function selectEnergy(nextEnergy: string) {
    setEnergy(nextEnergy);
    // Đồng hồ đang chọn khác loại điểm đo mới thì bỏ chọn.
    const selectedEnergy = selectedDevice ? utilityForDevice(selectedDevice, typeNames) : null;
    if (selectedEnergy && selectedEnergy !== nextEnergy) setDeviceId(null);
    const parent = existingMeters.find((meter) => meter.id === parentId);
    if (parent && parent.utility !== nextEnergy) setParentId("");
  }

  async function handleSubmit() {
    const id = pointId.trim();
    const name = pointName.trim();
    if (!id || !name) {
      setError("Vui lòng nhập mã điểm đo và tên điểm đo.");
      return;
    }
    if (!energy) {
      setError("Dự án chưa cấu hình loại điểm đo. Vui lòng cấu hình trước khi thêm điểm đo.");
      return;
    }
    if (
      configuredTypeNames !== undefined &&
      !configuredTypeNames.includes(energy) &&
      energy !== initialMeter?.utility
    ) {
      setError("Loại điểm đo này chưa được cấu hình cho dự án.");
      return;
    }
    if (!projectId) {
      router.push(cancelHref);
      return;
    }

    try {
      const meters = await hydrateClientMeters(projectId);
      const next: ClientMeter = {
        id: initialMeter?.id ?? newMeterPointId(),
        name,
        code: id,
        type: selectedDevice ? selectedDevice.brandModel || selectedDevice.type : "Chưa gán thiết bị",
        parentId: parentId || null,
        utility: energy,
        deviceId,
        // Serial lấy theo đồng hồ đã chọn ở trang Thiết bị; không gắn đồng hồ thì để trống.
        serialNumber: selectedDevice?.sn.trim() || null,
      };
      const updated = initialMeter
        ? meters.map((meter) => (meter.id === initialMeter.id ? next : meter))
        : [...meters, next];
      if (initialMeter && !meters.some((meter) => meter.id === initialMeter.id)) {
        throw new Error("Không tìm thấy điểm đo cần cập nhật trong dự án.");
      }
      await saveClientMeters(projectId, updated);
      router.push(cancelHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể lưu điểm đo.");
    }
  }

  return (
    <div className="mx-auto max-w-[980px] p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {initialMeter ? "Chỉnh sửa điểm đo" : "Thêm mới điểm đo"}
        </h1>
      </div>

      <div>
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h2 className="text-[15px] font-semibold text-slate-800">Thông số cơ bản</h2>

          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            >
            <Field label="LOẠI ĐIỂM ĐO">
              {selectableEnergyTypes.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {selectableEnergyTypes.map((type) => {
                    const active = energy === type.name;
                    const isOutsideProject =
                      configuredTypeNames !== undefined && !configuredTypeNames.includes(type.name);
                    return (
                      <button
                        key={type.name}
                        type="button"
                        onClick={() => selectEnergy(type.name)}
                        title={
                          isOutsideProject
                            ? "Loại này đã được bỏ khỏi cấu hình hiện tại của dự án"
                            : type.description
                        }
                        className={`h-10 rounded-xl border text-sm font-semibold transition-all ${
                          active
                            ? "border-emerald-600 bg-emerald-50/80 text-emerald-700 ring-1 ring-emerald-500/20"
                            : isOutsideProject
                              ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                              : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-white"
                        }`}
                      >
                        <span>{type.name}</span>
                        {isOutsideProject ? <span className="ml-1 text-[10px]">(cũ)</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <p className="font-semibold">Dự án chưa cấu hình loại điểm đo.</p>
                  <p className="mt-1 text-xs text-amber-700">
                    Hãy quay lại cấu hình dự án để thêm Điện, Hơi hoặc loại năng lượng phù hợp.
                  </p>
                  <Link
                    href={cancelHref}
                    className="mt-2 inline-flex text-xs font-semibold text-emerald-700 hover:underline"
                  >
                    Mở cấu hình dự án
                  </Link>
                </div>
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="MÃ ĐIỂM ĐO (ID)">
                <input
                  value={pointId}
                  onChange={(e) => setPointId(e.target.value)}
                  placeholder="VD: MP-001"
                  className="input"
                  required
                />
              </Field>
              <Field label="TÊN ĐIỂM ĐO">
                <input
                  value={pointName}
                  onChange={(e) => setPointName(e.target.value)}
                  placeholder="Nhập tên điểm đo"
                  className="input"
                  required
                />
              </Field>
            </div>

            <Field label="ĐỒNG HỒ (SERIAL)">
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <CustomSelect
                    value={deviceId ?? ""}
                    onChange={(e) => selectDevice(e.target.value)}
                    className="input appearance-none pr-9"
                    searchable
                    searchPlaceholder="Tìm serial, model..."
                  >
                    <option value="">— Không gắn đồng hồ —</option>
                    {deviceOptions.map(({ device, usedBy, disabled }) => (
                      <option key={device.id} value={device.id} disabled={disabled}>
                        {device.sn} · {device.brandModel || device.name}
                        {usedBy ? ` (${usedBy})` : ""}
                      </option>
                    ))}
                  </CustomSelect>
                  <ChevronIcon className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
                <Link
                  href="/thiet-bi/them-moi"
                  target="_blank"
                  className="inline-flex h-10 shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-xs transition-colors hover:border-slate-300 hover:bg-slate-50"
                  title="Khai báo đồng hồ mới ở trang Thiết bị (mở tab mới)"
                >
                  <span className="text-lg leading-none text-emerald-600">+</span>
                  Thêm đồng hồ
                </Link>
              </div>
              {!deviceOptions.length ? (
                <p className="mt-1.5 text-xs text-slate-500">Chưa có đồng hồ loại {energy || "này"} ở trang Thiết bị.</p>
              ) : null}
            </Field>

            <Field label="ĐIỂM ĐO CHA">
              <div className="relative">
                <CustomSelect
                  value={parentId}
                  onChange={(e) => selectParent(e.target.value)}
                  className="input appearance-none pr-9"
                >
                  <option value="">Không có điểm đo cha</option>
                  {parentOptions.map((meter) => (
                    <option key={meter.id} value={meter.id}>
                      {meter.name} ({meter.code})
                    </option>
                  ))}
                </CustomSelect>
                <ChevronIcon className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </Field>

            {error ? <p className="text-sm font-medium text-red-500">{error}</p> : null}

            <div className="flex justify-end gap-3 pt-4">
              <Link
                href={cancelHref}
                className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors shadow-xs"
              >
                Hủy
              </Link>
              <button
                type="submit"
                className="h-10 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors"
              >
                {initialMeter ? "Lưu thay đổi" : "Thêm điểm đo"}
              </button>
            </div>
          </form>
        </section>

      </div>
    </div>
  );
}

function newMeterPointId() {
  return `m-${Date.now()}`;
}

/** Loại điểm đo của đồng hồ: ưu tiên loại đã cấu hình (device.type = "Điện", "Khí nén", ...), sau đó mới đoán theo kind. */
function utilityForDevice(device: CatalogDevice, typeNames: string[]): string | null {
  const configured = device.type?.trim();
  if (configured && typeNames.includes(configured)) return configured;
  switch (device.kind) {
    case "flow":
      return "Nước";
    case "temp":
      return "Nhiệt";
    case "steam":
      return "Hơi";
    case "power":
      return "Điện";
    default:
      return null;
  }
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}


function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}



