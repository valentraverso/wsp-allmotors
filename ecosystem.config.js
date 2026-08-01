module.exports = {
  apps: [
    {
      name: "wsp-allmotors-internal",
      script: "src/index.ts",
      cwd: "/var/www/wsp",
      interpreter: "node",
      interpreter_args: "-r ts-node/register",
      watch: false,
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
      script: "src/index.ts",
      cwd: "/var/www/wsp",
      interpreter: "node",
      interpreter_args: "-r ts-node/register",
      watch: false,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 4002,
        WSP_MODE: "bot",
        AUTH_DIR: "auth_info_baileys_bot",
        BACKEND_API_KEY: process.env.BACKEND_API_KEY || "",
        WSP_AUTH_CODE: process.env.WSP_AUTH_CODE || "allmotors_secret_code_2026"
      },
    },
  ],
};
