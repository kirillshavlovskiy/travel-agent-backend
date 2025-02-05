export interface Activity {
  name: string;
  description: string;
  timeSlot: string;
  category: string;
  dayNumber: number;
  duration: number;
  selected: boolean;
  location: string;
  rating?: number;
  numberOfReviews?: number;
  price: {
    amount: number;
    currency: string;
  };
  address?: string;
  images?: string[];
  referenceUrl?: string;
  bookingInfo?: {
    productCode: string;
    cancellationPolicy: string;
    instantConfirmation: boolean;
    mobileTicket: boolean;
    languages: string[];
    minParticipants: number;
    maxParticipants: number;
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