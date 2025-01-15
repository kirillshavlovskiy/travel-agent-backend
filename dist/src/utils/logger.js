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
function formatMessage(level, message, data) {
    const timestamp = new Date().toISOString();
    const dataStr = data ? `\n${JSON.stringify(data, null, 2)}` : '';
    return `[${timestamp}] [${level}] ${message}${dataStr}\n`;
}
export const logger = {
    info(message, data) {
        const logMessage = formatMessage('INFO', message, data);
        console.log(logMessage);
        fs.appendFileSync(logFile, logMessage);
    },
    warn(message, data) {
        const logMessage = formatMessage('WARN', message, data);
        console.warn(logMessage);
        fs.appendFileSync(logFile, logMessage);
    },
    error(message, data) {
        const logMessage = formatMessage('ERROR', message, data);
        console.error(logMessage);
        fs.appendFileSync(logFile, logMessage);
    },
    debug(message, data) {
        const logMessage = formatMessage('DEBUG', message, data);
        console.debug(logMessage);
        fs.appendFileSync(logFile, logMessage);
    }
};
//# sourceMappingURL=logger.js.map