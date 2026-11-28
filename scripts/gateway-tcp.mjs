import net from "node:net";

/**
 * Cầu nối TCP thô → HTTP(S) cho gateway (module SIM / WiFi chỉ gửi chuỗi JSON qua TCP, không header).
 * Nhận JSON, chuyển lên GATEWAY_INGEST_URL (VD https://webserver.kivon.tech/api/gateway), trả nguyên ACK JSON
 * qua TCP rồi đóng kết nối. Gửi kiểu HTTP (có header) cũng được: ACK trả về kèm header HTTP.
 * Hướng dẫn cài: deploy/gateway-bridge/HUONG-DAN.md
 */
const PORT = Number(process.env.GATEWAY_TCP_PORT || 3010);
const HOST = process.env.GATEWAY_TCP_HOST || "0.0.0.0";
const INGEST =
  process.env.GATEWAY_INGEST_URL || "http://127.0.0.1:3005/api/gateway";
/** Firmware thường gửi JSON rồi đứng đợi ACK, không FIN. Không được chờ `end`. */
const IDLE_MS = Number(process.env.GATEWAY_TCP_IDLE_MS || 400);
const HARD_MS = Number(process.env.GATEWAY_TCP_TIMEOUT_MS || 8000);
/** Chờ server web trả ACK tối đa (ms). Quá hạn thì không trả gì, gateway tự gửi lại theo cơ chế của firmware. */
const INGEST_TIMEOUT_MS = Number(process.env.GATEWAY_INGEST_TIMEOUT_MS || 15000);

function findJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function isHttp(text) {
  return /^(POST|PUT|PATCH|GET)\s/i.test(text.trimStart());
}

function extractHttpBody(raw) {
  const split = raw.indexOf("\r\n\r\n");
  if (split < 0) return { complete: false, body: null };
  const header = raw.slice(0, split);
  const rest = raw.slice(split + 4);
  const lengthMatch = header.match(/content-length:\s*(\d+)/i);
  if (lengthMatch) {
    const length = Number(lengthMatch[1]);
    const bytes = Buffer.from(rest, "utf8");
    if (bytes.length < length) return { complete: false, body: null };
    return { complete: true, body: bytes.subarray(0, length).toString("utf8") };
  }
  const json = findJsonObject(rest);
  return json ? { complete: true, body: json } : { complete: false, body: null };
}

function extractJson(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return findJsonObject(trimmed) || trimmed;
  }
  const http = extractHttpBody(trimmed);
  if (http.body) return http.body.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function payloadReady(raw) {
  if (!raw.trim()) return false;
  if (isHttp(raw)) return extractHttpBody(raw).complete;
  return Boolean(findJsonObject(raw));
}

function wrapHttpAck(jsonText) {
  const body = jsonText.endsWith("\n") ? jsonText : `${jsonText}\n`;
  return (
    "HTTP/1.1 200 OK\r\n" +
    "Content-Type: application/json\r\n" +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    // Không ghi "Connection: close": socket.end() (hàm reply) vẫn đóng kết nối ngay sau ACK.
    "\r\n" +
    body
  );
}

async function ingest(raw, peerIp) {
  // Giữ kết nối HTTPS tới server web giữa các gói (nhanh hơn, không phải bắt tay TLS mỗi lần).
  const res = await fetch(INGEST, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": peerIp },
    body: raw,
    signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
  });
  const text = await res.text();
  return { status: res.status, text };
}

const server = net.createServer((socket) => {
  const peer = `${socket.remoteAddress?.replace(/^::ffff:/, "")}:${socket.remotePort}`;
  const chunks = [];
  let handled = false;
  let idleTimer = null;

  socket.setNoDelay(true);
  socket.setTimeout(HARD_MS);

  const reply = (payload) => {
    if (socket.destroyed) return;
    socket.end(payload);
  };

  const handle = async (reason) => {
    if (handled) return;
    handled = true;
    if (idleTimer) clearTimeout(idleTimer);
    socket.setTimeout(0);

    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw.trim()) {
      reply("");
      return;
    }
    const json = extractJson(raw);
    console.log(
      `[gateway-tcp] ${new Date().toISOString()} ${peer} ${reason} ${Buffer.byteLength(raw)} bytes ${json.slice(0, 180)}`,
    );
    try {
      const result = await ingest(json, peer.split(":")[0] || "");
      console.log(`[gateway-tcp] ingest ${result.status} ${result.text.slice(0, 200)}`);
      const ack = result.text.endsWith("\n") ? result.text : `${result.text}\n`;
      reply(isHttp(raw) ? wrapHttpAck(ack) : ack);
    } catch (err) {
      console.error(`[gateway-tcp] ingest failed ${peer}`, err);
      reply("");
    }
  };

  socket.on("data", (chunk) => {
    if (handled) return;
    chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (payloadReady(raw)) {
      void handle("complete");
      return;
    }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      void handle("idle");
    }, IDLE_MS);
  });

  socket.on("timeout", () => {
    void handle("timeout");
  });

  socket.on("end", () => {
    void handle("fin");
  });

  socket.on("error", (err) => {
    handled = true;
    if (idleTimer) clearTimeout(idleTimer);
    console.error(`[gateway-tcp] ${peer} ${err.message}`);
  });
});

server.on("error", (err) => {
  // VD EADDRINUSE: cổng đã có chương trình khác dùng.
  console.error(`[gateway-tcp] không mở được cổng ${HOST}:${PORT}: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`gateway tcp listening on ${HOST}:${PORT} -> ${INGEST}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`[gateway-tcp] nhận ${signal}, dừng nhận kết nối mới`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
