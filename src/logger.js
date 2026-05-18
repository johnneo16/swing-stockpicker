/**
 * Structured logging with daily rotation.
 *
 * Strategy: wrap the existing console.* call sites once at boot rather
 * than touching all 71 of them. Every console.log/info/warn/error
 * automatically becomes a structured pino log entry with:
 *   - ISO timestamp
 *   - level (info / warn / error)
 *   - service tag
 *   - pid
 *   - hostname
 *
 * Output is teed to two sinks:
 *   1. stdout (launchd captures to ~/Library/Logs/swingpro.out.log in real time)
 *   2. rotated file ~/Library/Logs/swingpro-app-YYYY-MM-DD.log
 *      - rolls at midnight local time
 *      - 14-day retention
 *
 * In dev (NODE_ENV !== 'production'), output is pretty-printed to stdout
 * for readability; the rotated file always uses raw JSON for grep-ability.
 *
 * Cloud portability: when we move to Render/fly.io, override LOG_DIR via
 * env var (defaults to ~/Library/Logs on Mac, /var/log/swingpro elsewhere).
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';

// Default log dir per platform; LOG_DIR env var overrides for cloud
const DEFAULT_LOG_DIR = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Logs')
  : '/var/log/swingpro';
const LOG_DIR = process.env.LOG_DIR || DEFAULT_LOG_DIR;
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}

const LOG_FILE = path.join(LOG_DIR, 'swingpro-app.log');

// Build the transport: rotating-file + stdout (pretty in dev, raw in prod)
const transport = pino.transport({
  targets: [
    // Rotating file: midnight daily, 14-day retention, gzip rotated files
    {
      target: 'pino-roll',
      level:  'debug',
      options: {
        file:        LOG_FILE,
        frequency:   'daily',
        mkdir:       true,
        dateFormat:  'yyyy-MM-dd',
        size:        '50m',                // also rotate if a single day exceeds 50 MB
        limit:       { count: 14 },        // keep last 14 rotated files
      },
    },
    // Stdout: pretty in dev, JSON in prod (launchd captures the JSON cleanly)
    isProd
      ? { target: 'pino/file', level: 'info', options: { destination: 1 } }
      : { target: 'pino-pretty', level: 'debug', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,service' } },
  ],
});

export const logger = pino(
  {
    base: { service: 'swingpro', pid: process.pid, hostname: os.hostname() },
    level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport,
);

/**
 * Install the console-shim: every existing console.log/info/warn/error call
 * across the codebase routes through pino. Preserves the original signature
 * (variadic args) by stringifying objects to JSON-stringified inline.
 */
let installed = false;
export function installConsoleShim() {
  if (installed) return;
  installed = true;

  const fmtArgs = (args) => {
    // Single string arg → use as message directly
    if (args.length === 1 && typeof args[0] === 'string') return args[0];
    // Single object arg → log as structured fields with default message
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      return { ...args[0], msg: args[0].msg || 'object' };
    }
    // Multi-arg → join with space, stringify objects, preserve Error info
    return args
      .map(a => {
        if (typeof a === 'string') return a;
        if (a instanceof Error)    return `${a.message}\n${a.stack || ''}`;
        try   { return JSON.stringify(a); }
        catch { return String(a); }
      })
      .join(' ');
  };

  // Preserve originals for emergency use
  const _origLog   = console.log.bind(console);
  const _origInfo  = console.info.bind(console);
  const _origWarn  = console.warn.bind(console);
  const _origError = console.error.bind(console);
  console.__originals = { log: _origLog, info: _origInfo, warn: _origWarn, error: _origError };

  console.log   = (...a) => logger.info(fmtArgs(a));
  console.info  = (...a) => logger.info(fmtArgs(a));
  console.warn  = (...a) => logger.warn(fmtArgs(a));
  console.error = (...a) => logger.error(fmtArgs(a));
}

// Auto-install when this module is imported — eliminates the "did you call
// installConsoleShim?" foot-gun. To opt out, set env DISABLE_LOG_SHIM=1.
if (!process.env.DISABLE_LOG_SHIM) installConsoleShim();
