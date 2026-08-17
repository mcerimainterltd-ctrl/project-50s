const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const SpaceMessage = require('../models/SpaceMessage');
const { verifySessionOrGuest } = require('../middleware/guestAuth');

// Claim Guest Activity into Permanent Account
router.post('/claim-guest', verifySessionOrGuest, async (req, res) => {
    try {
        if (req.user.isGuest) {
            return res.status(400).json({ success: false, message: 'Must be authenticated as a registered user to claim guest activity.' });
        }

        const { guestToken } = req.body;
        if (!guestToken) {
            return res.status(400).json({ success: false, message: 'guestToken is required.' });
        }

        const secret = process.env.JWT_SECRET || 'xamepage_enterprise_secret_key_2026';
        let decodedGuest;
        try {
            decodedGuest = jwt.verify(guestToken, secret);
        } catch (err) {
            return res.status(401).json({ success: false, message: 'Invalid or expired guest token.' });
        }

        const anonXameId = decodedGuest.xameId || decodedGuest.sub;
        if (!anonXameId) {
            return res.status(400).json({ success: false, message: 'No guest identifier found in token.' });
        }

        // Migrate Space messages from guest ID to registered xameId
        const result = await SpaceMessage.updateMany(
            { senderXameId: anonXameId },
            { 
                $set: { 
                    senderXameId: req.user.xameId, 
                    isGuest: false,
                    senderName: req.user.xameId 
                } 
            }
        );

        res.json({
            success: true,
            claimedCount: result.modifiedCount,
            migratedFrom: anonXameId,
            migratedTo: req.user.xameId
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
