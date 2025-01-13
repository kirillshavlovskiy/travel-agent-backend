import express from 'express';
const router = express.Router();
// Get perplexity endpoint
router.get('/', async (req, res) => {
    try {
        res.json({ message: 'Perplexity endpoint' });
    }
    catch (error) {
        console.error('Error in perplexity route:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
export default router;
//# sourceMappingURL=perplexity.js.map