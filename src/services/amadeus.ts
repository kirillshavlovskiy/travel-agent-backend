import Amadeus from 'amadeus';
import { logger } from '../utils/logger.js';

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

interface AmadeusResponse<T> {
  data: T[];
  dictionaries?: Record<string, any>;
}

interface AmadeusHotel {
  hotelId: string;
  name: string;
  chainCode: string;
  geoCode: {
    latitude: number;
    longitude: number;
  };
  address: {
    lines?: string[];
    postalCode?: string;
    cityName?: string;
    countryName?: string;
    countryCode: string;
  };
  amenities?: string[];
  rating?: string;
}

interface AmadeusHotelOffer {
  hotel: {
    hotelId: string;
    name: string;
    chainCode: string;
    self?: string;
    address?: {
      lines?: string[];
      postalCode?: string;
      cityName?: string;
      countryName?: string;
    };
    amenities?: string[];
    description?: {
      text: string;
    };
    media?: Array<{
      uri: string;
    }>;
    contact?: {
      phone?: string;
      fax?: string;
      email?: string;
    };
  };
  offers?: Array<{
    room?: {
      type?: string;
      description?: {
        text: string;
      };
      typeEstimated?: {
        bedType: string;
      };
      category?: string;
    };
    price?: {
      total: string;
      currency: string;
      variations?: any;
      markups?: any;
    };
    policies?: {
      checkInTime?: string;
      checkOutTime?: string;
      cancellations?: Array<{
        description?: {
          text: string;
        };
      }>;
      guarantee?: {
        description?: {
          text: string;
        };
      };
      deposit?: {
        description?: {
          text: string;
        };
      };
      prepayment?: {
        description?: {
          text: string;
        };
      };
    };
  }>;
}

export class AmadeusService {
  private amadeus: Amadeus;
  private rateLimitQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue = false;
  private lastRequestTime = 0;
  private readonly MIN_REQUEST_INTERVAL = 1000; // 1 second between requests
  private readonly MAX_RETRIES = 3;
  private readonly RATE_LIMIT_DELAY = 2000; // 2 seconds

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

  private async executeWithRetry<T>(operation: () => Promise<T>, retryCount = 0): Promise<T> {
    try {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      
      if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
        await new Promise(resolve => setTimeout(resolve, this.MIN_REQUEST_INTERVAL - timeSinceLastRequest));
      }
      
      this.lastRequestTime = Date.now();
      return await operation();
    } catch (error: any) {
      const errorCode = error.response?.result?.errors?.[0]?.code;
      const errorDetail = error.response?.result?.errors?.[0]?.detail;
      
      // Handle rate limiting
      if (errorCode === 38194 || errorDetail?.includes('rate limit')) {
        if (retryCount < this.MAX_RETRIES) {
          logger.info('Rate limit hit, retrying after delay', {
            retryCount,
            delay: this.RATE_LIMIT_DELAY * Math.pow(2, retryCount)
          });
          
          await new Promise(resolve => 
            setTimeout(resolve, this.RATE_LIMIT_DELAY * Math.pow(2, retryCount))
          );
          
          return this.executeWithRetry(operation, retryCount + 1);
        }
      }
      
      throw error;
    }
  }

  private async addToRateLimitQueue<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.rateLimitQueue.push(async () => {
        try {
          const result = await this.executeWithRetry(operation);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.isProcessingQueue || this.rateLimitQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.rateLimitQueue.length > 0) {
      const operation = this.rateLimitQueue.shift();
      if (operation) {
        await operation();
        await new Promise(resolve => setTimeout(resolve, this.MIN_REQUEST_INTERVAL));
      }
    }

    this.isProcessingQueue = false;
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
      const hotelsResponse = await this.addToRateLimitQueue<AmadeusResponse<AmadeusHotel>>(() => 
        this.amadeus.client.get('/v1/reference-data/locations/hotels/by-city', {
          cityCode: params.cityCode,
          radius: 10,
          radiusUnit: 'KM',
          hotelSource: 'ALL',
          ratings: '1,2,3,4,5',
          amenities: 'SWIMMING_POOL,RESTAURANT,PARKING,WIFI,FITNESS_CENTER,SPA,BUSINESS_CENTER'
        })
      );

      logger.info('Hotels in city found', {
        count: hotelsResponse.data ? hotelsResponse.data.length : 0
      });

      if (!hotelsResponse.data || hotelsResponse.data.length === 0) {
        return [];
      }

      const hotels = hotelsResponse.data.slice(0, 20); // Limit to 20 hotels to avoid rate limits
      const hotelOffers: TransformedHotelOffer[] = [];
      let validOffersCount = 0;

      for (const hotel of hotels) {
        try {
          logger.info('Fetching offers for hotel', {
            hotelId: hotel.hotelId,
            name: hotel.name,
            chainCode: hotel.chainCode
          });

          const offersResponse = await this.addToRateLimitQueue<AmadeusResponse<AmadeusHotelOffer>>(() =>
            this.amadeus.client.get('/v3/shopping/hotel-offers', {
              hotelIds: hotel.hotelId,
              adults: params.adults,
              checkInDate: params.checkInDate,
              checkOutDate: params.checkOutDate,
              roomQuantity: params.roomQuantity,
              priceRange: '100-5000',
              currency: params.currency,
              paymentPolicy: 'NONE',
              bestRateOnly: true,
              view: 'FULL'
            })
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

              const transformedOffer: TransformedHotelOffer = {
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
                rating: hotel.rating || '0',
                amenities,
                hotelChain: hotel.chainCode,
                description: hotelData.hotel?.description?.text || '',
                referenceUrl: hotelData.hotel?.self || '',
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
} 