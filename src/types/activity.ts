export type TimeSlot = 'morning' | 'afternoon' | 'evening';
export type ActivityTier = 'budget' | 'medium' | 'premium';
export type ActivityCategory = 'Cultural & Historical' | 'Nature & Adventure' | 'Food & Entertainment' | 'Lifestyle & Local';

export interface Activity {
  id?: string;
  name: string;
  description: string;
  duration: number;
  price: number;
  category: ActivityCategory;
  location: string;
  address?: string;
  zone?: string;
  keyHighlights?: string[];
  openingHours?: string;
  rating?: number;
  numberOfReviews?: number;
  timeSlot: TimeSlot;
  dayNumber: number;
  startTime?: string;
  referenceUrl?: string;
  images?: string[];
  selected: boolean;
  commentary?: string;
  itineraryHighlight?: string;
  tier?: ActivityTier;
  bookingInfo?: {
    provider: string;
    cancellationPolicy: string;
    instantConfirmation: boolean;
    mobileTicket: boolean;
    languages: string[];
    minParticipants: number;
    maxParticipants: number;
  };
} 