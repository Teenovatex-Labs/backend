import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
export const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        next();
    }
    catch (error) {
        res.status(401).json({ error: 'Unauthorized' });
    }
};
//# sourceMappingURL=authMiddleware.js.map