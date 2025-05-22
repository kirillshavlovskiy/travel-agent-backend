import { Request, Response } from 'express';
declare module 'express-session' {
    interface SessionData {
        user: {
            id: string;
            name: string;
            email: string;
            image: string;
            username: string;
            profileImage: string;
        };
    }
}
export declare const handleGoogleVerify: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const handleGoogleCallback: (req: Request, res: Response) => Promise<void | Response<any, Record<string, any>>>;
export declare const handleRedditCallback: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
