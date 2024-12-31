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