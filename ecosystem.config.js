module.exports = {
  apps: [
    {
      name: "wsp-allmotors",
      script: "src/index.ts",
      cwd: "/var/www/wsp",
      interpreter: "node",
      interpreter_args: "-r ts-node/register",
      watch: false,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
    },
  ],
};
