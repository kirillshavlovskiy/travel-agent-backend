import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

interface FlightReference {
  id: string;
  airline: string;
  flightNumber: string;
  route: string;
  outbound: string;
  inbound?: string;
  duration: string;
  layovers: number;
  price: {
    amount: number;
    currency?: string;
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, '..', '..', 'logs');

// Create logs directory if it doesn't exist
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logToFile = (message: string) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(path.join(logsDir, 'amadeus.log'), logMessage);
};

interface AmadeusFlightSearchParams {
  originLocationCode: string;
  destinationLocationCode: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
  travelClass?: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
}

interface AmadeusFlightOffer {
  id: string;
  price: {
    total: string;
    currency: string;
  };
  itineraries: Array<{
    segments: Array<{
      departure: {
        iataCode: string;
        terminal?: string;
        at: string;
      };
      arrival: {
        iataCode: string;
        terminal?: string;
        at: string;
      };
      duration: string;
      carrierCode: string;
      number: string;
    }>;
  }>;
  validatingAirlineCodes: string[];
  travelerPricings: Array<{
    travelerId: string;
    fareOption: string;
    travelerType: string;
    price: {
      currency: string;
      total: string;
    };
    fareDetailsBySegment: Array<{
      cabin: string;
      class: string;
    }>;
  }>;
}

interface AirlineInfo {
  type: string;
  iataCode: string;
  icaoCode: string;
  businessName: string;
  commonName: string;
}

export class AmadeusService {
  private token = '';
  private tokenExpiry = 0;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseURL: string = 'https://test.api.amadeus.com';

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

  async searchFlights(params: AmadeusFlightSearchParams): Promise<AmadeusFlightOffer[]> {
    try {
      logToFile('\n=== Amadeus API Request ===');
      logToFile(`Request params: ${JSON.stringify(params, null, 2)}`);
      
      const token = await this.getToken();
      
      // Add delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const response = await axios.get(`${this.baseURL}/v2/shopping/flight-offers`, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        params: {
          ...params,
          max: 50,
          currencyCode: 'USD'
        }
      });

      logToFile('\n=== Amadeus API Response ===');
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
        logToFile(`Response error: ${JSON.stringify({
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          headers: error.response?.headers
        }, null, 2)}`);
      } else {
        logToFile(`Non-Axios error: ${error}`);
      }
      throw error;
    }
  }

  async getAirlineInfo(airlineCodes: string | string[]): Promise<AirlineInfo[]> {
    const codes = Array.isArray(airlineCodes) ? airlineCodes : [airlineCodes];
    
    // Common airline code to name mapping
    const commonAirlines: Record<string, string> = {
      'AC': 'Air Canada',
      'AF': 'Air France',
      'AT': 'Royal Air Maroc',
      'BA': 'British Airways',
      'DL': 'Delta Air Lines',
      'EK': 'Emirates',
      'IB': 'Iberia',
      'KL': 'KLM Royal Dutch Airlines',
      'LH': 'Lufthansa',
      'LX': 'Swiss International Air Lines',
      'QR': 'Qatar Airways',
      'TP': 'TAP Air Portugal',
      'TK': 'Turkish Airlines',
      'UA': 'United Airlines',
      'AA': 'American Airlines',
      'N0': 'Norse Atlantic Airways',
      'LV': 'LEVEL',
      'AZ': 'Alitalia'
    };
    
    try {
      const token = await this.getToken();
      
      logToFile('\n=== Fetching Airline Info ===');
      logToFile(`Airline codes: ${codes.join(', ')}`);
      
      const response = await axios.get(`${this.baseURL}/v1/reference-data/airlines`, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        params: {
          airlineCodes: codes.join(',')
        }
      });

      if (!response.data?.data) {
        const error = 'Invalid airline info response';
        logToFile(`ERROR: ${error}`);
        logToFile(`Response data: ${JSON.stringify(response.data, null, 2)}`);
        throw new Error(error);
      }

      logToFile(`Airline info response: ${JSON.stringify(response.data, null, 2)}`);
      return response.data.data;
    } catch (error) {
      logToFile('\n=== Airline Info Error ===');
      if (axios.isAxiosError(error)) {
        logToFile(`Response error: ${JSON.stringify(error.response?.data, null, 2)}`);
      } else {
        logToFile(`Error: ${error}`);
      }
      // Return common airline names if available, otherwise use code
      return codes.map((code: string) => ({
        type: 'airline',
        iataCode: code,
        icaoCode: code,
        businessName: commonAirlines[code] || code,
        commonName: commonAirlines[code] || code
      }));
    }
  }

  async getAirportInfo(airportCode: string): Promise<any> {
    try {
      const token = await this.getToken();
      
      const response = await axios.get(`${this.baseURL}/reference-data/locations/${airportCode}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      return response.data.data;
    } catch (error) {
      console.error('Error fetching airport info:', error);
      throw error;
    }
  }

  transformFlightOffer(offer: AmadeusFlightOffer, airlineInfoArray: AirlineInfo[]): any {
    const outboundSegments = offer.itineraries[0].segments;
    const inboundSegments = offer.itineraries[1]?.segments || [];
    const firstSegment = outboundSegments[0];
    const lastOutboundSegment = outboundSegments[outboundSegments.length - 1];
    const firstInboundSegment = inboundSegments[0];
    const lastInboundSegment = inboundSegments[inboundSegments.length - 1];

    logToFile('\n=== Transforming Flight Offer ===');
    logToFile(`Offer ID: ${offer.id}`);
    
    const totalPrice = parseFloat(offer.price.total);
    const numberOfTravelers = offer.travelerPricings.length;
    const pricePerTraveler = totalPrice / numberOfTravelers;
    const cabinClass = offer.travelerPricings[0].fareDetailsBySegment[0].cabin;
    
    logToFile(`Price details:
      Total price: $${totalPrice}
      Number of travelers: ${numberOfTravelers}
      Price per traveler: $${pricePerTraveler.toFixed(2)}
      Cabin class: ${cabinClass}
    `);

    const tier = this.determineTier(totalPrice, cabinClass, numberOfTravelers);
    
    const getAirlineInfo = (carrierCode: string) => {
      const info = airlineInfoArray.find((airline: AirlineInfo) => airline.iataCode === carrierCode);
      return {
        code: carrierCode,
        name: info?.businessName || info?.commonName || carrierCode
      };
    };

    const airlineInfo = getAirlineInfo(firstSegment.carrierCode);
    const flightNumber = `${firstSegment.carrierCode}${firstSegment.number}`;

    // Base structure that's common for both simplified and detailed formats
    const transformed = {
      id: offer.id,
      amadeusId: offer.id,
      airline: airlineInfo.name,
      airlineCode: airlineInfo.code,
      flightNumber,
      price: {
        amount: totalPrice,
        perTraveler: pricePerTraveler,
        numberOfTravelers,
        currency: offer.price.currency
      },
      route: `${firstSegment.departure.iataCode} - ${lastOutboundSegment.arrival.iataCode}`,
      outbound: firstSegment.departure.at,
      inbound: lastInboundSegment?.arrival.at,
      duration: this.calculateTotalDuration(outboundSegments),
      layovers: outboundSegments.length - 1,
      segments: outboundSegments.map(segment => ({
        airline: getAirlineInfo(segment.carrierCode),
        flightNumber: `${segment.carrierCode}${segment.number}`,
        departure: {
          airport: segment.departure.iataCode,
          terminal: segment.departure.terminal,
          time: segment.departure.at
        },
        arrival: {
          airport: segment.arrival.iataCode,
          terminal: segment.arrival.terminal,
          time: segment.arrival.at
        },
        duration: segment.duration
      })),
      returnSegments: inboundSegments.length > 0 ? inboundSegments.map(segment => ({
        airline: getAirlineInfo(segment.carrierCode),
        flightNumber: `${segment.carrierCode}${segment.number}`,
        departure: {
          airport: segment.departure.iataCode,
          terminal: segment.departure.terminal,
          time: segment.departure.at
        },
        arrival: {
          airport: segment.arrival.iataCode,
          terminal: segment.arrival.terminal,
          time: segment.arrival.at
        },
        duration: segment.duration
      })) : [],
      cabinClass,
      bookingClass: offer.travelerPricings[0].fareDetailsBySegment[0].class,
      tier,
      referenceUrl: this.generateBookingUrl(offer)
    };

    // Log the final transformation for debugging
    logToFile(`\nTransformed flight offer:
      ID: ${transformed.id}
      Airline: ${transformed.airline}
      Flight Number: ${transformed.flightNumber}
      Price per traveler: $${transformed.price.perTraveler}
      Total price: $${transformed.price.amount}
      Cabin class: ${transformed.cabinClass}
      Tier: ${transformed.tier}
      Route: ${transformed.route}
    `);

    return transformed;
  }

  public calculateTotalDuration(segments: Array<{duration: string}>): string {
    // Convert PT10H30M format to minutes, sum them, and convert back to PT format
    const totalMinutes = segments.reduce((total, segment) => {
      const hours = segment.duration.match(/(\d+)H/)?.[1] || '0';
      const minutes = segment.duration.match(/(\d+)M/)?.[1] || '0';
      return total + parseInt(hours) * 60 + parseInt(minutes);
    }, 0);

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `PT${hours}H${minutes}M`;
  }

  private determineTier(price: number, cabinClass?: string, numberOfTravelers: number = 1): 'budget' | 'medium' | 'premium' {
    logToFile(`\n=== Determining Price Tier ===`);
    logToFile(`Total Price: $${price}`);
    logToFile(`Number of Travelers: ${numberOfTravelers}`);
    logToFile(`Cabin Class: ${cabinClass}`);

    // Convert total price to per-traveler price for tier determination
    const pricePerTraveler = price / numberOfTravelers;
    logToFile(`Price per traveler: $${pricePerTraveler.toFixed(2)}`);

    // Base categorization (per traveler)
    let tier: 'budget' | 'medium' | 'premium';
    
    // Strict price ranges per traveler
    if (pricePerTraveler <= 800) {
      tier = 'budget';
      logToFile(`Price per traveler $${pricePerTraveler.toFixed(2)} <= $800 -> BUDGET`);
    } else if (pricePerTraveler <= 2000) {
      tier = 'medium';
      logToFile(`$800 < Price per traveler $${pricePerTraveler.toFixed(2)} <= $2000 -> MEDIUM`);
    } else {
      tier = 'premium';
      logToFile(`Price per traveler $${pricePerTraveler.toFixed(2)} > $2000 -> PREMIUM`);
    }

    logToFile(`Initial tier based on price per traveler: ${tier.toUpperCase()}`);

    // Cabin class override
    if (cabinClass) {
      const normalizedCabin = cabinClass.toUpperCase();
      const originalTier = tier;
      
      // Only override to higher tiers, never downgrade
      if ((normalizedCabin === 'FIRST' || normalizedCabin === 'BUSINESS') && tier !== 'premium') {
        tier = 'premium';
        logToFile(`Cabin class ${normalizedCabin} -> Override to PREMIUM`);
      } else if (normalizedCabin === 'PREMIUM_ECONOMY' && tier === 'budget') {
        tier = 'medium';
        logToFile(`Cabin class ${normalizedCabin} and was BUDGET -> Override to MEDIUM`);
      }
      
      if (originalTier !== tier) {
        logToFile(`Tier adjusted due to cabin class ${normalizedCabin}: ${originalTier} -> ${tier}`);
      }
    }

    logToFile(`Final categorization: ${tier.toUpperCase()}`);
    logToFile(`Price breakdown:
      Total price: $${price}
      Per traveler: $${pricePerTraveler.toFixed(2)}
      Cabin class: ${cabinClass}
      Tier: ${tier.toUpperCase()}
    `);

    return tier;
  }

  public generateBookingUrl(offer: AmadeusFlightOffer): string {
    const segments = offer.itineraries[0].segments;
    const params = new URLSearchParams({
      origin: segments[0].departure.iataCode,
      destination: segments[segments.length - 1].arrival.iataCode,
      depart: segments[0].departure.at.split('T')[0],
      cabin: offer.travelerPricings[0].fareDetailsBySegment[0].cabin.toLowerCase()
    });

    if (offer.itineraries[1]) {
      params.set('return', offer.itineraries[1].segments[0].departure.at.split('T')[0]);
    }

    return `https://www.kayak.com/flights?${params.toString()}`;
  }

  private createFlightIdentifier(flight: FlightReference): string {
    if (!flight.airline || !flight.flightNumber || !flight.outbound || !flight.price?.amount) {
      logToFile(`WARNING: Invalid flight data for identifier: ${JSON.stringify(flight, null, 2)}`);
      return '';
    }
    
    // Standardize the components
    const standardizedAirline = flight.airline.trim().toUpperCase();
    const standardizedFlightNumber = flight.flightNumber.trim().toUpperCase();
    const standardizedRoute = flight.route.replace(' to ', ' - ').toUpperCase().trim();
    const standardizedOutbound = new Date(flight.outbound).toISOString();
    const standardizedPrice = flight.price.amount.toFixed(2);
    
    // Create a unique identifier that captures all relevant aspects
    const identifier = [
      standardizedAirline,
      standardizedFlightNumber,
      standardizedRoute,
      standardizedOutbound,
      flight.duration,
      flight.layovers,
      standardizedPrice
    ].join('|');
    
    logToFile(`Created flight identifier: ${identifier}`);
    return identifier;
  }

  private deduplicateFlights(flights: FlightReference[]): FlightReference[] {
    logToFile(`\n=== Deduplicating Flights ===`);
    logToFile(`Initial count: ${flights.length}`);
    
    const uniqueFlights = new Map<string, FlightReference>();
    const duplicates = new Set<string>();
    
    flights.forEach(flight => {
      // Standardize airline codes
      if (flight.airline.length > 3) {
        const airlineCodeMap: Record<string, string> = {
          'Norse Atlantic Airways': 'N0',
          'LEVEL': 'LV',
          'British Airways': 'BA',
          'American Airlines': 'AA',
          'Delta Air Lines': 'DL',
          'United Airlines': 'UA',
          'Air Canada': 'AC',
          'Air France': 'AF',
          'KLM': 'KL',
          'Lufthansa': 'LH',
          'Iberia': 'IB',
          'Swiss': 'LX',
          'Alitalia': 'AZ'
        };
        flight.airline = airlineCodeMap[flight.airline] || flight.airline.substring(0, 2).toUpperCase();
      }

      // Create a standardized identifier
      const identifier = this.createFlightIdentifier(flight);
      if (!identifier) {
        logToFile(`Skipping invalid flight: ${JSON.stringify(flight, null, 2)}`);
        return;
      }

      // Check for duplicates
      if (uniqueFlights.has(identifier)) {
        duplicates.add(identifier);
        logToFile(`Duplicate found: ${identifier}`);
        
        // Compare prices and keep the lower one
        const existing = uniqueFlights.get(identifier)!;
        if (flight.price.amount < existing.price.amount) {
          logToFile(`Replacing flight with lower price: $${flight.price.amount} < $${existing.price.amount}`);
          uniqueFlights.set(identifier, flight);
        } else {
          logToFile(`Keeping existing flight with lower/equal price: $${existing.price.amount} <= $${flight.price.amount}`);
        }
      } else {
        uniqueFlights.set(identifier, flight);
        logToFile(`Added new unique flight: ${identifier}`);
      }
    });
    
    const deduplicated = Array.from(uniqueFlights.values());
    
    // Log deduplication results
    logToFile(`\n=== Deduplication Results ===`);
    logToFile(`Original count: ${flights.length}`);
    logToFile(`Deduplicated count: ${deduplicated.length}`);
    logToFile(`Duplicates removed: ${flights.length - deduplicated.length}`);
    
    if (duplicates.size > 0) {
      logToFile('\nDuplicate identifiers found:');
      duplicates.forEach(id => logToFile(id));
    }
    
    // Sort by price and then by departure time for consistent ordering
    return deduplicated.sort((a, b) => {
      const priceDiff = a.price.amount - b.price.amount;
      if (priceDiff !== 0) return priceDiff;
      return new Date(a.outbound).getTime() - new Date(b.outbound).getTime();
    });
  }
}

export const amadeusService = new AmadeusService(); 