import path from 'path';
import fs from 'fs';
import { Activity, TripPreferences } from '../types';
import { logger } from '../utils/logger';

interface TimeSlot {
  timeSlot: string;
  startTime: string;
}

interface DailyActivityCounts {
  [day: number]: number;
}

interface TimeSlotDistribution {
  [timeSlot: string]: number;
}

interface EnrichmentStats {
  withAvailability: number;
  withTimeSlotVerification: number;
  withCommentary: number;
  withItineraryHighlight: number;
  withBookingDetails: number;
  withReviews: number;
  withProductDetails: number;
  withItinerary: number;
  totalActivities: number;
}

export class ScheduleService {
  // ... rest of the existing code ...
} 