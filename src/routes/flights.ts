import express, { Request, Response } from 'express';
import { amadeusService } from '../services/amadeus.js';
import { VacationBudgetAgent } from '../services/agents.js';

const router = express.Router();

// Test endpoint to verify the router is working
router.get('/test', (req: Request, res: Response) => {
  console.log('Flight test endpoint called');
  res.json({ 
    status: 'ok', 
    message: 'Flight routes are working',
    timestamp: new Date().toISOString()
  });
});

// Flight search endpoint
router.post('/', async (req: Request, res: Response) => {
  try {
    console.log('Processing flight search request:', {
      body: JSON.stringify(req.body, null, 2),
      headers: {
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent'],
        origin: req.headers.origin
      }
    });

    const { departureLocation, destinations, travelers, cabinClass } = req.body;

    // Validate required fields
    const missingFields = [];
    if (!departureLocation?.code) missingFields.push('departure location code');
    if (!departureLocation?.label) missingFields.push('departure location label');
    if (!destinations?.[0]?.code) missingFields.push('destination code');
    if (!destinations?.[0]?.label) missingFields.push('destination label');
    if (!departureLocation?.outboundDate) missingFields.push('outbound date');
    if (!departureLocation?.inboundDate) missingFields.push('inbound date');

    if (missingFields.length > 0) {
      console.error('Missing required fields:', {
        missingFields,
        receivedFields: {
          departureLocation,
          destinations,
          travelers,
          cabinClass
        }
      });
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`,
        timestamp: new Date().toISOString()
      });
    }

    let flightOffers = [];
    let source = 'amadeus';

    if (process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET) {
      try {
        console.log('Searching flights with Amadeus:', {
          origin: departureLocation.code,
          destination: destinations[0].code,
          dates: {
            outbound: departureLocation.outboundDate,
            inbound: departureLocation.inboundDate
          }
        });

        const amadeusResults = await amadeusService.searchFlights({
          originLocationCode: departureLocation.code,
          destinationLocationCode: destinations[0].code,
          departureDate: departureLocation.outboundDate,
          returnDate: departureLocation.inboundDate,
          adults: travelers,
          travelClass: cabinClass
        });

        if (amadeusResults && amadeusResults.length > 0) {
          console.log(`Found ${amadeusResults.length} Amadeus results`);
          
          // Create a map to store airline info to avoid duplicate requests
          const airlineInfoMap = new Map();
          
          const transformedResults = await Promise.all(
            amadeusResults.map(async (offer) => {
              const carrierCode = offer.itineraries[0].segments[0].carrierCode;
              let airlineInfo;
              
              if (airlineInfoMap.has(carrierCode)) {
                airlineInfo = airlineInfoMap.get(carrierCode);
              } else {
                try {
                  airlineInfo = await amadeusService.getAirlineInfo(carrierCode);
                  airlineInfoMap.set(carrierCode, airlineInfo);
                } catch (error) {
                  console.log(`Could not fetch info for airline ${carrierCode}, using code as name`);
                  airlineInfo = { commonName: carrierCode };
                  airlineInfoMap.set(carrierCode, airlineInfo);
                }
              }
              
              return amadeusService.transformFlightOffer(offer, airlineInfo);
            })
          );
          
          flightOffers = transformedResults;
        } else {
          console.log('No Amadeus results found, falling back to Perplexity');
        }
      } catch (error) {
        console.error('Amadeus API error:', error);
        // Continue to Perplexity fallback
      }
    }

    if (!flightOffers || flightOffers.length === 0) {
      source = 'perplexity';
      console.log('Using Perplexity fallback for flight search');
      const agent = new VacationBudgetAgent();
      
      const perplexityResults = await agent.handleTravelRequest({
        type: 'flight-search',
        departureLocation: {
          ...departureLocation,
          airport: departureLocation.code
        },
        destinations: destinations.map(dest => ({
          ...dest,
          airport: dest.code
        })),
        country: destinations[0].label,
        travelers,
        currency: 'USD',
        startDate: departureLocation.outboundDate,
        endDate: departureLocation.inboundDate
      });

      if (perplexityResults.flights) {
        flightOffers = [
          ...(perplexityResults.flights.budget?.references || []),
          ...(perplexityResults.flights.medium?.references || []),
          ...(perplexityResults.flights.premium?.references || [])
        ];
      }
    }

    console.log(`Returning ${flightOffers.length} flight offers from ${source}`);
    res.json({
      success: true,
      data: flightOffers,
      source,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Flight search error:', {
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error,
      type: typeof error
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
      timestamp: new Date().toISOString()
    });
  }
});

export default router; 