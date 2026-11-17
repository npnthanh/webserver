import "server-only";
import { runUpstreamSync } from "@/lib/gateway-store";
import { evaluateProjectAlerts } from "@/lib/server-alert-engine";
import { processRollups, runRetention } from "@/lib/server-gateway-rollup";

/**
 * Chạy nền trong tiến trình server (khởi động từ instrumentation.ts):
 * mỗi phút đồng bộ dữ liệu gateway từ upstream, cập nhật bảng tổng hợp 15 phút, đánh giá cảnh báo của mọi dự án
 * và (mỗi giờ) dọn dữ liệu thô quá hạn lưu,
 * để cảnh báo và thông báo không phụ thuộc vào việc có người đang mở trang web.
 * Nhiều tiến trình chạy song song vẫn an toàn: thông báo chỉ gửi khi sự kiện được tạo mới trong DB.
 */
const INTERVAL_MS = 60_000;
const FIRST_RUN_DELAY_MS = 20_000;

const globalScheduler = globalThis as typeof globalThis & { __emsAlertScheduler?: NodeJS.Timeout };
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await runUpstreamSync().catch((error) => console.error("[alert-scheduler] upstream sync failed", error));
    // Bảng tổng hợp 15 phút (lần đầu xử lý dần dữ liệu cũ, mỗi lượt tối đa ~20 giây).
    await processRollups(20_000).catch((error) => console.error("[alert-scheduler] rollup failed", error));
    await evaluateProjectAlerts();
    // Dọn mẫu thô / nhật ký gói tin quá hạn lưu (tối đa mỗi giờ một lần).
    await runRetention();
  } catch (error) {
    console.error("[alert-scheduler] tick failed", error);
  } finally {
    running = false;
  }
}

export function startAlertScheduler() {
  if (globalScheduler.__emsAlertScheduler) return;
  if (process.env.EMS_DISABLE_SCHEDULER === "1") return;
  setTimeout(() => void tick(), FIRST_RUN_DELAY_MS).unref?.();
  globalScheduler.__emsAlertScheduler = setInterval(() => void tick(), INTERVAL_MS);
  globalScheduler.__emsAlertScheduler.unref?.();
  console.log("[alert-scheduler] started");
}
