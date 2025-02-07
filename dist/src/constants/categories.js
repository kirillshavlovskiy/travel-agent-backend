export const ACTIVITY_CATEGORIES = [
    {
        name: 'Cultural & Historical',
        keywords: ['museum', 'gallery', 'history', 'art', 'palace', 'cathedral', 'church', 'monument', 'heritage'],
        preferredTimeOfDay: 'morning',
        typicalDuration: 120
    },
    {
        name: 'Nature & Adventure',
        keywords: ['hiking', 'walking', 'beach', 'mountain', 'nature', 'park', 'garden', 'bike tour', 'cycling', 'kayak', 'adventure', 'sport', 'diving', 'climbing', 'rafting', 'zip line', 'bungee'],
        preferredTimeOfDay: 'morning',
        typicalDuration: 240
    },
    {
        name: 'Cruises & Sailing',
        keywords: ['cruise', 'boat', 'sailing', 'river', 'yacht', 'dinner cruise', 'lunch cruise', 'night cruise', 'canal'],
        preferredTimeOfDay: 'afternoon',
        typicalDuration: 180
    },
    {
        name: 'Food & Dining',
        keywords: ['food', 'dinner', 'lunch', 'culinary', 'restaurant', 'cooking class', 'wine tasting', 'tapas', 'gourmet'],
        preferredTimeOfDay: 'evening',
        typicalDuration: 150
    },
    {
        name: 'Entertainment',
        keywords: ['show', 'concert', 'theater', 'performance', 'dance', 'musical', 'cabaret', 'circus', 'disney'],
        preferredTimeOfDay: 'evening',
        typicalDuration: 120
    },
    {
        name: 'Shopping',
        keywords: ['shopping', 'market', 'boutique', 'mall', 'store', 'shop', 'outlet', 'bazaar'],
        preferredTimeOfDay: 'afternoon',
        typicalDuration: 120
    },
    {
        name: 'Tickets & Passes',
        keywords: ['ticket', 'pass', 'admission', 'entry', 'skip-the-line', 'fast track', 'priority access'],
        preferredTimeOfDay: 'morning',
        typicalDuration: 120
    }
];
// Category mapping for normalization
export const CATEGORY_MAP = {
    'cultural': 'Cultural & Historical',
    'cultural & historical': 'Cultural & Historical',
    'outdoor': 'Nature & Adventure',
    'nature & adventure': 'Nature & Adventure',
    'adventure & sports': 'Nature & Adventure',
    'outdoor activities': 'Nature & Adventure',
    'cruises': 'Cruises & Sailing',
    'cruises & sailing': 'Cruises & Sailing',
    'sailing': 'Cruises & Sailing',
    'food': 'Food & Dining',
    'food & drink': 'Food & Dining',
    'food & dining': 'Food & Dining',
    'dining': 'Food & Dining',
    'entertainment': 'Entertainment',
    'shows': 'Entertainment',
    'shows & entertainment': 'Entertainment',
    'shopping': 'Shopping',
    'tickets': 'Tickets & Passes',
    'tickets & passes': 'Tickets & Passes',
    'passes': 'Tickets & Passes'
};
// Helper function to normalize category names
export function normalizeCategory(category) {
    const normalized = category.toLowerCase().trim();
    return CATEGORY_MAP[normalized] || 'Cultural & Historical'; // Default to Cultural & Historical if no match
}
// Helper function to get preferred time slot for a category
export function getPreferredTimeSlot(category) {
    const categoryInfo = ACTIVITY_CATEGORIES.find(c => c.name === normalizeCategory(category));
    return categoryInfo?.preferredTimeOfDay || 'morning';
}
// Helper function to get typical duration for a category
export function getTypicalDuration(category) {
    const categoryInfo = ACTIVITY_CATEGORIES.find(c => c.name === normalizeCategory(category));
    return categoryInfo?.typicalDuration || 120;
}
// Helper function to determine category based on keywords
export function determineCategoryFromDescription(description) {
    const normalizedDesc = description.toLowerCase();
    for (const category of ACTIVITY_CATEGORIES) {
        if (category.keywords.some(keyword => normalizedDesc.includes(keyword.toLowerCase()))) {
            return category.name;
        }
    }
    return 'Cultural & Historical'; // Default category
}
