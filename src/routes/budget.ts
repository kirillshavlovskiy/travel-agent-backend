import { Router, Request, Response } from 'express';
import { VacationBudgetAgent } from '../services/agents.js';
import { PrismaClient } from '@prisma/client';

const router = Router();
const agent = new VacationBudgetAgent();
const prisma = new PrismaClient();

// Calculate budget endpoint
router.post('/calculate-budget', async (req: Request, res: Response) => {
  try {
    console.log('[Calculate Budget] Received request:', {
      body: req.body,
      query: req.query,
      origin: req.headers.origin
    });

    // Validate required fields
    const missingFields = [];
    if (!req.body.departureLocation?.code) missingFields.push('departure location code');
    if (!req.body.departureLocation?.label) missingFields.push('departure location label');
    if (!req.body.startDate) missingFields.push('start date');
    if (!req.body.endDate) missingFields.push('end date');
    if (!req.body.destinations?.[0]?.code) missingFields.push('destination code');
    if (!req.body.travelers) missingFields.push('number of travelers');

    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    // Transform the request to match our internal format
    const transformedRequest = {
      type: 'full',
      departureLocation: {
        code: req.body.departureLocation.code,
        label: req.body.departureLocation.label,
        airport: req.body.departureLocation.airport || req.body.departureLocation.code,
        outboundDate: req.body.startDate,
        inboundDate: req.body.endDate,
        isRoundTrip: true
      },
      destinations: req.body.destinations.map((dest: any) => ({
        code: dest.code,
        label: dest.label || dest.code,
        airport: dest.airport || dest.code
      })),
      country: req.body.destinations[0].code,
      travelers: parseInt(req.body.travelers) || 1,
      currency: req.body.currency || 'USD',
      budget: req.body.budgetLimit ? parseInt(req.body.budgetLimit) : undefined,
      startDate: req.body.startDate,
      endDate: req.body.endDate
    };

    console.log('[Calculate Budget] Transformed request:', transformedRequest);

    const estimates = await agent.handleTravelRequest(transformedRequest);

    // Save search results to database
    const searchResult = await prisma.searchResult.create({
      data: {
        tripId: req.body.tripId || undefined,
        departureLocation: transformedRequest.departureLocation.code,
        destinations: transformedRequest.destinations.map(d => d.code),
        startDate: new Date(transformedRequest.startDate),
        endDate: new Date(transformedRequest.endDate),
        travelers: transformedRequest.travelers,
        currency: transformedRequest.currency,
        budgetLimit: transformedRequest.budget,
        results: estimates,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    console.log('[Calculate Budget] Saved search results:', searchResult.id);

    res.json({
      success: true,
      data: {
        ...estimates,
        destinations: req.body.destinations,
        searchId: searchResult.id
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Calculate Budget] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

export default router; 