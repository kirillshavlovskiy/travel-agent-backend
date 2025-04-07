import { Activity } from '../types/activity';

// Add utility functions for activity processing

/**
 * Enriches activities with consistent category information
 * This is useful for creating diverse options in fast-paced schedules
 */
export function enhanceActivityCategories(activity: Activity): Activity {
  const name = activity.name?.toLowerCase() || '';
  const description = activity.description?.toLowerCase() || '';
  
  // If already has a category, use it
  if (activity.category) {
    return activity;
  }
  
  // Determine category from name or description
  let category = 'Other';
  
  if (name.includes('louvre') || name.includes('museum') || 
      description.includes('louvre') || description.includes('museum') ||
      name.includes('exhibition') || name.includes('gallery')) {
    category = 'Art';
  } else if (name.includes('eiffel') || name.includes('tower') || 
           description.includes('eiffel') || description.includes('iconic')) {
    category = 'Landmarks';
  } else if (name.includes('palace') || name.includes('versailles') || 
           description.includes('palace') || description.includes('versailles') ||
           name.includes('notre dame') || description.includes('notre dame')) {
    category = 'History';
  } else if (name.includes('seine') || name.includes('cruise') || 
           name.includes('river') || description.includes('cruise') ||
           description.includes('boat') || description.includes('seine')) {
    category = 'Cruises';
  } else if (name.includes('food') || name.includes('wine') || 
           name.includes('tasting') || name.includes('dinner') ||
           description.includes('culinary') || description.includes('gastronomy')) {
    category = 'Food & Wine';
  }
  
  return {
    ...activity,
    category
  };
}

/**
 * Enhances activity with rating information if missing
 */
export function enhanceActivityRatings(activity: Activity): Activity {
  // If already has a rating, keep it
  if (activity.rating && activity.numberOfReviews) {
    return activity;
  }
  
  // Assign a reasonable rating based on tier if available
  if (activity.tier) {
    let rating = 4.0; // Default for medium tier
    let numberOfReviews = 100; // Default number of reviews
    
    if (activity.tier === 'premium') {
      rating = 4.7;
      numberOfReviews = 300;
    } else if (activity.tier === 'budget') {
      rating = 3.8;
      numberOfReviews = 80;
    }
    
    return {
      ...activity,
      rating,
      numberOfReviews
    };
  }
  
  // No tier information, use name recognition as a proxy
  const name = activity.name?.toLowerCase() || '';
  
  if (name.includes('louvre') || name.includes('eiffel') || 
      name.includes('notre dame') || name.includes('versailles')) {
    return {
      ...activity,
      rating: 4.8,
      numberOfReviews: 500
    };
  }
  
  // Default values
  return {
    ...activity,
    rating: 4.0,
    numberOfReviews: 100
  };
}

/**
 * Creates selection options for fast-paced travelers
 * This combines activities into option groups for each time slot
 */
export function createFastPacedOptions(activities: Activity[], days: number): Activity[] {
  // First enhance all activities with consistent categories and ratings
  const enhancedActivities = activities.map(activity => {
    let enhanced = enhanceActivityCategories(activity);
    enhanced = enhanceActivityRatings(enhanced);
    return enhanced;
  });
  
  // Group by time slot and day
  const optionsByDayAndSlot = new Map<string, Activity[]>();
  
  enhancedActivities.forEach(activity => {
    if (!activity.dayNumber || !activity.timeSlot) {
      return; // Skip activities without day or time slot
    }
    
    const key = `${activity.dayNumber}-${activity.timeSlot}`;
    
    if (!optionsByDayAndSlot.has(key)) {
      optionsByDayAndSlot.set(key, []);
    }
    
    optionsByDayAndSlot.get(key)?.push(activity);
  });
  
  // For each group, mark the best option as selected
  const result: Activity[] = [];
  
  optionsByDayAndSlot.forEach((slotActivities, key) => {
    // Sort by rating
    const sorted = [...slotActivities].sort((a, b) => {
      return (b.rating || 0) - (a.rating || 0);
    });
    
    // Mark the highest rated as selected
    if (sorted.length > 0) {
      sorted[0].selected = true;
      
      // Mark the rest as not selected
      for (let i = 1; i < sorted.length; i++) {
        sorted[i].selected = false;
      }
    }
    
    result.push(...sorted);
  });
  
  return result;
} 