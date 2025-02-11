import axios from 'axios';
import { logger, logViator } from '../utils/logger';
import { ACTIVITY_CATEGORIES, determineCategoryFromDescription, getPreferredTimeSlot, getTypicalDuration } from '../constants/categories.js';

// Update the interface for category determination
interface CategoryDetermination {
  name: string;
  description: string;
  productCode?: string;
  price?: {
    amount: number;
    currency: string;
  };
  title?: string;
  categories?: Array<{
    id: string;
    name: string;
    level: number;
  }>;
  tags?: string[];
}

interface ViatorSearchResponse {
  products: Array<{
      productCode: string;
      title: string;
      description: string;
      duration: {
        fixedDurationInMinutes: number;
      };
      pricing: {
        summary: {
          fromPrice: number;
        };
        currency: string;
      };
      rating?: number;
      reviews?: {
      rating: number;
      reviewCount: number;
      };
      images?: Array<{
        variants: Array<{
          url: string;
        }>;
      }>;
      bookingInfo?: {
        cancellationPolicy?: string;
        confirmationType?: string;
        mobileTicketing?: boolean;
        languages?: string[];
        minParticipants?: number;
        maxParticipants?: number;
      };
      location?: {
        address?: string;
        meetingPoint?: string;
      };
      highlights?: string[];
      operatingHours?: string;
      category?: string;
      categories?: Array<{
        id: string;
        name: string;
        level: number;
      }>;
    }>;
}

interface ViatorImage {
  imageSource: string;
  caption: string;
  isCover: boolean;
  variants: Array<{
    url: string;
    width: number;
    height: number;
  }>;
}

interface ViatorImageVariant {
  url?: string;
  width?: number;
  height?: number;
}

interface ViatorProduct {
  productCode: string;
  title: string;
  name: string;
  description: string;
  duration: number;
  price: {
    amount: number;
    currency: string;
  };
  rating: number;
  reviewCount: number;
  images: Array<{
    url: string;
  }>;
  productUrl: string;
  referenceUrl: string;
  highlights?: string[];
  location?: {
    address?: string;
    coordinates?: {
      latitude: number;
      longitude: number;
    };
  };
  category?: string;
  bookingInfo?: {
    productCode: string;
    cancellationPolicy: string;
    instantConfirmation: boolean;
    mobileTicket: boolean;
    languages: string[];
    minParticipants: number;
    maxParticipants: number;
  };
  productDetails?: {
    productOptions?: ViatorProductOption[];
  };
}

interface ViatorLocationInfo {
  address: string;
  meetingPoints: string[];
  startingLocations: string[];
}

interface ViatorInclusion {
  otherDescription: string;
}

interface ViatorExclusion {
  otherDescription: string;
}

interface ViatorRoute {
  name: string;
  description: string;
  duration: {
    fixedDurationInMinutes: number;
  };
  passBy?: boolean;
  location?: {
    name?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
  };
}

interface ViatorAdditionalInfo {
  description: string;
}

interface ViatorReviewCount {
  rating: number;
  count: number;
}

interface ViatorItineraryItem {
  pointOfInterestLocation: {
    location: {
      ref: string;
      name?: string;
      address?: string;
      coordinates?: {
        latitude: number;
        longitude: number;
      };
    };
    attractionId?: number;
  };
  duration: {
    fixedDurationInMinutes?: number;
    variableDurationFromMinutes?: number;
    variableDurationToMinutes?: number;
  };
  passByWithoutStopping: boolean;
  admissionIncluded: 'YES' | 'NO' | 'NOT_APPLICABLE';
  description: string;
}

interface WhatToExpectStop {
  location: string;
  description: string;
  duration: string;
  admissionType: string;
  isPassBy: boolean;
  coordinates?: {
    lat: number;
    lng: number;
  };
  attractionId?: number;
  stopNumber: number;
}

interface ViatorProductDetails {
  overview: string;
  whatIncluded: {
    included: string[];
    excluded: string[];
  };
  meetingAndPickup: {
    meetingPoint: {
      name: string;
      address: string;
      googleMapsUrl?: string;
    };
    endPoint: string;
  };
  whatToExpect: Array<WhatToExpectStop>;
  additionalInfo: {
    confirmation: string;
    accessibility: string[];
    restrictions: string[];
    maxTravelers: number;
    cancellationPolicy: {
      description: string;
      refundEligibility: Array<{
        dayRangeMin: number;
        dayRangeMax?: number;
        percentageRefundable: number;
      }>;
    };
  };
  reviews?: {
    rating: number;
    totalReviews: number;
    ratingBreakdown: Array<{
      stars: number;
      count: number;
    }>;
    featuredReviews: Array<{
      author: string;
      date: string;
      rating: number;
      title?: string;
      content: string;
      helpful?: number;
    }>;
  };
}

interface ReviewStats {
  rating: number;
  count: number;
  percentage: string;
}

interface ReviewSource {
  provider: string;
  count: number;
}

interface ReviewCountTotals {
  averageRating: number;
  totalReviews: number;
  stats: ReviewStats[];
  sources: ReviewSource[];
}

interface ReviewItem {
  author: string;
  date: string;
  rating: number;
  text: string;
  title?: string;
  helpful?: number;
}

interface Reviews {
  reviewCountTotals: ReviewCountTotals;
  items: ReviewItem[];
}

interface EnrichedActivity extends ViatorProduct {
  location: ViatorLocationInfo;
  openingHours?: string;
  details?: ViatorProductDetails;
  reviews?: Reviews;
  itinerary?: ItineraryType;
  productDetails?: {
    productOptions?: ViatorProductOption[];
  };
  commentary?: string;
  itineraryHighlight?: string;
  scoringReason?: string;
  dayPlanningLogic?: string;
}

interface ViatorReviewBreakdown {
  stars: number;
  count: number;
}

interface ViatorLocation {
  ref: string;
  name?: string;
  address?: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  googleMapsUrl?: string;
}

interface ActivityCategory {
  name: string;
  keywords: string[];
  preferredTimeOfDay: 'morning' | 'afternoon' | 'evening';
  typicalDuration: number; // in minutes
}

interface ActivityTimeSlot {
  startTime: string;
  endTime: string;
  duration: number;
  category: string;
}

interface ItineraryType {
  itineraryType: 'STANDARD' | 'ACTIVITY' | 'MULTI_DAY_TOUR' | 'HOP_ON_HOP_OFF' | 'UNSTRUCTURED';
  skipTheLine: boolean;
  privateTour: boolean;
  maxTravelersInSharedTour?: number;
  duration?: {
    fixedDurationInMinutes?: number;
  };
  itineraryItems?: any[];
  days?: any[];
  routes?: any[];
  pointsOfInterest?: any[];
  activityInfo?: any;
  foodMenus?: any[];
  unstructuredDescription?: string;
}

interface ViatorItinerary {
  itineraryType: 'STANDARD' | 'ACTIVITY' | 'MULTI_DAY_TOUR' | 'HOP_ON_HOP_OFF' | 'UNSTRUCTURED';
  skipTheLine: boolean;
  privateTour: boolean;
  maxTravelersInSharedTour?: number;
  duration: {
    fixedDurationInMinutes?: number;
    variableDurationFromMinutes?: number;
    variableDurationToMinutes?: number;
  };
  unstructuredDescription?: string;
  itineraryItems?: ViatorItineraryItem[];
  days?: ViatorItineraryDay[];
  routes?: ViatorItineraryRoute[];
}

interface ViatorItineraryDay {
  title: string;
  dayNumber: number;
  items: ViatorItineraryItem[];
  accommodations?: Array<{
    description: string;
  }>;
  foodAndDrinks?: Array<{
    course: string;
    dishName: string;
    dishDescription: string;
  }>;
}

interface ViatorItineraryRoute {
  operatingSchedule: string;
  duration: {
    fixedDurationInMinutes: number;
  };
  name: string;
  stops: Array<{
    stopLocation: {
      ref: string;
    };
    description: string;
  }>;
  pointsOfInterest: Array<{
    location: {
      ref: string;
    };
    attractionId?: number;
  }>;
}

interface ViatorAvailabilitySchedule {
  productCode: string;
  schedules: Array<{
            date: string;
    available: boolean;
    startTime?: string;
    endTime?: string;
    pricing?: {
    fromPrice: number;
      currency: string;
  };
    vacancies?: number;
  }>;
}

interface Activity {
  id?: string;
  name: string;
  description: string;
  duration?: number;
  price: {
    amount: number;
    currency: string;
  };
  tier?: string;
  rating?: number;
  numberOfReviews?: number;
  ratingDisplay?: string;
  images: string[];
  bookingInfo: {
    productCode: string;
    cancellationPolicy: string;
    instantConfirmation: boolean;
    mobileTicket: boolean;
    languages: string[];
    minParticipants: number;
    maxParticipants: number;
  };
  highlights?: string[];
  meetingPoint?: {
    name: string;
    address: string;
    details: string;
  };
  endPoint?: {
    name: string;
    address: string;
    details: string;
  };
  location: {
    address?: string;
    coordinates?: {
      latitude: number;
      longitude: number;
    };
  };
  category: string;
  referenceUrl: string;
  operatingHours?: string;
  overview?: string;
  whatsIncluded?: any;
  itinerary?: any[];
  cancellationPolicy?: string;
}

interface ViatorProductOption {
  productOptionCode: string;
  description: string;
  title: string;
  languageGuides?: string[];
}

// Add Viator category mapping
const VIATOR_CATEGORY_MAP: Record<string, string> = {
  'Tours & Sightseeing': 'Cultural & Historical',
  'Cultural & Theme Tours': 'Cultural & Historical',
  'Historical & Heritage Tours': 'Cultural & Historical',
  'Walking & Biking Tours': 'Nature & Adventure',
  'Outdoor Activities': 'Nature & Adventure',
  'Water Sports': 'Nature & Adventure',
  'Day Cruises': 'Cruises & Sailing',
  'Night Cruises': 'Cruises & Sailing',
  'Sunset Cruises': 'Cruises & Sailing',
  'Food, Wine & Nightlife': 'Food & Dining',
  'Food Tours': 'Food & Dining',
  'Dining Experiences': 'Food & Dining',
  'Shows, Concerts & Sports': 'Entertainment',
  'Theater, Shows & Musicals': 'Entertainment',
  'Shopping Tours': 'Shopping',
  'Shopping Passes & Offers': 'Shopping',
  'Sightseeing Tickets & Passes': 'Tickets & Passes',
  'Attraction Tickets': 'Tickets & Passes',
  'Museum Tickets & Passes': 'Tickets & Passes'
};

// Rate limiting configuration
const RATE_LIMIT = {
  requestsPerSecond: 1, // Reduced from 2 to 1 for better stability
  lastRequestTime: 0,
  minDelay: 1000, // Minimum 1 second between requests
  queue: [] as { resolve: Function, reject: Function }[]
};

interface ViatorError extends Error {
  response?: {
    status: number;
    data: any;
    headers?: {
      'retry-after'?: string;
    };
  };
  code?: string;
  isAxiosError?: boolean;
}

interface GenerateActivitiesParams {
  destination: string;
  days: number;
  budget: number;
  currency: string;
  preferences: {
    travelStyle: string;
    pacePreference: string;
    interests: string[];
    accessibility: string[];
    dietaryRestrictions: string[];
  };
}

interface Break {
    startTime: string;
    endTime: string;
    duration: number;
    suggestion: string;
}

interface DayPlan {
    theme: string;
    activities: Array<{
        name: string;
        timeSlot: string;
        startTime: string;
        endTime: string;
        order: number;
        category: string;
        location: {
            address: string;
            coordinates?: { lat: number; lng: number; };
        };
        price: {
            amount: number;
            currency: string;
        };
        duration: number;
        rating?: number;
    }>;
    dayPlanning: {
        suggestedStartTime: string;
        breakTimes: Break[];
        travelTips: Array<{
            type: string;
            tip: string;
        }>;
        mealSuggestions: Array<{
            type: string;
            timeSlot: string;
            suggestion: string;
        }>;
    };
    highlights: {
        mainAttraction: string | null;
        culturalHighlight: string | null;
        uniqueExperience: string | null;
    };
    locationCluster: { lat: number; lng: number; } | null;
}

// Add these interfaces at the top of the file with other interfaces
interface TimeSlotConfig {
    start: string;
    end: string;
    maxDuration: number;
}

interface TimingConstraints {
    firstDay: {
        startAfter: Date;
        availableTimeSlots: string[];
    };
    lastDay: {
        endBefore: Date;
        availableTimeSlots: string[];
    };
}

interface DayTiming {
    isFirstDay: boolean;
    isLastDay: boolean;
    timingConstraints: {
      firstDay: {
        startAfter: Date;
        availableTimeSlots: string[];
      };
      lastDay: {
        endBefore: Date;
        availableTimeSlots: string[];
      };
    };
}

type TimeSlots = Record<string, TimeSlotConfig>;

interface LocationInfo {
    area: string;
    address: string;
    zone: string;
    coordinates: {
        lat: number;
        lng: number;
    };
}

interface ViatorCategory {
    name: string;
    id?: string;
    level?: number;
}

interface ViatorDestinationResponse {
    destinations: Array<{
        ref: string;
        parentId: string;
        name: string;
        destinationType: string;
        lookupId: string;
        timeZone: string;
        iataCode?: string;
        coordinates?: {
            latitude: number;
            longitude: number;
        };
    }>;
    totalCount: number;
}

interface ViatorSearchResult {
    productCode: string;
    title: string;
    description: string;
    duration?: {
        fixedDurationInMinutes: number;
    };
    pricing?: {
        summary: {
            fromPrice: number;
        };
        currency: string;
    };
    reviews?: {
        rating: number;
        reviewCount: number;
    };
    images?: Array<{
        variants?: Array<{
            url?: string;
            width?: number;
            height?: number;
        }>;
    }>;
    bookingInfo?: {
        cancellationPolicy?: string;
        languages?: string[];
        minParticipants?: number;
        maxParticipants?: number;
    };
    highlights?: string[];
    location?: {
        address?: string;
    };
    categories?: Array<{
        id: string;
        name: string;
        level: number;
    }>;
    tags?: string[];
    productUrl?: string;
}

interface ImageVariant {
  url: string;
  width?: number;
  height?: number;
}

interface ActivityIdentifier {
  name: string;
  productCode?: string;
}

export class ViatorService {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string) {
    this.baseUrl = 'https://api.viator.com/partner';
    this.apiKey = apiKey;
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - RATE_LIMIT.lastRequestTime;
    
    if (timeSinceLastRequest < RATE_LIMIT.minDelay) {
        const waitTime = RATE_LIMIT.minDelay - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    RATE_LIMIT.lastRequestTime = Date.now();
  }

  private async makeRequest(method: string, endpoint: string, data?: any): Promise<any> {
    const maxRetries = 3;
    const baseDelay = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await this.rateLimit();
            
            const response = await axios({
                method,
                url: `${this.baseUrl}${endpoint}`,
                data,
        headers: {
          'Accept': 'application/json;version=2.0',
          'Accept-Language': 'en-US',
          'exp-api-key': this.apiKey
                },
                timeout: 30000
      });
            return response;
    } catch (error) {
            const viatorError = error as ViatorError;
            const isRetryable = viatorError?.response?.status === 429 || 
                               viatorError?.response?.status === 503 ||
                               viatorError?.code === 'ECONNABORTED';
            
            if (!isRetryable || attempt === maxRetries) {
                throw viatorError;
            }

            const retryAfter = viatorError?.response?.status === 429 
                ? parseInt(viatorError.response?.headers?.['retry-after'] || '5') * 1000
                : Math.min(baseDelay * Math.pow(2, attempt - 1), 8000);

            await new Promise(resolve => setTimeout(resolve, retryAfter));
        }
    }
    throw new Error('Max retries exceeded');
  }

  private async getDestinations(): Promise<ViatorDestinationResponse> {
    try {
        const response = await this.makeRequest('GET', '/destinations', undefined);
        logger.debug('Destinations fetched successfully');
        return response.data;
    } catch (err) {
        const viatorError = err as ViatorError;
        logger.error('Destinations fetch failed', {
            status: viatorError.response?.status,
            code: viatorError.code
        });
        throw viatorError;
    }
  }

  async getDestinationId(cityName: string): Promise<string> {
    try {
        const response = await this.getDestinations();
        const destination = response.destinations.find((dest) => 
        dest.name.toLowerCase() === cityName.toLowerCase()
      );

      if (!destination) {
            const partialMatch = response.destinations.find((dest) =>
                dest.name.toLowerCase().includes(cityName.toLowerCase())
            );

            if (partialMatch) {
                logger.debug(`Using partial match for ${cityName}: ${partialMatch.name}`);
                return partialMatch.ref;
            }

        throw new Error(`Could not find destination ID for ${cityName}`);
      }

      return destination.ref;
    } catch (err) {
        const viatorError = err as ViatorError;
        logger.error('Destination ID lookup failed', {
            cityName,
            status: viatorError.response?.status
        });
        throw viatorError;
    }
  }

  async searchActivity(searchTerm: string): Promise<any> {
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
              images: productDetails.images?.map((img: any) => {
                const variants = img.variants || [];
                const preferredVariant = variants.find((v: ViatorImageVariant) => v.width === 480 && v.height === 320);
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
        } catch (error) {
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

      const response = await axios.post(
        `${this.baseUrl}/search/freetext`,
        searchRequest,
        {
          headers: {
            'Accept': 'application/json;version=2.0',
            'Content-Type': 'application/json',
            'Accept-Language': 'en-US',
            'exp-api-key': this.apiKey
          }
        }
      );

      if (!response.data.products?.results?.length) {
        logger.warn(`No products found for search term: ${searchTerm}`);
        return null;
      }

      return response.data.products.results.map((product: any) => {
        const ratingStr = product.reviews?.combinedAverageRating 
          ? `★ ${product.reviews.combinedAverageRating.toFixed(1)} (${product.reviews.totalReviews} reviews)` 
          : '';

        const categoryInfo: CategoryDetermination = {
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
          images: product.images?.map((img: any) => {
            const variants = img.variants || [];
            const preferredVariant = variants.find((v: ViatorImageVariant) => v.width === 480 && v.height === 320);
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
    } catch (error) {
      logger.error('Error searching activity:', error);
      throw error;
    }
  }

  private calculateSimilarity(str1: string, str2: string): number {
    const clean1 = str1.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const clean2 = str2.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const words1 = new Set(clean1.split(/\s+/));
    const words2 = new Set(clean2.split(/\s+/));
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    return intersection.size / (words1.size + words2.size - intersection.size);
  }

  private formatActivityResponse(result: ViatorSearchResult): any {
    const ratingStr = result.reviews?.rating
        ? `★ ${result.reviews.rating.toFixed(1)} (${result.reviews.reviewCount} reviews)`
        : '';

    return {
        name: result.title,
        description: result.description,
        duration: result.duration?.fixedDurationInMinutes,
        price: {
            amount: result.pricing?.summary?.fromPrice,
            currency: result.pricing?.currency
        },
        rating: result.reviews?.rating,
        numberOfReviews: result.reviews?.reviewCount,
        ratingDisplay: ratingStr,
        images: result.images?.map((img) => {
            const variants = img.variants || [];
            const preferredVariant = variants.find(v => v.width && v.height && v.width <= 800) || variants[0];
            return preferredVariant?.url;
        }).filter((url): url is string => !!url),
        bookingInfo: {
            productCode: result.productCode,
            cancellationPolicy: result.bookingInfo?.cancellationPolicy || 'Standard cancellation policy',
            instantConfirmation: true,
            mobileTicket: true,
            languages: ['English'],
            minParticipants: 1,
            maxParticipants: 99
        },
        highlights: result.highlights || [],
        location: result.location?.address || '',
        category: this.determineCategory({
            name: result.title,
            description: result.description,
            productCode: result.productCode,
            categories: result.categories,
            tags: result.tags
        }),
        referenceUrl: result.productUrl || `https://www.viator.com/tours/${result.productCode}`
    };
  }

  private createBasicActivityInfo(searchTerm: string) {
    // Extract category hints from the search term
    const categoryHints = {
      museum: 'Cultural & Historical',
      tour: 'Cultural & Historical',
      food: 'Food & Dining',
      cruise: 'Cruises & Sailing',
      show: 'Entertainment',
      ticket: 'Tickets & Passes',
      adventure: 'Nature & Adventure',
      walk: 'Nature & Adventure'
    };

    // Determine category based on search term keywords
    const searchTermLower = searchTerm.toLowerCase();
    const category = Object.entries(categoryHints).find(([key]) => 
      searchTermLower.includes(key)
    )?.[1] || determineCategoryFromDescription(searchTerm);

    return {
      name: searchTerm,
      description: `Activity in ${searchTerm.split(',')[1]?.trim() || 'the area'}`,
      duration: 120, // Default 2 hours
      category,
      timeSlot: getPreferredTimeSlot(category),
      location: searchTerm.split(',')[0]?.trim(),
      price: {
        amount: 0,
        currency: 'USD'
      }
    };
  }

  private async searchViatorActivity(searchTerm: string, destination?: string): Promise<any> {
    try {
        const response = await this.performSearch(searchTerm, destination);
        if (!response.products?.length) return null;

        // Calculate relevance scores and sort results
        const scoredResults = response.products.map((result) => {
            const titleSimilarity = this.calculateSimilarity(result.title, searchTerm);
            const rating = result.reviews?.rating || 0;
            const reviewCount = result.reviews?.reviewCount || 0;
            
            const relevanceScore = (titleSimilarity * 0.6) + 
                                ((rating / 5) * 0.3) + 
                                (Math.min(reviewCount / 1000, 1) * 0.1);
            
            return { result, relevanceScore };
        }).sort((a, b) => b.relevanceScore - a.relevanceScore);

        // Take top 5 most relevant results if they meet minimum relevance threshold
        const relevantResults = scoredResults
            .filter(r => r.relevanceScore > 0.2)
            .slice(0, 5)
            .map(r => r.result);

        logger.info('Viator search relevant matches:', {
            searchTerm,
            destination,
            matches: relevantResults.map(match => ({
                productCode: match.productCode,
                name: match.title,
                relevanceScore: scoredResults.find(r => r.result === match)?.relevanceScore.toFixed(2),
                similarity: this.calculateSimilarity(match.title, searchTerm).toFixed(2),
                rating: match.reviews?.rating || 'N/A'
            }))
        });

        return relevantResults.map(result => 
            this.formatActivityResponse(result)
        );
    } catch (error) {
        logger.error(`Search failed: ${searchTerm}`, error);
        throw error;
    }
}

  private extractLocationInfo(productDetails: any) {
    const location = {
      address: productDetails.location?.address || '',
      coordinates: productDetails.location?.coordinates || null,
      cityName: productDetails.location?.cityName || '',
      countryName: productDetails.location?.countryName || '',
      locationId: productDetails.location?.locationId || '',
      areaId: productDetails.location?.areaId || '',
      meetingPoint: {
        coordinates: productDetails.meetingPoint?.coordinates || null,
        address: productDetails.meetingPoint?.address || '',
        description: productDetails.meetingPoint?.description || '',
        directions: productDetails.meetingPoint?.directions || ''
      },
      endPoint: {
        coordinates: productDetails.endPoint?.coordinates || null,
        address: productDetails.endPoint?.address || '',
        description: productDetails.endPoint?.description || '',
        directions: productDetails.endPoint?.directions || ''
      }
    };

    logger.debug('[Viator] Extracted location info:', { location });
    return location;
  }

  private extractImages(productDetails: any): any[] {
    if (!productDetails || !productDetails.images) {
        return [];
    }

    return productDetails.images.map((img: any) => ({
        url: img.url || '',
        caption: img.caption || '',
        provider: img.provider || 'Viator',
        isHero: !!img.isHero
    })).filter((img: any) => img.url);
  }

  private determineCategory(info: CategoryDetermination): string {
    // First, try to determine from existing categories
    if (info.categories && info.categories.length > 0) {
        const mainCategory = info.categories.find(cat => cat.level === 1);
        if (mainCategory && VIATOR_CATEGORY_MAP[mainCategory.name]) {
            return VIATOR_CATEGORY_MAP[mainCategory.name];
        }
    }

    // If no categories or mapping found, determine from description
    return determineCategoryFromDescription(info.description);
  }

  private formatImages(images: ViatorImage[]): string[] {
    if (!images) return [];
    return images
      .map(img => {
        const variants = img.variants || [];
        // Only compare dimensions if both width and height are defined
        const preferredVariant = variants.find(v => 
          v.width && v.height && v.width === 480 && v.height === 320
        ) || variants[0];
        return preferredVariant?.url;
      })
      .filter((url): url is string => !!url);
  }

  private async performSearch(searchTerm: string, destination?: string): Promise<ViatorSearchResponse> {
    let destinationId;
    if (destination) {
        try {
            destinationId = await this.getDestinationId(destination);
        } catch (error) {
            logger.debug(`Proceeding without destination ID for ${destination}`);
        }
    }

    const searchRequest = {
        text: searchTerm,
        ...(destinationId && {
            filtering: {
                destination: destinationId
            }
        }),
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        currency: 'USD',
        pagination: {
            offset: 0,
            limit: 50
        },
        sorting: {
            sortBy: 'RELEVANCE',
            sortOrder: 'DESC'
        }
    };

    const response = await this.makeRequest('POST', '/products/search', searchRequest);
    
    if (!response.data.products?.length) {
        logger.debug('No search results found', { searchTerm });
    }

    return response.data;
  }

  private async getProductDetails(productCode: string): Promise<any> {
    try {
        const response = await this.makeRequest('GET', `/products/${productCode}`);
        return response.data;
    } catch (error) {
        if ((error as ViatorError).response?.status === 429) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            return this.getProductDetails(productCode);
        }
      throw error;
    }
  }

  private constructViatorUrls(productCode: string, images: any[] = []) {
    return {
        productUrl: `https://www.viator.com/tours/${productCode}`,
        bookingUrl: `https://www.viator.com/tours/${productCode}/booking`,
        mainImageUrl: images?.[0]?.url || 'https://www.viator.com/img/placeholder.jpg',
        mobileUrl: `https://m.viator.com/tours/${productCode}`,
        deepLink: `viator://product/${productCode}`
    };
  }

  async enrichActivityDetails(activity: any): Promise<any> {
    try {
        // Extract product code from activity
        const productCode = this.extractProductCode(activity) || `VIATOR-${Date.now()}`;
        
        // Get product details and availability schedule
        const [productDetails, availabilitySchedule] = await Promise.all([
            this.getProductDetails(productCode).catch(() => null),
            this.getAvailabilitySchedule(productCode).catch(() => null)
        ]);

        logger.info(`[Viator] Enriching activity: ${activity.name} with product code: ${productCode}`);

        // Get URLs
        const urls = this.constructViatorUrls(productCode, productDetails?.images);

        // Base enriched activity with fallback values
        const enrichedActivity = {
            ...activity,
            productCode,
            provider: 'Viator',
            bookingStatus: productDetails ? 'available' : 'unavailable',
            enrichmentStatus: productDetails ? 'success' : 'partial',
            rating: productDetails?.rating || activity.rating || 4.0,
            reviews: this.extractReviews(productDetails),
            images: this.extractImages(productDetails),
            location: this.extractLocation(productDetails),
            includedItems: this.extractIncludedItems(productDetails),
            excludedItems: this.extractExcludedItems(productDetails),
            meetingPoint: this.extractMeetingPoint(productDetails),
            itinerary: this.extractItinerary(productDetails),
            bookingInfo: this.extractBookingInfo(productDetails, availabilitySchedule),
            cancellationPolicy: this.extractCancellationPolicy(productDetails),
            accessibility: this.extractAccessibility(productDetails),
            urls,
            viatorDetails: {
                productUrl: urls.productUrl,
                bookingUrl: urls.bookingUrl,
                mainImageUrl: urls.mainImageUrl,
                mobileUrl: urls.mobileUrl,
                deepLink: urls.deepLink,
                highlights: productDetails?.highlights || [],
                inclusions: productDetails?.includedItems?.included || [],
                exclusions: productDetails?.includedItems?.excluded || [],
                cancellationPolicy: productDetails?.cancellationPolicy?.description || 'Standard cancellation policy',
                reviews: {
                    rating: productDetails?.rating || 0,
                    totalReviews: productDetails?.numberOfReviews || 0,
                    breakdown: productDetails?.reviews?.breakdown || []
                },
                itinerary: productDetails?.itinerary || {
                    type: 'STANDARD',
                    duration: activity.duration,
                    items: []
                },
                meetingPoint: productDetails?.meetingPoint || {
                    name: 'To be confirmed',
                    address: 'To be confirmed',
                    coordinates: null
                }
            }
        };

        // Log success
        if (productDetails) {
            logger.info(`[Viator] Successfully enriched activity: ${activity.name}`, {
                productCode,
                urls
            });
        } else {
            logger.warn(`[Viator] Partially enriched activity: ${activity.name} - product details not available`);
        }
        
        return enrichedActivity;
    } catch (error) {
        logger.error(`[Viator] Failed to enrich activity: ${activity.name}`, error);
        
        // Return activity with basic enrichment and default URLs
        const urls = this.constructViatorUrls('', []);
        return {
            ...activity,
            provider: 'Viator',
            enrichmentStatus: 'failed',
            bookingStatus: 'unavailable',
            urls,
            viatorDetails: {
                productUrl: urls.productUrl,
                bookingUrl: urls.bookingUrl,
                mainImageUrl: urls.mainImageUrl,
                mobileUrl: urls.mobileUrl,
                deepLink: urls.deepLink
            }
        };
    }
}

  private extractProductCode(activity: any): string | null {
    // Try to extract from existing URL if present
    if (activity.urls?.product) {
      const match = activity.urls.product.match(/tours\/([A-Z0-9]+)/);
      if (match) return match[1];
    }
    
    // Try to extract from description if present
    if (activity.description) {
      const match = activity.description.match(/Viator tour code: ([A-Z0-9]+)/i);
      if (match) return match[1];
    }
    
    return null;
  }

  private determineTier(price: number): string {
    if (price <= 50) return 'budget';
    if (price <= 150) return 'standard';
    if (price <= 300) return 'premium';
    return 'luxury';
  }

  private extractReviews(productDetails: any): any {
    if (!productDetails) {
        return {
            rating: 0,
            totalReviews: 0,
            breakdown: [],
            featured: []
        };
    }

    return {
        rating: productDetails.reviews?.rating || 0,
        totalReviews: productDetails.reviews?.totalReviews || 0,
        breakdown: productDetails.reviews?.breakdown || [],
        featured: productDetails.reviews?.featured || []
    };
  }

  private extractLocation(productDetails: any): ViatorLocationInfo {
    if (!productDetails) {
        return {
            address: '',
            coordinates: null,
            meetingPoint: null
        };
    }

    return {
        address: productDetails.location?.address || '',
        coordinates: productDetails.location?.coordinates || null,
        meetingPoint: productDetails.meetingPoint || null
    };
  }

  private extractIncludedItems(productDetails: any): any {
    if (!productDetails) {
        return {
            included: [],
            excluded: []
        };
    }

    return {
        included: productDetails.inclusions?.map((item: any) => item.description) || [],
        excluded: productDetails.exclusions?.map((item: any) => item.description) || []
    };
  }

  private extractExcludedItems(productDetails: any): any {
    if (!productDetails) {
        return {
            included: [],
            excluded: []
        };
    }

    return {
        included: productDetails.inclusions?.map((item: any) => item.description) || [],
        excluded: productDetails.exclusions?.map((item: any) => item.description) || []
    };
  }

  private extractMeetingPoint(productDetails: any): any {
    if (!productDetails) {
        return {
            meetingPoint: null,
            endPoint: null
        };
    }

    return {
        meetingPoint: productDetails.meetingPoint || null,
        endPoint: productDetails.endPoint || null
    };
  }

  private extractItinerary(productDetails: any): any {
    if (!productDetails || !productDetails.itinerary) {
        return {
            itineraryType: 'STANDARD',
            skipTheLine: false,
            privateTour: false,
            duration: {
                fixedDurationInMinutes: 0
            },
            itineraryItems: [],
            days: []
        };
    }

    const itinerary = productDetails.itinerary;
    return {
        itineraryType: itinerary.itineraryType || 'STANDARD',
        skipTheLine: itinerary.skipTheLine || false,
        privateTour: itinerary.privateTour || false,
        maxTravelersInSharedTour: itinerary.maxTravelersInSharedTour,
        duration: {
            fixedDurationInMinutes: itinerary.duration?.fixedDurationInMinutes || 0
        },
        itineraryItems: (itinerary.itineraryItems || []).map((item: any) => ({
            pointOfInterestLocation: {
                location: {
                    name: item.pointOfInterestLocation?.location?.name || '',
                    address: item.pointOfInterestLocation?.location?.address || '',
                    coordinates: item.pointOfInterestLocation?.location?.coordinates
                },
                attractionId: item.pointOfInterestLocation?.attractionId
            },
            duration: {
                fixedDurationInMinutes: item.duration?.fixedDurationInMinutes || 0
            },
            passByWithoutStopping: item.passByWithoutStopping || false,
            admissionIncluded: item.admissionIncluded || 'NOT_APPLICABLE',
            description: item.description || ''
        })),
        days: (itinerary.days || []).map((day: any) => ({
            dayNumber: day.dayNumber || 1,
            title: day.title || '',
            items: day.items || [],
            accommodations: day.accommodations || [],
            foodAndDrinks: day.foodAndDrinks || []
        }))
    };
}

  private extractBookingInfo(productDetails: any, availabilitySchedule: any): any {
    return {
      provider: 'Viator',
      productCode: productDetails.productCode,
      cancellationPolicy: productDetails.cancellationPolicy?.description || 'Free cancellation available',
      instantConfirmation: true,
      mobileTicket: true,
      languages: productDetails.bookingInfo?.languages || ['English'],
      minParticipants: productDetails.bookingInfo?.minParticipants || 1,
      maxParticipants: productDetails.bookingInfo?.maxParticipants || 999,
      pickupIncluded: this.extractMeetingPoint(productDetails)?.meetingPoint?.name?.toLowerCase().includes('pickup') || false,
      pickupLocation: this.extractMeetingPoint(productDetails)?.meetingPoint?.name || '',
      accessibility: productDetails.accessibility || [],
      restrictions: productDetails.restrictions || []
    };
  }

  private extractCancellationPolicy(productDetails: any): any {
    if (!productDetails) {
        return {
            description: 'Standard cancellation policy',
            refundable: true,
            deadline: '24h before'
        };
    }

    return {
        description: productDetails.cancellationPolicy?.description || 'Standard cancellation policy',
        refundable: productDetails.cancellationPolicy?.refundable !== false,
        deadline: productDetails.cancellationPolicy?.deadline || '24h before'
    };
  }

  private extractAccessibility(productDetails: any): string[] {
    if (!productDetails) {
        return [];
    }

    return productDetails.accessibility || [];
  }

  private buildActivityQuery(params: GenerateActivitiesParams): string {
    const { destination, preferences } = params;
    const { interests } = preferences;

    const searchTerms = [
      destination,
      ...interests.slice(0, 2)
    ].filter(Boolean);

    return searchTerms.join(' ');
  }

  async getAvailabilitySchedule(productCode: string): Promise<ViatorAvailabilitySchedule> {
    try {
      const response = await this.makeRequest('GET', `/availability/schedules/${productCode}`);
      return response.data;
    } catch (error) {
      if ((error as ViatorError).response?.status === 429) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        return this.getAvailabilitySchedule(productCode);
      }
      throw error;
    }
  }
}

export const viatorClient = new ViatorService(process.env.VIATOR_API_KEY || ''); 