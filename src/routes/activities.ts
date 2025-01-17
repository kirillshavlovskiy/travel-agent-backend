import { Router, Request, Response } from 'express';
import { perplexityClient } from '../services/perplexity.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Add this helper function to fix common JSON issues
function sanitizeJsonString(str: string): string {
  return str
    // Fix common JSON issues
    .replace(/\n/g, ' ')                    // Remove newlines
    .replace(/\r/g, ' ')                    // Remove carriage returns
    .replace(/\t/g, ' ')                    // Remove tabs
    .replace(/\s+/g, ' ')                   // Normalize spaces
    .replace(/"\s*:\s*undefined/g, '":null') // Replace undefined with null
    .replace(/"\s*:\s*NaN/g, '":0')         // Replace NaN with 0
    .replace(/"\s*:\s*Infinity/g, '":0')    // Replace Infinity with 0
    .replace(/"\s*:\s*-Infinity/g, '":0')   // Replace -Infinity with 0
    .replace(/"\s*:\s*'/g, '":"')           // Fix single quotes after colon
    .replace(/'\s*:/g, '"":')               // Fix single quotes before colon
    .replace(/:\s*'([^']*)'/g, ':"$1"')     // Replace single quoted values
    .replace(/,(\s*[}\]])/g, '$1')          // Remove trailing commas
    .replace(/,\s*,/g, ',')                 // Remove double commas
    .replace(/\[\s*,/g, '[')                // Remove leading comma in arrays
    .replace(/{\s*,/g, '{')                 // Remove leading comma in objects
    .replace(/}\s*{/g, '},{')               // Fix adjacent objects
    .replace(/]\s*\[/g, '],[')              // Fix adjacent arrays
    .replace(/"\s*}/g, '"}')                // Fix space before closing brace
    .replace(/"\s*]/g, '"]')                // Fix space before closing bracket
    .trim();
}

function cleanAndValidateResponse(content: string): any {
  logger.debug('Cleaning and validating response', { 
    contentLength: content.length,
    contentPreview: content.substring(0, 200)
  });

  // Remove markdown code block markers and clean the content
  content = content
    .replace(/```json\n?|\n?```/g, '')  // Remove markdown
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
    .trim();

  // First attempt: Try to parse the entire content as JSON
  try {
    return JSON.parse(content);
  } catch (parseError) {
    logger.warn('Failed to parse complete response, attempting to extract activities', { 
      error: parseError instanceof Error ? parseError.message : 'Unknown error',
      contentPreview: content.substring(0, 500)
    });

    try {
      // Extract activities array using regex
      const activitiesMatch = content.match(/\{\s*"activities"\s*:\s*\[([\s\S]*?)\]\s*\}/);
      if (!activitiesMatch) {
        throw new Error('Could not find activities array in response');
      }

      // Clean up the activities array content
      let activitiesContent = activitiesMatch[1];
      
      // Split into individual activity objects
      const activityMatches = activitiesContent.match(/\{[^{]*?"day"\s*:\s*\d+[^}]*?\}/g);
      if (!activityMatches) {
        throw new Error('No activity objects found in response');
      }

      // Process each activity object
      const activities = activityMatches.map(activityStr => {
        try {
          // Clean up the activity string
          const cleanedActivity = activityStr
            .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":') // Quote unquoted keys
            .replace(/:\s*'([^']*?)'/g, ':"$1"') // Replace single quotes with double quotes
            .replace(/,\s*}/g, '}') // Remove trailing commas
            .replace(/\\/g, '\\\\') // Escape backslashes
            .replace(/([^\\])"/g, '$1\\"') // Escape unescaped quotes
            .replace(/\s+/g, ' '); // Normalize whitespace

          return JSON.parse(cleanedActivity);
        } catch (activityError) {
          logger.warn('Failed to parse activity', {
            activity: activityStr,
            error: activityError instanceof Error ? activityError.message : 'Unknown error'
          });
          return null;
        }
      }).filter(Boolean);

      if (activities.length === 0) {
        throw new Error('No valid activities could be parsed');
      }

      logger.debug('Successfully parsed activities', {
        count: activities.length,
        firstActivity: activities[0]
      });

      return { activities };

    } catch (extractError) {
      logger.error('Failed to extract activities from response', { 
        error: extractError instanceof Error ? extractError.message : 'Unknown error',
        originalError: parseError instanceof Error ? parseError.message : 'Unknown error'
      });
      throw new Error('Failed to parse activities from response: ' + 
        (extractError instanceof Error ? extractError.message : 'Unknown error'));
    }
  }
}

// Add type definitions and helper functions
interface ActivityValidation {
  name: string;
  description: string;
  price: { amount: number; currency: string };
  location: {
    name: string;
    address: string;
    publicTransport: string;
    walkingTime: number;
  };
  operatingHours: {
    weekday: string;
    weekend: string;
    lastEntry?: string;
    seasonal?: string;
    holiday?: string;
  };
  booking: {
    method: string;
    url: string;
    cancellationPolicy: string;
    groupSizeLimit?: string;
    ageRestrictions?: string;
  };
  contact: {
    website: string;
    phone: string;
    email: string;
    socialMedia?: string[];
  };
  details: {
    category: string;
    rating: number;
    numberOfReviews: number;
    duration: number;
    highlights: string[];
    languages?: string[];
    accessibility?: string;
    dressCode?: string;
    photoPolicy?: string;
    paymentMethods: string[];
  };
  images: {
    main: string;
    gallery: string[];
    virtualTour?: string;
  };
  dayNumber: number;
  timeSlot: string;
  tier: string;
}

function determineTier(price: number): string {
  if (price <= 30) return 'budget';
  if (price <= 100) return 'medium';
  return 'premium';
}

function validateActivities(activities: ActivityValidation[]): ActivityValidation[] {
  return activities.filter(activity => {
    // Log the activity being validated
    logger.debug('Validating activity', {
      name: activity.name,
      price: activity.price,
      tier: activity.tier,
      hasBookingInfo: !!activity.booking,
      hasOperatingHours: !!activity.operatingHours
    });

    // Check for required fields
    if (!activity.name || !activity.description || !activity.price || !activity.location) {
      logger.warn('Activity missing basic required fields', { 
        activity: activity.name,
        hasDescription: !!activity.description,
        hasPrice: !!activity.price,
        hasLocation: !!activity.location
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

    // Validate booking information
    if (!activity.booking?.url?.startsWith('http') || !activity.booking.method) {
      logger.warn('Invalid or missing booking information', { 
        activity: activity.name,
        bookingUrl: activity.booking?.url,
        bookingMethod: activity.booking?.method
      });
      return false;
    }

    // Validate operating hours
    if (!activity.operatingHours?.weekday || !activity.operatingHours?.weekend) {
      logger.warn('Missing operating hours', { 
        activity: activity.name,
        weekdayHours: activity.operatingHours?.weekday,
        weekendHours: activity.operatingHours?.weekend
      });
      return false;
    }

    // Validate contact information
    if (!activity.contact?.phone && !activity.contact?.email) {
      logger.warn('Missing contact information', { 
        activity: activity.name,
        hasPhone: !!activity.contact?.phone,
        hasEmail: !!activity.contact?.email
      });
      return false;
    }

    // Validate images
    if (!activity.images?.main?.startsWith('http') || activity.images.gallery.length === 0) {
      logger.warn('Invalid or missing images', { 
        activity: activity.name,
        hasMainImage: !!activity.images?.main,
        galleryCount: activity.images?.gallery?.length
      });
      return false;
    }

    // Validate details
    if (!activity.details?.highlights?.length || activity.details.highlights.length < 5) {
      logger.warn('Missing or insufficient highlights', { 
        activity: activity.name,
        highlightsCount: activity.details?.highlights?.length
      });
      return false;
    }

    return true;
  });
}

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
   - Category (specific category like "Cultural", "Adventure", "Food & Dining", "Entertainment", "Nature", "Shopping")
   - Rating (realistic rating between 1-5, with one decimal place)
   - Number of reviews (realistic number between 100-10000)

2. Detailed Description:
   - Description (3-4 engaging sentences about the experience, history, and what to expect)
   - Key highlights (5 specific features or unique aspects, each 1-2 sentences)
   - Recommended duration (specific number of hours, e.g., "2.5 hours")

3. Location & Access:
   - Location (specific neighborhood/district name)
   - Exact address (complete street address with postal code)
   - Nearest public transport (metro station or bus stop)
   - Walking time from public transport (in minutes)

4. Operating Hours:
   - Weekday hours (e.g., "Monday-Friday: 09:00-18:00")
   - Weekend hours (e.g., "Saturday-Sunday: 10:00-20:00")
   - Last entry time (if applicable)
   - Seasonal variations (if any)
   - Holiday schedule (if different)

5. Booking Information:
   - Price per person in ${currency} (specific amount, not a range)
   - Booking method (options: "Online booking required", "On-site tickets available", "Advance reservation required", "Walk-in welcome")
   - Booking URL (actual official website or verified booking platform)
   - Cancellation policy (e.g., "Free cancellation up to 24 hours before")
   - Group size limits (if any)
   - Age restrictions (if any)

6. Contact Details:
   - Official website URL
   - Phone number (with country code)
   - Email address
   - Social media handles (if available)

7. Additional Information:
   - Preferred time of day (morning/afternoon/evening)
   - Best time to visit (to avoid crowds)
   - Dress code (if any)
   - Accessibility information
   - Languages available (for tours/guides)
   - Included amenities
   - Photo policy
   - Payment methods accepted

8. Images:
   - Main image URL (high-quality exterior or main attraction shot)
   - Gallery URLs (2-3 additional images showing different aspects)
   - Virtual tour URL (if available)

Price Guidelines:
- Budget activities: $15-30 per person
- Medium activities: $31-100 per person
- Premium activities: $101-300 per person

Format as a JSON object with an activities array. Each activity must include ALL the above fields with accurate, realistic data. Do not use placeholder text or generic descriptions. Each description, highlight, and detail should be specific to the actual activity and location.`;

    logger.debug('Sending query to Perplexity API', { query });
    const response = await perplexityClient.chat(query);
    
    if (!response.choices?.[0]?.message?.content) {
      logger.error('Invalid response format from Perplexity API', { response });
      throw new Error('Invalid response format from Perplexity API');
    }

    const content = response.choices[0].message.content;
    logger.debug('Raw content from Perplexity API', { contentLength: content.length });
    
    // Clean and parse the response
    const parsedData = cleanAndValidateResponse(content);
    logger.debug('Successfully parsed response', { 
      activityCount: parsedData.activities?.length 
    });

    // Transform the activities
    const transformedActivities = parsedData.activities.map((activity: any) => ({
      dayNumber: activity.day,
      name: activity.name,
      description: activity.description,
      price: {
        amount: parseFloat(activity.bookingInformation.pricePerPerson),
        currency
      },
      location: {
        name: activity.location,
        address: activity.address,
        publicTransport: activity.nearestPublicTransport,
        walkingTime: parseInt(activity.walkingTimeFromPublicTransport) || 0
      },
      operatingHours: {
        weekday: activity.operatingHours,
        weekend: activity.operatingHours,
        lastEntry: activity.lastEntryTime,
        seasonal: activity.seasonalVariations,
        holiday: activity.holidaySchedule
      },
      booking: {
        method: activity.bookingInformation.bookingMethod,
        url: activity.bookingInformation.bookingUrl,
        cancellationPolicy: activity.bookingInformation.cancellationPolicy,
        groupSizeLimit: activity.bookingInformation.groupSizeLimits,
        ageRestrictions: activity.bookingInformation.ageRestrictions
      },
      contact: {
        website: activity.contactDetails.officialWebsiteUrl,
        phone: activity.contactDetails.phoneNumber,
        email: activity.contactDetails.emailAddress,
        socialMedia: activity.contactDetails.socialMediaHandles
      },
      details: {
        category: activity.category,
        rating: activity.rating,
        numberOfReviews: activity.reviews,
        duration: parseFloat(activity.recommendedDuration) || 2,
        highlights: activity.keyHighlights,
        languages: activity.additionalInformation.languagesAvailable?.split(', '),
        accessibility: activity.additionalInformation.accessibilityInformation,
        dressCode: activity.additionalInformation.dressCode,
        photoPolicy: activity.additionalInformation.photoPolicy,
        paymentMethods: activity.additionalInformation.paymentMethodsAccepted || []
      },
      images: {
        main: activity.images.mainImageUrl,
        gallery: activity.images.galleryUrls || [],
        virtualTour: activity.images.virtualTourUrl
      },
      timeSlot: activity.additionalInformation.preferredTimeOfDay.toLowerCase(),
      tier: determineTier(parseFloat(activity.bookingInformation.pricePerPerson))
    }));

    logger.debug('Transformed activities', { 
      count: transformedActivities.length,
      firstActivity: transformedActivities[0]
    });

    // Validate the transformed activities
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

    // Generate itineraries
    const suggestedItineraries = {
      budget: generateItineraryForTier(processedActivities, 'budget'),
      medium: generateItineraryForTier(processedActivities, 'medium'),
      premium: generateItineraryForTier(processedActivities, 'premium')
    };

    // Return the response
    res.json({
      activities: processedActivities,
      suggestedItineraries
    });

  } catch (error) {
    logger.error('Failed to generate activities', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate activities',
      timestamp: new Date().toISOString()
    });
  }
});

export default router; 