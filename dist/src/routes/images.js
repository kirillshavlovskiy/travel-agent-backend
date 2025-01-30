import express from 'express';
import axios from 'axios';
const router = express.Router();
const isValidImageUrl = (url) => {
    try {
        const parsedUrl = new URL(url);
        // Only allow http/https protocols
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            return false;
        }
        // Check if URL is too long or contains repeated patterns
        if (url.length > 500 || /(.)\1{20,}/.test(url)) {
            return false;
        }
        return true;
    }
    catch {
        return false;
    }
};
router.get('/proxy', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'URL parameter is required' });
        }
        // Validate and clean the URL
        if (!isValidImageUrl(url)) {
            return res.status(400).json({ error: 'Invalid image URL' });
        }
        // Fetch the image with timeout
        const response = await axios.get(url, {
            responseType: 'stream',
            timeout: 5000, // 5 second timeout
            maxContentLength: 5 * 1024 * 1024 // 5MB max size
        });
        // Verify content type is an image
        const contentType = response.headers['content-type'];
        if (!contentType?.startsWith('image/')) {
            return res.status(400).json({ error: 'URL does not point to an image' });
        }
        // Forward the content type
        res.set('Content-Type', contentType);
        // Pipe the image data to the response
        response.data.pipe(res);
    }
    catch (error) {
        console.error('Error proxying image:', error);
        res.status(500).json({ error: 'Failed to proxy image' });
    }
});
export default router;
