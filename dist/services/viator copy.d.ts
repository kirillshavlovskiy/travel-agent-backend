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
export declare class ViatorService {
    private readonly baseUrl;
    private readonly apiKey;
    constructor(apiKey: string);
    private getDestinations;
    getDestinationId(cityName: string): Promise<string>;
    searchActivity(searchTerm: string): Promise<any>;
    private performSearch;
    private getProductDetails;
    enrichActivityDetails(activity: any): Promise<any>;
    private calculateSimilarity;
    private mapProductToActivity;
    private determineCategory;
    private getPreferredTimeSlot;
    getAvailabilitySchedule(productCode: string): Promise<ViatorAvailabilitySchedule>;
    checkRealTimeAvailability(productCode: string, date: string, travelers: number): Promise<any>;
    private determineTier;
}
export declare const viatorClient: ViatorService;
export {};
