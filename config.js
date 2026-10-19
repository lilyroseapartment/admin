// Admin site settings. Keep STATUSES, CATEGORIES and BLOCKS in sync with apps-script/Code.gs.
window.ADMIN_CONFIG = {
  // Same Apps Script web app URL as the Resident Portal (ends with /exec).
  // Leave empty to preview the admin site in demo mode with sample data: nothing is saved.
  API_URL: 'https://script.google.com/macros/s/AKfycbzXIFmfgxdE059GbBET4XaLPKqerkEXzUwntRsXj_wzYrt1PqXkNQuKT-fB-BNu-uCu/exec',

  // OAuth Client ID from Google Cloud (ends with .apps.googleusercontent.com). See SETUP.md.
  GOOGLE_CLIENT_ID: '681740797489-clmoslhrv5mob0thrnp05nfv20bjqsvc.apps.googleusercontent.com',

  BUILDING_NAME: 'Lily Rose Apartment',
  // Used in the WhatsApp message sent to residents.
  PORTAL_URL: 'https://lilyroseapartment.github.io/',

  // Open cases older than this many days are flagged as overdue.
  OVERDUE_DAYS: 7,

  STATUSES: ['New', 'In Progress', 'Resolved', 'Noted', 'Not Applicable'],
  CLOSED_STATUSES: ['Resolved', 'Noted', 'Not Applicable'],

  BLOCKS: ['A', 'A1', 'B', 'B1', 'C', 'C1', 'D', 'D1', 'E', 'E1', 'F', 'F1', 'G', 'G1'],

  CATEGORIES: [
    'Security & Safety',
    'Parking & Visitors',
    'Building & Common Area',
    'Water Leakage & Plumbing',
    'Cleanliness & Waste',
    'Nuisance & Neighbour Issues',
    'Suggestions & Feedback',
    'Others',
  ],
};
