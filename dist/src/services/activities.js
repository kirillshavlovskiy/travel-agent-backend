import { logger } from '../utils/logger';
function scoreActivity(activity, preferences) {
    let score = 0;
    let preferredTimeSlot = 'afternoon'; // default
    // Base score from rating (0-5 scale, weighted heavily)
    score += (activity.rating || 0) * 2;
    // Number of reviews factor (normalize to 0-1 and weight)
    const reviewScore = Math.min(activity.numberOfReviews || 0, 1000) / 1000;
    score += reviewScore;
    // Price tier alignment with travel style
    const priceScore = calculatePriceScore(activity, preferences.travelStyle);
    score += priceScore;
    // Determine preferred time slot based on activity type and description
    preferredTimeSlot = determinePreferredTimeSlot(activity);
    // Duration factor - prefer activities that fit well within time slots
    const duration = activity.duration || estimateActivityDuration(activity);
    const durationScore = calculateDurationScore(duration);
    score += durationScore;
    return {
        activity,
        score,
        preferredTimeSlot,
        duration
    };
}
function calculatePriceScore(activity, travelStyle) {
    const price = activity.price?.amount || 0;
    // Define price ranges for different tiers
    const priceRanges = {
        budget: { min: 0, max: 50 },
        moderate: { min: 51, max: 150 },
        luxury: { min: 151, max: Infinity }
    };
    // Match price to travel style
    if (travelStyle === 'budget' && price <= priceRanges.budget.max)
        return 1;
    if (travelStyle === 'moderate' && price >= priceRanges.moderate.min && price <= priceRanges.moderate.max)
        return 1;
    if (travelStyle === 'luxury' && price >= priceRanges.luxury.min)
        return 1;
    return 0;
}
function determinePreferredTimeSlot(activity) {
    const title = activity.name.toLowerCase();
    const description = activity.description?.toLowerCase() || '';
    // Evening activities
    if (title.includes('dinner') ||
        title.includes('night') ||
        title.includes('evening') ||
        description.includes('evening tour') ||
        description.includes('night tour')) {
        return 'evening';
    }
    // Morning activities
    if (title.includes('breakfast') ||
        title.includes('morning') ||
        description.includes('early morning') ||
        description.includes('sunrise')) {
        return 'morning';
    }
    // Cultural activities prefer morning/afternoon
    if (activity.category === 'Cultural & Historical') {
        return 'morning';
    }
    // Food & entertainment activities prefer afternoon/evening
    if (activity.category === 'Food & Entertainment') {
        return 'evening';
    }
    return 'afternoon'; // default
}
function estimateActivityDuration(activity) {
    // If duration is explicitly provided, use it
    if (activity.duration)
        return activity.duration;
    // Estimate based on category and type
    const category = activity.category;
    switch (category) {
        case 'Cultural & Historical':
            return 3; // Museums, historical sites typically take 2-3 hours
        case 'Nature & Adventure':
            return 4; // Outdoor activities usually take longer
        case 'Food & Entertainment':
            return 2; // Food tours, shows typically 2 hours
        default:
            return 2; // Default duration
    }
}
function calculateDurationScore(duration) {
    // Prefer activities that fit well within time slots (typically 3-4 hours)
    if (duration >= 2 && duration <= 4)
        return 1;
    if (duration < 2)
        return 0.5; // Too short
    return -0.5; // Too long
}
async function enrichViatorActivity(activity, timeSlot, dayNumber, preferences) {
    return {
        ...activity,
        timeSlot,
        dayNumber,
        selected: false
    };
}
function determineTier(price) {
    if (price <= 50)
        return 'budget';
    if (price <= 150)
        return 'moderate';
    return 'luxury';
}
function getDateForDay(dayNumber, preferences) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + dayNumber - 1);
    return startDate.toISOString().split('T')[0];
}
function optimizeInternally(activities, preferences) {
    return activities
        // Filter long durations
        .filter(({ activity }) => {
        const durationInHours = activity.duration / 60;
        return durationInHours <= 8; // No multi-day activities
    })
        // Deduplicate by product code or similar name/location
        .filter((activity, index, self) => index === self.findIndex(a => (a.activity.bookingInfo?.productCode === activity.activity.bookingInfo?.productCode ||
        (a.activity.name === activity.activity.name &&
            a.activity.location === activity.activity.location))))
        // Transform to OptimizedActivity format
        .map(({ activity, score }) => ({
        ...activity,
        score,
        preferredTimeSlot: determinePreferredTimeSlot(activity),
        duration: activity.duration || estimateActivityDuration(activity)
    }))
        // Sort by score
        .sort((a, b) => b.score - a.score);
}
function generateSchedulePrompt(activities, preferences) {
    return `Optimize this schedule for ${preferences.duration} days in ${preferences.destination}.

Available Activities (pre-scored and filtered):
${activities.map(a => `- ${a.name} (Score: ${a.score}, Duration: ${a.duration}h, Category: ${a.category}, Price: ${a.price?.amount || 0} ${a.price?.currency || 'USD'})`).join('\n')}

Requirements:
1. Create a balanced schedule across ${preferences.duration} days
2. Respect activity scores (higher scored activities should be prioritized)
3. Consider geographic proximity within each day
4. Balance activity types across the trip
5. Ensure activities fit within time slots (morning: 9-13, afternoon: 14-18, evening: 19-23)
6. Keep daily budget around ${preferences.budget} ${preferences.currency}
7. Match travel style: ${preferences.travelStyle}
8. Consider user interests: ${preferences.interests.join(', ')}

Return a schedule as a JSON array of days, each containing activities with their time slots.`;
}
async function optimizeSchedule(scoredActivities, preferences) {
    logger.info('[Optimization] Starting schedule optimization with:', {
        totalActivities: scoredActivities.length,
        duration: preferences.duration,
        budget: preferences.budget
    });
    // 1. First do internal optimization
    const internallyOptimized = optimizeInternally(scoredActivities, preferences);
    logger.info('[Optimization] Internal optimization complete:', {
        originalCount: scoredActivities.length,
        optimizedCount: internallyOptimized.length,
        topScores: internallyOptimized.slice(0, 5).map(a => ({
            name: a.name,
            score: a.score
        }))
    });
    // 2. Create schedule using optimized activities
    const schedule = [];
    const usedActivities = new Set();
    // Create a schedule for each day
    for (let day = 1; day <= preferences.duration; day++) {
        const dayActivities = [];
        let dayBudget = preferences.budget;
        // Try to fill each time slot
        for (const timeSlot of ['morning', 'afternoon', 'evening']) {
            // Find available activities for this slot
            const availableActivities = internallyOptimized
                .filter(activity => {
                const activityKey = `${activity.name}-${activity.location}`;
                const price = activity.price?.amount || 0;
                return !usedActivities.has(activityKey) &&
                    price <= dayBudget &&
                    activity.preferredTimeSlot === timeSlot;
            })
                .sort((a, b) => b.score - a.score);
            if (availableActivities.length > 0) {
                const chosen = availableActivities[0];
                const enrichedActivity = await enrichViatorActivity(chosen, timeSlot, day, preferences);
                dayActivities.push(enrichedActivity);
                usedActivities.add(`${chosen.name}-${chosen.location}`);
                dayBudget -= chosen.price?.amount || 0;
            }
        }
        schedule.push(dayActivities);
    }
    logger.info('[Optimization] Final schedule:', {
        days: schedule.length,
        totalActivities: schedule.reduce((sum, day) => sum + day.length, 0),
        byDay: schedule.map((day, i) => ({
            day: i + 1,
            activities: day.map(a => ({
                name: a.name,
                timeSlot: a.timeSlot,
                price: a.price
            }))
        }))
    });
    return schedule;
}
async function createFallbackSchedule(activities, preferences) {
    const schedule = [];
    const usedActivities = new Set();
    for (let day = 0; day < preferences.duration; day++) {
        const dayActivities = [];
        let dayBudget = preferences.budget;
        // Try to fill each time slot
        for (const timeSlot of ['morning', 'afternoon', 'evening']) {
            const availableActivities = activities
                .filter(activity => {
                const activityKey = `${activity.name}-${activity.location}`;
                const price = activity.price?.amount || 0;
                return !usedActivities.has(activityKey) &&
                    price <= dayBudget &&
                    activity.preferredTimeSlot === timeSlot;
            })
                .sort((a, b) => b.score - a.score);
            if (availableActivities.length > 0) {
                const chosen = availableActivities[0];
                const enrichedActivity = await enrichViatorActivity(chosen, timeSlot, day + 1, preferences);
                dayActivities.push(enrichedActivity);
                usedActivities.add(`${chosen.name}-${chosen.location}`);
                dayBudget -= chosen.price?.amount || 0;
            }
        }
        schedule.push(dayActivities);
    }
    return schedule;
}
