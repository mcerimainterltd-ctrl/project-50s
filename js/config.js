/*
 * config.js
 * All application-level constants and configuration.
 * XamePage v2.1
 */

const APP_VERSION = '2.1';

//  Server URL 
const isCapacitorNative = () =>
  !!(window.Capacitor?.isNativePlatform?.());

const isPackagedApp = isCapacitorNative();

// Always use Render URL - works for APK, PWA, and localhost
const serverURL = 'https://project-50s.onrender.com';

//  Storage keys 
const KEYS = {
  user:     'xame:user',
  contacts: 'xame:contacts',
  chat:     (id) => `xame:chat:${id}`,
  drafts:   'xame:drafts',
  settings: 'xame:settings',
  version:  '2.1',
};

//  File upload limits 
const FILE_CONFIG = {
  maxSize: 500 * 1024 * 1024, // 500 MB
  allowedTypes: {
    images:    ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
    videos:    ['video/mp4', 'video/webm', 'video/ogg'],
    audio:     ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4'],
    documents: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/javascript',
      'application/javascript',
      'application/x-javascript',
      'text/css',
      'text/html',
    ],
  },
};

//  WebRTC 
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls:       'turn:openrelay.metered.ca:80',
      username:   'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

//  Socket / reconnection 
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY   = 1500; // ms
const HEARTBEAT_INTERVAL     = 30000; // ms

//  Message pagination 
const MESSAGE_PAGE_SIZE = 100;

//  VAPID public key (push notifications) 
const VAPID_PUBLIC_KEY =
  'BKRD94hqX829Dy5EobzJRdUJRMMGJp_Irma-KBPOAtgn6CvK-FvSVnjRuAlelMfqBrKVsd47HvpciMr_ZpBenL8';
