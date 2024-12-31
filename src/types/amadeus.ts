export interface AmadeusService {
  name: string;
  description?: string;
  isChargeable?: boolean;
}

export interface AmadeusAmenity {
  description: string;
  isChargeable: boolean;
  amenityType: string;
  amenityProvider: {
    name: string;
  };
}

export interface AmadeusFareDetail {
  segmentId: string;
  cabin: string;
  fareBasis: string;
  brandedFare?: string;
  brandedFareLabel?: string;
  class: string;
  includedCheckedBags: {
    quantity: number;
    weight?: number;
    weightUnit?: string;
  };
  amenities?: AmadeusAmenity[];
}

export interface AmadeusFlightOffer {
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
      aircraft: {
        code: string;
      };
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
      segmentId: string;
      cabin: string;
      class: string;
      includedCheckedBags: {
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
  }>;
  dictionaries?: {
    aircraft: Record<string, string>;
    carriers: Record<string, string>;
    currencies: Record<string, string>;
    locations: Record<string, { cityCode: string; countryCode: string; }>;
  };
}; 