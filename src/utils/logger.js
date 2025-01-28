"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.logHotelProcessing = void 0;
var fs_1 = require("fs");
var path_1 = require("path");
var url_1 = require("url");
var winston_1 = require("winston");
var __filename = (0, url_1.fileURLToPath)(import.meta.url);
var __dirname = path_1.default.dirname(__filename);
var logsDir = path_1.default.join(__dirname, '../../logs');
var logFile = path_1.default.join(logsDir, 'server.log');
var hotelLogFile = path_1.default.join(logsDir, 'hotel-processing.log');
console.log('Logs directory:', logsDir);
console.log('Hotel log file:', hotelLogFile);
// Ensure logs directory exists
if (!fs_1.default.existsSync(logsDir)) {
    console.log('Creating logs directory:', logsDir);
    fs_1.default.mkdirSync(logsDir, { recursive: true });
}
// Ensure hotel log file exists
if (!fs_1.default.existsSync(hotelLogFile)) {
    console.log('Creating hotel log file:', hotelLogFile);
    fs_1.default.writeFileSync(hotelLogFile, '');
}
// ANSI color codes for better visibility
var colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    info: '\x1b[36m', // Cyan
    warn: '\x1b[33m', // Yellow
    error: '\x1b[31m', // Red
    debug: '\x1b[35m', // Magenta
};
var hotelLogger = winston_1.default.createLogger({
    level: 'debug',
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.json()),
    transports: [
        new winston_1.default.transports.File({
            filename: hotelLogFile,
            level: 'debug'
        }),
        new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple())
        })
    ]
});
// Test log to verify logging is working
hotelLogger.info('Hotel logger initialized', {
    logFile: hotelLogFile,
    timestamp: new Date().toISOString()
});
// Add specific hotel logging methods
exports.logHotelProcessing = {
    batchStart: function (batchNumber, hotelIds) {
        console.log('Logging batch start:', { batchNumber: batchNumber, hotelCount: hotelIds.length });
        hotelLogger.info('Processing hotel batch', {
            batch: batchNumber,
            hotelCount: hotelIds.length,
            hotelIds: hotelIds
        });
    },
    hotelFound: function (hotelData) {
        var _a, _b, _c;
        console.log('Logging hotel found:', { hotelId: hotelData.id, name: hotelData.name });
        hotelLogger.info('Hotel data processed', {
            hotelId: hotelData.id,
            name: hotelData.name,
            offers: ((_a = hotelData.offers) === null || _a === void 0 ? void 0 : _a.length) || 0,
            price: (_c = (_b = hotelData.offers) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.price
        });
    },
    batchError: function (batchNumber, error) {
        console.log('Logging batch error:', { batchNumber: batchNumber, error: error.message });
        hotelLogger.error('Batch processing error', {
            batch: batchNumber,
            error: error.message,
            details: error.response || error
        });
    },
    searchSummary: function (summary) {
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
    var timestamp = new Date().toISOString();
    var dataStr = data ? "\n".concat(JSON.stringify(data, null, 2)) : '';
    return "[".concat(timestamp, "] [").concat(level, "] ").concat(message).concat(dataStr, "\n");
}
function formatConsoleMessage(level, message, data) {
    var timestamp = new Date().toISOString();
    var color = colors[level.toLowerCase()] || colors.reset;
    var dataStr = data ? "\n".concat(JSON.stringify(data, null, 2)) : '';
    return "".concat(color, "[").concat(timestamp, "] [").concat(level, "] ").concat(message).concat(dataStr).concat(colors.reset);
}
exports.logger = {
    info: function (message, data) {
        var logMessage = formatMessage('INFO', message, data);
        var consoleMessage = formatConsoleMessage('info', message, data);
        console.log(consoleMessage);
        fs_1.default.appendFileSync(logFile, logMessage);
    },
    warn: function (message, data) {
        var logMessage = formatMessage('WARN', message, data);
        var consoleMessage = formatConsoleMessage('warn', message, data);
        console.warn(consoleMessage);
        fs_1.default.appendFileSync(logFile, logMessage);
    },
    error: function (message, data) {
        var logMessage = formatMessage('ERROR', message, data);
        var consoleMessage = formatConsoleMessage('error', message, data);
        console.error(consoleMessage);
        fs_1.default.appendFileSync(logFile, logMessage);
    },
    debug: function (message, data) {
        var logMessage = formatMessage('DEBUG', message, data);
        var consoleMessage = formatConsoleMessage('debug', message, data);
        // Use console.log instead of console.debug for better visibility
        console.log(consoleMessage);
        fs_1.default.appendFileSync(logFile, logMessage);
    }
};
