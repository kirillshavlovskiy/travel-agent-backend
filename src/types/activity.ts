export interface Activity {
  id?: string;
  name: string;
  description: string;
  duration: number;
  price: {
    amount: number;
    currency: string;
  };
  category: string;
  location: string;
  timeSlot: 'morning' | 'afternoon' | 'evening';
  dayNumber: number;
  selected?: boolean;
  tier?: 'budget' | 'medium' | 'premium';
  rating?: number;
  numberOfReviews?: number;
  highlights?: string[];
  commentary?: string;
  itineraryHighlight?: string;
  keyHighlights?: string[];
  scoringReason?: string;
  preferenceScore?: number;
  matchedPreferences?: string[];
  openingHours?: string;
  referenceUrl?: string;
  productCode?: string;
  date?: string;
  images?: Array<{
    source: string;
    url: string;
  }>;
  bookingDetails?: {
    provider: string;
    productCode: string;
    referenceUrl: string;
    cancellationPolicy?: string;
    instantConfirmation?: boolean;
    mobileTicket?: boolean;
    languages?: string[];
    minParticipants?: number;
    maxParticipants?: number;
    pickupIncluded?: boolean;
    pickupLocation?: string;
    accessibility?: string;
    restrictions?: string[];
    description?: string;
    price?: {
      amount: number;
      currency: string;
    };
  };
  availability?: {
    isAvailable: boolean;
    availableTimeSlots: string[];
    operatingHours?: string;
    bestTimeToVisit?: string;
    nextAvailableDate?: string;
    verifiedTimeSlot?: string;
    realTimeVerification?: {
      verified: boolean;
      exactStartTimes: string[];
      lastChecked: string;
      reason?: string;
      pricing?: {
        fromPrice: number;
        currency: string;
      };
    };
    tripPeriodAvailability?: {
      availableDates: string[];
      availabilityByDate: Record<string, string[]>;
      operatingDays: string[];
      operatingHours: Record<string, string[]>;
    };
  };
  timeSlotVerification?: {
    isAvailable: boolean;
    recommendedTimeSlot: 'morning' | 'afternoon' | 'evening';
    availableTimeSlots: ('morning' | 'afternoon' | 'evening')[];
  };
}

export interface GenerateActivitiesParams {
    destination: string;
    destinationId: string;
    budget: number;
    startDate?: string;
    endDate?: string;
    preferences?: {
        travelStyle?: string;
        pacePreference?: string;
        interests?: string[];
        accessibility?: string[];
        dietaryRestrictions?: string[];
    };
} 