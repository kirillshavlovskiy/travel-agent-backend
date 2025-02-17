import { Request, Response } from 'express';
import fetch, { Response as FetchResponse } from 'node-fetch';
import { AmadeusFlightOffer } from '../types/amadeus.js';
import { AmadeusService as FlightService } from '../services/amadeus.js';
import { perplexityClient } from '../services/perplexity.js';
import { logger } from '../utils/logger.js';
import { Activity } from '../types/index.js';

interface TravelRequest {
  departureLocation: {
    code: string;
    label: string;
  };
  destinations: Array<{
    code: string;
    label: string;
  }>;
  startDate: string;
  endDate: string;
  travelers: string | number;
  budgetLimit: number;
  flightData?: AmadeusFlightOffer[];
  preferences?: {
    travelStyle?: string;
    pacePreference?: string;
    interests?: string[];
    accessibility?: string[];
    dietaryRestrictions?: string[];
  };
}

interface PerplexitySearchResult {
  title: string;
  url: string;
      content: string;
}

interface PerplexityMessage {
  content: string;
  search_results?: PerplexitySearchResult[];
}

interface PerplexityChoice {
  message: PerplexityMessage;
}

interface PerplexityResponse {
  choices: PerplexityChoice[];
}

interface FlightReference {
  airline: string;
  route: string;
  price: number;
  outbound: string;
  inbound: string;
  duration: string;
  layovers: number;
  flightNumber: string;
  tier: 'budget' | 'medium' | 'premium';
  referenceUrl: string;
}

interface HotelReference {
  name: string;
  location: string;
  price: number;
  type: string;
  amenities: string;
  rating: number;
  reviewScore: number;
  reviewCount: number;
  images: string[];
  referenceUrl: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  features: string[];
  policies: {
    checkIn: string;
    checkOut: string;
    cancellation: string;
  };
}

interface ActivityReference {
  name: string;
  description: string;
  price: number;
  duration: string;
}

interface TransportReference {
  type: string;
  description: string;
  price: number;
  unit: string;
}

interface FoodReference {
  type: string;
  description: string;
  price: number;
  mealType: string;
}

interface CategoryTier<T> {
  min: number;
  max: number;
  average: number;
  confidence: number;
  source: string;
  references: T[];
}

interface FlightData {
  flights: {
    budget: CategoryTier<FlightReference>;
    medium: CategoryTier<FlightReference>;
    premium: CategoryTier<FlightReference>;
  };
}

interface HotelData {
  hotels: {
    searchDetails: {
      location: string;
      dates: {
        checkIn: string;
        checkOut: string;
      };
      guests: number;
    };
    budget: CategoryTier<HotelReference>;
    medium: CategoryTier<HotelReference>;
    premium: CategoryTier<HotelReference>;
  };
}

interface ActivityData {
  activities: {
    budget: CategoryTier<ActivityReference>;
    medium: CategoryTier<ActivityReference>;
    premium: CategoryTier<ActivityReference>;
  };
}

interface TransportData {
  localTransportation: {
    budget: CategoryTier<TransportReference>;
    medium: CategoryTier<TransportReference>;
    premium: CategoryTier<TransportReference>;
  };
}

interface FoodData {
  food: {
    budget: CategoryTier<FoodReference>;
    medium: CategoryTier<FoodReference>;
    premium: CategoryTier<FoodReference>;
  };
}

interface CategoryData {
  [key: string]: {
    budget: CategoryTier<any>;
    medium: CategoryTier<any>;
    premium: CategoryTier<any>;
  } | undefined;
  flights?: {
    budget: CategoryTier<FlightReference>;
    medium: CategoryTier<FlightReference>;
    premium: CategoryTier<FlightReference>;
  };
  hotels?: {
    searchDetails: {
      location: string;
      dates: {
        checkIn: string;
        checkOut: string;
      };
      guests: number;
    };
    budget: CategoryTier<HotelReference>;
    medium: CategoryTier<HotelReference>;
    premium: CategoryTier<HotelReference>;
  };
  activities?: {
    budget: CategoryTier<ActivityReference>;
    medium: CategoryTier<ActivityReference>;
    premium: CategoryTier<ActivityReference>;
  };
  localTransportation?: {
    budget: CategoryTier<TransportReference>;
    medium: CategoryTier<TransportReference>;
    premium: CategoryTier<TransportReference>;
  };
  food?: {
    budget: CategoryTier<FoodReference>;
    medium: CategoryTier<FoodReference>;
    premium: CategoryTier<FoodReference>;
  };
}

interface SingleActivityResponse {
  id?: string;
  name: string;
  description: string;
  duration: number;
  price: number;
  category: string;
  location: string;
  exact_address: string;
  opening_hours: string;
  startTime: string;
  endTime: string;
  rating: number;
  number_of_reviews: number;
  key_highlights: string[];
  preferred_time_of_day: string;
  images?: string[];
  timeSlot?: string;
  dayNumber?: number;
  tier?: string;
  bookingDetails: {
    provider: 'Viator' | 'GetYourGuide';
    referenceUrl: string;
    cancellationPolicy: string;
    instantConfirmation: boolean;
    mobileTicket: boolean;
    languages: string[];
    minParticipants: number;
    maxParticipants: number;
    pickupIncluded: boolean;
    pickupLocation: string;
    accessibility: string;
    restrictions: string[];
  };
}

interface GoogleSearchItem {
  link: string;
  image: {
    contextLink: string;
    height: number;
    width: number;
    byteSize: number;
    thumbnailLink: string;
    thumbnailHeight: number;
    thumbnailWidth: number;
  };
}

interface GoogleSearchResponse {
  items?: GoogleSearchItem[];
  searchInformation?: {
    totalResults: string;
  };
}

interface BudgetBreakdown {
  requestDetails: {
    departureLocation: any;
    destinations: any[];
    travelers: number;
    startDate: string;
    endDate: string;
    currency: string;
  };
  flights: {
    budget: CategoryTier<FlightReference>;
    medium: CategoryTier<FlightReference>;
    premium: CategoryTier<FlightReference>;
  };
  activities?: {
    budget: CategoryTier<ActivityReference>;
    medium: CategoryTier<ActivityReference>;
    premium: CategoryTier<ActivityReference>;
  };
  localTransportation?: {
    budget: CategoryTier<TransportReference>;
    medium: CategoryTier<TransportReference>;
    premium: CategoryTier<TransportReference>;
  };
  food?: {
    budget: CategoryTier<FoodReference>;
    medium: CategoryTier<FoodReference>;
    premium: CategoryTier<FoodReference>;
  };
  dailySummaries?: Array<{
    dayNumber: number;
    summary: string;
    activities: Activity[];
  }>;
  dayHighlights?: Array<{
    dayNumber: number;
    highlight: string;
    theme: string;
    mainAttractions: string[];
  }>;
  itineraryMetadata?: {
    totalDays: number;
    destination: string;
    preferences: TravelRequest['preferences'];
  };
  tripSummary?: {
    overview: string;
    highlights: string[];
    dailyPlans: Array<{
      dayNumber: number;
      summary: string;
      selectedActivities: string[];
      alternativeActivities: string[];
      suggestedBreaks: Array<{
        time: string;
        type: string;
      }>;
      logistics: {
        transportation: string;
        timing: string;
        suggestions: string[];
      };
    }>;
  };
  organizationLogic?: {
    overview: string;
    considerations: string[];
    recommendations: string[];
    accessibility: {
      general: string;
      specific: Record<string, string>;
    };
    timing: {
      bestTimes: Record<string, string>;
      avoidTimes: Record<string, string>;
    };
  };
  dailyPlans?: DailyPlan[];
}

const SYSTEM_MESSAGE = `You are an AI travel budget expert. Your role is to:
1. Provide accurate cost estimates for travel expenses
2. Consider seasonality, location, and number of travelers
3. Always return responses in valid JSON format
4. Include min and max ranges for each price tier
5. Provide brief descriptions explaining the estimates
6. Consider local market conditions and currency
7. Base estimates on real-world data and current market rates`;

interface TimeSlot {
  budget: any[];
  medium: any[];
  premium: any[];
}

interface ActivityGroup {
  [key: string]: TimeSlot;
}

interface TransformedActivity {
  name: string;
  description: string;
  duration: number;
  price: number;
  category: string;
  location: string;
  exact_address: string;
  opening_hours: string;
  startTime: string;
  endTime: string;
  rating: number;
  number_of_reviews: number;
  key_highlights: string[];
  preferred_time_of_day: string;
  dayNumber: number;
  timeSlot: string;
  tier: string;
  bookingDetails: {
    provider: 'Viator' | 'GetYourGuide';
    referenceUrl: string;
    cancellationPolicy: string;
    instantConfirmation: boolean;
    mobileTicket: boolean;
    languages: string[];
    minParticipants: number;
    maxParticipants: number;
    pickupIncluded: boolean;
    pickupLocation: string;
    accessibility: string;
    restrictions: string[];
  };
  images: string[];
}

interface ActivityGenerationParams {
  destination: string;
  dayNumber: number;
  timeOfDay: 'morning' | 'afternoon' | 'evening';
  budget: 'budget' | 'medium' | 'premium';
  category?: string;
  userPreferences?: string;
  existingActivities?: Activity[];
  flightTimes?: {
    arrival?: string;
    departure?: string;
  };
  currency?: string;
}

interface ActivitySearchResult {
  name: string;
  provider: 'Viator' | 'GetYourGuide';
  price: number;
  price_category: 'budget' | 'medium' | 'premium';
  duration: number;
  typical_time: 'morning' | 'afternoon' | 'evening';
  description: string;
  highlights: string[];
  rating: number;
  review_count: number;
  booking_url: string;
  languages: string[];
  cancellation_policy: string;
  location: {
    meeting_point: string;
    address: string;
  };
  booking_info: {
    instant_confirmation: boolean;
    mobile_ticket: boolean;
    min_participants: number;
    max_participants: number;
  };
}

// Add new interfaces for map data
interface MapLocation {
  name: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  address: string;
  type: 'activity' | 'break' | 'transport' | 'landmark';
  category?: string;
  description?: string;
  duration?: number;
  timeSlot?: string;
  order: number;
  locationType?: string;
}

interface Route {
  from: string;
  to: string;
  mode: 'walking' | 'transit' | 'driving';
  duration: number;
  distance: string;
}

interface MapData {
  center: {
    latitude: number;
    longitude: number;
  };
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  locations: MapLocation[];
  routes: Route[];
}

interface Break {
  startTime: string;
  endTime: string;
  duration: number;
  suggestion: string;
  location?: string;
}

interface DailyPlan {
  dayNumber: number;
  theme: string;
  mainArea: string;
  commentary: string;
  highlights: string[];
  mapData: MapData;
  breaks: {
    morning?: Break;
    lunch?: Break;
    afternoon?: Break;
    dinner?: Break;
  };
  logistics: {
    transportSuggestions: string[];
    walkingDistances: string[];
    timeEstimates: string[];
  };
}

export class VacationBudgetAgent {
  private flightService: FlightService;
  private startTime: number = Date.now();

  constructor(flightService: FlightService) {
    this.flightService = flightService;
  }

  private async fetchWithRetry(url: string, options: any, retries = 3): Promise<FetchResponse> {
    let lastError: Error | unknown;
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);
        return response;
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, i)));
      }
    }
    throw lastError || new Error('Failed to fetch after retries');
  }

  private async queryPerplexity(prompt: string, category: string): Promise<CategoryData> {
    try {
      logger.info(`[${category.toUpperCase()}] Making Perplexity API request`);

      const response = await this.fetchWithRetry(
        'https://api.perplexity.ai/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
          },
          body: JSON.stringify({
            model: 'llama-3.1-sonar-small-128k-online',
            messages: [
              {
                role: 'system',
                content: SYSTEM_MESSAGE
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            options: {
              search: true,
              temperature: 0.1,
              max_tokens: 4000
            }
          })
        },
        3
      );

      if (!response.ok) {
        throw new Error(`Perplexity API request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as PerplexityResponse;
      return result.choices[0].message.content as unknown as CategoryData;
    } catch (error) {
      logger.error(`[${category.toUpperCase()}] Perplexity API error:`, error);
      return this.getDefaultCategoryData(category);
    }
  }

  private generateFlightSearchUrl(flight: FlightReference): string {
    try {
      const [from, to] = (flight.route || '').split(' to ').map((s: string) => s.trim());
      if (!from || !to) return '';

      const fromCode = from.match(/\(([A-Z]{3})\)/) ? from.match(/\(([A-Z]{3})\)/)?.[1] : from;
      const toCode = to.match(/\(([A-Z]{3})\)/) ? to.match(/\(([A-Z]{3})\)/)?.[1] : to;
      
      const outDate = new Date(flight.outbound).toISOString().split('T')[0];
      const inDate = new Date(flight.inbound).toISOString().split('T')[0];
      
      return `https://www.kayak.com/flights/${fromCode}-${toCode}/${outDate}/${inDate}`;
    } catch (error) {
      logger.error('[Flight URL] Error generating flight URL:', error);
      return '';
    }
  }

  private transformAmadeusFlight(flight: AmadeusFlightOffer): FlightReference {
    const segments = flight.itineraries[0].segments;
    const firstSegment = segments[0];
    const lastSegment = segments[segments.length - 1];
    const returnSegments = flight.itineraries[1]?.segments || [];
    const returnFirstSegment = returnSegments[0];
    const returnLastSegment = returnSegments[returnSegments.length - 1];

    const route = `${firstSegment.departure.iataCode} to ${lastSegment.arrival.iataCode}`;
    const flightRef: FlightReference = {
      airline: firstSegment.carrierCode,
      route,
      price: parseFloat(flight.price.total),
      outbound: firstSegment.departure.at,
      inbound: returnFirstSegment ? returnFirstSegment.departure.at : '',
      duration: `${flight.itineraries[0].duration}${returnSegments.length ? ` / ${flight.itineraries[1].duration}` : ''}`,
      layovers: segments.length - 1 + returnSegments.length - 1,
      flightNumber: `${firstSegment.carrierCode}${firstSegment.number}`,
      tier: this.determineFlightTier(flight),
      referenceUrl: this.generateFlightSearchUrl({
        route,
        outbound: firstSegment.departure.at,
        inbound: returnFirstSegment ? returnFirstSegment.departure.at : '',
      } as FlightReference)
    };

    return flightRef;
  }

  private getDefaultCategoryData(category: string): CategoryData {
    const defaultTier = {
      min: 0,
      max: 0,
      average: 0,
      confidence: 0,
      source: 'Default due to API error',
      references: []
    };

    switch (category) {
      case 'flights':
        return {
          flights: {
            budget: defaultTier,
            medium: defaultTier,
            premium: defaultTier
          }
        };
      case 'hotels':
        return {
          hotels: {
            searchDetails: {
              location: '',
              dates: {
                checkIn: '',
                checkOut: ''
              },
              guests: 0
            },
            budget: defaultTier,
            medium: defaultTier,
            premium: defaultTier
          }
        };
      default:
        return {
          [category]: {
            budget: defaultTier,
            medium: defaultTier,
            premium: defaultTier
          }
        };
    }
  }

  async handleTravelRequest(request: TravelRequest): Promise<BudgetBreakdown> {
    this.startTime = Date.now();
    logger.info('Starting budget calculation', {
      request: {
        departureLocation: request.departureLocation,
        destinations: request.destinations,
        startDate: request.startDate,
        endDate: request.endDate,
        travelers: request.travelers,
        budgetLimit: request.budgetLimit
      }
    });
    
    // Initialize arrays to store flight data
    let flightData: AmadeusFlightOffer[] = [];
    let errors: Error[] = [];

    // Initialize response object with default values
    const response: BudgetBreakdown = {
      requestDetails: {
        departureLocation: request.departureLocation,
        destinations: request.destinations,
        travelers: Number(request.travelers),
        startDate: request.startDate,
        endDate: request.endDate,
        currency: 'USD'
      },
      flights: {
        budget: this.getDefaultCategoryData('flights').flights!.budget,
        medium: this.getDefaultCategoryData('flights').flights!.medium,
        premium: this.getDefaultCategoryData('flights').flights!.premium
      }
    };

    // If we have flight data in the request, use it
    if (request.flightData && request.flightData.length > 0) {
      flightData = request.flightData;
    } else {
      // Try to get flight data with retries
      const cabinClasses = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'] as const;
      
      // Sequential search with delay between requests
      for (const travelClass of cabinClasses) {
        try {
          const result = await this.flightService.searchFlights({
            segments: [{
              originLocationCode: request.departureLocation.code,
              destinationLocationCode: request.destinations[0].code,
              departureDate: new Date(request.startDate).toISOString().split('T')[0]
            }],
            adults: Number(request.travelers),
            travelClass
          });
          if (result && result.length > 0) {
            flightData.push(...result);
          }
          // Add delay between requests to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logger.warn(`Failed to fetch flights for ${travelClass}`, { error });
          errors.push(error as Error);
          // Add longer delay after error
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    // Only throw error if we have no flight data at all
    if (flightData.length === 0) {
      logger.error('No flight data available after all attempts', { errors });
      throw new Error('No flight data available');
    }

    // Process the flight data we have
    const groupedFlights = this.groupFlightsByTier(flightData);
    response.flights = {
      budget: groupedFlights.budget || this.getDefaultCategoryData('flights').flights!.budget,
      medium: groupedFlights.medium || this.getDefaultCategoryData('flights').flights!.medium,
      premium: groupedFlights.premium || this.getDefaultCategoryData('flights').flights!.premium
    };

    // Generate activities using the activities endpoint
    try {
      const days = Math.ceil((new Date(request.endDate).getTime() - new Date(request.startDate).getTime()) / (1000 * 60 * 60 * 24));
      
      logger.info('Generating activities', {
        destination: request.destinations[0].label,
        days,
        budget: request.budgetLimit,
        preferences: request.preferences
      });

      // Call the perplexity client directly
      const activitiesData = await perplexityClient.generateActivities({
        destination: request.destinations[0].label,
        days,
        budget: request.budgetLimit,
        currency: 'USD',
        preferences: {
          travelStyle: request.preferences?.travelStyle || 'medium',
          pacePreference: request.preferences?.pacePreference || 'moderate',
          interests: request.preferences?.interests || ['Cultural & Historical'],
          accessibility: Array.isArray(request.preferences?.accessibility) 
            ? request.preferences.accessibility 
            : ['Standard'],
          dietaryRestrictions: request.preferences?.dietaryRestrictions || []
        },
        flightTimes: {
          arrival: flightData[0]?.itineraries[0]?.segments[0]?.arrival?.at,
          departure: flightData[0]?.itineraries[1]?.segments[0]?.departure?.at
        }
      });

      if (!activitiesData?.activities) {
        throw new Error('No activities could be generated');
      }

      logger.info('Activities generation successful', {
        totalActivities: activitiesData.activities?.length,
        success: true,
        metadata: activitiesData.metadata
      });

      // Group activities by tier
      const groupedActivities = (activitiesData.activities || []).reduce((acc: any, activity: any) => {
        const price = activity.price.amount;
        const tier = price <= 30 ? 'budget' : price <= 100 ? 'medium' : 'premium';
        
        if (!acc[tier]) {
          acc[tier] = {
            min: Infinity,
            max: -Infinity,
            average: 0,
            confidence: 0.9,
            source: "Activities API",
            references: []
          };
        }
        
        acc[tier].references.push(activity);
        acc[tier].min = Math.min(acc[tier].min, price);
        acc[tier].max = Math.max(acc[tier].max, price);
        
        return acc;
      }, {});

      // Calculate averages
      Object.keys(groupedActivities).forEach(tier => {
        const activities = groupedActivities[tier].references;
        if (activities.length > 0) {
          groupedActivities[tier].average = activities.reduce((sum: number, a: any) => sum + a.price.amount, 0) / activities.length;
        }
      });

      // Add activities to the response
      response.activities = {
        budget: groupedActivities.budget || {
          min: 0,
          max: 0,
          average: 0,
          confidence: 0,
          source: "Activities API",
          references: []
        },
        medium: groupedActivities.medium || {
          min: 0,
          max: 0,
          average: 0,
          confidence: 0,
          source: "Activities API",
          references: []
        },
        premium: groupedActivities.premium || {
          min: 0,
          max: 0,
          average: 0,
          confidence: 0,
          source: "Activities API",
          references: []
        }
      };

      // Add daily summaries and highlights
      response.dailySummaries = activitiesData?.dailySummaries || [];
      response.dayHighlights = activitiesData?.dayHighlights || [];
      response.itineraryMetadata = {
        totalDays: days,
        destination: request.destinations[0].label,
        preferences: request.preferences
      };

      // Add trip summary and organization logic to the response
      response.tripSummary = {
        overview: `${days}-day trip to ${request.destinations[0].label} featuring a mix of cultural, historical, and leisure activities`,
        highlights: activitiesData.activities
          .filter((a: any) => a.selected)
          .map((a: any) => `${a.name} (${a.timeSlot})`),
        dailyPlans: Array.from({ length: days }, (_, i) => {
          const dayActivities = activitiesData.activities.filter((a: any) => a.dayNumber === i + 1);
          return {
            dayNumber: i + 1,
            summary: activitiesData.dailySummaries?.[i]?.summary || `Day ${i + 1} activities`,
            selectedActivities: dayActivities.filter((a: any) => a.selected).map((a: any) => a.name),
            alternativeActivities: dayActivities.filter((a: any) => !a.selected).map((a: any) => a.name),
            suggestedBreaks: [
              { time: '10:30-11:00', type: 'Morning Break' },
              { time: '12:30-14:00', type: 'Lunch Break' },
              { time: '16:00-16:30', type: 'Afternoon Break' },
              { time: '19:00-20:30', type: 'Dinner Break' }
            ],
            logistics: {
              transportation: 'Public transport and walking between activities',
              timing: 'Activities spaced to allow for comfortable transitions',
              suggestions: [
                'Book morning activities in advance',
                'Consider weather for outdoor activities',
                'Check accessibility requirements for each venue'
              ]
            }
          };
        })
      };

      response.organizationLogic = {
        overview: `This itinerary is organized to maximize your experience in ${request.destinations[0].label} while maintaining a ${request.preferences?.pacePreference || 'moderate'} pace`,
        considerations: [
          'Activities are arranged to minimize travel time between locations',
          'Indoor and outdoor activities are balanced throughout the trip',
          'Meal breaks are scheduled between major activities',
          'Alternative activities are provided for flexibility'
        ],
        recommendations: [
          'Book popular activities in advance',
          'Check weather forecasts for outdoor activities',
          'Verify accessibility arrangements with each venue',
          'Consider purchasing a public transportation pass'
        ],
        accessibility: {
          general: 'Most activities are wheelchair accessible with proper arrangements',
          specific: {
            transportation: 'Public transport is generally accessible, but some metro stations may require alternative routes',
            venues: 'Major attractions have wheelchair access, but some historical sites may have limited accessibility',
            restaurants: 'Most recommended dining venues are accessible, but advance verification is recommended'
          }
        },
        timing: {
          bestTimes: {
            mornings: 'Ideal for major attractions to avoid crowds',
            afternoons: 'Good for outdoor activities and walking tours',
            evenings: 'Perfect for dining and entertainment activities'
          },
          avoidTimes: {
            mornings: 'Rush hour on public transport (8:30-9:30)',
            afternoons: 'Peak tourist hours at major attractions (2:00-4:00)',
            evenings: 'Late dinner times may conflict with morning activities'
          }
        }
      };

      // Inside handleTravelRequest method, update the activities transformation
      const transformedActivities = await this.transformActivities(
        activitiesData.activities,
        days,
        request.destinations[0].label
      );

      // Add daily plans to the response
      response.dailyPlans = transformedActivities
        .filter(activity => activity.dailyPlan)
        .map(activity => activity.dailyPlan)
        .filter((plan, index, self) => 
          index === self.findIndex(p => p.dayNumber === plan.dayNumber)
        );

      const totalTime = Date.now() - this.startTime;
      console.log(`[TIMING] Total budget calculation completed in ${totalTime}ms`);
      if (totalTime > 25000) {
        console.warn(`[TIMING] Warning: Budget calculation took longer than 25 seconds`);
      }

      return response;
    } catch (error) {
      logger.error('Failed to generate activities:', error);
      // Use default activities data if generation fails
      response.activities = this.getDefaultCategoryData('activities').activities;
      return response;
    }
  }

  private determineFlightTier(flight: AmadeusFlightOffer): 'budget' | 'medium' | 'premium' {
    const cabinClass = flight.travelerPricings[0].fareDetailsBySegment[0].cabin;
    const price = parseFloat(flight.price.total);

    if (cabinClass === 'FIRST' || cabinClass === 'BUSINESS') {
      return 'premium';
    } else if (cabinClass === 'PREMIUM_ECONOMY') {
      return 'medium';
    } else if (price <= 1000) {
      return 'budget';
    } else if (price <= 2000) {
      return 'medium';
    } else {
      return 'premium';
    }
  }

  private constructPrompt(params: { category?: string; request?: TravelRequest; destination?: string; userPreferences?: string }): string {
    const { category, request, destination, userPreferences } = params;

    if (category && request) {
      return `Search for available activities in ${request.destinations[0].label} with these requirements:

SEARCH PROCESS:
1. Search both platforms:
   - Search Viator.com for ${request.destinations[0].label} activities
   - Search GetYourGuide.com for ${request.destinations[0].label} activities
2. Sort by: Best Rating
3. Find at least 3 activities from each platform
4. Focus on category: ${category}
${request.preferences ? `\nAdditional preferences: ${JSON.stringify(request.preferences)}` : ''}

VALIDATION RULES:
1. Activities must have valid booking URLs
2. Copy exact details from the listings
3. Include activities across different price points
4. Include activities with different durations and times

For each activity found, provide details in this JSON format:
{
  "${category}": {
    "budget": {
      "min": number,
      "max": number,
      "average": number,
      "confidence": number,
      "source": "string",
      "references": [
        {
          "name": "EXACT name from listing",
          "provider": "Viator" or "GetYourGuide",
          "price": number,
          "duration": number,
          "description": "EXACT description from listing",
          "booking_url": "EXACT URL from listing"
        }
      ]
    },
    "medium": { same structure },
    "premium": { same structure }
  }
}`;
    }

    // If we have destination and userPreferences, it's for single activity generation
    if (destination) {
      return `Search for available activities in ${destination} with these requirements:

SEARCH PROCESS:
1. Search both platforms:
   - Search Viator.com for ${destination} activities
   - Search GetYourGuide.com for ${destination} activities
2. Sort by: Best Rating
3. Find at least 3 activities from each platform${category ? `\n4. Focus on category: ${category}` : ''}
${userPreferences ? `\nAdditional preferences: ${userPreferences}` : ''}

VALIDATION RULES:
1. Activities must have valid booking URLs
2. Copy exact details from the listings
3. Include activities across different price points
4. Include activities with different durations and times

For each activity found, provide details in this JSON format:
{
  "activities": [
    {
      "name": "EXACT name from listing",
      "provider": "Viator" or "GetYourGuide",
      "price": exact price in USD,
      "price_category": "budget" (<$30), "medium" ($30-$100), or "premium" (>$100),
      "duration": hours (number),
      "typical_time": "morning", "afternoon", or "evening",
      "description": "EXACT description from listing",
      "highlights": ["EXACT highlights from listing"],
      "rating": exact rating (number),
      "review_count": exact number of reviews,
      "booking_url": "EXACT URL from listing",
      "languages": ["available languages"],
      "cancellation_policy": "EXACT policy from listing",
      "location": {
        "meeting_point": "EXACT meeting point",
        "address": "EXACT address if provided"
      },
      "booking_info": {
        "instant_confirmation": true/false,
        "mobile_ticket": true/false,
        "min_participants": number,
        "max_participants": number
      }
    }
  ]
}`;
    }

    throw new Error('Invalid parameters for constructPrompt');
  }

  private constructHotelPrompt(request: TravelRequest): string {
    const destination = request.destinations[0].label;
    const checkIn = request.startDate;
    const checkOut = request.endDate;
    const travelers = request.travelers;
    const budget = request.budgetLimit;

    let prompt = `Provide detailed hotel recommendations in ${destination} for ${travelers} travelers, checking in on ${checkIn} and checking out on ${checkOut}.`;

    if (budget) {
      prompt += `\nConsider total budget of ${budget} USD when suggesting options.`;
    }

    prompt += `\n\nIMPORTANT RULES:
1. Prioritize hotels with direct booking websites
2. All URLs must be complete and include check-in/out dates when possible
3. All images must be from official hotel sources
4. Prices must reflect actual rates for the specified dates
5. Only include hotels that can be booked online
6. Verify that all links and images are accessible
7. Include major hotel chains when available in each tier`;

    return prompt;
  }

  private cleanJsonResponse(content: string): string {
    logger.debug('Content before cleaning:', content);
    
    try {
      // First try to parse it directly in case it's already valid JSON
      try {
        JSON.parse(content);
        return content;
      } catch (e) {
        // If direct parsing fails, proceed with cleaning
      }

      // Remove any markdown code block markers
      content = content.replace(/```json\n?|\n?```/g, '');
      
      // Remove any text before the first {
      content = content.substring(content.indexOf('{'));
      
      // Find the last complete activity object by looking for the last complete closing brace
      const lastCompleteActivity = content.lastIndexOf('}, {');
      if (lastCompleteActivity !== -1) {
        content = content.substring(0, lastCompleteActivity + 1) + ']}';
      } else {
        // If we can't find a complete activity, try to find the last complete object
        const lastCompleteBrace = content.lastIndexOf('}');
        if (lastCompleteBrace !== -1) {
          content = content.substring(0, lastCompleteBrace + 1);
        }
      }
      
      // Quote unquoted property names
      content = content.replace(/(\{|\,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
      
      // Fix duration ranges by taking the average
      content = content.replace(/"duration"\s*:\s*"?(\d+)-(\d+)"?/g, (match, start, end) => {
        const avg = (parseInt(start) + parseInt(end)) / 2;
        return `"duration": ${avg}`;
      });

      // Convert any remaining duration ranges to single numbers
      content = content.replace(/"duration"\s*:\s*"([0-9.]+)"/g, '"duration": $1');
      
      // Quote unquoted boolean values
      content = content.replace(/:\s*(true|false)(\s*[,}])/gi, ':"$1"$2');
      
      // Clean up any malformed URLs
      content = content.replace(/(\/[^\/]+)\1{10,}/g, '/malformed-url-removed');

      // Try to parse the cleaned content
      try {
        const parsed = JSON.parse(content);
        return JSON.stringify(parsed, null, 2);
    } catch (error) {
        logger.error('Failed to parse cleaned JSON:', { error, content });
        // Return a valid activities array with a single placeholder activity
      return JSON.stringify({
          activities: [{
            name: "Placeholder Activity",
        description: "Unable to generate activity details. Please try again.",
        duration: 2,
        price: 0,
        category: "General",
        location: "To be determined",
        exact_address: "",
        opening_hours: "",
            startTime: "09:00",
            endTime: "11:00",
        rating: 0,
        number_of_reviews: 0,
        key_highlights: ["Please try generating another activity"],
        preferred_time_of_day: "morning",
            bookingDetails: {
              provider: "GetYourGuide",
              referenceUrl: "",
              cancellationPolicy: "Free cancellation",
              instantConfirmation: true,
              mobileTicket: true,
              languages: ["English"],
              minParticipants: 1,
              maxParticipants: 10,
              pickupIncluded: false,
              pickupLocation: "",
              accessibility: "Standard",
              restrictions: []
            },
        images: []
          }]
        }, null, 2);
      }
    } catch (error) {
      logger.error('Failed to clean JSON response:', { error, content });
      // Return a valid empty activities array as fallback
      return JSON.stringify({
        activities: []
      }, null, 2);
    }
  }

  private async querySingleActivity(prompt: string): Promise<any> {
    logger.debug('Starting activity generation with prompt:', prompt);
    
    try {
      logger.debug('Generated prompt length:', prompt.length);
      
      const result = await this.fetchWithRetry(
        'https://api.perplexity.ai/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
          },
          body: JSON.stringify({
            model: 'llama-3.1-sonar-small-128k-online',
            messages: [
              {
                role: 'system',
                content: `You are a travel activity expert specializing in Viator and GetYourGuide bookings.
Your task is to search through Viator and GetYourGuide's platforms to find and recommend REAL, BOOKABLE activities.

SEARCH PROCESS:
1. First search Viator.com for premium activities ($100+)
2. Then search GetYourGuide.com for budget/medium activities (under $100)
3. Use the search filters on each platform to find activities matching the requirements
4. Verify each activity exists and is currently bookable
5. Copy exact details from the actual listings

CRITICAL RULES:
1. ONLY suggest activities that you can find on these platforms
2. ALL URLs must be real, active booking links that you verify
3. Premium activities ($100+) MUST be from Viator.com
4. Budget/medium activities (under $100) MUST be from GetYourGuide.com
5. Include EXACT booking URLs in this format:
   - Viator: https://www.viator.com/tours/[city]/[activity-name]/[product-code]
   - GetYourGuide: https://www.getyourguide.com/[city]/[activity-code]
6. Copy exact prices, descriptions, and details from the listings
7. Do not make up or guess any information - only use what you find
8. If you can't find a suitable activity, say so instead of making one up

For each activity you find, include:
{
  "name": "EXACT name from provider",
  "description": "EXACT description from provider",
  "price": number (exact price in USD),
  "duration": number (in hours),
  "location": "Specific venue/location name",
  "address": "Full street address",
  "openingHours": "Actual operating hours",
  "keyHighlights": ["Real highlights from provider"],
  "rating": number (from provider reviews),
  "numberOfReviews": number (actual count),
  "category": "Activity type",
  "dayNumber": number,
  "timeSlot": "morning" | "afternoon" | "evening",
  "referenceUrl": "EXACT booking URL",
  "images": ["Real image URLs"],
  "priceCategory": "budget" | "medium" | "premium",
  "bookingDetails": {
    "provider": "Viator" | "GetYourGuide",
    "cancellationPolicy": "Exact policy from listing",
    "instantConfirmation": boolean,
    "mobileTicket": boolean,
    "languages": ["Available languages"],
    "minParticipants": number,
    "maxParticipants": number,
    "pickupIncluded": boolean,
    "pickupLocation": "If included",
    "accessibility": "From listing",
    "restrictions": ["From listing"]
  }
}`
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            options: {
              temperature: 0.1,
              max_tokens: 4000,
              web_search: true
            }
          })
        },
        3
      );

      if (!result.ok) {
        throw new Error(`Perplexity API request failed: ${result.status} ${result.statusText}`);
      }

      const data = await result.json();
      
      logger.debug('Received response from Perplexity:', {
        contentLength: data.choices?.[0]?.message?.content?.length,
        hasChoices: !!data.choices,
        firstChoice: data.choices?.[0]?.message,
        searchResults: data.choices?.[0]?.message?.search_results
      });

      if (!data.choices?.[0]?.message?.content) {
        throw new Error('Invalid response from Perplexity API');
      }

      const content = data.choices[0].message.content;
      logger.debug('Raw content from Perplexity API:', content);

      try {
        // Try to parse the content directly first
        return JSON.parse(content);
      } catch (e) {
        logger.warn('Failed to parse content directly, attempting to clean:', e);
        
        // Clean the content and try again
        let cleanContent = content
          .replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1') // Remove markdown code blocks
          .replace(/^[^{]*({[\s\S]*})[^}]*$/, '$1') // Extract just the JSON object
          .trim();

        logger.debug('Cleaned content:', cleanContent);
        
        try {
          return JSON.parse(cleanContent);
        } catch (e) {
          logger.error('Failed to parse cleaned content:', e);
          throw new Error('Failed to parse activity data');
        }
      }
      } catch (error) {
      logger.error('Error in querySingleActivity:', error);
      throw error;
    }
  }

  private isValidJson(str: string): boolean {
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  }

  private determineActivityTier(price: number): 'budget' | 'medium' | 'premium' {
    if (price <= 30) {
      return 'budget';
    } else if (price <= 100) {
      return 'medium';
    } else {
      return 'premium';
    }
  }

  async generateSingleActivity(params: ActivityGenerationParams): Promise<any> {
    const prompt = this.constructPrompt({
      destination: params.destination,
      category: params.category,
      userPreferences: params.userPreferences
    });
    
    const result = await this.querySingleActivity(prompt);
    
    if (result.error) {
      return this.createPlaceholderActivity({
        dayNumber: params.dayNumber,
        timeSlot: params.timeOfDay,
        tier: params.budget
      });
    }
    
    return {
      ...result,
      dayNumber: params.dayNumber,
      timeSlot: params.timeOfDay,
      tier: params.budget
    };
  }

  private getPriceRangeForTier(budget: number | string, currency: string): { min: number; max: number } {
    const budgetNum = typeof budget === 'string' ? this.getBudgetAmount(budget) : budget;
    
    switch(budget) {
      case 'budget':
        return { min: 0, max: 30 };
      case 'medium':
        return { min: 30, max: 100 };
      case 'premium':
        return { min: 100, max: budgetNum }; // Use the total budget as max for premium
      default:
        return { min: 0, max: budgetNum };
    }
  }

  private getBudgetAmount(tier: string): number {
    switch(tier.toLowerCase()) {
      case 'budget':
        return 30;
      case 'medium':
        return 100;
      case 'premium':
        return 500; // Default max for premium tier
      default:
        return 100; // Default to medium tier budget
    }
  }

  private groupFlightsByTier(flights: AmadeusFlightOffer[]): Record<'budget' | 'medium' | 'premium', CategoryTier<FlightReference>> {
    const result = flights.reduce((acc, flight) => {
      const tier = this.determineFlightTier(flight);
      if (!acc[tier]) {
        acc[tier] = {
          min: Infinity,
          max: -Infinity,
          average: 0,
          confidence: 0.9, // Higher confidence for real data
          source: 'Amadeus',
          references: []
        };
      }
      const price = parseFloat(flight.price.total);
      acc[tier].min = Math.min(acc[tier].min, price);
      acc[tier].max = Math.max(acc[tier].max, price);
      acc[tier].references.push(this.transformAmadeusFlight(flight));
      return acc;
    }, {} as Record<'budget' | 'medium' | 'premium', CategoryTier<FlightReference>>);

    // Calculate averages
    Object.keys(result).forEach(tier => {
      const refs = result[tier as keyof typeof result].references;
      result[tier as keyof typeof result].average = 
        refs.reduce((sum: number, ref: any) => sum + ref.price, 0) / refs.length;
    });

    return result;
  }

  private async transformActivities(activities: any[], days: number, destination: string): Promise<Activity[]> {
    try {
      if (!Array.isArray(activities)) {
        logger.error('[Activities] Invalid activities data:', activities);
        return [];
      }

      // Transform each activity
      const transformedActivities = activities.map((activity, index) => {
        // Calculate initial day and time slot based on index
        const initialDayNumber = Math.floor(index / 3) + 1;
        const timeSlotIndex = index % 3;
        const timeSlot = timeSlotIndex === 0 ? 'morning' : 
                        timeSlotIndex === 1 ? 'afternoon' : 'evening';
        const startTime = timeSlot === 'morning' ? '09:00' :
                         timeSlot === 'afternoon' ? '14:00' : '19:00';

        const price = typeof activity.price === 'number' ? activity.price : 
                     typeof activity.price === 'string' ? parseFloat(activity.price) : 0;
        const tier = price <= 30 ? 'budget' : 
                    price <= 100 ? 'medium' : 'premium';

        const duration = activity.duration || 120; // Default to 2 hours
        const endTime = new Date(new Date(`2000-01-01T${startTime}`).getTime() + duration * 60000).toTimeString().slice(0, 5);

        // Determine if this activity should be selected (limit to 3 per day)
        const isSelected = index < days * 3; // Only first 3 activities per day are selected

        return {
          id: `activity-${initialDayNumber}-${timeSlot}-${index}`,
          name: activity.name || 'Unnamed Activity',
          description: activity.description || '',
          duration: duration / 60, // Convert minutes to hours
          price: {
            amount: price,
            currency: 'USD'
          },
          category: activity.category || 'General',
          location: activity.location?.meeting_point || activity.location?.address || '',
          address: activity.location?.address || '',
          exact_address: activity.location?.address || '',
          opening_hours: `${duration} minutes`,
          openingHours: `${duration} minutes`,
          startTime,
          endTime,
          rating: activity.rating || 4.5,
          number_of_reviews: activity.review_count || 100,
          key_highlights: activity.highlights || [],
          keyHighlights: activity.highlights || [],
          preferred_time_of_day: timeSlot,
          dayNumber: initialDayNumber,
          timeSlot,
          tier,
          selected: isSelected,
          bookingDetails: {
            provider: activity.provider || 'Viator',
            referenceUrl: activity.booking_url || '',
            cancellationPolicy: activity.cancellation_policy || 'Free cancellation up to 24 hours before start',
            instantConfirmation: activity.booking_info?.instant_confirmation || true,
            mobileTicket: activity.booking_info?.mobile_ticket || true,
            languages: activity.languages || ['English'],
            minParticipants: activity.booking_info?.min_participants || 1,
            maxParticipants: activity.booking_info?.max_participants || 15,
            pickupIncluded: false,
            pickupLocation: '',
            accessibility: activity.accessibility || 'Standard',
            restrictions: activity.restrictions || []
          },
          images: activity.images || []
        };
      });

      // Group activities by day for better organization
      const activitiesByDay = new Map<number, Activity[]>();
      transformedActivities.forEach(activity => {
        const day = activity.dayNumber;
        if (!activitiesByDay.has(day)) {
          activitiesByDay.set(day, []);
        }
        activitiesByDay.get(day)?.push(activity);
      });

      // Ensure we have activities for all days
      for (let day = 1; day <= days; day++) {
        if (!activitiesByDay.has(day)) {
          activitiesByDay.set(day, []);
        }
      }

      // Flatten the activities back into an array
      const allActivities = Array.from(activitiesByDay.values()).flat();

      // Generate daily plans
      const dailyPlans: DailyPlan[] = Array.from({ length: days }, (_, dayIndex) => {
        const dayNumber = dayIndex + 1;
        const dayActivities = activitiesByDay.get(dayNumber) || [];
        const selectedActivities = dayActivities.filter(a => a.selected);

        // Calculate map data
        const locations: MapLocation[] = dayActivities.map((activity, index) => ({
          name: activity.name,
          coordinates: {
            latitude: 0, // Would need to be fetched from a geocoding service
            longitude: 0,
          },
          address: activity.address || activity.location,
          type: 'activity',
          category: activity.category,
          description: activity.description,
          duration: activity.duration * 60, // Convert hours to minutes
          timeSlot: activity.timeSlot,
          order: index + 1
        }));

        // Add break locations
        const breaks = {
          morning: {
            startTime: '10:30',
            endTime: '11:00',
            duration: 30,
            suggestion: 'Coffee break at a local café',
            location: 'Nearby café'
          },
          lunch: {
            startTime: '12:30',
            endTime: '14:00',
            duration: 90,
            suggestion: 'Lunch at a local restaurant',
            location: 'Local restaurant district'
          },
          afternoon: {
            startTime: '16:00',
            endTime: '16:30',
            duration: 30,
            suggestion: 'Rest and refreshments',
            location: 'Local café or park'
          },
          dinner: {
            startTime: '19:00',
            endTime: '20:30',
            duration: 90,
            suggestion: 'Dinner at a recommended restaurant',
            location: 'Restaurant district'
          }
        };

        // Generate theme based on activities
        const activityCategories = new Set(dayActivities.map(a => a.category));
        const theme = Array.from(activityCategories).join(' & ') || 'City Exploration';

        // Determine main area based on activities
        const mainArea = dayActivities.length > 0 
          ? dayActivities[0].location.split(',')[0]
          : 'City Center';

        // Generate commentary
        const commentary = `Day ${dayNumber} features ${selectedActivities.length} carefully selected activities in ${mainArea}, including ${selectedActivities.map(a => a.name).join(', ')}. The day is balanced with appropriate breaks and follows a ${dayActivities[0]?.timeSlot || 'moderate'} pace.`;

        // Calculate routes between locations
        const routes: Route[] = [];
        for (let i = 0; i < locations.length - 1; i++) {
          routes.push({
            from: locations[i].name,
            to: locations[i + 1].name,
            mode: 'transit',
            duration: 30, // Default duration in minutes
            distance: '2 km' // Would need to be calculated based on actual coordinates
          });
        }

        return {
          dayNumber,
          theme,
          mainArea,
          commentary,
          highlights: selectedActivities.map(a => a.name),
          mapData: {
            center: {
              latitude: 0, // Would need to be calculated based on activity locations
              longitude: 0,
            },
            bounds: {
              north: 0,
              south: 0,
              east: 0,
              west: 0,
            },
            locations,
            routes
          },
          breaks,
          logistics: {
            transportSuggestions: [
              'Use public transportation between major attractions',
              'Walking is recommended for nearby locations',
              'Taxis available for evening activities'
            ],
            walkingDistances: [
              'Average walking distance between activities: 15-20 minutes',
              'Most attractions are within walking distance',
              'Public transport recommended for distances over 2km'
            ],
            timeEstimates: [
              'Allow 30 minutes for transportation between activities',
              'Plan for security checks at major attractions',
              'Consider rush hour when planning morning activities'
            ]
          }
        };
      });

      // Add daily plan information to each activity
      const enrichedActivities = allActivities.map(activity => ({
        ...activity,
        dailyPlan: dailyPlans.find(plan => plan.dayNumber === activity.dayNumber)
      }));

      return enrichedActivities;
    } catch (error) {
      logger.error('[Activities] Error transforming activities:', error);
      return [];
    }
  }

  private hasValidBookingDetails(activity: any): boolean {
    // Less strict URL validation - just check if it's a valid URL for the provider
    const isViatorUrl = (url: string) => url.includes('viator.com');
    const isGetYourGuideUrl = (url: string) => url.includes('getyourguide.com');
    
    const isValid = activity.bookingDetails &&
      (activity.bookingDetails.provider === 'Viator' || activity.bookingDetails.provider === 'GetYourGuide') &&
      activity.bookingDetails.referenceUrl &&
      activity.bookingDetails.referenceUrl.length > 0 &&
      (
        (activity.bookingDetails.provider === 'Viator' && isViatorUrl(activity.bookingDetails.referenceUrl)) ||
        (activity.bookingDetails.provider === 'GetYourGuide' && isGetYourGuideUrl(activity.bookingDetails.referenceUrl))
      );

    // Log validation details
    logger.debug('[Activity Validation]', {
      name: activity.name,
      provider: activity.bookingDetails?.provider,
      url: activity.bookingDetails?.referenceUrl,
      isValid,
      price: activity.price,
      tier: this.determineActivityTier(activity.price),
      isViatorUrl: activity.bookingDetails?.referenceUrl ? isViatorUrl(activity.bookingDetails.referenceUrl) : false,
      isGetYourGuideUrl: activity.bookingDetails?.referenceUrl ? isGetYourGuideUrl(activity.bookingDetails.referenceUrl) : false
    });

    if (!isValid) {
      logger.warn('[Activity Validation] Invalid booking details', {
        name: activity.name,
        provider: activity.bookingDetails?.provider,
        url: activity.bookingDetails?.referenceUrl,
        price: activity.price,
        missingProvider: !activity.bookingDetails?.provider,
        missingUrl: !activity.bookingDetails?.referenceUrl,
        invalidProvider: activity.bookingDetails?.provider !== 'Viator' && activity.bookingDetails?.provider !== 'GetYourGuide',
        invalidUrlFormat: activity.bookingDetails?.referenceUrl ? 
          !isViatorUrl(activity.bookingDetails.referenceUrl) && !isGetYourGuideUrl(activity.bookingDetails.referenceUrl) : 
          true
      });
    }

    return isValid;
  }

  private ensureValidBookingDetails(bookingDetails: any, tier: string): TransformedActivity['bookingDetails'] {
    const provider = tier === 'premium' ? 'Viator' : 'GetYourGuide';
    const baseUrl = provider === 'Viator' ? 'https://www.viator.com' : 'https://www.getyourguide.com';

      return {
      provider,
      referenceUrl: bookingDetails?.referenceUrl || `${baseUrl}/error-invalid-url`,
      cancellationPolicy: bookingDetails?.cancellationPolicy || 'Free cancellation up to 24 hours before the activity starts',
      instantConfirmation: bookingDetails?.instantConfirmation ?? true,
      mobileTicket: bookingDetails?.mobileTicket ?? true,
      languages: bookingDetails?.languages || ['English'],
      minParticipants: bookingDetails?.minParticipants || 1,
      maxParticipants: bookingDetails?.maxParticipants || (tier === 'premium' ? 8 : 50),
      pickupIncluded: bookingDetails?.pickupIncluded ?? (tier === 'premium'),
      pickupLocation: bookingDetails?.pickupLocation || (tier === 'premium' ? 'Your hotel' : ''),
      accessibility: bookingDetails?.accessibility || 'Standard',
      restrictions: bookingDetails?.restrictions || []
    };
  }

  private createPlaceholderActivity(params?: { dayNumber?: number; timeSlot?: 'morning' | 'afternoon' | 'evening'; tier?: 'budget' | 'medium' | 'premium' }): ActivitySearchResult {
    return {
      name: "Activity Unavailable",
      provider: "Viator",
      price: 0,
      price_category: params?.tier || "budget",
      duration: 2,
      typical_time: params?.timeSlot || "morning",
      description: "No matching activity found. Please try different search criteria.",
      highlights: ["No highlights available"],
      rating: 0,
      review_count: 0,
      booking_url: "",
      languages: ["English"],
      cancellation_policy: "N/A",
      location: {
        meeting_point: "To be determined",
        address: ""
      },
      booking_info: {
        instant_confirmation: false,
        mobile_ticket: false,
        min_participants: 1,
        max_participants: 1
      }
    };
  }

  private determineTimeSlot(startTime: string): 'morning' | 'afternoon' | 'evening' {
    const hour = parseInt(startTime.split(':')[0]);
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    return 'evening';
  }

  private determinePriceCategory(price: number): 'budget' | 'medium' | 'premium' {
    if (price < 30) return 'budget';
    if (price <= 100) return 'medium';
    return 'premium';
  }
} 