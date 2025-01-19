import { logHotelProcessing } from '../../utils/logger';
import { amadeus } from '../amadeus';
import { HotelOffer, SearchParams } from '../../types/hotel';

interface BatchResponse {
  data?: HotelOffer[];
  errors?: any[];
}

const processHotelBatch = async (hotelIds: string[], batchNumber: number): Promise<BatchResponse> => {
  try {
    logHotelProcessing.batchStart(batchNumber, hotelIds);
    
    const response = await amadeus.shopping.hotelOffers.get({
      hotelIds: hotelIds.join(','),
      adults: '2',
      checkInDate: '2025-01-20',
      checkOutDate: '2025-01-25',
      roomQuantity: '1',
      currency: 'USD'
    });

    if (response.data) {
      response.data.forEach((hotelOffer: HotelOffer) => {
        if (hotelOffer.available && hotelOffer.offers?.length > 0) {
          logHotelProcessing.hotelFound({
            id: hotelOffer.hotel.hotelId,
            name: hotelOffer.hotel.name,
            offers: hotelOffer.offers
          });
        }
      });
    }

    return response;
  } catch (error) {
    logHotelProcessing.batchError(batchNumber, error);
    throw error;
  }
};

export const searchHotels = async (params: SearchParams): Promise<BatchResponse[]> => {
  const batchSize = 25;
  const hotelIds = params.hotelIds || [];
  const batches = [];
  
  for (let i = 0; i < hotelIds.length; i += batchSize) {
    batches.push(hotelIds.slice(i, i + batchSize));
  }

  const results = await Promise.all(
    batches.map((batch, index) => processHotelBatch(batch, index + 1))
  );
  
  const summary = {
    totalHotelsFound: results.reduce((acc: number, r: BatchResponse) => 
      acc + (r.data?.length || 0), 0),
    availableHotels: results.reduce((acc: number, r: BatchResponse) => 
      acc + (r.data?.filter((h: HotelOffer) => h.available && h.offers?.length > 0).length || 0), 0),
    destinations: params.destinations.map((d: { cityCode: string }) => d.cityCode),
    dateRange: `${params.checkInDate} to ${params.checkOutDate}`
  };

  logHotelProcessing.searchSummary(summary);
  
  return results;
};
