export type TimeSlotKey = 'morning' | 'afternoon' | 'evening';

export interface Price {
  amount: number;
  currency: string;
}

export interface TimeSlotVerification {
  isAvailable: boolean;
  recommendedTimeSlot: TimeSlotKey;
  availableTimeSlots: TimeSlotKey[];
  operatingHours?: string;
  bestTimeToVisit?: string;
}

export interface Activity {
  id: string;
  name: string;
  description: string;
  duration: string;
  price: {
    amount: number;
    currency: string;
  };
  category: string;
  location: {
    name: string;
    address: string;
    coordinates?: {
      latitude: number;
      longitude: number;
    };
    type: string;
  };
  timeSlot: string;
  dayNumber: number;
  startTime: string;
  rating: number;
  numberOfReviews: number;
  isVerified: boolean;
  verificationStatus: 'verified' | 'pending' | 'unverified';
  tier: 'budget' | 'standard' | 'premium' | 'luxury';
  referenceUrl: string;
  productCode: string;
  images: string[];
  contactInfo: {
    phone: string;
    website: string;
    address: string;
  };
  preferenceScore: number;
  matchedPreferences: string[];
  scoringReason: string;
  selected: boolean;
  suggestedOption: boolean;
  viatorDetails: {
    productUrl: string;
    bookingUrl: string;
    highlights: string[];
    inclusions: string[];
    exclusions: string[];
    cancellationPolicy: string;
    reviews: {
      rating: number;
      totalReviews: number;
      breakdown: Array<{
        stars: number;
        count: number;
      }>;
    };
    itinerary: {
      type: string;
      duration: string;
      items: Array<{
        description: string;
        duration: number;
        location?: {
          name: string;
          address: string;
          coordinates?: {
            latitude: number;
            longitude: number;
          };
        };
      }>;
    };
    meetingPoint: {
      name: string;
      address: string;
      coordinates: {
        latitude: number;
        longitude: number;
      } | null;
    };
  };
  bookingInfo: {
    provider: string;
    productCode: string;
    cancellationPolicy: string;
    instantConfirmation: boolean;
    mobileTicket: boolean;
    languages: string[];
    minParticipants: number;
    maxParticipants: number;
    pickupIncluded: boolean;
    pickupLocation: string;
    accessibility: string[];
    restrictions: string[];
  };
}

export interface EnrichedActivity extends Activity {
  timeSlot: string;
  dayNumber: number;
  selected: boolean;
}

export interface GenerateActivitiesParams {
  destination: string;
  days: number;
  budget: number;
  currency: string;
  flightTimes?: {
    arrival: string;
    departure: string;
  };
}

export interface PerplexityResponse {
  activities: Array<{
    dayNumber: number;
    timeSlot: string;
    name: string;
  }>;
} 