import { AmadeusAmenity, AmadeusFareDetail, AmadeusService } from './amadeus.js';

export interface FlightSegment {
  airline: string;
  flightNumber: string;
  aircraft: {
    code: string;
    name?: string;
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

export interface FlightDetails {
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
    perTraveler?: number;
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
      perTraveler?: number;
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
    inbound?: {
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
    fareDetailsBySegment: Array<{
      cabin: string;
      class: string;
      includedCheckedBags?: {
        quantity: number;
        weight?: number;
        weightUnit?: string;
      };
      brandedFare?: string;
      brandedFareLabel?: string;
      fareBasis: string;
      amenities?: Array<{
        description: string;
        isChargeable: boolean;
        amenityType: string;
        amenityProvider: {
          name: string;
        };
      }>;
    }>;
    services?: Array<{
      name: string;
      description?: string;
      isChargeable: boolean;
    }>;
    policies?: {
      cancellation?: string;
      changes?: string;
      refund?: string;
      checkedBags?: number;
      carryOn?: number;
      seatSelection?: boolean;
    };
    amenities?: Array<{
      description: string;
      isChargeable: boolean;
      amenityType: string;
      amenityProvider: {
        name: string;
      };
    }>;
  };
}

export interface FlightReference {
  id: string;
  airline: string;
  airlineCode: string;
  flightNumber: string;
  route: string;
  outbound: string;
  inbound?: string;
  duration: string;
  layovers: number;
  price: {
    amount: number;
    currency?: string;
    perTraveler?: number;
    numberOfTravelers?: number;
  };
  tier: 'budget' | 'medium' | 'premium';
  referenceUrl: string;
  cabinClass: string;
  bookingClass: string;
  segments: FlightSegment[];
  returnSegments?: FlightSegment[];
  dictionaries?: {
    carriers?: Record<string, string>;
    aircraft?: Record<string, string>;
    currencies?: Record<string, string>;
    locations?: Record<string, {
      cityCode: string;
      countryCode: string;
    }>;
  };
}

export interface GroupedFlights {
  budget: {
    min: number;
    max: number;
    average: number;
    confidence: number;
    source: string;
    references: Array<{
      id: string;
      airline: string;
      cabinClass?: string;
      price: {
        amount: number;
        currency: string;
        numberOfTravelers: number;
      };
      details: {
        outbound?: {
          duration: string;
          segments: Array<{
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
            flightNumber: string;
            aircraft: {
              code: string;
            };
            airline: {
              code: string;
              name: string;
            };
          }>;
        };
        inbound?: {
          duration: string;
          segments: Array<{
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
            flightNumber: string;
            aircraft: {
              code: string;
            };
            airline: {
              code: string;
              name: string;
            };
          }>;
        };
      };
    }>;
  };
  medium: {
    min: number;
    max: number;
    average: number;
    confidence: number;
    source: string;
    references: Array<{
      id: string;
      airline: string;
      cabinClass?: string;
      price: {
        amount: number;
        currency: string;
        numberOfTravelers: number;
      };
      details: {
        outbound?: {
          duration: string;
          segments: Array<{
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
            flightNumber: string;
            aircraft: {
              code: string;
            };
            airline: {
              code: string;
              name: string;
            };
          }>;
        };
        inbound?: {
          duration: string;
          segments: Array<{
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
            flightNumber: string;
            aircraft: {
              code: string;
            };
            airline: {
              code: string;
              name: string;
            };
          }>;
        };
      };
    }>;
  };
  premium: {
    min: number;
    max: number;
    average: number;
    confidence: number;
    source: string;
    references: Array<{
      id: string;
      airline: string;
      cabinClass?: string;
      price: {
        amount: number;
        currency: string;
        numberOfTravelers: number;
      };
      details: {
        outbound?: {
          duration: string;
          segments: Array<{
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
            flightNumber: string;
            aircraft: {
              code: string;
            };
            airline: {
              code: string;
              name: string;
            };
          }>;
        };
        inbound?: {
          duration: string;
          segments: Array<{
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
            flightNumber: string;
            aircraft: {
              code: string;
            };
            airline: {
              code: string;
              name: string;
            };
          }>;
        };
      };
    }>;
  };
} 