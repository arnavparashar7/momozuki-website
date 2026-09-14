import { execSync } from 'node:child_process';

/**
 * Checks if DATABASE_URL is set AND a TCP connection to the database server can be established.
 * Used by integration tests to conditionally run against a real database or skip cleanly when
 * a local Postgres instance is not active in the execution environment.
 */
export function isDbReachable(): boolean {
  if (!process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    const host = url.hostname || 'localhost';
    const port = url.port || '5432';
    execSync(
      `node -e "const net=require('net');const s=net.connect(${port},'${host}',()=>{process.exit(0)});s.on('error',()=>process.exit(1))"`,
      { timeout: 1000, stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

export const hasDb = isDbReachable();
