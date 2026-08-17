const express = require('express');
const router = express.Router();
const Space = require('../models/Space');
const { verifySessionOrGuest, generateGuestToken } = require('../middleware/guestAuth');

router.post('/create', verifySessionOrGuest, async (req, res) => {
    try {
        if (req.user.isGuest) return res.status(403).json({ success: false, message: 'Guests cannot create new Spaces.' });
        const { name, spaceSlug, archetype, visibility, allowGuestPosting } = req.body;
        const existing = await Space.findOne({ spaceSlug });
        if (existing) return res.status(400).json({ success: false, message: 'Space slug already in use.' });

        const space = new Space({
            spaceSlug, name, archetype,
            creatorId: req.user.xameId,
            tenantId: req.user.tenantId || null,
            accessControl: { visibility: visibility || 'public_link', allowGuestPosting: allowGuestPosting !== undefined ? allowGuestPosting : true },
            members: [{ xameId: req.user.xameId, role: 'OWNER', isRegistered: true }]
        });
        await space.save();
        res.json({ success: true, space });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/:slug', verifySessionOrGuest, async (req, res) => {
    try {
        const space = await Space.findOne({ spaceSlug: req.params.slug }).lean();
        if (!space) return res.status(404).json({ success: false, message: 'Space not found.' });
        let guestToken = req.user.isGuest ? generateGuestToken(space.spaceSlug, req) : null;
        res.json({ success: true, space, guestToken, currentUser: req.user });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
