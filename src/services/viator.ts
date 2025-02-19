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

  constructor(apiKey: string) {
    this.baseUrl = 'https://api.viator.com/partner';
    this.apiKey = apiKey;
  }

  private async getDestinations(): Promise<any> {
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
    } catch (error) {
      logger.error('Error fetching destinations:', error);
      throw error;
    }
  }

  async getDestinationId(cityName: string): Promise<string> {
    try {
      const destinations = await this.getDestinations();
      const destination = destinations.find((dest: any) => 
        dest.name.toLowerCase() === cityName.toLowerCase()
      );

      if (!destination) {
        logger.error(`Destination not found: ${cityName}`);
        throw new Error(`Could not find destination ID for ${cityName}`);
      }

      logger.info(`Found destination ID for ${cityName}:`, destination.ref);
      return destination.ref;
    } catch (error) {
      logger.error('Error getting destination ID:', error);
      throw error;
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
  }

  async enrichActivityDetails(activity: any): Promise<any> {
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
        const productDetails = await this.getProductDetails(productCode);
        
        if (productDetails && productDetails.status === 'ACTIVE') {
          // Log initial price state
          logger.info('[Viator] Initial activity price:', {
            productCode,
            activityPrice: activity.price,
            timestamp: new Date().toISOString()
          });

          // Validate and normalize price information
          const enrichedPrice = this.validateAndLogPrice(
            productDetails.pricing,
            'Product Details',
            productCode
          );

          // Update activity with normalized price
          const enrichedActivity = {
            ...activity,
            price: enrichedPrice,
            bookingDetails: {
              ...activity.bookingDetails,
              pricing: {
                original: enrichedPrice,
                special: productDetails.pricing?.special
                  ? this.validateAndLogPrice(productDetails.pricing.special, 'Special Pricing', productCode)
                  : null
              }
            }
          };

          // Log final enriched price
          logger.info('[Viator] Enriched activity price:', {
            productCode,
            originalPrice: activity.price,
            enrichedPrice: enrichedActivity.price,
            specialPrice: enrichedActivity.bookingDetails.pricing.special,
            timestamp: new Date().toISOString()
          });

          return enrichedActivity;
        }

        logger.warn('[Viator] Product not active:', {
          productCode,
          status: productDetails?.status,
          timestamp: new Date().toISOString()
        });
        return activity;

      } catch (error) {
        const err = error as Error;
        logger.error('[Viator] Error enriching activity details:', {
          productCode,
          error: err.message,
          timestamp: new Date().toISOString()
        });
        return activity;
      }
    } catch (error) {
      const err = error as Error;
      logger.error('[Viator] Error in enrichActivityDetails:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
      return activity;
    }
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