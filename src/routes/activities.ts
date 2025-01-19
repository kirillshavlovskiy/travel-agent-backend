import { Router, Request, Response } from 'express';
import { perplexityClient } from '../services/perplexity.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { destination, days, budget, currency, flightTimes } = req.body;

    logger.info('Received activity generation request', { destination, days, budget, currency, flightTimes });

    if (!destination || !budget || !currency) {
      logger.warn('Missing required parameters', { destination, budget, currency });
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const query = `Generate a ${days}-day activity plan for ${destination} with a total budget of ${budget} ${currency}. 
For EACH DAY (Day 1 to Day ${days}), suggest multiple activities across different price ranges:
- Budget activities (under $30 per person): 2-3 options per time slot
- Medium-priced activities ($30-$100 per person): 2-3 options per time slot
- Premium/exclusive activities (over $100 per person): 2-3 options per time slot

Requirements:
1. IMPORTANT: Clearly specify which day (1 to ${days}) each activity belongs to
2. Each day should have multiple activities from each price tier (budget, medium, premium)
3. Activities should be distributed across time slots (morning, afternoon, evening)
4. Include a diverse range of categories (cultural, adventure, entertainment, etc.)
5. Premium activities should be truly exclusive experiences
6. Consider local specialties and unique experiences
7. For Day 1, respect arrival time ${flightTimes?.arrival || 'flexible'}
8. For Day ${days}, respect departure time ${flightTimes?.departure || 'flexible'}

For each activity include:
- Day number (1 to ${days})
- Name
- Description (detailed description of the experience)
- Price per person in ${currency}
- Duration in hours
- Location
- Exact address
- Opening hours
- Key highlights or features (as an array of strings)
- Rating (1-5)
- Number of reviews
- Category
- Preferred time of day (morning/afternoon/evening)
- Reference URL (direct booking link or official website)
- Images (array of high-quality image URLs)

Format as a JSON object with an activities array. Each activity should include all the above fields, with images being an array of URLs to high-quality photos of the place/activity.`;

    logger.debug('Sending query to Perplexity API', { query });
    const response = await perplexityClient.chat(query);
    
    if (!response.choices?.[0]?.message?.content) {
      logger.error('Invalid response format from Perplexity API', { response });
      throw new Error('Invalid response format from Perplexity API');
    }

    const content = response.choices[0].message.content;
    logger.debug('Raw content from Perplexity API', { content });
    
    // Extract just the JSON object
    const jsonMatch = content.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      logger.error('Failed to extract JSON from response', { content });
      throw new Error('No valid JSON object found in response');
    }
    
    let extractedJson = jsonMatch[1];
    logger.debug('Extracted JSON', { extractedJson });
    
    // Clean the JSON more carefully
    extractedJson = extractedJson
      .replace(/([{,])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":') // Quote unquoted property names
      .replace(/:\s*'([^']*)'/g, ':"$1"') // Convert single quotes to double quotes
      .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas
      .replace(/https?:\/\/[^"\s,}]+/g, "https://placeholder.com/image.jpg") // Replace long URLs with placeholder
      .replace(/[^\x20-\x7E]/g, '') // Remove non-printable characters
      .replace(/\}\s*,\s*\}/g, '}}') // Fix object separators
      .replace(/\]\s*,\s*\]/g, ']]') // Fix array separators
      .replace(/\}\s*,\s*\]/g, '}]') // Fix mixed separators
      .replace(/,+(\s*[}\]])/g, '$1') // Remove multiple trailing commas
      .replace(/\[\s*,/g, '[') // Remove leading commas in arrays
      .replace(/,\s*\]/g, ']') // Remove trailing commas in arrays
      .trim();

    // Try to parse the JSON
    let parsedData;
    try {
      parsedData = JSON.parse(extractedJson);
    } catch (e) {
      logger.error('Failed to parse JSON', {
        error: e instanceof Error ? e.message : 'Unknown error',
        position: e instanceof SyntaxError ? e.message.match(/position (\d+)/)?.[1] : 'unknown',
        extractedJson
      });
      
      // Try to salvage the activities array
      try {
        // Extract just the activities array
        const activitiesMatch = extractedJson.match(/"activities"\s*:\s*\[([\s\S]*?)\}\s*(?:\]|}|$)/);
        if (activitiesMatch) {
          const activitiesJson = `{"activities":[${activitiesMatch[1]}}]}`;
          logger.debug('Attempting to salvage activities', { activitiesJson });
          parsedData = JSON.parse(activitiesJson);
        } else {
          throw new Error('Could not salvage activities from response');
        }
      } catch (salvageError) {
        logger.error('Failed to salvage activities', { error: salvageError });
        throw new Error('Invalid JSON format in response');
      }
    }
    
    if (!parsedData.activities || !Array.isArray(parsedData.activities)) {
      logger.error('Invalid data structure', { parsedData });
      throw new Error('Invalid response format: missing or invalid activities array');
    }

    // Validate each activity
    const validActivities = parsedData.activities.filter((activity: any) => {
      // Log the raw activity data
      logger.debug('Raw activity data before validation:', {
        name: activity.name,
        day: activity.day,
        day_number: activity.day_number,
        dayNumber: activity.dayNumber,
        timeSlot: activity.preferred_time_of_day || activity.preferredTimeOfDay
      });

      // Log the raw activity data
      logger.debug('Validating activity', { 
        activityData: {
          name: activity.name,
          keyHighlights: activity.key_highlights || activity.keyHighlights,
          openingHours: activity.opening_hours || activity.openingHours,
          numReviews: activity.number_of_reviews || activity.numReviews,
          preferredTimeOfDay: activity.preferred_time_of_day || activity.preferredTimeOfDay,
          referenceUrl: activity.reference_url || activity.referenceUrl
        }
      });

      // Convert duration to number
      const duration = typeof activity.duration === 'string' ? 
        parseFloat(activity.duration) : 
        typeof activity.durationInHours === 'string' ? 
          parseFloat(activity.durationInHours) : 
          activity.duration || activity.durationInHours;
      
      // Get price value and handle "Free" case
      let price = 0;
      if (typeof activity.price === 'object' && activity.price !== null) {
          price = activity.price.amount || 0;
      } else if (typeof activity.price === 'number') {
          price = activity.price;
      } else if (typeof activity.price === 'string') {
          price = activity.price.toLowerCase() === 'free' ? 0 : parseFloat(activity.price) || 0;
      } else if (typeof activity.pricePerPerson === 'number') {
          price = activity.pricePerPerson;
      }

      // Get address, handling both exact_address and address fields
      const address = activity.exact_address || activity.exactAddress || activity.address || '';

      // Get number of reviews from various possible field names
      const numReviews = activity.number_of_reviews || activity.numReviews || activity.numberOfReviews || 0;

      // Get day number from various possible field names
      const dayNumber = activity.day || activity.day_number || activity.dayNumber;

      const isValid = (
        typeof activity.name === 'string' &&
        typeof activity.description === 'string' &&
        (typeof duration === 'number' && !isNaN(duration)) &&
        (typeof price === 'number' && !isNaN(price)) &&
        typeof activity.category === 'string' &&
        typeof activity.location === 'string' &&
        typeof address === 'string' &&
        Array.isArray(activity.key_highlights || activity.keyHighlights) &&
        typeof (activity.opening_hours || activity.openingHours) === 'string' &&
        typeof activity.rating === 'number' &&
        typeof numReviews === 'number' &&
        typeof (activity.preferred_time_of_day || activity.preferredTimeOfDay) === 'string' &&
        typeof (activity.reference_url || activity.referenceUrl || activity.referenceURL) === 'string' &&
        Array.isArray(activity.images) &&
        typeof dayNumber === 'number'
      );

      if (!isValid) {
        logger.warn('Invalid activity', {
          name: activity.name,
          validationErrors: {
            name: typeof activity.name !== 'string',
            description: typeof activity.description !== 'string',
            duration: typeof duration !== 'number' || isNaN(duration),
            price: typeof price !== 'number' || isNaN(price),
            category: typeof activity.category !== 'string',
            location: typeof activity.location !== 'string',
            address: typeof address !== 'string',
            keyHighlights: !Array.isArray(activity.key_highlights || activity.keyHighlights),
            openingHours: typeof (activity.opening_hours || activity.openingHours) !== 'string',
            rating: typeof activity.rating !== 'number',
            numReviews: typeof numReviews !== 'number',
            preferredTimeOfDay: typeof (activity.preferred_time_of_day || activity.preferredTimeOfDay) !== 'string',
            referenceUrl: typeof (activity.reference_url || activity.referenceUrl) !== 'string',
            images: !Array.isArray(activity.images),
            dayNumber: typeof dayNumber !== 'number'
          }
        });
        return false;
      }

      return isValid;
    });

    if (validActivities.length === 0) {
      logger.warn('No valid activities found');
      return res.status(200).json({
        activities: [],
        message: "Could not generate valid activities. Please try again.",
        error: true
      });
    }

    logger.info('Successfully validated activities', { count: validActivities.length });

    // Transform activities
    const transformedActivities = validActivities.map((activity: any, index: number) => {
      // Determine time slot with a default value
      let timeSlot = 'morning';  // Default to morning
      
      // Safely handle potentially undefined values
      const preferredTime = activity?.preferred_time_of_day || activity?.preferredTimeOfDay || '';
      const normalizedTime = preferredTime.toString().toLowerCase().trim();
      
      if (normalizedTime === 'afternoon') {
        timeSlot = 'afternoon';
      } else if (normalizedTime === 'evening') {
        timeSlot = 'evening';
      }

      // Get day number from activity data first, only use calculated value as fallback
      const rawDayNumber = activity.day || activity.day_number || activity.dayNumber;
      const calculatedDayNumber = Math.floor(index / Math.ceil(validActivities.length / days)) + 1;
      const dayNumber = (rawDayNumber && rawDayNumber >= 1 && rawDayNumber <= days) ? rawDayNumber : calculatedDayNumber;

      // Convert duration to number
      const duration = typeof activity.duration === 'string' ? 
        parseFloat(activity.duration) : 
        typeof activity.durationInHours === 'string' ? 
          parseFloat(activity.durationInHours) : 
          activity.duration || activity.durationInHours;

      // Get price value and handle "Free" case
      let price = 0;
      if (typeof activity.price === 'object' && activity.price !== null) {
          price = activity.price.amount || 0;
      } else if (typeof activity.price === 'number') {
          price = activity.price;
      } else if (typeof activity.price === 'string') {
          price = activity.price.toLowerCase() === 'free' ? 0 : parseFloat(activity.price) || 0;
      } else if (typeof activity.pricePerPerson === 'number') {
          price = activity.pricePerPerson;
      }

      // Determine tier based on price
      const tier = price <= 30 ? 'budget' : price <= 100 ? 'medium' : 'premium';

      // Get highlights from either key_highlights or keyHighlights
      const highlights = activity.key_highlights || activity.keyHighlights || [];

      // Ensure highlights are properly formatted
      const formattedHighlights = highlights.map((highlight: any) => {
        if (typeof highlight === 'string') {
          return highlight.trim();
        }
        return '';
      }).filter(Boolean);

      // Add default highlights if none are provided
      if (formattedHighlights.length === 0) {
        formattedHighlights.push(
          `${tier.charAt(0).toUpperCase() + tier.slice(1)} tier activity`,
          `${duration} hour duration`,
          activity.category || 'Various activities available'
        );
      }

      return {
        id: `activity_${index + 1}`,
        name: activity.name,
        description: activity.description,
        duration: duration,
        price: {
          amount: price,
          currency
        },
        location: activity.location,
        address: activity.exact_address || activity.exactAddress || activity.address || '',
        openingHours: activity.opening_hours || activity.openingHours || 'Hours may vary',
        highlights: formattedHighlights,
        rating: activity.rating || 0,
        numberOfReviews: activity.number_of_reviews || activity.numReviews || activity.numberOfReviews || 0,
        category: activity.category || 'General',
        tier,
        timeSlot,
        dayNumber,
        startTime: timeSlot === 'morning' ? '09:00' : 
                   timeSlot === 'afternoon' ? '14:00' : '19:00',
        referenceUrl: activity.reference_url || activity.referenceUrl || activity.referenceURL || '',
        images: activity.images || []
      };
    });

    logger.info('Successfully transformed activities', { count: transformedActivities.length });

    // Group activities by tier and time slot
    const activitiesByDay = new Map();

    // Initialize the map with empty arrays for all days
    for (let day = 1; day <= days; day++) {
      activitiesByDay.set(day, {
        budget: { morning: [], afternoon: [], evening: [] },
        medium: { morning: [], afternoon: [], evening: [] },
        premium: { morning: [], afternoon: [], evening: [] }
      });
    }

    // Group activities by their assigned day number
    transformedActivities.forEach((activity: any) => {
      const dayActivities = activitiesByDay.get(activity.dayNumber);
      if (dayActivities && dayActivities[activity.tier] && dayActivities[activity.tier][activity.timeSlot]) {
        dayActivities[activity.tier][activity.timeSlot].push(activity);
      } else {
        console.warn('[Activities API] Invalid activity tier or time slot:', {
          tier: activity.tier,
          timeSlot: activity.timeSlot,
          activityId: activity.id,
          dayNumber: activity.dayNumber
        });
      }
    });

    // Create suggested itineraries
    const suggestedItineraries: Record<string, any[]> = {
      budget: [],
      medium: [],
      premium: []
    };

    activitiesByDay.forEach((activities: any, day: number) => {
      // Budget tier
      suggestedItineraries.budget.push({
        dayNumber: day,
        morning: activities.budget.morning[0],
        afternoon: activities.budget.afternoon[0],
        evening: activities.budget.evening[0],
        morningOptions: activities.budget.morning,
        afternoonOptions: activities.budget.afternoon,
        eveningOptions: activities.budget.evening
      });

      // Medium tier
      suggestedItineraries.medium.push({
        dayNumber: day,
        morning: activities.medium.morning[0] || activities.budget.morning[0],
        afternoon: activities.medium.afternoon[0] || activities.budget.afternoon[0],
        evening: activities.medium.evening[0] || activities.budget.evening[0],
        morningOptions: [...activities.medium.morning, ...activities.budget.morning],
        afternoonOptions: [...activities.medium.afternoon, ...activities.budget.afternoon],
        eveningOptions: [...activities.medium.evening, ...activities.budget.evening]
      });

      // Premium tier
      suggestedItineraries.premium.push({
        dayNumber: day,
        morning: activities.premium.morning[0] || activities.medium.morning[0] || activities.budget.morning[0],
        afternoon: activities.premium.afternoon[0] || activities.medium.afternoon[0] || activities.budget.afternoon[0],
        evening: activities.premium.evening[0] || activities.medium.evening[0] || activities.budget.evening[0],
        morningOptions: [...activities.premium.morning, ...activities.medium.morning, ...activities.budget.morning],
        afternoonOptions: [...activities.premium.afternoon, ...activities.medium.afternoon, ...activities.budget.afternoon],
        eveningOptions: [...activities.premium.evening, ...activities.medium.evening, ...activities.budget.evening]
      });
    });

    res.json({
      activities: transformedActivities,
      suggestedItineraries
    });

  } catch (error) {
    logger.error('Failed to generate activities', { error: error instanceof Error ? error.message : 'Unknown error' });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate activities',
      timestamp: new Date().toISOString()
    });
  }
});

function validateActivity(activity: any): boolean {
  // Required fields
  if (!activity.day || !activity.name || !activity.description || 
      typeof activity.price !== 'number' || !activity.location) {
    logger.debug('Activity validation failed: missing required fields', { activity });
    return false;
  }

  // Duration must be a number
  if (typeof activity.duration !== 'number' || isNaN(activity.duration)) {
    logger.debug('Activity validation failed: invalid duration', { 
      duration: activity.duration,
      type: typeof activity.duration
    });
    return false;
  }

  // Price must be a non-negative number
  if (activity.price < 0) {
    logger.debug('Activity validation failed: negative price', { price: activity.price });
    return false;
  }

  // Rating must be between 1-5 if provided
  if (activity.rating && (activity.rating < 1 || activity.rating > 5)) {
    logger.debug('Activity validation failed: invalid rating', { rating: activity.rating });
    return false;
  }

  // Review count must be a non-negative number if provided
  if (activity.reviewCount && (typeof activity.reviewCount !== 'number' || activity.reviewCount < 0)) {
    logger.debug('Activity validation failed: invalid review count', { reviewCount: activity.reviewCount });
    return false;
  }

  // Day must be a positive integer
  if (!Number.isInteger(activity.day) || activity.day < 1) {
    logger.debug('Activity validation failed: invalid day', { day: activity.day });
    return false;
  }

  // Preferred time of day must be valid if provided
  if (activity.preferredTimeOfDay && 
      !['morning', 'afternoon', 'evening'].includes(activity.preferredTimeOfDay)) {
    logger.debug('Activity validation failed: invalid preferred time', { 
      preferredTime: activity.preferredTimeOfDay 
    });
    return false;
  }

  // Highlights must be an array if provided
  if (activity.highlights && !Array.isArray(activity.highlights)) {
    logger.debug('Activity validation failed: highlights not an array', { 
      highlights: activity.highlights 
    });
    return false;
  }

  // Images must be an array if provided
  if (activity.images && !Array.isArray(activity.images)) {
    logger.debug('Activity validation failed: images not an array', { 
      images: activity.images 
    });
    return false;
  }

  return true;
}

export default router; 