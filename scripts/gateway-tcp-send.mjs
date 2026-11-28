import net from "node:net";

/**
 * Gửi thử một gói JSON qua TCP thô (giống module SIM / WiFi) và in ACK nhận về.
 *   node scripts/gateway-tcp-send.mjs <host> <port> ['<json>']
 * Không truyền JSON: gửi gói thiếu trường {"PV":1} — server trả ACK báo lỗi định dạng (Server: 3) và chỉ ghi
 * một dòng nhật ký, không lưu dữ liệu đo. Dùng để kiểm tra đường truyền gateway → cầu nối → server.
 */
const [host, portText, payload = '{"PV":1}'] = process.argv.slice(2);
const port = Number(portText);
if (!host || !Number.isInteger(port)) {
  console.error("Cách dùng: node scripts/gateway-tcp-send.mjs <host> <port> ['<json>']");
  process.exit(2);
}

const started = Date.now();
const chunks = [];
const socket = net.connect({ host, port }, () => {
  console.log(`Đã kết nối ${host}:${port}, gửi ${Buffer.byteLength(payload)} byte: ${payload}`);
  socket.write(payload);
});
socket.setTimeout(20000);
socket.on("data", (chunk) => chunks.push(chunk));
socket.on("timeout", () => {
  console.error("Quá 20 giây không nhận được ACK.");
  socket.destroy();
  process.exitCode = 1;
});
socket.on("error", (err) => {
  console.error(`Lỗi kết nối: ${err.message}`);
  process.exitCode = 1;
});
socket.on("close", () => {
  const ack = Buffer.concat(chunks).toString("utf8").trim();
  if (ack) console.log(`ACK sau ${Date.now() - started} ms: ${ack}`);
  else if (!process.exitCode) {
    console.error("Kết nối đóng nhưng không có ACK.");
    process.exitCode = 1;
  }
});
