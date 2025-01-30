import { Router, Request, Response } from 'express';
import { perplexityClient } from '../services/perplexity.js';
import { viatorClient } from '../services/viator.js';
import { logger } from '../utils/logger.js';
import { ViatorService } from '../services/viator.js';
import { PerplexityService } from '../services/perplexity.js';
import { Activity } from '../types/activity';

const router = Router();

router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { destination, days, budget, currency, flightTimes } = req.body;

    // Validate required parameters
    if (!destination || !days || !budget || !currency) {
      logger.warn('Missing required parameters', {
        hasDestination: !!destination,
        hasDays: !!days,
        hasBudget: !!budget,
        hasCurrency: !!currency
      });
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters',
        timestamp: new Date().toISOString()
      });
    }

    logger.info('Received activity generation request', {
      destination,
      days,
      budget,
      currency,
      flightTimes
    });

    const perplexityService = new PerplexityService();
    const result = await perplexityService.generateActivities({
      destination,
      days,
      budget,
      currency,
      flightTimes
    });

    // Validate the generated activities
    if (!result.activities || !Array.isArray(result.activities) || result.activities.length === 0) {
      logger.warn('No activities generated', { result });
      return res.status(200).json({
        success: false,
        error: 'No activities could be generated. Please try again.',
        timestamp: new Date().toISOString()
      });
    }

    logger.info('Successfully generated activities', {
      totalActivities: result.activities.length,
      enrichedCount: result.activities.filter((a: Activity) => a.commentary).length,
      daysWithSummaries: result.dailySummaries.length
    });

    // Return the response in the format expected by the frontend
    return res.json({
      success: true,
      activities: result.activities,
      dailySummaries: result.dailySummaries,
      metadata: {
        ...result.metadata,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Error generating activities', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate activities',
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/enrich', async (req, res) => {
  try {
    const { activityId, referenceUrl, name } = req.body;
    
    if (!referenceUrl && !name) {
      return res.status(400).json({
        error: 'Either referenceUrl or activity name is required'
      });
    }

    // Extract product code from URL or use fallback search
    const productCode = referenceUrl?.match(/\-([a-zA-Z0-9]+)(?:\?|$)/)?.[1];
    
    logger.info('Enriching activity details', {
      activityId,
      productCode,
      name
    });

    const viatorClient = new ViatorService(process.env.VIATOR_API_KEY || '');
    
    try {
      const enrichedData = await viatorClient.enrichActivityDetails(productCode || '', name);

      if (enrichedData.error) {
        logger.warn('Activity enrichment returned with error', {
          activityId,
          error: enrichedData.error
        });
      }

      // Log the structure of enriched data for debugging
      logger.debug('Enriched activity data structure:', {
        hasDetails: !!enrichedData.details,
        detailsStructure: enrichedData.details ? Object.keys(enrichedData.details) : [],
        hasHighlights: Array.isArray(enrichedData.highlights),
        highlightsCount: enrichedData.highlights?.length,
        hasReviews: !!enrichedData.reviews?.items,
        reviewsCount: enrichedData.reviews?.items?.length,
        hasItinerary: !!enrichedData.itinerary,
        itineraryType: enrichedData.itinerary?.itineraryType,
        location: enrichedData.details?.meetingAndPickup?.meetingPoint
      });

      res.json(enrichedData);
    } catch (error) {
      logger.error('Error getting activity details:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        activityId,
        productCode
      });

      // Return a structured error response that the frontend can handle
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get activity details',
        details: {
          name: name,
          overview: "Details temporarily unavailable. Please check back later.",
          whatIncluded: { included: [], excluded: [] },
          additionalInfo: {}
        },
        images: [],
        highlights: [],
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error('Error enriching activity:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An unknown error occurred',
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