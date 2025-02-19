import axios from 'axios';
import { logger } from '../utils/logger';
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
}

interface ViatorSearchResponse {
  products?: {
    totalCount: number;
    results: Array<{
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
        totalReviews: number;
        combinedAverageRating: number;
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
  };
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
  bookableItems: Array<{
    productOptionCode: string;
    seasons: Array<{
      startDate: string;
      endDate?: string;
      pricingRecords: Array<{
        daysOfWeek: string[];
        timedEntries: Array<{
          startTime: string;
          unavailableDates: Array<{
            date: string;
            reason: string;
          }>;
        }>;
        pricingDetails: Array<{
          pricingPackageType: string;
          minTravelers: number;
          ageBand: string;
          price: {
            original: {
              recommendedRetailPrice: number;
              partnerNetPrice: number;
              bookingFee: number;
              partnerTotalPrice: number;
            };
            special?: {
              recommendedRetailPrice: number;
              partnerNetPrice: number;
              bookingFee: number;
              partnerTotalPrice: number;
              offerStartDate: string;
              offerEndDate: string;
            };
          };
        }>;
      }>;
    }>;
  }>;
  currency: string;
  summary: {
    fromPrice: number;
  };
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

export class ViatorService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultCurrency = 'USD';
  private requestQueue: Promise<any> = Promise.resolve();
  private lastRequestTime: number = 0;
  private readonly minRequestInterval = 2000; // Increased to 2 seconds
  private readonly maxConcurrentRequests = 1; // Reduced to 1 concurrent request
  private activeRequests = 0;
  private consecutiveErrors = 0;
  private readonly maxRetries = 3;

  constructor(apiKey: string) {
    this.baseUrl = 'https://api.viator.com/partner';
    this.apiKey = apiKey;
  }

  private async enqueueRequest<T>(operation: () => Promise<T>): Promise<T> {
    // Wait for previous request to complete
    await this.requestQueue;

    // Calculate delay based on consecutive errors
    const baseDelay = this.minRequestInterval;
    const errorBackoff = Math.min(Math.pow(2, this.consecutiveErrors) * baseDelay, 30000);
    const delay = Math.max(baseDelay, errorBackoff);

    // Ensure minimum time between requests
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < delay) {
      await new Promise(resolve => setTimeout(resolve, delay - timeSinceLastRequest));
    }

    // Wait if too many concurrent requests
    while (this.activeRequests >= this.maxConcurrentRequests) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.activeRequests++;

    try {
      // Execute the request
      const result = await operation();
      this.lastRequestTime = Date.now();
      this.consecutiveErrors = 0; // Reset on success
      return result;
    } catch (error: any) {
      this.consecutiveErrors++; // Increment on error
      throw error;
    } finally {
      this.activeRequests--;
    }
  }

  private async retryWithBackoff<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.enqueueRequest(operation);
      } catch (error: any) {
        lastError = error;
        
        if (error.response?.status === 429) {
          // Get retry-after header or use exponential backoff
          const retryAfter = parseInt(error.response.headers['retry-after']) * 1000 || 
            Math.min(Math.pow(2, attempt) * this.minRequestInterval, 30000);
          
          if (attempt === this.maxRetries) {
            logger.error('[Viator] Max retries reached:', {
              attempt,
              error: error.message,
              status: error.response?.status,
              retryAfter
            });
            throw error;
          }

          logger.warn('[Viator] Rate limit hit, retrying:', {
            attempt: attempt + 1,
            delay: retryAfter,
            error: error.message
          });

          await new Promise(resolve => setTimeout(resolve, retryAfter));
          continue;
        }

        // For server errors (5xx), use shorter delays
        if (error.response?.status >= 500 && error.response?.status < 600) {
          if (attempt === this.maxRetries) {
            throw error;
          }

          const serverErrorDelay = Math.min(Math.pow(2, attempt) * 1000, 5000);
          await new Promise(resolve => setTimeout(resolve, serverErrorDelay));
          continue;
        }

        // Don't retry for other types of errors
        throw error;
      }
    }

    throw lastError;
  }

  async searchActivity(searchTerm: string): Promise<any> {
    if (!searchTerm || searchTerm === 'undefined') {
      logger.warn('[Viator] Invalid search term:', { searchTerm });
      return [];
    }

    try {
      const response = await this.retryWithBackoff(() => 
        this.performSearch(searchTerm)
      );

      if (!response?.products?.results) {
        logger.warn('[Viator] No search results found for:', { searchTerm });
        return [];
      }

      return response.products.results;
    } catch (error: any) {
      logger.error('[Viator] Search failed:', {
        searchTerm,
        error: error.message,
        status: error.response?.status
      });
      throw error;
    }
  }

  private async performSearch(searchTerm: string): Promise<ViatorSearchResponse> {
    const searchRequest = {
      searchTerm,
      searchTypes: [{
        searchType: 'PRODUCTS',
        pagination: {
          offset: 0,
          limit: 20
        }
      }],
      currency: this.defaultCurrency,
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

    return response.data;
  }

  // Add new price normalization methods
  private normalizePrice(price: any): { amount: number; currency: string } {
    if (!price) {
      logger.warn('[Viator] No price provided, defaulting to 0 USD');
      return { amount: 0, currency: this.defaultCurrency };
    }

    // Handle different price formats
    const amount = price.summary?.fromPrice || price.amount || 0;
    const currency = price.currency || this.defaultCurrency;

    logger.info('[Viator] Price normalization:', {
      originalPrice: price,
      normalizedPrice: { amount, currency },
      timestamp: new Date().toISOString()
    });

    return { amount, currency };
  }

  private validateAndLogPrice(price: any, context: string, productCode: string) {
    const normalizedPrice = this.normalizePrice(price);

    logger.info('[Viator] Price validation:', {
      context,
      productCode,
      originalPrice: price,
      normalizedPrice,
      timestamp: new Date().toISOString()
    });

    return normalizedPrice;
  }

  async getProductDetails(productCode: string): Promise<any> {
    return this.retryWithBackoff(async () => {
      try {
        const response = await axios.get(
          `${this.baseUrl}/products/${productCode}`,
          {
            headers: {
              'Accept': 'application/json;version=2.0',
              'Accept-Language': 'en-US',
              'exp-api-key': this.apiKey,
              'Currency': this.defaultCurrency // Always request prices in USD
            }
          }
        );

        // Normalize and log pricing information
        if (response.data?.pricing) {
          const normalizedPrice = this.normalizePrice(response.data.pricing);
          response.data.pricing = {
            ...response.data.pricing,
            summary: {
              fromPrice: normalizedPrice.amount
            },
            currency: normalizedPrice.currency
          };

          logger.info('[Viator] Product pricing details:', {
            productCode,
            pricing: {
              original: response.data.pricing,
              normalized: normalizedPrice
            },
            timestamp: new Date().toISOString()
          });
        } else {
          logger.warn('[Viator] No pricing information found:', {
            productCode,
            timestamp: new Date().toISOString()
          });
        }

        return response.data;
      } catch (error) {
        const err = error as Error;
        logger.error('[Viator] Error fetching product details:', {
          productCode,
          error: err.message,
          timestamp: new Date().toISOString()
        });
        throw error;
      }
    });
  }

  async enrichActivityDetails(activity: any): Promise<any> {
    if (!activity?.name) {
      logger.warn('[Viator] Invalid activity for enrichment:', { activity });
      return this.getDefaultEnrichedActivity(activity);
    }

    try {
      // First try to find a matching activity by name and location
      const searchResults = await this.retryWithBackoff(() => 
        this.searchActivity(`${activity.name} ${activity.location || ''}`)
      );

      if (!searchResults || !searchResults.length) {
        logger.warn('[Viator] No matching activities found for:', {
          name: activity.name,
          location: activity.location
        });
        return this.getDefaultEnrichedActivity(activity);
      }

      // Find the best matching activity using similarity scoring
      const bestMatch = this.findBestMatch(activity, searchResults);

      if (!bestMatch) {
        logger.warn('[Viator] No suitable match found after similarity check:', {
          name: activity.name,
          location: activity.location
        });
        return this.getDefaultEnrichedActivity(activity);
      }

      try {
        // Get detailed product information with retries
        const productDetails = await this.retryWithBackoff(() => 
          this.getProductDetails(bestMatch.productCode)
        );

        // Normalize the price
        const price = this.normalizePrice(bestMatch.pricing?.summary?.fromPrice || activity.price);
        this.validateAndLogPrice(price, 'enrichment', bestMatch.productCode);

        // Map the enriched data to our activity format
        const enrichedActivity = {
          ...activity,
          enrichmentStatus: 'full',
          id: bestMatch.productCode,
          name: bestMatch.title || activity.name,
          description: bestMatch.description || activity.description,
          duration: bestMatch.duration?.fixedDurationInMinutes || activity.duration,
          price: price,
          rating: bestMatch.reviews?.combinedAverageRating || activity.rating || 4.0,
          numberOfReviews: bestMatch.reviews?.totalReviews || activity.numberOfReviews || 0,
          images: bestMatch.images?.map((img: any) => img.variants[0]?.url).filter(Boolean) || activity.images || [],
          bookingInfo: {
            productCode: bestMatch.productCode,
            cancellationPolicy: productDetails?.additionalInfo?.cancellationPolicy || 'Standard cancellation policy',
            instantConfirmation: true,
            mobileTicket: bestMatch.bookingInfo?.mobileTicketing || true,
            languages: bestMatch.bookingInfo?.languages || ['English'],
            minParticipants: bestMatch.bookingInfo?.minParticipants || 1,
            maxParticipants: bestMatch.bookingInfo?.maxParticipants || 99
          },
          location: {
            address: bestMatch.location?.address || activity.location,
            coordinates: productDetails?.location?.coordinates
          },
          category: this.determineCategory({
            name: bestMatch.title,
            description: bestMatch.description,
            productCode: bestMatch.productCode,
            price: price
          }),
          highlights: bestMatch.highlights || [],
          operatingHours: productDetails?.operatingHours || '',
          meetingPoint: productDetails?.meetingAndPickup?.meetingPoint ? {
            name: productDetails.meetingAndPickup.meetingPoint.name,
            address: productDetails.meetingAndPickup.meetingPoint.address,
            details: productDetails.meetingAndPickup.meetingPoint.googleMapsUrl || ''
          } : undefined,
          endPoint: productDetails?.meetingAndPickup?.endPoint ? {
            name: 'End Point',
            address: productDetails.meetingAndPickup.endPoint,
            details: ''
          } : undefined,
          referenceUrl: `https://www.viator.com/tours/${bestMatch.productCode}`
        };

        logger.info('[Viator] Successfully enriched activity:', {
          name: enrichedActivity.name,
          productCode: bestMatch.productCode,
          enrichmentStatus: enrichedActivity.enrichmentStatus
        });

        return enrichedActivity;
      } catch (error) {
        logger.error('[Viator] Error getting product details:', {
          productCode: bestMatch.productCode,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        // Return activity with basic enrichment on error
        return {
          ...activity,
          enrichmentStatus: 'error',
          id: bestMatch.productCode,
          name: bestMatch.title || activity.name,
          description: bestMatch.description || activity.description,
          duration: bestMatch.duration?.fixedDurationInMinutes || activity.duration,
          price: this.normalizePrice(bestMatch.pricing?.summary?.fromPrice || activity.price),
          rating: bestMatch.reviews?.combinedAverageRating || 4.0,
          numberOfReviews: bestMatch.reviews?.totalReviews || 0,
          images: bestMatch.images?.map((img: any) => img.variants[0]?.url).filter(Boolean) || activity.images || [],
          bookingInfo: {
            productCode: bestMatch.productCode,
            cancellationPolicy: 'Standard cancellation policy',
            instantConfirmation: true,
            mobileTicket: true,
            languages: ['English'],
            minParticipants: 1,
            maxParticipants: 99
          }
        };
      }
    } catch (error) {
      logger.error('[Viator] Error enriching activity:', {
        name: activity.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return this.getDefaultEnrichedActivity(activity);
    }
  }

  private getDefaultEnrichedActivity(activity: any): any {
    return {
      ...activity,
      enrichmentStatus: 'error',
      rating: 4.0,
      numberOfReviews: 0,
      images: activity.images || [],
      bookingInfo: {
        productCode: activity.bookingInfo?.productCode,
        cancellationPolicy: 'Standard cancellation policy',
        instantConfirmation: true,
        mobileTicket: true,
        languages: ['English'],
        minParticipants: 1,
        maxParticipants: 99
      }
    };
  }

  private findBestMatch(activity: any, searchResults: any[]): any {
    return searchResults.reduce((best: any, current: any) => {
      const currentSimilarity = this.calculateSimilarity(
        activity.name.toLowerCase(),
        current.title.toLowerCase()
      );
      const bestSimilarity = best ? this.calculateSimilarity(
        activity.name.toLowerCase(),
        best.title.toLowerCase()
      ) : 0;

      return currentSimilarity > bestSimilarity ? current : best;
    }, null);
  }

  private calculateSimilarity(str1: string, str2: string): number {
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

  private mapProductToActivity(product: any): Activity {
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
      category: product.categories?.[0]?.name 
        ? (VIATOR_CATEGORY_MAP[product.categories[0].name] || this.determineCategory({
            name: product.title,
            description: product.description,
            productCode: product.productCode
          }))
        : this.determineCategory({
            name: product.title,
            description: product.description,
            productCode: product.productCode
          }),
      location: {
        address: product.location?.address,
        coordinates: product.location?.coordinates ? {
          latitude: product.location.coordinates.latitude,
          longitude: product.location.coordinates.longitude
        } : undefined
      },
      rating: product.rating,
      numberOfReviews: product.reviewCount,
      images: product.images?.map((img: any) => {
        const preferredVariant = img.variants?.find((v: any) => v.width === 480 && v.height === 320);
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
      itinerary: product.itinerary?.map((day: any) => ({
        day: day.day,
        title: day.title,
        stops: day.stops?.map((stop: any) => ({
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

  private determineCategory(activity: CategoryDetermination): string {
    if (activity.name.includes('Skip the Line') || activity.name.includes('Fast Track')) {
      return 'Tickets & Passes';
    }
    const description = (activity.description + ' ' + activity.name).toLowerCase();
    return determineCategoryFromDescription(description);
  }

  private getPreferredTimeSlot(category: string): ActivityTimeSlot {
    const startTime = getPreferredTimeSlot(category) === 'morning' ? '09:00' :
                     getPreferredTimeSlot(category) === 'afternoon' ? '14:00' : '19:00';
    const endTime = getPreferredTimeSlot(category) === 'morning' ? '13:00' :
                   getPreferredTimeSlot(category) === 'afternoon' ? '18:00' : '23:00';
    
    return {
      startTime,
      endTime,
      duration: getTypicalDuration(category),
      category
    };
  }

  async getAvailabilitySchedule(productCode: string): Promise<ViatorAvailabilitySchedule> {
    return this.retryWithBackoff(async () => {
      try {
        const response = await axios.get(
          `${this.baseUrl}/availability/schedules/${productCode}`,
          {
            headers: {
              'Accept': 'application/json;version=2.0',
              'Accept-Language': 'en-US',
              'exp-api-key': this.apiKey
            }
          }
        );
        
        logger.info('Availability schedule response:', response.data);
        return response.data;
      } catch (error) {
        logger.error('Error fetching availability schedule:', error);
        throw error;
      }
    });
  }

  async checkRealTimeAvailability(productCode: string, date: string, travelers: number): Promise<any> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/availability/check`,
        {
          productCode,
          travelDate: date,
          paxMix: [{
            ageBand: 'ADULT',
            numberOfTravelers: travelers
          }]
        },
        {
          headers: {
            'Accept': 'application/json;version=2.0',
            'Accept-Language': 'en-US',
            'exp-api-key': this.apiKey
          }
        }
      );
      
      logger.info('Real-time availability response:', response.data);
      return response.data;
    } catch (error) {
      logger.error('Error checking real-time availability:', error);
      throw error;
    }
  }

  private determineTier(price: number): 'budget' | 'medium' | 'premium' {
    if (price <= 50) return 'budget';
    if (price <= 150) return 'medium';
    return 'premium';
  }
}

export const viatorClient = new ViatorService(process.env.VIATOR_API_KEY || ''); 