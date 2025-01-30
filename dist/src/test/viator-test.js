import { viatorClient } from '../services/viator.js';
import { logger } from '../utils/logger.js';
async function testViatorSearch() {
    try {
        // Step 1: Get Barcelona's destination ID
        const cityName = 'Barcelona';
        logger.info('Looking up destination ID for:', cityName);
        const destinationId = await viatorClient.getDestinationId(cityName);
        logger.info('Found destination ID:', destinationId);
        // Step 2: Search for the specific activity
        const activityName = 'East to West Route';
        logger.info('Searching for activity:', activityName);
        const searchResult = await viatorClient.searchActivity(activityName, destinationId);
        // Step 3: Log the results
        if (searchResult.products?.results?.length > 0) {
            const activity = searchResult.products.results[0];
            logger.info('Found activity:', {
                title: activity.title,
                productCode: activity.productCode,
                description: activity.description,
                duration: activity.duration?.fixedDurationInMinutes,
                price: activity.pricing?.summary?.fromPrice,
                currency: activity.pricing?.currency,
                rating: activity.reviews?.combinedAverageRating,
                reviewCount: activity.reviews?.totalReviews,
                bookingInfo: activity.bookingInfo,
                images: activity.images?.map(img => img.variants[0]?.url),
                highlights: activity.highlights,
                location: activity.location
            });
        }
        else {
            logger.warn('No results found for activity:', activityName);
        }
    }
    catch (error) {
        logger.error('Test failed:', error);
    }
}
// Run the test
testViatorSearch();
