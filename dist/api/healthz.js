export default function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // Handle preflight request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    // Only allow GET requests
    if (req.method !== 'GET') {
        return res.status(405).json({
            error: 'Method not allowed',
            message: 'Only GET requests are allowed for this endpoint'
        });
    }
    try {
        return res.status(200).json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            message: 'Server is running'
        });
    }
    catch (error) {
        console.error('Health check error:', error);
        return res.status(500).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            message: 'Failed to check server health'
        });
    }
}
//# sourceMappingURL=healthz.js.map