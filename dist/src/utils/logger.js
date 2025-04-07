import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import winston from 'winston';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Use absolute paths from project root
const projectRoot = path.resolve(__dirname, '../../');
const logsDir = path.join(projectRoot, 'logs');
const logFile = path.join(logsDir, 'server.log');
const hotelLogFile = path.join(logsDir, 'hotel-processing.log');
console.log('Logs directory:', logsDir);
console.log('Hotel log file:', hotelLogFile);
// Ensure logs directory exists with proper permissions
try {
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true, mode: 0o755 });
        console.log('Created logs directory:', logsDir);
    }
    // Ensure log files exist with proper permissions
    [logFile, hotelLogFile].forEach(file => {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, '', { mode: 0o644 });
            console.log('Created log file:', file);
        }
    });
    // Test write access
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] Logger initialized\n`);
    fs.appendFileSync(hotelLogFile, `[${new Date().toISOString()}] Hotel logger initialized\n`);
}
catch (error) {
    console.error('Error setting up logging:', error);
    process.exit(1); // Exit if we can't set up logging
}
// Create Winston logger instance
const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(winston.format.timestamp(), winston.format.printf(({ level, message, timestamp, ...rest }) => {
        const meta = Object.keys(rest).length ? `\n${JSON.stringify(rest, null, 2)}` : '';
        return `[${timestamp}] [${level.toUpperCase()}] ${message}${meta}`;
    })),
    transports: [
        new winston.transports.File({
            filename: logFile,
            level: 'debug'
        }),
        new winston.transports.Console({
            format: winston.format.combine(winston.format.colorize(), winston.format.printf(({ level, message, timestamp, ...rest }) => {
                const meta = Object.keys(rest).length ? `\n${JSON.stringify(rest, null, 2)}` : '';
                return `[${timestamp}] [${level.toUpperCase()}] ${message}${meta}`;
            }))
        })
    ]
});
// Export the logger instance directly
export { logger };
// Add specific hotel logging methods
export const logHotelProcessing = {
    batchStart: (batchNumber, hotelIds) => {
        console.log('Logging batch start:', { batchNumber, hotelCount: hotelIds.length });
        logger.info('Processing hotel batch', {
            batch: batchNumber,
            hotelCount: hotelIds.length,
            hotelIds
        });
    },
    hotelFound: (hotelData) => {
        console.log('Logging hotel found:', { hotelId: hotelData.id, name: hotelData.name });
        logger.info('Hotel data processed', {
            hotelId: hotelData.id,
            name: hotelData.name,
            offers: hotelData.offers?.length || 0,
            price: hotelData.offers?.[0]?.price
        });
    },
    batchError: (batchNumber, error) => {
        console.log('Logging batch error:', { batchNumber, error: error.message });
        logger.error('Batch processing error', {
            batch: batchNumber,
            error: error.message,
            details: error.response || error
        });
    },
    searchSummary: (summary) => {
        console.log('Logging search summary:', { totalHotels: summary.totalHotelsFound });
        logger.info('Hotel search completed', {
            totalHotels: summary.totalHotelsFound,
            availableHotels: summary.availableHotels,
            destinations: summary.destinations,
            dateRange: summary.dateRange
        });
    }
};
// Add specific Viator logging methods
export const logViatorProcessing = {
    availabilityCheck: (productCode, data) => {
        logger.info('[Viator] Raw availability check', {
            productCode,
            timestamp: new Date().toISOString(),
            ...data
        });
    },
    availabilityResult: (productCode, data) => {
        logger.info('[Viator] Raw availability result', {
            productCode,
            timestamp: new Date().toISOString(),
            ...data
        });
        // Log raw response separately for better visibility
        if (data.stage === 'raw_response' && data.rawData) {
            logger.info('[Viator] Raw API response data', {
                productCode,
                timestamp: new Date().toISOString(),
                rawResponse: JSON.stringify(data.rawData)
            });
        }
    },
    error: (productCode, error) => {
        logger.error('[Viator] Processing error', {
            productCode,
            timestamp: new Date().toISOString(),
            error: error.message,
            stack: error.stack,
            details: error.response || error
        });
    }
};
