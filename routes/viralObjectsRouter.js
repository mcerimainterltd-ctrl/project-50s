const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const ViralObject = require('../models/ViralObject');
const SpaceMessage = require('../models/SpaceMessage');
const Space = require('../models/Space');
const { verifySessionOrGuest } = require('../middleware/guestAuth');

// Generate a Viral Object (File, Event, Call Room)
router.post('/create', verifySessionOrGuest, async (req, res) => {
    try {
        const { objectType, payload, spaceSlug } = req.body;
        const objectId = `obj_${crypto.randomBytes(6).toString('hex')}`;

        const viralObj = new ViralObject({
            objectId,
            objectType,
            ownerXameId: req.user.xameId,
            spaceSlug: spaceSlug || null,
            payload
        });

        await viralObj.save();
        res.json({
            success: true,
            objectId,
            shareUrl: `https://xamepage.com/${objectType}/${objectId}`,
            viralObj
        });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Resolve a Viral Object (Public Web View)
router.get('/:objectId', async (req, res) => {
    try {
        const viralObj = await ViralObject.findOne({ objectId: req.params.objectId });
        if (!viralObj) return res.status(404).json({ success: false, message: 'Object not found.' });

        viralObj.interactionStats.views += 1;
        await viralObj.save();

        res.json({ success: true, viralObj });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Post a Message to a Space (Supports Guests)
router.post('/space/:slug/messages', verifySessionOrGuest, async (req, res) => {
    try {
        const { text, senderName } = req.body;
        const space = await Space.findOne({ spaceSlug: req.params.slug });

        if (!space) return res.status(404).json({ success: false, message: 'Space not found.' });
        if (req.user.isGuest && !space.accessControl.allowGuestPosting) {
            return res.status(403).json({ success: false, message: 'Guest posting is disabled for this Space.' });
        }

        const msg = new SpaceMessage({
            spaceSlug: req.params.slug,
            senderXameId: req.user.xameId,
            senderName: senderName || (req.user.isGuest ? 'Guest User' : req.user.xameId),
            isGuest: req.user.isGuest,
            text
        });

        await msg.save();
        res.json({ success: true, message: msg });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Get Messages for a Space
router.get('/space/:slug/messages', verifySessionOrGuest, async (req, res) => {
    try {
        const messages = await SpaceMessage.find({ spaceSlug: req.params.slug })
            .sort({ createdAt: -1 })
            .limit(50);
        res.json({ success: true, messages });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
