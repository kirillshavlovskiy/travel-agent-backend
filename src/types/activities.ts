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
  id?: string;
  name: string;
  description?: string;
  duration?: number | { min: number; max: number };
  price?: Price;
  rating?: number;
  numberOfReviews?: number;
  category: string;
  location?: string;
  address?: string;
  images?: string[];
  referenceUrl?: string;
  bookingInfo?: {
    cancellationPolicy?: string;
    instantConfirmation?: boolean;
    mobileTicket?: boolean;
    languages?: string[];
    minParticipants?: number;
    maxParticipants?: number;
  };
  timeSlot: TimeSlotKey;
  dayNumber: number;
  commentary?: string;
  itineraryHighlight?: string;
  keyHighlights?: string[];
  selected?: boolean;
  tier?: string;
  preferenceScore?: number;
  matchedPreferences?: string[];
  date?: string;
  timeSlotVerification?: TimeSlotVerification;
  bestTimeToVisit?: string;
  availability?: {
    isAvailable: boolean;
    operatingHours?: string;
    availableTimeSlots: TimeSlotKey[];
    bestTimeToVisit?: string;
    nextAvailableDate?: string;
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