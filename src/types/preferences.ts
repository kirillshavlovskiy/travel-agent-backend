export interface TripPreferences {
  destination: string;
  duration: number;
  budget: number;
  currency: string;
  travelStyle: 'budget' | 'moderate' | 'luxury';
  interests: string[];
  flightTimes?: {
    arrival: string;
    departure: string;
  };
} 