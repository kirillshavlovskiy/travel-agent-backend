import axios from 'axios';
import { AmadeusFlightOffer, FlightReference, AirlineInfo } from '../types.js';
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

interface AmadeusHotelOffer {
  // ... keep existing AmadeusHotelOffer interface ...
}

export class AmadeusService {
  private token = '';
  private tokenExpiry = 0;
  private clientId: string;
  private clientSecret: string;
  private baseURL = 'https://test.api.amadeus.com';
  private commonAirlines: { [key: string]: string } = {
    'AA': 'American Airlines',
    'UA': 'United Airlines',
    'DL': 'Delta Air Lines',
    'LH': 'Lufthansa',
    'BA': 'British Airways',
    'AF': 'Air France',
    'KL': 'KLM Royal Dutch Airlines',
    'IB': 'Iberia',
    'B6': 'JetBlue Airways',
    'WN': 'Southwest Airlines',
    'AS': 'Alaska Airlines',
    'VS': 'Virgin Atlantic',
    'EK': 'Emirates',
    'QR': 'Qatar Airways',
    'EY': 'Etihad Airways',
    'TK': 'Turkish Airlines',
    'LX': 'SWISS',
    'AC': 'Air Canada',
    'FI': 'Icelandair',
    'SK': 'SAS Scandinavian Airlines',
    'AZ': 'ITA Airways',
    'TP': 'TAP Air Portugal'
  };

  constructor() {
    this.clientId = process.env.AMADEUS_CLIENT_ID || '';
    this.clientSecret = process.env.AMADEUS_CLIENT_SECRET || '';
    if (!this.clientId || !this.clientSecret) {
      const error = 'Amadeus API credentials are not configured';
      logToFile(`ERROR: ${error}`);
      console.error(error);
    }
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) {
      return this.token;
    }

    try {
      logToFile('Requesting new Amadeus access token');
      const response = await axios.post(
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
        const error = 'No access token received from Amadeus';
        logToFile(`ERROR: ${error}`);
        throw new Error(error);
      }

      this.token = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
      logToFile('Successfully obtained new access token');
      return this.token;
    } catch (error) {
      const errorMsg = 'Failed to get Amadeus access token:';
      logToFile(`ERROR: ${errorMsg} ${error}`);
      console.error(errorMsg, error);
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

  async searchFlights(params: {
    originLocationCode: string;
    destinationLocationCode: string;
    departureDate: string;
    returnDate?: string;
    adults: number;
    travelClass?: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
  }): Promise<any[]> {
    try {
      logToFile('\n=== Amadeus Flight Search Request ===');
      logToFile(`Raw params: ${JSON.stringify(params, null, 2)}`);
      const token = await this.getToken();
      
      // Add delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const requestParams = {
        ...params,
        max: 50,
        currencyCode: 'USD',
        nonStop: false
      };
      
      logToFile(`Final request params: ${JSON.stringify(requestParams, null, 2)}`);
      logToFile(`Request URL: ${this.baseURL}/v2/shopping/flight-offers`);
      logToFile(`Authorization: Bearer ${token.substring(0, 10)}...`);
      
      const response = await axios.get(`${this.baseURL}/v2/shopping/flight-offers`, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        params: requestParams
      });

      logToFile('\n=== Amadeus Flight Search Response ===');
      logToFile(`Status: ${response.status}`);
      logToFile(`Headers: ${JSON.stringify(response.headers, null, 2)}`);

      if (!response.data?.data) {
        const error = {
          status: response.status,
          statusText: response.statusText,
          data: JSON.stringify(response.data, null, 2),
          headers: response.headers
        };
        logToFile(`ERROR: Invalid response structure: ${JSON.stringify(error, null, 2)}`);
        throw new Error('Invalid response from Amadeus API');
      }

      const results = response.data.data;
      logToFile('\n=== Amadeus Search Results ===');
      logToFile(`Total results: ${results.length}`);
      if (results.length > 0) {
        logToFile(`First result: ${JSON.stringify(results[0], null, 2)}`);
      }
      logToFile(`Meta: ${JSON.stringify(response.data.meta, null, 2)}`);
      logToFile(`Dictionaries: ${JSON.stringify(response.data.dictionaries, null, 2)}`);

      return results;
    } catch (error) {
      logToFile('\n=== Amadeus API Error ===');
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 429) {
          logToFile('Rate limit exceeded, retrying after delay...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          return this.searchFlights(params);
        }
        logToFile(`Request config: ${JSON.stringify({
          url: error.config?.url,
          method: error.config?.method,
          params: error.config?.params,
          headers: error.config?.headers
        }, null, 2)}`);
        logToFile(`Response error details: ${JSON.stringify({
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          errors: error.response?.data?.errors,
          headers: error.response?.headers
        }, null, 2)}`);
        // Log the specific error message from Amadeus
        if (error.response?.data?.errors) {
          logToFile('Amadeus Error Messages:');
          error.response.data.errors.forEach((err: any) => {
            logToFile(`- ${err.title}: ${err.detail} (${err.code})`);
          });
        }
      } else {
        logToFile(`Non-Axios error: ${error}`);
      }
      throw error;
    }
  }
} 