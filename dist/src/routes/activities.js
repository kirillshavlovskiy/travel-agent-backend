import { Router } from 'express';
import { ViatorService } from '../services/viator.js';
import { logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import { PerplexityService } from '../services/perplexity.js';
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
function validateLocation(bestMatch, destination) {
    const destinationName = (destination.label || destination).toLowerCase();
    const destinationParts = destinationName.split(/[,\s]+/)
        .filter((part) => part.length > 3)
        .map((part) => part.toLowerCase());
    const locationSources = [
        bestMatch.location?.address,
        bestMatch.location?.meetingPoint,
        bestMatch.location?.coordinates?.description,
        bestMatch.destinations?.[0]?.name,
        bestMatch.location?.description,
        bestMatch.title,
        bestMatch.description
    ].filter(Boolean).map((loc) => loc.toLowerCase());
    const descriptionLocations = bestMatch.description?.match(/\b(?:in|at|near|around)\s+([A-Z][a-zA-Z\s]+(?:,\s*[A-Z][a-zA-Z\s]+)*)/g) || [];
    const extractedLocations = descriptionLocations.map((loc) => loc.replace(/^(?:in|at|near|around)\s+/, '').toLowerCase());
    const allLocationSources = [...new Set([...locationSources, ...extractedLocations])];
    const isLocationMatch = allLocationSources.some(loc => destinationParts.some((part) => loc.includes(part)));
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
// Update the schedule creation function
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
        const availableTimeSlots = ['morning', 'afternoon', 'evening'].filter((slot) => !preselectedTimeSlots.has(slot));
        // Select additional activities for available time slots
        const additionalActivities = unselectedActivities
            .filter(activity => !activity.selected && activity.availability?.realTimeVerification?.exactStartTimes?.length > 0)
            .slice(0, neededActivities)
            .map((activity, index) => {
            const timeSlot = availableTimeSlots[index] || 'morning';
            const availableTimes = activity.availability?.realTimeVerification?.exactStartTimes || [];
            const timesByCategory = activity.availability?.timesByCategory || {};
            // Get available times for the desired time slot
            const slotTimes = timesByCategory[timeSlot] || [];
            // If no times available for desired slot, try to find times in other slots
            if (slotTimes.length === 0) {
                logger.warn(`No available times found for ${activity.name} in slot ${timeSlot}, skipping activity`);
                return null;
            }
            // Select the first available time for the slot
            const startTime = slotTimes[0];
            return {
                ...activity,
                timeSlot,
                startTime,
                dayNumber: day,
                availability: {
                    ...activity.availability,
                    isAvailable: true,
                    availableTimeSlots: Object.keys(timesByCategory).filter(slot => timesByCategory[slot].length > 0),
                    exactStartTimes: availableTimes,
                    timesByCategory,
                    realTimeVerification: {
                        verified: true,
                        exactStartTimes: availableTimes,
                        lastChecked: new Date().toISOString()
                    }
                }
            };
        })
            .filter((activity) => activity !== null);
        const dayActivities = [...preselectedForDay, ...additionalActivities];
        // Only add the day to schedule if it has activities with real availability
        if (dayActivities.length > 0) {
            schedule.push({
                dayNumber: day,
                theme: `Day ${day} Exploration`,
                mainArea: determineMainArea(dayActivities),
                commentary: generateDayCommentary(dayActivities, day),
                highlights: generateDayHighlights(dayActivities, {}),
                activities: dayActivities,
                breaks: generateBreakSchedule(dayActivities, {}),
                logistics: generateLogistics(dayActivities, {}),
                availabilityStats: calculateAvailabilityStats(dayActivities)
            });
        }
    }
    return {
        schedule,
        dailyHighlights: schedule.map(day => ({
            dayNumber: day.dayNumber,
            theme: day.theme,
            highlights: day.highlights
        })),
        tripOverview: 'Schedule created with verified real-time availability'
    };
}
// Add function to log optimized schedule
function logOptimizedSchedule(schedule, destination, days, startDate) {
    try {
        const logDir = path.join(process.cwd(), 'logs');
        const logFile = path.join(logDir, 'optimized_plan.log');
        const timestamp = new Date().toISOString();
        // Create logs directory if it doesn't exist
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const totalActivities = schedule.reduce((sum, day) => sum + (day.activities?.length || 0), 0);
        const logEntry = {
            timestamp,
            destination,
            days,
            dates: {
                start: startDate,
                end: new Date(new Date(startDate).getTime() + (days - 1) * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            },
            optimization_results: {
                input_activities: totalActivities,
                scheduled_activities: totalActivities,
                daily_breakdown: schedule.map((day, index) => {
                    const currentDate = new Date(startDate);
                    currentDate.setDate(currentDate.getDate() + index);
                    const dateStr = currentDate.toISOString().split('T')[0];
                    return {
                        dayNumber: day.dayNumber,
                        date: dateStr,
                        theme: day.theme || 'Exploration Day',
                        mainArea: day.mainArea || 'City Center',
                        planningLogic: "15-30 minutes buffer between activities",
                        activities: (day.activities || []).map(activity => ({
                            name: activity.name,
                            description: activity.description,
                            category: activity.category,
                            timeSlot: activity.timeSlot,
                            startTime: activity.startTime,
                            duration: activity.duration,
                            price: activity.price,
                            location: activity.location,
                            rating: activity.rating,
                            numberOfReviews: activity.numberOfReviews,
                            bookingDetails: activity.bookingDetails,
                            availability: activity.availability
                        })),
                        breaks: day.breaks || {
                            morning: { startTime: "", endTime: "", duration: 0, suggestion: "" },
                            lunch: { startTime: "", endTime: "", duration: 0, suggestion: "" },
                            afternoon: { startTime: "", endTime: "", duration: 0, suggestion: "" },
                            dinner: { startTime: "", endTime: "", duration: 0, suggestion: "" }
                        },
                        logistics: day.logistics || {
                            transportSuggestions: [],
                            walkingDistances: [],
                            timeEstimates: []
                        },
                        commentary: day.commentary || 'No commentary available',
                        highlights: day.highlights || [],
                        dailyStats: {
                            totalDuration: (day.activities || []).reduce((sum, a) => sum + (a.duration || 0), 0),
                            averageRating: ((day.activities || []).reduce((sum, a) => sum + (a.rating || 0), 0) / (day.activities?.length || 1)).toFixed(2),
                            categoryDistribution: (day.activities || []).reduce((acc, a) => {
                                acc[a.category || 'unspecified'] = (acc[a.category || 'unspecified'] || 0) + 1;
                                return acc;
                            }, {}),
                            preferenceMatchRate: `${(((day.activities || []).filter(a => a.preferenceScore > 0).length / (day.activities?.length || 1)) * 100).toFixed(1)}%`
                        }
                    };
                })
            }
        };
        // Append to log file instead of overwriting
        const logString = JSON.stringify(logEntry, null, 2) + '\n---\n';
        fs.appendFileSync(logFile, logString);
        // Log concise summary to console
        logger.info('[Schedule Optimization] Results:', {
            timestamp,
            destination,
            days,
            dates: logEntry.dates,
            total_activities: totalActivities,
            daily_breakdown: logEntry.optimization_results.daily_breakdown.map(day => ({
                dayNumber: day.dayNumber,
                date: day.date,
                activities: day.activities.length,
                highlights: day.highlights
            }))
        });
    }
    catch (error) {
        logger.error('[Schedule Optimization] Failed to log schedule:', error);
    }
}
// Helper functions for schedule generation
export function generateDayTheme(activities, preferences) {
    const categories = activities.map(a => a.category).filter(Boolean);
    const mainCategory = mode(categories);
    const style = preferences?.travelStyle || 'balanced';
    return `${style.charAt(0).toUpperCase() + style.slice(1)} ${mainCategory} Exploration Day`;
}
export function generateDayCommentary(activities, dayNumber) {
    if (!Array.isArray(activities)) {
        logger.warn('[Schedule] Invalid activities array in generateDayCommentary', {
            dayNumber,
            receivedType: typeof activities,
            activities
        });
        return `Day ${dayNumber} activities`;
    }
    const sortedActivities = activities.sort((a, b) => {
        const timeSlotOrder = { morning: 0, afternoon: 1, evening: 2 };
        return timeSlotOrder[a.timeSlot] - timeSlotOrder[b.timeSlot];
    });
    const timeSlots = {
        morning: sortedActivities.filter(a => a.timeSlot === 'morning'),
        afternoon: sortedActivities.filter(a => a.timeSlot === 'afternoon'),
        evening: sortedActivities.filter(a => a.timeSlot === 'evening')
    };
    const parts = [];
    if (timeSlots.morning.length > 0) {
        parts.push(`Start your day with ${timeSlots.morning.map(a => a.name).join(' and ')}`);
    }
    if (timeSlots.afternoon.length > 0) {
        parts.push(`continue with ${timeSlots.afternoon.map(a => a.name).join(' and ')}`);
    }
    if (timeSlots.evening.length > 0) {
        parts.push(`end your day experiencing ${timeSlots.evening.map(a => a.name).join(' and ')}`);
    }
    return parts.join(' ');
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
            ...accessibilityNeeds.map((need) => `${need} friendly transportation options available`),
            "Public transport and walking combinations"
        ].filter(Boolean),
        walkingDistances: [
            `Distances optimized for ${preferences?.pacePreference || 'moderate'} pace`,
            `Major segments: ${activities.map(a => a.location).join(' → ')}`
        ],
        timeEstimates: [
            "15-30 minutes buffer between activities",
            `Adjusted for ${preferences?.pacePreference || 'moderate'} pace preference`,
            ...accessibilityNeeds.map((need) => `Extra time allocated for ${need} accessibility`)
        ].filter(Boolean)
    };
}
export async function optimizeSchedule(activities, days, destination, preferences, startDate) {
    try {
        logger.info(`[Schedule] Starting schedule optimization for ${activities.length} activities over ${days} days`);
        // Ensure we have a valid start date
        const tripStartDate = startDate ? new Date(startDate) : new Date();
        if (isNaN(tripStartDate.getTime())) {
            throw new Error(`Invalid start date: ${startDate}`);
        }
        // Create a copy of activities to work with
        const validatedActivities = activities.filter(activity => {
            if (!validateTimeSlot(activity)) {
                logger.warn(`[Schedule] Removing activity with invalid time slot:`, {
                    name: activity.name,
                    timeSlot: activity.timeSlot,
                    duration: activity.duration
                });
                return false;
            }
            return true;
        });
        // Sort activities by duration (longest first) and rating
        validatedActivities.sort((a, b) => {
            // Prioritize selected activities
            if (a.selected !== b.selected)
                return b.selected ? 1 : -1;
            // Then sort by duration (longest first)
            if (a.duration !== b.duration)
                return b.duration - a.duration;
            // Then by rating and preference score
            const aScore = (a.rating || 0) + (a.preferenceScore || 0);
            const bScore = (b.rating || 0) + (b.preferenceScore || 0);
            return bScore - aScore;
        });
        // Initialize schedule array and tracking structures
        const schedule = [];
        const unscheduledActivities = [];
        const occupiedSlots = new Map();
        // Helper function to check time conflicts for a specific date
        const hasTimeConflict = (startTime, duration, dateStr) => {
            const start = new Date(`${dateStr}T${startTime}`);
            const end = new Date(start);
            end.setMinutes(end.getMinutes() + duration);
            const daySlots = occupiedSlots.get(dateStr) || [];
            return daySlots.some(slot => {
                const conflict = (start >= slot.start && start < slot.end) ||
                    (end > slot.start && end <= slot.end) ||
                    (start <= slot.start && end >= slot.end);
                if (conflict) {
                    logger.info(`[Schedule] Time conflict detected:`, {
                        newActivity: { startTime, duration },
                        existingActivity: {
                            name: slot.activity,
                            start: slot.start.toISOString(),
                            end: slot.end.toISOString()
                        }
                    });
                }
                return conflict;
            });
        };
        // Helper function to add activity to schedule
        const scheduleActivity = (activity, startTime, dateStr, dayNumber) => {
            const start = new Date(`${dateStr}T${startTime}`);
            const end = new Date(start);
            end.setMinutes(end.getMinutes() + activity.duration);
            const scheduledActivity = {
                ...activity,
                startTime,
                dayNumber,
                timeSlot: determineTimeSlot(startTime, activity.duration)
            };
            // Initialize day slots if not exists
            if (!occupiedSlots.has(dateStr)) {
                occupiedSlots.set(dateStr, []);
            }
            // Add to occupied slots
            occupiedSlots.get(dateStr)?.push({
                start,
                end,
                activity: activity.name
            });
            logger.info(`[Schedule] Scheduled "${activity.name}" for ${dateStr}`, {
                startTime,
                duration: activity.duration,
                timeSlot: scheduledActivity.timeSlot
            });
            return scheduledActivity;
        };
        // Process each day
        for (let i = 0; i < days; i++) {
            const dayNumber = i + 1;
            const currentDate = new Date(tripStartDate);
            currentDate.setDate(currentDate.getDate() + i);
            const dateStr = currentDate.toISOString().split('T')[0];
            logger.info(`[Schedule] Processing day ${dayNumber} (${dateStr})`);
            const scheduledActivities = [];
            let dayDuration = 0;
            // First schedule preselected activities for this day
            const preselectedForDay = validatedActivities
                .filter(activity => activity.selected && activity.dayNumber === dayNumber)
                .map(activity => {
                // Check availability for this date
                const availableDates = activity.availability?.tripPeriodAvailability?.availableDates || [];
                if (availableDates.length > 0 && !availableDates.includes(dateStr)) {
                    logger.warn(`[Schedule] Preselected activity "${activity.name}" is not available on ${dateStr}`);
                    return null;
                }
                // Get available times for this date
                const dateSpecificTimes = activity.availability?.tripPeriodAvailability?.availabilityByDate?.[dateStr] || [];
                const availableTimes = dateSpecificTimes.length > 0 ?
                    dateSpecificTimes :
                    activity.availability?.realTimeVerification?.exactStartTimes || [];
                // Try to schedule at an available time
                for (const time of availableTimes) {
                    if (!hasTimeConflict(time, activity.duration, dateStr)) {
                        const scheduled = scheduleActivity(activity, time, dateStr, dayNumber);
                        dayDuration += activity.duration;
                        return scheduled;
                    }
                }
                logger.warn(`[Schedule] Could not schedule preselected activity "${activity.name}" on ${dateStr}`);
                return null;
            })
                .filter((activity) => activity !== null);
            scheduledActivities.push(...preselectedForDay);
            // Then try to schedule unselected activities
            const availableActivities = validatedActivities.filter(activity => !activity.selected &&
                !scheduledActivities.some(sa => sa.name === activity.name) &&
                !Array.from(occupiedSlots.values()).flat().some(slot => slot.activity === activity.name));
            // Try to fill each time slot (morning, afternoon, evening)
            const timeSlots = ['morning', 'afternoon', 'evening'];
            for (const slot of timeSlots) {
                // Skip if we've reached daily limits
                if (scheduledActivities.length >= 5 || dayDuration >= 720) {
                    logger.info(`[Schedule] Reached daily limits for day ${dayNumber}:`, {
                        activities: scheduledActivities.length,
                        duration: dayDuration
                    });
                    break;
                }
                // Get activities suitable for this time slot
                const slotActivities = availableActivities.filter(activity => {
                    const timesByCategory = activity.availability?.timesByCategory || {};
                    return timesByCategory[slot]?.length > 0;
                });
                // Try to schedule an activity in this slot
                for (const activity of slotActivities) {
                    const availableTimes = activity.availability?.timesByCategory?.[slot] || [];
                    for (const time of availableTimes) {
                        if (!hasTimeConflict(time, activity.duration, dateStr)) {
                            const scheduled = scheduleActivity(activity, time, dateStr, dayNumber);
                            scheduledActivities.push(scheduled);
                            dayDuration += activity.duration;
                            break;
                        }
                    }
                    if (scheduledActivities.length >= 5 || dayDuration >= 720)
                        break;
                }
            }
            // Sort activities by start time
            scheduledActivities.sort((a, b) => {
                const timeA = a.startTime?.split(':').map(Number);
                const timeB = b.startTime?.split(':').map(Number);
                if (!timeA || !timeB)
                    return 0;
                return (timeA[0] * 60 + timeA[1]) - (timeB[0] * 60 + timeB[1]);
            });
            // Add day to schedule
            if (scheduledActivities.length > 0) {
                schedule.push({
                    dayNumber,
                    theme: generateDayTheme(scheduledActivities, preferences),
                    mainArea: determineMainArea(scheduledActivities),
                    commentary: generateDayCommentary(scheduledActivities, dayNumber),
                    highlights: generateDayHighlights(scheduledActivities, preferences),
                    activities: scheduledActivities,
                    breaks: generateBreakSchedule(scheduledActivities, preferences),
                    logistics: generateLogistics(scheduledActivities, preferences),
                    availabilityStats: calculateAvailabilityStats(scheduledActivities)
                });
            }
        }
        // Get unscheduled activities
        const remainingActivities = validatedActivities.filter(activity => !schedule.some(day => day.activities.some(scheduledActivity => scheduledActivity.name === activity.name))).sort((a, b) => (b.rating || 0) - (a.rating || 0));
        logger.info(`[Schedule] Optimization complete:`, {
            totalActivities: validatedActivities.length,
            scheduledActivities: schedule.reduce((acc, day) => acc + day.activities.length, 0),
            unscheduledActivities: remainingActivities.length,
            daysOptimized: days
        });
        return {
            schedule,
            dailyHighlights: schedule.map(day => ({
                dayNumber: day.dayNumber,
                theme: day.theme,
                highlights: day.highlights
            })),
            tripOverview: generateTripOverview(schedule, destination)
        };
    }
    catch (error) {
        logger.error('[Schedule] Error during schedule optimization:', error);
        throw error;
    }
}
function determineTimeSlotByIndex(index) {
    switch (index) {
        case 0: return 'morning';
        case 1: return 'afternoon';
        case 2: return 'evening';
        default: return 'morning';
    }
}
function determineStartTime(timeSlot, activity) {
    if (!activity.availability?.realTimeVerification?.exactStartTimes) {
        return null;
    }
    const timesByCategory = activity.availability.timesByCategory || {};
    const slotTimes = timesByCategory[timeSlot] || [];
    if (slotTimes.length === 0) {
        return null;
    }
    return slotTimes[0];
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
function validateTimeSlot(activity) {
    if (!activity.availability?.timesByCategory) {
        return false;
    }
    const { timeSlot, duration } = activity;
    const availableTimes = activity.availability.timesByCategory[timeSlot] || [];
    if (availableTimes.length === 0) {
        return false;
    }
    // Check if duration is appropriate for the time slot
    const maxDurations = {
        morning: 240, // 4 hours
        afternoon: 300, // 5 hours
        evening: 240 // 4 hours
    };
    return duration <= maxDurations[timeSlot];
}
function checkOverlap(activity, existingActivities) {
    const sameSlotActivities = existingActivities.filter(a => a.dayNumber === activity.dayNumber && a.timeSlot === activity.timeSlot);
    if (sameSlotActivities.length === 0) {
        return false;
    }
    const activityStart = new Date(`2000-01-01T${activity.startTime}`);
    const activityEnd = new Date(activityStart.getTime() + activity.duration * 60000);
    return sameSlotActivities.some(existing => {
        const existingStart = new Date(`2000-01-01T${existing.startTime}`);
        const existingEnd = new Date(existingStart.getTime() + existing.duration * 60000);
        return ((activityStart >= existingStart && activityStart < existingEnd) ||
            (activityEnd > existingStart && activityEnd <= existingEnd));
    });
}
// Add helper function to determine time slot based on start time
function determineTimeSlot(startTime, duration) {
    const [hours] = startTime.split(':').map(Number);
    const endHour = hours + Math.floor(duration / 60);
    // If activity spans multiple time slots, assign to the slot with the majority of the duration
    if (duration >= 480) { // 8 hours or more
        return 'morning'; // Full day activities are marked as morning
    }
    else if (hours >= 17 || (hours < 6 && endHour > 17)) {
        return 'evening';
    }
    else if (hours >= 12 || (hours < 12 && endHour > 12)) {
        return 'afternoon';
    }
    else {
        return 'morning';
    }
}
// Add helper function to find best start time
function findBestStartTime(availableTimes, timeSlot, duration) {
    if (!availableTimes || availableTimes.length === 0) {
        return null;
    }
    logger.info('[Schedule] Finding best start time:', {
        availableTimes,
        timeSlot,
        duration
    });
    // Convert times to minutes since midnight for easier comparison
    const times = availableTimes.map(time => {
        const [hours, minutes] = time.split(':').map(Number);
        return {
            originalTime: time,
            minutes: hours * 60 + minutes
        };
    });
    // Define time slot boundaries in minutes
    const boundaries = {
        morning: { start: 6 * 60, end: 12 * 60 }, // 6:00 - 12:00
        afternoon: { start: 12 * 60, end: 17 * 60 }, // 12:00 - 17:00
        evening: { start: 17 * 60, end: 23 * 60 } // 17:00 - 23:00
    };
    // Filter times that fit within the activity duration and preferred time slot
    const validTimes = times.filter(time => {
        const endMinutes = time.minutes + duration;
        // Check if activity fits within operating hours (6:00 - 23:00)
        if (time.minutes < 6 * 60 || endMinutes > 23 * 60) {
            return false;
        }
        // Check if activity fits within its time slot
        const slot = boundaries[timeSlot];
        if (slot) {
            // For strict time slot adherence, both start and end should be within the slot
            // return time.minutes >= slot.start && endMinutes <= slot.end;
            // For flexible time slot adherence, just the start time should be within the slot
            return time.minutes >= slot.start && time.minutes < slot.end;
        }
        return true;
    });
    if (validTimes.length === 0) {
        logger.warn('[Schedule] No valid times found within constraints:', {
            timeSlot,
            duration
        });
        return null;
    }
    // Sort by time and return the earliest valid time
    validTimes.sort((a, b) => a.minutes - b.minutes);
    logger.info('[Schedule] Selected best start time:', {
        selectedTime: validTimes[0].originalTime,
        validOptions: validTimes.map(t => t.originalTime)
    });
    return validTimes[0].originalTime;
}
async function enrichActivity(activity, destination) {
    logger.info(`[Activity] Starting enrichment for "${activity.name}"`, {
        existingStartTime: activity.startTime,
        timeSlot: activity.timeSlot,
        duration: activity.duration
    });
    try {
        const availabilitySchedule = await viatorService.getAvailabilitySchedule(activity.bookingDetails?.productCode || '');
        const realTimeCheck = await checkRealTimeAvailability(activity, destination);
        const exactStartTimes = realTimeCheck?.schedule?.availableTimeSlots || [];
        const timesByCategory = categorizeTimeSlots(exactStartTimes);
        logger.info(`[Activity] Available times for "${activity.name}":`, {
            exactStartTimes,
            timesByCategory,
            existingStartTime: activity.startTime
        });
        // Find best start time with null safety
        const timeSlot = activity.timeSlot || 'morning';
        let startTime;
        let selectionReason;
        // Step 1: Check if existing start time is valid
        if (activity.startTime && exactStartTimes.includes(activity.startTime)) {
            startTime = activity.startTime;
            selectionReason = 'Using existing valid start time';
            logger.info(`[Activity] Using existing start time for "${activity.name}":`, {
                startTime,
                timeSlot: activity.timeSlot
            });
        }
        // Step 2: Try to find best time from available times in the preferred slot
        else if (timesByCategory[timeSlot]?.length > 0) {
            startTime = findBestStartTime(timesByCategory[timeSlot], timeSlot, activity.duration);
            selectionReason = 'Found best time in preferred slot';
            logger.info(`[Activity] Found best time in preferred slot for "${activity.name}":`, {
                startTime,
                timeSlot,
                availableTimes: timesByCategory[timeSlot]
            });
        }
        // Step 3: Try alternative slots if preferred slot has no times
        else if (exactStartTimes.length > 0) {
            startTime = findBestStartTime(exactStartTimes, timeSlot, activity.duration);
            selectionReason = 'Found best time in alternative slot';
            logger.info(`[Activity] Found best time in alternative slot for "${activity.name}":`, {
                startTime,
                availableTimes: exactStartTimes
            });
        }
        // Step 4: No valid times found
        else {
            logger.warn(`[Activity] No available times found for "${activity.name}"`);
            selectionReason = 'No available times found';
        }
        // If no valid start time was found, don't set a default
        if (!startTime) {
            logger.warn(`[Activity] Could not determine valid start time for "${activity.name}"`);
        }
        return {
            ...activity,
            startTime,
            availability: {
                isAvailable: exactStartTimes.length > 0,
                availableTimeSlots: exactStartTimes,
                timesByCategory,
                realTimeVerification: {
                    verified: true,
                    exactStartTimes,
                    lastChecked: new Date().toISOString(),
                    reason: selectionReason
                },
                tripPeriodAvailability: {
                    availableDates: availabilitySchedule.extractedDaysOfWeek || [],
                    availabilityByDate: { [activity.dayNumber]: exactStartTimes },
                    operatingDays: availabilitySchedule.extractedDaysOfWeek || [],
                    operatingHours: availabilitySchedule.extractedOperatingHours || {}
                }
            }
        };
    }
    catch (error) {
        logger.error('[Activity] Enrichment failed:', {
            name: activity.name,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        return activity;
    }
}
// Add helper function to calculate match score between Viator activity and original activity
function calculateMatchScore(viatorActivity, originalActivity) {
    let score = 0;
    // Name similarity
    const viatorName = viatorActivity.title?.toLowerCase() || '';
    const originalName = originalActivity.name.toLowerCase();
    if (viatorName.includes(originalName) || originalName.includes(viatorName)) {
        score += 2;
    }
    // Category match
    const viatorCategory = viatorActivity.categories?.[0]?.toLowerCase() || '';
    const originalCategory = originalActivity.category.toLowerCase();
    if (viatorCategory === originalCategory) {
        score += 1;
    }
    // Duration match
    const viatorDuration = viatorActivity.duration || 0;
    const originalDuration = originalActivity.duration;
    if (Math.abs(viatorDuration - originalDuration) <= 30) { // Within 30 minutes
        score += 1;
    }
    return score;
}
// Add helper function to determine category
function determineCategory(viatorActivity, originalCategory) {
    // Try to use Viator category if available
    if (viatorActivity.categories?.[0]) {
        return viatorActivity.categories[0];
    }
    // Fallback to original category
    return originalCategory;
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
// Update route handler
activitiesRouter.post('/generate', async (req, res) => {
    try {
        const { departureLocation, destinations, startDate, endDate, travelers, currency, budgetLimit, preferences } = req.body;
        // Validate required parameters
        if (!destinations || !destinations.length || !destinations[0].code) {
            return res.status(400).json({
                error: 'Missing required parameters',
                details: {
                    destinations: !destinations ? 'Missing destinations' : 'Invalid destination format'
                }
            });
        }
        // Use cityName from the transformed request
        const cityName = destinations[0].cityName || destinations[0].label.split(',')[0].trim();
        // Generate activities with clean city name
        const perplexityService = new PerplexityService();
        const result = await perplexityService.generateActivities({
            departureLocation,
            destinations: [{
                    ...destinations[0],
                    label: cityName // Use clean city name for activities
                }],
            startDate,
            endDate,
            travelers,
            currency,
            budgetLimit,
            preferences
        });
        // Enrich activities with clean city name
        const enrichedActivities = await Promise.all(result.activities.map((activity) => enrichActivity(activity, cityName)));
        // Optimize schedule with clean city name
        const days = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
        const optimizedSchedule = await optimizeSchedule(enrichedActivities, days, cityName, preferences, startDate);
        // Log with clean city name and full label for reference
        logOptimizedSchedule(optimizedSchedule.schedule, cityName, days, startDate);
        return res.json({
            success: true,
            data: {
                activities: enrichedActivities,
                schedule: optimizedSchedule.schedule,
                dailyHighlights: optimizedSchedule.dailyHighlights,
                tripOverview: optimizedSchedule.tripOverview,
                destination: {
                    cityName: cityName,
                    fullLabel: destinations[0].label
                }
            }
        });
    }
    catch (error) {
        logger.error('[Activities] Generation failed:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        return res.status(500).json({
            success: false,
            error: 'Failed to generate activities',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
// Update availability check endpoint
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
// Add missing checkRealTimeAvailability function
async function checkRealTimeAvailability(activity, destination) {
    try {
        const schedule = await viatorService.getAvailabilitySchedule(activity.bookingDetails?.productCode || '');
        return {
            schedule: {
                availableTimeSlots: schedule.extractedTimeSlots || []
            }
        };
    }
    catch (error) {
        logger.error('[Activity] Error checking real-time availability:', {
            name: activity.name,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        return null;
    }
}
// Update time slot filtering with proper types
function categorizeTimeSlots(times) {
    return {
        morning: times.filter((time) => {
            const hour = parseInt(time.split(':')[0]);
            return hour >= 6 && hour < 12;
        }),
        afternoon: times.filter((time) => {
            const hour = parseInt(time.split(':')[0]);
            return hour >= 12 && hour < 17;
        }),
        evening: times.filter((time) => {
            const hour = parseInt(time.split(':')[0]);
            return hour >= 17;
        })
    };
}
export { activitiesRouter };
