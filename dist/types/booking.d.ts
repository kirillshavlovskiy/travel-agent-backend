export interface PaymentCardInfo {
    vendorCode: string;
    cardNumber: string;
    expiryDate: string;
    holderName: string;
}
export interface GuestInfo {
    title?: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
}
export interface BookingRequest {
    offerId: string;
    guest: GuestInfo;
    payment: PaymentCardInfo;
}
export interface BookingResponse {
    success: boolean;
    data: {
        id: string;
        type: string;
        hotelBookings: Array<{
            id: string;
            bookingStatus: string;
            hotelProviderInformation: Array<{
                hotelProviderCode: string;
                confirmationNumber: string;
            }>;
            hotel: {
                hotelId: string;
                name: string;
            };
        }>;
    };
}
