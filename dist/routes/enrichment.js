import express from 'express';
import { PerplexityService } from '../services/perplexity';
const router = express.Router();
const perplexityService = new PerplexityService();
router.post('/enrich', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }
        const enrichedDetails = await perplexityService.getEnrichedDetails(query);
        res.json(enrichedDetails);
    }
    catch (error) {
        console.error('Error enriching details:', error);
        res.status(500).json({ error: 'Failed to enrich details' });
    }
});
export default router;
