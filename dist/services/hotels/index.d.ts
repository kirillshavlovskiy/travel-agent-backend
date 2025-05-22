import { HotelOffer, SearchParams } from '../../types/hotel';
interface BatchResponse {
    data?: HotelOffer[];
    errors?: any[];
}
export declare const searchHotels: (params: SearchParams) => Promise<BatchResponse[]>;
export {};
