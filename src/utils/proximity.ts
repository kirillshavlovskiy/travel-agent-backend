import { logger } from './logger';
import { Activity } from '../types/activity';

// Haversine formula to calculate distance between two points on earth
export function calculateDistance(
  lat1: number, 
  lon1: number, 
  lat2: number, 
  lon2: number
): number {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c; // Distance in kilometers
  
  return distance;
}

function deg2rad(deg: number): number {
  return deg * (Math.PI/180);
}

// Default coordinates for major Paris attractions when specific coordinates aren't available
const PARIS_LANDMARKS = {
  'Eiffel Tower': { lat: 48.8584, lng: 2.2945 },
  'Louvre Museum': { lat: 48.8606, lng: 2.3376 },
  'Notre Dame': { lat: 48.8530, lng: 2.3499 },
  'Arc de Triomphe': { lat: 48.8738, lng: 2.2950 },
  'Champs-Élysées': { lat: 48.8698, lng: 2.3075 },
  'Montmartre': { lat: 48.8867, lng: 2.3431 },
  'Sacré-Cœur': { lat: 48.8867, lng: 2.3431 },
  'Seine River': { lat: 48.8566, lng: 2.3522 },
  'Latin Quarter': { lat: 48.8496, lng: 2.3500 },
  'Opéra Garnier': { lat: 48.8720, lng: 2.3316 },
  'Moulin Rouge': { lat: 48.8841, lng: 2.3322 },
  'Versailles': { lat: 48.8044, lng: 2.1232 },
  'Musée d\'Orsay': { lat: 48.8600, lng: 2.3266 },
  'Centre Pompidou': { lat: 48.8607, lng: 2.3517 },
  'Panthéon': { lat: 48.8463, lng: 2.3466 },
  'Palais-Royal': { lat: 48.8647, lng: 2.3376 },
  'Luxembourg Gardens': { lat: 48.8462, lng: 2.3372 },
  'Tuileries Garden': { lat: 48.8634, lng: 2.3275 },
  'Père Lachaise Cemetery': { lat: 48.8594, lng: 2.3910 },
  'Sainte-Chapelle': { lat: 48.8553, lng: 2.3447 },
  'Conciergerie': { lat: 48.8556, lng: 2.3442 },
  'Marais': { lat: 48.8575, lng: 2.3600 },
  'Place de la Concorde': { lat: 48.8656, lng: 2.3212 },
  'Invalides': { lat: 48.8559, lng: 2.3130 },
  'Pont Alexandre III': { lat: 48.8637, lng: 2.3137 },
  'Pont Neuf': { lat: 48.8567, lng: 2.3413 },
  'Grand Palais': { lat: 48.8661, lng: 2.3125 },
  'Petit Palais': { lat: 48.8660, lng: 2.3140 },
  'Palais de Chaillot': { lat: 48.8622, lng: 2.2885 },
  'Palais de Tokyo': { lat: 48.8642, lng: 2.2977 }
};

// Paris neighborhoods/districts for clustering
const PARIS_NEIGHBORHOODS = {
  'Eiffel Tower/Champ de Mars': { lat: 48.8584, lng: 2.2945, radius: 1.0 },
  'Louvre/Tuileries': { lat: 48.8606, lng: 2.3376, radius: 0.8 },
  'Notre Dame/Île de la Cité': { lat: 48.8530, lng: 2.3499, radius: 0.8 },
  'Champs-Élysées/Arc de Triomphe': { lat: 48.8698, lng: 2.3075, radius: 1.0 },
  'Montmartre/Sacré-Cœur': { lat: 48.8867, lng: 2.3431, radius: 1.0 },
  'Latin Quarter': { lat: 48.8496, lng: 2.3500, radius: 0.8 },
  'Opera/Grands Boulevards': { lat: 48.8720, lng: 2.3316, radius: 0.8 },
  'Le Marais': { lat: 48.8575, lng: 2.3600, radius: 0.8 },
  'Versailles': { lat: 48.8044, lng: 2.1232, radius: 3.0 },
  'Saint-Germain-des-Prés': { lat: 48.8534, lng: 2.3342, radius: 0.8 }
};

// London landmarks for activities
const LONDON_LANDMARKS = {
  'Tower Bridge': { lat: 51.5055, lng: -0.0754 },
  'Big Ben': { lat: 51.4994, lng: -0.1245 },
  'London Eye': { lat: 51.5033, lng: -0.1196 },
  'Buckingham Palace': { lat: 51.5014, lng: -0.1419 },
  'Westminster Abbey': { lat: 51.4994, lng: -0.1273 },
  'Tower of London': { lat: 51.5081, lng: -0.0759 },
  'British Museum': { lat: 51.5194, lng: -0.1270 },
  'Tate Modern': { lat: 51.5076, lng: -0.0994 },
  'St. Paul\'s Cathedral': { lat: 51.5138, lng: -0.0984 },
  'Covent Garden': { lat: 51.5118, lng: -0.1226 },
  'Camden Market': { lat: 51.5414, lng: -0.1460 },
  'Hyde Park': { lat: 51.5074, lng: -0.1657 },
  'Piccadilly Circus': { lat: 51.5100, lng: -0.1347 },
  'Oxford Street': { lat: 51.5154, lng: -0.1447 },
  'Thames': { lat: 51.5074, lng: -0.1278 }
};

// Destination landmarks mapping
const DESTINATION_LANDMARKS = {
  'PARIS': PARIS_LANDMARKS,
  'LONDON': LONDON_LANDMARKS
};

// Destination centers for fallback
const DESTINATION_CENTERS = {
  'PARIS': { lat: 48.8566, lng: 2.3522 },
  'LONDON': { lat: 51.5074, lng: -0.1278 }
};

/**
 * Detects the destination from activity data
 */
function detectDestination(activity: Activity): string {
  // Check activity location first
  const location = typeof activity.location === 'string' ? 
    activity.location.toLowerCase() : 
    (activity.location as any)?.address?.toLowerCase() || '';
  
  // Check activity name and description
  const name = activity.name.toLowerCase();
  const description = (activity.description || '').toLowerCase();
  
  // Combine all text for analysis
  const allText = `${location} ${name} ${description}`;
  
  // Check for London indicators
  if (allText.includes('london') || 
      allText.includes('england') || 
      allText.includes('uk') || 
      allText.includes('britain') ||
      allText.includes('westminster') ||
      allText.includes('thames') ||
      allText.includes('tower bridge') ||
      allText.includes('big ben') ||
      allText.includes('buckingham')) {
    return 'LONDON';
  }
  
  // Default to Paris (most common destination in our system)
  return 'PARIS';
}

/**
 * Extracts coordinates from activity or estimates them based on name/description
 */
export function getActivityCoordinates(activity: Activity): { lat: number, lng: number } {
  console.log(`[Proximity] Getting coordinates for activity: "${activity.name}"`);
  
  // First check if activity already has coordinates in locationDetails
  if (activity.locationDetails?.coordinates?.lat && activity.locationDetails?.coordinates?.lng) {
    console.log(`[Proximity] Activity "${activity.name}" already has coordinates:`, {
      lat: activity.locationDetails.coordinates.lat,
      lng: activity.locationDetails.coordinates.lng,
      source: 'existing_locationDetails'
    });
    return {
      lat: activity.locationDetails.coordinates.lat,
      lng: activity.locationDetails.coordinates.lng
    };
  }

  console.log(`[Proximity] No specific coordinates found for activity "${activity.name}", using landmark matching`);

  // Fallback to landmark-based coordinates
  const destination = detectDestination(activity);
  const landmarks = DESTINATION_LANDMARKS[destination as keyof typeof DESTINATION_LANDMARKS] || DESTINATION_LANDMARKS['PARIS'];
  
  // Get activity name and description for matching
  const activityName = activity.name.toLowerCase();
  const activityDescription = (activity.description || '').toLowerCase();
  
  console.log(`[Proximity] Matching activity "${activity.name}" against ${Object.keys(landmarks).length} landmarks in ${destination}`);

  // Try to match against landmarks
  for (const [landmarkName, coordinates] of Object.entries(landmarks)) {
    const landmarkNameLower = landmarkName.toLowerCase();
    
    if (activityName.includes(landmarkNameLower) || activityDescription.includes(landmarkNameLower)) {
      console.log(`[Proximity] Matched activity "${activity.name}" to landmark "${landmarkName}":`, {
        lat: coordinates.lat,
        lng: coordinates.lng,
        destination,
        source: 'landmark_match'
      });
      return coordinates;
    }
  }

  // Additional specific matching patterns for London
  if (destination === 'LONDON') {
    const londonLandmarks = LONDON_LANDMARKS;
    if (activityName.includes('tower bridge') || activityDescription.includes('tower bridge')) {
      const coords = londonLandmarks['Tower Bridge'];
      if (coords) {
        console.log(`[Proximity] Matched "${activity.name}" to Tower Bridge:`, {
          lat: coords.lat,
          lng: coords.lng,
          source: 'pattern_match_tower_bridge'
        });
        return coords;
      }
    }
    if (activityName.includes('big ben') || activityDescription.includes('big ben') ||
        activityName.includes('westminster') || activityDescription.includes('westminster')) {
      const coords = londonLandmarks['Big Ben'];
      if (coords) {
        console.log(`[Proximity] Matched "${activity.name}" to Big Ben:`, {
          lat: coords.lat,
          lng: coords.lng,
          source: 'pattern_match_big_ben'
        });
        return coords;
      }
    }
    if (activityName.includes('london eye') || activityDescription.includes('london eye')) {
      const coords = londonLandmarks['London Eye'];
      if (coords) {
        console.log(`[Proximity] Matched "${activity.name}" to London Eye:`, {
          lat: coords.lat,
          lng: coords.lng,
          source: 'pattern_match_london_eye'
        });
        return coords;
      }
    }
  }

  // Default to destination center if no match found
  const destinationCenter = DESTINATION_CENTERS[destination as keyof typeof DESTINATION_CENTERS] || DESTINATION_CENTERS['PARIS'];
  console.log(`[Proximity] No landmark match found for activity "${activity.name}", using ${destination} center:`, {
    lat: destinationCenter.lat,
    lng: destinationCenter.lng,
    destination,
    source: 'destination_center_fallback'
  });
  return destinationCenter;
}

/**
 * Assigns a neighborhood to each activity
 */
export function assignNeighborhood(activity: Activity): string {
  const coordinates = getActivityCoordinates(activity);
  
  // Find the closest neighborhood
  let closestNeighborhood: string | null = null;
  let shortestDistance = Infinity;
  
  for (const [name, info] of Object.entries(PARIS_NEIGHBORHOODS)) {
    const distance = calculateDistance(
      coordinates.lat, 
      coordinates.lng, 
      info.lat, 
      info.lng
    );
    
    if (distance < shortestDistance && distance <= info.radius) {
      closestNeighborhood = name;
      shortestDistance = distance;
    }
  }
  
  return closestNeighborhood || 'Other';
}

/**
 * Builds a distance matrix between all activities
 */
export function buildDistanceMatrix(activities: Activity[]): Map<string, Map<string, number>> {
  const distanceMatrix = new Map<string, Map<string, number>>();
  
  activities.forEach(activity1 => {
    const coords1 = getActivityCoordinates(activity1);
    const distances = new Map<string, number>();
    
    activities.forEach(activity2 => {
      const coords2 = getActivityCoordinates(activity2);
      
      const distance = calculateDistance(
        coords1.lat, coords1.lng, 
        coords2.lat, coords2.lng
      );
      
      distances.set(activity2.name, distance);
    });
    
    distanceMatrix.set(activity1.name, distances);
  });
  
  return distanceMatrix;
}

/**
 * Clusters activities by geographic proximity
 */
export function clusterActivitiesByProximity(
  activities: Activity[], 
  days: number, 
  withAccessibilityNeeds: boolean = false,
  includeExtraOptions: boolean = false
): Activity[][] {
  if (!activities.length || days <= 0) {
    return [];
  }
  
  // Assign neighborhood and get coordinates for each activity
  const enhancedActivities = activities.map(activity => {
    const coordinates = getActivityCoordinates(activity);
    const neighborhood = assignNeighborhood(activity);
    
    return {
      ...activity,
      locationDetails: {
        ...activity.locationDetails,
        coordinates,
        neighborhood
      }
    };
  });
  
  // Group activities by neighborhood
  const neighborhoodGroups = new Map<string, Activity[]>();
  
  enhancedActivities.forEach(activity => {
    const neighborhood = activity.locationDetails.neighborhood;
    
    if (!neighborhoodGroups.has(neighborhood)) {
      neighborhoodGroups.set(neighborhood, []);
    }
    
    neighborhoodGroups.get(neighborhood)?.push(activity);
  });
  
  // Distribute neighborhoods across days, keeping activities in the same neighborhood on the same day
  const dayPlans: Activity[][] = Array.from({ length: days }, () => []);
  
  // Sort neighborhoods by size (number of activities)
  const sortedNeighborhoods = Array.from(neighborhoodGroups.entries())
    .sort((a, b) => b[1].length - a[1].length);
  
  // Distribute neighborhoods to days, trying to balance the number of activities
  let currentDayIndex = 0;
  
  sortedNeighborhoods.forEach(([neighborhood, activities]) => {
    // Find the day with the fewest activities
    const dayWithFewestActivities = dayPlans
      .map((activities, index) => ({ index, count: activities.length }))
      .sort((a, b) => a.count - b.count)[0].index;
    
    // For accessibility needs and not extra options, keep all activities from the same neighborhood on the same day
    if (withAccessibilityNeeds && !includeExtraOptions) {
      dayPlans[dayWithFewestActivities].push(...activities);
    } 
    // For extra options or non-accessibility needs, we can be more flexible
    else {
      // If this would overload a day, split the neighborhood
      const activitiesToAdd = includeExtraOptions ? 
        Math.min(activities.length, 6) : // More activities for extra options
        Math.min(activities.length, 4);  // Normal amount otherwise
      
      if (activitiesToAdd > 4) {
        // Split into chunks
        const chunkSize = Math.min(3, Math.ceil(activitiesToAdd / Math.min(days, 3)));
        
        for (let i = 0; i < activitiesToAdd; i += chunkSize) {
          const chunk = activities.slice(i, i + chunkSize);
          const targetDay = (dayWithFewestActivities + Math.floor(i / chunkSize)) % days;
          dayPlans[targetDay].push(...chunk);
        }
      } else {
        dayPlans[dayWithFewestActivities].push(...activities.slice(0, activitiesToAdd));
      }
    }
    
    currentDayIndex = (currentDayIndex + 1) % days;
  });
  
  // Optimize the sequence of activities within each day
  for (let i = 0; i < days; i++) {
    if (dayPlans[i].length >= 2) {
      dayPlans[i] = optimizeRouteForDay(dayPlans[i]);
    }
  }
  
  return dayPlans;
}

/**
 * Optimizes the route for a single day to minimize travel distance
 * Uses a greedy algorithm for the Traveling Salesman Problem
 */
function optimizeRouteForDay(activities: Activity[]): Activity[] {
  if (activities.length <= 2) {
    return activities;
  }
  
  // Build distance matrix for these activities
  const distanceMatrix = buildDistanceMatrix(activities);
  
  // Start from the first activity (arbitrary starting point)
  const optimizedRoute: Activity[] = [activities[0]];
  const remaining = new Set(activities.slice(1));
  
  // Greedy algorithm: always choose the closest next activity
  while (remaining.size > 0) {
    const lastActivity = optimizedRoute[optimizedRoute.length - 1];
    const lastActivityDistances = distanceMatrix.get(lastActivity.name);
    
    if (!lastActivityDistances) continue;
    
    // Find the closest remaining activity
    let closestActivity: Activity | null = null;
    let shortestDistance = Infinity;
    
    remaining.forEach(activity => {
      const distance = lastActivityDistances.get(activity.name) || Infinity;
      
      if (distance < shortestDistance) {
        closestActivity = activity;
        shortestDistance = distance;
      }
    });
    
    if (closestActivity) {
      optimizedRoute.push(closestActivity);
      remaining.delete(closestActivity);
    } else {
      // If for some reason we can't find a closest activity, just add any remaining one
      const nextActivity = Array.from(remaining)[0];
      optimizedRoute.push(nextActivity);
      remaining.delete(nextActivity);
    }
  }
  
  return optimizedRoute;
}

/**
 * Creates a proximity-optimized schedule for multiple days, with multiple options per time slot for faster pace
 */
export function createProximityBasedSchedule(
  activities: Activity[],
  days: number,
  accessibilityNeeds: string[] = [],
  pacePreference: string = 'moderate'
): Activity[] {
  logger.info('[Proximity] Starting proximity-based scheduling', {
    totalActivities: activities.length,
    days,
    accessibilityNeeds,
    pacePreference
  });

  // First, enrich all activities with location data
  const activitiesWithLocationData = activities.map(activity => {
    const coordinates = getActivityCoordinates(activity);
    const neighborhood = assignNeighborhood(activity);
    
    return {
      ...activity,
      locationDetails: {
        ...activity.locationDetails,
        coordinates,
        neighborhood
      }
    };
  });
  
  const withAccessibilityNeeds = accessibilityNeeds.length > 0;
  const isFastPaced = pacePreference === 'fast' || pacePreference === 'intense';
  
  let scheduledActivities: Activity[];
  
  if (isFastPaced) {
    // For fast pace, create multiple options per time slot
    scheduledActivities = createFastPacedSchedule(activitiesWithLocationData, days, withAccessibilityNeeds);
  } else {
    // For moderate/relaxed pace, use the original clustering approach
    // 1. Cluster activities by neighborhood and assign to days
    const dayPlans = clusterActivitiesByProximity(activitiesWithLocationData, days, withAccessibilityNeeds);
    
    // 2. Assign day numbers and time slots to activities
    scheduledActivities = [];
    
    dayPlans.forEach((dayActivities, index) => {
      const dayNumber = index + 1;
      
      // 3. Assign preferred time slots based on optimal order
      const assignedActivities = assignTimeSlots(dayActivities, dayNumber, withAccessibilityNeeds);
      
      scheduledActivities.push(...assignedActivities);
    });
  }
  
  // Log the proximity-based schedule for analysis
  logger.info('[Proximity] Created proximity-based schedule', {
    totalActivities: scheduledActivities.length,
    days,
    withAccessibilityNeeds,
    isFastPaced,
    activitiesPerDay: Array.from({ length: days }, (_, i) => {
      const dayNumber = i + 1;
      return scheduledActivities.filter(a => a.dayNumber === dayNumber).length;
    })
  });
  
  return scheduledActivities;
}

/**
 * Creates a schedule with multiple options per time slot for fast-paced travelers
 */
function createFastPacedSchedule(
  activities: Activity[],
  days: number,
  withAccessibilityNeeds: boolean
): Activity[] {
  // Sort activities by rating and popularity
  const sortedActivities = [...activities].sort((a, b) => {
    // First prioritize by rating
    const ratingA = a.rating || 0;
    const ratingB = b.rating || 0;
    
    if (ratingA !== ratingB) return ratingB - ratingA;
    
    // If ratings are the same, prioritize by review count
    return (b.numberOfReviews || 0) - (a.numberOfReviews || 0);
  });
  
  // Deduplicate activities by combining similar ones
  const uniqueActivities = Array.from(
    new Map(sortedActivities.map(item => [item.name, item])).values()
  );
  
  // Prepare result array
  const result: Activity[] = [];
  
  // Define time slots
  const timeSlots = ['morning', 'afternoon', 'evening'];
  
  // Decide how many options to offer per slot
  // Reduce options if there are accessibility needs
  const optionsPerSlot = withAccessibilityNeeds ? 2 : 3;
  
  // Force neighborhood assignment for all activities
  uniqueActivities.forEach(activity => {
    // If activity doesn't have locationDetails yet, initialize it
    if (!activity.locationDetails) {
      activity.locationDetails = {};
    }
    
    // Get coordinates if not already assigned
    if (!activity.locationDetails.coordinates) {
      activity.locationDetails.coordinates = getActivityCoordinates(activity);
    }
    
    // Assign neighborhood if not already done
    if (!activity.locationDetails.neighborhood) {
      activity.locationDetails.neighborhood = assignNeighborhood(activity);
    }
  });
  
  // Group activities by neighborhood for better clustering
  const neighborhoodGroups = new Map<string, Activity[]>();
  
  uniqueActivities.forEach(activity => {
    const neighborhood = activity.locationDetails?.neighborhood || 'Other';
    if (!neighborhoodGroups.has(neighborhood)) {
      neighborhoodGroups.set(neighborhood, []);
    }
    neighborhoodGroups.get(neighborhood)?.push(activity);
  });
  
  // Distribute activities across days and time slots
  for (let dayNumber = 1; dayNumber <= days; dayNumber++) {
    // For each time slot in this day
    timeSlots.forEach((timeSlot, slotIndex) => {
      // We'll collect activities for this time slot
      const timeSlotActivities: Activity[] = [];
      
      // Try to get activities from each neighborhood
      neighborhoodGroups.forEach((activitiesInNeighborhood, neighborhood) => {
        // Skip empty neighborhoods
        if (activitiesInNeighborhood.length === 0) return;
        
        // Get up to one activity per neighborhood for this time slot
        const activity = activitiesInNeighborhood[0];
        
        // Only add if we haven't reached our maximum for this slot
        if (timeSlotActivities.length < optionsPerSlot) {
          timeSlotActivities.push({
            ...activity,
            dayNumber,
            timeSlot: timeSlot as 'morning' | 'afternoon' | 'evening',
            // First activity in the slot is preselected
            selected: timeSlotActivities.length === 0
          });
          
          // Remove the activity from its neighborhood group
          activitiesInNeighborhood.shift();
        }
      });
      
      // If we still need more options, use activities regardless of neighborhood
      // Flatten the array of arrays into a single array
      const allNeighborhoodValues = Array.from(neighborhoodGroups.values());
      const remainingActivities: Activity[] = [];
      
      // Manually flatten the array to avoid TypeScript issues
      allNeighborhoodValues.forEach(neighborhoodActivities => {
        neighborhoodActivities.forEach(activity => {
          remainingActivities.push(activity);
        });
      });
      
      while (timeSlotActivities.length < optionsPerSlot && remainingActivities.length > 0) {
        // Find the highest-rated remaining activity
        let bestIndex = 0;
        let bestRating = remainingActivities[0]?.rating || 0;
        
        for (let i = 1; i < remainingActivities.length; i++) {
          const currentRating = remainingActivities[i]?.rating || 0;
          if (currentRating > bestRating) {
            bestRating = currentRating;
            bestIndex = i;
          }
        }
        
        const activity = remainingActivities[bestIndex];
        
        // Add it to our time slot options
        timeSlotActivities.push({
          ...activity,
          dayNumber,
          timeSlot: timeSlot as 'morning' | 'afternoon' | 'evening',
          selected: timeSlotActivities.length === 0
        });
        
        // Remove it from the remaining activities
        remainingActivities.splice(bestIndex, 1);
        
        // Also remove it from its neighborhood group
        const neighborhood = activity.locationDetails?.neighborhood || 'Other';
        const groupActivities = neighborhoodGroups.get(neighborhood);
        
        if (groupActivities) {
          const activityIndex = groupActivities.findIndex(a => a.name === activity.name);
          if (activityIndex !== -1) {
            groupActivities.splice(activityIndex, 1);
          }
        }
      }
      
      // Add all selected activities for this time slot to the result
      result.push(...timeSlotActivities);
    });
  }
  
  return result;
}

/**
 * Assigns time slots to activities within a day based on their sequence
 */
function assignTimeSlots(
  activities: Activity[], 
  dayNumber: number,
  withAccessibilityNeeds: boolean
): Activity[] {
  const morningCount = Math.ceil(activities.length / 3);
  const afternoonCount = Math.ceil(activities.length / 3);
  
  return activities.map((activity, index) => {
    // Determine time slot based on position in sequence
    let timeSlot: 'morning' | 'afternoon' | 'evening';
    
    if (index < morningCount) {
      timeSlot = 'morning';
    } else if (index < morningCount + afternoonCount) {
      timeSlot = 'afternoon';
    } else {
      timeSlot = 'evening';
    }
    
    // For accessibility needs, allocate more time between activities
    if (withAccessibilityNeeds) {
      // Reduce number of activities per time slot
      if (activities.length > 3) {
        if (index < 1) {
          timeSlot = 'morning';
        } else if (index < 2) {
          timeSlot = 'afternoon';
        } else {
          timeSlot = 'evening';
        }
      }
    }
    
    // Preserve original time slot if specified and doesn't conflict
    if (activity.timeSlot) {
      const timeSlotCounts = activities.reduce((acc, a) => {
        if (a.timeSlot) {
          acc[a.timeSlot] = (acc[a.timeSlot] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>);
      
      // Only keep original time slot if it doesn't create imbalance
      if (timeSlotCounts[activity.timeSlot] <= Math.ceil(activities.length / 3)) {
        timeSlot = activity.timeSlot;
      }
    }
    
    return {
      ...activity,
      dayNumber,
      timeSlot
    };
  });
} 