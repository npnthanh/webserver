export async function register() {
  // Bộ lập lịch cảnh báo + thông báo chỉ chạy trên Node.js server. Giữ đúng mẫu điều kiện của tài liệu Next.js
  // (`process.env.NEXT_RUNTIME === "nodejs"` bọc import) để bản Edge không kéo theo node:net / node:tls / mysql2.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAlertScheduler } = await import("./lib/server-alert-scheduler");
    startAlertScheduler();
  }
}
