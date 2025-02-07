"use strict";
const TIER_CONFIGS = {
    budget: {
        maxPrice: 1000,
        allowedClasses: ['ECONOMY']
    },
    medium: {
        maxPrice: 2000,
        allowedClasses: ['ECONOMY', 'PREMIUM_ECONOMY']
    },
    premium: {
        maxPrice: Infinity,
        allowedClasses: ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']
    }
};
filterFlightsByTier(flights, Flight[], tier, 'budget' | 'medium' | 'premium');
Flight[];
{
    const config = TIER_CONFIGS[tier];
    return flights.filter(flight => {
        return flight.price <= config.maxPrice &&
            config.allowedClasses.includes(flight.cabinClass);
    });
}
validateFlightDistribution(groupedFlights, (Record));
{
    const counts = {
        budget: groupedFlights.budget?.length || 0,
        medium: groupedFlights.medium?.length || 0,
        premium: groupedFlights.premium?.length || 0
    };
    // Ensure we have at least some budget options
    if (counts.budget === 0) {
        logger.warn('No budget flights found, retrying with relaxed price constraints');
        return this.searchWithRelaxedConstraints();
    }
    // Aim for reasonable distribution
    const total = counts.budget + counts.medium + counts.premium;
    const budgetPercentage = (counts.budget / total) * 100;
    if (budgetPercentage < 20) {
        logger.warn('Insufficient budget flight options', {
            distribution: counts,
            budgetPercentage
        });
        return this.searchWithRelaxedConstraints();
    }
    return groupedFlights;
}
async;
searchWithRelaxedConstraints();
Promise < Record < string, Flight[] >> {
// Implement relaxed search logic here
// For example, increase price thresholds or expand date range
};
requestQueue: (Array) = [];
isProcessing = false;
RATE_LIMIT_DELAY = 500; // ms between requests
async;
processQueue();
{
    if (this.isProcessing)
        return;
    this.isProcessing = true;
    while (this.requestQueue.length > 0) {
        const request = this.requestQueue.shift();
        if (request) {
            try {
                await request();
            }
            catch (error) {
                logger.error('Error processing flight request:', error);
            }
            await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_DELAY));
        }
    }
    this.isProcessing = false;
}
