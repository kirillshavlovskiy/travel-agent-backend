import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import winston from 'winston';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, '../../logs');
const logFile = path.join(logsDir, 'server.log');
const hotelLogFile = path.join(logsDir, 'hotel-processing.log');
console.log('Logs directory:', logsDir);
console.log('Hotel log file:', hotelLogFile);
// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
    console.log('Creating logs directory:', logsDir);
    fs.mkdirSync(logsDir, { recursive: true });
}
// Ensure hotel log file exists
if (!fs.existsSync(hotelLogFile)) {
    console.log('Creating hotel log file:', hotelLogFile);
    fs.writeFileSync(hotelLogFile, '');
}
// ANSI color codes for better visibility
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    info: '\x1b[36m', // Cyan
    warn: '\x1b[33m', // Yellow
    error: '\x1b[31m', // Red
    debug: '\x1b[35m', // Magenta
};
const hotelLogger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [
        new winston.transports.File({
            filename: hotelLogFile,
            level: 'debug'
        }),
        new winston.transports.Console({
            format: winston.format.combine(winston.format.colorize(), winston.format.simple())
        })
    ]
});
// Test log to verify logging is working
hotelLogger.info('Hotel logger initialized', {
    logFile: hotelLogFile,
    timestamp: new Date().toISOString()
});
// Add specific hotel logging methods
export const logHotelProcessing = {
    batchStart: (batchNumber, hotelIds) => {
        console.log('Logging batch start:', { batchNumber, hotelCount: hotelIds.length });
        hotelLogger.info('Processing hotel batch', {
            batch: batchNumber,
            hotelCount: hotelIds.length,
            hotelIds
        });
    },
    hotelFound: (hotelData) => {
        console.log('Logging hotel found:', { hotelId: hotelData.id, name: hotelData.name });
        hotelLogger.info('Hotel data processed', {
            hotelId: hotelData.id,
            name: hotelData.name,
            offers: hotelData.offers?.length || 0,
            price: hotelData.offers?.[0]?.price
        });
    },
    batchError: (batchNumber, error) => {
        console.log('Logging batch error:', { batchNumber, error: error.message });
        hotelLogger.error('Batch processing error', {
            batch: batchNumber,
            error: error.message,
            details: error.response || error
        });
    },
    searchSummary: (summary) => {
        console.log('Logging search summary:', { totalHotels: summary.totalHotelsFound });
        hotelLogger.info('Hotel search completed', {
            totalHotels: summary.totalHotelsFound,
            availableHotels: summary.availableHotels,
            destinations: summary.destinations,
            dateRange: summary.dateRange
        });
    }
};
function formatMessage(level, message, data) {
    const timestamp = new Date().toISOString();
    const dataStr = data ? `\n${JSON.stringify(data, null, 2)}` : '';
    return `[${timestamp}] [${level}] ${message}${dataStr}\n`;
}
function formatConsoleMessage(level, message, data) {
    const timestamp = new Date().toISOString();
    const color = colors[level.toLowerCase()] || colors.reset;
    const dataStr = data ? `\n${JSON.stringify(data, null, 2)}` : '';
    return `${color}[${timestamp}] [${level}] ${message}${dataStr}${colors.reset}`;
}
export const logger = {
    info(message, data) {
        const logMessage = formatMessage('INFO', message, data);
        const consoleMessage = formatConsoleMessage('info', message, data);
        console.log(consoleMessage);
        fs.appendFileSync(logFile, logMessage);
    },
    warn(message, data) {
        const logMessage = formatMessage('WARN', message, data);
        const consoleMessage = formatConsoleMessage('warn', message, data);
        console.warn(consoleMessage);
        fs.appendFileSync(logFile, logMessage);
    },
    error(message, data) {
        const logMessage = formatMessage('ERROR', message, data);
        const consoleMessage = formatConsoleMessage('error', message, data);
        console.error(consoleMessage);
        fs.appendFileSync(logFile, logMessage);
    },
    debug(message, data) {
        const logMessage = formatMessage('DEBUG', message, data);
        const consoleMessage = formatConsoleMessage('debug', message, data);
        // Use console.log instead of console.debug for better visibility
        console.log(consoleMessage);
        fs.appendFileSync(logFile, logMessage);
    }
};
