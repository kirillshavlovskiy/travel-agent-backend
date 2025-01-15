import express from 'express';
import axios from 'axios';
const router = express.Router();
router.get('/proxy', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'URL parameter is required' });
        }
        // Fetch the image
        const response = await axios.get(url, {
            responseType: 'stream'
        });
        // Forward the content type
        res.set('Content-Type', response.headers['content-type']);
        // Pipe the image data to the response
        response.data.pipe(res);
    }
    catch (error) {
        console.error('Error proxying image:', error);
        res.status(500).json({ error: 'Failed to proxy image' });
    }
});
export default router;
//# sourceMappingURL=images.js.map