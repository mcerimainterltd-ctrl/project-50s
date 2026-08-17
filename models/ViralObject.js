const mongoose = require('mongoose');

const ViralObjectSchema = new mongoose.Schema({
    objectId: { type: String, required: true, unique: true, index: true },
    objectType: { type: String, enum: ['document', 'event_invite', 'call_room', 'payment_req', 'form'], required: true },
    ownerXameId: { type: String, required: true, index: true },
    spaceSlug: { type: String, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    interactionStats: {
        views: { type: Number, default: 0 },
        guestInteractions: { type: Number, default: 0 },
        conversions: { type: Number, default: 0 }
    }
}, { timestamps: true });

module.exports = mongoose.model('ViralObject', ViralObjectSchema);
