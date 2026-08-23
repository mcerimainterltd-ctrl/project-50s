const express    = require('express');
const router     = express.Router();
const Space      = require('../models/Space');
const SpaceMessage = require('../models/SpaceMessage');
const User       = require('../models/User');
const { verifySessionOrGuest, generateGuestToken } = require('../middleware/guestAuth');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'xamepage_enterprise_secret_key_2026';

// ── Mint a Spaces session token for an already-logged-in XamePage user ────────
router.post('/session-token', async (req, res) => {
    try {
        const { xameId } = req.body;
        if (!xameId) return res.status(400).json({ success: false, message: 'xameId required.' });
        const user = await User.findOne({ xameId }).lean();
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
        const token = jwt.sign({ xameId, userId: xameId, scope: 'user_session' }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ success: true, token });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Create Space ──────────────────────────────────────────────────────────────
router.post('/create', verifySessionOrGuest, async (req, res) => {
    try {
        if (req.user.isGuest) return res.status(403).json({ success: false, message: 'Guests cannot create Spaces.' });
        const { name, spaceSlug, archetype, description, visibility, allowGuestPosting } = req.body;
        if (!name || !spaceSlug || !archetype) return res.status(400).json({ success: false, message: 'name, spaceSlug and archetype are required.' });
        const slug = spaceSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const existing = await Space.findOne({ spaceSlug: slug });
        if (existing) return res.status(400).json({ success: false, message: 'Space slug already taken.' });
        const creator = await User.findOne({ xameId: req.user.xameId }).lean();
        const space = new Space({
            spaceSlug: slug, name, archetype,
            description: description || '',
            avatar:      creator?.profilePic || '',
            creatorId:   req.user.xameId,
            accessControl: { visibility: visibility || 'public_link', allowGuestPosting: allowGuestPosting !== false },
            stats: { memberCount: 1 },
            members: [{ xameId: req.user.xameId, role: 'OWNER', isRegistered: true,
                displayName: creator?.preferredName || `${creator?.firstName} ${creator?.lastName}`.trim(),
                avatar: creator?.profilePic || '' }]
        });
        await space.save();
        res.json({ success: true, space });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Get Space ─────────────────────────────────────────────────────────────────
router.get('/:slug', verifySessionOrGuest, async (req, res) => {
    try {
        const space = await Space.findOne({ spaceSlug: req.params.slug }).lean();
        if (!space) return res.status(404).json({ success: false, message: 'Space not found.' });
        const guestToken = req.user.isGuest ? generateGuestToken(space.spaceSlug, req) : null;
        const isMember = space.members.some(m => m.xameId === req.user.xameId);
        res.json({ success: true, space, guestToken, currentUser: req.user, isMember });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Join Space ────────────────────────────────────────────────────────────────
router.post('/:slug/join', verifySessionOrGuest, async (req, res) => {
    try {
        const space = await Space.findOne({ spaceSlug: req.params.slug });
        if (!space) return res.status(404).json({ success: false, message: 'Space not found.' });
        const already = space.members.some(m => m.xameId === req.user.xameId);
        if (!already) {
            let displayName = 'Guest';
            let avatar = '';
            if (!req.user.isGuest) {
                const user = await User.findOne({ xameId: req.user.xameId }).lean();
                displayName = user?.preferredName || `${user?.firstName} ${user?.lastName}`.trim();
                avatar = user?.profilePic || '';
            } else {
                displayName = req.body.displayName || 'Guest';
            }
            space.members.push({ xameId: req.user.xameId, role: req.user.isGuest ? 'GUEST' : 'MEMBER',
                isRegistered: !req.user.isGuest, displayName, avatar });
            space.stats.memberCount = space.members.length;
            await space.save();
        }
        const guestToken = req.user.isGuest ? generateGuestToken(space.spaceSlug, req) : null;
        res.json({ success: true, space, guestToken });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Get Messages ──────────────────────────────────────────────────────────────
router.get('/:slug/messages', verifySessionOrGuest, async (req, res) => {
    try {
        const { before, limit = 30 } = req.query;
        const query = { spaceSlug: req.params.slug, deleted: false };
        if (before) query.createdAt = { $lt: new Date(before) };
        const messages = await SpaceMessage.find(query)
            .sort({ createdAt: -1 }).limit(parseInt(limit)).lean();
        res.json({ success: true, messages: messages.reverse() });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Send Message ──────────────────────────────────────────────────────────────
router.post('/:slug/messages', verifySessionOrGuest, async (req, res) => {
    try {
        const space = await Space.findOne({ spaceSlug: req.params.slug }).lean();
        if (!space) return res.status(404).json({ success: false, message: 'Space not found.' });
        if (req.user.isGuest && !space.accessControl.allowGuestPosting)
            return res.status(403).json({ success: false, message: 'Guest posting is disabled.' });
        const { text, mediaUrl, mediaType, fileName, replyToId, replyToText } = req.body;
        if (!text && !mediaUrl) return res.status(400).json({ success: false, message: 'text or mediaUrl required.' });
        let senderName = 'Guest', senderAvatar = '';
        if (!req.user.isGuest) {
            const user = await User.findOne({ xameId: req.user.xameId }).lean();
            senderName   = user?.preferredName || `${user?.firstName} ${user?.lastName}`.trim();
            senderAvatar = user?.profilePic || '';
        } else {
            const member = space.members?.find(m => m.xameId === req.user.xameId);
            senderName = member?.displayName || req.body.displayName || 'Guest';
        }
        const msg = await SpaceMessage.create({
            spaceSlug: req.params.slug, senderId: req.user.xameId,
            senderName, senderAvatar, isGuest: req.user.isGuest,
            text: text || '', mediaUrl: mediaUrl || '', mediaType: mediaType || '',
            fileName: fileName || '', replyToId: replyToId || null,
            replyToText: replyToText || '',
        });
        await Space.updateOne({ spaceSlug: req.params.slug }, { $inc: { 'stats.messageCount': 1 } });
        res.json({ success: true, message: msg });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── React to Message ──────────────────────────────────────────────────────────
router.post('/:slug/messages/:msgId/react', verifySessionOrGuest, async (req, res) => {
    try {
        const { emoji } = req.body;
        const msg = await SpaceMessage.findById(req.params.msgId);
        if (!msg) return res.status(404).json({ success: false, message: 'Message not found.' });
        const existing = msg.reactions.find(r => r.userId === req.user.xameId && r.emoji === emoji);
        if (existing) {
            msg.reactions = msg.reactions.filter(r => !(r.userId === req.user.xameId && r.emoji === emoji));
        } else {
            msg.reactions.push({ emoji, userId: req.user.xameId });
        }
        await msg.save();
        res.json({ success: true, reactions: msg.reactions });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Delete Message ────────────────────────────────────────────────────────────
router.delete('/:slug/messages/:msgId', verifySessionOrGuest, async (req, res) => {
    try {
        const msg = await SpaceMessage.findById(req.params.msgId);
        if (!msg) return res.status(404).json({ success: false, message: 'Message not found.' });
        const space = await Space.findOne({ spaceSlug: req.params.slug }).lean();
        const isOwner = space?.members.find(m => m.xameId === req.user.xameId && ['OWNER','ADMIN'].includes(m.role));
        if (msg.senderId !== req.user.xameId && !isOwner)
            return res.status(403).json({ success: false, message: 'Not authorized.' });
        msg.deleted = true;
        await msg.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Get Media Gallery ─────────────────────────────────────────────────────────
router.get('/:slug/media', verifySessionOrGuest, async (req, res) => {
    try {
        const media = await SpaceMessage.find({
            spaceSlug: req.params.slug, mediaUrl: { $ne: '' }, deleted: false
        }).sort({ createdAt: -1 }).limit(50).lean();
        res.json({ success: true, media });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Get Members ───────────────────────────────────────────────────────────────
router.get('/:slug/members', verifySessionOrGuest, async (req, res) => {
    try {
        const space = await Space.findOne({ spaceSlug: req.params.slug }).lean();
        if (!space) return res.status(404).json({ success: false, message: 'Space not found.' });
        res.json({ success: true, members: space.members });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Update Space Settings ─────────────────────────────────────────────────────
router.patch('/:slug', verifySessionOrGuest, async (req, res) => {
    try {
        const space = await Space.findOne({ spaceSlug: req.params.slug });
        if (!space) return res.status(404).json({ success: false, message: 'Space not found.' });
        const isOwner = space.members.some(m => m.xameId === req.user.xameId && ['OWNER','ADMIN'].includes(m.role));
        if (!isOwner) return res.status(403).json({ success: false, message: 'Not authorized.' });
        const { name, description, avatar, coverImage, visibility, allowGuestPosting, requireApproval, pinnedMessageId } = req.body;
        if (name) space.name = name;
        if (description !== undefined) space.description = description;
        if (avatar) space.avatar = avatar;
        if (coverImage) space.coverImage = coverImage;
        if (visibility) space.accessControl.visibility = visibility;
        if (allowGuestPosting !== undefined) space.accessControl.allowGuestPosting = allowGuestPosting;
        if (requireApproval !== undefined) space.accessControl.requireApproval = requireApproval;
        if (pinnedMessageId !== undefined) space.pinnedMessageId = pinnedMessageId;
        await space.save();
        res.json({ success: true, space });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Claim Guest Messages on Register ─────────────────────────────────────────
router.post('/:slug/claim', verifySessionOrGuest, async (req, res) => {
    try {
        if (req.user.isGuest) return res.status(403).json({ success: false, message: 'Must be registered.' });
        const { guestId } = req.body;
        const result = await SpaceMessage.updateMany(
            { spaceSlug: req.params.slug, senderId: guestId, claimedBy: null },
            { $set: { claimedBy: req.user.xameId, senderId: req.user.xameId } }
        );
        res.json({ success: true, claimed: result.modifiedCount });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── My Spaces ─────────────────────────────────────────────────────────────────
router.get('/', verifySessionOrGuest, async (req, res) => {
    try {
        if (req.user.isGuest) return res.json({ success: true, spaces: [] });
        const spaces = await Space.find({ 'members.xameId': req.user.xameId })
            .sort({ updatedAt: -1 }).lean();
        res.json({ success: true, spaces });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
