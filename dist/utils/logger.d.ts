import winston from 'winston';
declare const logger: winston.Logger;
export { logger };
export declare const logHotelProcessing: {
    batchStart: (batchNumber: number, hotelIds: string[]) => void;
    hotelFound: (hotelData: any) => void;
    batchError: (batchNumber: number, error: any) => void;
    searchSummary: (summary: any) => void;
};
export declare const logViatorProcessing: {
    availabilityCheck: (productCode: string, data: any) => void;
    availabilityResult: (productCode: string, data: any) => void;
    error: (productCode: string, error: any) => void;
};
