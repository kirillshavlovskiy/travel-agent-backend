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

          const locationInfo: ViatorLocationInfo = {
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
          let structuredItinerary: ItineraryType | undefined;

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
          const details: ViatorProductDetails = {
            overview: productDetails.description?.trim() || '',
            whatIncluded: {
              included: (productDetails.inclusions || [])
                .map((inc: ViatorInclusion) => inc.otherDescription?.trim())
                .filter((desc: string | undefined) => desc && desc.length > 0),
              excluded: (productDetails.exclusions || [])
                .map((exc: ViatorExclusion) => exc.otherDescription?.trim())
                .filter((desc: string | undefined) => desc && desc.length > 0)
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
              .map((item: ViatorItineraryItem, index: number) => {
                const location = item.pointOfInterestLocation?.location;
                const isPassBy = item.passByWithoutStopping;
                
                const stopData: WhatToExpectStop = {
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
              .filter((stop: WhatToExpectStop) => stop.description || stop.coordinates || stop.location !== `Stop ${stop.stopNumber}`),
            additionalInfo: {
              confirmation: productDetails.bookingConfirmationSettings?.confirmationType?.trim() || '',
              accessibility: (productDetails.additionalInfo || [])
                .map((info: ViatorAdditionalInfo) => info.description?.trim())
                .filter((desc: string | undefined) => desc && desc.length > 0),
              restrictions: productDetails.restrictions || [],
              maxTravelers: productDetails.bookingRequirements?.maxTravelersPerBooking || 0,
              cancellationPolicy: {
                description: productDetails.cancellationPolicy?.description?.trim() || '',
                refundEligibility: productDetails.cancellationPolicy?.refundEligibility || []
              }
            },
            reviews: productDetails.reviews ? {
              rating: productDetails.reviews.rating,
              totalReviews: productDetails.reviews.totalReviews,
              ratingBreakdown: productDetails.reviews.ratingBreakdown || [],
              featuredReviews: productDetails.reviews.featuredReviews || []
            } : undefined
          };

          // Map reviews to frontend format
          const reviews = productDetails.reviews ? {
            reviewCountTotals: {
              averageRating: productDetails.reviews.combinedAverageRating || 0,
              totalReviews: productDetails.reviews.totalReviews || 0,
              stats: productDetails.reviews.reviewCountTotals?.map((count: { rating: number; count: number }) => ({
                rating: count.rating,
                count: count.count,
                percentage: ((count.count / productDetails.reviews.totalReviews) * 100).toFixed(1)
              })) || [],
              sources: productDetails.reviews.sources?.map((source: { provider: string; totalCount: number }) => ({
                provider: source.provider,
                count: source.totalCount
              })) || []
            },
            items: productDetails.reviews.featuredReviews?.map((review: { 
              author: string; 
              date: string; 
              rating: number; 
              content: string;
              title?: string;
              helpful?: number;
            }) => ({
              author: review.author,
              date: review.date,
              rating: review.rating,
              text: review.content,
              title: review.title,
              helpful: review.helpful
            })) || []
          } : undefined;

          // Extract availability and pricing information
          const bookingInfo = {
            productCode,
            cancellationPolicy: productDetails.cancellationPolicy?.description || activity.bookingInfo?.cancellationPolicy || 'Standard cancellation policy',
            instantConfirmation: productDetails.bookingConfirmationSettings?.confirmationType === 'INSTANT',
            mobileTicket: productDetails.ticketInfo?.ticketTypes?.includes('MOBILE') || true,
            languages: productDetails.languageGuides?.map((lg: any) => lg.language) || ['English'],
            minParticipants: activity.bookingInfo?.minParticipants || 1,
            maxParticipants: activity.bookingInfo?.maxParticipants || 999,
            availability: availabilitySchedule ? {
              startTimes: availabilitySchedule.bookableItems?.[0]?.seasons?.[0]?.pricingRecords?.[0]?.timedEntries?.map(entry => entry.startTime) || [],
              daysAvailable: availabilitySchedule.bookableItems?.[0]?.seasons?.[0]?.pricingRecords?.[0]?.daysOfWeek || [],
              seasons: availabilitySchedule.bookableItems?.[0]?.seasons || []
            } : undefined
          };

          // Extract product options
          const productOptions = productDetails.productOptions?.map((option: ViatorProductOption) => ({
            productOptionCode: option.productOptionCode,
            description: option.description,
            title: option.title,
            languageGuides: option.languageGuides
          }));

          // Format location data
          const formatLocation = (locationData: any): string => {
            if (typeof locationData === 'string') return locationData;
            if (typeof locationData === 'object') {
              return locationData.address || 
                     (locationData.meetingPoints?.[0]?.address) ||
                     (locationData.startingLocations?.[0]?.address) ||
                     'Location details available upon booking';
            }
            return 'Location details available upon booking';
          };

          const enrichedActivity = {
            ...activity,
            location: formatLocation(activity.location),
            locationDetails: activity.location,
            openingHours: productDetails.itinerary?.routes?.[0]?.operatingSchedule || '',
            details,
            reviews,
            bookingInfo,
            itinerary: structuredItinerary,
            productDetails: {
              ...activity.productDetails,
              productOptions
            },
            commentary: activity.commentary || details.overview,
            itineraryHighlight: activity.itineraryHighlight || `Visit ${activity.name} ${details.whatToExpect?.[0]?.description || ''}`,
            scoringReason: activity.scoringReason,
            dayPlanningLogic: activity.dayPlanningLogic
          };

          return enrichedActivity;
        }
      } catch (error) {
        logger.error('[Viator] Error getting product details:', {
          productCode,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
      }

      throw new Error(`Failed to enrich activity details for product code: ${productCode}`);
    } catch (error) {
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