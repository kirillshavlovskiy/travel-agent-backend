import Amadeus from 'amadeus';
import { 
  AmadeusFlightOffer, 
  FlightReference, 
  AmadeusHotelOffer, 
  TransformedHotelOffer,
  HotelSearchParams 
} from '../types/amadeus.js';
import { logger } from '../utils/logger.js';

// Add type declaration for amadeus module
declare module 'amadeus' {
  interface AmadeusClient {
    get(params: Record<string, any>): Promise<any>;
    post(params: Record<string, any>): Promise<any>;
  }

  interface AmadeusShoppingFlightOffersSearchPricing {
    post(params: Record<string, any>): Promise<any>;
  }

  interface AmadeusShoppingFlightOffersSearch {
    get(params: Record<string, any>): Promise<any>;
    pricing: AmadeusShoppingFlightOffersSearchPricing;
  }

  interface AmadeusShoppingHotelOffers {
    get(params: Record<string, any>): Promise<any>;
  }

  interface AmadeusShopping {
    flightOffersSearch: AmadeusShoppingFlightOffersSearch;
    hotelOffers: AmadeusShoppingHotelOffers;
  }

  interface AmadeusOptions {
    clientId: string;
    clientSecret: string;
    hostname?: string;
  }

  class Amadeus {
    constructor(options: AmadeusOptions);
    shopping: AmadeusShopping;
  }

  export default Amadeus;
}

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
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  roomQuantity: number;
  currency?: string;
  radius?: number;
  ratings?: string;
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

interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
}

export class AmadeusService {
  private amadeus: Amadeus;
  private lastFlightSearchDictionaries: {
    locations?: Record<string, { cityCode: string; countryCode: string }>;
    aircraft?: Record<string, string>;
    currencies?: Record<string, string>;
    carriers?: Record<string, string>;
  } | null = null;

  constructor() {
    const clientId = process.env.AMADEUS_CLIENT_ID;
    const clientSecret = process.env.AMADEUS_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Missing Amadeus API credentials');
    }

    this.amadeus = new Amadeus({
      clientId,
      clientSecret,
    });
  }

  async searchHotels(params: AmadeusHotelSearchParams): Promise<AmadeusHotelOffer[]> {
    try {
      logger.info('Searching for hotels in city', { params });

      // Get hotels with offers
      const hotelsResponse = await this.amadeus.shopping.hotelOffers.get({
        cityCode: params.cityCode,
        checkInDate: params.checkInDate,
        checkOutDate: params.checkOutDate,
        adults: params.adults,
        roomQuantity: params.roomQuantity,
        radius: params.radius || 5,
          radiusUnit: 'KM',
        ratings: params.ratings || '3,4,5',
        amenities: 'SWIMMING_POOL,SPA,FITNESS_CENTER',
        currency: params.currency || 'USD',
        bestRateOnly: true,
        view: 'FULL'
      });

      const hotels = JSON.parse(hotelsResponse.body);
      logger.info('Found hotels', { count: hotels.data?.length || 0 });

      if (!hotels.data || hotels.data.length === 0) {
        return [];
      }

      // Transform the response
      return hotels.data;
    } catch (error) {
      logger.error('Error searching hotels:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        response: (error as any)?.response?.data
      });
      throw error;
    }
  }

  determineHotelType(rating: number): string {
    if (rating >= 4) return 'luxury';
    if (rating >= 3) return 'comfort';
    return 'budget';
  }

  transformHotelOffer(offer: AmadeusHotelOffer): TransformedHotelOffer {
    const { hotel, offers } = offer;
    const price = offers[0]?.price?.total ? parseFloat(offers[0].price.total) : 0;
    const rating = hotel.rating ? parseInt(hotel.rating) : 0;

    return {
                name: hotel.name,
      location: hotel.address?.cityName || '',
      price: {
        amount: price,
        currency: 'USD'
      },
      tier: this.determineHotelType(rating),
      type: 'hotel',
      amenities: hotel.amenities?.join(', ') || '',
      rating,
      reviewScore: rating ? rating / 2 : 0,
      reviewCount: 0,
      images: hotel.media?.map(m => m.uri) || [],
      referenceUrl: '#',
      coordinates: {
        latitude: hotel.latitude ? parseFloat(hotel.latitude) : 0,
        longitude: hotel.longitude ? parseFloat(hotel.longitude) : 0
      },
      features: hotel.amenities || [],
      policies: {
        checkIn: '',
        checkOut: '',
        cancellation: offers[0]?.policies?.cancellation?.description?.text || ''
      }
    };
  }

  getCityCode(destination: string): string {
    // Remove country part if present
    const city = destination.split(',')[0].trim().toUpperCase();
    
    // Try to find the city code in the last flight search dictionaries
    if (this.lastFlightSearchDictionaries?.locations) {
      const locationEntry = Object.entries(this.lastFlightSearchDictionaries.locations)
        .find(([_, info]) => info.cityCode === city);
      if (locationEntry) {
        return locationEntry[0]; // Return the IATA code
      }
    }
    
    // If not found, return the city name as is (will be validated by Amadeus)
    return city;
  }

  getAircraftName(code: string): string {
    return this.lastFlightSearchDictionaries?.aircraft?.[code] || code;
  }

  getCarrierName(code: string): string {
    return this.lastFlightSearchDictionaries?.carriers?.[code] || code;
  }

  getCurrencyName(code: string): string {
    return this.lastFlightSearchDictionaries?.currencies?.[code] || code;
  }

  async getAirlineInfo(airlineCodes: string | string[]): Promise<any[]> {
    const codes = Array.isArray(airlineCodes) ? airlineCodes : [airlineCodes];
    const results = [];

    try {
      for (const code of codes) {
        const carrierName = this.getCarrierName(code);
        results.push({
          iataCode: code,
          commonName: carrierName,
          businessName: carrierName
        });
      }
    } catch (error) {
      logger.error('Error in getAirlineInfo:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        codes
      });
      // Fallback to using codes as names
      results.push(...codes.map(code => ({
        iataCode: code,
        commonName: code,
        businessName: code
      })));
    }

    return results;
  }

  async searchFlights(params: FlightSearchParams): Promise<AmadeusFlightOffer[]> {
    try {
      logger.info('Starting flight search with params', {
        ...params,
        clientId: this.amadeus ? 'set' : 'not set'
      });

      const searchParams = {
        originLocationCode: this.getCityCode(params.originLocationCode),
        destinationLocationCode: this.getCityCode(params.destinationLocationCode),
        departureDate: params.departureDate,
        returnDate: params.returnDate,
        adults: params.adults.toString(), // Convert to string as required by API
        travelClass: params.travelClass || 'ECONOMY',
        max: (params.max || 25).toString(), // Convert to string
        currencyCode: params.currencyCode || 'USD',
        nonStop: params.nonStop || false
      };

      const response = await this.amadeus.shopping.flightOffersSearch.get(searchParams);
      const flightOffers = JSON.parse(response.body);

      // Store dictionaries for later use
      this.lastFlightSearchDictionaries = flightOffers.dictionaries;

      logger.info('Flight search successful', {
        flightCount: flightOffers.data?.length || 0,
        dictionaries: flightOffers.dictionaries
      });

      return flightOffers.data || [];
    } catch (error) {
      logger.error('Failed to search for flights', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        params,
        response: (error as any)?.response?.data || 'No response data'
      });
      throw error;
    }
  }

  async confirmFlightPrice(flightOffer: AmadeusFlightOffer): Promise<any> {
    try {
      logger.info('Confirming flight price', { 
        offerId: flightOffer.id,
        price: flightOffer.price
      });

      const response = await this.amadeus.shopping.flightOffersSearch.pricing.post(
        JSON.stringify({
          data: {
            type: 'flight-offers-pricing',
            flightOffers: [flightOffer]
          }
        })
      );

      const priceConfirmation = JSON.parse(response.body);
      logger.info('Price confirmation successful', { 
        confirmedPrice: priceConfirmation.data.flightOffers[0].price 
      });

      return priceConfirmation.data;
    } catch (error) {
      logger.error('Failed to confirm flight price', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        offerId: flightOffer.id
      });
      throw error;
    }
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

  public determineTier(flightOffer: AmadeusFlightOffer): 'budget' | 'medium' | 'premium' {
    try {
      // Get cabin class from first traveler's first segment
      const cabinClass = flightOffer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.cabin || 'ECONOMY';
      const price = parseFloat(flightOffer.price.total);

      // Normalize cabin class for comparison
      const normalizedCabin = cabinClass.toUpperCase();
      
      // First class is always premium
      if (normalizedCabin === 'FIRST' || normalizedCabin === 'LA PREMIERE') {
        return 'premium';
      }
      
      // Business class can be medium or premium based on price
      if (normalizedCabin === 'BUSINESS' || normalizedCabin === 'PREMIUM_BUSINESS') {
        return price <= 1500 ? 'medium' : 'premium';
      }

      // Premium economy is typically medium, but can be premium if very expensive
      if (normalizedCabin === 'PREMIUM_ECONOMY' || normalizedCabin === 'PREMIUM') {
        return price <= 1200 ? 'medium' : 'premium';
      }

      // For economy class, use more granular price tiers
    if (price <= 800) {
      return 'budget';
      } else if (price <= 1200) {
      return 'medium';
    } else {
      return 'premium';
    }
    } catch (error) {
      logger.error('[AmadeusService] Error determining tier:', error);
      return 'budget'; // Default to budget if there's an error
    }
  }

  generateBookingUrl(flightOffer: AmadeusFlightOffer): string {
    try {
      const { validatingAirlineCodes, itineraries } = flightOffer;
      if (!validatingAirlineCodes || validatingAirlineCodes.length === 0 || !itineraries || itineraries.length === 0) {
        throw new Error('Missing required flight offer data');
      }

      const mainAirline = validatingAirlineCodes[0];
      const firstSegment = itineraries[0].segments[0];
      const lastSegment = itineraries[0].segments[itineraries[0].segments.length - 1];

      // Get origin and destination
      const origin = firstSegment.departure.iataCode;
      const destination = lastSegment.arrival.iataCode;

      // Format date (YYYY-MM-DD to DDMMYY)
      const departureDate = firstSegment.departure.at.split('T')[0]
        .replace(/-/g, '')
        .slice(2); // Convert to DDMMYY

      // Generate URL based on airline
      switch (mainAirline) {
        case 'LH': // Lufthansa
          return `https://www.lufthansa.com/us/en/flight-search?searchType=ONEWAY&adults=1&children=0&infants=0&origin=${origin}&destination=${destination}&departureDate=${departureDate}`;
        case 'AF': // Air France
          return `https://wwws.airfrance.us/search/offer?origin=${origin}&destination=${destination}&outboundDate=${departureDate}&cabinClass=ECONOMY&adults=1&children=0&infants=0`;
        case 'BA': // British Airways
          return `https://www.britishairways.com/travel/book/public/en_us?origin=${origin}&destination=${destination}&outboundDate=${departureDate}&cabinclass=M&adultcount=1&childcount=0&infantcount=0`;
        case 'UA': // United Airlines
          return `https://www.united.com/ual/en/us/flight-search/book-a-flight/results/rev?f=${origin}&t=${destination}&d=${departureDate}&tt=1&sc=7&px=1&taxng=1&idx=1`;
        case 'AA': // American Airlines
          return `https://www.aa.com/booking/find-flights?origin=${origin}&destination=${destination}&departureDate=${departureDate}&passengers=1`;
        case 'DL': // Delta Airlines
          return `https://www.delta.com/flight-search/book-a-flight?origin=${origin}&destination=${destination}&departureDate=${departureDate}&passengers=1`;
        default:
          // Generic booking URL format for other airlines
          return `https://www.google.com/travel/flights?q=flights%20${origin}%20to%20${destination}%20${departureDate}`;
      }
    } catch (error) {
      logger.error('Error generating booking URL:', { error });
      // Return a fallback URL
      return 'https://www.google.com/travel/flights';
    }
  }
} 