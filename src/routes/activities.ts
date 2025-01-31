import { Router, Request, Response } from 'express';
import { perplexityClient } from '../services/perplexity.js';
import { viatorClient } from '../services/viator.js';
import { logger } from '../utils/logger.js';
import { ViatorService } from '../services/viator.js';

const router = Router();

router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { destination, days, budget, currency, flightTimes, preferences: rawPreferences } = req.body;

    // Default preferences structure
    const defaultPreferences = {
      travelStyle: 'balanced',
      pacePreference: 'moderate',
      interests: ['sightseeing', 'culture'],
      accessibility: [],
      dietaryRestrictions: [],
      budgetLevel: 'medium',
      priorityFactors: {
        price: 5,
        quality: 5,
        popularity: 5
      },
      preferredActivities: {
        cultural: true,
        outdoor: true,
        entertainment: true,
        shopping: true,
        foodAndDrink: true
      },
      timePreferences: {
        morningActivity: true,
        afternoonActivity: true,
        eveningActivity: true
      },
      requirements: {
        wheelchairAccessible: false,
        familyFriendly: false,
        skipLines: false,
        guidedTours: false
      }
    };

    // Safely merge preferences with defaults
    const preferences = {
      travelStyle: rawPreferences?.travelStyle || defaultPreferences.travelStyle,
      pacePreference: rawPreferences?.pacePreference || defaultPreferences.pacePreference,
      interests: rawPreferences?.interests || defaultPreferences.interests,
      accessibility: rawPreferences?.accessibility || defaultPreferences.accessibility,
      dietaryRestrictions: rawPreferences?.dietaryRestrictions || defaultPreferences.dietaryRestrictions,
      budgetLevel: rawPreferences?.budgetLevel || defaultPreferences.budgetLevel,
      priorityFactors: {
        price: rawPreferences?.priorityFactors?.price ?? defaultPreferences.priorityFactors.price,
        quality: rawPreferences?.priorityFactors?.quality ?? defaultPreferences.priorityFactors.quality,
        popularity: rawPreferences?.priorityFactors?.popularity ?? defaultPreferences.priorityFactors.popularity
      },
      preferredActivities: {
        cultural: rawPreferences?.preferredActivities?.cultural ?? defaultPreferences.preferredActivities.cultural,
        outdoor: rawPreferences?.preferredActivities?.outdoor ?? defaultPreferences.preferredActivities.outdoor,
        entertainment: rawPreferences?.preferredActivities?.entertainment ?? defaultPreferences.preferredActivities.entertainment,
        shopping: rawPreferences?.preferredActivities?.shopping ?? defaultPreferences.preferredActivities.shopping,
        foodAndDrink: rawPreferences?.preferredActivities?.foodAndDrink ?? defaultPreferences.preferredActivities.foodAndDrink
      },
      timePreferences: {
        morningActivity: rawPreferences?.timePreferences?.morningActivity ?? defaultPreferences.timePreferences.morningActivity,
        afternoonActivity: rawPreferences?.timePreferences?.afternoonActivity ?? defaultPreferences.timePreferences.afternoonActivity,
        eveningActivity: rawPreferences?.timePreferences?.eveningActivity ?? defaultPreferences.timePreferences.eveningActivity
      },
      requirements: {
        wheelchairAccessible: rawPreferences?.requirements?.wheelchairAccessible ?? defaultPreferences.requirements.wheelchairAccessible,
        familyFriendly: rawPreferences?.requirements?.familyFriendly ?? defaultPreferences.requirements.familyFriendly,
        skipLines: rawPreferences?.requirements?.skipLines ?? defaultPreferences.requirements.skipLines,
        guidedTours: rawPreferences?.requirements?.guidedTours ?? defaultPreferences.requirements.guidedTours
      }
    };

    logger.info('[Activity Generation] Request received', {
      destination,
      days,
      budget,
      currency,
      flightTimes,
      preferences // Log the complete preferences object
    });

    // Get activities from Perplexity service
    const result = await perplexityClient.generateActivities({
      destination,
      days,
      budget,
      currency,
      flightTimes,
      preferences
    });

    // Return the result directly
    res.json(result);

  } catch (error) {
    logger.error('[Activity Generation] Failed', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate activities',
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/enrich', async (req, res) => {
  try {
    const { activityId, productCode, name } = req.body;

    logger.info('[Activities API] Enriching activity:', {
      activityId,
      productCode,
      name
    });

    if (!productCode) {
      logger.warn('[Activities API] No product code provided');
      return res.status(400).json({ error: 'Product code is required' });
    }

    const viatorClient = new ViatorService(process.env.VIATOR_API_KEY || '');

    try {
      // First try to search for the activity
      const searchResults = await viatorClient.searchActivity(`productCode:${productCode}`);
      
      let enrichedActivity;
      
      if (!searchResults || searchResults.length === 0) {
        // If product code search fails, try searching by name
        logger.warn('[Activities API] Product not found by code, trying name search:', {
          productCode,
          name
        });
        
        const nameSearchResults = await viatorClient.searchActivity(name);
        if (!nameSearchResults || nameSearchResults.length === 0) {
          throw new Error('Activity not found by code or name');
        }

        // Find the best matching activity from name search
        const bestMatch = nameSearchResults[0];
        logger.info('[Activities API] Found activity by name:', {
          activityId,
          foundName: bestMatch.name,
          originalName: name
        });

        // Now enrich with product details
        enrichedActivity = await viatorClient.enrichActivityDetails({
          ...bestMatch,
          name: name || bestMatch.name,
          referenceUrl: bestMatch.referenceUrl
        });
      } else {
        const basicActivity = searchResults[0];
        
        // Now enrich with product details
        enrichedActivity = await viatorClient.enrichActivityDetails({
          ...basicActivity,
          name: name || basicActivity.name,
          referenceUrl: `https://www.viator.com/tours/${productCode}`
        });
      }

      logger.info('[Activities API] Successfully enriched activity with Viator data:', {
        activityId,
        productCode,
        hasEnrichedData: !!enrichedActivity
      });

      // Now enrich with Perplexity AI-generated content
      try {
        const query = `Please analyze this activity and provide commentary and highlights:
          Name: ${enrichedActivity.name}
          Location: ${enrichedActivity.location}
          Description: ${enrichedActivity.description || ''}
          Duration: ${enrichedActivity.duration} hours
          Price: ${enrichedActivity.price?.amount} ${enrichedActivity.price?.currency}

          Please provide:
          1. A 2-3 sentence commentary explaining why this activity is recommended and what makes it special
          2. A 1-2 sentence explanation of how this activity fits into a day's itinerary
          3. A list of key highlights and features`;

        const perplexityResponse = await perplexityClient.getEnrichedDetails(query);
        
        if (perplexityResponse && !perplexityResponse.error) {
          // Extract AI-generated content
          const {
            commentary,
            itineraryHighlight,
            highlights = [],
            description
          } = perplexityResponse;
          
          // Merge AI-generated content with Viator data
          enrichedActivity = {
            ...enrichedActivity,
            commentary: commentary || enrichedActivity.commentary,
            itineraryHighlight: itineraryHighlight || enrichedActivity.itineraryHighlight,
            description: description || enrichedActivity.description,
            highlights: highlights.length > 0 ? highlights : (enrichedActivity.highlights || [])
          };
          
          logger.info('[Activities API] Successfully added AI-generated content:', {
            activityId,
            hasCommentary: !!commentary,
            hasItineraryHighlight: !!itineraryHighlight,
            hasDescription: !!description,
            highlightsCount: highlights.length
          });
        }
      } catch (perplexityError) {
        logger.error('[Activities API] Error getting AI-generated content:', {
          error: perplexityError instanceof Error ? perplexityError.message : 'Unknown error',
          activityId
        });
        // Continue with Viator data only
      }

      res.json(enrichedActivity);
    } catch (error) {
      logger.error('[Activities API] Error getting activity details:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        activityId,
        productCode
      });
      throw error;
    }
  } catch (error) {
    logger.error('[Activities API] Error enriching activity:', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to enrich activity',
      timestamp: new Date().toISOString()
    });
  }
});

function validateActivity(activity: any): boolean {
  // Required fields
  if (!activity.day || !activity.name || !activity.description || 
      !activity.price || typeof activity.price.amount !== 'number' || !activity.location) {
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
  if (activity.price.amount < 0) {
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

  return true;
}

export default router; 