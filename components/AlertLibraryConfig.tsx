"use client";

import { useEffect, useState } from "react";
import { AlertConfig } from "@/components/AlertConfig";
import { hydrateMeterTypeDefs } from "@/lib/meter-types";

/** Trang Cấu hình → Thư viện cảnh báo: mẫu ngưỡng dùng chung cho từng loại điểm đo (Điện, Áp suất, ...). */
export function AlertLibraryConfig() {
  const [types, setTypes] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    hydrateMeterTypeDefs()
      .then((defs) => {
        if (active) setTypes(defs.map((item) => item.name));
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Không tải được danh sách loại điểm đo.");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Thư viện cảnh báo</h1>
        <p className="mt-1 text-sm text-slate-500">
          Cấu hình sẵn ngưỡng cảnh báo theo từng loại điểm đo. Khi cấu hình cảnh báo cho một dự án, chọn{" "}
          <strong>Áp dụng từ thư viện</strong> để dùng mẫu này.
        </p>
      </div>
      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      ) : types === null ? (
        <p className="text-sm text-slate-400">Đang tải…</p>
      ) : types.length === 0 ? (
        <p className="text-sm text-slate-500">Chưa có loại điểm đo nào. Thêm tại Cấu hình → Loại điểm đo.</p>
      ) : (
        <AlertConfig mode="library" initialUtilities={types} />
      )}
    </div>
  );
}
