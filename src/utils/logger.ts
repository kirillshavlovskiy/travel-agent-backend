import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import winston from 'winston';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logsDir = path.join(__dirname, '../../logs');
const logFile = path.join(logsDir, 'server.log');
const hotelLogFile = path.join(logsDir, 'hotel-processing.log');
const activityLogFile = path.join(logsDir, 'activity.log');
const perplexityLogFile = path.join(logsDir, 'perplexity.log');
const viatorLogFile = path.join(logsDir, 'viator.log');

console.log('Logs directory:', logsDir);
console.log('Hotel log file:', hotelLogFile);
console.log('Activity log file:', activityLogFile);
console.log('Perplexity log file:', perplexityLogFile);
console.log('Viator log file:', viatorLogFile);

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
  console.log('Creating logs directory:', logsDir);
  fs.mkdirSync(logsDir, { recursive: true, mode: 0o755 });
}

// Ensure all log files exist with proper permissions
[hotelLogFile, activityLogFile, perplexityLogFile, viatorLogFile].forEach(file => {
  if (!fs.existsSync(file)) {
    console.log('Creating log file:', file);
    fs.writeFileSync(file, '', { mode: 0o644 });
  } else {
    // Ensure proper permissions on existing files
    fs.chmodSync(file, 0o644);
  }
});

// ANSI color codes for better visibility
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  info: '\x1b[36m',    // Cyan
  warn: '\x1b[33m',    // Yellow
  error: '\x1b[31m',   // Red
  debug: '\x1b[35m',   // Magenta
};

// Create Winston loggers for each service with proper formatting
const createServiceLogger = (filename: string, service: string) => winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss.SSS'
    }),
    winston.format.printf(({ timestamp, level, message, tags = [], ...rest }) => {
      return JSON.stringify({
        timestamp,
        service,
        level,
        tags: Array.isArray(tags) ? tags : [tags],
        message,
        data: rest
      }, null, 2);
      })
    ),
    transports: [
      new winston.transports.File({ 
        filename,
        level: 'debug'
      }),
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, tags = [], ...rest }) => {
          const colorizedLevel = colors[level.toLowerCase() as keyof typeof colors] || '';
          return `${colorizedLevel}${JSON.stringify({
            timestamp,
            service,
            level,
            tags: Array.isArray(tags) ? tags : [tags],
            message,
            data: rest
          }, null, 2)}${colors.reset}`;
          })
        )
      })
    ]
  });

// Utility functions for activity logging
function countCategories(activities: any[]): Record<string, number> {
  return activities.reduce((acc, activity) => {
    const category = activity.category || 'uncategorized';
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
}

function countActivitiesByDay(activities: any[]): Record<number, number> {
  return activities.reduce((acc, activity) => {
    const day = activity.dayNumber || 1;
    acc[day] = (acc[day] || 0) + 1;
    return acc;
  }, {});
}

function countActivitiesByTimeSlot(activities: any[]): Record<string, number> {
  return activities.reduce((acc, activity) => {
    const timeSlot = activity.timeSlot || 'unspecified';
    acc[timeSlot] = (acc[timeSlot] || 0) + 1;
    return acc;
  }, {});
}

// Create loggers with service names
const activityLoggerBase = createServiceLogger(activityLogFile, 'activity');
const perplexityLogger = createServiceLogger(perplexityLogFile, 'perplexity');
const viatorLogger = createServiceLogger(viatorLogFile, 'viator');
const hotelLogger = createServiceLogger(hotelLogFile, 'hotel');

// Test log to verify logging is working
hotelLogger.info('Hotel logger initialized', { 
  logFile: hotelLogFile,
  timestamp: new Date().toISOString()
});

// Add specific hotel logging methods
const logHotelProcessing = {
  batchStart: (batchNumber: number, hotelIds: string[]) => {
    console.log('Logging batch start:', { batchNumber, hotelCount: hotelIds.length });
    hotelLogger.info('Processing hotel batch', {
      tags: ['batch', 'processing'],
      batch: batchNumber,
      hotelCount: hotelIds.length,
      hotelIds
    });
  },
  hotelFound: (hotelData: any) => {
    console.log('Logging hotel found:', { hotelId: hotelData.id, name: hotelData.name });
    hotelLogger.info('Hotel data processed', {
      hotelId: hotelData.id,
      name: hotelData.name,
      offers: hotelData.offers?.length || 0,
      price: hotelData.offers?.[0]?.price
    });
  },
  batchError: (batchNumber: number, error: any) => {
    console.log('Logging batch error:', { batchNumber, error: error.message });
    hotelLogger.error('Batch processing error', {
      batch: batchNumber,
      error: error.message,
      details: error.response || error
    });
  },
  searchSummary: (summary: any) => {
    console.log('Logging search summary:', { totalHotels: summary.totalHotelsFound });
    hotelLogger.info('Hotel search completed', {
      totalHotels: summary.totalHotelsFound,
      availableHotels: summary.availableHotels,
      destinations: summary.destinations,
      dateRange: summary.dateRange
    });
  }
};

// Create activity logger with additional methods
const logActivity = {
  start: (params: any) => {
    activityLoggerBase.info('Starting activity generation', {
      tags: ['generation', 'start'],
      params,
      timestamp: new Date().toISOString()
    });
  },
  generated: (count: number, activities: any[]) => {
    activityLoggerBase.info('Activities generated', {
      tags: ['generation', 'complete'],
      timestamp: new Date().toISOString(),
      data: {
        total_activities: count,
        activities: activities.map(a => ({
          id: a.id,
          name: a.name,
          description: a.description,
          category: a.category,
          time_slot: a.timeSlot,
          day_number: a.dayNumber,
          duration: a.duration,
          price: a.price,
          rating: a.rating,
          number_of_reviews: a.numberOfReviews,
          tier: a.tier,
          is_verified: a.isVerified,
          verification_status: a.verificationStatus,
          reference_url: a.referenceUrl,
          product_code: a.productCode,
          scoring: {
            preference_score: a.preferenceScore,
            matched_preferences: a.matchedPreferences,
            scoring_reason: a.scoringReason
          },
          enrichment: {
            location_details: a.location,
            contact_info: a.contactInfo,
            images: a.images?.length || 0
          },
          selection: {
            is_selected: a.selected,
            selection_reason: a.scoringReason
          }
        })),
        distribution: {
          by_category: countCategories(activities),
          by_day: countActivitiesByDay(activities),
          by_time_slot: countActivitiesByTimeSlot(activities),
          by_tier: activities.reduce((acc: Record<string, number>, a) => {
            acc[a.tier] = (acc[a.tier] || 0) + 1;
            return acc;
          }, {})
        },
        summary: {
          average_price: activities.reduce((sum, a) => sum + (a.price?.amount || 0), 0) / activities.length,
          average_rating: activities.reduce((sum, a) => sum + (a.rating || 0), 0) / activities.length,
          verified_count: activities.filter(a => a.isVerified).length,
          with_viator_data: activities.filter(a => a.productCode).length
        },
        itinerary_summary: {
          total_days: Math.max(...activities.map(a => a.dayNumber)),
          daily_plans: activities.reduce((acc: Record<number, any>, activity) => {
            if (!acc[activity.dayNumber]) {
              acc[activity.dayNumber] = {
                theme: 'Mixed Activities',
                main_area: 'Various Locations',
                activities_by_slot: {
                  morning: [],
                  afternoon: [],
                  evening: []
                },
                total_cost: 0,
                average_rating: 0,
                categories: new Set(),
                highlights: []
              };
            }
            const day = acc[activity.dayNumber];
            day.activities_by_slot[activity.timeSlot].push({
              name: activity.name,
              score: activity.preferenceScore,
              url: activity.referenceUrl,
              product_code: activity.productCode,
              price: activity.price,
              rating: activity.rating,
              duration: activity.duration,
              time_slot: activity.timeSlot,
              tier: activity.tier
            });
            day.total_cost += activity.price?.amount || 0;
            day.average_rating = (day.average_rating + (activity.rating || 0)) / 2;
            day.categories.add(activity.category);
            if (activity.preferenceScore > 0.8) {
              day.highlights.push(activity.name);
            }
            return acc;
          }, {}),
          optimization_metrics: {
            category_balance: Object.values(countCategories(activities)).reduce((a, b) => Math.min(a, b)) / 
                            Object.values(countCategories(activities)).reduce((a, b) => Math.max(a, b)),
            time_slot_balance: Object.values(countActivitiesByTimeSlot(activities)).reduce((a, b) => Math.min(a, b)) / 
                             Object.values(countActivitiesByTimeSlot(activities)).reduce((a, b) => Math.max(a, b)),
            price_distribution: {
              min: Math.min(...activities.map(a => a.price?.amount || 0)),
              max: Math.max(...activities.map(a => a.price?.amount || 0)),
              median: activities.map(a => a.price?.amount || 0).sort((a, b) => a - b)[Math.floor(activities.length / 2)]
            }
          }
        }
      }
    });
  },
  enrichmentProgress: (completed: number, total: number, lastEnriched: string) => {
    activityLoggerBase.info('Activity enrichment progress', {
      tags: ['enrichment', 'progress'],
      completed,
      total,
      lastEnriched,
      percentage: Math.round((completed / total) * 100)
    });
  },
  planningStart: (totalDays: number, totalActivities: number) => {
    activityLoggerBase.info('Starting daily plan generation', {
      tags: ['planning', 'start'],
      totalDays,
      totalActivities
    });
  },
  dayPlanned: (dayNumber: number, plan: any) => {
    activityLoggerBase.info(`Day ${dayNumber} plan generated`, {
      tags: ['planning', 'day-complete'],
      dayNumber,
      theme: plan.theme,
      mainArea: plan.mainArea,
      activityCount: Object.values(plan.activities).flat().length,
      highlights: plan.highlights
    });
  },
  scheduleOptimized: (dayNumber: number, optimizationDetails: any) => {
    activityLoggerBase.info(`Schedule optimized for day ${dayNumber}`, {
      tags: ['optimization', 'schedule'],
      dayNumber,
      ...optimizationDetails
    });
  },
  optimized: (activities: any[]) => {
    activityLoggerBase.info('Activities optimized', {
      tags: ['optimization', 'complete'],
      count: activities.length,
      distribution: countActivitiesByTimeSlot(activities)
    });
  },
  scoring: (data: any) => {
    activityLoggerBase.info('Activity scoring', {
      tags: ['scoring'],
      timestamp: new Date().toISOString(),
      data: {
        activity_name: data.name,
        base_score: data.baseScore,
        preference_matches: data.preferenceMatches,
        category_score: data.categoryScore,
        time_slot_score: data.timeSlotScore,
        final_score: data.finalScore,
        scoring_explanation: data.explanation
      }
    });
  },
  grouping: (data: any) => {
    activityLoggerBase.info('Activity grouping', {
      tags: ['grouping'],
      ...data
    });
  },
  optimization: (data: any) => {
    activityLoggerBase.info('Activity optimization', {
      tags: ['optimization'],
      ...data
    });
  },
  planNarrative: (dayNumber: number, narrativeData: any) => {
    activityLoggerBase.info('Daily plan narrative elements', {
      tags: ['planning', 'narrative'],
      timestamp: new Date().toISOString(),
      data: {
        day_number: dayNumber,
        narrative: {
          theme_reasoning: {
            selected_theme: narrativeData.theme,
            selection_rationale: narrativeData.themeRationale,
            alignment_with_preferences: narrativeData.themePreferenceAlignment
          },
          daily_flow: {
            morning_strategy: narrativeData.morningStrategy,
            afternoon_progression: narrativeData.afternoonProgression,
            evening_conclusion: narrativeData.eveningConclusion,
            pace_considerations: narrativeData.paceConsiderations
          },
          location_strategy: {
            main_area: narrativeData.mainArea,
            area_selection_reason: narrativeData.areaRationale,
            geographical_progression: narrativeData.geographicalFlow
          },
          highlights_explanation: {
            must_see_attractions: narrativeData.mustSeeAttractions,
            unique_experiences: narrativeData.uniqueExperiences,
            local_insights: narrativeData.localInsights,
            selection_criteria: narrativeData.highlightsCriteria
          },
          practical_considerations: {
            weather_adaptations: narrativeData.weatherConsiderations,
            crowd_management: narrativeData.crowdManagement,
            timing_optimization: narrativeData.timingStrategy,
            break_placement_logic: narrativeData.breakPlacement
          }
        }
      }
    });
  },
  dailyPlanReasoning: (dayNumber: number, reasoningData: any) => {
    activityLoggerBase.info('Daily plan reasoning', {
      tags: ['planning', 'reasoning'],
      timestamp: new Date().toISOString(),
      data: {
        day_number: dayNumber,
        reasoning: {
          activity_selection: {
            morning_choices: reasoningData.morningSelectionReasoning,
            afternoon_choices: reasoningData.afternoonSelectionReasoning,
            evening_choices: reasoningData.eveningSelectionReasoning
          },
          timing_decisions: {
            start_time_rationale: reasoningData.startTimeRationale,
            duration_adjustments: reasoningData.durationAdjustments,
            break_timing_logic: reasoningData.breakTimingLogic
          },
          preference_alignment: {
            interest_matching: reasoningData.interestAlignment,
            pace_consideration: reasoningData.paceAlignment,
            accessibility_adaptations: reasoningData.accessibilityConsiderations,
            dietary_accommodations: reasoningData.dietaryConsiderations
          }
        }
      }
    });
  },
  dailyPlan: (plan: any) => {
    activityLoggerBase.info('Daily plan', {
      tags: ['planning', 'daily'],
      timestamp: new Date().toISOString(),
      data: {
        day_number: plan.dayNumber,
        theme: {
          name: plan.theme,
          rationale: plan.themeRationale,
          preference_alignment: plan.themePreferenceAlignment
        },
        main_area: {
          name: plan.mainArea,
          selection_reason: plan.areaSelectionReason
        },
        narrative: {
          day_overview: plan.dayOverview,
          morning_narrative: plan.morningNarrative,
          afternoon_narrative: plan.afternoonNarrative,
          evening_narrative: plan.eveningNarrative,
          special_considerations: plan.specialConsiderations
        },
        activities: {
          morning: plan.activities.morning.map((a: any) => ({
            name: a.name,
            score: a.preferenceScore,
            selected_reason: a.selectionReason,
            timing_rationale: a.timingRationale,
            connection_to_theme: a.themeConnection
          })),
          afternoon: plan.activities.afternoon.map((a: any) => ({
            name: a.name,
            score: a.preferenceScore,
            selected_reason: a.selectionReason,
            timing_rationale: a.timingRationale,
            connection_to_theme: a.themeConnection
          })),
          evening: plan.activities.evening.map((a: any) => ({
            name: a.name,
            score: a.preferenceScore,
            selected_reason: a.selectionReason,
            timing_rationale: a.timingRationale,
            connection_to_theme: a.themeConnection
          }))
        },
        breaks: {
          ...plan.breaks,
          placement_rationale: plan.breakPlacementRationale
        },
        logistics: {
          ...plan.logistics,
          routing_strategy: plan.routingStrategy,
          transportation_logic: plan.transportationLogic
        },
        highlights: {
          main_attractions: plan.highlights.mainAttractions,
          unique_experiences: plan.highlights.uniqueExperiences,
          local_insights: plan.highlights.localInsights,
          selection_criteria: plan.highlights.selectionCriteria
        },
        commentary: {
          general_flow: plan.commentary,
          practical_tips: plan.practicalTips,
          weather_considerations: plan.weatherConsiderations,
          crowd_management: plan.crowdManagement
        }
      }
    });
  },
  error: (error: any) => {
    activityLoggerBase.error('Activity generation error', {
      tags: ['error'],
      error: {
      message: error.message,
        stack: error.stack,
        details: error.details || error
      }
    });
  }
};

function formatJsonOutput(data: any): string {
  return JSON.stringify(data, null, 2);
}

const logPerplexity = {
  request: (params: any) => {
    perplexityLogger.info('Making Perplexity API request', {
      timestamp: new Date().toISOString(),
      service: 'perplexity',
      level: 'info',
      tags: ['api', 'request'],
      data: {
        request: {
          destination: params.destination,
          days: params.days,
          budget: params.budget,
          preferences: params.preferences,
          scoring_criteria: {
            interests_weight: 2.0,
            pace_weight: 1.5,
            accessibility_weight: 1.0,
            dietary_weight: 1.0,
            travel_style_weight: 1.5
          }
        }
      }
    });
  },
  response: (response: any) => {
    perplexityLogger.info('Received Perplexity API response', {
      timestamp: new Date().toISOString(),
      service: 'perplexity',
      level: 'info',
      tags: ['api', 'response'],
      data: {
        activities: response.activities?.map((a: any) => ({
          name: a.name,
          category: a.category,
          timeSlot: a.timeSlot,
          dayNumber: a.dayNumber,
          duration: a.duration,
          price: a.price,
          location: a.location,
          scoring: {
            total_score: a.preferenceScore,
            matched_preferences: a.matchedPreferences,
            scoring_reason: a.scoringReason,
            category_match: a.categoryMatchScore,
            time_slot_match: a.timeSlotMatchScore,
            price_tier_match: a.priceTierMatchScore
          },
          preselection: {
            selected: a.selected,
            selection_reason: a.selectionReason,
            alternative_slots: a.alternativeTimeSlots
          }
        })),
        daily_plans: response.dailyPlans?.map((plan: any) => ({
          day_number: plan.dayNumber,
          theme: plan.theme,
          main_area: plan.mainArea,
          activities: {
            morning: plan.morning?.activities || [],
            afternoon: plan.afternoon?.activities || [],
            evening: plan.evening?.activities || []
          },
          breaks: plan.breaks,
          logistics: plan.logistics,
          commentary: plan.commentary,
          highlights: plan.highlights
        })),
        optimization: {
          category_distribution: countCategories(response.activities || []),
          time_slot_distribution: countActivitiesByTimeSlot(response.activities || []),
          days_distribution: countActivitiesByDay(response.activities || [])
        }
      }
    });
  },
  error: (error: any) => {
    perplexityLogger.error('Perplexity API error', {
      timestamp: new Date().toISOString(),
      service: 'perplexity',
      level: 'error',
      tags: ['api', 'error'],
      data: {
        error: {
      message: error.message,
          code: error.code,
          stack: error.stack,
          response: error.response?.data
        }
      }
    });
  },
  systemMessage: (message: string) => {
    perplexityLogger.info('System message sent', {
      timestamp: new Date().toISOString(),
      service: 'perplexity',
      level: 'info',
      tags: ['api', 'system'],
      data: {
        message: message
      }
    });
  },
  userMessage: (message: string) => {
    perplexityLogger.info('User message sent', {
      timestamp: new Date().toISOString(),
      service: 'perplexity',
      level: 'info',
      tags: ['api', 'user'],
      data: {
        message: message
      }
    });
  },
  modelResponse: (response: string) => {
    perplexityLogger.info('Model response received', {
      timestamp: new Date().toISOString(),
      service: 'perplexity',
      level: 'info',
      tags: ['api', 'model'],
      data: {
        response: response
      }
    });
  }
};

const logViator = {
  search: (params: any) => {
    viatorLogger.info('Searching Viator activities', {
      timestamp: new Date().toISOString(),
      service: 'viator',
      level: 'info',
      tags: ['api', 'search'],
      data: {
        search: {
          query: params.name,
          destination: params.destination,
          searchParams: params.searchParams
        }
      }
    });
  },
  searchResults: (results: any) => {
    viatorLogger.info('Viator search results', {
      timestamp: new Date().toISOString(),
      service: 'viator',
      level: 'info',
      tags: ['api', 'results'],
      data: {
        results: results.map((r: any) => ({
          productCode: r.productCode,
          name: r.name,
          category: r.category,
          price: r.price,
          rating: r.rating,
          location: {
            address: r.location?.address,
            coordinates: r.location?.coordinates,
            cityName: r.location?.cityName,
            countryName: r.location?.countryName,
            locationId: r.location?.locationId,
            areaId: r.location?.areaId
          },
          duration: r.duration,
          status: 'found'
        }))
      }
    });
  },
  enrichmentStart: (activity: any) => {
    viatorLogger.info('Starting activity enrichment', {
      timestamp: new Date().toISOString(),
      service: 'viator',
      level: 'info',
      tags: ['api', 'enrichment', 'start'],
      data: {
        activity: {
          name: activity.name,
          productCode: activity.productCode,
          status: 'enrichment_started'
        }
      }
    });
  },
  enrichmentComplete: (activity: any, enrichedData: any) => {
    viatorLogger.info('Activity enrichment completed', {
      timestamp: new Date().toISOString(),
      service: 'viator',
      level: 'info',
      tags: ['api', 'enrichment', 'complete'],
      data: {
        activity: {
          name: activity.name,
          productCode: activity.productCode,
          status: 'enrichment_completed',
          enrichment: {
            basicInfo: {
              name: enrichedData.details.name,
              category: enrichedData.details.category,
              duration: enrichedData.details.duration,
              price: enrichedData.details.price
            },
            location: {
              address: enrichedData.details.location.address,
              coordinates: enrichedData.details.location.coordinates,
              cityName: enrichedData.details.location.cityName,
              countryName: enrichedData.details.location.countryName,
              locationId: enrichedData.details.location.locationId,
              areaId: enrichedData.details.location.areaId,
              meetingPoint: enrichedData.details.location.meetingPoint,
              endPoint: enrichedData.details.location.endPoint
            },
            images: enrichedData.images.map((img: any) => ({
              caption: img.caption,
              provider: img.provider,
              variants: img.variants.map((v: any) => ({
                resolution: `${v.width}x${v.height}`,
                format: v.format,
                url: v.url
              }))
            })),
            bookingInfo: enrichedData.bookingInfo,
            reviews: {
              rating: enrichedData.reviews?.rating,
              count: enrichedData.reviews?.count,
              highlights: enrichedData.reviews?.highlights
            },
            operationalDetails: {
              openingHours: enrichedData.details.openingHours,
              bestTimeToVisit: enrichedData.details.bestTimeToVisit,
              seasonality: enrichedData.details.seasonality
            }
          }
        }
      }
    });
  },
  enrichmentFailed: (activity: any, error: any) => {
    viatorLogger.error('Activity enrichment failed', {
      timestamp: new Date().toISOString(),
      service: 'viator',
      level: 'error',
      tags: ['api', 'enrichment', 'error'],
      data: {
        activity: {
          name: activity.name,
          productCode: activity.productCode,
          status: 'enrichment_failed'
        },
        error: {
          message: error.message,
          code: error.code,
          stack: error.stack,
          response: error.response?.data
        }
      }
    });
  },
  error: (error: any) => {
    viatorLogger.error('Viator API error', {
      timestamp: new Date().toISOString(),
      service: 'viator',
      level: 'error',
      tags: ['api', 'error'],
      data: {
        error: {
          message: error.message,
          code: error.code,
          stack: error.stack,
          response: error.response?.data
        }
      }
    });
  }
};

// Update the main logger format
const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss.SSS'
    }),
    winston.format.printf(({ timestamp, level, message, tags = [], ...rest }) => {
      return JSON.stringify({
        timestamp,
        service: 'server',
        level,
        tags: Array.isArray(tags) ? tags : [tags],
        message,
        data: rest
      }, null, 2);
    })
  ),
  transports: [
    new winston.transports.File({ 
      filename: logFile,
      level: 'debug'
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, tags = [], ...rest }) => {
          const colorizedLevel = colors[level.toLowerCase() as keyof typeof colors] || '';
          return `${colorizedLevel}${JSON.stringify({
            timestamp,
            service: 'server',
            level,
            tags: Array.isArray(tags) ? tags : [tags],
            message,
            data: rest
          }, null, 2)}${colors.reset}`;
        })
      )
    })
  ]
});

// Export all loggers
export {
  logger,  // Export as named export
  logActivity,
  logHotelProcessing,
  logPerplexity,
  logViator
};

// Also export logger as default
export default logger; 