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

export interface TravelPreferences {
  travelStyle: string;
  pacePreference: string;
  interests: string[];
  accessibility: string[];
  dietaryRestrictions: string[];
}

export const DEFAULT_PREFERENCES: TravelPreferences = {
  travelStyle: 'medium',
  pacePreference: 'moderate',
  interests: ['Cultural & Historical', 'Nature & Adventure'],
  accessibility: [],
  dietaryRestrictions: []
}; 