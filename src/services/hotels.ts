import Amadeus from 'amadeus';
import { logger, logHotelProcessing } from '../utils/logger';

export interface HotelSearchParams {
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  adults?: number;
  roomQuantity?: number;
  radius?: number;
  ratings?: string;
  currency?: string;
  amenities?: string[];
}

interface AmadeusHotel {
  chainCode: string;
  iataCode: string;
  dupeId: number;
  name: string;
  hotelId: string;
  geoCode: {
    latitude: number;
    longitude: number;
  };
  address: {
    countryCode: string;
  };
  distance: {
    value: number;
    unit: string;
  };
  amenities: string[];
  lastUpdate: string;
}

interface AmadeusHotelOffer {
  type?: string;
  available?: boolean;
  hotel: AmadeusHotel & {
    [key: string]: any;
  };
  offers: Array<{
    id: string;
    checkInDate: string;
    checkOutDate: string;
    rateCode: string;
    rateFamilyEstimated: {
      code: string;
      type: string;
    };
    room: {
      type: string;
      typeEstimated: {
        category: string;
        beds: number;
        bedType: string;
      };
    };
    guests: {
      adults: number;
    };
    price: {
      currency: string;
      total: string;
      variations: {
        average: {
          total: string;
        };
      };
    };
    policies: {
      cancellation: {
        description: {
          text: string;
        };
      };
    };
  }>;
  self: string;
}

export interface MultiDestinationHotelSearchParams {
  destinations: {
    cityCode: string;
    arrivalDate: string;
    departureDate: string;
  }[];
  adults?: number;
  roomQuantity?: number;
  radius?: number;
  ratings?: string;
  currency?: string;
  amenities?: string[];
}

export interface HotelSearchResult {
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  hotels: AmadeusHotelOffer[];
}

export class HotelService {
  private amadeus: any;
  private readonly MIN_ADVANCE_DAYS = 1;
  private readonly MAX_ADVANCE_DAYS = 365;

  constructor() {
    const clientId = process.env.AMADEUS_CLIENT_ID;
    const clientSecret = process.env.AMADEUS_CLIENT_SECRET;

    logger.info('Initializing Amadeus client for hotel service', {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret
    });

    if (!clientId || !clientSecret) {
      const error = new Error('Missing Amadeus API credentials');
      logger.error('Failed to initialize Amadeus client for hotel service', { error });
      throw error;
    }

    try {
      this.amadeus = new Amadeus({
        clientId,
        clientSecret,
        logLevel: 'debug'
      });

      logger.info('Amadeus client initialized successfully for hotel service');
    } catch (error) {
      logger.error('Failed to initialize Amadeus client for hotel service', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  private validateDates(checkInDate: string, checkOutDate: string): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const checkIn = new Date(checkInDate);
    checkIn.setHours(0, 0, 0, 0);
    
    const checkOut = new Date(checkOutDate);
    checkOut.setHours(0, 0, 0, 0);
    
    // Log validation details
    logger.info('Validating dates', {
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString(),
      today: today.toISOString()
    });

    // Compare dates without time
    const checkInTime = checkIn.getTime();
    const todayTime = today.getTime();
    const checkOutTime = checkOut.getTime();

    if (checkInTime < todayTime) {
      logger.warn('Check-in date is in the past', {
        checkIn: checkIn.toISOString(),
        today: today.toISOString()
      });
      return false;
    }

    if (checkOutTime <= checkInTime) {
      logger.warn('Check-out date must be after check-in date', {
        checkIn: checkIn.toISOString(),
        checkOut: checkOut.toISOString()
      });
      return false;
    }

    return true;
  }

  async searchHotels(params: HotelSearchParams): Promise<AmadeusHotelOffer[]> {
    try {
      logger.info('Starting hotel search', { params });

      // First, get hotels in the city
      const hotelsResponse = await this.amadeus.client.get('/v1/reference-data/locations/hotels/by-city', {
        cityCode: params.cityCode,
        radius: params.radius || 50,
        radiusUnit: 'KM',
        hotelSource: 'ALL'
      });

      const hotels = JSON.parse(hotelsResponse.body);

      logHotelProcessing.searchSummary({
        totalHotelsFound: hotels.data?.length || 0,
        availableHotels: 0, // Will be updated after getting offers
        destinations: [params.cityCode],
        dateRange: `${params.checkInDate} to ${params.checkOutDate}`
      });

      if (!hotels.data || hotels.data.length === 0) {
        logger.info('No hotels found in city', { cityCode: params.cityCode });
        return [];
      }

      const hotelOffers: AmadeusHotelOffer[] = [];
      const batchSize = 25;
      const maxHotels = 100;
      const totalBatches = Math.ceil(Math.min(hotels.data.length, maxHotels) / batchSize);
      
      logger.info('Starting hotel offers search', {
        totalHotels: Math.min(hotels.data.length, maxHotels),
        batchSize,
        totalBatches
      });
      
      for (let i = 0; i < Math.min(hotels.data.length, maxHotels); i += batchSize) {
        const batch = hotels.data.slice(i, i + batchSize);
        const hotelIds = batch.map((hotel: AmadeusHotel) => hotel.hotelId);
        const batchNumber = Math.floor(i / batchSize) + 1;

        logHotelProcessing.batchStart(batchNumber, hotelIds);

        try {
          const offerResponse = await this.amadeus.client.get('/v3/shopping/hotel-offers', {
            hotelIds: hotelIds.join(','),
            adults: params.adults?.toString() || '1',
            checkInDate: params.checkInDate,
            checkOutDate: params.checkOutDate,
            roomQuantity: params.roomQuantity?.toString() || '1',
            currency: params.currency || 'USD'
          });

          const offers = JSON.parse(offerResponse.body);
          
          if (offers.warnings) {
            offers.warnings.forEach((warning: any) => {
              logger.warn('Hotel offer warning:', {
                ...warning,
                batch: batchNumber,
                affectedHotels: warning.source?.parameter
              });
            });
          }

          if (offers.data) {
            offers.data.forEach((offer: AmadeusHotelOffer) => {
              if (offer.available && offer.offers?.length > 0) {
                logHotelProcessing.hotelFound({
                  id: offer.hotel.hotelId,
                  name: offer.hotel.name,
                  offers: offer.offers
                });

                const hotelData = hotels.data.find((h: AmadeusHotel) => h.hotelId === offer.hotel.hotelId);
                if (hotelData) {
                  hotelOffers.push({
                    ...offer,
                    hotel: {
                      ...offer.hotel,
                      ...hotelData
                    }
                  });
                } else {
                  hotelOffers.push(offer);
                }
              }
            });
          }
        } catch (error) {
          logHotelProcessing.batchError(batchNumber, error);
          logger.error('Error getting hotel offers for batch:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            batch: batchNumber,
            hotelIds: hotelIds.join(','),
            response: (error as any)?.response?.body
          });
          continue;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Update search summary with available hotels count
      logHotelProcessing.searchSummary({
        totalHotelsFound: hotels.data.length,
        availableHotels: hotelOffers.length,
        destinations: [params.cityCode],
        dateRange: `${params.checkInDate} to ${params.checkOutDate}`
      });

      return hotelOffers;

    } catch (error) {
      logger.error('Error searching hotels:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        params,
        response: (error as any)?.response?.body
      });
      throw error;
    }
  }

  async searchHotelsMultiDestination(params: MultiDestinationHotelSearchParams): Promise<HotelSearchResult[]> {
    logger.info('Starting multi-destination hotel search', {
      destinations: params.destinations.map(d => ({
        cityCode: d.cityCode,
        dates: `${d.arrivalDate} to ${d.departureDate}`
      })),
      adults: params.adults,
      roomQuantity: params.roomQuantity
    });

    const results: HotelSearchResult[] = [];

    for (const d of params.destinations) {
      try {
        // Validate dates for this destination
        const datesValid = this.validateDates(d.arrivalDate, d.departureDate);
        if (!datesValid) {
          logger.error('Invalid dates for destination', {
            cityCode: d.cityCode,
            arrivalDate: d.arrivalDate,
            departureDate: d.departureDate
          });
          continue;
        }

        const hotels = await this.searchHotels({
          cityCode: d.cityCode,
          checkInDate: d.arrivalDate,
          checkOutDate: d.departureDate,
          adults: params.adults,
          roomQuantity: params.roomQuantity,
          radius: params.radius,
          ratings: params.ratings,
          currency: params.currency,
          amenities: params.amenities
        });

        if (hotels.length > 0) {
          results.push({
            cityCode: d.cityCode,
            checkInDate: d.arrivalDate,
            checkOutDate: d.departureDate,
            hotels
          });
        }
      } catch (error) {
        logger.error('Error searching hotels for destination:', {
          cityCode: d.cityCode,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined
        });
      }
    }

    logger.info('Multi-destination search completed', {
      totalDestinations: params.destinations.length,
      destinationsWithHotels: results.length,
      totalHotelsFound: results.reduce((sum, result) => sum + result.hotels.length, 0),
      summary: results.map(result => ({
        cityCode: result.cityCode,
        hotelCount: result.hotels.length
      }))
    });

    return results;
  }

  async confirmHotelOffer(offerId: string) {
    try {
      logger.info('Confirming hotel offer', { offerId });

      const response = await this.amadeus.client.get(`/v3/shopping/hotel-offers/${offerId}`);

      logger.info('Offer confirmation response:', {
        status: response?.statusCode,
        body: response?.body
      });

      const result = JSON.parse(response.body);
      return result.data || null;

    } catch (error) {
      logger.error('Error confirming hotel offer:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        response: (error as any)?.response?.data
      });
      throw error;
    }
  }

  async bookHotel(offerId: string, guests: any[], payments: any[]) {
    try {
      logger.info('Booking hotel', { offerId, guests, payments });

      const response = await this.amadeus.client.post('/v1/booking/hotel-bookings', {
        data: {
          offerId,
          guests,
          payments
        }
      });

      logger.info('Booking response:', {
        status: response?.statusCode,
        body: response?.body
      });

      const result = JSON.parse(response.body);
      return result.data || null;

    } catch (error) {
      logger.error('Error booking hotel:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        response: (error as any)?.response?.data
      });
      throw error;
    }
  }

  private adjustCheckoutDate(date: string, time?: string): string {
    if (!time) return date;

    const [hours, minutes] = time.split(':').map(Number);
    const departureDate = new Date(date);
    
    if (hours < 3) {
      departureDate.setDate(departureDate.getDate() - 1);
    }

    return departureDate.toISOString().split('T')[0];
  }

  createSearchPlan(destinations: Array<{
    cityCode: string;
    arrivalDate: string;
    arrivalTime?: string;
    departureDate: string;
    departureTime?: string;
  }>): Array<{
    cityCode: string;
    checkInDate: string;
    checkOutDate: string;
  }> {
    return destinations.map((destination) => {
      const checkInDate = destination.arrivalDate;
      const checkOutDate = this.adjustCheckoutDate(
        destination.departureDate,
        destination.departureTime
      );

      return {
        cityCode: destination.cityCode,
        checkInDate,
        checkOutDate
      };
    });
  }
} 