import pino from 'pino';

// Detect environment based on NODE_ENV
const isDev = process.env.NODE_ENV === 'development';

// Configuration for development vs production
const config = isDev ? {
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
        },
    },
    level: process.env.LOG_LEVEL || 'error', // Default to error to minimize noise
} : {
    level: process.env.LOG_LEVEL || 'error', // Default to error in prod
    // In production, we log JSON to stdout (standard practice for containerized apps)
    // No transport needed as pino defaults to JSON
};

// Create the logger instance
const logger = pino(config);

// Export a default logger
export default logger;
