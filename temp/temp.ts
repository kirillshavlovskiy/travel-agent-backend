// @ts-ignore
import Amadeus from 'amadeus';
// @ts-ignore
import { logger } from '../utils/logger';
// @ts-ignore
import { AirlineInfo } from '../types';

export interface AmadeusHotelSearchParams {
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  roomQuantity: number;
  currency: string;
  radius: number;
  ratings: string;
}

export interface TransformedHotelOffer {
  id: string;
    name: string;
  location: {
    address: {
      lines?: string[];
      postalCode?: string;
      cityName?: string;
      countryName?: string;
      countryCode: string;
    };
    cityCode: string;
    coordinates?: {
      latitude: number;
      longitude: number;
    };
  };
  price: {
    amount: number;
    currency: string;
  };
  rating: string;
  amenities: string[];
  hotelChain: string;
  description: string;
  referenceUrl: string;
  directBooking: boolean;
  roomTypes: Array<{
    type: string;
    description: string;
    bedType: string;
    category: string;
    price: {
      amount: number;
      currency: string;
    };
  }>;
    policies: {
    checkIn: string;
    checkOut: string;
      cancellation: string;
    guarantee: string;
    deposit: string;
    prepayment: string;
  };
  contact: {
    phone: string;
    fax: string;
    email: string;
  };
  images: string[];
}

export interface AmadeusFlightSearchParams {
  originLocationCode: string;
  destinationLocationCode: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
  travelClass?: string;
  max?: number;
  currencyCode?: string;
  nonStop?: boolean;
}

export class AmadeusService {
  private amadeus: Amadeus;

  constructor() {
    const clientId = process.env.AMADEUS_CLIENT_ID;
    const clientSecret = process.env.AMADEUS_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Amadeus API credentials not configured');
    }

    this.amadeus = new Amadeus({
      clientId,
      clientSecret,
      hostname: 'test'
    });

    logger.info('Amadeus service initialized', {
      clientId: clientId ? 'set' : 'not set',
      clientSecret: clientSecret ? 'set' : 'not set'
    });
  }

  async searchHotels(params: AmadeusHotelSearchParams): Promise<TransformedHotelOffer[]> {
    try {
      // Validate and format dates
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(params.checkInDate) || !dateRegex.test(params.checkOutDate)) {
        throw new Error('Invalid date format. Use YYYY-MM-DD');
      }

      const checkIn = new Date(params.checkInDate);
      const checkOut = new Date(params.checkOutDate);
      const now = new Date();
      
      // Set time to midnight for proper comparison
      now.setHours(0, 0, 0, 0);
      checkIn.setHours(0, 0, 0, 0);
      checkOut.setHours(0, 0, 0, 0);
      
      if (checkIn < now) {
        throw new Error('Check-in date must be in the future');
      }
      
      if (checkOut <= checkIn) {
        throw new Error('Check-out date must be after check-in date');
      }

      logger.info('Searching for hotels with params', {
        ...params,
        checkInDate: params.checkInDate,
        checkOutDate: params.checkOutDate
      });

      // First, get hotels in the city with amenities and ratings
      const hotelsResponse = await this.amadeus.client.get(
        '/v1/reference-data/locations/hotels/by-city',
        {
          cityCode: params.cityCode,
          radius: 10,
          radiusUnit: 'KM',
          hotelSource: 'ALL',
          ratings: '1,2,3,4,5',
          amenities: 'SWIMMING_POOL,RESTAURANT,PARKING,WIFI,FITNESS_CENTER,SPA,BUSINESS_CENTER'
        }
      );

      logger.info('Hotels in city found', {
        count: hotelsResponse.data ? hotelsResponse.data.length : 0
      });

      if (!hotelsResponse.data || hotelsResponse.data.length === 0) {
        return [];
      }

      const hotels = hotelsResponse.data.slice(0, 100);
      const hotelOffers: TransformedHotelOffer[] = [];
      let validOffersCount = 0;
      let rateLimitHits = 0;
      const maxRateLimitRetries = 3;

      for (const hotel of hotels) {
        try {
          if (rateLimitHits >= maxRateLimitRetries) {
            logger.info('Taking a break due to rate limits', { rateLimitHits });
            await new Promise(resolve => setTimeout(resolve, 2000));
            rateLimitHits = 0;
          }

          logger.info('Fetching offers for hotel', {
            hotelId: hotel.hotelId,
            name: hotel.name,
            chainCode: hotel.chainCode
          });

          const offersResponse = await this.amadeus.client.get(
            '/v3/shopping/hotel-offers',
            {
              hotelIds: hotel.hotelId,
              adults: params.adults,
              checkInDate: params.checkInDate,
              checkOutDate: params.checkOutDate,
              roomQuantity: params.roomQuantity,
              priceRange: '100-5000',
              currency: params.currency,
              paymentPolicy: 'NONE',
              view: 'FULL'
            }
          );

          logger.info('Raw hotel offers response', {
            hotelId: hotel.hotelId,
            name: hotel.name,
            chainCode: hotel.chainCode,
            rawResponse: {
              data: offersResponse.data,
              dictionaries: offersResponse.dictionaries
            }
          });

          if (offersResponse.data && offersResponse.data.length > 0) {
            const hotelData = offersResponse.data[0];
            const price = hotelData.offers?.[0]?.price;
            
            if (price && price.total) {
              const amenities = [
                ...(hotel.amenities || []),
                ...(hotelData.hotel?.amenities || [])
              ].filter((v, i, a) => a.indexOf(v) === i);

              const transformedOffer = {
                id: hotel.hotelId,
                name: hotel.name,
                location: {
                  address: {
                    ...hotel.address,
                    lines: hotelData.hotel?.address?.lines,
                    postalCode: hotelData.hotel?.address?.postalCode,
                    cityName: hotelData.hotel?.address?.cityName,
                    countryName: hotelData.hotel?.address?.countryName
                  },
                  cityCode: params.cityCode,
                  coordinates: hotel.geoCode
                },
                price: {
                  amount: parseFloat(price.total),
                  currency: price.currency || params.currency
                },
                rating: hotel.rating,
                amenities,
                hotelChain: hotel.chainCode,
                description: hotelData.hotel?.description?.text || '',
                referenceUrl: hotelData.hotel?.self,
                directBooking: true,
                roomTypes: (hotelData.offers || []).map((offer: any) => ({
                  type: offer.room?.type || 'Standard',
                  description: offer.room?.description?.text || '',
                  bedType: offer.room?.typeEstimated?.bedType || '',
                  category: offer.room?.category || '',
                  price: {
                    amount: parseFloat(offer.price?.total || '0'),
                    currency: offer.price?.currency || params.currency
                  }
                })),
                policies: {
                  checkIn: hotelData.offers?.[0]?.policies?.checkInTime || '',
                  checkOut: hotelData.offers?.[0]?.policies?.checkOutTime || '',
                  cancellation: hotelData.offers?.[0]?.policies?.cancellations?.[0]?.description?.text || '',
                  guarantee: hotelData.offers?.[0]?.policies?.guarantee?.description?.text || '',
                  deposit: hotelData.offers?.[0]?.policies?.deposit?.description?.text || '',
                  prepayment: hotelData.offers?.[0]?.policies?.prepayment?.description?.text || ''
                },
                contact: {
                  phone: hotelData.hotel?.contact?.phone || '',
                  fax: hotelData.hotel?.contact?.fax || '',
                  email: hotelData.hotel?.contact?.email || ''
                },
                images: hotelData.hotel?.media?.map((media: any) => media.uri) || []
              };

              logger.info('Successfully transformed hotel offer', {
                hotelId: hotel.hotelId,
                name: hotel.name,
                chainCode: hotel.chainCode,
                rawOffer: hotelData,
                transformedOffer,
                offerDetails: {
                  price: {
                    total: price.total,
                    currency: price.currency,
                    variations: price.variations,
                    markups: price.markups
                  },
                  roomDetails: hotelData.offers?.map((offer: any) => ({
                    type: offer.room?.type,
                    description: offer.room?.description?.text,
                    bedType: offer.room?.typeEstimated?.bedType,
                    category: offer.room?.category
                  })),
                  policies: hotelData.offers?.[0]?.policies,
                  amenities: amenities,
                  contact: hotelData.hotel?.contact,
                  media: hotelData.hotel?.media
                }
              });

              hotelOffers.push(transformedOffer);
              validOffersCount++;

              if (validOffersCount >= 10) {
                break;
              }
            }
          }
        } catch (error: any) {
          const errorCode = error.response?.result?.errors?.[0]?.code;
          const errorDetail = error.response?.result?.errors?.[0]?.detail;

          if (errorCode === 38194) {
            rateLimitHits++;
          }

          logger.error('Failed to get offers for hotel', {
            hotelId: hotel.hotelId,
            errorCode,
            errorDetail,
            fullError: error.response?.result
          });
          continue;
        }
      }

      logger.info('Hotel offers found', {
        count: hotelOffers.length,
        searchedHotels: hotels.length,
        offers: hotelOffers
      });

      return hotelOffers;
    } catch (error: unknown) {
      logger.error('Failed to search for hotels', {
        error,
        params,
        response: (error as any).response?.data || 'No response data',
        fullError: error
      });
      throw error;
    }
  }

  async searchFlights(params: AmadeusFlightSearchParams) {
    try {
      logger.info('Starting flight search with params', {
        ...params,
        clientId: this.amadeus ? 'set' : 'not set'
      });

      // Convert params to match Amadeus API format
      const searchParams = {
        originLocationCode: params.originLocationCode,
        destinationLocationCode: params.destinationLocationCode,
        departureDate: params.departureDate,
        returnDate: params.returnDate,
        adults: params.adults,
        travelClass: params.travelClass || 'ECONOMY',
        max: params.max || 25,
        currencyCode: params.currencyCode || 'USD',
        nonStop: params.nonStop || false
      };

      const response = await this.amadeus.shopping.flightOffersSearch.get(searchParams);

      logger.info('Flight search successful', {
        flightCount: response.data ? response.data.length : 0,
        sampleFlight: response.data?.[0] ? {
          price: response.data[0].price,
          itineraries: response.data[0].itineraries.map((it: any) => ({
            segments: it.segments.map((seg: any) => ({
              departure: seg.departure,
              arrival: seg.arrival,
              carrierCode: seg.carrierCode,
              aircraft: seg.aircraft
            }))
          })),
          travelerPricings: response.data[0].travelerPricings
        } : null,
        dictionaries: response.dictionaries
      });

      return response.data || [];
    } catch (error: unknown) {
      logger.error('Failed to search for flights', {
        error,
        params,
        response: (error as any).response?.data || 'No response data',
        fullError: error
      });
      throw error;
    }
  }

  determineTier(price: number, cabinClass: string): 'budget' | 'medium' | 'premium' {
    // First check cabin class
    if (cabinClass === 'FIRST' || cabinClass === 'BUSINESS') {
      return 'premium';
    } else if (cabinClass === 'PREMIUM_ECONOMY') {
      return 'medium';
    }

    // Then check price ranges for economy
    if (price <= 1000) {
      return 'budget';
    } else if (price <= 2000) {
      return 'medium';
    } else {
      return 'premium';
    }
  }

  async getAirlineInfo(airlineCodes: string | string[]): Promise<AirlineInfo[]> {
    try {
      const codes = Array.isArray(airlineCodes) ? airlineCodes : [airlineCodes];
      const uniqueCodes = [...new Set(codes)];

      const response = await this.amadeus.client.get(
        '/v1/reference-data/airlines',
        { airlineCodes: uniqueCodes.join(',') }
      );

      if (!response.data) {
        return uniqueCodes.map(code => ({ commonName: code }));
      }

      return response.data.map((airline: any) => ({
        type: airline.type,
        iataCode: airline.iataCode,
        icaoCode: airline.icaoCode,
        businessName: airline.businessName,
        commonName: airline.commonName || airline.businessName || airline.iataCode
      }));
    } catch (error) {
      logger.error('Failed to fetch airline information', {
        error,
        airlineCodes
      });
      // Return basic info using the codes as fallback
      return (Array.isArray(airlineCodes) ? airlineCodes : [airlineCodes])
        .map(code => ({ commonName: code }));
    }
  }

  calculateTotalDuration(segments: any[]): string {
    const totalMinutes = segments.reduce((total, segment) => {
      const durationStr = segment.duration || '0';
      const minutes = parseInt(durationStr.replace(/[^0-9]/g, ''), 10) || 0;
      return total + minutes;
    }, 0);

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
  }

  generateBookingUrl(offer: any): string {
    const firstSegment = offer.itineraries[0].segments[0];
    const lastSegment = offer.itineraries[0].segments[offer.itineraries[0].segments.length - 1];
    
    return `https://www.amadeus.com/flights/${firstSegment.departure.iataCode}-${lastSegment.arrival.iataCode}/${firstSegment.departure.at.split('T')[0]}`;
  }
} 