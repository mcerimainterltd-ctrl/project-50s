const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const JWT_SECRET = process.env.JWT_SECRET || 'xamepage_enterprise_secret_key_2026';

function generateGuestToken(spaceSlug = null, req = {}) {
    const fingerPrint = crypto.createHash('sha256').update((req.headers ? req.headers['user-agent'] || '' : '') + (req.ip || '')).digest('hex').substring(0, 16);
    const guestId = `guest_${crypto.randomBytes(8).toString('hex')}`;
    return jwt.sign({ sub: guestId, scope: 'guest_access', allowedSpace: spaceSlug, fingerPrint, type: 'ephemeral' }, JWT_SECRET, { expiresIn: '7d' });
}

function verifySessionOrGuest(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        req.user = { isGuest: true, xameId: `anon_${crypto.randomBytes(4).toString('hex')}` };
        return next();
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.scope === 'guest_access') {
            req.user = { isGuest: true, xameId: decoded.sub, allowedSpace: decoded.allowedSpace };
        } else {
            req.user = { isGuest: false, xameId: decoded.xameId || decoded.sub, userId: decoded.userId, tenantId: decoded.tenantId };
        }
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid or expired session token.' });
    }
}

module.exports = { generateGuestToken, verifySessionOrGuest };
