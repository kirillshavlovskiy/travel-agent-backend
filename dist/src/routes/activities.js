import { Router } from 'express';
import { perplexityClient } from '../services/perplexity.js';
const router = Router();
router.post('/generate', async (req, res) => {
    try {
        const { destination, days, budget, currency, flightTimes } = req.body;
        if (!destination || !budget || !currency) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }
        const query = `Generate a ${days}-day activity plan for ${destination} with a total budget of ${budget} ${currency}. 
For each day, suggest multiple activities across different price ranges:
- Budget activities (under $30 per person): 2-3 options per time slot
- Medium-priced activities ($30-$100 per person): 2-3 options per time slot
- Premium/exclusive activities (over $100 per person): 2-3 options per time slot

Requirements:
1. Each day should have multiple activities from each price tier (budget, medium, premium)
2. Activities should be distributed across time slots (morning, afternoon, evening)
3. Include a diverse range of categories (cultural, adventure, entertainment, etc.)
4. Premium activities should be truly exclusive experiences
5. Consider local specialties and unique experiences
6. Respect arrival time ${flightTimes?.arrival || 'flexible'} and departure time ${flightTimes?.departure || 'flexible'}

For each activity include:
- Name
- Description
- Price per person in ${currency}
- Duration in hours
- Location
- Rating (1-5)
- Category
- Preferred time of day (morning/afternoon/evening)
- Reference URL (direct booking link or official website)

Format as a JSON object with an activities array. Each activity should include a referenceUrl field with a direct booking link or official website URL.`;
        const response = await perplexityClient.chat(query);
        if (!response.choices?.[0]?.message?.content) {
            throw new Error('Invalid response format from Perplexity API');
        }
        const content = response.choices[0].message.content;
        // Log the raw content for debugging
        console.log('[Activities API] Raw content from Perplexity:', content);
        // Try to parse the entire content first
        let parsedData;
        try {
            parsedData = JSON.parse(content);
        }
        catch (e) {
            // If that fails, try to extract JSON using regex as fallback
            console.log('[Activities API] Failed to parse full content, attempting to extract JSON');
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.error('[Activities API] Failed to extract JSON from response:', content);
                throw new Error('No valid JSON object found in response');
            }
            const extractedJson = jsonMatch[0];
            console.log('[Activities API] Extracted JSON:', extractedJson);
            try {
                parsedData = JSON.parse(extractedJson);
            }
            catch (e) {
                console.error('[Activities API] Failed to parse extracted JSON:', {
                    error: e instanceof Error ? e.message : 'Unknown error',
                    position: e instanceof SyntaxError ? e.message.match(/position (\d+)/)?.[1] : 'unknown',
                    extractedJson
                });
                throw new Error('Invalid JSON format in response');
            }
        }
        if (!parsedData.activities || !Array.isArray(parsedData.activities)) {
            console.error('[Activities API] Invalid data structure:', parsedData);
            throw new Error('Invalid response format: missing or invalid activities array');
        }
        // Validate each activity
        const validActivities = parsedData.activities.filter((activity) => {
            const isValid = (typeof activity.name === 'string' &&
                typeof activity.description === 'string' &&
                typeof activity.duration === 'number' &&
                typeof activity.price === 'number' &&
                typeof activity.category === 'string' &&
                typeof activity.location === 'string' &&
                typeof activity.rating === 'number' &&
                typeof activity.timeOfDay === 'string' &&
                typeof activity.referenceUrl === 'string');
            if (!isValid) {
                console.warn('[Activities API] Invalid activity:', activity);
            }
            return isValid;
        });
        if (validActivities.length === 0) {
            console.error('[Activities API] No valid activities found');
            throw new Error('No valid activities found in response');
        }
        // Transform activities
        const transformedActivities = validActivities.map((activity, index) => {
            // Determine time slot with a default value
            let timeSlot = 'morning'; // Default to morning
            if (activity.timeOfDay?.toLowerCase() === 'afternoon') {
                timeSlot = 'afternoon';
            }
            else if (activity.timeOfDay?.toLowerCase() === 'evening') {
                timeSlot = 'evening';
            }
            return {
                id: `activity_${index + 1}`,
                name: activity.name,
                description: activity.description,
                duration: activity.duration,
                price: {
                    amount: activity.price,
                    currency
                },
                location: activity.location,
                rating: activity.rating,
                category: activity.category,
                tier: activity.price <= 30 ? 'budget' : activity.price <= 100 ? 'medium' : 'premium',
                timeSlot, // Use the determined time slot
                dayNumber: 1,
                startTime: timeSlot === 'morning' ? '09:00' :
                    timeSlot === 'afternoon' ? '14:00' : '19:00',
                referenceUrl: activity.referenceUrl || activity.url || ''
            };
        });
        // Group activities by tier and time slot
        const activitiesByDay = new Map();
        let currentDay = 1;
        const activitiesPerDay = Math.ceil(transformedActivities.length / days);
        transformedActivities.forEach((activity) => {
            activity.dayNumber = currentDay;
            if (!activitiesByDay.has(currentDay)) {
                activitiesByDay.set(currentDay, {
                    budget: { morning: [], afternoon: [], evening: [] },
                    medium: { morning: [], afternoon: [], evening: [] },
                    premium: { morning: [], afternoon: [], evening: [] }
                });
            }
            const dayActivities = activitiesByDay.get(currentDay);
            if (dayActivities && dayActivities[activity.tier] && dayActivities[activity.tier][activity.timeSlot]) {
                dayActivities[activity.tier][activity.timeSlot].push(activity);
            }
            else {
                console.warn('[Activities API] Invalid activity tier or time slot:', {
                    tier: activity.tier,
                    timeSlot: activity.timeSlot,
                    activityId: activity.id
                });
            }
            const totalActivities = Object.values(dayActivities).flatMap((tier) => Object.values(tier).flatMap(slot => slot)).length;
            if (totalActivities >= activitiesPerDay) {
                currentDay++;
            }
        });
        // Create suggested itineraries
        const suggestedItineraries = {
            budget: [],
            medium: [],
            premium: []
        };
        activitiesByDay.forEach((activities, day) => {
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
        res.json({
            activities: transformedActivities,
            suggestedItineraries
        });
    }
    catch (error) {
        console.error('[Activities API] Error:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to generate activities',
            timestamp: new Date().toISOString()
        });
    }
});
export default router;
//# sourceMappingURL=activities.js.map