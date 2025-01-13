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
  };
}

export interface FlightSegment {
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

export interface AirlineInfo {
  type?: string;
  iataCode?: string;
  icaoCode?: string;
  businessName?: string;
  commonName: string;
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
  itineraries: Array<{
    duration: string;
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
    }>;
  }>;
  price: {
    currency: string;
    total: string;
    base: string;
    fees: Array<{
      amount: string;
      type: string;
    }>;
    grandTotal: string;
    additionalServices?: Array<{
      amount: string;
      type: string;
    }>;
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
      brandedFare?: string;
      class: string;
      includedCheckedBags: {
        quantity: number;
      };
    }>;
  }>;
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

export interface AmadeusHotelOffer {
  id: string;
  hotelId: string;
  hotel: {
    name: string;
    rating?: string;
    amenities?: string[];
    address?: {
      cityName?: string;
    };
    latitude?: string;
    longitude?: string;
    media?: Array<{
      uri: string;
    }>;
  };
  offers: Array<{
    price: {
      total: string;
    };
    policies?: {
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
}

export interface TransformedHotelOffer {
  name: string;
  location: string;
  price: {
    amount: number;
    currency: string;
  };
  tier: string;
  type: string;
  amenities: string;
  rating: number;
  reviewScore: number;
  reviewCount: number;
  images: string[];
  referenceUrl: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  features: string[];
  policies: {
    checkIn: string;
    checkOut: string;
    cancellation: string;
  };
}

export interface HotelSearchParams {
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  roomQuantity?: number;
  radius?: number;
  currency?: string;
  priceRange?: {
    min: number;
    max: number;
  };
  ratings?: string[];
} 