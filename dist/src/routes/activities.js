import { Router } from 'express';
import { perplexityClient } from '../services/perplexity.js';
import { ViatorService } from '../services/viator.js';
import { logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';
const activitiesRouter = Router();
// Initialize Viator service
const viatorService = new ViatorService();
// Add counter at the top of the file
let perplexityCallCounter = 0;
// Add default preferences constant
const DEFAULT_PREFERENCES = {
    travelStyle: 'medium',
    pacePreference: 'moderate',
    interests: ['Cultural & Historical', 'Nature & Adventure'],
    accessibility: [],
    dietaryRestrictions: []
};
// Update validation function to use defaults
function validatePreferences(preferences) {
    if (!preferences) {
        logger.warn('No preferences provided, using defaults');
        return DEFAULT_PREFERENCES;
    }
    // Create a new preferences object with defaults for missing fields
    const validatedPreferences = {
        travelStyle: typeof preferences.travelStyle === 'string' ? preferences.travelStyle : DEFAULT_PREFERENCES.travelStyle,
        pacePreference: typeof preferences.pacePreference === 'string' ? preferences.pacePreference : DEFAULT_PREFERENCES.pacePreference,
        interests: Array.isArray(preferences.interests) ? preferences.interests : DEFAULT_PREFERENCES.interests,
        accessibility: Array.isArray(preferences.accessibility) ? preferences.accessibility : DEFAULT_PREFERENCES.accessibility,
        dietaryRestrictions: Array.isArray(preferences.dietaryRestrictions) ? preferences.dietaryRestrictions : DEFAULT_PREFERENCES.dietaryRestrictions
    };
    logger.info('Using preferences:', validatedPreferences);
    return validatedPreferences;
}
// Add scoring calculation function
function calculateActivityScore(activity, preferences) {
    let score = 0;
    const matchedPreferences = [];
    const scoringReasons = [];
    // Base score for having reviews
    if (activity.numberOfReviews > 50) {
        score += 1;
        scoringReasons.push('Well-reviewed activity');
    }
    // Score based on rating
    if (activity.rating) {
        if (activity.rating >= 4.5) {
            score += 2;
            scoringReasons.push('Highly rated');
        }
        else if (activity.rating >= 4.0) {
            score += 1;
            scoringReasons.push('Good rating');
        }
    }
    // Match interests
    preferences.interests.forEach((interest) => {
        const interestLower = interest.toLowerCase();
        if (activity.description?.toLowerCase().includes(interestLower) ||
            activity.category?.toLowerCase().includes(interestLower)) {
            score += 1;
            matchedPreferences.push(interest);
            scoringReasons.push(`Matches ${interest} interest`);
        }
    });
    // Match travel style
    const price = activity.price?.amount || 0;
    const tier = price <= 50 ? 'budget' : price <= 150 ? 'medium' : 'premium';
    if (tier === preferences.travelStyle.toLowerCase()) {
        score += 1;
        matchedPreferences.push(`${preferences.travelStyle} travel style`);
        scoringReasons.push('Matches travel style preference');
    }
    // Match accessibility needs
    preferences.accessibility.forEach((need) => {
        if (activity.description?.toLowerCase().includes(need.toLowerCase())) {
            score += 1;
            matchedPreferences.push(need);
            scoringReasons.push(`Accommodates ${need}`);
        }
    });
    // Match dietary restrictions
    preferences.dietaryRestrictions.forEach((restriction) => {
        if (activity.description?.toLowerCase().includes(restriction.toLowerCase())) {
            score += 1;
            matchedPreferences.push(restriction);
            scoringReasons.push(`Suitable for ${restriction} diet`);
        }
    });
    return {
        preferenceScore: score,
        matchedPreferences,
        scoringReason: scoringReasons.join('. ')
    };
}
// Add deduplication function
function deduplicateActivities(activities) {
    // Only deduplicate exact duplicates (same name AND product code)
    const seen = new Set();
    const uniqueActivities = activities.filter(activity => {
        const key = `${activity.name}|${activity.bookingInfo?.productCode || ''}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
    logger.info('Activities after deduplication:', {
        originalCount: activities.length,
        uniqueCount: uniqueActivities.length,
        removedCount: activities.length - uniqueActivities.length
    });
    return uniqueActivities;
}
// Add helper function to initialize day slots
function initializeDaySlots(days) {
    const slots = {};
    for (let day = 1; day <= days; day++) {
        slots[day] = {
            morning: [],
            afternoon: [],
            evening: []
        };
    }
    return slots;
}
// Add function for location validation
function validateLocation(bestMatch, destination) {
    const destinationName = (destination.label || destination).toLowerCase();
    const destinationParts = destinationName.split(/[,\s]+/)
        .filter((part) => part.length > 3) // Filter out short words and airport codes
        .map((part) => part.toLowerCase());
    // Get all possible location fields from the best match
    const locationSources = [
        bestMatch.location?.address,
        bestMatch.location?.meetingPoint,
        bestMatch.location?.coordinates?.description,
        bestMatch.destinations?.[0]?.name,
        bestMatch.location?.description,
        bestMatch.title,
        bestMatch.description
    ].filter(Boolean).map((loc) => loc.toLowerCase());
    // Extract location mentions from description
    const descriptionLocations = bestMatch.description?.match(/\b(?:in|at|near|around)\s+([A-Z][a-zA-Z\s]+(?:,\s*[A-Z][a-zA-Z\s]+)*)/g) || [];
    const extractedLocations = descriptionLocations.map((loc) => loc.replace(/^(?:in|at|near|around)\s+/, '').toLowerCase());
    const allLocationSources = [...new Set([...locationSources, ...extractedLocations])];
    // Check if any location source contains any part of the destination
    const isLocationMatch = allLocationSources.some(loc => destinationParts.some(part => loc.includes(part)));
    return {
        isMatch: isLocationMatch,
        locationSources: allLocationSources,
        destinationParts
    };
}
// Update the activity grouping logic
function groupActivitiesByDayAndSlot(activities, days) {
    // Initialize the structure with all days and time slots
    const slots = {};
    for (let day = 1; day <= days; day++) {
        slots[day] = {
            morning: [],
            afternoon: [],
            evening: []
        };
    }
    // Group activities
    activities.forEach(activity => {
        const day = activity.dayNumber || 1;
        const slot = activity.timeSlot || 'morning';
        // Ensure the day and slot exist
        if (!slots[day]) {
            slots[day] = { morning: [], afternoon: [], evening: [] };
        }
        if (!slots[day][slot]) {
            slots[day][slot] = [];
        }
        slots[day][slot].push(activity);
    });
    return slots;
}
// Update the schedule creation to use the new grouping
function createBasicSchedule(activities, days) {
    const groupedActivities = groupActivitiesByDayAndSlot(activities, days);
    const schedule = [];
    const preselectedByDay = new Map();
    const unselectedActivities = activities.filter(a => !a.selected);
    // First, group preselected activities by day
    activities.filter(a => a.selected).forEach(activity => {
        if (!preselectedByDay.has(activity.dayNumber)) {
            preselectedByDay.set(activity.dayNumber, []);
        }
        preselectedByDay.get(activity.dayNumber)?.push(activity);
    });
    // Calculate how many additional activities we need per day
    const targetActivitiesPerDay = 3; // morning, afternoon, evening
    for (let day = 1; day <= days; day++) {
        const preselectedForDay = preselectedByDay.get(day) || [];
        const preselectedTimeSlots = new Set(preselectedForDay.map(a => a.timeSlot));
        // Calculate how many more activities we need for this day
        const neededActivities = targetActivitiesPerDay - preselectedForDay.length;
        // Get available time slots for this day
        const availableTimeSlots = ['morning', 'afternoon', 'evening'].filter(slot => !preselectedTimeSlots.has(slot));
        // Select additional activities for available time slots
        const additionalActivities = unselectedActivities
            .filter(activity => !activity.selected)
            .slice(0, neededActivities)
            .map((activity, index) => ({
            ...activity,
            timeSlot: availableTimeSlots[index] || 'morning',
            startTime: availableTimeSlots[index] === 'morning' ? '09:00' :
                availableTimeSlots[index] === 'afternoon' ? '14:00' : '19:00',
            dayNumber: day
        }));
        const dayActivities = [...preselectedForDay, ...additionalActivities];
        schedule.push({
            dayNumber: day,
            theme: `Day ${day} Exploration`,
            mainArea: "City Center",
            commentary: `Day ${day} activities arranged by time slots`,
            highlights: [`Day ${day} main activities`],
            mapData: {
                center: { latitude: 0, longitude: 0 },
                bounds: { north: 0, south: 0, east: 0, west: 0 },
                locations: dayActivities.map((activity, index) => ({
                    name: activity.name,
                    coordinates: { latitude: 0, longitude: 0 },
                    address: activity.location || '',
                    type: 'activity',
                    category: activity.category,
                    description: activity.description || '',
                    duration: activity.duration || 120,
                    timeSlot: activity.timeSlot,
                    order: index + 1
                })),
                routes: []
            },
            breaks: {
                morning: {
                    startTime: "10:30",
                    endTime: "11:00",
                    duration: 30,
                    suggestion: "Coffee break",
                    location: "Nearby café"
                },
                lunch: {
                    startTime: "12:30",
                    endTime: "13:30",
                    duration: 60,
                    suggestion: "Lunch break",
                    location: "Local restaurant"
                },
                afternoon: {
                    startTime: "15:30",
                    endTime: "16:00",
                    duration: 30,
                    suggestion: "Rest break",
                    location: "Local park or café"
                },
                dinner: {
                    startTime: "18:30",
                    endTime: "20:00",
                    duration: 90,
                    suggestion: "Dinner",
                    location: "Restaurant district"
                }
            },
            logistics: {
                transportSuggestions: ["Use public transport between main locations"],
                walkingDistances: ["Walking distances vary between activities"],
                timeEstimates: ["Allow 15-30 minutes between activities for transitions"]
            },
            activities: dayActivities
        });
    }
    return {
        schedule,
        tripOverview: 'Schedule created with preselected activities and balanced additional activities',
        activityFitNotes: 'Activities arranged based on preselected choices and time slot availability'
    };
}
// Add function to log optimized schedule
function logOptimizedSchedule(schedule, destination, days) {
    const logDir = path.join(process.cwd(), 'logs');
    const logFile = path.join(logDir, 'optimized_plan.log');
    const timestamp = new Date().toISOString();
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    const logEntry = {
        timestamp,
        destination,
        days,
        optimization_results: {
            input_activities: schedule.reduce((sum, day) => sum + day.activities.length, 0),
            daily_breakdown: schedule.map(day => ({
                dayNumber: day.dayNumber,
                theme: day.theme,
                mainArea: day.mainArea,
                planningLogic: day.planningLogic || "15-30 minutes buffer between activities",
                activities: day.activities.map((activity) => ({
                    ...activity,
                    availability: {
                        ...activity.availability,
                        timeSlotVerification: {
                            requestedSlot: activity.timeSlot,
                            verifiedSlot: activity.availability?.verifiedTimeSlot,
                            availableSlots: activity.availability?.availableTimeSlots || [],
                            realTimeVerification: activity.availability?.realTimeVerification || {},
                            operatingHours: activity.availability?.operatingHours,
                            bestTimeToVisit: activity.availability?.bestTimeToVisit
                        }
                    }
                })),
                breaks: day.breaks,
                logistics: day.logistics,
                commentary: day.commentary,
                highlights: day.highlights,
                dailyStats: {
                    totalDuration: day.activities.reduce((sum, a) => sum + (a.duration || 0), 0),
                    averageRating: (day.activities.reduce((sum, a) => sum + (a.rating || 0), 0) / day.activities.length).toFixed(2),
                    categoryDistribution: day.activities.reduce((acc, a) => {
                        acc[a.category] = (acc[a.category] || 0) + 1;
                        return acc;
                    }, {}),
                    preferenceMatchRate: `${((day.activities.filter((a) => a.matchedPreferences?.length > 0).length / day.activities.length) * 100).toFixed(1)}%`
                }
            })),
            schedule_metrics: {
                total_activities: schedule.reduce((sum, day) => sum + day.activities.length, 0),
                activities_by_category: schedule.reduce((acc, day) => {
                    day.activities.forEach((a) => {
                        acc[a.category] = (acc[a.category] || 0) + 1;
                    });
                    return acc;
                }, {}),
                activities_by_tier: schedule.reduce((acc, day) => {
                    day.activities.forEach((a) => {
                        acc[a.tier || 'unspecified'] = (acc[a.tier || 'unspecified'] || 0) + 1;
                    });
                    return acc;
                }, {}),
                enrichment_rate: `${((schedule.reduce((sum, day) => sum + day.activities.filter((a) => a.availability?.realTimeVerification?.verified).length, 0) /
                    schedule.reduce((sum, day) => sum + day.activities.length, 0)) * 100).toFixed(1)}%`,
                preference_match_rate: `${((schedule.reduce((sum, day) => sum + day.activities.filter((a) => a.matchedPreferences?.length > 0).length, 0) /
                    schedule.reduce((sum, day) => sum + day.activities.length, 0)) * 100).toFixed(1)}%`,
                average_rating: (schedule.reduce((sum, day) => sum + day.activities.reduce((daySum, a) => daySum + (a.rating || 0), 0), 0) /
                    schedule.reduce((sum, day) => sum + day.activities.length, 0)).toFixed(2)
            },
            validation: {
                all_days_have_activities: schedule.every(day => day.activities.length > 0),
                activity_distribution_valid: schedule.every(day => {
                    const activitiesBySlot = {
                        morning: day.activities.filter((a) => a.timeSlot === 'morning').length,
                        afternoon: day.activities.filter((a) => a.timeSlot === 'afternoon').length,
                        evening: day.activities.filter((a) => a.timeSlot === 'evening').length
                    };
                    // Check if each time slot has 1-2 activities and total is <= 6
                    return Object.values(activitiesBySlot).every(count => count >= 1 && count <= 2) &&
                        day.activities.length <= 6;
                }),
                all_activities_have_required_fields: schedule.every(day => day.activities.every((a) => a.name && a.timeSlot && a.startTime && a.duration && a.location)),
                all_activities_have_booking_details: schedule.every(day => day.activities.every((a) => !!a.bookingDetails?.referenceUrl)),
                all_activities_have_availability: schedule.every(day => day.activities.every((a) => !!a.availability?.isAvailable)),
                time_slot_verification: schedule.every(day => day.activities.every((a) => a.availability?.verifiedTimeSlot === a.timeSlot ||
                    a.availability?.availableTimeSlots?.includes(a.timeSlot)))
            }
        }
    };
    // Write detailed log to file
    fs.appendFileSync(logFile, JSON.stringify(logEntry, null, 2) + '\n\n');
    // Log concise summary to console
    logger.info('[Schedule Optimization] Results:', {
        timestamp,
        destination,
        days,
        summary: {
            total_activities: logEntry.optimization_results.schedule_metrics.total_activities,
            enrichment_rate: logEntry.optimization_results.schedule_metrics.enrichment_rate,
            preference_match_rate: logEntry.optimization_results.schedule_metrics.preference_match_rate,
            average_rating: logEntry.optimization_results.schedule_metrics.average_rating,
            validation: logEntry.optimization_results.validation
        },
        activities_per_day: schedule.map(day => ({
            day: day.dayNumber,
            theme: day.theme,
            total: day.activities.length,
            slots: {
                morning: day.activities.filter(a => a.timeSlot === 'morning').length,
                afternoon: day.activities.filter(a => a.timeSlot === 'afternoon').length,
                evening: day.activities.filter(a => a.timeSlot === 'evening').length
            },
            categories: day.activities.reduce((cats, a) => {
                cats[a.category] = (cats[a.category] || 0) + 1;
                return cats;
            }, {}),
            highlights: day.highlights,
            planningLogic: day.planningLogic
        }))
    });
}
// Helper functions for schedule generation
export function generateDayTheme(activities, preferences) {
    const categories = activities.map(a => a.category).filter(Boolean);
    const mainCategory = mode(categories);
    const style = preferences?.travelStyle || 'balanced';
    return `${style.charAt(0).toUpperCase() + style.slice(1)} ${mainCategory} Exploration Day`;
}
export function generateDayCommentary(activities, preferences, dayNumber) {
    const areas = [...new Set(activities.map(a => a.location))].filter(Boolean);
    const mainInterests = preferences?.interests || [];
    const matchedInterests = activities
        .filter(a => mainInterests.some(i => a.category.toLowerCase().includes(i.toLowerCase())))
        .length;
    return `Day ${dayNumber} features ${activities.length} curated activities across ${areas.join(', ')}, ` +
        `aligned with ${matchedInterests} of your interests. ` +
        `The day is organized with a ${preferences?.pacePreference || 'moderate'} pace, ` +
        `balancing ${activities.map(a => a.category).join(', ')} experiences.`;
}
export function generateDayHighlights(activities, preferences) {
    const highlights = [];
    // Geographic organization
    const areas = [...new Set(activities.map(a => a.location))].filter(Boolean);
    if (areas.length > 1) {
        highlights.push(`Efficiently organized route through ${areas.join(' → ')}`);
    }
    // Activity highlights with preference matching
    activities.forEach(activity => {
        const matchedPreferences = preferences?.interests?.filter((interest) => activity.category.toLowerCase().includes(interest.toLowerCase())) || [];
        const highlight = `${activity.timeSlot.charAt(0).toUpperCase() + activity.timeSlot.slice(1)}: ` +
            `${activity.name} (${activity.duration} mins) - ` +
            `${matchedPreferences.length ? `Matches your ${matchedPreferences.join(', ')} interests` : 'General interest'}`;
        highlights.push(highlight);
    });
    return highlights;
}
export function generateBreakSchedule(activities, preferences) {
    const paceAdjustment = preferences?.pacePreference === 'relaxed' ? 30 :
        preferences?.pacePreference === 'intense' ? -15 : 0;
    return {
        morning: {
            startTime: "10:30",
            endTime: "11:00",
            duration: 30 + paceAdjustment,
            suggestion: `Coffee break with ${preferences?.travelStyle || 'local'} ambiance`
        },
        lunch: {
            startTime: "12:30",
            endTime: "13:30",
            duration: 60 + paceAdjustment,
            suggestion: preferences?.dietaryRestrictions?.length ?
                `Lunch break (${preferences.dietaryRestrictions.join(', ')} options available)` :
                "Lunch break at local restaurant"
        },
        afternoon: {
            startTime: "15:30",
            endTime: "16:00",
            duration: 30 + paceAdjustment,
            suggestion: "Rest and refresh"
        },
        dinner: {
            startTime: "18:30",
            endTime: "20:00",
            duration: 90 + paceAdjustment,
            suggestion: preferences?.interests?.includes('Food & Wine') ?
                "Culinary experience dinner" : "Dinner break"
        }
    };
}
export function generateLogistics(activities, preferences) {
    const areas = [...new Set(activities.map(a => a.location))].filter(Boolean);
    const accessibilityNeeds = preferences?.accessibility || [];
    return {
        transportSuggestions: [
            `Optimal route connecting ${areas.join(' → ')}`,
            ...accessibilityNeeds.map(need => `${need} friendly transportation options available`),
            "Public transport and walking combinations"
        ].filter(Boolean),
        walkingDistances: [
            `Distances optimized for ${preferences?.pacePreference || 'moderate'} pace`,
            `Major segments: ${activities.map(a => a.location).join(' → ')}`
        ],
        timeEstimates: [
            "15-30 minutes buffer between activities",
            `Adjusted for ${preferences?.pacePreference || 'moderate'} pace preference`,
            ...accessibilityNeeds.map(need => `Extra time allocated for ${need} accessibility`)
        ].filter(Boolean)
    };
}
export async function optimizeSchedule(activities, days, destination, preferences) {
    try {
        logger.info('[Schedule Optimization] Starting schedule optimization', {
            totalActivities: activities.length,
            days,
            destination,
            preferences
        });
        // Create a copy of activities to work with
        let remainingActivities = [...activities];
        // Initialize schedule array for each day
        const schedule = Array.from({ length: days }, (_, i) => {
            const dayNumber = i + 1;
            const dayActivities = [];
            // For each time slot (morning, afternoon, evening)
            ['morning', 'afternoon', 'evening'].forEach(timeSlot => {
                // Find one activity for this time slot
                const activityIndex = remainingActivities.findIndex(a => !a.timeSlot || a.timeSlot === timeSlot ||
                    !a.dayNumber || a.dayNumber === dayNumber);
                if (activityIndex !== -1) {
                    const activity = remainingActivities[activityIndex];
                    dayActivities.push({
                        ...activity,
                        timeSlot: timeSlot,
                        dayNumber,
                        startTime: activity.startTime || determineStartTime(timeSlot),
                        price: activity.price || activity.bookingDetails?.price || { amount: 0, currency: 'USD' }
                    });
                    // Remove the assigned activity
                    remainingActivities.splice(activityIndex, 1);
                }
            });
            // Generate comprehensive day plan
            return {
                dayNumber,
                theme: generateDayTheme(dayActivities, preferences),
                mainArea: determineMainArea(dayActivities),
                commentary: generateDayCommentary(dayActivities, preferences, dayNumber),
                highlights: generateDayHighlights(dayActivities, preferences),
                activities: dayActivities,
                breaks: generateBreakSchedule(dayActivities, preferences),
                logistics: generateLogistics(dayActivities, preferences),
                availabilityStats: calculateAvailabilityStats(dayActivities)
            };
        });
        // Log optimization results
        logOptimizedSchedule(schedule, destination, days);
        // Create the final optimized schedule
        const optimizedSchedule = {
            schedule,
            dailyHighlights: schedule.map(day => ({
                dayNumber: day.dayNumber,
                theme: day.theme,
                highlights: day.highlights
            })),
            tripOverview: generateTripOverview(schedule, destination)
        };
        // Log final distribution
        logger.info('[Schedule Optimization] Final activity distribution:', {
            totalDays: days,
            totalActivities: schedule.reduce((sum, day) => sum + day.activities.length, 0),
            byDay: schedule.map(day => ({
                day: day.dayNumber,
                activityCount: day.activities.length,
                timeSlots: {
                    morning: day.activities.filter(a => a.timeSlot === 'morning').length,
                    afternoon: day.activities.filter(a => a.timeSlot === 'afternoon').length,
                    evening: day.activities.filter(a => a.timeSlot === 'evening').length
                }
            }))
        });
        return optimizedSchedule;
    }
    catch (error) {
        logger.error('[Schedule Optimization] Failed to optimize schedule', {
            error: error instanceof Error ? error.message : 'Unknown error',
            destination,
            days
        });
        throw error;
    }
}
function determineTimeSlot(index) {
    switch (index) {
        case 0: return 'morning';
        case 1: return 'afternoon';
        case 2: return 'evening';
        default: return 'morning';
    }
}
function determineStartTime(timeSlot) {
    switch (timeSlot) {
        case 'morning': return '09:00';
        case 'afternoon': return '14:00';
        case 'evening': return '19:00';
        default: return '09:00';
    }
}
function calculateAvailabilityStats(activities) {
    return {
        verifiedActivities: activities.filter(a => a.availability?.isAvailable && a.bookingDetails?.productCode).length,
        totalActivities: activities.length,
        realTimeAvailabilityRate: `${((activities.filter(a => a.availability?.isAvailable).length / activities.length) * 100).toFixed(1)}%`
    };
}
function generateTripOverview(schedule, destination) {
    const totalActivities = schedule.reduce((sum, day) => sum + day.activities.length, 0);
    const days = schedule.length;
    return `${days}-day trip to ${destination} featuring ${totalActivities} activities evenly distributed across all days`;
}
function mode(arr) {
    return arr.sort((a, b) => arr.filter(v => v === a).length - arr.filter(v => v === b).length).pop() || '';
}
// Add function to clean JSON response
function cleanPerplexityResponse(response) {
    // Remove markdown code blocks if present
    let cleaned = response.replace(/```json\n|\n```/g, '');
    // Remove any comments (both # and //)
    cleaned = cleaned.replace(/\s*#.*$/gm, '');
    cleaned = cleaned.replace(/\s*\/\/.*$/gm, '');
    // Remove any trailing commas before closing brackets/braces
    cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
    return cleaned;
}
async function enrichActivity(activity, destination) {
    logger.info(`[Activity] Enriching activity:`, {
        name: activity.name,
        destination
    });
    try {
        // Search for the activity by name to get product code
        const searchResults = await viatorService.searchActivity(`${activity.name} in ${destination}`);
        if (!searchResults || searchResults.length === 0) {
            throw new Error(`No Viator activities found for: ${activity.name} in ${destination}`);
        }
        // Use the first search result
        const bestMatch = searchResults[0];
        const locationValidation = validateLocation(bestMatch, destination);
        if (!locationValidation.isMatch) {
            throw new Error(`Location mismatch for activity: ${activity.name}. Expected: ${destination}, Found: ${locationValidation.locationSources.join(', ')}`);
        }
        // Extract and validate product code
        const productCode = bestMatch.productCode;
        if (!productCode) {
            throw new Error(`No product code found for activity: ${activity.name}`);
        }
        // Get detailed product info
        const enriched = await viatorService.getProductDetails(productCode);
        if (!enriched) {
            throw new Error(`Failed to get product details for: ${activity.name} (${productCode})`);
        }
        // Perform real-time availability check
        const realTimeCheck = await viatorService.checkAvailability(productCode);
        // Construct reference URL
        const referenceUrl = `https://www.viator.com/tours/${destination.replace(/\s+/g, '-')}/${productCode}`;
        logger.info('[Viator API] Successfully enriched activity:', {
            name: activity.name,
            productCode,
            price: enriched.pricing?.summary?.fromPrice,
            rating: enriched.reviews?.combinedAverageRating,
            reviews: enriched.reviews?.totalReviews,
            referenceUrl,
            verified: !!realTimeCheck
        });
        return {
            ...activity,
            productCode,
            bookingDetails: {
                provider: 'Viator',
                productCode,
                referenceUrl,
                cancellationPolicy: enriched.bookingInfo?.cancellationPolicy,
                instantConfirmation: enriched.bookingInfo?.confirmationType === 'INSTANT',
                mobileTicket: enriched.bookingInfo?.mobileTicketing,
                minParticipants: enriched.bookingInfo?.minParticipants,
                maxParticipants: enriched.bookingInfo?.maxParticipants,
                pickupIncluded: enriched.bookingInfo?.pickup?.included,
                pickupLocation: enriched.bookingInfo?.pickup?.location,
                accessibility: enriched.bookingInfo?.accessibility,
                restrictions: enriched.bookingInfo?.restrictions,
                availability: {
                    startTimes: realTimeCheck?.schedule?.availableTimeSlots || enriched.availability?.startTimes,
                    daysAvailable: realTimeCheck?.schedule?.daysAvailable || enriched.availability?.daysAvailable,
                    nextAvailableDate: realTimeCheck?.schedule?.nextAvailableDate || enriched.availability?.nextAvailableDate,
                    operatingHours: realTimeCheck?.schedule?.openingHours || enriched.operatingHours
                }
            },
            price: {
                amount: realTimeCheck?.pricing?.fromPrice || enriched.pricing?.summary?.fromPrice || activity.price?.amount || 0,
                currency: realTimeCheck?.pricing?.currency || enriched.pricing?.currency || activity.price?.currency || 'USD'
            },
            rating: enriched.reviews?.combinedAverageRating || activity.rating,
            numberOfReviews: enriched.reviews?.totalReviews || activity.numberOfReviews,
            highlights: enriched.highlights || activity.highlights || [],
            operatingHours: realTimeCheck?.schedule?.openingHours?.join(', ') || '',
            source: 'Viator',
            enrichmentStatus: 'success',
            verified: !!realTimeCheck,
            realTimeVerification: {
                verified: !!realTimeCheck,
                lastChecked: new Date().toISOString(),
                exactStartTimes: realTimeCheck?.schedule?.availableTimeSlots || []
            }
        };
    }
    catch (error) {
        logger.error(`[Activity] Error enriching activity:`, {
            name: activity.name,
            error: error instanceof Error ? error.message : 'Unknown error',
            stage: 'error'
        });
        return {
            ...activity,
            enrichmentStatus: 'failed',
            verified: false,
            realTimeVerification: {
                verified: false,
                lastChecked: new Date().toISOString(),
                exactStartTimes: []
            }
        };
    }
}
// Add after the perplexityCallCounter
let perplexityMetrics = {
    totalCalls: 0,
    totalTokens: 0,
    lastCallTimestamp: new Date().toISOString()
};
export function determineMainArea(activities) {
    if (!activities || activities.length === 0) {
        return 'City Center';
    }
    // Count occurrences of each area
    const areaCount = activities.reduce((count, activity) => {
        const area = activity.location?.split(',')[0]?.trim() || 'City Center';
        count[area] = (count[area] || 0) + 1;
        return count;
    }, {});
    // Find the area with the most activities
    const mainArea = Object.entries(areaCount)
        .sort(([, countA], [, countB]) => countB - countA)
        .map(([area]) => area)[0] || 'City Center';
    return mainArea;
}
// Helper function to get default start time for a time slot
function getDefaultStartTime(timeSlot) {
    const defaultTimes = {
        morning: '09:00',
        afternoon: '14:00',
        evening: '19:00'
    };
    return defaultTimes[timeSlot] || '09:00';
}
activitiesRouter.post('/generate', async (req, res) => {
    try {
        const { destination, days, budget, currency, preferences, flightTimes, existingActivities, currentSchedule, skipPerplexityGeneration } = req.body;
        logger.info('Received activity generation request with preferences:', {
            destination,
            days,
            budget,
            currency,
            flightTimes,
            preferences: {
                travelStyle: preferences.travelStyle,
                pacePreference: preferences.pacePreference,
                interests: preferences.interests,
                accessibility: preferences.accessibility,
                dietaryRestrictions: preferences.dietaryRestrictions
            }
        });
        // Get initial activity suggestions from Perplexity
        const query = `Create a ${days}-day activity plan for ${destination} with the following requirements:

USER PREFERENCES:
- Travel Style: ${preferences.travelStyle}
- Pace: ${preferences.pacePreference}
- Interests: ${preferences.interests.join(', ')}
${preferences.accessibility.length ? `- Accessibility Needs: ${preferences.accessibility.join(', ')}` : ''}
${preferences.dietaryRestrictions.length ? `- Dietary Restrictions: ${preferences.dietaryRestrictions.join(', ')}` : ''}

BUDGET & QUALITY:
- Daily budget: ${budget} ${currency} per person
- Minimum rating: 4.0+ stars
- Must have at least 50 reviews

TIME SLOTS:
- Morning (9:00-13:00): Prioritize ${preferences.interests[0] || 'Cultural & Historical'} activities
- Afternoon (14:00-18:00): Focus on ${preferences.interests[1] || 'Nature & Adventure'} experiences
- Evening (19:00-23:00): Emphasize ${preferences.interests[2] || 'Food & Entertainment'} options

CRITICAL RULES:
1. ONLY suggest activities that strongly match user interests
2. Group activities by area to minimize travel time
3. Ensure activities align with user's ${preferences.pacePreference} pace preference
4. Consider accessibility needs in activity selection
5. Include variety while prioritizing user's interests

Return ONLY valid JSON with schedule array.`;
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
        let activitiesToProcess = parsedData.activities;
        let perplexityResponse = null;
        let perplexityMetrics = {
            totalCalls: 0,
            totalTokens: 0,
            lastCallTimestamp: null
        };
        // Check if we should use existing activities or generate new ones
        if (skipPerplexityGeneration && existingActivities?.length > 0) {
            logger.info('[Activities] Using existing activities for optimization', {
                existingActivitiesCount: existingActivities.length,
                hasCurrentSchedule: !!currentSchedule,
                firstActivity: existingActivities[0]?.name
            });
            activitiesToProcess = existingActivities;
        }
        else {
            // Generate initial activities with Perplexity
            logger.info('[Perplexity API] Starting activities generation');
            try {
                perplexityResponse = await perplexityClient.generateActivities({
                    destination: destination.label || destination,
                    days,
                    budget,
                    currency,
                    preferences,
                    flightTimes
                });
                if (!perplexityResponse?.activities || perplexityResponse.activities.length === 0) {
                    throw new Error('No activities returned from Perplexity API');
                }
                activitiesToProcess = perplexityResponse.activities;
                logger.info('[Perplexity API] Activities generated successfully', {
                    activityCount: activitiesToProcess.length,
                    hasSchedule: !!perplexityResponse.schedule,
                    hasDailySummaries: !!perplexityResponse.dailySummaries
                });
            }
            catch (error) {
                logger.error('[Perplexity API] Failed to generate activities', {
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                throw error;
            }
        }
        // Enrich activities with Viator data
        logger.info('[Activities] Starting Viator enrichment');
        const enrichedActivities = await Promise.all(activitiesToProcess.map(async (activity, index) => {
            try {
                const enriched = await enrichActivity(activity, destination.label || destination);
                logger.debug(`[Activities] Enriched activity ${index + 1}/${activitiesToProcess.length}:`, {
                    name: activity.name,
                    enriched: !!enriched,
                    hasBookingDetails: !!enriched?.bookingDetails,
                    price: enriched?.price || activity.price,
                    timeSlot: enriched?.timeSlot || activity.timeSlot
                });
                return enriched || activity;
            }
            catch (error) {
                logger.warn(`[Activities] Failed to enrich activity ${index + 1}/${activitiesToProcess.length}:`, {
                    activity: {
                        name: activity.name,
                        timeSlot: activity.timeSlot,
                        dayNumber: activity.dayNumber
                    },
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                return activity;
            }
        }));
        const enrichedCount = enrichedActivities.filter(a => a?.bookingDetails?.provider === 'Viator').length;
        logger.info('[Activities] Completed Viator enrichment:', {
            stage: 'enrichment_complete',
            totalActivities: activitiesToProcess.length,
            enrichedCount,
            successRate: `${(enrichedCount / activitiesToProcess.length * 100).toFixed(1)}%`
        });
        // Now optimize the schedule
        logger.info('[Schedule Optimization] Starting optimization');
        const optimizedSchedule = await optimizeSchedule(enrichedActivities.filter(Boolean), days, destination.label || destination, preferences);
        // Return the optimized schedule with proper structure
        return res.json({
            success: true,
            data: {
                activities: enrichedActivities.filter(Boolean),
                schedule: optimizedSchedule.schedule,
                dailyPlans: optimizedSchedule.schedule,
                dailyHighlights: optimizedSchedule.dailyHighlights,
                tripOverview: optimizedSchedule.tripOverview,
                totalBudget: budget,
                metadata: {
                    perplexityCalls: 0,
                    scheduleGeneration: {
                        source: 'budget_agent',
                        timestamp: new Date().toISOString(),
                        preferences
                    }
                }
            },
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        logger.error('[Activities] Failed to generate activities', {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
    }
});
// Add availability check endpoint
activitiesRouter.post('/availability/:productCode', async (req, res) => {
    const { productCode } = req.params;
    const { date } = req.body;
    try {
        if (!productCode) {
            return res.status(400).json({
                error: 'Product code is required'
            });
        }
        if (!date) {
            return res.status(400).json({
                error: 'Date is required'
            });
        }
        // Get the general availability schedule
        const availabilitySchedule = await viatorService.getAvailabilitySchedule(productCode);
        // Extract operating days and hours
        const operatingDays = availabilitySchedule.extractedDaysOfWeek || [];
        const operatingHours = availabilitySchedule.extractedOperatingHours || {};
        const timeSlots = availabilitySchedule.extractedTimeSlots || [];
        const unavailableDates = availabilitySchedule.extractedUnavailableDates || [];
        return res.json({
            operatingDays,
            operatingHours,
            timeSlots,
            unavailableDates,
            pricing: availabilitySchedule.extractedPricing
        });
    }
    catch (error) {
        logger.error('[Activities] Error checking availability:', {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        return res.status(500).json({
            error: 'Failed to check availability',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
export { activitiesRouter };
