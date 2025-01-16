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
  type: string;
  id: string;
  source: string;
  instantTicketingRequired: boolean;
  nonHomogeneous: boolean;
  oneWay: boolean;
  lastTicketingDate: string;
  numberOfBookableSeats: number;
  itineraries: AmadeusItinerary[];
  price: {
    currency: string;
    total: string;
    base: string;
    fees: Array<{
      amount: string;
      type: string;
    }>;
    grandTotal: string;
    billingCurrency?: string;
  };
  pricingOptions: {
    fareType: string[];
    includedCheckedBagsOnly: boolean;
  };
  validatingAirlineCodes: string[];
  travelerPricings: Array<{
    travelerId: string;
    fareOption: string;
    travelerType: string;
    price: {
      currency: string;
      total: string;
      base: string;
    };
    fareDetailsBySegment: Array<{
      segmentId: string;
      cabin: string;
      fareBasis: string;
      brandedFare: string;
      class: string;
      includedCheckedBags: {
        quantity: number;
      };
    }>;
  }>;
  dictionaries?: {
    carriers?: {
      [key: string]: string;
    };
  };
}

export interface AmadeusSegment {
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
  carrierCode: string;
  number: string;
  aircraft: {
    code: string;
  };
  operating?: {
    carrierCode: string;
  };
  duration: string;
  id: string;
  numberOfStops: number;
  blacklistedInEU: boolean;
}

export interface AmadeusItinerary {
  duration: string;
  segments: AmadeusSegment[];
}

export interface AmadeusFare {
  segmentId: string;
  // ... other properties
}

export interface HotelSearchParams {
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  roomQuantity?: number;
  adults?: number;
  radius?: number;
  radiusUnit?: string;
  hotelName?: string;
  priceRange?: string;
  currency?: string;
  ratings?: string[];
  amenities?: string[];
}

export interface AmadeusHotelOffer {
  id: string;
  hotelId: string;
  name: string;
  description?: {
    text: string;
    lang: string;
  };
  available: boolean;
  offers: Array<{
    id: string;
    checkInDate: string;
    checkOutDate: string;
    rateCode: string;
    rateFamilyEstimated?: {
      code: string;
      type: string;
    };
    room: {
      type: string;
      typeEstimated: {
        category: string;
        beds: number;
        bedType: string;
      };
      description: {
        text: string;
        lang: string;
      };
    };
    guests: {
      adults: number;
      childAges?: number[];
    };
    price: {
      currency: string;
      base: string;
      total: string;
      taxes?: Array<{
        code: string;
        amount: string;
        currency: string;
        included: boolean;
      }>;
    };
    policies: {
      guarantee?: {
        acceptedPayments: {
          methods: string[];
          cards: string[];
        };
      };
      paymentType: string;
      cancellation?: {
        deadline: string;
        description?: {
          text: string;
          lang: string;
        };
      };
    };
  }>;
  self: string;
}

export interface TransformedHotelOffer {
  id: string;
  hotelId: string;
  name: string;
  description: string;
  available: boolean;
  checkInDate: string;
  checkOutDate: string;
  roomType: string;
  bedType: string;
  numBeds: number;
  tier: string;
  price: {
    currency: string;
    total: number;
    perNight: number;
    amount: number;
  };
  cancellationPolicy?: {
    deadline: string;
    description: string;
  };
  amenities: string[];
  rating?: number;
  location: {
    latitude: number;
    longitude: number;
    address: string;
  };
  images: string[];
} 