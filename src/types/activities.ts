export interface Activity {
  name: string;
  timeSlot: string;
  category: string;
  dayNumber: number;
  expectedDuration: string;
  selected: boolean;
  location?: string;
  rating?: number;
  numberOfReviews?: number;
  price?: number;
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