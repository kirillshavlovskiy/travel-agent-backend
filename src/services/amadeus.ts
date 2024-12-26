import axios from 'axios';

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

export class AmadeusService {
  private token: string | null = null;
  private tokenExpiry: number = 0;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseURL: string = 'https://test.api.amadeus.com';

  constructor() {
    this.clientId = process.env.AMADEUS_CLIENT_ID || '';
    this.clientSecret = process.env.AMADEUS_CLIENT_SECRET || '';
    
    if (!this.clientId || !this.clientSecret) {
      console.error('Amadeus API credentials are not configured');
    }
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) {
      return this.token;
    }

    try {
      const response = await axios.post(
        'https://test.api.amadeus.com/v1/security/oauth2/token',
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

      this.token = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
      return this.token;
    } catch (error) {
      console.error('Failed to get Amadeus access token:', error);
      throw error;
    }
  }

  async searchFlights(params: AmadeusFlightSearchParams): Promise<AmadeusFlightOffer[]> {
    try {
      const token = await this.getToken();
      
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

      return response.data.data;
    } catch (error) {
      console.error('Error searching flights:', error);
      throw error;
    }
  }

  async getAirlineInfo(airlineCode: string): Promise<any> {
    try {
      const token = await this.getToken();
      
      const response = await axios.get(`${this.baseURL}/v1/reference-data/airlines/${airlineCode}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      return response.data.data;
    } catch (error) {
      console.error('Error fetching airline info:', error);
      throw error;
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

  transformFlightOffer(offer: AmadeusFlightOffer, airlineInfo: any): any {
    const outboundSegments = offer.itineraries[0].segments;
    const inboundSegments = offer.itineraries[1]?.segments || [];
    const firstSegment = outboundSegments[0];
    const lastOutboundSegment = outboundSegments[outboundSegments.length - 1];
    const firstInboundSegment = inboundSegments[0];
    const lastInboundSegment = inboundSegments[inboundSegments.length - 1];

    // Base structure that's common for both simplified and detailed formats
    const baseTransformation = {
      id: offer.id,
      price: {
        amount: parseFloat(offer.price.total),
        currency: offer.price.currency
      },
      outbound: {
        departure: {
          airport: firstSegment.departure.iataCode,
          terminal: firstSegment.departure.terminal,
          time: firstSegment.departure.at
        },
        arrival: {
          airport: lastOutboundSegment.arrival.iataCode,
          terminal: lastOutboundSegment.arrival.terminal,
          time: lastOutboundSegment.arrival.at
        },
        duration: this.calculateTotalDuration(outboundSegments),
        stops: outboundSegments.length - 1,
        segments: outboundSegments.map(segment => ({
          airline: {
            code: segment.carrierCode,
            name: airlineInfo?.commonName || airlineInfo?.businessName || segment.carrierCode
          },
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
        }))
      },
      inbound: inboundSegments.length > 0 ? {
        departure: {
          airport: firstInboundSegment.departure.iataCode,
          terminal: firstInboundSegment.departure.terminal,
          time: firstInboundSegment.departure.at
        },
        arrival: {
          airport: lastInboundSegment.arrival.iataCode,
          terminal: lastInboundSegment.arrival.terminal,
          time: lastInboundSegment.arrival.at
        },
        duration: this.calculateTotalDuration(inboundSegments),
        stops: inboundSegments.length - 1,
        segments: inboundSegments.map(segment => ({
          airline: {
            code: segment.carrierCode,
            name: airlineInfo?.commonName || airlineInfo?.businessName || segment.carrierCode
          },
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
        }))
      } : null,
      cabinClass: offer.travelerPricings[0].fareDetailsBySegment[0].cabin,
      bookingClass: offer.travelerPricings[0].fareDetailsBySegment[0].class,
      tier: this.determineTier(
        parseFloat(offer.price.total), 
        offer.travelerPricings[0].fareDetailsBySegment[0].cabin
      ),
      referenceUrl: this.generateBookingUrl(offer)
    };

    return baseTransformation;
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

  public determineTier(price: number, cabinClass: string): 'budget' | 'medium' | 'premium' {
    // First, determine tier by cabin class
    if (cabinClass === 'FIRST' || cabinClass === 'BUSINESS') {
      return 'premium';
    } else if (cabinClass === 'PREMIUM_ECONOMY') {
      return 'medium';
    }

    // For economy class, determine tier by price
    if (price > 1000) {
      return 'premium';
    } else if (price > 500) {
      return 'medium';
    }
    return 'budget';
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
}

export const amadeusService = new AmadeusService(); 