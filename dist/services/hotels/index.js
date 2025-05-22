import { logHotelProcessing } from '../../utils/logger';
import { amadeus } from '../amadeus';
const processHotelBatch = async (hotelIds, batchNumber) => {
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
            response.data.forEach((hotelOffer) => {
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
    }
    catch (error) {
        logHotelProcessing.batchError(batchNumber, error);
        throw error;
    }
};
export const searchHotels = async (params) => {
    const batchSize = 25;
    const hotelIds = params.hotelIds || [];
    const batches = [];
    for (let i = 0; i < hotelIds.length; i += batchSize) {
        batches.push(hotelIds.slice(i, i + batchSize));
    }
    const results = await Promise.all(batches.map((batch, index) => processHotelBatch(batch, index + 1)));
    const summary = {
        totalHotelsFound: results.reduce((acc, r) => acc + (r.data?.length || 0), 0),
        availableHotels: results.reduce((acc, r) => acc + (r.data?.filter((h) => h.available && h.offers?.length > 0).length || 0), 0),
        destinations: params.destinations.map((d) => d.cityCode),
        dateRange: `${params.checkInDate} to ${params.checkOutDate}`
    };
    logHotelProcessing.searchSummary(summary);
    return results;
};
