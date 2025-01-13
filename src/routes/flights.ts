import { Router, Request, Response } from 'express';
import { AmadeusService } from '../services/amadeus.js';
import { AmadeusFlightOffer, FlightReference } from '../types.js';
import { AmadeusItinerary, AmadeusSegment } from '../types/amadeus.js';

const router = Router();
const amadeusService = new AmadeusService();

interface Destination {
  code: string;
  label: string;
  airport?: string;
}

interface GroupedFlights {
  budget: FlightGroup;
  medium: FlightGroup;
  premium: FlightGroup;
}

interface FlightGroup {
  min: number;
  max: number;
  average: number;
  confidence: number;
  source: string;
  references: TransformedFlight[];
}

interface TransformedFlight {
  id: string;
  airline: string;
  cabinClass?: string;
  price: {
    amount: number;
    currency: string;
    numberOfTravelers: number;
  };
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
    const {
      departureLocation,
      destinations,
      travelers = 1,
      cabinClass
    } = req.body;

    if (!departureLocation || !destinations || !destinations.length) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }

    let flightOffers: AmadeusFlightOffer[] = [];
    let source = 'amadeus';
    let errors = [];

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
              offer.itineraries.flatMap((itinerary: AmadeusItinerary) => 
                itinerary.segments.map((segment: AmadeusSegment) => segment.carrierCode)
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
            errors.push('Airline information unavailable');
            airlineInfoArray = uniqueAirlineCodes.map(code => ({
              type: 'airline',
              iataCode: code,
              icaoCode: code,
              businessName: code,
              commonName: code
            }));
          }

          // Transform flight offers
          flightOffers = amadeusResults;
          console.log(`  IDs: ${flightOffers.map(f => f.id).join(', ')}`);
        }
      } catch (error) {
        console.error('Error searching Amadeus flights:', error);
        errors.push('Flight search encountered an error');
      }
    }

    // Transform Amadeus response to match frontend expectations
    const transformedFlights: TransformedFlight[] = flightOffers.map(offer => ({
      id: offer.id,
      airline: offer.validatingAirlineCodes[0],
      cabinClass: offer.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin,
      price: {
        amount: parseFloat(offer.price.total),
        currency: offer.price.currency,
        numberOfTravelers: travelers
      }
    }));

    // Group flights by tier based on price and cabin class
    const groupedFlights = transformedFlights.reduce<GroupedFlights>((acc, flight) => {
      const tier = amadeusService.determineTier(flight.price.amount, flight.cabinClass);
      if (!acc[tier]) {
        acc[tier] = {
          min: Infinity,
          max: -Infinity,
          average: 0,
          confidence: 0.8,
          source: source,
          references: []
        };
      }
      
      acc[tier].references.push(flight);
      acc[tier].min = Math.min(acc[tier].min, flight.price.amount);
      acc[tier].max = Math.max(acc[tier].max, flight.price.amount);
      acc[tier].average = acc[tier].references.reduce((sum, f) => sum + f.price.amount, 0) / acc[tier].references.length;
      
      return acc;
    }, {
      budget: { min: Infinity, max: -Infinity, average: 0, confidence: 0.8, source: source, references: [] },
      medium: { min: Infinity, max: -Infinity, average: 0, confidence: 0.8, source: source, references: [] },
      premium: { min: Infinity, max: -Infinity, average: 0, confidence: 0.8, source: source, references: [] }
    });

    // Send transformed and grouped data
    return res.json({
      success: true,
      data: {
        flights: groupedFlights,
        dictionaries: flightOffers[0]?.dictionaries
      },
      source,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error processing flight search:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Test endpoint to measure Amadeus API response time
router.get('/test-amadeus-timing', async (req: Request, res: Response) => {
  try {
    console.time('amadeus-search');
    
    const results = await amadeusService.searchFlights({
      originLocationCode: 'JFK',
      destinationLocationCode: 'PAR',
      departureDate: '2025-01-09',
      returnDate: '2025-01-16',
      adults: 2,
      travelClass: 'ECONOMY'
    });
    
    console.timeEnd('amadeus-search');
    
    res.json({
      success: true,
      timing: process.hrtime(),
      resultsCount: results.length,
      firstResult: results[0] ? {
        id: results[0].id,
        price: results[0].price,
        segments: results[0].itineraries[0].segments.length
      } : null
    });
  } catch (error: any) {
    console.error('Amadeus timing test error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Unknown error occurred'
    });
  }
});

export default router; 