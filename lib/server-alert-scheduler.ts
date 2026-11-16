import "server-only";
import { runUpstreamSync } from "@/lib/gateway-store";
import { evaluateProjectAlerts } from "@/lib/server-alert-engine";

/**
 * Chạy nền trong tiến trình server (khởi động từ instrumentation.ts):
 * mỗi phút đồng bộ dữ liệu gateway từ upstream rồi đánh giá cảnh báo của mọi dự án,
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
    await evaluateProjectAlerts();
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
