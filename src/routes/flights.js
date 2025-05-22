// Add this endpoint near the other flight-related endpoints
router.post('/fare-options', async (req, res) => {
  try {
    const { origin, destination, departureDate, returnDate, adults, flightNumber, carrierCode } = req.body;
    
    if (!origin || !destination || !departureDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: origin, destination, departureDate are required'
      });
    }

    logger.info('Fetching fare options for flight', {
      origin, 
      destination, 
      departureDate,
      returnDate,
      flightNumber,
      carrierCode
    });

    // Initialize Amadeus service if not already
    const amadeusService = new AmadeusService();
    
    // Fetch flight offers with detailed fare options
    const flightOffers = await amadeusService.searchFlights({
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate,
      returnDate,
      adults: adults || 1,
      // If we have a specific flight number, include it in the request
      includedAirlineCodes: carrierCode ? [carrierCode] : undefined,
      travelClass: 'ECONOMY', // Default to economy but could be parameterized
      currencyCode: 'USD',
      max: 5 // Limit to reduce response size
    });

    // Filter by flight number if provided
    let filteredOffers = flightOffers;
    if (flightNumber && carrierCode) {
      filteredOffers = flightOffers.filter(offer => {
        // Check outbound segments
        const outboundMatch = offer.itineraries[0]?.segments?.some(seg => 
          seg.carrierCode === carrierCode && seg.number === flightNumber
        );
        
        // Check inbound segments if any
        const inboundMatch = offer.itineraries[1]?.segments?.some(seg => 
          seg.carrierCode === carrierCode && seg.number === flightNumber
        );
        
        return outboundMatch || inboundMatch;
      });
    }

    // Format response to include detailed fare options
    const fareOptions = filteredOffers.map(offer => {
      // Extract fare details
      const fareDetailsBySegment = offer.travelerPricings[0]?.fareDetailsBySegment || [];
      
      // Get unique branded fares
      const brandedFares = new Set();
      fareDetailsBySegment.forEach(detail => {
        if (detail.brandedFare) {
          brandedFares.add(detail.brandedFare);
        } else if (detail.cabin) {
          brandedFares.add(detail.cabin);
        }
      });

      return {
        id: offer.id,
        price: {
          amount: parseFloat(offer.price.total),
          currency: offer.price.currency
        },
        fareType: Array.from(brandedFares)[0] || 'ECONOMY',
        cabin: fareDetailsBySegment[0]?.cabin || 'ECONOMY',
        fareDetailsBySegment: fareDetailsBySegment.map(detail => ({
          cabin: detail.cabin,
          class: detail.class,
          brandedFare: detail.brandedFare,
          fareBasis: detail.fareBasis,
          includedCheckedBags: detail.includedCheckedBags
        })),
        // Include basic flight info
        outbound: {
          departureTime: offer.itineraries[0]?.segments[0]?.departure?.at,
          arrivalTime: offer.itineraries[0]?.segments[offer.itineraries[0].segments.length - 1]?.arrival?.at,
          duration: offer.itineraries[0]?.duration
        },
        inbound: returnDate ? {
          departureTime: offer.itineraries[1]?.segments[0]?.departure?.at,
          arrivalTime: offer.itineraries[1]?.segments[offer.itineraries[1].segments.length - 1]?.arrival?.at,
          duration: offer.itineraries[1]?.duration
        } : undefined
      };
    });

    return res.json({
      success: true,
      data: {
        fareOptions,
        count: fareOptions.length
      }
    });

  } catch (error) {
    logger.error('Error fetching fare options', {
      error: error.message,
      stack: error.stack
    });
    
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch fare options',
      details: error.message
    });
  }
}); 