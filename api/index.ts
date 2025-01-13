import app from '../server.js';

// Export a function that handles the request
export default async function handler(req: any, res: any) {
  // Forward the request to the Express app
  return app(req, res);
} 