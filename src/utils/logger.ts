import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, '..', '..', 'logs');

// Only create logs directory in development
const isDevelopment = process.env.NODE_ENV === 'development';

if (isDevelopment && !fs.existsSync(logsDir)) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch (error) {
    console.error('Failed to create logs directory:', error);
  }
}

export const logToFile = (message: string) => {
  // Skip logging in production
  if (!isDevelopment) {
    return;
  }

  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;

  try {
    fs.appendFileSync(path.join(logsDir, 'amadeus.log'), logMessage + '\n');
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
}; 