export interface TransformedHotelOffer {
  id: string;
  name: string;
  location: string;
  price: {
    amount: number;
    currency: string;
  };
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
  tier: 'budget' | 'medium' | 'premium';
}

export interface AmadeusHotelOffer {
  id: string;
  name: string;
  rating?: string;
  description?: {
    text: string;
    lang: string;
  };
  amenities?: string[];
  media?: Array<{
    uri: string;
    category: string;
  }>;
  latitude?: string;
  longitude?: string;
  address?: {
    cityName: string;
  };
  offers?: Array<{
    id: string;
    self: string;
    price: {
      total: string;
      currency: string;
    };
    policies?: {
      checkInTime?: string;
      checkOutTime?: string;
      cancellation?: {
        description?: {
          text: string;
        };
      };
    };
  }>;
}

export interface AmadeusHotelSearchParams {
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  roomQuantity: number;
  currency?: string;
  radius?: number;
  ratings?: string;
}

export interface Activity {
  id?: string;
  name: string;
  description?: string;
  duration?: number;
  price?: {
    amount: number;
    currency: string;
  };
  category: string;
  location?: string;
  address?: string;
  timeSlot: string;
  dayNumber: number;
  rating?: number;
  numberOfReviews?: number;
  selected?: boolean;
  images?: Array<{
    source: string;
    url: string;
  }>;
  keyHighlights?: string[];
  openingHours?: string;
  commentary?: string;
  itineraryHighlight?: string;
  availability?: ActivityAvailability;
  bookingDetails?: {
    provider: string;
    productCode: string;
    referenceUrl: string;
    cancellationPolicy: string;
    instantConfirmation: boolean;
    mobileTicket: boolean;
    languages: string[];
    minParticipants?: number;
    maxParticipants?: number;
    pickupIncluded?: boolean;
    pickupLocation?: string;
    accessibility?: string;
    restrictions?: string[];
  };
  tier?: 'budget' | 'medium' | 'premium';
  score?: number;
  startTime?: string;
  endTime?: string;
  preferredTimeOfDay?: string;
  dailyPlan?: {
    dayNumber: number;
    theme: string;
    mainArea: string;
    commentary: string;
    highlights: string[];
    logistics: {
      transportSuggestions: string[];
      walkingDistances: string[];
      timeEstimates: string[];
    };
  };
}

export interface ActivityAvailability {
  isAvailable: boolean;
  operatingHours?: string;
  availableTimeSlots: string[];
  bestTimeToVisit?: string;
  nextAvailableDate?: string;
  verifiedTimeSlot?: string;
  realTimeVerification: {
    verified: boolean;
    exactStartTimes: string[];
    lastChecked: string | null;
  };
  pricing?: {
    amount: number;
    currency: string;
  };
}

export interface TransformActivityParams {
  timeOfDay?: 'morning' | 'afternoon' | 'evening';
  index: number;
  destination: string;
  currency?: string;
}

export interface GenerateActivitiesParams {
  days: number;
  destination: string;
  currency?: string;
  preferences?: {
    travelStyle?: string;
    pacePreference?: string;
    interests?: string[];
    accessibility?: string[];
    dietaryRestrictions?: string[];
  };
} 