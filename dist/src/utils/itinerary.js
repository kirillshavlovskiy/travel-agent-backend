/**
 * Enhances daily plans with accessibility information and special considerations
 */
export function enhanceDailyPlansWithPreferences(dailyPlans, preferences) {
    if (!dailyPlans || !dailyPlans.length || !preferences) {
        return dailyPlans;
    }
    return dailyPlans.map(plan => {
        // Clone the plan to avoid modifying the original
        const enhancedPlan = { ...plan };
        // Initialize logistics if it doesn't exist
        enhancedPlan.logistics = enhancedPlan.logistics || {};
        enhancedPlan.logistics.accessibilityNotes = enhancedPlan.logistics.accessibilityNotes || [];
        // Add accessibility notes based on specified requirements
        if (preferences.accessibility?.length) {
            // General accessibility notes for all types
            enhancedPlan.logistics.accessibilityNotes.push("Request assistance or special accommodations at venues when needed");
            enhancedPlan.logistics.accessibilityNotes.push("Rest areas are available at all venues");
            // Add mobility-related notes
            if (preferences.accessibility.includes('wheelchair_accessible') ||
                preferences.accessibility.includes('limited_mobility')) {
                // Add specialized transportation suggestions
                enhancedPlan.logistics.transportSuggestions = enhancedPlan.logistics.transportSuggestions || [];
                enhancedPlan.logistics.transportSuggestions.push("Use accessible metro stations marked with wheelchair symbols");
                enhancedPlan.logistics.transportSuggestions.push("Consider pre-booking wheelchair accessible taxis");
                enhancedPlan.logistics.transportSuggestions.push("Paris Bus routes 24, 73, and 85 are fully accessible");
                enhancedPlan.logistics.transportSuggestions.push("Plan shorter walking routes between activities");
                enhancedPlan.logistics.transportSuggestions.push("Allow extra time for transportation between venues");
                // Add wheelchair-specific notes
                enhancedPlan.logistics.accessibilityNotes.push("All recommended activities have wheelchair access");
                enhancedPlan.logistics.accessibilityNotes.push("Request accessibility maps at museum entrances");
                enhancedPlan.logistics.accessibilityNotes.push("Use accessible entrances (often marked separately)");
                enhancedPlan.logistics.accessibilityNotes.push("Consider renting mobility equipment if needed");
                enhancedPlan.logistics.accessibilityNotes.push("Elevator access available at all multi-level venues");
            }
            // Add elderly-friendly notes
            if (preferences.accessibility.includes('elderly_friendly')) {
                enhancedPlan.logistics.transportSuggestions = enhancedPlan.logistics.transportSuggestions || [];
                enhancedPlan.logistics.transportSuggestions.push("Use taxis for longer distances to minimize walking");
                enhancedPlan.logistics.transportSuggestions.push("Allow extra time for gentle walking pace");
                enhancedPlan.logistics.accessibilityNotes.push("Benches and seating areas are available at most venues");
                enhancedPlan.logistics.accessibilityNotes.push("Ask for senior rates/discounts at attractions");
                enhancedPlan.logistics.accessibilityNotes.push("Venues have prioritized entry for elderly visitors");
                enhancedPlan.logistics.accessibilityNotes.push("Consider touring in mornings when venues are less crowded");
            }
            // Add hearing impaired notes
            if (preferences.accessibility.includes('hearing_impaired')) {
                enhancedPlan.logistics.accessibilityNotes.push("Many museums offer written guides for exhibits");
                enhancedPlan.logistics.accessibilityNotes.push("Request assistive listening devices at major attractions");
                enhancedPlan.logistics.accessibilityNotes.push("Advance notice for sign language interpretation is recommended");
                enhancedPlan.logistics.accessibilityNotes.push("Visual alarm systems are available at most accommodations");
            }
            // Add visually impaired notes
            if (preferences.accessibility.includes('visually_impaired')) {
                enhancedPlan.logistics.accessibilityNotes.push("Many museums offer tactile exhibits and Braille information");
                enhancedPlan.logistics.accessibilityNotes.push("Guide dogs are permitted at all attractions");
                enhancedPlan.logistics.accessibilityNotes.push("Audio description services available at major museums");
                enhancedPlan.logistics.accessibilityNotes.push("Request assistance for navigating between exhibits");
            }
        }
        // Add dietary restriction information to meal breaks
        if (preferences.dietaryRestrictions?.length) {
            enhancedPlan.breaks = enhancedPlan.breaks || {};
            // General dining notes based on dietary restrictions
            const dietaryNotes = [];
            if (preferences.dietaryRestrictions.includes('vegetarian')) {
                dietaryNotes.push("Vegetarian options available at most Paris restaurants");
                dietaryNotes.push("Look for 'Menu Végétarien' on restaurant menus");
            }
            if (preferences.dietaryRestrictions.includes('vegan')) {
                dietaryNotes.push("Vegan restaurants recommended: Le Potager du Marais, Hank Burger");
                dietaryNotes.push("Request 'végétalien' meals when ordering");
            }
            if (preferences.dietaryRestrictions.includes('gluten_free')) {
                dietaryNotes.push("Look for 'sans gluten' on menus for gluten-free options");
                dietaryNotes.push("Recommended: Noglu, Chambelland, Helmut Newcake for gluten-free dining");
            }
            if (preferences.dietaryRestrictions.includes('dairy_free')) {
                dietaryNotes.push("Request 'sans produits laitiers' for dairy-free meals");
                dietaryNotes.push("Many cafes now offer plant-based milk alternatives");
            }
            if (preferences.dietaryRestrictions.includes('kosher')) {
                dietaryNotes.push("Kosher restaurants in the Marais district: L'As du Fallafel, Miznon");
                dietaryNotes.push("Look for 'certification casher' for verified kosher meals");
            }
            if (preferences.dietaryRestrictions.includes('halal')) {
                dietaryNotes.push("Halal options widely available in central Paris");
                dietaryNotes.push("Recommended areas: Rue de la Huchette, Boulevard de Belleville");
            }
            // Add dietary notes to all meal breaks
            if (enhancedPlan.breaks.lunch) {
                enhancedPlan.breaks.lunch.dietaryNotes = dietaryNotes;
            }
            if (enhancedPlan.breaks.dinner) {
                enhancedPlan.breaks.dinner.dietaryNotes = dietaryNotes;
            }
            // Add general dietary information to the plan
            enhancedPlan.dietaryNotes = dietaryNotes;
        }
        // Adjust for pace preference
        if (preferences.pacePreference) {
            enhancedPlan.logistics.timeEstimates = enhancedPlan.logistics.timeEstimates || [];
            if (preferences.pacePreference === 'relaxed') {
                enhancedPlan.logistics.timeEstimates.push("Schedule includes extra buffer time between activities");
                enhancedPlan.logistics.timeEstimates.push("Plan for leisurely meal breaks (90+ minutes)");
            }
            else if (preferences.pacePreference === 'moderate') {
                enhancedPlan.logistics.timeEstimates.push("Balanced schedule with reasonable transition times");
                enhancedPlan.logistics.timeEstimates.push("Standard meal breaks (60-75 minutes)");
            }
            else if (preferences.pacePreference === 'fast') {
                enhancedPlan.logistics.timeEstimates.push("Efficient transitions between venues (15-20 minutes)");
                enhancedPlan.logistics.timeEstimates.push("Brief meal breaks to maximize sightseeing time");
            }
        }
        return enhancedPlan;
    });
}
/**
 * Generate transportation suggestions based on accessibility needs
 */
function generateAccessibilityTransportation(accessibility) {
    const suggestions = [];
    if (accessibility.includes('wheelchair_accessible')) {
        suggestions.push('Use accessible metro stations marked with wheelchair symbols', 'Consider pre-booking wheelchair accessible taxis', 'Paris Bus routes 24, 73, and 85 are fully accessible');
    }
    if (accessibility.includes('limited_mobility')) {
        suggestions.push('Plan shorter walking routes between activities', 'Allow extra time for transportation between venues', 'Consider Paris City Pass for priority access at attractions');
    }
    return suggestions;
}
/**
 * Generate accessibility notes for a day's activities
 */
function generateAccessibilityNotes(accessibility, activities) {
    const notes = [];
    if (accessibility.includes('wheelchair_accessible')) {
        notes.push('All recommended activities have wheelchair access', 'Request accessibility maps at museum entrances', 'Use accessible entrances (often marked separately)');
    }
    if (accessibility.includes('limited_mobility')) {
        notes.push('Rest areas are available at all venues', 'Consider renting mobility equipment if needed', 'Elevator access available at all multi-level venues');
    }
    // Add activity-specific notes
    activities.forEach(activity => {
        if (activity.bookingDetails?.accessibility) {
            notes.push(`${activity.name}: ${activity.bookingDetails.accessibility}`);
        }
    });
    return notes;
}
/**
 * Enhance dining break suggestions with dietary information
 */
function enhanceDiningBreakSuggestion(suggestion, dietaryRestrictions) {
    if (!suggestion) {
        return `Meal break at restaurant accommodating ${dietaryRestrictions.join(', ')} diets`;
    }
    const dietaryText = dietaryRestrictions.length === 1
        ? dietaryRestrictions[0]
        : `${dietaryRestrictions.slice(0, -1).join(', ')} and ${dietaryRestrictions.slice(-1)}`;
    return suggestion.replace(/at (recommended |local )?restaurant/i, `at ${dietaryRestrictions.length === 1 ? dietaryText + '-friendly' : 'accommodating'} restaurant with ${dietaryText} options`);
}
/**
 * Generate dietary notes based on restrictions
 */
function generateDietaryNotes(dietaryRestrictions, activities) {
    const notes = [];
    const restrictionsText = dietaryRestrictions.join(' and ');
    notes.push(`Paris offers many ${restrictionsText} dining options`, `Look for "Menu ${restrictionsText.charAt(0).toUpperCase() + restrictionsText.slice(1)}" signs at restaurants`, 'Inform servers about dietary needs when ordering');
    // Check for food-related activities
    const foodActivities = activities.filter(activity => activity.category === 'Food & Wine' ||
        activity.category === 'Food & Dining' ||
        activity.name.toLowerCase().includes('food') ||
        activity.name.toLowerCase().includes('dinner') ||
        activity.name.toLowerCase().includes('lunch') ||
        activity.name.toLowerCase().includes('taste') ||
        activity.name.toLowerCase().includes('cuisine'));
    if (foodActivities.length > 0) {
        notes.push(`Notify the guide about ${restrictionsText} requirements before food activities`, 'Consider contacting food tour operators in advance to confirm accommodations');
    }
    return notes;
}
/**
 * Adjust break durations based on pace preference
 */
function adjustBreakDurations(breaks, pacePreference) {
    const adjustedBreaks = { ...breaks };
    // Define break duration multipliers based on pace
    const durationMultiplier = {
        relaxed: 1.5, // Longer breaks for relaxed pace
        moderate: 1.0, // Standard breaks for moderate pace
        intense: 0.75 // Shorter breaks for intense pace
    }[pacePreference] || 1.0;
    // Apply duration adjustments
    Object.keys(adjustedBreaks).forEach(breakTime => {
        if (adjustedBreaks[breakTime].duration) {
            const originalDuration = adjustedBreaks[breakTime].duration;
            const newDuration = Math.round(originalDuration * durationMultiplier);
            adjustedBreaks[breakTime].duration = newDuration;
            // Adjust end time based on new duration
            if (adjustedBreaks[breakTime].startTime && adjustedBreaks[breakTime].endTime) {
                const [startHour, startMinute] = adjustedBreaks[breakTime].startTime.split(':').map(Number);
                const startMinutes = startHour * 60 + startMinute;
                const endMinutes = startMinutes + newDuration;
                const endHour = Math.floor(endMinutes / 60);
                const endMinute = endMinutes % 60;
                adjustedBreaks[breakTime].endTime =
                    `${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`;
            }
        }
    });
    return adjustedBreaks;
}
