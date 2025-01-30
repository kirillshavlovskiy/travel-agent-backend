import axios from 'axios';
import { logger } from '../utils/logger';
const ACTIVITY_CATEGORIES = [
    {
        name: 'Cultural & Historical',
        keywords: ['museum', 'gallery', 'history', 'art', 'palace', 'cathedral', 'church', 'monument', 'heritage'],
        preferredTimeOfDay: 'morning',
        typicalDuration: 120
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
        name: 'Shows & Entertainment',
        keywords: ['show', 'concert', 'theater', 'performance', 'dance', 'musical', 'cabaret', 'circus', 'disney'],
        preferredTimeOfDay: 'evening',
        typicalDuration: 120
    },
    {
        name: 'Outdoor Activities',
        keywords: ['hiking', 'walking', 'beach', 'mountain', 'nature', 'park', 'garden', 'bike tour', 'cycling'],
        preferredTimeOfDay: 'morning',
        typicalDuration: 240
    },
    {
        name: 'Adventure & Sports',
        keywords: ['kayak', 'adventure', 'sport', 'diving', 'climbing', 'rafting', 'zip line', 'bungee'],
        preferredTimeOfDay: 'morning',
        typicalDuration: 240
    },
    {
        name: 'Tickets & Passes',
        keywords: ['ticket', 'pass', 'admission', 'entry', 'skip-the-line', 'fast track', 'priority access'],
        preferredTimeOfDay: 'morning',
        typicalDuration: 120
    },
    {
        name: 'Transportation',
        keywords: ['transfer', 'airport', 'hotel', 'shuttle', 'private driver', 'pickup', 'transport'],
        preferredTimeOfDay: 'morning',
        typicalDuration: 60
    }
];
export class ViatorService {
    constructor(apiKey) {
        this.baseUrl = 'https://api.viator.com/partner';
        this.apiKey = apiKey;
    }
    async getDestinations() {
        try {
            const response = await axios.get(`${this.baseUrl}/destinations`, {
                headers: {
                    'Accept': 'application/json;version=2.0',
                    'Accept-Language': 'en-US',
                    'exp-api-key': this.apiKey
                }
            });
            logger.info('Destinations response:', response.data);
            return response.data.destinations;
        }
        catch (error) {
            logger.error('Error fetching destinations:', error);
            throw error;
        }
    }
    async getDestinationId(cityName) {
        try {
            const destinations = await this.getDestinations();
            const destination = destinations.find((dest) => dest.name.toLowerCase() === cityName.toLowerCase());
            if (!destination) {
                logger.error(`Destination not found: ${cityName}`);
                throw new Error(`Could not find destination ID for ${cityName}`);
            }
            logger.info(`Found destination ID for ${cityName}:`, destination.ref);
            return destination.ref;
        }
        catch (error) {
            logger.error('Error getting destination ID:', error);
            throw error;
        }
    }
    async searchActivity(searchTerm) {
        try {
            const isProductCodeSearch = searchTerm.startsWith('productCode:');
            const productCode = isProductCodeSearch ? searchTerm.split(':')[1] : null;
            if (isProductCodeSearch && productCode) {
                try {
                    const productDetails = await this.getProductDetails(productCode);
                    if (productDetails) {
                        const ratingStr = productDetails.reviews?.combinedAverageRating
                            ? `★ ${productDetails.reviews.combinedAverageRating.toFixed(1)} (${productDetails.reviews.totalReviews} reviews)`
                            : '';
                        return [{
                                name: productDetails.title,
                                description: productDetails.description + (ratingStr ? `\n\n${ratingStr}` : ''),
                                duration: productDetails.duration?.fixedDurationInMinutes,
                                price: {
                                    amount: productDetails.pricing?.summary?.fromPrice,
                                    currency: productDetails.pricing?.currency
                                },
                                rating: productDetails.reviews?.combinedAverageRating,
                                numberOfReviews: productDetails.reviews?.totalReviews,
                                ratingDisplay: ratingStr,
                                images: productDetails.images?.map((img) => {
                                    const variants = img.variants || [];
                                    const preferredVariant = variants.find((v) => v.width === 480 && v.height === 320);
                                    return preferredVariant ? preferredVariant.url : variants[0]?.url;
                                }).filter(Boolean),
                                bookingInfo: {
                                    productCode: productCode,
                                    cancellationPolicy: productDetails.cancellationPolicy?.description || 'Standard cancellation policy',
                                    instantConfirmation: true,
                                    mobileTicket: true,
                                    languages: ['English'],
                                    minParticipants: 1,
                                    maxParticipants: 99
                                },
                                highlights: productDetails.highlights || [],
                                location: productDetails.location?.address || '',
                                category: this.determineCategory({
                                    name: productDetails.title,
                                    description: productDetails.description,
                                    productCode: productCode,
                                    price: {
                                        amount: productDetails.pricing?.summary?.fromPrice,
                                        currency: productDetails.pricing?.currency
                                    }
                                }),
                                referenceUrl: `https://www.viator.com/tours/${productCode}`
                            }];
                    }
                }
                catch (error) {
                    logger.warn('Direct product lookup failed, falling back to search:', error);
                }
            }
            const searchRequest = {
                searchTerm,
                searchTypes: [{
                        searchType: 'PRODUCTS',
                        pagination: {
                            offset: 0,
                            limit: 20
                        }
                    }],
                currency: 'USD',
                productFiltering: {
                    rating: {
                        minimum: 3.5
                    }
                },
                productSorting: {
                    sortBy: 'POPULARITY',
                    sortOrder: 'DESC'
                }
            };
            const response = await axios.post(`${this.baseUrl}/search/freetext`, searchRequest, {
                headers: {
                    'Accept': 'application/json;version=2.0',
                    'Content-Type': 'application/json',
                    'Accept-Language': 'en-US',
                    'exp-api-key': this.apiKey
                }
            });
            if (!response.data.products?.results?.length) {
                logger.warn(`No products found for search term: ${searchTerm}`);
                return null;
            }
            return response.data.products.results.map((product) => {
                const ratingStr = product.reviews?.combinedAverageRating
                    ? `★ ${product.reviews.combinedAverageRating.toFixed(1)} (${product.reviews.totalReviews} reviews)`
                    : '';
                const categoryInfo = {
                    name: product.title,
                    description: product.description,
                    productCode: product.productCode,
                    price: {
                        amount: product.pricing?.summary?.fromPrice,
                        currency: product.pricing?.currency
                    }
                };
                return {
                    name: product.title,
                    description: product.description + (ratingStr ? `\n\n${ratingStr}` : ''),
                    duration: product.duration?.fixedDurationInMinutes,
                    price: {
                        amount: product.pricing?.summary?.fromPrice,
                        currency: product.pricing?.currency
                    },
                    rating: product.reviews?.combinedAverageRating,
                    numberOfReviews: product.reviews?.totalReviews,
                    ratingDisplay: ratingStr,
                    images: product.images?.map((img) => {
                        const variants = img.variants || [];
                        const preferredVariant = variants.find((v) => v.width === 480 && v.height === 320);
                        return preferredVariant ? preferredVariant.url : variants[0]?.url;
                    }).filter(Boolean),
                    bookingInfo: {
                        productCode: product.productCode,
                        cancellationPolicy: product.bookingInfo?.cancellationPolicy || 'Standard cancellation policy',
                        instantConfirmation: true,
                        mobileTicket: true,
                        languages: ['English'],
                        minParticipants: 1,
                        maxParticipants: 99
                    },
                    highlights: product.highlights || [],
                    location: product.location?.address || '',
                    category: this.determineCategory(categoryInfo),
                    referenceUrl: product.productUrl || `https://www.viator.com/tours/${product.productCode}`
                };
            });
        }
        catch (error) {
            logger.error('Error searching activity:', error);
            throw error;
        }
    }
    async performSearch(searchTerm) {
        const searchRequest = {
            searchTerm,
            searchTypes: [{
                    searchType: 'PRODUCTS',
                    pagination: {
                        offset: 0,
                        limit: 20
                    }
                }],
            currency: 'USD',
            productFiltering: {
                rating: {
                    minimum: 3.5
                }
            },
            productSorting: {
                sortBy: 'POPULARITY',
                sortOrder: 'DESC'
            }
        };
        const response = await axios.post(`${this.baseUrl}/search/freetext`, searchRequest, {
            headers: {
                'Accept': 'application/json;version=2.0',
                'Content-Type': 'application/json',
                'Accept-Language': 'en-US',
                'exp-api-key': this.apiKey
            }
        });
        return response.data;
    }
    async getProductDetails(productCode) {
        try {
            const response = await axios.get(`${this.baseUrl}/products/${productCode}`, {
                headers: {
                    'Accept': 'application/json;version=2.0',
                    'Accept-Language': 'en-US',
                    'exp-api-key': this.apiKey
                }
            });
            logger.info('[Viator] Product details response:', response.data);
            return response.data;
        }
        catch (error) {
            logger.error('[Viator] Error fetching product details:', error);
            throw error;
        }
    }
    async enrichActivityDetails(activity) {
        try {
            const productCode = activity.bookingInfo?.productCode || activity.referenceUrl?.match(/\-([a-zA-Z0-9]+)(?:\?|$)/)?.[1];
            logger.debug('[Viator] Enriching activity:', {
                name: activity.name,
                productCode,
                referenceUrl: activity.referenceUrl
            });
            if (!productCode) {
                logger.warn('[Viator] No product code available for activity:', {
                    name: activity.name,
                    referenceUrl: activity.referenceUrl
                });
                throw new Error('No product code available for activity');
            }
            try {
                // Get detailed product information
                const productDetails = await this.getProductDetails(productCode);
                if (productDetails && productDetails.status === 'ACTIVE') {
                    // Get availability schedule for pricing and schedules
                    const availabilitySchedule = await this.getAvailabilitySchedule(productCode);
                    // Extract meeting point and location information
                    const logistics = productDetails.logistics || {};
                    const travelerPickup = logistics.travelerPickup || {};
                    const start = logistics.start?.[0] || {};
                    const end = logistics.end?.[0] || {};
                    const locationInfo = {
                        address: start.location?.address || '',
                        meetingPoints: [],
                        startingLocations: []
                    };
                    // Add start location information
                    if (start.description) {
                        locationInfo.startingLocations.push(start.description);
                    }
                    // Add end location information
                    if (end.description) {
                        locationInfo.startingLocations.push(`End point: ${end.description}`);
                    }
                    // Add pickup locations if available
                    if (travelerPickup.additionalInfo) {
                        locationInfo.meetingPoints.push(travelerPickup.additionalInfo);
                    }
                    // Add specific meeting point from start location
                    if (start.location?.address) {
                        locationInfo.meetingPoints.push(start.location.address);
                        locationInfo.address = start.location.address;
                    }
                    // Extract itinerary information based on type
                    const itinerary = productDetails.itinerary;
                    let structuredItinerary;
                    if (itinerary) {
                        switch (itinerary.itineraryType) {
                            case 'STANDARD':
                                structuredItinerary = {
                                    itineraryType: 'STANDARD',
                                    skipTheLine: itinerary.skipTheLine,
                                    privateTour: itinerary.privateTour,
                                    maxTravelersInSharedTour: itinerary.maxTravelersInSharedTour,
                                    duration: {
                                        fixedDurationInMinutes: itinerary.duration.fixedDurationInMinutes
                                    },
                                    itineraryItems: itinerary.itineraryItems || []
                                };
                                break;
                            case 'ACTIVITY':
                                structuredItinerary = {
                                    itineraryType: 'ACTIVITY',
                                    skipTheLine: itinerary.skipTheLine,
                                    privateTour: itinerary.privateTour,
                                    maxTravelersInSharedTour: itinerary.maxTravelersInSharedTour,
                                    duration: {
                                        fixedDurationInMinutes: itinerary.duration.fixedDurationInMinutes
                                    },
                                    pointsOfInterest: itinerary.pointsOfInterest || [],
                                    activityInfo: itinerary.activityInfo,
                                    foodMenus: itinerary.foodMenus
                                };
                                break;
                            case 'MULTI_DAY_TOUR':
                                structuredItinerary = {
                                    itineraryType: 'MULTI_DAY_TOUR',
                                    skipTheLine: itinerary.skipTheLine,
                                    privateTour: itinerary.privateTour,
                                    maxTravelersInSharedTour: itinerary.maxTravelersInSharedTour,
                                    duration: {
                                        fixedDurationInMinutes: itinerary.duration.fixedDurationInMinutes
                                    },
                                    days: itinerary.days || []
                                };
                                break;
                            case 'HOP_ON_HOP_OFF':
                                structuredItinerary = {
                                    itineraryType: 'HOP_ON_HOP_OFF',
                                    skipTheLine: itinerary.skipTheLine,
                                    privateTour: itinerary.privateTour,
                                    maxTravelersInSharedTour: itinerary.maxTravelersInSharedTour,
                                    duration: itinerary.duration,
                                    routes: itinerary.routes || []
                                };
                                break;
                            case 'UNSTRUCTURED':
                                structuredItinerary = {
                                    itineraryType: 'UNSTRUCTURED',
                                    skipTheLine: itinerary.skipTheLine,
                                    privateTour: itinerary.privateTour,
                                    maxTravelersInSharedTour: itinerary.maxTravelersInSharedTour,
                                    unstructuredDescription: itinerary.unstructuredDescription
                                };
                                break;
                        }
                    }
                    // Extract detailed product information
                    const details = {
                        overview: productDetails.description?.trim() || '',
                        whatIncluded: {
                            included: (productDetails.inclusions || [])
                                .map((inc) => inc.otherDescription?.trim())
                                .filter((desc) => desc && desc.length > 0),
                            excluded: (productDetails.exclusions || [])
                                .map((exc) => exc.otherDescription?.trim())
                                .filter((desc) => desc && desc.length > 0)
                        },
                        meetingAndPickup: {
                            meetingPoint: {
                                name: start.location?.name?.trim() || '',
                                address: start.description?.trim() || locationInfo.meetingPoints[0]?.trim() || '',
                                googleMapsUrl: start.location?.googleMapsUrl
                            },
                            endPoint: end.description?.trim() || travelerPickup.additionalInfo?.trim() || 'Returns to departure point'
                        },
                        whatToExpect: (productDetails.itinerary?.itineraryItems || [])
                            .map((item, index) => {
                            const location = item.pointOfInterestLocation?.location;
                            const isPassBy = item.passByWithoutStopping;
                            const stopData = {
                                location: location?.name?.trim() || item.description?.split('.')[0]?.trim() || `Stop ${index + 1}`,
                                description: item.description?.trim() || '',
                                duration: item.duration ? `${item.duration.fixedDurationInMinutes} minutes` : 'Duration not specified',
                                admissionType: isPassBy ? 'Pass By' : (item.admissionIncluded || 'Admission Ticket Free'),
                                isPassBy,
                                coordinates: location?.coordinates ? {
                                    lat: location.coordinates.latitude,
                                    lng: location.coordinates.longitude
                                } : undefined,
                                attractionId: item.pointOfInterestLocation?.attractionId,
                                stopNumber: index + 1
                            };
                            return stopData;
                        })
                            .filter((stop) => stop.description || stop.coordinates || stop.location !== `Stop ${stop.stopNumber}`),
                        additionalInfo: {
                            confirmation: productDetails.bookingConfirmationSettings?.confirmationType?.trim() || '',
                            accessibility: (productDetails.additionalInfo || [])
                                .map((info) => info.description?.trim())
                                .filter((desc) => desc && desc.length > 0),
                            restrictions: productDetails.restrictions || [],
                            maxTravelers: productDetails.bookingRequirements?.maxTravelersPerBooking || 0,
                            cancellationPolicy: {
                                description: productDetails.cancellationPolicy?.description?.trim() || '',
                                refundEligibility: productDetails.cancellationPolicy?.refundEligibility || []
                            }
                        }
                    };
                    // Extract availability and pricing information
                    const bookingInfo = {
                        productCode,
                        cancellationPolicy: productDetails.cancellationPolicy?.description || activity.bookingInfo?.cancellationPolicy || 'Standard cancellation policy',
                        instantConfirmation: productDetails.bookingConfirmationSettings?.confirmationType === 'INSTANT',
                        mobileTicket: productDetails.ticketInfo?.ticketTypes?.includes('MOBILE') || true,
                        languages: productDetails.languageGuides?.map((lg) => lg.language) || ['English'],
                        minParticipants: activity.bookingInfo?.minParticipants || 1,
                        maxParticipants: activity.bookingInfo?.maxParticipants || 999,
                        availability: availabilitySchedule ? {
                            startTimes: availabilitySchedule.bookableItems?.[0]?.seasons?.[0]?.pricingRecords?.[0]?.timedEntries?.map(entry => entry.startTime) || [],
                            daysAvailable: availabilitySchedule.bookableItems?.[0]?.seasons?.[0]?.pricingRecords?.[0]?.daysOfWeek || [],
                            seasons: availabilitySchedule.bookableItems?.[0]?.seasons || []
                        } : undefined
                    };
                    // Extract product options
                    const productOptions = productDetails.productOptions?.map((option) => ({
                        productOptionCode: option.productOptionCode,
                        description: option.description,
                        title: option.title,
                        languageGuides: option.languageGuides
                    }));
                    return {
                        ...activity,
                        location: locationInfo,
                        openingHours: productDetails.itinerary?.routes?.[0]?.operatingSchedule || '',
                        details,
                        bookingInfo,
                        itinerary: structuredItinerary,
                        productDetails: {
                            ...activity.productDetails,
                            productOptions
                        }
                    };
                }
            }
            catch (error) {
                logger.error('[Viator] Error getting product details:', {
                    productCode,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                throw error;
            }
            throw new Error(`Failed to enrich activity details for product code: ${productCode}`);
        }
        catch (error) {
            logger.error('Error enriching activity details:', error);
            throw error;
        }
    }
    calculateSimilarity(str1, str2) {
        // Convert both strings to lowercase and remove special characters
        const clean1 = str1.toLowerCase().replace(/[^a-z0-9\s]/g, '');
        const clean2 = str2.toLowerCase().replace(/[^a-z0-9\s]/g, '');
        // Split into words
        const words1 = new Set(clean1.split(/\s+/));
        const words2 = new Set(clean2.split(/\s+/));
        // Calculate intersection
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        // Calculate Jaccard similarity
        const similarity = intersection.size / (words1.size + words2.size - intersection.size);
        return similarity;
    }
    mapProductToActivity(product) {
        return {
            id: product.productCode,
            name: product.title,
            description: product.description,
            duration: product.duration,
            price: {
                amount: product.price?.amount || 0,
                currency: product.price?.currency || 'USD'
            },
            tier: this.determineTier(product.price?.amount || 0),
            category: product.categories?.[0]?.name || 'General',
            location: {
                address: product.location?.address,
                coordinates: product.location?.coordinates ? {
                    latitude: product.location.coordinates.latitude,
                    longitude: product.location.coordinates.longitude
                } : undefined
            },
            rating: product.rating,
            numberOfReviews: product.reviewCount,
            images: product.images?.map((img) => {
                const preferredVariant = img.variants?.find((v) => v.width === 480 && v.height === 320);
                return preferredVariant?.url || img.variants?.[0]?.url;
            }) || [],
            bookingInfo: {
                productCode: product.productCode,
                cancellationPolicy: product.bookingInfo?.cancellationPolicy || 'Standard cancellation policy',
                instantConfirmation: true,
                mobileTicket: true,
                languages: ['English'],
                minParticipants: product.bookingInfo?.minParticipants || 1,
                maxParticipants: product.bookingInfo?.maxParticipants || 999
            },
            meetingPoint: product.meetingPoint ? {
                name: product.meetingPoint.name,
                address: product.meetingPoint.address,
                details: product.meetingPoint.details
            } : undefined,
            endPoint: product.endPoint ? {
                name: product.endPoint.name,
                address: product.endPoint.address,
                details: product.endPoint.details
            } : undefined,
            operatingHours: product.operatingHours,
            overview: product.overview,
            whatsIncluded: product.whatsIncluded,
            itinerary: product.itinerary?.map((day) => ({
                day: day.day,
                title: day.title,
                stops: day.stops?.map((stop) => ({
                    name: stop.name,
                    duration: stop.duration,
                    description: stop.description,
                    admissionType: stop.admissionType
                }))
            })),
            cancellationPolicy: product.cancellationPolicy,
            referenceUrl: product.productUrl || (product.destinations?.[0]?.ref ?
                `https://www.viator.com/tours/${product.destinations[0].name.split(',')[0]}/${product.title.replace(/[^a-zA-Z0-9]+/g, '-')}/d${product.destinations[0].ref}-${product.productCode}` :
                `https://www.viator.com/tours/${product.productCode}`)
        };
    }
    determineCategory(activity) {
        const description = (activity.description + ' ' + activity.name).toLowerCase();
        // Try to match based on keywords
        for (const category of ACTIVITY_CATEGORIES) {
            if (category.keywords.some(keyword => description.includes(keyword.toLowerCase()))) {
                return category.name;
            }
        }
        // Default to Cultural if no match found
        return 'Cultural';
    }
    getPreferredTimeSlot(category) {
        const categoryInfo = ACTIVITY_CATEGORIES.find(c => c.name === category);
        switch (categoryInfo?.preferredTimeOfDay) {
            case 'morning':
                return {
                    startTime: '09:00',
                    endTime: '13:00',
                    duration: categoryInfo.typicalDuration,
                    category
                };
            case 'afternoon':
                return {
                    startTime: '14:00',
                    endTime: '18:00',
                    duration: categoryInfo.typicalDuration,
                    category
                };
            case 'evening':
                return {
                    startTime: '19:00',
                    endTime: '23:00',
                    duration: categoryInfo.typicalDuration,
                    category
                };
            default:
                return {
                    startTime: '12:00',
                    endTime: '16:00',
                    duration: 120,
                    category
                };
        }
    }
    async getAvailabilitySchedule(productCode) {
        try {
            const response = await axios.get(`${this.baseUrl}/availability/schedules/${productCode}`, {
                headers: {
                    'Accept': 'application/json;version=2.0',
                    'Accept-Language': 'en-US',
                    'exp-api-key': this.apiKey
                }
            });
            logger.info('Availability schedule response:', response.data);
            return response.data;
        }
        catch (error) {
            logger.error('Error fetching availability schedule:', error);
            throw error;
        }
    }
    async checkRealTimeAvailability(productCode, date, travelers) {
        try {
            const response = await axios.post(`${this.baseUrl}/availability/check`, {
                productCode,
                travelDate: date,
                paxMix: [{
                        ageBand: 'ADULT',
                        numberOfTravelers: travelers
                    }]
            }, {
                headers: {
                    'Accept': 'application/json;version=2.0',
                    'Accept-Language': 'en-US',
                    'exp-api-key': this.apiKey
                }
            });
            logger.info('Real-time availability response:', response.data);
            return response.data;
        }
        catch (error) {
            logger.error('Error checking real-time availability:', error);
            throw error;
        }
    }
    determineTier(price) {
        if (price <= 50)
            return 'budget';
        if (price <= 150)
            return 'medium';
        return 'premium';
    }
}
export const viatorClient = new ViatorService(process.env.VIATOR_API_KEY || '');
