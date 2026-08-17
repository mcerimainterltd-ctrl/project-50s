const mongoose = require('mongoose');

const MemberSchema = new mongoose.Schema({
    xameId: { type: String, required: true },
    role: { type: String, enum: ['OWNER', 'ADMIN', 'MEMBER', 'GUEST'], default: 'MEMBER' },
    isRegistered: { type: Boolean, default: true },
    joinedAt: { type: Date, default: Date.now }
});

const SpaceSchema = new mongoose.Schema({
    spaceSlug: { type: String, required: true, unique: true, index: true },
    tenantId: { type: String, default: null, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    archetype: { type: String, enum: ['family', 'school', 'business', 'community', 'project', 'event'], required: true },
    creatorId: { type: String, required: true, index: true },
    accessControl: {
        visibility: { type: String, enum: ['private', 'unlisted', 'public_link', 'open'], default: 'public_link' },
        allowGuestPosting: { type: Boolean, default: true },
        requireApproval: { type: Boolean, default: false }
    },
    members: [MemberSchema]
}, { timestamps: true });

module.exports = mongoose.model('Space', SpaceSchema);
