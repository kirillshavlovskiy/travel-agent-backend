import axios from 'axios';
import { logger } from '../utils/logger';

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

interface EnrichedActivity extends Omit<ViatorProduct, 'location'> {
  location: ViatorLocationInfo;
  openingHours?: string;
  details?: ViatorProductDetails;
  itinerary?: ItineraryType;
  productDetails?: {
    productOptions?: ViatorProductOption[];
  };
  commentary?: string;
  itineraryHighlight?: string;
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

interface ViatorSearchResult {
  title: string;
  productCode: string;
  status: string;
  // Add other fields as needed
}

const ACTIVITY_CATEGORIES: ActivityCategory[] = [
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

export class ViatorService {
  private apiKey: string;
  private baseUrl: string;
  private cache: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string, ttl: number) => Promise<void>;
  };

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.viator.com/partner/products';
    // Initialize in-memory cache
    const cacheStore = new Map<string, { value: string; expiry: number }>();
    this.cache = {
      get: async (key: string) => {
        const item = cacheStore.get(key);
        if (!item) return null;
        if (Date.now() > item.expiry) {
          cacheStore.delete(key);
          return null;
        }
        return item.value;
      },
      set: async (key: string, value: string, ttl: number) => {
        cacheStore.set(key, {
          value,
          expiry: Date.now() + (ttl * 1000)
        });
      }
    };
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

  private async getProductDetails(productCode: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/products/${productCode}`,
        {
          headers: {
            'Accept': 'application/json;version=2.0',
            'Accept-Language': 'en-US',
            'exp-api-key': this.apiKey
          }
        }
      );

      logger.info('[Viator] Product details response:', response.data);
      return response.data;
    } catch (error) {
      logger.error('[Viator] Error fetching product details:', error);
      throw error;
    }
  }

  async enrichActivityDetails(activity: Activity): Promise<any> {
    try {
      // Extract product code from reference URL or activity data
      let productCode = activity.bookingInfo?.productCode;
      if (!productCode && activity.referenceUrl) {
        // Try different patterns to extract product code
        const patterns = [
          /\-([a-zA-Z0-9]+)(?:\?|$)/,  // Standard format
          /\/tours\/([a-zA-Z0-9]+)$/,   // Direct product URL
          /\/([a-zA-Z0-9]+)$/          // Fallback pattern
        ];
        
        for (const pattern of patterns) {
          const match = activity.referenceUrl.match(pattern);
          if (match?.[1]) {
            productCode = match[1];
            break;
          }
        }
      }

      logger.debug('[Viator] Enriching activity:', {
        name: activity.name,
        productCode,
        referenceUrl: activity.referenceUrl
      });

      // Try getting product details by code first
      if (productCode) {
        try {
          const productDetails = await this.getProductDetails(productCode);
          if (productDetails && productDetails.status === 'ACTIVE') {
            return productDetails;
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.warn('Failed to get product details by code, trying search fallback', {
            productCode,
            error: errorMessage
          });
        }
      }

      // Fallback to search by activity name
      try {
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30); // Look ahead 30 days

        const searchRequest = {
          text: activity.name,
          filtering: {
            destination: null // We don't have destinationId in this context
          },
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
          currency: "USD",
          pagination: {
            offset: 0,
            limit: 5
          },
          sorting: {
            sortBy: "RELEVANCE",
            sortOrder: "DESC"
          }
        };

        const searchResponse = await axios.post<{
          products: {
            results: ViatorSearchResult[];
          };
        }>(
          `${this.baseUrl}/v1/products/search`,
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

        if (!searchResponse.data?.products?.results?.length) {
          logger.warn('No search results found for activity:', activity.name);
          throw new Error('No search results found');
        }

        // Find the best matching result
        const results = searchResponse.data.products.results;
        const bestMatch = results.find((r: ViatorSearchResult) => 
          r.title.toLowerCase().includes(activity.name.toLowerCase()) ||
          activity.name.toLowerCase().includes(r.title.toLowerCase())
        ) || results[0];

        return this.mapProductToActivity(bestMatch);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to enrich activity details', {
          activityId: activity.id,
          error: errorMessage
        });
        throw error;
      }
    } catch (error: unknown) {
      logger.error('Error enriching activity details:', error);
      throw error;
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

  private getPreferredTimeSlot(category: string): ActivityTimeSlot {
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

  private async getProductReviews(productCode: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/products/${productCode}/reviews`,
        {
          headers: {
            'accept': 'application/json',
            'exp-api-key': this.apiKey
          }
        }
      );

      return {
        items: response.data.reviews || [],
        totalReviews: response.data.totalCount || 0,
        combinedAverageRating: response.data.averageRating || 0,
        reviewCountTotals: response.data.ratingCounts || []
      };
    } catch (error) {
      if (error instanceof Error) {
        logger.warn('Failed to fetch product reviews', {
          productCode,
          error: error.message
        });
      } else {
        logger.warn('Failed to fetch product reviews with unknown error', {
          productCode
        });
      }
      return null;
    }
  }
}

export const viatorClient = new ViatorService(process.env.VIATOR_API_KEY || ''); 