import axios from 'axios';
import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';
import { ACTIVITY_CATEGORIES, determineCategoryFromDescription, getPreferredTimeSlot, getTypicalDuration } from '../constants/categories.js';
import { Activity as ActivityType } from '../types/activity';

// Rename Activity interface to ViatorActivity to avoid conflict
interface Activity extends ActivityType {}

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

interface ViatorCoordinates {
  lat: number;
  lng: number;
  description?: string;
}

interface ViatorLocation {
  address?: string;
  meetingPoint?: string;
  coordinates?: ViatorCoordinates;
  description?: string;
}

interface ViatorProduct {
  productCode: string;
  title: string;
  description: string;
  productUrl?: string;
  destinations?: Array<{
    ref: string;
    name: string;
  }>;
  location?: ViatorLocation;
  duration?: {
    fixedDurationInMinutes: number;
  };
  pricing?: {
    summary: {
      fromPrice: number;
      priceType?: string;
      specialOffer?: boolean;
      retailPrice?: number;
    };
    currency: string;
  };
  reviews?: {
    combinedAverageRating: number;
    totalReviews: number;
  };
  bookingInfo?: {
    cancellationPolicy?: string;
    mobileTicketing?: boolean;
    languages?: string[];
    minParticipants?: number;
    maxParticipants?: number;
    operatingDays?: string[];
    operatingHours?: string[];
    seasonality?: string;
  };
  highlights?: string[];
  images?: Array<{
    variants: Array<{
      url: string;
      width?: number;
      height?: number;
    }>;
  }>;
  available?: boolean;
  confirmationType?: string;
  itinerary?: ViatorItinerary;
}

interface ViatorSchedule {
  date: string;
  timeSlots: Array<{
    start: string;
    isAvailable: boolean;
  }>;
}

interface ViatorLocationData {
  address?: string;
  meetingPoints?: Array<{
    address: string;
  }>;
  startingLocations?: Array<{
    address: string;
  }>;
  coordinates?: ViatorCoordinates;
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

interface EnrichedActivity extends Omit<ViatorProduct, 'location'> {
  location: {
    address: string;
    sources: string[];
  };
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
  enrichmentStatus?: 'success' | 'failed';
  enrichmentError?: string;
  enrichmentDuration?: number;
}

interface ViatorReviewBreakdown {
  stars: number;
  count: number;
}

interface ViatorLocation {
  ref: string;
  name?: string;
  address?: string;
  coordinates?: ViatorCoordinates;
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
  pointsOfInterest?: ViatorPointOfInterest[];
  activityInfo?: ViatorActivityInfo;
  foodMenus?: ViatorFoodMenu[];
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

interface ViatorAvailabilityResponse {
  available: boolean;
  pricing: {
    fromPrice: number;
    currency: string;
  };
  schedule: {
    openingHours: string[];
    availableTimeSlots: string[];
  };
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
      operatingHours: Array<{
        dayOfWeek: string;
        operatingHours: Array<{
          opensAt: string;
          closesAt: string;
        }>;
      }>;
    }>;
  }>;
  currency: string;
  summary: {
    fromPrice: number;
  };
  // Added fields for processed data
  extractedPricing?: {
    amount: number;
    currency: string;
    partnerNetPrice: number;
    bookingFee: number;
  };
  extractedOperatingHours?: Record<string, Array<{
    opensAt: string;
    closesAt: string;
  }>>;
  extractedUnavailableDates?: Array<{
    date: string;
    reason: string;
  }>;
  extractedDaysOfWeek?: string[];
  extractedTimeSlots?: string[];
}

// Update interface for activity availability
interface ActivityAvailability {
    isAvailable: boolean;
    verifiedTimeSlot?: "morning" | "afternoon" | "evening";
    availableTimeSlots: ("morning" | "afternoon" | "evening")[];
    exactStartTime?: string;
    exactStartTimes: string[];
    timesByCategory?: Record<"morning" | "afternoon" | "evening", string[]>;
    realTimeVerification: {
        verified: boolean;
        exactStartTimes: string[];
        lastChecked: string;
        reason?: string;
        pricing?: {
            fromPrice: number;
            currency: string;
        };
    };
    operatingHours?: string;
    bestTimeToVisit?: string;
    nextAvailableDate?: string;
    tripPeriodAvailability?: {
        availableDates: string[];
        availabilityByDate: Record<string, string[]>;
        operatingDays: string[];
        operatingHours: Record<string, string[]>;
  };
}

// Update the Activity interface
interface Activity {
  id?: string;
  name: string;
  description: string;
  duration: number;
  price: {
    amount: number;
    currency: string;
  };
  category: string;
  location: string;
  timeSlot: 'morning' | 'afternoon' | 'evening';
  dayNumber: number;
  selected?: boolean;
  tier?: 'budget' | 'medium' | 'premium';
  rating?: number;
  numberOfReviews?: number;
  highlights?: string[];
  date?: string;
  startTime?: string;
  bookingDetails?: {
    provider: string;
    productCode: string;
    referenceUrl: string;
    cancellationPolicy?: string;
    instantConfirmation?: boolean;
    mobileTicket?: boolean;
    languages?: string[];
    minParticipants?: number;
    maxParticipants?: number;
    pickupIncluded?: boolean;
    pickupLocation?: string;
    accessibility?: string;
    restrictions?: string[];
  };
  availability?: {
    isAvailable: boolean;
    availableTimeSlots: ('morning' | 'afternoon' | 'evening')[];
    exactStartTimes: string[];
    timesByCategory: {
      morning: string[];
      afternoon: string[];
      evening: string[];
    };
    realTimeVerification: {
      verified: boolean;
      exactStartTimes: string[];
      lastChecked: string;
      reason?: string;
      pricing?: {
        fromPrice: number;
        currency: string;
      };
    };
    operatingHours?: string;
    bestTimeToVisit?: string;
    nextAvailableDate?: string;
    tripPeriodAvailability?: {
      availableDates: string[];
      availabilityByDate: Record<string, string[]>;
      operatingDays: string[];
      operatingHours: Record<string, string[]>;
    };
  };
  locationDetails?: {
    coordinates?: ViatorCoordinates;
    address?: string;
  };
  enrichmentStatus?: 'success' | 'failed';
  enrichmentError?: string;
  enrichmentDuration?: number;
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

interface TimeSlot {
  start: string;
  end: string;
  isAvailable: boolean;
}

interface DayAvailability {
  date: string;
  timeSlots: {
    morning: TimeSlot[];
    afternoon: TimeSlot[];
    evening: TimeSlot[];
  };
}

interface TransportationDetails {
  fromPrevious?: {
    distance: string;
    duration: string;
    options: string[];
  };
  toNext?: {
    distance: string;
    duration: string;
    options: string[];
  };
}

interface ViatorOperatingHours {
  dayOfWeek: string;
  operatingHours: Array<{
    opensAt: string;
    closesAt: string;
  }>;
}

interface TimeSlotAvailability {
  isAvailable: boolean;
  operatingHours: ViatorOperatingHours | null;
  validTimeSlots: string[];
}

interface ViatorDestination {
  destinationId: string;
  name: string;
  parentDestination?: {
    name: string;
  };
  iata?: string;
}

interface ViatorItineraryItem {
  type: string;
  description: string;
  duration: {
    fixedDurationInMinutes?: number;
    variableDurationFromMinutes?: number;
    variableDurationToMinutes?: number;
  };
}

interface ViatorItineraryDay {
  dayNumber: number;
  activities: ViatorItineraryItem[];
}

interface ViatorItineraryRoute {
  name: string;
  stops: string[];
}

interface ViatorPointOfInterest {
  name: string;
  location: ViatorLocation;
}

interface ViatorActivityInfo {
  type: string;
  description: string;
  requirements?: string[];
}

interface ViatorFoodMenu {
  type: string;
  items: string[];
}

interface ViatorItinerary {
  itineraryItems: ViatorItineraryItem[];
  days: ViatorItineraryDay[];
  routes: ViatorItineraryRoute[];
  pointsOfInterest: ViatorPointOfInterest[];
  activityInfo: ViatorActivityInfo;
  foodMenus: ViatorFoodMenu[];
}

interface ViatorPricingDetail {
  ageBand: string;
  price: {
    original: {
      recommendedRetailPrice: number;
      partnerNetPrice: number;
      bookingFee: number;
    };
  };
}

interface ViatorTimeSlot {
  start: string;
  isAvailable: boolean;
}

interface ViatorOperatingHour {
  opensAt: string;
  closesAt: string;
}

interface ViatorTimeSlotEntry {
  startTime: string;
  unavailableDates?: Array<{
    date: string;
    reason: string;
  }>;
}

export class ViatorService {
  private apiKey: string;
  private baseUrl: string;
  private isInitialized: boolean = false;
  private destinationsCache: Map<string, ViatorDestination> = new Map();
  private lastCacheUpdate: number | null = null;
  // Add product code tracking
  private usedProductCodes: Map<string, string> = new Map(); // productCode -> activityName

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.VIATOR_API_KEY || '';
    this.baseUrl = 'https://api.viator.com/partner';
    
    if (!this.apiKey) {
      logger.error('[Viator] Failed to initialize: No API key provided');
      return;
    }

    logger.info('[Viator] Service initialized with API key', {
      keyLength: this.apiKey.length,
      baseUrl: this.baseUrl
    });
    
    this.isInitialized = true;
  }

  private ensureInitialized() {
    if (!this.isInitialized) {
      throw new Error('ViatorService not properly initialized');
    }
  }

  async getDestinations(): Promise<ViatorDestination[]> {
    this.ensureInitialized();

    try {
        // Check cache first with TTL validation (24 hours)
        const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        const now = Date.now();
        
        if (this.destinationsCache.size > 0 && this.lastCacheUpdate && (now - this.lastCacheUpdate) < CACHE_TTL) {
            logger.debug('[Viator] Returning cached destinations', {
                cacheSize: this.destinationsCache.size,
                cacheAge: Math.round((now - this.lastCacheUpdate) / 1000 / 60) + ' minutes',
                timestamp: new Date().toISOString()
            });
            return Array.from(this.destinationsCache.values());
        }

        // Implement retry logic
        const MAX_RETRIES = 3;
        let retryCount = 0;
        let destinations;

        while (retryCount < MAX_RETRIES) {
            try {
                const response = await fetch(`${this.baseUrl}/destinations`, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json',
                        'Accept-Version': '2.0',
                        'Content-Type': 'application/json',
                        'Accept-Language': 'en-US',
                        'exp-api-key': this.apiKey
                    }
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    logger.error('[Viator] API error response:', {
                        status: response.status,
                        statusText: response.statusText,
                        attempt: retryCount + 1,
                        headers: Object.fromEntries(response.headers.entries()),
                        body: errorText
                    });

                    if (response.status === 429) { // Rate limit
                        const waitTime = Math.pow(2, retryCount) * 1000;
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        retryCount++;
                        continue;
                    }

                    throw new Error(`Viator API error: ${response.status} - ${errorText}`);
                }

                const rawResponse = await response.text();
                
                try {
                    destinations = JSON.parse(rawResponse);
                    break; // Success, exit retry loop
                } catch (parseError) {
                    logger.error('[Viator] Failed to parse JSON response:', {
                        error: parseError instanceof Error ? parseError.message : 'Unknown error',
                        attempt: retryCount + 1,
                        rawResponse: rawResponse.slice(0, 200) + '...'
                    });
                    
                    if (retryCount === MAX_RETRIES - 1) {
                        throw new Error('Failed to parse destinations response after max retries');
                    }
                    
                    retryCount++;
                    continue;
                }
            } catch (fetchError) {
                logger.error('[Viator] Fetch error:', {
                    error: fetchError instanceof Error ? fetchError.message : 'Unknown error',
                    attempt: retryCount + 1
                });
                
                if (retryCount === MAX_RETRIES - 1) {
                    throw fetchError;
                }
                
                retryCount++;
                continue;
            }
        }

        // Extract destinations array from response
        const destinationsArray = Array.isArray(destinations) ? destinations :
                                Array.isArray(destinations?.data) ? destinations.data :
                                Array.isArray(destinations?.destinations) ? destinations.destinations : null;

        if (!destinationsArray || destinationsArray.length === 0) {
            logger.error('[Viator] No valid destinations array found in response:', {
                responseStructure: JSON.stringify(destinations).slice(0, 200) + '...'
            });
            throw new Error('No destinations found in response');
        }

        // Clear existing cache before updating
        this.destinationsCache.clear();
        this.lastCacheUpdate = Date.now();

        // Enhanced caching with multiple lookup strategies
        destinationsArray.forEach((destination: ViatorDestination) => {
            if (destination?.destinationId) {
                // Cache by ID
                this.destinationsCache.set(destination.destinationId.toString(), destination);
                
                // Cache by normalized name variations
                const names = [
                    destination.name,
                    destination.parentDestination?.name,
                    `${destination.name}, ${destination.parentDestination?.name}`,
                    destination.iata
                ].filter(Boolean);

                names.forEach(name => {
                    if (name) {
                        // Store exact match
                        this.destinationsCache.set(name.toLowerCase(), destination);
                        
                        // Store normalized version
                        const normalizedName = this.normalizeLocationName(name);
                        this.destinationsCache.set(normalizedName, destination);
                        
                        // Store without diacritics
                        const withoutDiacritics = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                        this.destinationsCache.set(withoutDiacritics.toLowerCase(), destination);
                        
                        // Store without articles (the, a, an)
                        const withoutArticles = name.replace(/^(the|a|an)\s+/i, '');
                        this.destinationsCache.set(withoutArticles.toLowerCase(), destination);
                    }
                });
            }
        });

        logger.info('[Viator] Retrieved and cached destinations:', {
            count: destinationsArray.length,
            cacheSize: this.destinationsCache.size,
            uniqueDestinations: new Set(destinationsArray.map(d => d.destinationId)).size,
            timestamp: new Date().toISOString(),
            sampleDestinations: destinationsArray.slice(0, 3).map(d => ({
                id: d.destinationId,
                name: d.name,
                parent: d.parentDestination?.name,
                iata: d.iata
            }))
        });

        return destinationsArray;
    } catch (error) {
        logger.error('[Viator] Error fetching destinations:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        
        // If cache exists but is expired, use it as fallback
        if (this.destinationsCache.size > 0) {
            logger.warn('[Viator] Using expired cache as fallback');
            return Array.from(this.destinationsCache.values());
        }
        
        throw error;
    }
  }

  private normalizeLocationName(name: string): string {
    if (!name) return '';
    // Remove special characters, convert to lowercase, and handle common variations
    return name.toLowerCase()
        .normalize('NFD')                // Normalize unicode characters
        .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
        .replace(/[^\w\s-]/g, '')        // Remove special characters except spaces and hyphens
        .replace(/\s+/g, '-')            // Replace spaces with hyphens
        .replace(/-+/g, '-')             // Replace multiple hyphens with single hyphen
        .replace(/^-|-$/g, '');          // Remove leading/trailing hyphens
  }

  async getDestinationId(cityName: string): Promise<string> {
    logger.info('[Viator] Starting destination lookup', {
        cityName,
        timestamp: new Date().toISOString(),
        stage: 'start'
    });
    
    try {
        // First check cache using normalized name
        const normalizedName = this.normalizeLocationName(cityName);
        const cachedDestination = this.destinationsCache.get(normalizedName);
        
        if (cachedDestination) {
            logger.info('[Viator] Found destination in cache', {
                cityName,
                destinationId: cachedDestination.destinationId,
                stage: 'cache_hit'
            });
            return cachedDestination.destinationId.toString();
        }

        // Extract airport code if present
        const airportCodeMatch = cityName.match(/\((.*?)\)/);
        const cityNameWithoutAirport = cityName.replace(/\s*\([^)]*\)/, '').trim();
        
        // If we have an airport code, check cache for it
        if (airportCodeMatch) {
            const airportCode = airportCodeMatch[1].toUpperCase();
            const cachedByIata = this.destinationsCache.get(airportCode);
            if (cachedByIata) {
                logger.info('[Viator] Found destination by IATA code in cache', {
                    cityName,
                    iata: airportCode,
                    destinationId: cachedByIata.destinationId,
                    stage: 'cache_hit_iata'
                });
                return cachedByIata.destinationId.toString();
            }
        }

        // Get fresh destinations if not in cache
        const destinations = await this.getDestinations();
        
        // Try exact match first
        const exactMatch = destinations.find(dest => 
            dest.name.toLowerCase() === cityNameWithoutAirport.toLowerCase() ||
            (dest.parentDestination?.name.toLowerCase() === cityNameWithoutAirport.toLowerCase()) ||
            (airportCodeMatch && dest.iata === airportCodeMatch[1].toUpperCase())
        );
        
        if (exactMatch) {
            logger.info('[Viator] Found exact destination match', {
                cityName,
                destinationId: exactMatch.destinationId,
                matchType: 'exact',
                timestamp: new Date().toISOString()
            });
            return exactMatch.destinationId.toString();
        }

        // If no exact match, try fuzzy matching
        let bestMatch = null;
        let bestScore = 0;
        
        for (const dest of destinations) {
            // Check main name
            const mainNameScore = this.stringSimilarity(cityNameWithoutAirport.toLowerCase(), dest.name.toLowerCase());
            if (mainNameScore > bestScore) {
                bestScore = mainNameScore;
                bestMatch = dest;
            }
            
            // Check parent destination name
            if (dest.parentDestination?.name) {
                const parentNameScore = this.stringSimilarity(cityNameWithoutAirport.toLowerCase(), dest.parentDestination.name.toLowerCase());
                if (parentNameScore > bestScore) {
                    bestScore = parentNameScore;
                    bestMatch = dest;
                }
            }
        }

        if (bestMatch && bestScore > 0.6) { // Lowered threshold from 0.8 to 0.6 to accept more fuzzy matches
            logger.info('[Viator] Found fuzzy destination match', {
                cityName,
                destinationId: bestMatch.destinationId,
                matchType: 'fuzzy',
                similarity: bestScore,
                matchedName: bestMatch.name,
                timestamp: new Date().toISOString()
            });
            return bestMatch.destinationId.toString();
        }

        logger.warn('[Viator] No destination match found', {
            cityName,
            searchedWithoutAirport: cityNameWithoutAirport,
            airportCode: airportCodeMatch?.[1],
            bestMatchScore: bestScore,
            bestMatchName: bestMatch?.name
        });
        
        throw new Error(`No matching destination found for: ${cityName}`);
    } catch (error) {
        logger.error('[Viator] Error in getDestinationId:', {
            cityName,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        throw error;
    }
  }

  // Helper function for string similarity
  private stringSimilarity(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(0));

    for (let i = 0; i <= len1; i++) matrix[0][i] = i;
    for (let j = 0; j <= len2; j++) matrix[j][0] = j;

    for (let j = 1; j <= len2; j++) {
        for (let i = 1; i <= len1; i++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[j][i] = Math.min(
                matrix[j][i - 1] + 1,
                matrix[j - 1][i] + 1,
                matrix[j - 1][i - 1] + cost
            );
        }
    }

    const maxLen = Math.max(len1, len2);
    return (maxLen - matrix[len2][len1]) / maxLen;
  }

  async searchActivity(
    query: string,
    destinationId?: string,
    startDate?: string,
    endDate?: string
  ): Promise<ViatorProduct[]> {
    this.ensureInitialized();
    try {
      logger.info('[Viator] Searching for activity:', {
        query,
        destinationId,
        startDate,
        endDate
      });

      const searchRequest = {
        text: query,
        filtering: {
          destination: destinationId
        },
        startDate: startDate || new Date().toISOString().split('T')[0],
        endDate: endDate || new Date(new Date(startDate || Date.now()).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        currency: 'USD',
        pagination: {
          offset: 0,
          limit: 20 // Increased from 10 to get more options
        },
        sorting: {
          sortBy: 'RELEVANCE',
          sortOrder: 'DESC'
        }
      };

      const response = await fetch(`${this.baseUrl}/products/search`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-Version': '2.0',
          'Content-Type': 'application/json',
          'Accept-Language': 'en-US',
          'exp-api-key': this.apiKey
        },
        body: JSON.stringify(searchRequest)
      });

      if (!response.ok) {
        throw new Error(`Viator API error: ${response.status}`);
      }

      const data = await response.json();
      const products = Array.isArray(data?.products) ? data.products :
                      Array.isArray(data?.data?.products?.items) ? data.data.products.items : [];

      // Filter out products with already used product codes
      const unusedProducts = products.filter(product => 
        !this.usedProductCodes.has(product.productCode)
      );

      logger.info('[Viator] Search results:', {
        query,
        totalResults: products.length,
        unusedResults: unusedProducts.length,
        usedProductCodes: Array.from(this.usedProductCodes.keys())
      });

      return unusedProducts;
    } catch (error) {
      logger.error('[Viator] Error searching for activity:', {
        query,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  private getTimeSlotCategory(time: string): 'morning' | 'afternoon' | 'evening' {
    const hour = parseInt(time.split(':')[0]);
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    return 'evening';
  }

  private findBestTimeForSlot(availableTimes: string[], desiredSlot: 'morning' | 'afternoon' | 'evening'): { time: string; adjustedSlot: 'morning' | 'afternoon' | 'evening' } {
    // Define time ranges for each slot
    const timeRanges = {
      morning: { start: 6, end: 12, midpoint: 9 },
      afternoon: { start: 12, end: 17, midpoint: 14.5 },
      evening: { start: 17, end: 24, midpoint: 20 }
    };

    // First try: Find times that exactly match the desired slot
    const slotTimes = availableTimes.filter(time => {
      const hour = parseInt(time.split(':')[0]);
      const range = timeRanges[desiredSlot];
      return hour >= range.start && hour < range.end;
    });

    if (slotTimes.length > 0) {
      // Sort by time and return earliest available in slot
      slotTimes.sort((a, b) => {
        const [hoursA, minutesA] = a.split(':').map(Number);
        const [hoursB, minutesB] = b.split(':').map(Number);
        return (hoursA * 60 + minutesA) - (hoursB * 60 + minutesB);
      });
      
      logger.info('[Viator] Found exact time slot match', {
        desiredSlot,
        availableTimes: slotTimes,
        selectedTime: slotTimes[0]
      });
      
      return { time: slotTimes[0], adjustedSlot: desiredSlot };
    }

    // If no times in desired slot, categorize all available times
    const timesBySlot = {
      morning: availableTimes.filter(time => {
        const hour = parseInt(time.split(':')[0]);
        return hour >= timeRanges.morning.start && hour < timeRanges.morning.end;
      }),
      afternoon: availableTimes.filter(time => {
        const hour = parseInt(time.split(':')[0]);
        return hour >= timeRanges.afternoon.start && hour < timeRanges.afternoon.end;
      }),
      evening: availableTimes.filter(time => {
        const hour = parseInt(time.split(':')[0]);
        return hour >= timeRanges.evening.start && hour < timeRanges.evening.end;
      })
    };

    // Define slot reassignment preferences
    const slotReassignment = {
      morning: ['afternoon', 'evening'],
      afternoon: ['evening', 'morning'],
      evening: ['afternoon', 'morning']
    };

    // Try reassignment based on preferences
    for (const alternativeSlot of slotReassignment[desiredSlot]) {
      if (timesBySlot[alternativeSlot].length > 0) {
        // Sort times within the alternative slot
        const sortedTimes = [...timesBySlot[alternativeSlot]].sort((a, b) => {
          const [hoursA, minutesA] = a.split(':').map(Number);
          const [hoursB, minutesB] = b.split(':').map(Number);
          return (hoursA * 60 + minutesA) - (hoursB * 60 + minutesB);
        });

        logger.info('[Viator] Reassigning to different time slot', {
          originalSlot: desiredSlot,
          newSlot: alternativeSlot,
          availableTimes: sortedTimes,
          selectedTime: sortedTimes[0]
        });

        return { 
          time: sortedTimes[0], 
          adjustedSlot: alternativeSlot as 'morning' | 'afternoon' | 'evening' 
        };
      }
    }

    // Last resort: Use any available time and determine its slot
    if (availableTimes.length > 0) {
      const firstTime = availableTimes[0];
      const hour = parseInt(firstTime.split(':')[0]);
      let finalSlot: 'morning' | 'afternoon' | 'evening';

      if (hour >= timeRanges.morning.start && hour < timeRanges.morning.end) {
        finalSlot = 'morning';
      } else if (hour >= timeRanges.afternoon.start && hour < timeRanges.afternoon.end) {
        finalSlot = 'afternoon';
      } else {
        finalSlot = 'evening';
      }

      logger.info('[Viator] Using fallback time with slot adjustment', {
        originalSlot: desiredSlot,
        finalSlot,
        selectedTime: firstTime
      });

      return { time: firstTime, adjustedSlot: finalSlot };
    }

    // If no times available at all, return null
    return { time: null, adjustedSlot: desiredSlot };
  }

  async getAvailabilitySchedule(productCode: string): Promise<ViatorAvailabilitySchedule> {
    this.ensureInitialized();
    
    logger.debug('[Viator] Starting availability schedule check', {
      productCode,
      timestamp: new Date().toISOString(),
      stage: 'start'
    });

    try {
      const url = `${this.baseUrl}/availability/schedules/${productCode}`;
      const headers = {
        'Accept': 'application/json;version=2.0',
        'Content-Type': 'application/json',
        'Accept-Language': 'en-US',
        'exp-api-key': this.apiKey
      };

      logger.debug('[Viator] Making API request', {
        url,
        timestamp: new Date().toISOString(),
        stage: 'request',
        headers: {
          ...headers,
          'exp-api-key': '***hidden***'
        }
      });

      const response = await axios.get(url, { headers });

      // Log raw response immediately
      logger.debug('[Viator] Raw API response received', {
        productCode,
        status: response.status,
        timestamp: new Date().toISOString(),
        stage: 'response_received',
        headers: response.headers,
        dataSize: JSON.stringify(response.data).length
      });

      // Direct console log for debugging
      console.log('\n==== VIATOR RAW AVAILABILITY SCHEDULE RESPONSE ====');
      console.log('Product Code:', productCode);
      console.log('Status:', response.status);
      console.log('Response Headers:', JSON.stringify(response.headers, null, 2));
      console.log('Raw Response Data:', JSON.stringify(response.data, null, 2));

      // Extract and log pricing information
      const initialAdultPricing = response.data?.bookableItems?.[0]?.seasons?.[0]?.pricingRecords?.[0]?.pricingDetails?.find(
        (detail: any) => detail.ageBand === 'ADULT'
      );

      logger.info('[Viator] Extracted pricing details:', {
        productCode,
        timestamp: new Date().toISOString(),
        stage: 'pricing_extraction',
        pricing: {
          recommendedRetailPrice: initialAdultPricing?.price?.original?.recommendedRetailPrice,
          partnerNetPrice: initialAdultPricing?.price?.original?.partnerNetPrice,
          currency: response.data?.currency,
          pricingPackageType: initialAdultPricing?.pricingPackageType,
          ageBand: initialAdultPricing?.ageBand
        }
      });

      // Log availability details
      const availabilityDetails = response.data?.bookableItems?.[0]?.seasons?.[0]?.pricingRecords?.[0]?.timedEntries?.map((entry: any) => ({
        startTime: entry.startTime,
        unavailableDates: entry.unavailableDates
      }));

      logger.info('[Viator] Extracted availability details:', {
        productCode,
        timestamp: new Date().toISOString(),
        stage: 'availability_extraction',
        availability: {
          hasTimedEntries: !!availabilityDetails?.length,
          entries: availabilityDetails,
          operatingHours: response.data?.bookableItems?.[0]?.seasons?.[0]?.operatingHours
        }
      });

      if (!response.data || !response.data.bookableItems?.[0]) {
        logger.error('[Viator] Empty or invalid availability response', {
          productCode,
          timestamp: new Date().toISOString(),
          stage: 'validation_failed',
          response: response.data
        });
        throw new Error('Invalid availability response');
      }

      const bookableItem = response.data.bookableItems[0];
      const season = bookableItem.seasons?.[0];
      
      if (!season || !season.pricingRecords?.[0]) {
        logger.error('[Viator] No valid season or pricing records', {
          productCode,
          timestamp: new Date().toISOString(),
          stage: 'season_validation_failed',
          hasSeasons: !!bookableItem.seasons,
          seasonCount: bookableItem.seasons?.length,
          hasPricingRecords: !!season?.pricingRecords
        });
        throw new Error('No valid season data found');
      }

      const pricingRecord = season.pricingRecords[0];

      // Get adult pricing
      const adultPricing = pricingRecord.pricingDetails?.find(
        (detail: any) => detail.ageBand === 'ADULT'
      );

      // Log pricing information
      logger.debug(productCode, {
        stage: 'pricing_details',
        adultPrice: adultPricing?.price?.original?.recommendedRetailPrice,
        currency: response.data.currency,
        partnerNetPrice: adultPricing?.price?.original?.partnerNetPrice,
        bookingFee: adultPricing?.price?.original?.bookingFee
      });

      // Extract operating hours
      const operatingHours: Record<string, Array<{opensAt: string; closesAt: string}>> = {};
      if (season.operatingHours) {
        season.operatingHours.forEach((day: { dayOfWeek: string; operatingHours?: ViatorOperatingHour[] }) => {
          if (day.operatingHours && day.operatingHours.length > 0) {
            operatingHours[day.dayOfWeek] = day.operatingHours.map((hour: ViatorOperatingHour) => ({
              opensAt: hour.opensAt,
              closesAt: hour.closesAt
            }));
          }
        });
      }

      // Log operating hours
      logger.debug(productCode, {
        stage: 'operating_hours',
        operatingHours,
        daysWithHours: Object.keys(operatingHours)
      });

      // Extract time slots and their unavailable dates with more detailed logging
      const timeSlots = pricingRecord.timedEntries?.map((entry: ViatorTimeSlotEntry) => {
        logger.debug(productCode, {
          stage: 'time_slot_processing',
          startTime: entry.startTime,
          unavailableDatesCount: entry.unavailableDates?.length || 0,
          category: this.getTimeSlotCategory(entry.startTime),
          unavailableDates: entry.unavailableDates
        });
        return entry;
      }) || [];

      // Log time slots summary with categorization
      logger.debug(productCode, {
        stage: 'time_slots_summary',
        totalSlots: timeSlots.length,
        slots: timeSlots.map((slot: ViatorTimeSlotEntry) => ({
          time: slot.startTime,
          category: this.getTimeSlotCategory(slot.startTime),
          unavailableDates: slot.unavailableDates?.length || 0
        })),
        categoryCounts: {
          morning: timeSlots.filter((slot: ViatorTimeSlotEntry) => this.getTimeSlotCategory(slot.startTime) === 'morning').length,
          afternoon: timeSlots.filter((slot: ViatorTimeSlotEntry) => this.getTimeSlotCategory(slot.startTime) === 'afternoon').length,
          evening: timeSlots.filter((slot: ViatorTimeSlotEntry) => this.getTimeSlotCategory(slot.startTime) === 'evening').length
        }
      });

      // Consolidate unavailable dates across all time slots
      const unavailableDatesMap = new Map<string, string>();
      timeSlots.forEach((slot: ViatorTimeSlotEntry) => {
        slot.unavailableDates?.forEach((ud: { date: string; reason: string }) => {
          unavailableDatesMap.set(ud.date, ud.reason);
        });
      });

      const unavailableDates = Array.from(unavailableDatesMap.entries()).map(([date, reason]) => ({
        date,
        reason
      }));

      // Log unavailable dates
      logger.debug(productCode, {
        stage: 'unavailable_dates',
        unavailableDatesCount: unavailableDates.length,
        unavailableDates
      });

      const processedResponse: ViatorAvailabilitySchedule = {
        ...response.data,
        extractedPricing: {
          amount: adultPricing?.price?.original?.recommendedRetailPrice || 0,
          currency: response.data.currency || 'USD',
          partnerNetPrice: adultPricing?.price?.original?.partnerNetPrice || 0,
          bookingFee: adultPricing?.price?.original?.bookingFee || 0
        },
        extractedOperatingHours: operatingHours,
        extractedUnavailableDates: unavailableDates,
        extractedDaysOfWeek: pricingRecord.daysOfWeek || [],
        extractedTimeSlots: timeSlots.map((slot) => slot.startTime)
      };

      // Log final processed response
      logger.debug(productCode, {
        stage: 'final_response',
        pricing: processedResponse.extractedPricing,
        operatingHours: Object.keys(processedResponse.extractedOperatingHours || {}),
        operatingDays: processedResponse.extractedDaysOfWeek,
        timeSlots: processedResponse.extractedTimeSlots,
        unavailableDatesCount: processedResponse.extractedUnavailableDates?.length || 0,
        source: 'api',
        bookableItems: response.data.bookableItems?.length || 0
      });

      return processedResponse;

    } catch (error) {
      logger.error('[Viator] Error getting availability schedule:', {
        productCode,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        stage: 'error'
      });
      throw error;
    }
  }

  async getProductDetails(productCode: string): Promise<ViatorProduct> {
    this.ensureInitialized();
    try {
      const response = await fetch(`${this.baseUrl}/products/${productCode}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json;version=2.0',
          'Content-Type': 'application/json',
          'Accept-Language': 'en-US',
          'exp-api-key': this.apiKey
        }
      });

      if (!response.ok) {
        throw new Error(`Viator API error: ${response.status}`);
      }

      const data = await response.json();
      
      logger.info('[Viator] Product details response:', {
        productCode,
        hasData: !!data,
        hasItinerary: !!data?.itinerary,
        hasReviews: !!data?.reviews,
        hasBookingInfo: !!data?.bookingInfo
      });
      
      return data;
    } catch (error) {
      logger.error('[Viator API] Error getting product details:', {
        productCode,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private formatProductResponse(product: ViatorProduct): Activity {
    if (!product.productCode) {
      logger.warn('[Viator] Product missing product code:', {
        title: product.title
      });
      return {
        name: product.title || 'Unknown Activity',
        description: product.description || '',
        duration: 0,
        price: {
          amount: 0,
          currency: 'USD'
        },
        category: 'Unknown',
        location: '',
        timeSlot: 'morning',
        dayNumber: 0,
        enrichmentStatus: 'failed' as const,
        enrichmentError: 'No product code available'
      };
    }

        const ratingStr = product.reviews?.combinedAverageRating 
          ? `★ ${product.reviews.combinedAverageRating.toFixed(1)} (${product.reviews.totalReviews} reviews)` 
          : '';

    const locationSources = this.extractLocation(product);
    const bookingUrl = this.constructBookingUrl(product);
    const availability = this.extractAvailability(product);

        return {
          name: product.title,
          description: product.description + (ratingStr ? `\n\n${ratingStr}` : ''),
      duration: product.duration?.fixedDurationInMinutes || 0,
          price: {
        amount: product.pricing?.summary?.fromPrice || 0,
        currency: product.pricing?.currency || 'USD'
          },
          rating: product.reviews?.combinedAverageRating,
          numberOfReviews: product.reviews?.totalReviews,
          highlights: product.highlights || [],
      location: locationSources[0] || '',
      timeSlot: 'morning',
      dayNumber: 0,
      category: this.determineCategory({
        name: product.title,
        description: product.description,
        productCode: product.productCode,
        price: {
          amount: product.pricing?.summary?.fromPrice || 0,
          currency: product.pricing?.currency || 'USD'
        }
      }),
      bookingDetails: {
        provider: 'Viator',
        productCode: product.productCode,
        referenceUrl: bookingUrl,
        cancellationPolicy: product.bookingInfo?.cancellationPolicy || 'Standard cancellation policy',
        instantConfirmation: product.confirmationType === 'INSTANT',
        mobileTicket: product.bookingInfo?.mobileTicketing || true,
        languages: product.bookingInfo?.languages || ['English'],
        minParticipants: product.bookingInfo?.minParticipants || 1,
        maxParticipants: product.bookingInfo?.maxParticipants
      },
      availability,
      enrichmentStatus: 'success' as const,
      enrichmentDuration: 0,
      enrichmentError: undefined
    };
  }

  private extractLocation(product: ViatorProduct): string[] {
    const locationSources = [
      product.location?.address,
      product.location?.meetingPoint,
      product.location?.coordinates?.description,
      product.destinations?.[0]?.name,
      product.location?.description,
      product.title,
      product.description
    ].filter(Boolean).map((loc: string) => loc.toLowerCase());

    const descriptionLocations = product.description?.match(/\b(?:in|at|near|around)\s+([A-Z][a-zA-Z\s]+(?:,\s*[A-Z][a-zA-Z\s]+)*)/g) || [];
    
    return [...new Set([
      ...locationSources, 
      ...descriptionLocations.map((loc: string) => loc.replace(/^(?:in|at|near|around)\s+/, ''))
    ])];
  }

  private constructBookingUrl(product: ViatorProduct): string {
    // Use the direct product URL if available
    if (product.productUrl) {
      return product.productUrl;
    }

    // Construct URL from destination and product info if available
    if (product.destinations?.[0]?.ref) {
      const destinationName = product.destinations[0].name.split(',')[0];
      const titleSlug = product.title.replace(/[^a-zA-Z0-9]+/g, '-');
      return `https://www.viator.com/tours/${destinationName}/${titleSlug}/d${product.destinations[0].ref}-${product.productCode}`;
    }

    // Fallback to basic product URL
    return `https://www.viator.com/tours/${product.productCode}`;
  }

  private extractAvailability(product: ViatorProduct): ActivityAvailability {
    // Return proper ActivityAvailability structure with real-time data
    return {
      isAvailable: product.available !== false,
      availableTimeSlots: ['morning', 'afternoon', 'evening'], // Default to all slots
      exactStartTimes: [], // Will be populated by real-time checks
      timesByCategory: {
        morning: [],
        afternoon: [],
        evening: []
      },
      realTimeVerification: {
        verified: false, // Will be updated by real-time checks
        exactStartTimes: [],
        lastChecked: new Date().toISOString(),
        reason: 'Initial availability check - real-time verification pending'
      },
      operatingHours: product.bookingInfo?.operatingHours?.join(', '),
      bestTimeToVisit: product.bookingInfo?.seasonality,
      tripPeriodAvailability: {
        availableDates: [],
        availabilityByDate: {},
      operatingDays: product.bookingInfo?.operatingDays || [],
        operatingHours: {}
      }
    };
  }

  private extractImages(product: ViatorProduct): string[] {
    return (product.images || [])
      .filter((img): img is { variants: ViatorImageVariant[] } => !!img)
      .map(img => {
        const variants = img.variants || [];
        const preferredVariant = variants.find(v => v.width === 480 && v.height === 320);
        return preferredVariant?.url || variants[0]?.url || '';
      })
      .filter(url => !!url);
  }

  private formatLocation(locationData: ViatorLocationData): {
    formattedAddress: string;
    details: ViatorLocationData;
  } {
    if (typeof locationData === 'string') {
      return {
        formattedAddress: locationData,
        details: { address: locationData }
      };
    }
    
    if (typeof locationData === 'object') {
      const formattedAddress = locationData.address || 
        (locationData.meetingPoints?.[0]?.address) ||
        (locationData.startingLocations?.[0]?.address) ||
        'Location details available upon booking';

      return {
        formattedAddress,
        details: {
          address: formattedAddress,
          meetingPoints: locationData.meetingPoints || [],
          startingLocations: locationData.startingLocations || [],
          coordinates: locationData.coordinates
        }
      };
    }

    return {
      formattedAddress: 'Location details available upon booking',
      details: {}
    };
  }

  private async validateAndAdjustTimeSlot(
    activity: Activity,
    availabilitySchedule: ViatorSchedule[],
    preferredTimeSlot: string
  ): Promise<{
    isAvailable: boolean;
    recommendedTimeSlot: string;
    availableTimeSlots: string[];
    exactTime?: string;
  }> {
    try {
      const date = activity.date || new Date().toISOString().split('T')[0];
      const daySchedule = availabilitySchedule.find((schedule: any) => 
        schedule.date === date
      );

      if (!daySchedule) {
        return {
          isAvailable: false,
          recommendedTimeSlot: preferredTimeSlot,
          availableTimeSlots: []
        };
      }

      // Group available times by time slot category
      const availableSlots: Record<string, string[]> = {
        morning: [],
        afternoon: [],
        evening: []
      };

      daySchedule.timeSlots.forEach((slot: any) => {
        if (slot.isAvailable) {
          const category = this.getTimeSlotCategory(slot.start);
          availableSlots[category].push(slot.start);
        }
      });

      // Check if preferred time slot has availability
      if (availableSlots[preferredTimeSlot].length > 0) {
        return {
          isAvailable: true,
          recommendedTimeSlot: preferredTimeSlot,
          availableTimeSlots: Object.keys(availableSlots).filter(slot => availableSlots[slot].length > 0),
          exactTime: availableSlots[preferredTimeSlot][0]
        };
      }

      // Find alternative time slot
      const alternativeSlot = Object.keys(availableSlots)
        .find(slot => availableSlots[slot].length > 0);

      if (alternativeSlot) {
        return {
          isAvailable: true,
          recommendedTimeSlot: alternativeSlot,
          availableTimeSlots: Object.keys(availableSlots).filter(slot => availableSlots[slot].length > 0),
          exactTime: availableSlots[alternativeSlot][0]
        };
      }

      return {
        isAvailable: false,
        recommendedTimeSlot: preferredTimeSlot,
        availableTimeSlots: []
      };
    } catch (error) {
      logger.error('[Viator] Error validating time slot:', {
        activityName: activity.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        isAvailable: true, // Default to true to not block the process
        recommendedTimeSlot: preferredTimeSlot,
        availableTimeSlots: ['morning', 'afternoon', 'evening']
      };
    }
  }

  private async calculateTransportation(
    activity: Activity,
    previousActivity?: Activity,
    nextActivity?: Activity
  ): Promise<TransportationDetails> {
    const details: TransportationDetails = {};
    
    if (previousActivity?.locationDetails?.coordinates && activity.locationDetails?.coordinates) {
      details.fromPrevious = {
        distance: this.calculateDistance(
          previousActivity.locationDetails.coordinates,
          activity.locationDetails.coordinates
        ),
        duration: this.estimateTravelTime(
          previousActivity.locationDetails.coordinates,
          activity.locationDetails.coordinates
        ),
        options: this.getTransportationOptions(
          previousActivity.locationDetails.coordinates,
          activity.locationDetails.coordinates
        )
      };
    }

    if (nextActivity?.locationDetails?.coordinates && activity.locationDetails?.coordinates) {
      details.toNext = {
        distance: this.calculateDistance(
          activity.locationDetails.coordinates,
          nextActivity.locationDetails.coordinates
        ),
        duration: this.estimateTravelTime(
          activity.locationDetails.coordinates,
          nextActivity.locationDetails.coordinates
        ),
        options: this.getTransportationOptions(
          activity.locationDetails.coordinates,
          nextActivity.locationDetails.coordinates
        )
      };
    }

    return details;
  }

  private calculateDistance(from: ViatorCoordinates, to: ViatorCoordinates): string {
    // Simple haversine distance calculation
    const R = 6371; // Earth's radius in km
    const dLat = (to.lat - from.lat) * Math.PI / 180;
    const dLon = (to.lng - from.lng) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    
    return `${distance.toFixed(1)} km`;
  }

  private estimateTravelTime(from: ViatorCoordinates, to: ViatorCoordinates): string {
    const distance = this.calculateDistance(from, to);
    const km = parseFloat(distance);
    
    // Rough estimation: 
    // - Walking: 5 km/h
    // - Public transport: 20 km/h
    // - Car: 30 km/h (urban average)
    
    const walkingMinutes = Math.round((km / 5) * 60);
    const transitMinutes = Math.round((km / 20) * 60);
    const drivingMinutes = Math.round((km / 30) * 60);
    
    return `Walking: ${walkingMinutes} min, Transit: ${transitMinutes} min, Driving: ${drivingMinutes} min`;
  }

  private getTransportationOptions(from: ViatorCoordinates, to: ViatorCoordinates): string[] {
    const distance = parseFloat(this.calculateDistance(from, to));
    const options = [];
    
    if (distance <= 1) {
      options.push('Walking');
    }
    if (distance <= 5) {
      options.push('Bicycle');
    }
    options.push('Public Transport', 'Taxi/Ride-share');
    
    return options;
  }

  private extractProductCodeFromUrl(url: string | undefined): string | null {
    if (!url) return null;
    const match = url.match(/[A-Z0-9]+$/);
    return match ? match[0] : null;
  }

  async checkRealTimeAvailability(productCode: string, date: string): Promise<ViatorAvailabilityResponse | null> {
    try {
      logger.info('[Viator] Starting real-time availability check', {
        productCode,
        date,
        stage: 'start'
      });

      const response = await axios.post(
        `${this.baseUrl}/availability/check`,
        {
          productCode,
          travelDate: date,
          paxMix: [{
            ageBand: 'ADULT',
            numberOfTravelers: 1
          }]
        },
        {
          headers: {
            'Accept': 'application/json;version=2.0',  // Changed from 'Accept': 'application/json', 'Accept-Version': '2.0'
            'Content-Type': 'application/json',
            'Accept-Language': 'en-US',
            'exp-api-key': this.apiKey
          }
        }
      );

      logger.info('[Viator] Real-time availability response', {
        productCode,
        date,
        status: response.status,
        isAvailable: response.data?.status === 'AVAILABLE',
        stage: 'response'
      });

      return {
        available: response.data?.status === 'AVAILABLE',
        pricing: {
          fromPrice: response.data?.bookableItems?.[0]?.price?.amount || 0,
          currency: response.data?.bookableItems?.[0]?.price?.currency || 'USD'
        },
        schedule: {
          openingHours: response.data?.bookableItems?.[0]?.schedule?.operatingHours || [],
          availableTimeSlots: response.data?.bookableItems?.[0]?.schedule?.availableTimeSlots || []
        }
      };
    } catch (error) {
      logger.error('[Viator] Error checking real-time availability', {
        productCode,
        date,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        stage: 'error'
      });
      return null;
    }
  }

  async enrichActivityDetails(activity: Activity): Promise<any> {
    try {
      const startTime = Date.now();
      let productCode = activity.bookingDetails?.productCode || 
                       (activity as any).referenceUrl?.match(/\-([a-zA-Z0-9]+)(?:\\?|$)/)?.[1];
      
      logger.info('[Viator] Starting comprehensive activity enrichment', {
        name: activity.name,
        productCode,
        referenceUrl: (activity as any).referenceUrl,
        stage: 'start'
      });

      // 🎯 NEW: If no product code, try to find one by searching Viator
      if (!productCode) {
        logger.info('[Viator] No product code found, searching Viator for matching activity', {
          activityName: activity.name,
          stage: 'product_code_search'
        });
        
        productCode = await this.findProductCodeByName(activity.name);
        
        if (productCode) {
          logger.info('[Viator] Found product code via name search', {
            activityName: activity.name,
            foundProductCode: productCode,
            stage: 'product_code_found'
          });
        } else {
          logger.warn('[Viator] Could not find product code for activity', {
            activityName: activity.name,
            stage: 'product_code_not_found'
          });
          
          // Return basic enriched activity without Viator data
        return {
          ...activity,
            enrichmentStatus: 'failed',
            enrichmentError: 'No product code found',
            enrichmentDuration: Date.now() - startTime
          };
        }
      }

      // 🎯 COORDINATE EXTRACTION LOGGING - Track every step
      logger.info('[Viator] 🗺️ COORDINATE EXTRACTION START', {
        activityName: activity.name,
        productCode,
        stage: 'coordinate_extraction_start'
      });

      // Get product details
        const productDetails = await this.getProductDetails(productCode);
        
      // 🎯 LOG RAW PRODUCT DETAILS COORDINATES
      logger.info('[Viator] 🗺️ RAW PRODUCT DETAILS COORDINATES', {
        activityName: activity.name,
            productCode,
        productLocation: productDetails.location,
        productLocationCoordinates: productDetails.location?.coordinates,
        productDestinations: productDetails.destinations,
        stage: 'raw_product_coordinates'
      });

      // Get availability schedule
      const availabilitySchedule = await this.getAvailabilitySchedule(productCode);
      
      // 🎯 LOG AVAILABILITY SCHEDULE COORDINATES
      logger.info('[Viator] 🗺️ AVAILABILITY SCHEDULE COORDINATES', {
        activityName: activity.name,
            productCode,
        hasAvailabilitySchedule: !!availabilitySchedule,
        availabilityExtractedCoordinates: availabilitySchedule?.extractedPricing,
        stage: 'availability_coordinates'
      });

      // Make detailed product API call for enrichment
      const detailsResponse = await fetch(`${this.baseUrl}/products/${productCode}`, {
        method: 'GET',
        headers: {
          'exp-api-key': this.apiKey,
          'Accept-Language': 'en-US',
          'Accept': 'application/json;version=2.0'
        }
      });

      if (!detailsResponse.ok) {
        throw new Error(`Product details API error: ${detailsResponse.status}`);
      }

      const detailsData = await detailsResponse.json();
      
      // 🎯 LOG DETAILED API RESPONSE COORDINATES
      logger.info('[Viator] 🗺️ DETAILED API RESPONSE COORDINATES', {
        activityName: activity.name,
        productCode,
        detailsLocation: detailsData.location,
        detailsLocationCoordinates: detailsData.location?.coordinates,
        detailsDestinations: detailsData.destinations,
        detailsItinerary: detailsData.itinerary,
        detailsMeetingPoint: detailsData.meetingAndPickup?.meetingPoint,
        detailsMeetingPointCoordinates: detailsData.meetingAndPickup?.meetingPoint?.coordinates,
        stage: 'detailed_api_coordinates'
      });

      // Extract coordinates from various sources
      let extractedCoordinates = null;
      let coordinateSource = 'none';

      // 1. Try main location coordinates
      if (detailsData.location?.coordinates) {
        extractedCoordinates = {
          lat: detailsData.location.coordinates.lat || detailsData.location.coordinates.latitude,
          lng: detailsData.location.coordinates.lng || detailsData.location.coordinates.longitude
        };
        coordinateSource = 'main_location';
        
        logger.info('[Viator] 🗺️ EXTRACTED COORDINATES FROM MAIN LOCATION', {
          activityName: activity.name,
          productCode,
          extractedCoordinates,
          rawCoordinates: detailsData.location.coordinates,
          source: coordinateSource,
          stage: 'coordinates_extracted_main'
        });
      }

      // 2. Try meeting point coordinates
      if (!extractedCoordinates && detailsData.meetingAndPickup?.meetingPoint?.coordinates) {
        const meetingCoords = detailsData.meetingAndPickup.meetingPoint.coordinates;
        extractedCoordinates = {
          lat: meetingCoords.lat || meetingCoords.latitude,
          lng: meetingCoords.lng || meetingCoords.longitude
        };
        coordinateSource = 'meeting_point';
        
        logger.info('[Viator] 🗺️ EXTRACTED COORDINATES FROM MEETING POINT', {
          activityName: activity.name,
          productCode,
          extractedCoordinates,
          rawCoordinates: meetingCoords,
          source: coordinateSource,
          stage: 'coordinates_extracted_meeting'
        });
      }

      // 3. Try itinerary coordinates
      if (!extractedCoordinates && detailsData.itinerary) {
        // Check routes for hop-on-hop-off
        if (detailsData.itinerary.routes && detailsData.itinerary.routes.length > 0) {
          const firstRoute = detailsData.itinerary.routes[0];
          if (firstRoute.pointsOfInterest && firstRoute.pointsOfInterest.length > 0) {
            const firstPOI = firstRoute.pointsOfInterest[0];
            if (firstPOI.location?.coordinates) {
              extractedCoordinates = {
                lat: firstPOI.location.coordinates.lat || firstPOI.location.coordinates.latitude,
                lng: firstPOI.location.coordinates.lng || firstPOI.location.coordinates.longitude
              };
              coordinateSource = 'itinerary_poi';
              
              logger.info('[Viator] 🗺️ EXTRACTED COORDINATES FROM ITINERARY POI', {
                activityName: activity.name,
                productCode,
                extractedCoordinates,
                rawCoordinates: firstPOI.location.coordinates,
                source: coordinateSource,
                stage: 'coordinates_extracted_itinerary'
              });
            }
          }
        }
        
        // Check itinerary items
        if (!extractedCoordinates && detailsData.itinerary.itineraryItems && detailsData.itinerary.itineraryItems.length > 0) {
          const firstItem = detailsData.itinerary.itineraryItems[0];
          if (firstItem.pointOfInterestLocation?.location?.coordinates) {
            const itemCoords = firstItem.pointOfInterestLocation.location.coordinates;
            extractedCoordinates = {
              lat: itemCoords.lat || itemCoords.latitude,
              lng: itemCoords.lng || itemCoords.longitude
            };
            coordinateSource = 'itinerary_item';
            
            logger.info('[Viator] 🗺️ EXTRACTED COORDINATES FROM ITINERARY ITEM', {
              activityName: activity.name,
              productCode,
              extractedCoordinates,
              rawCoordinates: itemCoords,
              source: coordinateSource,
              stage: 'coordinates_extracted_item'
            });
          }
        }
      }

      // 4. Try destinations coordinates
      if (!extractedCoordinates && detailsData.destinations && detailsData.destinations.length > 0) {
        const firstDest = detailsData.destinations[0];
        if (firstDest.coordinates) {
          extractedCoordinates = {
            lat: firstDest.coordinates.lat || firstDest.coordinates.latitude,
            lng: firstDest.coordinates.lng || firstDest.coordinates.longitude
          };
          coordinateSource = 'destination';
          
          logger.info('[Viator] 🗺️ EXTRACTED COORDINATES FROM DESTINATION', {
            activityName: activity.name,
            productCode,
            extractedCoordinates,
            rawCoordinates: firstDest.coordinates,
            source: coordinateSource,
            stage: 'coordinates_extracted_destination'
          });
        }
      }

      // 🎯 NEW: 5. Try resolving location references from itinerary
      if (!extractedCoordinates && detailsData.itinerary) {
        logger.info('[Viator] 🗺️ ATTEMPTING LOCATION REFERENCE RESOLUTION', {
          activityName: activity.name,
          productCode,
          itineraryType: detailsData.itinerary.itineraryType,
          stage: 'location_reference_resolution'
        });
        
        const resolvedCoordinates = await this.extractCoordinatesFromItinerary(detailsData.itinerary);
        if (resolvedCoordinates) {
          extractedCoordinates = resolvedCoordinates;
          coordinateSource = 'resolved_location_reference';
          
          logger.info('[Viator] 🎯 EXTRACTED COORDINATES FROM RESOLVED LOCATION REFERENCE', {
            activityName: activity.name,
          productCode,
            extractedCoordinates,
            source: coordinateSource,
            stage: 'coordinates_extracted_resolved'
          });
        }
      }

      // 🎯 FINAL COORDINATE LOGGING
      if (extractedCoordinates) {
        logger.info('[Viator] 🎯 FINAL EXTRACTED COORDINATES SUCCESS', {
          activityName: activity.name,
          productCode,
          finalCoordinates: extractedCoordinates,
          coordinateSource,
          lat: extractedCoordinates.lat,
          lng: extractedCoordinates.lng,
          stage: 'coordinates_final_success'
        });
      } else {
        logger.warn('[Viator] ❌ NO COORDINATES EXTRACTED', {
          activityName: activity.name,
          productCode,
          checkedSources: ['main_location', 'meeting_point', 'itinerary_poi', 'itinerary_item', 'destination'],
          stage: 'coordinates_final_failure'
        });
      }

        // Extract location with coordinates
      const location = detailsData.location?.address || 
                  (typeof activity.location === 'object' ? activity.location.address : activity.location) || 
                  productDetails.location?.address || 
                      '';

        // Construct the enriched activity
      const enrichedActivity = {
        ...activity,
          name: productDetails.title || activity.name,
        description: detailsData.overview || productDetails.description || activity.description,
          location,
        // 🎯 CRITICAL: Set locationDetails with extracted coordinates
        locationDetails: extractedCoordinates ? {
          coordinates: extractedCoordinates,
          address: location,
          neighborhood: detailsData.neighborhood || undefined
        } : activity.locationDetails,
        price: {
          amount: productDetails.pricing?.summary?.fromPrice || activity.price?.amount || 0,
          currency: productDetails.pricing?.currency || activity.price?.currency || 'EUR'
        },
        rating: productDetails.reviews?.combinedAverageRating || activity.rating,
        numberOfReviews: productDetails.reviews?.totalReviews || activity.numberOfReviews,
        duration: productDetails.duration?.fixedDurationInMinutes ? 
          Math.round(productDetails.duration.fixedDurationInMinutes / 60) : 
          activity.duration,
        images: this.extractImages(productDetails),
        bookingDetails: {
          ...activity.bookingDetails,
          provider: 'viator',
          productCode,
          referenceUrl: this.constructBookingUrl(productDetails),
          cancellationPolicy: productDetails.bookingInfo?.cancellationPolicy,
          instantConfirmation: true,
          mobileTicket: productDetails.bookingInfo?.mobileTicketing || false,
          languages: productDetails.bookingInfo?.languages || [],
          minParticipants: productDetails.bookingInfo?.minParticipants,
          maxParticipants: productDetails.bookingInfo?.maxParticipants
        },
        availability: this.extractAvailability(productDetails),
        enrichmentStatus: 'success' as const,
        enrichmentDuration: Date.now() - startTime,
        // Include all enriched data for the frontend
        details: detailsData,
        highlights: productDetails.highlights || [],
        reviews: {
          totalReviews: productDetails.reviews?.totalReviews || 0,
          reviewCountTotals: productDetails.reviews ? {
            averageRating: productDetails.reviews.combinedAverageRating,
            totalReviews: productDetails.reviews.totalReviews,
            stats: [],
            sources: []
          } : undefined
        },
        itinerary: detailsData.itinerary,
        destinations: detailsData.destinations,
        bookingInfo: {
          availability: availabilitySchedule
        }
      };

      // 🎯 LOG FINAL ENRICHED ACTIVITY COORDINATES
      logger.info('[Viator] 🎯 FINAL ENRICHED ACTIVITY COORDINATES', {
        activityName: activity.name,
        productCode,
        enrichedLocationDetails: enrichedActivity.locationDetails,
        enrichedCoordinates: enrichedActivity.locationDetails?.coordinates,
        coordinateSource,
        hasCoordinates: !!(enrichedActivity.locationDetails?.coordinates),
        stage: 'enrichment_complete'
      });

        logger.info('[Viator] Successfully enriched activity with full details:', {
        name: enrichedActivity.name,
          productCode,
        stage: 'enrichment_complete',
        // DETAILED LOGGING OF ALL ENRICHED DATA FOR UI
        enrichedData: {
          // BASIC ACTIVITY INFO
          id: enrichedActivity.id,
          name: enrichedActivity.name,
          description: enrichedActivity.description,
          location: enrichedActivity.location,
          category: enrichedActivity.category,
          tier: enrichedActivity.tier,
          timeSlot: enrichedActivity.timeSlot,
          dayNumber: enrichedActivity.dayNumber,
          
          // LOCATION AND COORDINATES
          locationDetails: enrichedActivity.locationDetails,
          coordinates: enrichedActivity.locationDetails?.coordinates,
          hasCoordinates: !!(enrichedActivity.locationDetails?.coordinates),
          
          // PRICING
          price: enrichedActivity.price,
          
          // RATINGS AND REVIEWS
          rating: enrichedActivity.rating,
          numberOfReviews: enrichedActivity.numberOfReviews,
          reviews: enrichedActivity.reviews,
          
          // BOOKING INFO
          bookingDetails: enrichedActivity.bookingDetails,
          availability: enrichedActivity.availability,
          
          // ENRICHED CONTENT
          highlights: enrichedActivity.highlights,
          images: enrichedActivity.images?.length || 0,
          itinerary: enrichedActivity.itinerary ? {
            type: enrichedActivity.itinerary.itineraryType,
            hasItems: !!(enrichedActivity.itinerary.itineraryItems?.length),
            hasRoutes: !!(enrichedActivity.itinerary.routes?.length),
            hasPOIs: !!(enrichedActivity.itinerary.pointsOfInterest?.length)
          } : null,
          
          // ENRICHMENT STATUS
          enrichmentStatus: enrichedActivity.enrichmentStatus,
          enrichmentDuration: enrichedActivity.enrichmentDuration
        }
      });
      
      return enrichedActivity;

    } catch (error) {
      const duration = Date.now() - Date.now();
      logger.error('[Viator] Error enriching activity details:', {
        activityName: activity.name,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        duration,
        stage: 'error'
      });

        return {
          ...activity,
          enrichmentStatus: 'failed' as const,
        enrichmentError: error instanceof Error ? error.message : String(error),
        enrichmentDuration: duration
      };
    }
  }

  private determineTier(price: number): 'budget' | 'medium' | 'premium' {
    if (price <= 50) return 'budget';
    if (price <= 150) return 'medium';
    return 'premium';
  }

  async getAvailability(productCode: string, date: string): Promise<TimeSlotAvailability> {
    try {
      logger.info('[Viator] Checking availability:', {
        productCode,
        date,
        stage: 'start'
      });

      const response = await axios.get(
        `${this.baseUrl}/availability/schedules/${productCode}`,
        {
          headers: {
            'Accept': 'application/json',
            'Accept-Version': '2.0',
            'Content-Type': 'application/json',
            'exp-api-key': this.apiKey
          }
        }
      );

      // Log the raw API response
      logger.info('[Viator] Raw availability response:', {
        productCode,
        date,
        status: response.status,
        rawData: JSON.stringify(response.data),
        responseHeaders: response.headers,
        extractedPricing: response.data?.bookableItems?.[0]?.seasons?.[0]?.pricingRecords?.[0]?.pricingDetails?.find(
          (detail: any) => detail.ageBand === 'ADULT'
        )?.price?.original?.recommendedRetailPrice || 0,
        currency: response.data?.currency || 'USD',
        stage: 'raw_response'
      });

      // Process operating hours
      const operatingHours = response.data.bookableItems?.[0]?.seasons?.[0]?.operatingHours?.[0] || null;
      
      // Log operating hours
      logger.info('[Viator] Operating hours:', {
        productCode,
        date,
        operatingHours,
        stage: 'operating_hours'
      });

      // Process time slots
      const timeSlots = response.data.bookableItems?.[0]?.seasons?.[0]?.pricingRecords?.[0]?.timedEntries?.map((entry: { startTime: string }) => entry.startTime) || [];
      
      // Log time slots
      logger.info('[Viator] Available time slots:', {
        productCode,
        date,
        timeSlots,
        stage: 'time_slots'
      });

      // Check if the date is unavailable
      const unavailableDates = response.data.bookableItems?.[0]?.seasons?.[0]?.pricingRecords?.[0]?.unavailableDates || [];
      const isDateUnavailable = unavailableDates.some((ud: { date: string }) => ud.date === date);

      // Log availability status
      logger.info('[Viator] Availability status:', {
        productCode,
        date,
        isDateUnavailable,
        unavailableDates,
        stage: 'availability_status'
      });

      return {
        isAvailable: !isDateUnavailable && timeSlots.length > 0,
        operatingHours,
        validTimeSlots: timeSlots
      };

    } catch (error) {
      logger.error('[Viator] Error checking availability:', {
        productCode,
        date,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        stage: 'error'
      });
      throw error;
    }
  }

  public async validateTimeSlot(activity: Activity, date: string): Promise<ActivityAvailability> {
    this.ensureInitialized();
    try {
      logger.info('[Viator] Validating time slot', {
        activity: activity.name,
        productCode: activity.bookingDetails?.productCode,
        timeSlot: activity.timeSlot,
        date
      });

      // Get real-time availability
      const realTimeCheck = await this.checkRealTimeAvailability(
        activity.bookingDetails?.productCode || '',
        date
      );

      if (!realTimeCheck?.available) {
        logger.warn('[Viator] Activity not available for requested date', {
          activity: activity.name,
          date,
          reason: 'Real-time check failed'
        });

        return {
          isAvailable: false,
          availableTimeSlots: [],
          exactStartTimes: [],
          realTimeVerification: {
            verified: false,
            exactStartTimes: [],
            lastChecked: new Date().toISOString(),
            reason: 'Activity not available for requested date'
          }
        };
      }

      // Get all available times for the requested date
      const availableTimes = realTimeCheck.schedule.availableTimeSlots || [];
      
      // Categorize times into slots
      const timesByCategory = {
        morning: availableTimes.filter(time => time >= '06:00' && time < '12:00'),
        afternoon: availableTimes.filter(time => time >= '12:00' && time < '17:00'),
        evening: availableTimes.filter(time => time >= '17:00' && time <= '23:59')
      };

      // Get available categories that have times
      const availableCategories = Object.entries(timesByCategory)
        .filter(([_, times]) => times.length > 0)
        .map(([category]) => category);

      // Find best matching time slot
      const preferredTimeSlot = activity.timeSlot;
      const firstAvailableCategory = availableCategories[0];
      const exactTimes = timesByCategory[preferredTimeSlot as keyof typeof timesByCategory] || [];

      logger.info('[Viator] Available times by slot:', {
        preferredTimeSlot,
        availableCategories,
        selectedCategory: firstAvailableCategory,
        availableTimes: availableTimes.map(time => ({
          time,
          slot: this.getTimeSlotCategory(time)
        }))
      });

      return {
        isAvailable: exactTimes.length > 0,
        verifiedTimeSlot: preferredTimeSlot,
        availableTimeSlots: availableCategories as ('morning' | 'afternoon' | 'evening')[],
        exactStartTime: exactTimes[0],
        exactStartTimes: exactTimes,
        timesByCategory,
        realTimeVerification: {
          verified: true,
          exactStartTimes: availableTimes,
          lastChecked: new Date().toISOString(),
          pricing: realTimeCheck.pricing,
          reason: exactTimes.length > 0 ? 'Time slot verified with exact times' : 'No exact times available for requested slot'
        },
        operatingHours: realTimeCheck.schedule.openingHours?.join(', ')
      };

    } catch (error) {
      logger.error('[Viator] Error validating time slot', {
        activity: activity.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        isAvailable: false,
        availableTimeSlots: [],
        exactStartTimes: [],
        realTimeVerification: {
          verified: false,
          exactStartTimes: [],
          lastChecked: new Date().toISOString(),
          reason: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  private determineCategory(item: CategoryDetermination): string {
    const category = determineCategoryFromDescription(item.description);
    return category || 'Cultural & Historical';
  }

  private adultPricingFinder = (detail: ViatorPricingDetail) => detail.ageBand === 'ADULT';

  // Add method to reset product codes (call at the start of each new trip planning)
  public resetProductCodes() {
    this.usedProductCodes.clear();
    logger.info('[Viator] Reset product code tracking');
  }

  /**
   * Determines accessibility features for an activity
   */
  private determineAccessibility(productDetails: any): string {
    // Default to unknown if no product details
    if (!productDetails || !productDetails.additionalInfo) {
      return 'Information not available';
    }
    
    try {
      const { additionalInfo } = productDetails;
      
      // Check if accessibility information is directly provided
      if (additionalInfo.accessibility && additionalInfo.accessibility.length > 0) {
        return additionalInfo.accessibility.join(', ');
      }
      
      // Check overview text for accessibility mentions
      const accessibilityKeywords = [
        'wheelchair', 'accessible', 'mobility', 'disabled', 
        'elevator', 'lift', 'ramp', 'limited mobility'
      ];
      
      const overview = productDetails.overview || '';
      const matchedKeywords = accessibilityKeywords.filter(keyword => 
        overview.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (matchedKeywords.length > 0) {
        return `Possible accessibility features: ${matchedKeywords.join(', ')}`;
      }
      
      return 'Information not available';
    } catch (error) {
      logger.error('[Viator] Error determining accessibility:', error);
      return 'Information not available';
    }
  }
  
  /**
   * Extracts restrictions and requirements from product details
   */
  private extractRestrictions(productDetails: any): string[] {
    if (!productDetails || !productDetails.additionalInfo) {
      return [];
    }
    
    try {
      const { additionalInfo } = productDetails;
      
      if (additionalInfo.restrictions && additionalInfo.restrictions.length > 0) {
        return additionalInfo.restrictions;
      }
      
      return [];
    } catch (error) {
      logger.error('[Viator] Error extracting restrictions:', error);
      return [];
    }
  }
  
  /**
   * Filters activities based on accessibility and dietary requirements
   */
  public filterActivitiesByRequirements(
    activities: Activity[], 
    requirements: { 
      accessibility?: string[],
      dietaryRestrictions?: string[] 
    }
  ): Activity[] {
    // If no requirements, return all activities
    if (!requirements || 
       (!requirements.accessibility?.length && !requirements.dietaryRestrictions?.length)) {
      return activities;
    }
    
    return activities.filter(activity => {
      // Check accessibility requirements
      if (requirements.accessibility?.length && activity.bookingDetails?.accessibility) {
        const activityAccessibility = activity.bookingDetails.accessibility.toLowerCase();
        
        // Check if activity specifically mentions being NOT accessible
        const notAccessible = [
          'not wheelchair accessible',
          'not suitable for mobility impaired',
          'not recommended for travelers with mobility concerns'
        ].some(phrase => activityAccessibility.includes(phrase.toLowerCase()));
        
        if (notAccessible) {
          return false;
        }
        
        // For specific accessibility requirements
        if (requirements.accessibility.includes('wheelchair_accessible') && 
            !activityAccessibility.includes('wheelchair')) {
          // If wheelchair accessibility is required but not mentioned, filter out
          // unless it's a standard accessible venue like museum or theater
          if (!this.isLikelyAccessible(activity)) {
            return false;
          }
        }
      }
      
      // Check dietary restrictions for food activities
      if (requirements.dietaryRestrictions?.length && 
          (activity.category === 'Food & Dining' || 
           activity.category === 'Food & Wine' ||
           activity.name.toLowerCase().includes('food') ||
           activity.name.toLowerCase().includes('dinner') ||
           activity.name.toLowerCase().includes('lunch') ||
           activity.name.toLowerCase().includes('cuisine') ||
           activity.name.toLowerCase().includes('tasting'))) {
        
        // Look for mentions of dietary accommodations in description
        const description = activity.description?.toLowerCase() || '';
        
        // Default to allowing the activity unless it specifically mentions NOT accommodating
        let canAccommodate = true;
        
        for (const restriction of requirements.dietaryRestrictions) {
          const restrictionLower = restriction.toLowerCase();
          
          // Check for phrases indicating the restriction cannot be accommodated
          if (description.includes(`no ${restrictionLower} options`) ||
              description.includes(`not suitable for ${restrictionLower}`) ||
              description.includes(`cannot accommodate ${restrictionLower}`)) {
            canAccommodate = false;
            break;
          }
          
          // Check for phrases indicating the restriction can be accommodated
          if (description.includes(`${restrictionLower} options`) ||
              description.includes(`${restrictionLower} menu`) ||
              description.includes(`${restrictionLower} friendly`) ||
              description.includes(`accommodates ${restrictionLower}`)) {
            // Found positive indication, keep this as true
            canAccommodate = true;
          }
        }
        
        return canAccommodate;
      }
      
      return true;
    });
  }
  
  /**
   * Determines if an activity is likely to be accessible based on type/venue
   */
  private isLikelyAccessible(activity: Activity): boolean {
    const name = activity.name.toLowerCase();
    const category = activity.category.toLowerCase();
    const description = activity.description?.toLowerCase() || '';
    
    // Major museums and attractions are typically accessible
    const accessibleVenues = [
      'museum', 'gallery', 'louvre', 'palace', 'cathedral', 
      'theatre', 'theater', 'opera', 'cruise', 'boat'
    ];
    
    // Activities unlikely to be accessible
    const inaccessibleActivities = [
      'hiking', 'climbing', 'steps', 'stairs', 'walk up', 
      'steep', 'narrow', 'medieval'
    ];
    
    // Check if any accessible venue keywords are present
    const isAccessibleVenue = accessibleVenues.some(venue => 
      name.includes(venue) || category.includes(venue) || description.includes(venue)
    );
    
    // Check if any inaccessible activity keywords are present
    const isInaccessibleActivity = inaccessibleActivities.some(activity => 
      name.includes(activity) || description.includes(activity)
    );
    
    return isAccessibleVenue && !isInaccessibleActivity;
  }

  /**
   * 🎯 NEW METHOD: Search Viator for activities by name to find product codes
   * This helps AI-generated activities get real Viator product codes for enrichment
   */
  async findProductCodeByName(activityName: string): Promise<string | null> {
    try {
      // Extract key terms from activity name for better search
      const searchTerms = activityName
        .replace(/\b(visit|tour|experience|at|in|to|the|a|an)\b/gi, '')
        .trim()
        .split(/\s+/)
        .filter(term => term.length > 2)
        .slice(0, 3) // Take top 3 relevant terms
        .join(' ');

      logger.info('[Viator] Searching for product by name', {
        originalName: activityName,
        searchTerms,
        stage: 'name_search'
      });

      // Use the same format as the existing searchActivity method
      const searchRequest = {
        text: searchTerms,
        filtering: {
          // Don't filter by destination to get more results
        },
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        currency: 'USD',
        pagination: {
          offset: 0,
          limit: 10 // Get more results for better matching
        },
        sorting: {
          sortBy: 'RELEVANCE',
          sortOrder: 'DESC'
        }
      };

      const response = await fetch(`${this.baseUrl}/products/search`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-Version': '2.0',
          'Content-Type': 'application/json',
          'Accept-Language': 'en-US',
          'exp-api-key': this.apiKey
        },
        body: JSON.stringify(searchRequest)
      });

      if (!response.ok) {
        logger.error('[Viator] Product search failed', {
          status: response.status,
          searchTerms,
          stage: 'search_failed',
          searchRequest
        });
        return null;
      }

      const data = await response.json();
      const products = Array.isArray(data?.products) ? data.products :
                      Array.isArray(data?.data?.products?.items) ? data.data.products.items : [];

      logger.info('[Viator] Product search results', {
        searchTerms,
        foundProducts: products.length,
        stage: 'search_results'
      });

      if (products.length === 0) {
        return null;
      }

      // Find best matching product by comparing names
      const bestMatch = this.findBestNameMatch(activityName, products);
      
      if (bestMatch) {
        logger.info('[Viator] Found best matching product', {
          originalName: activityName,
          matchedProduct: bestMatch.title,
          productCode: bestMatch.productCode,
          stage: 'best_match_found'
        });
        return bestMatch.productCode;
      }

      return null;
    } catch (error) {
      logger.error('[Viator] Error searching for product by name', {
        activityName,
        error: error instanceof Error ? error.message : 'Unknown error',
        stage: 'search_error'
      });
      return null;
    }
  }

  /**
   * Find the best matching product by comparing activity names
   */
  private findBestNameMatch(activityName: string, products: any[]): any | null {
    const normalizeText = (text: string) => 
      text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const activityNormalized = normalizeText(activityName);
    const activityWords = activityNormalized.split(' ');

    let bestMatch = null;
    let bestScore = 0;

    for (const product of products) {
      const productTitle = normalizeText(product.title || '');
      const productWords = productTitle.split(' ');

      // Calculate word overlap score
      const commonWords = activityWords.filter(word => 
        productWords.some(pWord => pWord.includes(word) || word.includes(pWord))
      );
      
      const score = commonWords.length / Math.max(activityWords.length, productWords.length);

      if (score > bestScore && score > 0.3) { // Minimum 30% similarity
        bestScore = score;
        bestMatch = product;
      }
    }

    return bestMatch;
  }

  /**
   * 🎯 NEW METHOD: Resolve Viator location references to actual coordinates
   * Viator API returns location refs but no coordinates - we need to resolve them
   */
  async resolveLocationReference(locationRef: string): Promise<ViatorCoordinates | null> {
    try {
      logger.info('[Viator] Resolving location reference to coordinates', {
        locationRef,
        stage: 'location_resolution_start'
      });

      const response = await fetch(`${this.baseUrl}/locations/${encodeURIComponent(locationRef)}`, {
        method: 'GET',
        headers: {
          'exp-api-key': this.apiKey,
          'Accept-Language': 'en-US',
          'Accept': 'application/json;version=2.0'
        }
      });

      if (!response.ok) {
        logger.warn('[Viator] Failed to resolve location reference', {
          locationRef,
          status: response.status,
          statusText: response.statusText,
          stage: 'location_resolution_failed'
        });
        return null;
      }

      const locationData = await response.json();
      
      logger.info('[Viator] 🗺️ LOCATION RESOLUTION RESPONSE', {
        locationRef,
        locationData,
        hasCoordinates: !!(locationData.coordinates || locationData.location?.coordinates),
        coordinates: locationData.coordinates || locationData.location?.coordinates,
        stage: 'location_resolution_response'
      });

      // Extract coordinates from the location response
      const coords = locationData.coordinates || locationData.location?.coordinates;
      if (coords && (coords.lat || coords.latitude) && (coords.lng || coords.longitude)) {
        const extractedCoords = {
          lat: coords.lat || coords.latitude,
          lng: coords.lng || coords.longitude
        };
        
        logger.info('[Viator] 🎯 SUCCESSFULLY RESOLVED LOCATION COORDINATES', {
          locationRef,
          extractedCoords,
          stage: 'location_resolution_success'
        });
        
        return extractedCoords;
      }

      logger.warn('[Viator] Location reference resolved but no coordinates found', {
        locationRef,
        locationData,
        stage: 'location_resolution_no_coords'
      });
      
      return null;

    } catch (error) {
      logger.error('[Viator] Error resolving location reference', {
        locationRef,
        error: error instanceof Error ? error.message : String(error),
        stage: 'location_resolution_error'
      });
      return null;
    }
  }

  /**
   * 🎯 NEW METHOD: Extract coordinates from itinerary using location resolution
   */
  async extractCoordinatesFromItinerary(itinerary: any): Promise<ViatorCoordinates | null> {
    try {
      logger.info('[Viator] 🗺️ EXTRACTING COORDINATES FROM ITINERARY', {
        itineraryType: itinerary?.itineraryType,
        hasRoutes: !!(itinerary?.routes?.length),
        routesCount: itinerary?.routes?.length || 0,
        stage: 'itinerary_coordinate_extraction'
      });

      // For hop-on-hop-off tours, try to get coordinates from the first route's first stop
      if (itinerary?.routes && itinerary.routes.length > 0) {
        const firstRoute = itinerary.routes[0];
        
        logger.info('[Viator] Processing first route for coordinates', {
          routeName: firstRoute.name,
          hasStops: !!(firstRoute.stops?.length),
          stopsCount: firstRoute.stops?.length || 0,
          hasPOIs: !!(firstRoute.pointsOfInterest?.length),
          poisCount: firstRoute.pointsOfInterest?.length || 0,
          stage: 'route_processing'
        });

        // Try stops first
        if (firstRoute.stops && firstRoute.stops.length > 0) {
          for (const stop of firstRoute.stops.slice(0, 3)) { // Try first 3 stops
            if (stop.stopLocation?.ref) {
              logger.info('[Viator] Attempting to resolve stop location', {
                stopRef: stop.stopLocation.ref,
                stopDescription: stop.description,
                stage: 'stop_resolution'
              });
              
              const coords = await this.resolveLocationReference(stop.stopLocation.ref);
              if (coords) {
                logger.info('[Viator] 🎯 FOUND COORDINATES FROM STOP', {
                  stopRef: stop.stopLocation.ref,
                  coordinates: coords,
                  stage: 'stop_coordinates_found'
                });
                return coords;
              }
            }
          }
        }

        // Try points of interest
        if (firstRoute.pointsOfInterest && firstRoute.pointsOfInterest.length > 0) {
          for (const poi of firstRoute.pointsOfInterest.slice(0, 3)) { // Try first 3 POIs
            if (poi.location?.ref) {
              logger.info('[Viator] Attempting to resolve POI location', {
                poiRef: poi.location.ref,
                attractionId: poi.attractionId,
                stage: 'poi_resolution'
              });
              
              const coords = await this.resolveLocationReference(poi.location.ref);
              if (coords) {
                logger.info('[Viator] 🎯 FOUND COORDINATES FROM POI', {
                  poiRef: poi.location.ref,
                  coordinates: coords,
                  stage: 'poi_coordinates_found'
                });
                return coords;
              }
            }
          }
        }
      }

      // Try other itinerary types
      if (itinerary?.itineraryItems && itinerary.itineraryItems.length > 0) {
        for (const item of itinerary.itineraryItems.slice(0, 3)) {
          if (item.pointOfInterestLocation?.location?.ref) {
            logger.info('[Viator] Attempting to resolve itinerary item location', {
              itemRef: item.pointOfInterestLocation.location.ref,
              stage: 'item_resolution'
            });
            
            const coords = await this.resolveLocationReference(item.pointOfInterestLocation.location.ref);
            if (coords) {
              logger.info('[Viator] 🎯 FOUND COORDINATES FROM ITINERARY ITEM', {
                itemRef: item.pointOfInterestLocation.location.ref,
                coordinates: coords,
                stage: 'item_coordinates_found'
              });
              return coords;
            }
          }
        }
      }

      logger.warn('[Viator] No coordinates found in itinerary', {
        itineraryType: itinerary?.itineraryType,
        stage: 'itinerary_coordinates_not_found'
      });
      
      return null;

    } catch (error) {
      logger.error('[Viator] Error extracting coordinates from itinerary', {
        error: error instanceof Error ? error.message : String(error),
        stage: 'itinerary_extraction_error'
      });
      return null;
    }
  }
}

// Singleton instance
export const viatorClient = new ViatorService(process.env.VIATOR_API_KEY);

// Initialize on import
logger.info('[Viator] Initializing service'); 