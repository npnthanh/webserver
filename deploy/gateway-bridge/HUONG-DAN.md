# Cầu nối TCP thô cho gateway

Module SIM / WiFi của gateway gửi **TCP thô** (chỉ chuỗi JSON, không header HTTP). Server web
`webserver.kivon.tech` nằm trên Hostinger shared hosting, chỉ mở cổng 80/443 nên không nhận TCP thô được.
Cầu nối chạy trên một máy chủ có IP riêng:

```
Gateway ──TCP thô (JSON)──▶ Cầu nối  IP:cổng ──HTTPS──▶ https://webserver.kivon.tech/api/gateway
        ◀──ACK JSON (TCP)──                  ◀──ACK──
```

- Gateway gửi đúng chuỗi JSON như hiện nay, cầu nối trả nguyên **ACK JSON** (không header) rồi đóng kết nối.
- Gửi kiểu HTTP (có header) vào cầu nối cũng được: ACK trả về kèm header HTTP.
- Không cần cài thư viện; chỉ cần **Node.js 18 trở lên**.

## 1. Chuẩn bị máy chủ (Ubuntu / Debian)

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
node -v            # >= v18

sudo mkdir -p /opt/gateway-bridge
# Chép file scripts/gateway-tcp.mjs của dự án lên máy chủ (VD bằng scp):
#   scp scripts/gateway-tcp.mjs user@IP_MAY_CHU:/tmp/
sudo cp /tmp/gateway-tcp.mjs /opt/gateway-bridge/
```

Chọn **cổng** cho gateway (VD `5000`), kiểm tra chưa có chương trình nào dùng:

```bash
sudo ss -ltnp | grep ':5000 '   # không in gì = cổng trống
```

Mở cổng trên firewall của máy chủ **và** firewall của nhà cung cấp VPS (nếu có):

```bash
sudo ufw allow 5000/tcp
```

## 2. Chạy nền bằng systemd (khuyên dùng)

```bash
sudo cp gateway-tcp.service /etc/systemd/system/
# Đổi cổng nếu không dùng 5000: sửa dòng Environment=GATEWAY_TCP_PORT=...
sudo systemctl daemon-reload
sudo systemctl enable --now gateway-tcp
sudo systemctl status gateway-tcp      # active (running)
journalctl -u gateway-tcp -f           # xem log từng gói tin
```

Dịch vụ tự chạy lại khi lỗi và khi máy chủ khởi động lại.

**Cách khác — pm2:** chép `ecosystem.config.cjs` vào `/opt/gateway-bridge/`, rồi

```bash
sudo npm i -g pm2
cd /opt/gateway-bridge && pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
pm2 logs gateway-tcp
```

## 3. Kiểm tra

Từ máy bất kỳ có Node (VD máy dev, trong thư mục dự án):

```bash
node scripts/gateway-tcp-send.mjs IP_MAY_CHU 5000
```

Kết quả đúng là in ra một dòng `ACK sau ... ms: {"Server":3,...}`. `Server: 3` vì gói thử cố ý thiếu trường
(chỉ ghi một dòng nhật ký "Lỗi format" ở trang Máy chủ Gateway, không lưu dữ liệu đo).

## 4. Cấu hình firmware

| Mục | Giá trị |
|---|---|
| SERVER_HOST | IP (hoặc tên miền trỏ về IP) của máy chủ chạy cầu nối |
| Cổng | Cổng đã chọn ở bước 1 (VD 5000) |
| Nội dung gửi | Chuỗi JSON như hiện nay, **không** cần header |

Sau khi đổi, trang **Máy chủ Gateway** của webserver.kivon.tech sẽ thấy gateway "Trực tuyến" và các bản tin
"Đã lưu".

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `GATEWAY_TCP_PORT` | `3010` | Cổng nhận TCP từ gateway |
| `GATEWAY_TCP_HOST` | `0.0.0.0` | Địa chỉ lắng nghe |
| `GATEWAY_INGEST_URL` | `http://127.0.0.1:3005/api/gateway` | Nơi chuyển gói tin tới (đặt `https://webserver.kivon.tech/api/gateway`) |
| `GATEWAY_TCP_IDLE_MS` | `400` | Gateway gửi xong mà không đóng kết nối: chờ bấy nhiêu ms không có dữ liệu mới thì xử lý |
| `GATEWAY_TCP_TIMEOUT_MS` | `8000` | Kết nối im lặng quá lâu thì xử lý / đóng |
| `GATEWAY_INGEST_TIMEOUT_MS` | `15000` | Chờ server web trả ACK tối đa; quá hạn thì không trả ACK (gateway tự gửi lại) |

## Lưu ý

- Server web không trả lời (mất mạng, server lỗi) thì cầu nối **không trả ACK** → gateway giữ bản tin và gửi
  lại theo cơ chế truyền bù (RE=1) của firmware.
- Nếu máy chủ đang chạy chương trình nhận TCP cũ của gateway (VD webserver.demopage.top), chọn cổng khác hoặc
  tắt chương trình cũ trước khi dùng cổng đó.
