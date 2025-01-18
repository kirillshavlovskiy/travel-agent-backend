import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logsDir = path.join(__dirname, '../../logs');
const logFile = path.join(logsDir, 'server.log');

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// ANSI color codes for better visibility
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  info: '\x1b[36m',    // Cyan
  warn: '\x1b[33m',    // Yellow
  error: '\x1b[31m',   // Red
  debug: '\x1b[35m',   // Magenta
};

function formatMessage(level: string, message: string, data?: any): string {
  const timestamp = new Date().toISOString();
  const dataStr = data ? `\n${JSON.stringify(data, null, 2)}` : '';
  return `[${timestamp}] [${level}] ${message}${dataStr}\n`;
}

function formatConsoleMessage(level: string, message: string, data?: any): string {
  const timestamp = new Date().toISOString();
  const color = colors[level.toLowerCase() as keyof typeof colors] || colors.reset;
  const dataStr = data ? `\n${JSON.stringify(data, null, 2)}` : '';
  return `${color}[${timestamp}] [${level}] ${message}${dataStr}${colors.reset}`;
}

export const logger = {
  info(message: string, data?: any) {
    const fileMessage = formatMessage('INFO', message, data);
    const consoleMessage = formatConsoleMessage('info', message, data);
    console.log(consoleMessage);
    fs.appendFileSync(logFile, fileMessage);
  },

  warn(message: string, data?: any) {
    const fileMessage = formatMessage('WARN', message, data);
    const consoleMessage = formatConsoleMessage('warn', message, data);
    console.warn(consoleMessage);
    fs.appendFileSync(logFile, fileMessage);
  },

  error(message: string, data?: any) {
    const fileMessage = formatMessage('ERROR', message, data);
    const consoleMessage = formatConsoleMessage('error', message, data);
    console.error(consoleMessage);
    fs.appendFileSync(logFile, fileMessage);
  },

  debug(message: string, data?: any) {
    const fileMessage = formatMessage('DEBUG', message, data);
    const consoleMessage = formatConsoleMessage('debug', message, data);
    // Use console.log instead of console.debug for better visibility
    console.log(consoleMessage);
    fs.appendFileSync(logFile, fileMessage);
  }
}; 