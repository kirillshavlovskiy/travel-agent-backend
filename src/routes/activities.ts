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
For each day, suggest multiple activities across different price ranges:
- Budget activities (under $30 per person): 2-3 options per time slot
- Medium-priced activities ($30-$100 per person): 2-3 options per time slot
- Premium/exclusive activities (over $100 per person): 2-3 options per time slot

Requirements:
1. Each day should have multiple activities from each price tier (budget, medium, premium)
2. Activities should be distributed across time slots (morning, afternoon, evening)
3. Include a diverse range of categories (cultural, adventure, entertainment, etc.)
4. Premium activities should be truly exclusive experiences
5. Consider local specialties and unique experiences
6. Respect arrival time ${flightTimes?.arrival || 'flexible'} and departure time ${flightTimes?.departure || 'flexible'}

For each activity include:
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
    
    // Clean up the content
    let cleanedContent = content
      .replace(/```json\n|\n```/g, '')  // Remove markdown code blocks
      .replace(/(\d+)\s*\([^)]*\)/g, '$1')  // Replace "0 (free entry, but...)" with just the number
      .replace(/\$\d+/g, (match: string) => match.substring(1))  // Remove $ signs from numbers
      .trim();
      
    logger.debug('Cleaned content', { cleanedContent });

    // Extract just the JSON object
    const jsonMatch = cleanedContent.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      logger.error('Failed to extract JSON from response', { cleanedContent });
      throw new Error('No valid JSON object found in response');
    }
    
    const extractedJson = jsonMatch[1];
    logger.debug('Extracted JSON', { extractedJson });
    
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

      // Convert duration to number if it's a string
      const duration = typeof activity.duration === 'string' ? parseFloat(activity.duration) : activity.duration;
      
      // Get price value, handling both direct price and price object
      const price = typeof activity.price === 'object' ? activity.price.amount : activity.price;
      
      // Get address, handling both exact_address and address fields
      const address = activity.exact_address || activity.address;

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
        typeof (activity.number_of_reviews || activity.numReviews || activity.numberReviews) === 'number' &&
        typeof (activity.preferred_time_of_day || activity.preferredTimeOfDay) === 'string' &&
        typeof (activity.reference_url || activity.referenceUrl || activity.referenceURL) === 'string' &&
        Array.isArray(activity.images)
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
            numReviews: typeof (activity.number_of_reviews || activity.numReviews) !== 'number',
            preferredTimeOfDay: typeof (activity.preferred_time_of_day || activity.preferredTimeOfDay) !== 'string',
            referenceUrl: typeof (activity.reference_url || activity.referenceUrl) !== 'string',
            images: !Array.isArray(activity.images)
          }
        });
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
      const preferredTime = (activity.preferred_time_of_day || activity.preferredTimeOfDay || '').toLowerCase();
      if (preferredTime === 'afternoon') {
        timeSlot = 'afternoon';
      } else if (preferredTime === 'evening') {
        timeSlot = 'evening';
      }

      // Convert duration to number
      const duration = typeof activity.duration === 'string' ? parseFloat(activity.duration) : activity.duration;

      // Get price value
      const price = typeof activity.price === 'object' ? activity.price.amount : activity.price;

      // Determine tier based on price
      const tier = price <= 30 ? 'budget' : price <= 100 ? 'medium' : 'premium';

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
        address: activity.exact_address || activity.address,
        openingHours: activity.opening_hours || activity.openingHours,
        highlights: activity.key_highlights || activity.keyHighlights || [],
        rating: activity.rating,
        reviews: activity.number_of_reviews || activity.numReviews || activity.numberReviews,
        category: activity.category,
        tier,
        timeSlot,
        dayNumber: 1,
        startTime: timeSlot === 'morning' ? '09:00' : 
                   timeSlot === 'afternoon' ? '14:00' : '19:00',
        referenceUrl: activity.reference_url || activity.referenceUrl || activity.referenceURL || '',
        images: activity.images || []
      };
    });

    logger.info('Successfully transformed activities', { count: transformedActivities.length });

    // Group activities by tier and time slot
    const activitiesByDay = new Map();
    let currentDay = 1;
    const activitiesPerDay = Math.ceil(transformedActivities.length / days);

    transformedActivities.forEach((activity: any) => {
      activity.dayNumber = currentDay;
      
      if (!activitiesByDay.has(currentDay)) {
        activitiesByDay.set(currentDay, {
          budget: { morning: [], afternoon: [], evening: [] },
          medium: { morning: [], afternoon: [], evening: [] },
          premium: { morning: [], afternoon: [], evening: [] }
        });
      }

      const dayActivities = activitiesByDay.get(currentDay);
      if (dayActivities && dayActivities[activity.tier] && dayActivities[activity.tier][activity.timeSlot]) {
        dayActivities[activity.tier][activity.timeSlot].push(activity);
      } else {
        console.warn('[Activities API] Invalid activity tier or time slot:', {
          tier: activity.tier,
          timeSlot: activity.timeSlot,
          activityId: activity.id
        });
      }

      const totalActivities = Object.values(dayActivities).flatMap((tier: any) => 
        Object.values(tier).flatMap(slot => slot)
      ).length;

      if (totalActivities >= activitiesPerDay) {
        currentDay++;
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

export default router; 