// Goldcrest Land & Forestry Market Map - WordPress Plugin Configuration
// Mirrors wp_localize_script('gc-market-map', 'GC_MAP_CONFIG', ...)
window.GC_MAP_CONFIG = {
  // OS Maps API key (OS Data Hub). When set, the standard map uses OS tiles in the style below.
  osApiKey: '',
  osStyle: 'Light_3857', // Light_3857 | Road_3857 | Outdoor_3857
  osMaxNativeZoom: 16,   // OpenData plan tiles go to 16; raise if using the Premium plan
  // ArcGIS Location Platform API key. When set, satellite uses the keyed Esri World Imagery service.
  esriApiKey: '',
  // WP REST API endpoint for wider-market property enquiries: POST JSON {ref,name,phone,email,message,actForMe,gdprConsent,website,property}
  enquiryEndpoint: '/wp-json/goldcrest-map/v1/enquiry',
  restNonce: 'wp_rest_demo_nonce_8f42a1',
  // Wider-market pins are approximate (c. 1 km), so they are hidden beyond this zoom.
  otherMaxZoom: 12,
  // WordPress / Mailchimp / Sync metadata
  recipientEmail: 'office@goldcrestlfg.com',
  mailchimpAudienceId: 'a8f39c12e4',
  mailchimpTag: 'Buyer Inquiry',
  sheetTabName: 'Map (public)',
  // Demo mode renders a local WP REST + Mailchimp dispatch preview instead of POSTing to a static server
  demoMode: true
};
