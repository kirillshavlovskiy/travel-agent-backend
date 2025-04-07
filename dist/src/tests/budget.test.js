import request from 'supertest';
import { app } from '../app';
jest.mock('../services/viator');
describe('Budget Calculate Endpoint', () => {
    let mockViatorService;
    beforeEach(() => {
        mockViatorService = {
            getDestinationId: jest.fn(),
            searchActivity: jest.fn(),
            checkRealTimeAvailability: jest.fn(),
            enrichActivityDetails: jest.fn(),
        };
        // Reset all mocks before each test
        jest.clearAllMocks();
    });
    it('should enrich activities with real Viator product data', async () => {
        // Mock Viator service responses
        const mockDestinationId = 'paris-684';
        const mockViatorProduct = {
            productCode: '7845P10',
            title: 'Eiffel Tower Access with Host',
            description: 'Real Viator description',
            pricing: {
                summary: {
                    fromPrice: 104,
                },
                currency: 'EUR'
            },
            bookingInfo: {
                cancellationPolicy: 'Standard cancellation policy',
                confirmationType: 'INSTANT',
                mobileTicketing: true,
                languages: ['English'],
                minParticipants: 1
            },
            available: true,
            reviews: {
                combinedAverageRating: 4.5,
                totalReviews: 4752
            }
        };
        const mockAvailability = {
            available: true,
            pricing: {
                fromPrice: 104,
                currency: 'EUR'
            },
            schedule: {
                openingHours: ['09:00-22:00'],
                availableTimeSlots: ['09:00', '10:00', '11:00']
            }
        };
        mockViatorService.getDestinationId.mockResolvedValue(mockDestinationId);
        mockViatorService.searchActivity.mockResolvedValue([mockViatorProduct]);
        mockViatorService.checkRealTimeAvailability.mockResolvedValue(mockAvailability);
        mockViatorService.enrichActivityDetails.mockImplementation(async (activity) => ({
            ...activity,
            name: mockViatorProduct.title,
            description: mockViatorProduct.description,
            price: {
                amount: mockViatorProduct.pricing.summary.fromPrice,
                currency: mockViatorProduct.pricing.currency
            },
            bookingDetails: {
                provider: 'Viator',
                productCode: mockViatorProduct.productCode,
                referenceUrl: `https://www.viator.com/tours/${mockViatorProduct.productCode}`,
                cancellationPolicy: mockViatorProduct.bookingInfo.cancellationPolicy,
                instantConfirmation: mockViatorProduct.bookingInfo.confirmationType === 'INSTANT',
                mobileTicket: mockViatorProduct.bookingInfo.mobileTicketing,
                languages: mockViatorProduct.bookingInfo.languages,
                minParticipants: mockViatorProduct.bookingInfo.minParticipants
            },
            availability: {
                isAvailable: mockAvailability.available,
                availableTimeSlots: ['morning', 'afternoon'],
                exactStartTimes: mockAvailability.schedule.availableTimeSlots,
                timesByCategory: {
                    morning: ['09:00', '10:00'],
                    afternoon: ['11:00'],
                    evening: []
                },
                realTimeVerification: {
                    verified: true,
                    exactStartTimes: mockAvailability.schedule.availableTimeSlots,
                    lastChecked: expect.any(String)
                }
            },
            enrichmentStatus: 'success'
        }));
        // Test request
        const response = await request(app)
            .post('/budget/calculate')
            .send({
            departureLocation: {
                code: 'PAR',
                label: 'Paris, France'
            },
            destinations: [{
                    code: 'PAR',
                    label: 'Paris, France'
                }],
            startDate: '2025-03-26',
            endDate: '2025-03-29',
            travelers: 2,
            budgetLimit: 2000,
            currency: 'EUR',
            preferences: {
                travelStyle: 'balanced',
                pacePreference: 'moderate',
                interests: ['culture', 'food']
            }
        });
        // Assertions
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        // Verify activities are enriched with Viator data
        const enrichedActivities = response.body.activities;
        expect(enrichedActivities).toBeDefined();
        expect(enrichedActivities.length).toBeGreaterThan(0);
        // Check first activity for Viator enrichment
        const firstActivity = enrichedActivities[0];
        expect(firstActivity).toMatchObject({
            name: expect.any(String),
            description: expect.any(String),
            price: {
                amount: expect.any(Number),
                currency: expect.any(String)
            },
            bookingDetails: {
                provider: 'Viator',
                productCode: expect.any(String),
                referenceUrl: expect.stringContaining('viator.com'),
                cancellationPolicy: expect.any(String),
                instantConfirmation: expect.any(Boolean),
                mobileTicket: expect.any(Boolean),
                languages: expect.any(Array),
                minParticipants: expect.any(Number)
            },
            availability: {
                isAvailable: expect.any(Boolean),
                availableTimeSlots: expect.any(Array),
                exactStartTimes: expect.any(Array),
                timesByCategory: {
                    morning: expect.any(Array),
                    afternoon: expect.any(Array),
                    evening: expect.any(Array)
                },
                realTimeVerification: {
                    verified: true,
                    exactStartTimes: expect.any(Array),
                    lastChecked: expect.any(String)
                }
            },
            enrichmentStatus: 'success'
        });
        // Verify Viator service was called correctly
        expect(mockViatorService.getDestinationId).toHaveBeenCalledWith('Paris');
        expect(mockViatorService.searchActivity).toHaveBeenCalled();
        expect(mockViatorService.checkRealTimeAvailability).toHaveBeenCalled();
        expect(mockViatorService.enrichActivityDetails).toHaveBeenCalled();
    });
});
