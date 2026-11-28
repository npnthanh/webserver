// Chạy cầu nối bằng pm2 (thay cho systemd): pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: "gateway-tcp",
      script: "./gateway-tcp.mjs",
      env: {
        // Cổng gateway bắn vào (đổi theo cổng đã mở trên firewall)
        GATEWAY_TCP_PORT: "5000",
        GATEWAY_TCP_HOST: "0.0.0.0",
        GATEWAY_INGEST_URL: "https://webserver.kivon.tech/api/gateway",
      },
      autorestart: true,
      restart_delay: 3000,
      max_memory_restart: "200M",
    },
  ],
};
