import express from 'express';
import { cities } from '../src/data/cities.js';
import { airports } from '../src/data/airports.js';
const router = express.Router();
// Get locations endpoint
router.get('/locations', async (req, res) => {
    try {
        res.json({
            cities,
            airports,
            citiesCount: cities.length,
            airportsCount: airports.length
        });
    }
    catch (error) {
        console.error('Error fetching locations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get budget endpoint
router.get('/', async (req, res) => {
    try {
        res.json({ message: 'Budget endpoint' });
    }
    catch (error) {
        console.error('Error in budget route:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
export default router;
//# sourceMappingURL=budget.js.map