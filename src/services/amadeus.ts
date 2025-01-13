import axios from 'axios';
import { 
  AmadeusFlightOffer, 
  FlightReference, 
  AmadeusHotelOffer, 
  TransformedHotelOffer,
  HotelSearchParams 
} from '../types.js';
import { logToFile } from '../utils/logger.js';

const AIRCRAFT_CODES: { [key: string]: string } = {
  '319': 'Airbus A319',
  '320': 'Airbus A320',
  '321': 'Airbus A321',
  '32A': 'Airbus A320',
  '32B': 'Airbus A321',
  '32Q': 'Airbus A321neo',
  '32S': 'Airbus A321',
  '32N': 'Airbus A321neo',
  '333': 'Airbus A330-300',
  '359': 'Airbus A350-900',
  '388': 'Airbus A380-800',
  '738': 'Boeing 737-800',
  '73H': 'Boeing 737-800',
  '744': 'Boeing 747-400',
  '767': 'Boeing 767',
  '777': 'Boeing 777',
  '772': 'Boeing 777-200',
  '77W': 'Boeing 777-300ER',
  '787': 'Boeing 787 Dreamliner',
  '788': 'Boeing 787-8 Dreamliner',
  '789': 'Boeing 787-9 Dreamliner',
  'E90': 'Embraer E190',
  'E95': 'Embraer E195',
  'CR9': 'Bombardier CRJ-900',
  'CRJ': 'Bombardier CRJ',
  'DH4': 'Bombardier Q400',
  'AT7': 'ATR 72',
  'AT5': 'ATR 42',
  'E75': 'Embraer E175',
  'E70': 'Embraer E170',
  'A20N': 'Airbus A320neo',
  'A21N': 'Airbus A321neo',
  'B38M': 'Boeing 737 MAX 8',
  'B39M': 'Boeing 737 MAX 9',
  'A339': 'Airbus A330-900neo',
  'A359': 'Airbus A350-900',
  'A35K': 'Airbus A350-1000',
  'B78X': 'Boeing 787-10 Dreamliner',
  '7M9': 'Boeing 737 MAX 9'
};

interface FlightSegment {
  airline: string;
  flightNumber: string;
  aircraft: {
    code: string;
    name: string;
  };
  departure: {
    airport: string;
    terminal?: string;
    time: string;
  };
  arrival: {
    airport: string;
    terminal?: string;
    time: string;
  };
  duration: string;
  cabinClass: string;
}

interface FlightDetails {
  airline: string;
  route: string;
  duration: string;
  layovers: number;
  outbound: string;
  inbound: string;
  price: {
    amount: number;
    currency: string;
    numberOfTravelers: number;
  };
  tier: 'budget' | 'medium' | 'premium';
  flightNumber: string;
  referenceUrl: string;
  cabinClass: string;
  details: {
    price: {
      amount: number;
      currency: string;
      numberOfTravelers: number;
    };
    outbound: {
      departure: {
        airport: string;
        terminal?: string;
        time: string;
      };
      arrival: {
        airport: string;
        terminal?: string;
        time: string;
      };
      duration: string;
      segments: FlightSegment[];
    };
    inbound: {
      departure: {
        airport: string;
        terminal?: string;
        time: string;
      };
      arrival: {
        airport: string;
        terminal?: string;
        time: string;
      };
      duration: string;
      segments: FlightSegment[];
    };
    bookingClass: string;
    fareBasis: string;
    validatingAirline: string;
    fareDetailsBySegment: {
      cabin: string;
      class: string;
      includedCheckedBags: {
        quantity: number;
      };
      brandedFare: boolean;
      fareBasis: string;
    }[];
    services: {
      name: string;
      description: string;
      isChargeable: boolean;
    }[];
    policies: {
      checkedBags: number;
      carryOn: number;
      seatSelection: boolean;
      cancellation: string;
      changes: string;
      refund: string;
    };
    amenities: {
      description: string;
      isChargeable: boolean;
      amenityType: string;
      amenityProvider: {
        name: string;
      };
    }[];
  };
}

interface AmadeusFlightSearchParams {
  // ... keep existing AmadeusFlightSearchParams interface ...
}

interface AmadeusHotelSearchParams {
  // ... keep existing AmadeusHotelSearchParams interface ...
}

interface FlightOffersResponse {
  data: any[];
  meta?: any;
  dictionaries?: any;
}

interface AuthResponse {
  access_token: string;
  expires_in: number;
}

interface FlightSearchParams {
  originLocationCode: string;
  destinationLocationCode: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
  travelClass?: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
  max?: number;
  currencyCode?: string;
  nonStop?: boolean;
}

export class AmadeusService {
  private baseURL: string;
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number | null = null;
  private commonAirlines: Record<string, string> = {};

  constructor() {
    this.baseURL = process.env.AMADEUS_API_URL || 'https://test.api.amadeus.com';
    this.clientId = process.env.AMADEUS_CLIENT_ID || '';
    this.clientSecret = process.env.AMADEUS_CLIENT_SECRET || '';
    this.initializeCommonAirlines();
  }

  private initializeCommonAirlines() {
    this.commonAirlines = {
      'AA': 'American Airlines',
      'UA': 'United Airlines',
      'DL': 'Delta Air Lines',
      'LH': 'Lufthansa',
      'BA': 'British Airways',
      'AF': 'Air France',
      'KL': 'KLM Royal Dutch Airlines',
      'IB': 'Iberia',
      'EK': 'Emirates',
      'QR': 'Qatar Airways'
    };
  }

  private async getToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    try {
      console.log('[Amadeus] Requesting new access token');
      const response = await axios.post<{ access_token: string; expires_in: number }>(
        `${this.baseURL}/v1/security/oauth2/token`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      if (!response.data?.access_token) {
        throw new Error('No access token received from Amadeus');
      }

      this.accessToken = response.data.access_token;
      this.tokenExpiresAt = Date.now() + (response.data.expires_in * 1000);
      console.log('[Amadeus] Successfully obtained new access token');
      return this.accessToken;
    } catch (error) {
      console.error('[Amadeus] Failed to get access token:', error);
      throw error;
    }
  }

  async getAirlineInfo(airlineCodes: string | string[]): Promise<any[]> {
    const codes = Array.isArray(airlineCodes) ? airlineCodes : [airlineCodes];
    const results = [];

    try {
      const token = await this.getToken();
      // Use the correct endpoint with airlineCodes query parameter
      const response = await axios.get(`${this.baseURL}/v1/reference-data/airlines`, {
        params: {
          airlineCodes: codes.join(',')
        },
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (response.data?.data) {
        results.push(...response.data.data.map((airline: any) => ({
          ...airline,
          commonName: airline.commonName || airline.businessName || airline.iataCode
        })));
      }
    } catch (error) {
      logToFile(`Error fetching airline info: ${error}`);
      // Fallback to dictionaries and common airlines map
      results.push(...codes.map(code => ({
        iataCode: code,
        commonName: this.commonAirlines[code] || code,
        businessName: this.commonAirlines[code]
      })));
    }

    return results;
  }

  calculateTotalDuration(segments: any[]): string {
    let totalMinutes = 0;

    segments.forEach(segment => {
      const duration = segment.duration;
      if (duration) {
        // Parse duration in format "PT2H30M"
        const hours = duration.match(/(\d+)H/)?.[1] || '0';
        const minutes = duration.match(/(\d+)M/)?.[1] || '0';
        totalMinutes += parseInt(hours) * 60 + parseInt(minutes);
      }
    });

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `PT${hours}H${minutes}M`;
  }

  async searchFlights(params: FlightSearchParams): Promise<any[]> {
    try {
      console.log('[Amadeus] Starting flight search with params:', {
        ...params,
        accessToken: '***' // Hide the token in logs
      });

      const token = await this.getToken();
      if (!token) {
        throw new Error('Failed to obtain valid token');
      }
      
      const response = await axios.get<FlightOffersResponse>(
        `${this.baseURL}/v2/shopping/flight-offers`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          params: {
            originLocationCode: params.originLocationCode,
            destinationLocationCode: params.destinationLocationCode,
            departureDate: params.departureDate,
            returnDate: params.returnDate,
            adults: params.adults.toString(),
            travelClass: params.travelClass || 'ECONOMY',
            max: (params.max || 25).toString(), // Reduced from 50 to 25 for faster response
            currencyCode: params.currencyCode || 'USD',
            nonStop: params.nonStop || false
          },
          timeout: 15000 // 15 second timeout
        }
      );

      console.log('[Amadeus] Flight search successful:', {
        status: response.status,
        flightCount: response.data?.data?.length || 0,
        sampleFlight: response.data?.data?.[0] ? {
          price: response.data.data[0].price,
          itineraries: response.data.data[0].itineraries.map((it: any) => ({
            segments: it.segments.map((seg: any) => ({
              departure: seg.departure,
              arrival: seg.arrival,
              carrierCode: seg.carrierCode,
              aircraft: seg.aircraft
            }))
          })),
          travelerPricings: response.data.data[0].travelerPricings
        } : null,
        dictionaries: response.data?.dictionaries
      });

      return response.data?.data || [];
    } catch (error: any) {
      console.error('[Amadeus] Flight search error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
        errors: error.response?.data?.errors,
        stack: error.stack
      });

      // Check if we need to refresh the token
      if (error.response?.status === 401) {
        console.log('[Amadeus] Token expired, refreshing...');
        this.accessToken = null; // Clear the token to force refresh
        await this.getToken();
        // Retry the request once with the new token
        return this.searchFlights(params);
      }

      // Handle timeout or network errors
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        console.log('[Amadeus] Request timed out, retrying with simplified params...');
        // Retry with simplified parameters
        return this.searchFlights({
          ...params,
          max: 10, // Further reduce results
          nonStop: true // Only direct flights
        });
      }

      // For dates too far in advance or other errors, return empty array to allow fallback
      return [];
    }
  }

  determineTier(price: number, cabinClass?: string): 'budget' | 'medium' | 'premium' {
    const tier = (() => {
      // Consider cabin class first
      if (cabinClass) {
        const upperCabinClass = cabinClass.toUpperCase();
        if (upperCabinClass === 'FIRST') {
          return 'premium';
        } else if (upperCabinClass === 'BUSINESS') {
          // Business class can be premium or medium depending on price
          return price > 1500 ? 'premium' : 'medium';
        } else if (upperCabinClass === 'PREMIUM_ECONOMY') {
          // Premium economy is typically medium tier
          return 'medium';
        }
      }

      // Then consider price ranges for economy class
      if (price <= 500) {
        return 'budget';
      } else if (price <= 1000) {
        return 'medium';
      } else {
        return 'premium';
      }
    })();

    console.log('[Amadeus] Determined tier:', {
      price,
      cabinClass,
      resultingTier: tier
    });

    return tier;
  }

  generateBookingUrl(flightOffer: any): string {
    try {
      const firstSegment = flightOffer.itineraries[0].segments[0];
      const lastSegment = flightOffer.itineraries[0].segments[flightOffer.itineraries[0].segments.length - 1];
      
    const origin = firstSegment.departure.iataCode;
    const destination = lastSegment.arrival.iataCode;
    const departureDate = firstSegment.departure.at.split('T')[0];
      const returnDate = flightOffer.itineraries[1]?.segments[0]?.departure.at.split('T')[0];
      const adults = flightOffer.travelerPricings.length;
      const cabinClass = flightOffer.travelerPricings[0].fareDetailsBySegment[0].cabin;
      
      // Base URL for flight booking
      const baseUrl = 'https://www.amadeus.com/flights';
      
      // Construct query parameters
      const params = new URLSearchParams({
        origin,
        destination,
        departureDate,
        adults: adults.toString(),
        cabinClass: cabinClass.toLowerCase()
      });
      
      if (returnDate) {
        params.append('returnDate', returnDate);
      }
      
      // Add flight numbers if available
      const flightNumbers = flightOffer.itineraries.flatMap((itinerary: any) =>
        itinerary.segments.map((segment: any) =>
          `${segment.carrierCode}${segment.number}`
        )
      );
      
      if (flightNumbers.length > 0) {
        params.append('flights', flightNumbers.join(','));
      }
      
      return `${baseUrl}?${params.toString()}`;
    } catch (error) {
      logToFile(`Error generating booking URL: ${error}`);
      // Fallback to a basic URL if there's an error
      return 'https://www.amadeus.com/flights';
    }
  }

  async searchHotels(params: HotelSearchParams): Promise<AmadeusHotelOffer[]> {
    try {
      console.log('[Amadeus] Starting hotel search with params:', {
        ...params,
        accessToken: '***' // Hide the token in logs
      });

      const token = await this.getToken();
      if (!token) {
        throw new Error('Failed to obtain valid token');
      }

      const response = await axios.get<{ data: AmadeusHotelOffer[] }>(
        `${this.baseURL}/v2/shopping/hotel-offers`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          },
          params: {
            cityCode: params.cityCode,
            checkInDate: params.checkInDate,
            checkOutDate: params.checkOutDate,
            adults: params.adults,
            radius: params.radius || 50,
            radiusUnit: 'KM',
            ratings: '1,2,3,4,5',
            currency: params.currency || 'USD',
            bestRateOnly: true,
            view: 'FULL'
          }
        }
      );

      console.log('[Amadeus] Hotel search successful:', {
        status: response.status,
        hotelCount: response.data?.data?.length || 0
      });

      return response.data?.data || [];
    } catch (error: any) {
      console.error('[Amadeus] Hotel search error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });

      // Check if we need to refresh the token
      if (error.response?.status === 401) {
        console.log('[Amadeus] Token expired, refreshing...');
        await this.getToken();
        // Retry the request once with the new token
        return this.searchHotels(params);
      }

      // For other errors, return empty array to allow fallback to Perplexity
      return [];
    }
  }

  transformHotelOffer(offer: AmadeusHotelOffer): TransformedHotelOffer {
    const firstOffer = offer.offers[0];
    const hotelInfo = offer.hotel;

    return {
      name: hotelInfo.name,
      location: hotelInfo.address?.cityName || '',
      price: {
        amount: parseFloat(firstOffer.price.total),
        currency: firstOffer.price.total ? 'USD' : 'USD'
      },
      type: this.determineHotelType(hotelInfo.rating),
      amenities: hotelInfo.amenities?.join(', ') || '',
      rating: parseInt(hotelInfo.rating || '0'),
      reviewScore: hotelInfo.rating ? parseFloat(hotelInfo.rating) / 2 : 0,
      reviewCount: 0, // Not available in Amadeus API
      images: hotelInfo.media?.map(m => m.uri).filter((uri): uri is string => !!uri) || [],
      referenceUrl: '',
      coordinates: {
        latitude: parseFloat(hotelInfo.latitude || '0'),
        longitude: parseFloat(hotelInfo.longitude || '0')
      },
      features: hotelInfo.amenities?.filter((amenity): amenity is string => !!amenity) || [],
      policies: {
        checkIn: '',
        checkOut: '',
        cancellation: firstOffer.policies?.cancellation?.description?.text || ''
      },
      tier: this.determineTier(parseFloat(firstOffer.price.total)) as 'budget' | 'medium' | 'premium'
    };
  }

  private determineHotelType(rating?: string): string {
    if (!rating) return 'Hotel';
    const numericRating = parseInt(rating);
    if (numericRating >= 4) return 'Luxury Hotel';
    if (numericRating >= 3) return 'Business Hotel';
    return 'Budget Hotel';
  }
} 