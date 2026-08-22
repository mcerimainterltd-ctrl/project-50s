const mongoose = require('mongoose');

const MemberSchema = new mongoose.Schema({
    xameId:       { type: String, required: true },
    role:         { type: String, enum: ['OWNER', 'ADMIN', 'MEMBER', 'GUEST'], default: 'MEMBER' },
    isRegistered: { type: Boolean, default: true },
    displayName:  { type: String, default: '' },
    avatar:       { type: String, default: '' },
    joinedAt:     { type: Date, default: Date.now },
    lastSeen:     { type: Date, default: Date.now },
});

const SpaceSchema = new mongoose.Schema({
    spaceSlug:   { type: String, required: true, unique: true, index: true },
    tenantId:    { type: String, default: null, index: true },
    name:        { type: String, required: true },
    description: { type: String, default: '' },
    avatar:      { type: String, default: '' },
    coverImage:  { type: String, default: '' },
    archetype:   { type: String, enum: ['family', 'school', 'business', 'community', 'project', 'event'], required: true },
    creatorId:   { type: String, required: true, index: true },
    accessControl: {
        visibility:        { type: String, enum: ['private', 'unlisted', 'public_link', 'open'], default: 'public_link' },
        allowGuestPosting: { type: Boolean, default: true },
        requireApproval:   { type: Boolean, default: false },
        allowGuestCalls:   { type: Boolean, default: false },
    },
    wallet: {
        enabled:  { type: Boolean, default: false },
        balance:  { type: Number, default: 0 },
        currency: { type: String, default: 'NGN' },
    },
    stats: {
        messageCount: { type: Number, default: 0 },
        mediaCount:   { type: Number, default: 0 },
        memberCount:  { type: Number, default: 0 },
    },
    members:  [MemberSchema],
    pinnedMessageId: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Space', SpaceSchema);
