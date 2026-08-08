module.exports = {
  apps: [
    {
      name: "wsp-allmotors-internal",
      script: "dist/index.js",
      cwd: "/var/www/wsp/internal",
      watch: ["dist"],
      ignore_watch: [
        "node_modules",
        "auth_info_baileys_internal",
        "auth_info_baileys_bot",
        "*.log",
        ".git"
      ],
      watch_delay: 1000,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 4001,
        WSP_MODE: "internal",
        AUTH_DIR: "auth_info_baileys_internal",
        BACKEND_API_KEY: process.env.BACKEND_API_KEY || "",
        WSP_AUTH_CODE: process.env.WSP_AUTH_CODE || "allmotors_secret_code_2026"
      },
    },
    {
      name: "wsp-allmotors-bot",
      script: "dist/index.js",
      cwd: "/var/www/wsp/bot",
      watch: ["dist"],
      ignore_watch: [
        "node_modules",
        "auth_info_baileys_internal",
        "auth_info_baileys_bot",
        "*.log",
        ".git"
      ],
      watch_delay: 1000,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 4002,
        WSP_MODE: "bot",
        AUTH_DIR: "auth_info_baileys_bot",
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
        BACKEND_API_KEY: process.env.BACKEND_API_KEY || "",
        WSP_AUTH_CODE: process.env.WSP_AUTH_CODE || "allmotors_secret_code_2026"
      },
    },
  ],
};
