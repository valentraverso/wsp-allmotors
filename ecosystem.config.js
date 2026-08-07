module.exports = {
  apps: [
    {
      name: "wsp-allmotors-internal",
      script: "dist/index.js",
      cwd: "/var/www/wsp/internal",
      watch: false,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 4001,
        WSP_MODE: "internal",
        AUTH_DIR: "auth_info_baileys_internal"
      },
    },
    {
      name: "wsp-allmotors-bot",
      script: "dist/index.js",
      cwd: "/var/www/wsp/bot",
      watch: false,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 4002,
        WSP_MODE: "bot",
        AUTH_DIR: "auth_info_baileys_bot"
      },
    },
  ],
};
