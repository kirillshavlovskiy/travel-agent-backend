import { Router, Request, Response } from 'express';
import { VacationBudgetAgent } from '../services/agents';

const router = Router();
const agent = new VacationBudgetAgent();

// Calculate budget endpoint
router.post('/calculate-budget', async (req: Request, res: Response) => {
  console.log('[Calculate Budget] Received request:', {
    body: req.body,
    query: req.query,
    origin: req.headers.origin
  });

  try {
    const { departureLocation, destinations, startDate, endDate, travelers, budgetLimit, currency } = req.body;

    // Validate required fields
    if (!departureLocation?.code || !destinations?.[0]?.code || !startDate || !endDate || !travelers) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        timestamp: new Date().toISOString()
      });
    }

    // Transform request for the agent
    const travelRequest = {
      type: 'full',
      departureLocation: {
        name: departureLocation.label,
        outboundDate: startDate,
        inboundDate: endDate,
        isRoundTrip: true
      },
      country: destinations[0].code,
      travelers: parseInt(travelers),
      currency: currency || 'USD',
      budget: budgetLimit ? parseFloat(budgetLimit) : undefined
    };

    // Pass the transformed request to the agent
    const result = await agent.handleTravelRequest(travelRequest);

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Calculate Budget] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

export default router; 