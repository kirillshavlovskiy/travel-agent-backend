import Amadeus from 'amadeus';
import { logger } from '../utils/logger';

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
    checkInDate: string;
    checkOutDate: string;
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
    const checkOut = new Date(checkOutDate);
    
    // Log validation details
    logger.info('Validating dates', {
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString(),
      today: today.toISOString()
    });

    if (checkIn < today) {
      logger.warn('Check-in date is in the past', {
        checkIn: checkIn.toISOString(),
        today: today.toISOString()
      });
      return false;
    }

    if (checkOut <= checkIn) {
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
      this.validateDates(params.checkInDate, params.checkOutDate);

      logger.info('Starting hotel search with params:', {
        cityCode: params.cityCode,
        checkInDate: params.checkInDate,
        checkOutDate: params.checkOutDate,
        adults: params.adults,
        roomQuantity: params.roomQuantity,
        radius: params.radius || 50,
        currency: params.currency
      });

      const hotelsResponse = await this.amadeus.client.get(
        '/v1/reference-data/locations/hotels/by-city',
        {
          cityCode: params.cityCode,
          radius: params.radius || 50,
          radiusUnit: 'KM',
          hotelSource: 'ALL'
        }
      );

      const hotels = JSON.parse(hotelsResponse.body);
      if (!hotels.data || hotels.data.length === 0) {
        logger.info('No hotels found in city', { cityCode: params.cityCode });
        return [];
      }

      logger.info(`Found ${hotels.data.length} hotels in ${params.cityCode}`, {
        firstHotel: hotels.data[0]?.name,
        lastHotel: hotels.data[hotels.data.length - 1]?.name
      });

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

        logger.info(`Processing batch ${batchNumber}/${totalBatches}`, {
          batchSize: batch.length,
          hotelIds: hotelIds.join(',')
        });

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
            logger.info(`Processing offers from batch ${batchNumber}`, {
              totalOffers: offers.data.length,
              batchSize: batch.length
            });

            offers.data.forEach((offer: AmadeusHotelOffer) => {
              logger.info('Processing hotel offer:', {
                hotelId: offer.hotel.hotelId,
                hotelName: offer.hotel.name,
                available: offer.available,
                hasOffers: offer.offers?.length > 0,
                lowestPrice: offer.offers?.[0]?.price?.total,
                currency: offer.offers?.[0]?.price?.currency
              });

              if (offer.available !== false) {
                const hotelData = hotels.data.find((h: AmadeusHotel) => h.hotelId === offer.hotel.hotelId);
                if (hotelData) {
                  hotelOffers.push({
                    ...offer,
                    hotel: {
                      ...offer.hotel,
                      ...hotelData
                    }
                  });
                }
              } else {
                logger.info(`Hotel ${offer.hotel.hotelId} (${offer.hotel.name}) is not available for the selected dates`);
              }
            });
          }
        } catch (error) {
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

      logger.info('Hotel search completed', {
        cityCode: params.cityCode,
        totalHotelsFound: hotels.data.length,
        availableHotels: hotelOffers.length,
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
    const results: HotelSearchResult[] = [];
    logger.info('Starting multi-destination hotel search', {
      destinations: params.destinations.map(d => ({
        cityCode: d.cityCode,
        dates: `${d.checkInDate} to ${d.checkOutDate}`
      })),
      adults: params.adults,
      roomQuantity: params.roomQuantity
    });

    for (const destination of params.destinations) {
      try {
        this.validateDates(destination.checkInDate, destination.checkOutDate);

        logger.info('Searching hotels for destination:', {
          cityCode: destination.cityCode,
          checkInDate: destination.checkInDate,
          checkOutDate: destination.checkOutDate
        });

        const hotels = await this.searchHotels({
          cityCode: destination.cityCode,
          checkInDate: destination.checkInDate,
          checkOutDate: destination.checkOutDate,
          adults: params.adults,
          roomQuantity: params.roomQuantity,
          radius: params.radius,
          ratings: params.ratings,
          currency: params.currency,
          amenities: params.amenities
        });

        logger.info('Search completed for destination', {
          cityCode: destination.cityCode,
          hotelsFound: hotels.length,
          dateRange: `${destination.checkInDate} to ${destination.checkOutDate}`
        });

        results.push({
          cityCode: destination.cityCode,
          checkInDate: destination.checkInDate,
          checkOutDate: destination.checkOutDate,
          hotels
        });

        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        logger.error('Error searching hotels for destination:', {
          cityCode: destination.cityCode,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          response: (error as any)?.response?.body
        });
        continue;
      }
    }

    logger.info('Multi-destination search completed', {
      totalDestinations: params.destinations.length,
      destinationsWithHotels: results.length,
      totalHotelsFound: results.reduce((sum, r) => sum + r.hotels.length, 0),
      summary: results.map(r => ({
        cityCode: r.cityCode,
        hotelsFound: r.hotels.length,
        dateRange: `${r.checkInDate} to ${r.checkOutDate}`
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