import app from '../server.js';
// Export a function that handles the request
export default async function handler(req, res) {
    // Forward the request to the Express app
    return app(req, res);
}
