import { Router, Request, Response } from 'express';
import { VacationBudgetAgent } from '../services/agents.js';

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

    // Validate required fields with detailed error messages
    const missingFields = [];
    if (!departureLocation?.code) missingFields.push('departure location code');
    if (!destinations?.[0]?.code) missingFields.push('destination country code');
    if (!startDate) missingFields.push('start date');
    if (!endDate) missingFields.push('end date');
    if (!travelers) missingFields.push('number of travelers');

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`,
        timestamp: new Date().toISOString()
      });
    }

    // Transform request for the agent
    const travelRequest = {
      type: 'full',
      departureLocation: {
        name: departureLocation.label || departureLocation.code,
        outboundDate: startDate,
        inboundDate: endDate,
        isRoundTrip: true
      },
      country: destinations[0].code,
      travelers: parseInt(travelers.toString()),
      currency: currency || 'USD',
      budget: budgetLimit ? parseFloat(budgetLimit.toString()) : undefined
    };

    console.log('[Calculate Budget] Transformed request:', travelRequest);

    // Pass the transformed request to the agent
    const result = await agent.handleTravelRequest(travelRequest);

    // Transform the result to match the frontend's expected format
    const transformedResult = {
      flights: {
        budget: result.flights?.budget || {
          min: 0,
          max: 0,
          average: 0,
          confidence: 0,
          source: 'default',
          references: []
        },
        medium: result.flights?.medium || {
          min: 0,
          max: 0,
          average: 0,
          confidence: 0,
          source: 'default',
          references: []
        },
        premium: result.flights?.premium || {
          min: 0,
          max: 0,
          average: 0,
          confidence: 0,
          source: 'default',
          references: []
        }
      },
      hotels: {
        budget: result.hotels?.budget || {
          min: 0,
          max: 0,
          average: 0,
          confidence: 0,
          source: 'default',
          references: []
        },
        medium: result.hotels?.medium || {
          min: 0,
          max: 0,
          average: 0,
          confidence: 0,
          source: 'default',
          references: []
        },
        premium: result.hotels?.premium || {
          min: 0,
          max: 0,
          average: 0,
          confidence: 0,
          source: 'default',
          references: []
        }
      },
      destinations: [{
        city: destinations[0].label || destinations[0].code,
        country: destinations[0].code
      }]
    };

    res.json({
      success: true,
      data: transformedResult,
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