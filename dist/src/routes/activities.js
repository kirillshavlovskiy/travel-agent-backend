import { Router } from 'express';
import { perplexityClient } from '../services/perplexity.js';
import { logger } from '../utils/logger.js';
import { ViatorService } from '../services/viator.js';
const router = Router();
router.post('/generate', async (req, res) => {
    try {
        const { destination, days, budget, currency, flightTimes } = req.body;
        logger.info('Received activity generation request', {
            destination,
            days,
            budget,
            currency,
            flightTimes
        });
        // Get initial activity suggestions from Perplexity
        const query = `Create a ${days}-day activity plan for ${destination} with the following requirements:

BUDGET & QUALITY:
- Daily budget: ${budget} ${currency} per person
- Minimum rating: 4.0+ stars on Viator
- Must have at least 50 reviews

ACTIVITY CATEGORIES:
- Cultural (museums, churches, historic sites)
- Outdoor (parks, walking tours, nature)
- Entertainment (shows, performances)
- Food & Drink (tastings, dining experiences)
- Shopping (markets, shopping areas)
- Adventure (sports, active experiences)

GEOGRAPHIC OPTIMIZATION:
- Group activities in the same area for each day
- Use these zones:
  1. Gothic Quarter & Las Ramblas
  2. Sagrada Familia & Modernist area
  3. Montjuïc & Port area
  4. Park Güell & Gracia
  5. Barceloneta & Beach area

TIME SLOTS:
- Morning (9:00-13:00): Prefer cultural & outdoor activities
- Afternoon (14:00-18:00): Prefer shopping & adventure activities
- Evening (19:00-23:00): Prefer food & entertainment activities

BALANCE REQUIREMENTS:
- Maximum 2 museums per day
- At least 1 outdoor activity per day
- Mix food experiences between lunches and dinners
- Include at least:
  * 2 walking tours
  * 2 food experiences
  * 1 flamenco show
  * 1 Gaudí-related activity
  * 1 cooking class

OUTPUT FORMAT:
Return a JSON array of activities, each with:
{
  "name": "EXACT Viator activity name",
  "timeSlot": "morning|afternoon|evening",
  "category": "Cultural|Outdoor|Entertainment|Food & Drink|Shopping|Adventure",
  "dayNumber": 1-${days},
  "zone": "Gothic Quarter|Sagrada Familia|Montjuïc|Park Güell|Barceloneta",
  "expectedDuration": "in minutes",
  "selected": false
}

CRITICAL RULES:
1. ONLY suggest activities that exist on Viator.com
2. Use EXACT names from Viator listings
3. Ensure activities in the same day are geographically close
4. Account for travel time between locations
5. Don't schedule overlapping activities
6. Consider seasonal/weather appropriate activities
7. Set selected to false for all activities

Return ONLY a valid JSON array of activities.`;
        logger.debug('Sending query to Perplexity API', { query });
        const response = await perplexityClient.chat(query);
        const parsedData = response;
        if (!parsedData.activities || !Array.isArray(parsedData.activities)) {
            logger.error('Invalid data structure', { parsedData });
            throw new Error('Invalid response format: missing or invalid activities array');
        }
        // Ensure all activities are unselected after regeneration
        parsedData.activities = parsedData.activities.map(activity => ({
            ...activity,
            selected: false
        }));
        // Enrich activities with Viator data
        const viatorClient = new ViatorService(process.env.VIATOR_API_KEY || '');
        const enrichedActivities = await Promise.all(parsedData.activities.map(async (activity) => {
            try {
                // Search for activities in Viator
                const searchResults = await viatorClient.searchActivity(`${activity.name} ${destination}`);
                if (!searchResults || searchResults.length === 0) {
                    logger.warn('No Viator activities found for:', activity.name);
                    return null;
                }
                // Return all valid activities
                return searchResults;
            }
            catch (error) {
                logger.error('Failed to enrich activity:', {
                    activity: activity.name,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                return null;
            }
        }));
        // Flatten and filter out failed enrichments and ensure uniqueness by productCode
        const validActivities = enrichedActivities
            .filter(result => result !== null)
            .flat()
            .filter((activity, index, self) => index === self.findIndex(a => a?.bookingInfo?.productCode === activity?.bookingInfo?.productCode));
        // Helper function to calculate similarity between activities
        const calculateSimilarity = (activity1, activity2) => {
            const name1 = activity1.name.toLowerCase();
            const name2 = activity2.name.toLowerCase();
            const desc1 = activity1.description?.toLowerCase() || '';
            const desc2 = activity2.description?.toLowerCase() || '';
            // Calculate name similarity
            const nameSimilarity = name1 === name2 ? 1 :
                name1.includes(name2) || name2.includes(name1) ? 0.8 :
                    0;
            // Calculate description similarity if both exist
            const descSimilarity = desc1 && desc2 ?
                (desc1 === desc2 ? 1 :
                    desc1.includes(desc2) || desc2.includes(desc1) ? 0.7 :
                        0) : 0;
            // Calculate location similarity
            const locationSimilarity = activity1.location === activity2.location ? 1 : 0;
            // Weighted average
            return (nameSimilarity * 0.5) + (descSimilarity * 0.3) + (locationSimilarity * 0.2);
        };
        // Deduplicate and balance activities
        const deduplicateAndBalanceActivities = (activities, days) => {
            // First, remove exact duplicates by productCode
            const uniqueByCode = activities.filter((activity, index, self) => index === self.findIndex(a => a?.bookingInfo?.productCode === activity?.bookingInfo?.productCode));
            // Then, remove similar activities
            const uniqueActivities = [];
            const seenCategories = new Set();
            const categoryCount = {};
            uniqueByCode.forEach(activity => {
                // Check if we already have a very similar activity
                const hasSimilar = uniqueActivities.some(existingActivity => calculateSimilarity(activity, existingActivity) > 0.7);
                if (!hasSimilar) {
                    const category = activity.category || 'Uncategorized';
                    categoryCount[category] = (categoryCount[category] || 0) + 1;
                    seenCategories.add(category);
                }
            });
            // Calculate target activities per category
            const totalTimeSlots = days * 3; // 3 slots per day
            const targetPerCategory = Math.ceil(totalTimeSlots / seenCategories.size);
            // Balance categories
            uniqueByCode.forEach(activity => {
                const category = activity.category || 'Uncategorized';
                // Check similarity with existing activities
                const hasSimilar = uniqueActivities.some(existingActivity => calculateSimilarity(activity, existingActivity) > 0.7);
                // Add activity if:
                // 1. No similar activity exists
                // 2. Category hasn't reached its target count
                // 3. We need more activities to fill the days
                if (!hasSimilar &&
                    (categoryCount[category] || 0) < targetPerCategory &&
                    uniqueActivities.length < totalTimeSlots) {
                    uniqueActivities.push(activity);
                    categoryCount[category] = (categoryCount[category] || 0) + 1;
                }
            });
            // Log category distribution
            console.log('Category distribution after balancing:', categoryCount);
            return uniqueActivities;
        };
        // Apply deduplication and balancing
        const balancedActivities = deduplicateAndBalanceActivities(validActivities, days);
        if (balancedActivities.length === 0) {
            logger.warn('No valid activities found after deduplication and balancing');
            return res.status(200).json({
                activities: [],
                message: "Could not find valid activities. Please try again.",
                error: true
            });
        }
        // Transform the balanced activities
        const transformedActivities = balancedActivities.map((activity, index) => {
            // Calculate day number and time slot based on index
            const timeSlotIndex = Math.floor(index / balancedActivities.length);
            const dayNumber = Math.floor(timeSlotIndex / 3) + 1;
            const timeSlot = ['morning', 'afternoon', 'evening'][timeSlotIndex % 3];
            // Get price value
            let price = 0;
            if (typeof activity?.price === 'object' && activity.price !== null) {
                price = activity.price.amount || 0;
            }
            else if (typeof activity?.price === 'number') {
                price = activity.price;
            }
            else if (typeof activity?.price === 'string') {
                price = activity.price.toLowerCase() === 'free' ? 0 : parseFloat(activity.price) || 0;
            }
            // Determine tier based on price
            const tier = price <= 50 ? 'budget' : price <= 150 ? 'medium' : 'premium';
            return {
                id: `activity_${index + 1}`,
                name: activity?.name || '',
                description: activity?.description || '',
                duration: activity?.duration || 120,
                price: {
                    amount: price,
                    currency: req.body.currency || 'USD'
                },
                location: activity?.location || destination,
                address: activity?.address || '',
                openingHours: activity?.openingHours || 'Hours not specified',
                keyHighlights: activity?.keyHighlights || [],
                rating: activity?.rating || 0,
                numberOfReviews: activity?.numberOfReviews || 0,
                category: activity?.category || 'Cultural',
                tier,
                timeSlot,
                dayNumber,
                startTime: timeSlot === 'morning' ? '09:00' :
                    timeSlot === 'afternoon' ? '14:00' : '19:00',
                referenceUrl: activity?.bookingInfo?.referenceUrl || activity?.referenceUrl || '',
                images: activity?.images || [],
                preferredTimeOfDay: timeSlot,
                provider: 'Viator',
                bookingInfo: {
                    provider: 'Viator',
                    productCode: activity?.bookingInfo?.productCode || '',
                    cancellationPolicy: activity?.bookingInfo?.cancellationPolicy || 'Standard cancellation policy',
                    instantConfirmation: activity?.bookingInfo?.instantConfirmation || true,
                    mobileTicket: activity?.bookingInfo?.mobileTicket || true,
                    languages: activity?.bookingInfo?.languages || ['English'],
                    minParticipants: activity?.bookingInfo?.minParticipants || 1,
                    maxParticipants: activity?.bookingInfo?.maxParticipants || 999
                },
                selected: false
            };
        });
        logger.info('Successfully transformed activities', { count: transformedActivities.length });
        // Group activities by day and tier for suggested itineraries
        const groupedActivities = new Map();
        // Initialize groups for each day
        for (let day = 1; day <= days; day++) {
            groupedActivities.set(day, {
                budget: { morning: [], afternoon: [], evening: [] },
                medium: { morning: [], afternoon: [], evening: [] },
                premium: { morning: [], afternoon: [], evening: [] }
            });
        }
        // Group activities by day, tier, and time slot
        transformedActivities.forEach(activity => {
            const dayGroup = groupedActivities.get(activity.dayNumber);
            if (dayGroup?.[activity.tier]?.[activity.timeSlot]) {
                dayGroup[activity.tier][activity.timeSlot].push(activity);
            }
        });
        // Create suggested itineraries
        const suggestedItineraries = {
            budget: [],
            medium: [],
            premium: []
        };
        // Generate itineraries for each day
        for (let day = 1; day <= days; day++) {
            const dayActivities = groupedActivities.get(day) || {
                budget: { morning: [], afternoon: [], evening: [] },
                medium: { morning: [], afternoon: [], evening: [] },
                premium: { morning: [], afternoon: [], evening: [] }
            };
            // Budget tier
            suggestedItineraries.budget.push({
                dayNumber: day,
                morning: dayActivities?.budget?.morning?.[0] || null,
                afternoon: dayActivities?.budget?.afternoon?.[0] || null,
                evening: dayActivities?.budget?.evening?.[0] || null,
                morningOptions: dayActivities?.budget?.morning || [],
                afternoonOptions: dayActivities?.budget?.afternoon || [],
                eveningOptions: dayActivities?.budget?.evening || []
            });
            // Medium tier (includes budget options as fallback)
            suggestedItineraries.medium.push({
                dayNumber: day,
                morning: dayActivities?.medium?.morning?.[0] || dayActivities?.budget?.morning?.[0] || null,
                afternoon: dayActivities?.medium?.afternoon?.[0] || dayActivities?.budget?.afternoon?.[0] || null,
                evening: dayActivities?.medium?.evening?.[0] || dayActivities?.budget?.evening?.[0] || null,
                morningOptions: [...(dayActivities?.medium?.morning || []), ...(dayActivities?.budget?.morning || [])],
                afternoonOptions: [...(dayActivities?.medium?.afternoon || []), ...(dayActivities?.budget?.afternoon || [])],
                eveningOptions: [...(dayActivities?.medium?.evening || []), ...(dayActivities?.budget?.evening || [])]
            });
            // Premium tier (includes medium and budget options as fallback)
            suggestedItineraries.premium.push({
                dayNumber: day,
                morning: dayActivities?.premium?.morning?.[0] || dayActivities?.medium?.morning?.[0] || dayActivities?.budget?.morning?.[0] || null,
                afternoon: dayActivities?.premium?.afternoon?.[0] || dayActivities?.medium?.afternoon?.[0] || dayActivities?.budget?.afternoon?.[0] || null,
                evening: dayActivities?.premium?.evening?.[0] || dayActivities?.medium?.evening?.[0] || dayActivities?.budget?.evening?.[0] || null,
                morningOptions: [...(dayActivities?.premium?.morning || []), ...(dayActivities?.medium?.morning || []), ...(dayActivities?.budget?.morning || [])],
                afternoonOptions: [...(dayActivities?.premium?.afternoon || []), ...(dayActivities?.medium?.afternoon || []), ...(dayActivities?.budget?.afternoon || [])],
                eveningOptions: [...(dayActivities?.premium?.evening || []), ...(dayActivities?.medium?.evening || []), ...(dayActivities?.budget?.evening || [])]
            });
        }
        res.json({
            activities: transformedActivities,
            suggestedItineraries
        });
    }
    catch (error) {
        logger.error('Failed to generate activities', { error: error instanceof Error ? error.message : 'Unknown error' });
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
            }
            else {
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
                    const { commentary, itineraryHighlight, highlights = [], description } = perplexityResponse;
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
            }
            catch (perplexityError) {
                logger.error('[Activities API] Error getting AI-generated content:', {
                    error: perplexityError instanceof Error ? perplexityError.message : 'Unknown error',
                    activityId
                });
                // Continue with Viator data only
            }
            res.json(enrichedActivity);
        }
        catch (error) {
            logger.error('[Activities API] Error getting activity details:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                activityId,
                productCode
            });
            throw error;
        }
    }
    catch (error) {
        logger.error('[Activities API] Error enriching activity:', {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to enrich activity',
            timestamp: new Date().toISOString()
        });
    }
});
function validateActivity(activity) {
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
