import mysql from 'mysql2/promise';

// Use a process-level global so the pool survives Next.js HMR module reloads.
declare global {
  // eslint-disable-next-line no-var
  var __mysqlPool: mysql.Pool | undefined;
}

export function getPool(): mysql.Pool {
  if (!global.__mysqlPool) {
    global.__mysqlPool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 5,
      timezone: '+00:00',
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    });
  }
  return global.__mysqlPool;
}

export const NARRATOR_TASKS_DDL = `
CREATE TABLE IF NOT EXISTS narrator_master_tasks (
  narrator_task_id VARCHAR(64)  NOT NULL,
  app_key          VARCHAR(255) NOT NULL,
  status           VARCHAR(32)  NOT NULL DEFAULT 'pending',
  current_step     VARCHAR(64)  DEFAULT NULL,
  data             JSON         NOT NULL,
  created_at       DATETIME(3)  NOT NULL,
  updated_at       DATETIME(3)  NOT NULL,
  PRIMARY KEY (narrator_task_id),
  INDEX idx_app_status (app_key, status),
  INDEX idx_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;
