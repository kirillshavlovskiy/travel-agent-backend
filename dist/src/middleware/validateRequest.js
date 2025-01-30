export const validateRequest = (schema) => async (req, res, next) => {
    try {
        await schema.parseAsync(req.body);
        return next();
    }
    catch (error) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: error
        });
    }
};
