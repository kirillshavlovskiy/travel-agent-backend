import { Router } from 'express';
import redditRoutes from './reddit.js';
const router = Router();
router.use('/reddit', redditRoutes);
export default router;
