import { logger } from '../utils/logger.js';
import Amadeus from 'amadeus';

interface AmadeusError extends Error {
  code?: string;
  response?: {
    statusCode: number;
    result?: {
      errors?: Array<{
        detail?: string;
        title?: string;
      }>;
    };
  };
  description?: string;
}

export class AmadeusService {
  private client!: Amadeus;
  private initialized: boolean = false;

  constructor() {
    this.initializeClient();
  }

  private initializeClient() {
    if (this.initialized) return;

    try {
      if (!process.env.AMADEUS_CLIENT_ID || !process.env.AMADEUS_CLIENT_SECRET) {
        throw new Error('Amadeus credentials are not configured');
      }

      this.client = new Amadeus({
        clientId: process.env.AMADEUS_CLIENT_ID,
        clientSecret: process.env.AMADEUS_CLIENT_SECRET,
        logLevel: 'debug'
      });

      this.initialized = true;

      logger.info('[AmadeusService] Initialized with credentials', {
        clientIdLength: process.env.AMADEUS_CLIENT_ID?.length,
        environment: process.env.NODE_ENV
      });
    } catch (error) {
      logger.error('[AmadeusService] Failed to initialize', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private formatError(error: any): any {
    if (!error) return { message: 'Unknown error' };
    
    // Handle Amadeus API errors
    if (error.code && error.code === 'ClientError') {
      return {
        code: error.code,
        statusCode: error.statusCode,
        details: error.description ? error.description : error.result?.errors?.[0]
      };
    }
    
    // Handle standard Error objects
    if (error instanceof Error) {
      return {
        message: error.message,
        stack: error.stack
      };
    }
    
    // Return the error as is if it's already formatted
    return error;
  }

  async getSeatMap(flightOffer: any) {
    if (!this.initialized) {
      this.initializeClient();
    }

    try {
      logger.info('[AmadeusService] Requesting seat map', {
        flightId: flightOffer.id,
        segments: flightOffer.itineraries?.[0]?.segments?.length
      });

      // Transform the flight offer into Amadeus format
      let transformedOffer;
      
      // Check if the flightOffer has a "details" structure (our internal format)
      // or if it's already in Amadeus format
      if (flightOffer.details && (flightOffer.details.outbound || flightOffer.details.inbound)) {
        // Our internal format - transform it
        transformedOffer = {
          data: [{
            type: "flight-offer",
            id: flightOffer.id,
            source: "GDS",
            instantTicketingRequired: false,
            nonHomogeneous: false,
            oneWay: false,
            lastTicketingDate: new Date().toISOString().split('T')[0],
            numberOfBookableSeats: 1,
            itineraries: [
              {
                segments: flightOffer.details.outbound.segments.map((segment: any, index: number) => ({
                  id: `${index + 1}`,
                  departure: {
                    iataCode: segment.departure.airport,
                    terminal: segment.departure.terminal,
                    at: segment.departure.time
                  },
                  arrival: {
                    iataCode: segment.arrival.airport,
                    terminal: segment.arrival.terminal,
                    at: segment.arrival.time
                  },
                  carrierCode: segment.airline.code,
                  number: segment.flightNumber,
                  aircraft: {
                    code: segment.aircraft.code
                  },
                  operating: {
                    carrierCode: segment.airline.code
                  },
                  duration: segment.duration
                }))
              }
            ],
      price: {
              currency: flightOffer.details.price.currency,
              total: String(flightOffer.details.price.amount),
              base: String(flightOffer.details.price.amount)
            },
            pricingOptions: {
              fareType: ["PUBLISHED"],
              includedCheckedBagsOnly: true
            },
            validatingAirlineCodes: [flightOffer.details.validatingAirline],
            travelerPricings: [
              {
                travelerId: "1",
                fareOption: "STANDARD",
                travelerType: "ADULT",
                price: {
                  currency: flightOffer.details.price.currency,
                  total: String(flightOffer.details.price.amount),
                  base: String(flightOffer.details.price.amount)
                },
                fareDetailsBySegment: [
                  {
                    segmentId: "1",
                    cabin: "ECONOMY",
                    class: "Y"
                  }
                ]
              }
            ]
          }]
        };
      } else if (flightOffer.itineraries && flightOffer.itineraries[0]?.segments) {
        // Already in Amadeus format or similar - adapt it
        const segments = flightOffer.itineraries[0].segments;
        
        transformedOffer = {
          data: [{
            type: "flight-offer",
            id: flightOffer.id || "1",
            source: "GDS",
            instantTicketingRequired: false,
            nonHomogeneous: false,
            oneWay: false,
            lastTicketingDate: new Date().toISOString().split('T')[0],
            numberOfBookableSeats: 1,
            itineraries: [
              {
                segments: segments.map((segment: any, index: number) => ({
                  id: `${index + 1}`,
                  departure: {
                    iataCode: segment.departure.iataCode,
                    terminal: segment.departure.terminal,
                    at: segment.departure.at
                  },
                  arrival: {
                    iataCode: segment.arrival.iataCode,
                    terminal: segment.arrival.terminal,
                    at: segment.arrival.at
                  },
                  carrierCode: segment.carrierCode,
                  number: segment.number,
                  aircraft: {
                    code: segment.aircraft?.code || "320"
                  },
                  operating: {
                    carrierCode: segment.carrierCode
                  },
                  duration: segment.duration
                }))
              }
            ],
            price: flightOffer.price || {
              currency: "USD",
              total: "100.00",
              base: "100.00"
            },
            pricingOptions: {
              fareType: ["PUBLISHED"],
              includedCheckedBagsOnly: true
            },
            validatingAirlineCodes: flightOffer.validatingAirlineCodes || ["XX"],
            travelerPricings: [
              {
                travelerId: "1",
                fareOption: "STANDARD",
                travelerType: "ADULT",
                price: flightOffer.price || {
                  currency: "USD",
                  total: "100.00",
                  base: "100.00"
                },
                fareDetailsBySegment: [
                  {
                    segmentId: "1",
                    cabin: flightOffer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.cabin || "ECONOMY",
                    class: "Y"
                  }
                ]
              }
            ]
          }]
        };
      } else {
        throw new Error("Invalid flight offer format for seat map request");
      }

      logger.debug('[AmadeusService] Transformed flight offer for seat map request', {
        originalId: flightOffer.id,
        transformedData: transformedOffer
      });

      const response = await this.client.shopping.seatmaps.post(
        JSON.stringify(transformedOffer)
      );

      if (!response?.data?.[0]?.decks?.[0]?.seats?.length) {
        throw new Error('No seat map available for this flight');
      }

      const seatMap = response.data[0];
      const deck = seatMap.decks[0];
      const amenities = seatMap.aircraftCabinAmenities;

      // Process available seats
      const availableSeats = deck.seats.filter((seat: any) => {
        const status = seat.travelerPricing?.[0]?.seatAvailabilityStatus;
        return status !== 'BLOCKED' && status !== 'OCCUPIED';
      });

      // Process seat characteristics
      const processedSeats = deck.seats.map((seat: any) => ({
        number: seat.number,
        cabin: seat.cabin,
        characteristics: seat.characteristicsCodes,
        availability: seat.travelerPricing?.[0]?.seatAvailabilityStatus,
        coordinates: seat.coordinates,
        price: seat.travelerPricing?.[0]?.price
      }));

      const allSeatsUnavailable = availableSeats.length === 0;

      // Process amenities
      let processedAmenities = null;
      
      // If we have amenities data from Amadeus, process it
      if (amenities) {
        processedAmenities = {
          seat: amenities.seat ? {
            legSpace: amenities.seat.legSpace,
            spaceUnit: amenities.seat.spaceUnit,
            tilt: amenities.seat.tilt,
            images: amenities.seat.medias?.filter((media: any) => media.mediaType === 'image')
              .map((media: any) => ({
                title: media.title,
                url: media.href,
                description: media.description?.text
              }))
          } : null,
          power: amenities.power ? {
            isChargeable: amenities.power.isChargeable,
            powerType: amenities.power.powerType,
            usbType: amenities.power.usbType
          } : null,
          wifi: amenities.wifi ? {
            isChargeable: amenities.wifi.isChargeable,
            coverage: amenities.wifi.wifiCoverage
          } : null,
          food: amenities.food ? {
            isChargeable: amenities.food.isChargeable,
            type: amenities.food.foodType
          } : null,
          beverage: amenities.beverage ? {
            isChargeable: amenities.beverage.isChargeable,
            type: amenities.beverage.beverageType
          } : null
        };
      } else {
        // Create default amenities based on airline standards
        // This is a fallback when the API doesn't return amenity data
        const airlineCode = flightOffer.itineraries?.[0]?.segments?.[0]?.carrierCode;
        
        // Get cabin class from the booking class
        const cabinClass = flightOffer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.cabin || 'ECONOMY';
        
        // Default amenities based on cabin class and common airline standards
        processedAmenities = {
          seat: {
            legSpace: cabinClass === 'ECONOMY' ? '31' : (cabinClass === 'PREMIUM_ECONOMY' ? '38' : '42'),
            spaceUnit: 'INCHES',
            tilt: cabinClass === 'ECONOMY' ? 3 : 5
          },
          power: {
            isChargeable: false,
            powerType: cabinClass === 'ECONOMY' ? 'USB PORT' : 'AC POWER',
            usbType: 'USB-A'
          },
          wifi: {
            isChargeable: true,
            coverage: 'FULL FLIGHT'
          },
          food: {
            isChargeable: cabinClass === 'ECONOMY',
            type: cabinClass === 'ECONOMY' ? 'SNACK' : 'MEAL'
          },
          beverage: {
            isChargeable: cabinClass === 'ECONOMY',
            type: 'ALCOHOLIC AND NON-ALCOHOLIC'
          }
        };
      }

      logger.info('[AmadeusService] Processed seat map response', {
        flightId: flightOffer.id,
        totalSeats: deck.seats.length,
        availableSeats: availableSeats.length,
        hasAmenities: !!amenities,
        allSeatsUnavailable
      });

      // Create the response format that the frontend expects
      return {
        flightId: flightOffer.id,
        segments: [{
          deck: {
            seats: processedSeats,
            totalSeats: deck.seats.length,
            availableSeats: availableSeats.length,
            allSeatsUnavailable
          },
          amenities: processedAmenities
        }]
      };
    } catch (error) {
      const amadeusError = error as AmadeusError;
      
      logger.error('[AmadeusService] Error getting seat map', {
        error: {
          message: amadeusError.message,
          code: amadeusError.code,
          statusCode: amadeusError.response?.statusCode,
          details: amadeusError.response?.result?.errors?.[0]
        },
        flightOffer: {
          id: flightOffer.id,
          segments: flightOffer.itineraries?.[0]?.segments?.length
        }
      });

      if (amadeusError.response?.statusCode === 400) {
        const apiError = amadeusError.response?.result?.errors?.[0];
        throw new Error(apiError?.detail || apiError?.title || 'Invalid request format');
      }

      if (amadeusError.response?.statusCode === 401) {
        throw new Error('Authentication failed - please check your Amadeus API credentials');
      }

      if (amadeusError.response?.statusCode === 404) {
        throw new Error('Seat map not available for this flight');
      }

      throw new Error(amadeusError.description || amadeusError.message || 'Failed to retrieve seat map');
    }
  }

  async searchFlights(params: any): Promise<any> {
    if (!this.initialized) {
      this.initializeClient();
    }

    try {
      logger.info('[AmadeusService] Searching flights with Amadeus API', {
        segments: params.segments?.length || 0,
          travelClass: params.travelClass,
          adults: params.adults
        });

      // Check if required parameters are missing
      if (!params.segments || !Array.isArray(params.segments) || params.segments.length === 0) {
        logger.warn('[AmadeusService] Missing segments in flight search request', { params });
        return [];
      }

      const response = await this.client.shopping.flightOffersSearch.post(
        JSON.stringify({
          currencyCode: "USD",
          originDestinations: params.segments.map((segment: any, index: number) => ({
            id: String(index + 1),
            originLocationCode: segment.originLocationCode,
            destinationLocationCode: segment.destinationLocationCode,
            departureDateTimeRange: {
              date: segment.departureDate
            }
          })),
          travelers: Array(params.adults || 1).fill(null).map((_, index) => ({
            id: String(index + 1),
            travelerType: "ADULT"
          })),
          sources: ["GDS"],
          searchCriteria: {
            maxFlightOffers: params.max || 50,
            flightFilters: {
              cabinRestrictions: [
                {
                  cabin: params.travelClass || "ECONOMY",
                  coverage: "MOST_SEGMENTS",
                  originDestinationIds: ["1"]
                }
              ]
            }
          }
        })
      );

      // Process and return the flight offers with safety check
      const flightOffers = response?.data || [];
      
      logger.info('[AmadeusService] Flight search results', {
        totalFlights: flightOffers.length,
        travelClass: params.travelClass
      });

      return flightOffers;
      } catch (error) {
      const amadeusError = error as AmadeusError;
      
      logger.error('[AmadeusService] Error searching flights', {
        error: this.formatError(error),
        params
      });

      // Provide fallback mock data for test environment
      if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
        logger.info('[AmadeusService] Returning mock flight data in development/test environment');
        return this.getMockFlightOffers(params);
      }

      if (amadeusError.response?.statusCode === 400) {
        const apiError = amadeusError.response?.result?.errors?.[0];
        throw new Error(apiError?.detail || apiError?.title || 'Invalid flight search request');
      }

      if (amadeusError.response?.statusCode === 401) {
        throw new Error('Authentication failed - please check your Amadeus API credentials');
      }

      if (amadeusError.response?.statusCode === 429) {
        logger.warn('[AmadeusService] Rate limit exceeded, returning empty results');
        return [];
      }

      throw new Error(amadeusError.description || amadeusError.message || 'Failed to search flights');
    }
  }

  // Generate mock flight offers for testing/development
  private getMockFlightOffers(params: any): any[] {
    const mockFlights = [];
    const airlines = ['BA', 'LH', 'AF', 'DL', 'UA'];
    const aircraftTypes = ['320', '738', '777', '788', 'A350'];
    
    // Create 5 mock flight offers
    for (let i = 0; i < 5; i++) {
      const airline = airlines[Math.floor(Math.random() * airlines.length)];
      const aircraft = aircraftTypes[Math.floor(Math.random() * aircraftTypes.length)];
      const flightNumber = Math.floor(Math.random() * 1000) + 100;
      const basePrice = Math.floor(Math.random() * 500) + 300;
      const cabinPrice = params.travelClass === 'ECONOMY' ? basePrice : 
                          params.travelClass === 'PREMIUM_ECONOMY' ? basePrice * 1.5 : 
                          params.travelClass === 'BUSINESS' ? basePrice * 3 : 
                          basePrice * 5;

      const segments = params.segments.map((segment: any, index: number) => {
        // Calculate random flight duration (3-12 hours)
        const durationHours = Math.floor(Math.random() * 9) + 3;
        
        // Create random departure time
        const departureDate = new Date(segment.departureDate);
        departureDate.setHours(Math.floor(Math.random() * 24));
        
        // Calculate arrival time based on duration
        const arrivalDate = new Date(departureDate);
        arrivalDate.setHours(arrivalDate.getHours() + durationHours);

        return {
          id: String(index + 1),
          departure: {
            iataCode: segment.originLocationCode,
            terminal: String(Math.floor(Math.random() * 5) + 1),
            at: departureDate.toISOString()
          },
          arrival: {
            iataCode: segment.destinationLocationCode,
            terminal: String(Math.floor(Math.random() * 5) + 1),
            at: arrivalDate.toISOString()
          },
          carrierCode: airline,
          number: String(flightNumber),
          aircraft: {
            code: aircraft
          },
          operating: {
            carrierCode: airline
          },
          duration: `PT${durationHours}H`
        };
      });

      const price = {
        currency: 'USD',
        total: String(Math.round(cabinPrice)),
        base: String(Math.round(cabinPrice * 0.9)),
        fees: [
          {
            amount: String(Math.round(cabinPrice * 0.1)),
            type: 'SUPPLIER'
          }
        ],
        grandTotal: String(Math.round(cabinPrice))
      };

      mockFlights.push({
        type: 'flight-offer',
        id: String(i + 1),
        source: 'GDS',
        instantTicketingRequired: false,
        nonHomogeneous: false,
        oneWay: false,
        lastTicketingDate: '2025-12-31',
        numberOfBookableSeats: params.adults || 1,
        itineraries: [{ segments }],
        price,
        pricingOptions: {
          fareType: ['PUBLISHED'],
          includedCheckedBagsOnly: true
        },
        validatingAirlineCodes: [airline],
        travelerPricings: Array(params.adults || 1).fill(null).map((_, index) => ({
          travelerId: String(index + 1),
          fareOption: 'STANDARD',
          travelerType: 'ADULT',
          price,
          fareDetailsBySegment: segments.map((segment: any) => ({
            segmentId: segment.id,
            cabin: params.travelClass || 'ECONOMY',
            class: params.travelClass === 'ECONOMY' ? 'Y' : 
                  params.travelClass === 'PREMIUM_ECONOMY' ? 'W' : 
                  params.travelClass === 'BUSINESS' ? 'C' : 'F'
          }))
        }))
      });
    }
    
    return mockFlights;
  }

  async determineTier(flightOffer: any): Promise<string> {
    // Parse the tier from the fareDetailsBySegment if available
    if (flightOffer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.class) {
      const cabinClass = flightOffer.travelerPricings[0].fareDetailsBySegment[0].class;
      // Map cabin class to tier
      if (['F', 'A', 'P'].includes(cabinClass)) return 'FIRST';
      if (['J', 'C', 'D', 'I'].includes(cabinClass)) return 'BUSINESS';
      if (['W', 'S', 'Y'].includes(cabinClass)) return 'PREMIUM_ECONOMY';
      return 'ECONOMY';
    }
    
    // Fallback to brandedFare or cabin if available
    const brandedFare = flightOffer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.brandedFare;
    if (brandedFare) {
      if (brandedFare.includes('FIRST')) return 'FIRST';
      if (brandedFare.includes('BUSINESS')) return 'BUSINESS';
      if (brandedFare.includes('PREMIUM')) return 'PREMIUM_ECONOMY';
    }
    
    // Final fallback to cabin
    const cabin = flightOffer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.cabin;
    if (cabin) return cabin;
    
    return 'ECONOMY'; // Default
  }

  async searchLocations(query: string): Promise<any> {
    if (!this.initialized) {
      this.initializeClient();
    }

    try {
      logger.info('[AmadeusService] Searching locations', { query });
      
      const response = await this.client.referenceData.locations.get({
        keyword: query,
        subType: 'AIRPORT,CITY',
        page: { limit: 10 }
      });
      
      const locations = response.result.data.map((location: any) => ({
        id: location.id,
        name: location.name,
        iataCode: location.iataCode,
        address: location.address ? {
          cityName: location.address.cityName,
          countryName: location.address.countryName
        } : null
      }));
      
      logger.info('[AmadeusService] Found locations', { 
        query, 
        count: locations.length 
      });
      
      return locations;
      } catch (error) {
      logger.error('[AmadeusService] Error searching locations', { 
        error: this.formatError(error),
        query 
      });
      
      // Provide some fallback data for common searches
      const fallbackLocations: Record<string, any[]> = {
        'paris': [{
          id: 'PARI',
          name: 'Paris',
          iataCode: 'PAR',
          address: {
            cityName: 'Paris',
            countryName: 'France'
          }
        }],
        'london': [{
          id: 'LOND',
          name: 'London',
          iataCode: 'LON',
          address: {
            cityName: 'London',
            countryName: 'United Kingdom'
          }
        }],
        'new york': [{
          id: 'NYCA',
          name: 'New York',
          iataCode: 'NYC',
          address: {
            cityName: 'New York',
            countryName: 'United States'
          }
        }],
        'tokyo': [{
          id: 'TYOA',
          name: 'Tokyo',
          iataCode: 'TYO',
          address: {
            cityName: 'Tokyo',
            countryName: 'Japan'
          }
        }]
      };
      
      // Check if we have a fallback for this query
      const normalizedQuery = query.toLowerCase().trim();
      for (const [key, value] of Object.entries(fallbackLocations)) {
        if (key.includes(normalizedQuery) || normalizedQuery.includes(key)) {
          logger.info('[AmadeusService] Using fallback data for location search', { 
            query, 
            matchedKey: key 
          });
          return value;
        }
      }
      
      // If no fallback found, return empty array rather than throwing
      logger.info('[AmadeusService] No fallback data for location search', { query });
      return [];
    }
  }

  async getAirportCityNames(airportCodes: string[]): Promise<Record<string, string>> {
    if (!this.initialized) {
      this.initializeClient();
    }

    try {
      logger.info('[AmadeusService] Getting city names for airports', { 
        airportCodes, 
        count: airportCodes.length 
    });

    const result: Record<string, string> = {};
    
      // Process in batches to avoid API limits
    const batchSize = 5;
      for (let i = 0; i < airportCodes.length; i += batchSize) {
        const batch = airportCodes.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (code) => {
          try {
            const response = await this.client.referenceData.locations.get({
              keyword: code,
              subType: 'AIRPORT',
              page: { limit: 1 }
            });
            
            if (response.result.data && response.result.data.length > 0) {
              const airport = response.result.data[0];
              result[code] = airport.address?.cityName || 'Unknown';
            } else {
              result[code] = 'Unknown';
            }
          } catch (err) {
            logger.warn(`[AmadeusService] Failed to get city name for ${code}`, { 
              error: this.formatError(err)
            });
            result[code] = 'Unknown';
          }
        }));
        
        // Avoid rate limiting
        if (i + batchSize < airportCodes.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      return result;
    } catch (error) {
      logger.error('[AmadeusService] Error getting airport city names', { 
        error: this.formatError(error),
        airportCodes
      });
      
      // Return a default object with unknown values rather than throwing
      return airportCodes.reduce((acc, code) => {
        acc[code] = 'Unknown';
        return acc;
      }, {} as Record<string, string>);
    }
  }

  // ... rest of the AmadeusService class methods ...
} 