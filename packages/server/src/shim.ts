import os from 'node:os';
import process from 'node:process';

// Some sandboxed environments throw on os.userInfo(); provide a safe fallback
try {
  // This call will throw in restricted sandboxes
  os.userInfo();
} catch {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (os as any).userInfo = () => ({
      uid: 1000,
      gid: 1000,
      username: 'mcp',
      homedir: process.cwd(),
      shell: ''
    });
  } catch {}
}

