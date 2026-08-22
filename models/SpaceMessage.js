const mongoose = require('mongoose');

const SpaceMessageSchema = new mongoose.Schema({
    spaceSlug:   { type: String, required: true, index: true },
    senderId:    { type: String, required: true },
    senderName:  { type: String, default: 'Guest' },
    senderAvatar:{ type: String, default: '' },
    isGuest:     { type: Boolean, default: false },
    text:        { type: String, default: '' },
    mediaUrl:    { type: String, default: '' },
    mediaType:   { type: String, enum: ['image', 'video', 'audio', 'file', ''], default: '' },
    fileName:    { type: String, default: '' },
    replyToId:   { type: String, default: null },
    replyToText: { type: String, default: '' },
    reactions:   [{ emoji: String, userId: String }],
    claimedBy:   { type: String, default: null }, // when guest registers
    deleted:     { type: Boolean, default: false },
}, { timestamps: true });

SpaceMessageSchema.index({ spaceSlug: 1, createdAt: -1 });

module.exports = mongoose.model('SpaceMessage', SpaceMessageSchema);
