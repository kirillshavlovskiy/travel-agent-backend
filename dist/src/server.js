import express from 'express';
const app = express();
// Add timeout middleware with longer timeout for budget calculation
app.use((req, res, next) => {
    // Set a longer timeout (10 minutes) for budget calculation
    const timeoutDuration = req.path.includes('/api/budget/calculate') ? 600000 : 30000;
    // Set both the request and response timeouts
    req.setTimeout(timeoutDuration);
    res.setTimeout(timeoutDuration);
    const timeoutHandler = () => {
        console.error(`[TIMEOUT] Request timed out after ${timeoutDuration}ms: ${req.method} ${req.url}`, {
            origin: req.headers.origin,
            path: req.path,
            query: req.query,
            body: req.body
        });
        if (!res.headersSent) {
            res.status(504).json({
                error: 'Gateway Timeout',
                message: 'Request took too long to process',
                timestamp: new Date().toISOString()
            });
        }
    };
    // Set timeout handlers for both request and response
    req.on('timeout', timeoutHandler);
    res.on('timeout', timeoutHandler);
    next();
});
