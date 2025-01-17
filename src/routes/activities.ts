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

For each activity MUST include:
1. Basic Information:
   - Day number (1 to ${days})
   - Name (full official name of the activity/venue)
   - Category (specific like "Cultural Tour", "Food Experience", "Adventure Activity", etc.)
   - Location (full name of area/district)
   - Exact address (complete street address with postal code if applicable)

2. Detailed Description:
   - Main description (3-4 detailed sentences about the experience)
   - Key highlights (5 specific features or unique aspects, each 1-2 sentences)
   - What's included (list of 3-4 specific items/services included in the price)
   - Additional notes (any special requirements, what to bring, etc.)

3. Timing & Duration:
   - Operating hours (specific format: "Monday-Friday: 9:00-17:00, Saturday: 10:00-16:00, Sunday: Closed")
   - Recommended time slot (morning/afternoon/evening with specific start time)
   - Duration (exact hours and minutes, e.g., "2 hours 30 minutes")
   - Best time to visit (specific advice about peak/quiet times)

4. Pricing & Booking:
   - Price per person in ${currency} (specific amount, not a range)
   - What's excluded (list of 2-3 items not included in the price)
   - Booking requirements (advance booking time, group size limits, etc.)
   - Cancellation policy (specific terms)

5. Contact & Reviews:
   - Official website URL (must be actual URL, not placeholder)
   - Booking platform URL (specific URL for direct booking)
   - Phone (international format with country code)
   - Email (official contact email)
   - Rating (realistic rating between 1-5 with one decimal)
   - Number of reviews (realistic number based on popularity)

6. Media:
   - Main image URL (high-quality photo of the activity/venue)
   - Gallery URLs (2-3 additional photos showing different aspects)

Price Guidelines:
- Budget activities: $15-30 per person
- Medium activities: $31-100 per person
- Premium activities: $101-300 per person

Format as a JSON object with an activities array. Each activity must include ALL the above fields with accurate, realistic data. Do not use placeholder text - all information should be specific and realistic for the actual activity and location.`;

    logger.debug('Sending query to Perplexity API', { query });
    const response = await perplexityClient.chat(query);
    
    if (!response.choices?.[0]?.message?.content) {
      logger.error('Invalid response format from Perplexity API', { response });
      throw new Error('Invalid response format from Perplexity API');
    }

    const content = response.choices[0].message.content;
    logger.debug('Raw content from Perplexity API', { content });
    
    // Log the content before cleaning
    logger.debug('Content before cleaning:', {
      firstDayMatch: content.match(/\"day\"\s*:\s*(\d+)/),
      firstDayNumberMatch: content.match(/\"day_number\"\s*:\s*(\d+)/),
      firstDayNumberAltMatch: content.match(/\"dayNumber\"\s*:\s*(\d+)/)
    });
    
    // Clean up the content
    let cleanedContent = content
      .replace(/```json\n|\n```/g, '')  // Remove markdown code blocks
      .replace(/(\d+)\s*\([^)]*\)/g, '$1')  // Replace "0 (free entry, but...)" with just the number
      
      // Fix unquoted day numbers
      .replace(/([{,]\s*)(day|day_number|dayNumber)\s*:\s*(\d+)/g, '$1"$2":$3')  // Quote day field names
      
      .replace(/\$\d+/g, (match: string) => match.substring(1))  // Remove $ signs from numbers
      .replace(/https:\/\/[^"\s]+/g, (url: string) => {  // Clean up long URLs
        // If URL is too long or contains invalid characters or repeated patterns, use a placeholder
        if (url.length > 100 || /[^\x20-\x7E]/.test(url) || /(\/[^\/]+)\1{10,}/.test(url)) {
          return "https://placeholder.com/image.jpg";
        }
        return url;
      })
      .replace(/,(\s*[\]}])/g, '$1')  // Remove trailing commas
      .trim();

    // Log any unquoted day numbers that might still exist
    logger.debug('Checking for unquoted day numbers:', {
      dayMatches: cleanedContent.match(/[{,]\s*(day|day_number|dayNumber)\s*:\s*\d+/g),
      quotedDayMatches: cleanedContent.match(/[{,]\s*"(day|day_number|dayNumber)"\s*:\s*\d+/g)
    });

    // Log the content after first cleaning steps
    logger.debug('Content after initial cleaning:', {
      firstDayMatch: cleanedContent.match(/\"day\"\s*:\s*(\d+)/),
      firstDayNumberMatch: cleanedContent.match(/\"day_number\"\s*:\s*(\d+)/),
      firstDayNumberAltMatch: cleanedContent.match(/\"dayNumber\"\s*:\s*(\d+)/)
    });

    cleanedContent = cleanedContent
      .replace(/\$\d+/g, (match: string) => match.substring(1))  // Remove $ signs from numbers
      .replace(/https:\/\/[^"\s]+/g, (url: string) => {  // Clean up long URLs
        // If URL is too long or contains invalid characters or repeated patterns, use a placeholder
        if (url.length > 100 || /[^\x20-\x7E]/.test(url) || /(\/[^\/]+)\1{10,}/.test(url)) {
          return "https://placeholder.com/image.jpg";
        }
        return url;
      })
      .replace(/,(\s*[\]}])/g, '$1')  // Remove trailing commas
      .trim();
      
    // Log the content after all cleaning steps
    logger.debug('Content after all cleaning:', {
      firstDayMatch: cleanedContent.match(/\"day\"\s*:\s*(\d+)/),
      firstDayNumberMatch: cleanedContent.match(/\"day_number\"\s*:\s*(\d+)/),
      firstDayNumberAltMatch: cleanedContent.match(/\"dayNumber\"\s*:\s*(\d+)/)
    });

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
      
      // Try to salvage the activities array with more aggressive cleaning
      try {
        // Clean the JSON more carefully to preserve day numbers
        const cleanedJson = extractedJson
          .replace(/https:\/\/[^"\s]+/g, "https://placeholder.com/image.jpg")  // Replace all URLs with placeholder
          .replace(/[^\x20-\x7E]/g, '')  // Remove non-printable characters
          .replace(/,(\s*[}\]])/g, '$1')  // Remove trailing commas
          .replace(/\}\s*,\s*\}/g, '}}')  // Fix object separators
          .replace(/\]\s*,\s*\]/g, ']]')  // Fix array separators
          .replace(/\}\s*,\s*\]/g, '}]')  // Fix mixed separators
          .replace(/([{,]\s*)(?!")(day(?:_number|Number)?|name|description|duration|price|category|location|address|key_highlights|keyHighlights|opening_hours|openingHours|rating|number_of_reviews|numReviews|preferred_time_of_day|preferredTimeOfDay|reference_url|referenceUrl|images)\s*:/g, '$1"$2":')  // Quote only specific property names
          .replace(/:\s*'([^']*?)'/g, ':"$1"')  // Convert single quotes to double quotes
          .replace(/,+(\s*[}\]])/g, '$1')  // Remove multiple trailing commas
          .replace(/\[\s*,/g, '[')  // Remove leading commas in arrays
          .replace(/,\s*\]/g, ']')  // Remove trailing commas in arrays
          .trim();

        logger.debug('Cleaned JSON before parsing:', { 
          firstActivity: cleanedJson.substring(0, cleanedJson.indexOf('},') + 2)
        });

        const activitiesMatch = cleanedJson.match(/"activities"\s*:\s*\[([\s\S]*?)\}\s*(?:\]|}|$)/);
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
        Array.isArray(activity.images) &&
        (typeof activity.day === 'number' || typeof activity.day_number === 'number' || typeof activity.dayNumber === 'number' || true)
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
            images: !Array.isArray(activity.images),
            dayNumber: activity.day === undefined && activity.day_number === undefined && activity.dayNumber === undefined ? 
              'Missing day number' : 
              typeof activity.day !== 'number' && typeof activity.day_number !== 'number' && typeof activity.dayNumber !== 'number' ? 
              'Invalid day number type' : null
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

      logger.debug('Day number assignment:', {
        activityName: activity.name,
        rawDayNumber,
        index,
        totalActivities: validActivities.length,
        days,
        calculatedDayNumber,
        finalDayNumber: dayNumber
      });

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
        numberOfReviews: activity.number_of_reviews || activity.numReviews || activity.numberReviews,
        category: activity.category,
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

    // Add validation before returning the activities
    interface ActivityValidation {
      name: string;
      description: {
        main: string;
        highlights: string[];
        included: string[];
        notes?: string;
      };
      price: { 
        amount: number; 
        currency: string;
        excluded: string[];
        bookingRequirements: string;
        cancellationPolicy: string;
      };
      location: {
        area: string;
        address: string;
      };
      timing: {
        operatingHours: {
          [key: string]: string; // e.g., "Monday-Friday": "9:00-17:00"
        };
        recommendedTimeSlot: string;
        duration: string;
        bestTimeToVisit: string;
      };
      category: string;
      tier: string;
      contact: {
        website: string;
        bookingUrl: string;
        phone: string;
        email: string;
      };
      reviews: {
        rating: number;
        count: number;
      };
      media: {
        mainImage: string;
        gallery: string[];
      };
      dayNumber: number;
      timeSlot: string;
    }

    const validateActivities = (activities: ActivityValidation[]) => {
      return activities.filter(activity => {
        // Log the activity being validated
        logger.debug('Validating activity', {
          name: activity.name,
          price: activity.price,
          tier: activity.tier
        });

        // Check for required fields
        if (!activity.name || !activity.description?.main || !activity.price?.amount || !activity.location?.area) {
          logger.warn('Activity missing basic required fields', { 
            activity: activity.name,
            hasDescription: !!activity.description?.main,
            hasPrice: !!activity.price?.amount,
            hasLocation: !!activity.location?.area
          });
          return false;
        }

        // Validate description
        if (!activity.description.highlights?.length || activity.description.highlights.length < 5) {
          logger.warn('Activity missing required highlights', {
            activity: activity.name,
            highlightsCount: activity.description.highlights?.length
          });
          return false;
        }

        // Validate price ranges
        const price = activity.price.amount;
        if (activity.tier === 'budget' && (price < 15 || price > 30)) {
          logger.warn('Invalid price for budget activity', { 
            activity: activity.name, 
            price,
            tier: activity.tier
          });
          return false;
        }
        if (activity.tier === 'medium' && (price < 31 || price > 100)) {
          logger.warn('Invalid price for medium activity', { 
            activity: activity.name, 
            price,
            tier: activity.tier
          });
          return false;
        }
        if (activity.tier === 'premium' && (price < 101 || price > 300)) {
          logger.warn('Invalid price for premium activity', { 
            activity: activity.name, 
            price,
            tier: activity.tier
          });
          return false;
        }

        // Validate URLs
        if (!activity.contact?.website?.startsWith('http') || !activity.contact?.bookingUrl?.startsWith('http')) {
          logger.warn('Invalid or missing URLs', { 
            activity: activity.name,
            website: activity.contact?.website,
            bookingUrl: activity.contact?.bookingUrl
          });
          return false;
        }

        // Validate contact info
        if (!activity.contact?.phone || !activity.contact?.email) {
          logger.warn('Missing contact information', { 
            activity: activity.name,
            hasPhone: !!activity.contact?.phone,
            hasEmail: !!activity.contact?.email
          });
          return false;
        }

        // Validate timing
        if (!activity.timing?.operatingHours || !activity.timing?.duration) {
          logger.warn('Missing timing information', {
            activity: activity.name,
            hasOperatingHours: !!activity.timing?.operatingHours,
            hasDuration: !!activity.timing?.duration
          });
          return false;
        }

        // Validate media
        if (!activity.media?.mainImage?.startsWith('http') || !activity.media?.gallery?.length) {
          logger.warn('Missing or invalid media', {
            activity: activity.name,
            hasMainImage: !!activity.media?.mainImage,
            galleryCount: activity.media?.gallery?.length
          });
          return false;
        }

        return true;
      });
    };

    // Helper function to generate itinerary for a specific tier
    function generateItineraryForTier(activities: ActivityValidation[], tier: string) {
      const days = Math.max(...activities.map(a => a.dayNumber));
      return Array.from({ length: days }, (_, i) => {
        const dayNumber = i + 1;
        const dayActivities = activities.filter(a => 
          a.dayNumber === dayNumber && 
          (a.tier === tier || 
           (tier === 'medium' && a.tier === 'budget') ||
           (tier === 'premium' && (a.tier === 'medium' || a.tier === 'budget')))
        );

        return {
          dayNumber,
          morning: dayActivities.find(a => a.timeSlot === 'morning'),
          afternoon: dayActivities.find(a => a.timeSlot === 'afternoon'),
          evening: dayActivities.find(a => a.timeSlot === 'evening'),
          morningOptions: dayActivities.filter(a => a.timeSlot === 'morning'),
          afternoonOptions: dayActivities.filter(a => a.timeSlot === 'afternoon'),
          eveningOptions: dayActivities.filter(a => a.timeSlot === 'evening')
        };
      });
    }

    // Validate and process activities
    const processedActivities = validateActivities(transformedActivities);

    if (processedActivities.length === 0) {
      logger.error('No valid activities after validation');
      throw new Error('Failed to generate valid activities with required details');
    }

    logger.info('Successfully validated activities', {
      total: transformedActivities.length,
      valid: processedActivities.length,
      byTier: processedActivities.reduce((acc: Record<string, number>, activity: ActivityValidation) => {
        acc[activity.tier] = (acc[activity.tier] || 0) + 1;
        return acc;
      }, {})
    });

    // Update the response to use validated activities
    res.json({
      activities: processedActivities,
      suggestedItineraries: {
        budget: generateItineraryForTier(processedActivities, 'budget'),
        medium: generateItineraryForTier(processedActivities, 'medium'),
        premium: generateItineraryForTier(processedActivities, 'premium')
      }
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