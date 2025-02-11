import { Activity, EnrichedActivity } from '../types/activities';
import { TripPreferences } from '../types/preferences';
import { logger } from '../utils/logger';
import { ViatorService } from './viator';
import { perplexityClient } from './perplexity';

interface TimeSlotVerification {
  isValid: boolean;
  reason?: string;
}

interface TimeSlotConfig {
  start: string;
  end: string;
  maxDuration: number;
}

interface DaySlots {
  morning: TimeSlotConfig;
  afternoon: TimeSlotConfig;
  evening: TimeSlotConfig;
}

interface ActivityScore {
  activity: Activity;
  score: number;
  preferredTimeSlot: string;
  duration: number;
}

interface TimeSlotStatus {
  filled: boolean;
  maxDuration: number;
}

type TimeSlot = 'morning' | 'afternoon' | 'evening';
type DayTimeSlots = Record<TimeSlot, TimeSlotStatus>;

interface OptimizedActivity extends Activity {
  score: number;
  preferredTimeSlot: string;
  duration: number;
}

function scoreActivity(activity: Activity, preferences: TripPreferences): ActivityScore {
  let score = 0;
  let preferredTimeSlot = 'afternoon'; // default
  
  // Base score from rating (0-5 scale, weighted heavily)
  score += (activity.rating || 0) * 2;
  
  // Number of reviews factor (normalize to 0-1 and weight)
  const reviewScore = Math.min(activity.numberOfReviews || 0, 1000) / 1000;
  score += reviewScore;
  
  // Price tier alignment with travel style
  const priceScore = calculatePriceScore(activity, preferences.travelStyle);
  score += priceScore;
  
  // Determine preferred time slot based on activity type and description
  preferredTimeSlot = determinePreferredTimeSlot(activity);
  
  // Duration factor - prefer activities that fit well within time slots
  const duration = activity.duration || estimateActivityDuration(activity);
  const durationScore = calculateDurationScore(duration);
  score += durationScore;

  return {
    activity,
    score,
    preferredTimeSlot,
    duration
  };
}

function calculatePriceScore(activity: Activity, travelStyle: string): number {
  const price = activity.price?.amount || 0;
  
  // Define price ranges for different tiers
  const priceRanges = {
    budget: { min: 0, max: 50 },
    moderate: { min: 51, max: 150 },
    luxury: { min: 151, max: Infinity }
  };
  
  // Match price to travel style
  if (travelStyle === 'budget' && price <= priceRanges.budget.max) return 1;
  if (travelStyle === 'moderate' && price >= priceRanges.moderate.min && price <= priceRanges.moderate.max) return 1;
  if (travelStyle === 'luxury' && price >= priceRanges.luxury.min) return 1;
  
  return 0;
}

function determinePreferredTimeSlot(activity: Activity): string {
  const title = activity.name.toLowerCase();
  const description = activity.description?.toLowerCase() || '';
  
  // Evening activities
  if (title.includes('dinner') || 
      title.includes('night') || 
      title.includes('evening') ||
      description.includes('evening tour') ||
      description.includes('night tour')) {
    return 'evening';
  }
  
  // Morning activities
  if (title.includes('breakfast') || 
      title.includes('morning') ||
      description.includes('early morning') ||
      description.includes('sunrise')) {
    return 'morning';
  }
  
  // Cultural activities prefer morning/afternoon
  if (activity.category === 'Cultural & Historical') {
    return 'morning';
  }
  
  // Food & entertainment activities prefer afternoon/evening
  if (activity.category === 'Food & Entertainment') {
    return 'evening';
  }
  
  return 'afternoon'; // default
}

function estimateActivityDuration(activity: Activity): number {
  // If duration is explicitly provided, use it
  if (activity.duration) return activity.duration;
  
  // Estimate based on category and type
  const category = activity.category;
  switch(category) {
    case 'Cultural & Historical':
      return 3; // Museums, historical sites typically take 2-3 hours
    case 'Nature & Adventure':
      return 4; // Outdoor activities usually take longer
    case 'Food & Entertainment':
      return 2; // Food tours, shows typically 2 hours
    default:
      return 2; // Default duration
  }
}

function calculateDurationScore(duration: number): number {
  // Prefer activities that fit well within time slots (typically 3-4 hours)
  if (duration >= 2 && duration <= 4) return 1;
  if (duration < 2) return 0.5; // Too short
  return -0.5; // Too long
}

async function enrichViatorActivity(
  activity: Activity,
  timeSlot: string,
  dayNumber: number,
  preferences: TripPreferences
): Promise<EnrichedActivity> {
  logger.info('[Activity Enrichment] Processing activity:', {
    name: activity.name,
    dayNumber,
    timeSlot,
    originalDetails: {
      price: activity.price,
      category: activity.category,
      rating: activity.rating,
      location: activity.location
    }
  });

  const enriched = {
    ...activity,
    timeSlot,
    dayNumber,
    selected: false
  };

  logger.info('[Activity Enrichment] Activity enriched:', {
    name: enriched.name,
    dayNumber: enriched.dayNumber,
    timeSlot: enriched.timeSlot,
    enrichedDetails: {
      price: enriched.price,
      category: enriched.category,
      rating: enriched.rating,
      location: enriched.location,
      isVerified: enriched.isVerified,
      verificationStatus: enriched.verificationStatus,
      referenceUrl: enriched.referenceUrl,
      images: enriched.images?.length || 0,
      contactInfo: enriched.contactInfo
    }
  });

  return enriched;
}

function determineTier(price: number): string {
  if (price <= 50) return 'budget';
  if (price <= 150) return 'moderate';
  return 'luxury';
}

function getDateForDay(dayNumber: number, preferences: TripPreferences): string {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + dayNumber - 1);
  return startDate.toISOString().split('T')[0];
}

function optimizeInternally(
  activities: Array<{activity: Activity; score: number}>, 
  preferences: TripPreferences
): OptimizedActivity[] {
  return activities
    // Filter long durations
    .filter(({activity}) => {
      const durationInHours = activity.duration / 60;
      return durationInHours <= 8; // No multi-day activities
    })
    // Deduplicate by product code or similar name/location
    .filter((activity, index, self) => 
      index === self.findIndex(a => (
        a.activity.bookingInfo?.productCode === activity.activity.bookingInfo?.productCode ||
        (a.activity.name === activity.activity.name && 
         a.activity.location === activity.activity.location)
      ))
    )
    // Transform to OptimizedActivity format
    .map(({activity, score}) => ({
      ...activity,
      score,
      preferredTimeSlot: determinePreferredTimeSlot(activity),
      duration: activity.duration || estimateActivityDuration(activity)
    }))
    // Sort by score
    .sort((a, b) => b.score - a.score);
}

function generateSchedulePrompt(
  activities: OptimizedActivity[], 
  preferences: TripPreferences
): string {
  return `Optimize this schedule for ${preferences.duration} days in ${preferences.destination}.

Available Activities (pre-scored and filtered):
${activities.map(a => `- ${a.name} (Score: ${a.score}, Duration: ${a.duration}h, Category: ${a.category}, Price: ${a.price?.amount || 0} ${a.price?.currency || 'USD'})`).join('\n')}

Requirements:
1. Create a balanced schedule across ${preferences.duration} days
2. Respect activity scores (higher scored activities should be prioritized)
3. Consider geographic proximity within each day
4. Balance activity types across the trip
5. Ensure activities fit within time slots (morning: 9-13, afternoon: 14-18, evening: 19-23)
6. Keep daily budget around ${preferences.budget} ${preferences.currency}
7. Match travel style: ${preferences.travelStyle}
8. Consider user interests: ${preferences.interests.join(', ')}

Return a schedule as a JSON array of days, each containing activities with their time slots.`;
}

interface PerplexityScheduleResponse {
  schedule: Array<{
    dayNumber: number;
    activities: Array<{
      name: string;
      timeSlot: string;
    }>;
  }>;
}

interface PerplexityResponse {
  activities: Array<{
    dayNumber: number;
    timeSlot: string;
    name: string;
  }>;
}

async function optimizeSchedule(
  scoredActivities: Array<{activity: Activity; score: number}>,
  preferences: TripPreferences
): Promise<EnrichedActivity[][]> {
  logger.info('[Optimization] Starting schedule optimization with:', {
    totalActivities: scoredActivities.length,
    duration: preferences.duration,
    budget: preferences.budget
  });

  // 1. First do internal optimization
  const internallyOptimized = optimizeInternally(scoredActivities, preferences);
  
  logger.info('[Optimization] Internal optimization complete:', {
    originalCount: scoredActivities.length,
    optimizedCount: internallyOptimized.length,
    topScores: internallyOptimized.slice(0, 5).map(a => ({
      name: a.name,
      score: a.score
    }))
  });

  // 2. Create schedule using optimized activities
  const schedule: EnrichedActivity[][] = [];
  const usedActivities = new Set<string>();
  
  // Create a schedule for each day
  for (let day = 1; day <= preferences.duration; day++) {
    const dayActivities: EnrichedActivity[] = [];
    let dayBudget = preferences.budget;

    // Try to fill each time slot
    for (const timeSlot of ['morning', 'afternoon', 'evening'] as const) {
      // Find available activities for this slot
      const availableActivities = internallyOptimized
        .filter(activity => {
          const activityKey = `${activity.name}-${activity.location}`;
          const price = activity.price?.amount || 0;
          return !usedActivities.has(activityKey) && 
                 price <= dayBudget &&
                 activity.preferredTimeSlot === timeSlot;
        })
        .sort((a, b) => b.score - a.score);

      if (availableActivities.length > 0) {
        const chosen = availableActivities[0];
        const enrichedActivity = await enrichViatorActivity(
          chosen,
          timeSlot,
          day,
          preferences
        );
        dayActivities.push(enrichedActivity);
        usedActivities.add(`${chosen.name}-${chosen.location}`);
        dayBudget -= chosen.price?.amount || 0;
      }
    }
    
    schedule.push(dayActivities);
  }

  logger.info('[Optimization] Final schedule:', {
    days: schedule.length,
    totalActivities: schedule.reduce((sum, day) => sum + day.length, 0),
    byDay: schedule.map((day, i) => ({
      day: i + 1,
      activities: day.map(a => ({
        name: a.name,
        timeSlot: a.timeSlot,
        price: a.price
      }))
    }))
  });

  return schedule;
}

async function createFallbackSchedule(
  activities: OptimizedActivity[], 
  preferences: TripPreferences
): Promise<EnrichedActivity[][]> {
  const schedule: EnrichedActivity[][] = [];
  const usedActivities = new Set<string>();
  
  for (let day = 0; day < preferences.duration; day++) {
    const dayActivities: EnrichedActivity[] = [];
    let dayBudget = preferences.budget;

    // Try to fill each time slot
    for (const timeSlot of ['morning', 'afternoon', 'evening'] as const) {
      const availableActivities = activities
        .filter(activity => {
          const activityKey = `${activity.name}-${activity.location}`;
          const price = activity.price?.amount || 0;
          return !usedActivities.has(activityKey) && 
                 price <= dayBudget &&
                 activity.preferredTimeSlot === timeSlot;
        })
        .sort((a, b) => b.score - a.score);

      if (availableActivities.length > 0) {
        const chosen = availableActivities[0];
        const enrichedActivity = await enrichViatorActivity(
          chosen,
          timeSlot,
          day + 1,
          preferences
        );
        dayActivities.push(enrichedActivity);
        usedActivities.add(`${chosen.name}-${chosen.location}`);
        dayBudget -= chosen.price?.amount || 0;
      }
    }
    
    schedule.push(dayActivities);
  }

  return schedule;
}

export async function transformActivities(activities: any[], destination: string): Promise<Activity[]> {
  const viatorService = new ViatorService();
  const enrichedActivities: Activity[] = [];

  for (const activity of activities) {
    try {
      // Enrich with Viator data
      const viatorData = await viatorService.searchActivity({
        name: activity.name,
        destination: destination
      });

      const enriched = {
        id: `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: activity.name,
        description: activity.description || viatorData?.description || 'No description available',
        duration: activity.duration?.toString() || viatorData?.duration?.toString() || '2',
        price: {
          amount: activity.price?.amount || viatorData?.price?.amount || 0,
          currency: activity.price?.currency || viatorData?.price?.currency || 'USD'
        },
        category: activity.category || viatorData?.category || 'General',
        location: {
          name: activity.location?.name || viatorData?.location?.name || destination,
          address: activity.location?.address || viatorData?.location?.address || 'Address to be confirmed',
          coordinates: viatorData?.location?.coordinates || activity.location?.coordinates,
          type: 'activity'
        },
        timeSlot: activity.timeSlot || 'morning',
        dayNumber: activity.dayNumber || 1,
        startTime: activity.startTime || {
          morning: '09:00',
          afternoon: '14:00',
          evening: '19:00'
        }[activity.timeSlot || 'morning'],
        rating: viatorData?.rating || activity.rating || 4.0,
        numberOfReviews: viatorData?.numberOfReviews || activity.numberOfReviews || 0,
        isVerified: viatorData?.isVerified || activity.isVerified || false,
        verificationStatus: viatorData?.verificationStatus || activity.verificationStatus || 'pending',
        tier: activity.tier || determineTier(activity.price?.amount || 0),
        referenceUrl: viatorData?.urls?.productUrl || '',
        productCode: viatorData?.productCode || '',
        images: viatorData?.images || [],
        contactInfo: {
          phone: viatorData?.contactInfo?.phone || '',
          website: viatorData?.urls?.productUrl || '',
          address: viatorData?.location?.address || ''
        },
        preferenceScore: activity.preferenceScore || 0,
        matchedPreferences: activity.matchedPreferences || [],
        scoringReason: activity.scoringReason || '',
        selected: activity.selected || false,
        suggestedOption: activity.suggestedOption || false,
        viatorDetails: {
          productUrl: viatorData?.urls?.productUrl || '',
          bookingUrl: viatorData?.urls?.bookingUrl || '',
          mainImageUrl: viatorData?.urls?.mainImageUrl || '',
          mobileUrl: viatorData?.urls?.mobileUrl || '',
          deepLink: viatorData?.urls?.deepLink || '',
          highlights: viatorData?.highlights || [],
          inclusions: viatorData?.includedItems?.included || [],
          exclusions: viatorData?.includedItems?.excluded || [],
          cancellationPolicy: viatorData?.cancellationPolicy?.description || 'Standard cancellation policy',
          reviews: {
            rating: viatorData?.rating || 0,
            totalReviews: viatorData?.numberOfReviews || 0,
            breakdown: viatorData?.reviews?.breakdown || []
          },
          itinerary: viatorData?.itinerary || {
            type: 'STANDARD',
            duration: activity.duration,
            items: []
          },
          meetingPoint: viatorData?.meetingPoint || {
            name: 'To be confirmed',
            address: 'To be confirmed',
            coordinates: null
          }
        },
        bookingInfo: {
          provider: 'Viator',
          productCode: viatorData?.productCode || '',
          cancellationPolicy: viatorData?.bookingInfo?.cancellationPolicy || 'Free cancellation available',
          instantConfirmation: viatorData?.bookingInfo?.instantConfirmation || true,
          mobileTicket: viatorData?.bookingInfo?.mobileTicket || true,
          languages: viatorData?.bookingInfo?.languages || ['English'],
          minParticipants: viatorData?.bookingInfo?.minParticipants || 1,
          maxParticipants: viatorData?.bookingInfo?.maxParticipants || 999,
          pickupIncluded: viatorData?.bookingInfo?.pickupIncluded || false,
          pickupLocation: viatorData?.bookingInfo?.pickupLocation || '',
          accessibility: viatorData?.bookingInfo?.accessibility || [],
          restrictions: viatorData?.bookingInfo?.restrictions || []
        }
      };

      enrichedActivities.push(enriched);

      // Log enrichment success with detailed information
      logger.info('Activity enriched with Viator details', {
        name: enriched.name,
        productCode: enriched.productCode,
        viatorUrls: {
          product: enriched.viatorDetails.productUrl,
          booking: enriched.viatorDetails.bookingUrl,
          mobile: enriched.viatorDetails.mobileUrl,
          deepLink: enriched.viatorDetails.deepLink
        },
        bookingInfo: enriched.bookingInfo,
        reviews: enriched.viatorDetails.reviews,
        enrichmentStatus: 'success'
      });

    } catch (error) {
      logger.error('Failed to enrich activity with Viator data', {
        activity: activity.name,
        error: error.message
      });
      
      // Add activity with basic data even if enrichment fails
      enrichedActivities.push({
        id: `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: activity.name,
        description: activity.description || 'No description available',
        duration: activity.duration || '2',
        price: {
          amount: activity.price?.amount || 0,
          currency: activity.price?.currency || 'USD'
        },
        category: activity.category || 'General',
        location: {
          name: destination,
          address: 'Address to be confirmed',
          type: 'activity'
        },
        timeSlot: activity.timeSlot || 'morning',
        dayNumber: activity.dayNumber || 1,
        startTime: activity.startTime || '09:00',
        rating: 4.0,
        numberOfReviews: 0,
        isVerified: false,
        verificationStatus: 'pending',
        tier: activity.tier || 'budget',
        preferenceScore: activity.preferenceScore || 0,
        matchedPreferences: activity.matchedPreferences || [],
        scoringReason: activity.scoringReason || '',
        selected: activity.selected || false,
        viatorDetails: {
          productUrl: '',
          bookingUrl: '',
          mainImageUrl: '',
          mobileUrl: '',
          deepLink: '',
          highlights: [],
          inclusions: [],
          exclusions: [],
          cancellationPolicy: 'Standard cancellation policy',
          reviews: {
            rating: 0,
            totalReviews: 0,
            breakdown: []
          },
          itinerary: {
            type: 'STANDARD',
            duration: activity.duration,
            items: []
          },
          meetingPoint: {
            name: 'To be confirmed',
            address: 'To be confirmed',
            coordinates: null
          }
        },
        bookingInfo: {
          provider: 'Viator',
          productCode: '',
          cancellationPolicy: 'Free cancellation available',
          instantConfirmation: true,
          mobileTicket: true,
          languages: ['English'],
          minParticipants: 1,
          maxParticipants: 999,
          pickupIncluded: false,
          pickupLocation: '',
          accessibility: [],
          restrictions: []
        }
      });
    }
  }

  return enrichedActivities;
}

async function balanceActivityDistribution(activities: Activity[], params: ActivityGenerationParams): Promise<Activity[]> {
  const balancedActivities = [...activities];
  const timeSlots = ['morning', 'afternoon', 'evening'];
  const daysCount = params.days;
  
  // Target count per time slot per day
  const targetPerSlot = Math.ceil(activities.length / (daysCount * 3));
  
  // Initialize counters
  const distribution: Record<number, Record<string, number>> = {};
  for (let day = 1; day <= daysCount; day++) {
    distribution[day] = {
      morning: 0,
      afternoon: 0,
      evening: 0
    };
  }
  
  // Count current distribution
  balancedActivities.forEach(activity => {
    if (activity.dayNumber && activity.timeSlot) {
      distribution[activity.dayNumber][activity.timeSlot]++;
    }
  });
  
  // Balance activities across time slots
  balancedActivities.forEach(activity => {
    if (!activity.timeSlot || distribution[activity.dayNumber][activity.timeSlot] > targetPerSlot) {
      // Find the time slot with the lowest count for this day
      const slots = timeSlots.map(slot => ({
        slot,
        count: distribution[activity.dayNumber][slot]
      }));
      slots.sort((a, b) => a.count - b.count);
      
      // Assign to the slot with lowest count
      const newSlot = slots[0].slot;
      activity.timeSlot = newSlot;
      distribution[activity.dayNumber][newSlot]++;
    }
  });
  
  // Log the balancing results
  logger.info('Activity distribution balanced', {
    tags: ['optimization', 'balance'],
    data: {
      target_per_slot: targetPerSlot,
      final_distribution: distribution,
      by_time_slot: {
        morning: balancedActivities.filter(a => a.timeSlot === 'morning').length,
        afternoon: balancedActivities.filter(a => a.timeSlot === 'afternoon').length,
        evening: balancedActivities.filter(a => a.timeSlot === 'evening').length
      },
      balance_metrics: {
        variance: calculateDistributionVariance(balancedActivities),
        evenness_score: calculateEvennessScore(balancedActivities)
      }
    }
  });

  return balancedActivities;
}

function calculateDistributionVariance(activities: Activity[]): number {
  const counts = {
    morning: activities.filter(a => a.timeSlot === 'morning').length,
    afternoon: activities.filter(a => a.timeSlot === 'afternoon').length,
    evening: activities.filter(a => a.timeSlot === 'evening').length
  };
  
  const mean = (counts.morning + counts.afternoon + counts.evening) / 3;
  const variance = (
    Math.pow(counts.morning - mean, 2) +
    Math.pow(counts.afternoon - mean, 2) +
    Math.pow(counts.evening - mean, 2)
  ) / 3;
  
  return variance;
}

function calculateEvennessScore(activities: Activity[]): number {
  const counts = {
    morning: activities.filter(a => a.timeSlot === 'morning').length,
    afternoon: activities.filter(a => a.timeSlot === 'afternoon').length,
    evening: activities.filter(a => a.timeSlot === 'evening').length
  };
  
  const total = counts.morning + counts.afternoon + counts.evening;
  const ideal = total / 3;
  
  return 1 - (
    Math.abs(counts.morning - ideal) +
    Math.abs(counts.afternoon - ideal) +
    Math.abs(counts.evening - ideal)
  ) / (2 * total);
}

export async function generateActivities(params: ActivityGenerationParams): Promise<Activity[]> {
  logger.info('[Activity Generation] Starting generation:', {
    params,
    timestamp: new Date().toISOString()
  });

  // Generate initial activities
  const activities = await generateInitialActivities(params);
  
  // Log initial activities by day with detailed summary
  const initialActivitiesByDay = activities.reduce((acc, activity) => {
    if (!acc[activity.dayNumber]) {
      acc[activity.dayNumber] = {
        morning: [],
        afternoon: [],
        evening: [],
        totalCost: 0,
        averageRating: 0,
        categories: new Set(),
        totalDuration: 0
      };
    }
    acc[activity.dayNumber][activity.timeSlot].push(activity);
    acc[activity.dayNumber].totalCost += activity.price.amount;
    acc[activity.dayNumber].averageRating += activity.rating || 0;
    acc[activity.dayNumber].categories.add(activity.category);
    acc[activity.dayNumber].totalDuration += parseInt(activity.duration) || 0;
    return acc;
  }, {} as Record<number, any>);

  // Log detailed day-by-day summary
  Object.entries(initialActivitiesByDay).forEach(([day, data]) => {
    const totalActivities = data.morning.length + data.afternoon.length + data.evening.length;
    logger.info(`[Activity Generation] Day ${day} Initial Plan Summary:`, {
      dayNumber: parseInt(day),
      summary: {
        totalActivities,
        totalCost: data.totalCost,
        averageRating: totalActivities > 0 ? data.averageRating / totalActivities : 0,
        uniqueCategories: Array.from(data.categories),
        totalDuration: data.totalDuration,
        timeSlotDistribution: {
          morning: data.morning.length,
          afternoon: data.afternoon.length,
          evening: data.evening.length
        }
      },
      activities: {
        morning: data.morning.map(a => ({
        name: a.name,
        category: a.category,
          duration: a.duration,
          price: a.price,
          rating: a.rating
        })),
        afternoon: data.afternoon.map(a => ({
          name: a.name,
          category: a.category,
          duration: a.duration,
          price: a.price,
          rating: a.rating
        })),
        evening: data.evening.map(a => ({
          name: a.name,
          category: a.category,
          duration: a.duration,
          price: a.price,
          rating: a.rating
        }))
      }
    });
  });

  // Enrich with Viator data
  const enrichedActivities = await enrichWithViatorData(activities);
  
  // Log enriched activities by day with verification details
  const enrichedActivitiesByDay = enrichedActivities.reduce((acc, activity) => {
    if (!acc[activity.dayNumber]) {
      acc[activity.dayNumber] = {
        morning: [],
        afternoon: [],
        evening: [],
        totalCost: 0,
        averageRating: 0,
        verifiedCount: 0,
        categories: new Set(),
        totalDuration: 0
      };
    }
    acc[activity.dayNumber][activity.timeSlot].push(activity);
    acc[activity.dayNumber].totalCost += activity.price.amount;
    acc[activity.dayNumber].averageRating += activity.rating || 0;
    if (activity.isVerified) acc[activity.dayNumber].verifiedCount++;
    acc[activity.dayNumber].categories.add(activity.category);
    acc[activity.dayNumber].totalDuration += parseInt(activity.duration) || 0;
    return acc;
  }, {} as Record<number, any>);

  // Log detailed enriched day-by-day summary
  Object.entries(enrichedActivitiesByDay).forEach(([day, data]) => {
    const totalActivities = data.morning.length + data.afternoon.length + data.evening.length;
    logger.info(`[Activity Generation] Day ${day} Enriched Plan Summary:`, {
      dayNumber: parseInt(day),
      summary: {
        totalActivities,
        totalCost: data.totalCost,
        averageRating: totalActivities > 0 ? data.averageRating / totalActivities : 0,
        verifiedActivities: data.verifiedCount,
        verificationRate: totalActivities > 0 ? (data.verifiedCount / totalActivities) * 100 : 0,
        uniqueCategories: Array.from(data.categories),
        totalDuration: data.totalDuration,
        timeSlotDistribution: {
          morning: data.morning.length,
          afternoon: data.afternoon.length,
          evening: data.evening.length
        }
      },
      activities: {
        morning: data.morning.map(a => ({
        name: a.name,
          category: a.category,
          duration: a.duration,
          price: a.price,
          rating: a.rating,
          isVerified: a.isVerified,
          verificationStatus: a.verificationStatus,
          referenceUrl: a.referenceUrl
        })),
        afternoon: data.afternoon.map(a => ({
          name: a.name,
          category: a.category,
          duration: a.duration,
          price: a.price,
          rating: a.rating,
          isVerified: a.isVerified,
          verificationStatus: a.verificationStatus,
          referenceUrl: a.referenceUrl
        })),
        evening: data.evening.map(a => ({
          name: a.name,
          category: a.category,
          duration: a.duration,
          price: a.price,
          rating: a.rating,
          isVerified: a.isVerified,
          verificationStatus: a.verificationStatus,
          referenceUrl: a.referenceUrl
        }))
      }
    });
  });

  // Balance distribution
  const balancedActivities = await balanceActivityDistribution(enrichedActivities, params);

  // Log final balanced day-by-day summary
  const finalPlanByDay = balancedActivities.reduce((acc, activity) => {
    if (!acc[activity.dayNumber]) {
      acc[activity.dayNumber] = {
        activities: [],
        metrics: {
          totalCost: 0,
          averageRating: 0,
          verifiedCount: 0,
          categories: new Set(),
          totalDuration: 0
        }
      };
    }
    acc[activity.dayNumber].activities.push(activity);
    acc[activity.dayNumber].metrics.totalCost += activity.price.amount;
    acc[activity.dayNumber].metrics.averageRating += activity.rating || 0;
    if (activity.isVerified) acc[activity.dayNumber].metrics.verifiedCount++;
    acc[activity.dayNumber].metrics.categories.add(activity.category);
    acc[activity.dayNumber].metrics.totalDuration += parseInt(activity.duration) || 0;
    return acc;
  }, {} as Record<number, any>);

  Object.entries(finalPlanByDay).forEach(([day, data]) => {
    const totalActivities = data.activities.length;
    logger.info(`[Activity Generation] Day ${day} Final Plan Summary:`, {
      dayNumber: parseInt(day),
      summary: {
        totalActivities,
        totalCost: data.metrics.totalCost,
        averageRating: totalActivities > 0 ? data.metrics.averageRating / totalActivities : 0,
        verifiedActivities: data.metrics.verifiedCount,
        verificationRate: totalActivities > 0 ? (data.metrics.verifiedCount / totalActivities) * 100 : 0,
        uniqueCategories: Array.from(data.metrics.categories),
        totalDuration: data.metrics.totalDuration,
        timeSlotDistribution: data.activities.reduce((acc: any, a) => {
          acc[a.timeSlot] = (acc[a.timeSlot] || 0) + 1;
        return acc;
        }, {})
      },
      activities: {
        morning: data.activities
          .filter(a => a.timeSlot === 'morning')
          .map(a => ({
            name: a.name,
            description: a.description,
            timeSlot: a.timeSlot,
            category: a.category,
            duration: a.duration,
            price: a.price,
            rating: a.rating,
            location: a.location,
            referenceUrl: a.referenceUrl,
            isVerified: a.isVerified,
            verificationStatus: a.verificationStatus,
            contactInfo: a.contactInfo
          })),
        afternoon: data.activities
          .filter(a => a.timeSlot === 'afternoon')
          .map(a => ({
            name: a.name,
            description: a.description,
            timeSlot: a.timeSlot,
            category: a.category,
            duration: a.duration,
            price: a.price,
            rating: a.rating,
            location: a.location,
            referenceUrl: a.referenceUrl,
            isVerified: a.isVerified,
            verificationStatus: a.verificationStatus,
            contactInfo: a.contactInfo
          })),
        evening: data.activities
          .filter(a => a.timeSlot === 'evening')
          .map(a => ({
            name: a.name,
            description: a.description,
            timeSlot: a.timeSlot,
            category: a.category,
            duration: a.duration,
            price: a.price,
            rating: a.rating,
            location: a.location,
            referenceUrl: a.referenceUrl,
            isVerified: a.isVerified,
            verificationStatus: a.verificationStatus,
            contactInfo: a.contactInfo
          }))
      }
    });
  });

  logger.info('[Activity Generation] Day ${day} Plan Details:', {
    dayNumber: parseInt(day),
    planDetails: {
      theme: data.theme,
      mainArea: data.mainArea,
      commentary: data.commentary,
      highlights: data.highlights,
      activities: {
        morning: data.morning.map(a => ({
        name: a.name,
        description: a.description,
          timeSlot: a.timeSlot,
        category: a.category,
        duration: a.duration,
        price: a.price,
        rating: a.rating,
          location: a.location,
          referenceUrl: a.referenceUrl,
          isVerified: a.isVerified,
          verificationStatus: a.verificationStatus,
          contactInfo: a.contactInfo
        })),
        afternoon: data.afternoon.map(a => ({
          name: a.name,
          description: a.description,
          timeSlot: a.timeSlot,
          category: a.category,
          duration: a.duration,
          price: a.price,
          rating: a.rating,
          location: a.location,
          referenceUrl: a.referenceUrl,
          isVerified: a.isVerified,
          verificationStatus: a.verificationStatus,
          contactInfo: a.contactInfo
        })),
        evening: data.evening.map(a => ({
          name: a.name,
          description: a.description,
          timeSlot: a.timeSlot,
          category: a.category,
          duration: a.duration,
          price: a.price,
          rating: a.rating,
          location: a.location,
          referenceUrl: a.referenceUrl,
          isVerified: a.isVerified,
          verificationStatus: a.verificationStatus,
          contactInfo: a.contactInfo
        }))
      },
      breaks: {
        morning: data.breaks?.morning,
        lunch: data.breaks?.lunch,
        afternoon: data.breaks?.afternoon,
        dinner: data.breaks?.dinner
      },
      logistics: {
        transportSuggestions: data.logistics?.transportSuggestions || [],
        walkingDistances: data.logistics?.walkingDistances || [],
        timeEstimates: data.logistics?.timeEstimates || []
      },
      mapData: {
        center: data.mapData?.center,
        bounds: data.mapData?.bounds,
        locations: data.mapData?.locations,
        routes: data.mapData?.routes
      }
    }
  });

  return balancedActivities;
} 