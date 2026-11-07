#!/usr/bin/env node
import { lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const home = homedir();
const binary = path.join(home, '.local/bin/claude');
const directory = path.join(home, '.local/state/ia-burn/claude-capture/paperclip');
const env = { ...process.env };
try {
  const stat = lstatSync(directory);
  if (stat.isDirectory() && !(stat.mode & 0o077) && stat.uid === process.getuid()) {
    Object.assign(env, {
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_LOGS_EXPORTER: 'console',
      OTEL_LOG_RAW_API_BODIES: 'file:' + directory,
    });
  }
} catch {
  // A missing capture directory must not prevent an agent run.
}
process.execve(binary, [binary, ...process.argv.slice(2)], env);
