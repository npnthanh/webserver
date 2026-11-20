"use client";

import { useSyncExternalStore } from "react";

/**
 * Tuỳ chọn hiển thị chung của các biểu đồ đường (Cấu hình → Tham số biểu đồ, lưu theo dự án).
 * Trang Biểu đồ đọc project settings rồi đặt vào đây; SampleTrendChart đọc qua hook để khỏi truyền prop qua từng biểu đồ.
 */
type ChartDisplay = {
  /** Vẽ dấu chấm tại từng điểm dữ liệu (chấm khi rê chuột vẫn luôn hiện). Mặc định ẩn. */
  showMarkers: boolean;
};

let current: ChartDisplay = { showMarkers: false };
const listeners = new Set<() => void>();

export function setChartDisplay(next: Partial<ChartDisplay>) {
  const merged = { ...current, ...next };
  if (merged.showMarkers === current.showMarkers) return;
  current = merged;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useChartShowMarkers() {
  return useSyncExternalStore(
    subscribe,
    () => current.showMarkers,
    () => false,
  );
}

/** Đọc tuỳ chọn từ project settings (`chartShowMarkers`). */
export function readChartShowMarkers(settings: Record<string, unknown> | undefined | null) {
  return settings?.chartShowMarkers === true;
}
