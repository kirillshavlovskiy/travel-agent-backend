"use strict";
async function enrichViatorActivity(viatorActivity, timeSlot, dayNumber, preferences) {
    // Remove default time slot mapping
    console.log('[Enrichment] Processing activity:', {
        name: viatorActivity.name,
        originalCategory: viatorActivity.category,
        enrichedCategory: viatorActivity.category || 'Uncategorized',
        timeSlot,
        dayNumber
    });
    return {
        id: `${dayNumber}-${timeSlot}-${viatorActivity.id || Date.now()}`,
        name: viatorActivity.name || 'Unnamed Activity',
        description: viatorActivity.description || '',
        location: viatorActivity.location || viatorActivity.zone || 'London',
        price: {
            amount: Number(viatorActivity.price?.original?.recommendedRetailPrice || 0),
            currency: viatorActivity.price?.currency || 'USD'
        },
        duration: typeof viatorActivity.duration === 'number' ?
            viatorActivity.duration.toString() :
            '2',
        timeSlot: timeSlot,
        dayNumber,
        tier: calculateTier(viatorActivity.price?.original?.recommendedRetailPrice),
        category: viatorActivity.category || 'Uncategorized',
        rating: Number(viatorActivity.rating || 0),
        numberOfReviews: Number(viatorActivity.numberOfReviews || 0),
        images: Array.isArray(viatorActivity.images) ? viatorActivity.images : [],
        referenceUrl: viatorActivity.referenceUrl || '',
        isVerified: false,
        verificationStatus: 'pending',
        suggestedOption: true,
        // Add scoring details for transparency
        scoringDetails: {
            matchedPreferences: preferences.interests.filter(interest => viatorActivity.category?.toLowerCase().includes(interest.toLowerCase())),
            travelStyleMatch: preferences.travelStyle === 'active' ?
                ['Nature & Adventure', 'Sports & Extremes'].includes(viatorActivity.category || '') :
                ['Cultural & Historical', 'Food & Drink'].includes(viatorActivity.category || '')
        },
        // Optional fields with defaults
        contactInfo: {
            address: viatorActivity.address || '',
            phone: viatorActivity.phone || '',
            website: viatorActivity.referenceUrl || ''
        },
        meetingPoint: viatorActivity.meetingPoint ? {
            name: viatorActivity.meetingPoint.name || '',
            address: viatorActivity.meetingPoint.address || ''
        } : undefined,
        openingHours: viatorActivity.openingHours || '',
        keyHighlights: Array.isArray(viatorActivity.highlights) ? viatorActivity.highlights : []
    };
}
