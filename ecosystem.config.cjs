const path = require("path");
const fs = require("fs");

// Carregar .env.production para injetar no PM2
function loadEnvFile(filePath) {
  const envVars = {};
  try {
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      envVars[key] = value;
    }
  } catch (e) { /* ignore */ }
  return envVars;
}

const prodEnv = loadEnvFile(path.resolve(__dirname, ".env.production"));

module.exports = {
  apps: [
    {
      name: "payjarvis-api",
      script: path.resolve(__dirname, "apps/api/dist/server.js"),
      cwd: path.resolve(__dirname),
      env: {
        ...prodEnv,
        NODE_ENV: "production",
        API_PORT: "3001",
      },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/var/log/payjarvis/api-error.log",
      out_file: "/var/log/payjarvis/api-out.log",
      merge_logs: true,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "payjarvis-rules",
      script: path.resolve(__dirname, "apps/rules-engine/dist/server.js"),
      cwd: path.resolve(__dirname),
      env: {
        ...prodEnv,
        NODE_ENV: "production",
        RULES_ENGINE_PORT: "3002",
      },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "256M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/var/log/payjarvis/rules-error.log",
      out_file: "/var/log/payjarvis/rules-out.log",
      merge_logs: true,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "payjarvis-web",
      script: path.resolve(__dirname, "scripts/start-web.sh"),
      interpreter: "/bin/bash",
      cwd: path.resolve(__dirname),
      env: {
        ...prodEnv,
        NODE_ENV: "production",
        PORT: "3000",
        HOSTNAME: "0.0.0.0",
      },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/var/log/payjarvis/web-error.log",
      out_file: "/var/log/payjarvis/web-out.log",
      merge_logs: true,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "browser-agent",
      script: path.resolve(__dirname, "apps/browser-agent/dist/server.js"),
      cwd: path.resolve(__dirname),
      env: {
        ...prodEnv,
        NODE_ENV: "production",
        BROWSER_AGENT_PORT: "3003",
      },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "256M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/var/log/payjarvis/browser-agent-error.log",
      out_file: "/var/log/payjarvis/browser-agent-out.log",
      merge_logs: true,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "payjarvis-kyc",
      script: "/root/payjarvis-kyc/venv/bin/uvicorn",
      args: "main:app --host 0.0.0.0 --port 3004",
      cwd: "/root/payjarvis-kyc",
      interpreter: "none",
      env: {
        ...prodEnv,
      },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "1G",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/var/log/payjarvis/kyc-error.log",
      out_file: "/var/log/payjarvis/kyc-out.log",
      merge_logs: true,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "payjarvis-admin",
      script: path.resolve(__dirname, "apps/admin/start.sh"),
      interpreter: "/bin/bash",
      cwd: path.resolve(__dirname, "apps/admin"),
      env: {
        ...prodEnv,
        NODE_ENV: "production",
        PORT: "3005",
        HOSTNAME: "0.0.0.0",
      },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/var/log/payjarvis/admin-error.log",
      out_file: "/var/log/payjarvis/admin-out.log",
      merge_logs: true,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "cfo-agent",
      script: "/root/sentinel/cfo.js",
      cwd: "/root/sentinel",
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "128M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/var/log/payjarvis/cfo-error.log",
      out_file: "/var/log/payjarvis/cfo-out.log",
      merge_logs: true,
      watch: false,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 10000,
      cron_restart: "0 0 * * *",
    },
    {
      name: "sentinel",
      script: "/root/sentinel/index.js",
      cwd: "/root/sentinel",
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "128M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/var/log/payjarvis/sentinel-error.log",
      out_file: "/var/log/payjarvis/sentinel-out.log",
      merge_logs: true,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
