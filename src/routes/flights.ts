import express, { Request, Response } from 'express';
import { amadeusService } from '../services/amadeus.js';
import { VacationBudgetAgent } from '../services/agents.js';

const router = express.Router();

interface Destination {
  code: string;
  label: string;
  airport?: string;
}

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
        // Validate and format IATA codes
        const originCode = departureLocation.code.trim().toUpperCase();
        const destinationCode = destinations[0].code.trim().toUpperCase();
        
        // Validate and format dates
        const outboundDate = new Date(departureLocation.outboundDate);
        const inboundDate = departureLocation.inboundDate ? new Date(departureLocation.inboundDate) : null;
        
        if (isNaN(outboundDate.getTime()) || (inboundDate && isNaN(inboundDate.getTime()))) {
          throw new Error('Invalid date format. Please use YYYY-MM-DD format.');
        }
        
        // Format dates to YYYY-MM-DD
        const formattedOutboundDate = outboundDate.toISOString().split('T')[0];
        const formattedInboundDate = inboundDate ? inboundDate.toISOString().split('T')[0] : undefined;
        
        // Validate cabin class
        const validCabinClasses = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];
        const formattedCabinClass = cabinClass ? cabinClass.toUpperCase() : undefined;
        
        if (formattedCabinClass && !validCabinClasses.includes(formattedCabinClass)) {
          throw new Error(`Invalid cabin class. Must be one of: ${validCabinClasses.join(', ')}`);
        }

        console.log('Searching flights with Amadeus:', {
          origin: originCode,
          destination: destinationCode,
          dates: {
            outbound: formattedOutboundDate,
            inbound: formattedInboundDate
          },
          cabinClass: formattedCabinClass,
          travelers
        });

        const amadeusResults = await amadeusService.searchFlights({
          originLocationCode: originCode,
          destinationLocationCode: destinationCode,
          departureDate: formattedOutboundDate,
          returnDate: formattedInboundDate,
          adults: travelers,
          travelClass: formattedCabinClass as 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST'
        });

        if (amadeusResults && amadeusResults.length > 0) {
          console.log(`Found ${amadeusResults.length} Amadeus results`);
          
          // Get unique airline codes from all results
          const uniqueAirlineCodes = [...new Set(
            amadeusResults.flatMap(offer => 
              offer.itineraries.flatMap(itinerary => 
                itinerary.segments.map(segment => segment.carrierCode)
              )
            )
          )];
          
          console.log('Unique airline codes:', uniqueAirlineCodes);
          
          // Fetch airline information for all carriers at once
          let airlineInfoArray;
          try {
            airlineInfoArray = await amadeusService.getAirlineInfo(uniqueAirlineCodes);
          } catch (error) {
            console.error('Failed to fetch airline information:', error);
            airlineInfoArray = uniqueAirlineCodes.map(code => ({
              type: 'airline',
              iataCode: code,
              icaoCode: code,
              businessName: code,
              commonName: code
            }));
          }
          
          const transformedResults = amadeusResults.map(offer => 
            amadeusService.transformFlightOffer(offer, airlineInfoArray)
          );
          
          console.log('\n=== Transformed Flight Results ===');
          console.log('Total transformed results:', transformedResults.length);
          if (transformedResults.length > 0) {
            console.log('Sample transformed result:', JSON.stringify(transformedResults[0], null, 2));
            
            // Group flights by tier and analyze price ranges
            const flightsByTier = {
              budget: transformedResults.filter(f => f.tier === 'budget'),
              medium: transformedResults.filter(f => f.tier === 'medium'),
              premium: transformedResults.filter(f => f.tier === 'premium')
            };

            console.log('\n=== Price Analysis by Tier ===');
            Object.entries(flightsByTier).forEach(([tier, flights]) => {
              if (flights.length > 0) {
                const prices = flights.map(f => f.price.amount);
                console.log(`${tier.charAt(0).toUpperCase() + tier.slice(1)} Class (${flights.length} flights):`);
                console.log(`  Price Range: $${Math.min(...prices).toFixed(2)} - $${Math.max(...prices).toFixed(2)}`);
                console.log(`  IDs: ${flights.map(f => f.amadeusId).join(', ')}`);
              }
            });

            console.log('\nUnique airlines:', [...new Set(transformedResults.map(r => r.outbound.segments[0].airline.code))]);
            console.log('Overall price range:', {
              min: Math.min(...transformedResults.map(r => r.price.amount)),
              max: Math.max(...transformedResults.map(r => r.price.amount)),
              currency: transformedResults[0].price.currency
            });
          }
          
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
        destinations: destinations.map((dest: Destination) => ({
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