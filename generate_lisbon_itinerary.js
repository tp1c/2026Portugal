const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

class DocBuilder {
  constructor() {
    this.text = '';
    this.requests = [];
  }

  append(str, style = {}) {
    const start = this.text.length + 1; // 1-based index
    this.text += str;
    const end = this.text.length + 1;

    const textStyle = {};
    let hasTextStyle = false;

    if (style.bold) { textStyle.bold = true; hasTextStyle = true; }
    if (style.italic) { textStyle.italic = true; hasTextStyle = true; }
    if (style.fontSize) { textStyle.fontSize = { magnitude: style.fontSize, unit: 'PT' }; hasTextStyle = true; }
    if (style.foregroundColor) { textStyle.foregroundColor = { color: { rgbColor: style.foregroundColor } }; hasTextStyle = true; }

    if (hasTextStyle) {
      this.requests.push({
        updateTextStyle: {
          range: { startIndex: start, endIndex: end },
          textStyle,
          fields: Object.keys(textStyle).join(','),
        },
      });
    }

    if (style.paragraphStyle) {
      this.requests.push({
        updateParagraphStyle: {
          range: { startIndex: start, endIndex: end },
          paragraphStyle: { namedStyleType: style.paragraphStyle },
          fields: 'namedStyleType',
        },
      });
    }
  }

  getRequests() {
    const initialRequest = {
      insertText: {
        location: { index: 1 },
        text: this.text,
      },
    };
    return [initialRequest, ...this.requests];
  }
}

async function createGoogleDoc(auth, scheduleValues, bookingValues, packingValues) {
  const docs = google.docs({ version: 'v1', auth });
  
  console.log('Creating a new Google Doc for the Travel Guide...');
  const createResponse = await docs.documents.create({
    requestBody: {
      title: 'Viking Portugal\'s River of Gold - Lisbon 4-Day Travel Guide',
    },
  });

  const documentId = createResponse.data.documentId;
  const documentUrl = `https://docs.google.com/document/d/${documentId}/edit`;
  console.log(`Google Doc created: ${documentId}`);

  const doc = new DocBuilder();

  // Primary colors
  const primaryGold = { red: 0.549, green: 0.463, blue: 0.247 }; // #8c763f
  const accentBlue = { red: 0.180, green: 0.290, blue: 0.384 };  // #2e4a62

  // 1. Header
  doc.append("VIKING RIVER CRUISES\n", { bold: true, fontSize: 11, foregroundColor: primaryGold });
  doc.append("Portugal's River of Gold\n", { bold: true, fontSize: 24, foregroundColor: accentBlue, paragraphStyle: 'TITLE' });
  doc.append("Lisbon 4-Day Pre-Cruise Itinerary (July 18 – July 22, 2026)\n\n", { italic: true, fontSize: 11, paragraphStyle: 'SUBTITLE' });

  // 2. Metadata Section
  doc.append("GUEST STAY & BOOKINGS\n", { bold: true, fontSize: 14, foregroundColor: accentBlue, paragraphStyle: 'HEADING_1' });
  for (let i = 1; i < bookingValues.length; i++) {
    const [category, detail, dateTime, location, status] = bookingValues[i];
    doc.append(`• ${category}: `, { bold: true, fontSize: 11 });
    doc.append(`${detail} | ${dateTime} (${location}) — Status: ${status}\n`, { fontSize: 11 });
  }
  doc.append("\n", {});

  // 3. Walkability Pro-Tips
  doc.append("💡 LISBON WALKABILITY PRO-TIPS\n", { bold: true, fontSize: 14, foregroundColor: primaryGold, paragraphStyle: 'HEADING_1' });
  doc.append("Lisbon is built on extremely steep hills. Walkways are paved in traditional calçada portuguesa (cobblestones) which are highly slick when worn down or damp. High-traction rubber soles are mandatory. Avoid unnecessary uphill climbs by utilizing vertical transit shortcuts (metro station escalators, public lifts, and vintage Tram 25).\n\n", { italic: true, fontSize: 10.5 });

  // 4. Daily Schedule
  doc.append("DAILY SCHEDULE\n", { bold: true, fontSize: 16, foregroundColor: accentBlue, paragraphStyle: 'HEADING_1' });

  let currentDay = '';
  for (let i = 1; i < scheduleValues.length; i++) {
    const [day, time, location, logistics, notes] = scheduleValues[i];
    if (day !== currentDay) {
      currentDay = day;
      doc.append(`\n${currentDay}\n`, { bold: true, fontSize: 13, foregroundColor: primaryGold, paragraphStyle: 'HEADING_2' });
    }

    doc.append(`  ${time} | ${location}\n`, { bold: true, fontSize: 11, foregroundColor: accentBlue });
    doc.append(`  ↳ Logistics: ${logistics}\n`, { fontSize: 10, italic: true });
    doc.append(`  ↳ Notes: ${notes}\n\n`, { fontSize: 10 });
  }

  // 5. Packing Checklist
  doc.append("🎒 LISBON ESSENTIAL PACKING CHECKLIST\n", { bold: true, fontSize: 14, foregroundColor: accentBlue, paragraphStyle: 'HEADING_1' });

  const packingGroups = {};
  for (let i = 1; i < packingValues.length; i++) {
    const [category, item] = packingValues[i];
    if (!packingGroups[category]) packingGroups[category] = [];
    packingGroups[category].push(item);
  }

  for (const [category, items] of Object.entries(packingGroups)) {
    doc.append(`\n${category.toUpperCase()}\n`, { bold: true, fontSize: 11, foregroundColor: primaryGold, paragraphStyle: 'HEADING_2' });
    for (const item of items) {
      doc.append(`  ☐ ${item}\n`, { fontSize: 10 });
    }
  }

  // Write content to document
  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: doc.getRequests(),
    },
  });

  return documentUrl;
}

async function run() {
  try {
    const auth = await loadSavedCredentialsIfExist();
    if (!auth) {
      console.error('Error: Token not found. Please authenticate first by running node scratch/test_sheets.js');
      return;
    }

    const sheets = google.sheets({ version: 'v4', auth });
    console.log('Creating a new Google Sheet for the Lisbon Itinerary...');

    // 1. Create a new Spreadsheet
    const spreadsheetResponse = await sheets.spreadsheets.create({
      resource: {
        properties: {
          title: 'Viking Portugal\'s River of Gold - Lisbon 4-Day Itinerary',
        },
      },
      fields: 'spreadsheetId,spreadsheetUrl',
    });

    const spreadsheetId = spreadsheetResponse.data.spreadsheetId;
    const spreadsheetUrl = spreadsheetResponse.data.spreadsheetUrl;
    console.log(`Spreadsheet created: ${spreadsheetId}`);

    // Tab sheet IDs
    const scheduleSheetId = 0;
    const bookingsSheetId = 10001;
    const packingSheetId = 10002;

    // Data definitions (without flight details)
    const scheduleValues = [
      ['Day', 'Time', 'Location', 'Logistics & Walkability', 'Local Vibe & Notes'],
      // Lisbon Pre-Cruise Stay
      ['Day 1 (Sat Jul 18)', '11:05 AM', 'LIS Airport to Corinthia Hotel', 'Viking Transfer included. Corinthia Hotel (Avenida Columbano Bordalo Pinheiro 105).', 'Upon arrival, you will be met at the airport by a Viking Representative who will accompany you to the Corinthia Hotel. Check-in, unpack, and relax.'],
      ['Day 1 (Sat Jul 18)', '2:00 PM', 'Pingo Doce Sete Rios', '5-10 min flat walk from the hotel.', 'Supermarket run for local Portuguese wines, fresh bakery items, and snacks. Avoid overpriced hotel shops—this is where the local neighborhood shops.'],
      ['Day 1 (Sat Jul 18)', '6:30 PM', 'Erva Restaurante & Bar', '0 km (Located inside the Corinthia Hotel).', 'Welcome Dinner. Enjoy a contemporary, authentic twist on traditional Portuguese cuisine using local ingredients in a lively, relaxed atmosphere.'],
      ['Day 2 (Sun Jul 19)', '08:45 AM', 'Viking Cosmopolitan Lisbon Tour', 'Coach departs from hotel. Guided walk in Bairro Alto. Steep inclines.', 'Discover the streets of Lisbon and ascend up to Bairro Alto. Cobalt-blue tiles, traditional streets, and panoramic views. Walkways are paved in traditional cobblestones—high-traction rubber soles are mandatory.'],
      ['Day 2 (Sun Jul 19)', '1:00 PM', 'Lunch at O Trevo', '1.1 km flat walk from Baixa, or short metro ride.', 'Skip overcrowded Time Out Market. Step into this classic local tasca (tavern) for an authentic bifana (marinated pork sandwich) with local commuters.'],
      ['Day 2 (Sun Jul 19)', '3:00 PM', 'Eduardo VII Park', 'Metro Blue Line to Parque station. Gentle slopes.', 'Stroll in one of the city\'s loveliest public parks with geometric hedge displays overlooking the Tagus River.'],
      ['Day 2 (Sun Jul 19)', '7:30 PM', 'Authentic Fado Evening', 'Metro to Alfama district. Steep walking and cobblestones.', 'Venture into the historic Alfama district for a traditional, soulful Fado music performance and dinner at an atmospheric local restaurant.'],
      ['Day 3 (Mon Jul 20)', '08:30 AM', 'Tour Departure: Sintra & Cascais Day-Trip', 'Vision Tours Portugal van pickup (air-conditioned van, 8–8.5 hours total). Wheelchair accessible.', 'Board the air-conditioned van for the day-trip. Base price $35/person (excludes monument entries). Pre-purchase entry tickets to Quinta da Regaleira and Pena Palace to secure slots.'],
      ['Day 3 (Mon Jul 20)', '09:30 AM', 'Pena Palace (Sintra)', '1.5-hour visit. Steep hills, stairs, and cobblestones. High-traction shoes mandatory.', 'Explore the whimsical and colorful fairytale Pena Palace. Save time and avoid massive queues for the cramped rooms by choosing the €10 ($11) "Park and Exterior" ticket. The exterior terraces offer spectacular views.'],
      ['Day 3 (Mon Jul 20)', '11:30 AM', 'Quinta da Regaleira', '1.5-hour visit. Winding paths, narrow tunnels, and the 27-meter Initiation Well. Entry: €22 ($24).', 'Explore the mystical, Masonic-inspired estate of Quinta da Regaleira, including the lush gardens, secret tunnels, and the famous well. Watch your step on damp stairs.'],
      ['Day 3 (Mon Jul 20)', '01:30 PM', 'Cabo da Roca & Roca Coast', 'Scenic drive and photo stop. Exposed cliffs, windy conditions.', 'Enjoy a scenic drive along the dramatic Atlantic coastline of Cabo da Roca, the westernmost point of continental Europe, with cliffs dropping 140 meters.'],
      ['Day 3 (Mon Jul 20)', '02:30 PM', 'Lunch & Stroll in Cascais Fishing Village', 'Stop for lunch and stroll in historic center. Flat coastal walking.', 'Seaside town with beautiful beaches. Tip: Skip the overpriced tourist traps on the main squares and look for a quiet, authentic tasca tucked away in backstreets for fresh seafood.'],
      ['Day 3 (Mon Jul 20)', '05:00 PM', 'Return Transfer & City Center Drop-off', 'Ask driver for drop-off in city center (e.g., Restauradores/Chiado), or take Metro/taxi from hotel.', 'Board the tour van for the return transfer. Spend the late afternoon strolling through the beautiful plazas and watching the city come alive under evening lights.'],
      ['Day 3 (Mon Jul 20)', '08:00 PM', 'Dinner in Chiado (City Center)', 'Walk to dining venue. Return to Corinthia Hotel via Metro Blue Line (to Sete Rios) or Uber.', 'Dine at an acclaimed spot like Bairro do Avillez (seafood/tapas) or Sacramento (romantic vaulted palace cellars). Reservations are mandatory.'],
      ['Day 4 (Tue Jul 21)', '08:30 AM', 'Tour Departure: Fátima, Batalha, Nazaré & Óbidos', 'GetYourGuide small-group tour (max 8 participants). Air-conditioned vehicle.', 'Board the air-conditioned van. Base price from $58/person. Live guide/driver. 10-hour total duration. Pick-up from hotel/central point.'],
      ['Day 4 (Tue Jul 21)', '10:00 AM', 'Fátima Sanctuary', '1.5-hour drive from Lisbon. Flat, massive open plaza.', 'Major Christian pilgrimage site. Visit the Chapel of Apparitions and the Basilica of Our Lady of Fátima where the three shepherd children are buried.'],
      ['Day 4 (Tue Jul 21)', '11:45 AM', 'Batalha Monastery', '30-minute drive. UNESCO World Heritage Site. Large adjacent parking lot.', 'Stunning 14th-century Gothic masterpiece built to thank the Virgin Mary. Receives far fewer crowds than monuments in Lisbon, providing a peaceful experience.'],
      ['Day 4 (Tue Jul 21)', '01:15 PM', 'Lunch & Sightseeing in Nazaré', '30-minute drive. Ride the modern funicular (every 15 mins) up to the clifftop Sítio district.', 'Seaside town famous for the world\'s largest surf waves. Tip: Dine at Taberna d\'Adelia (Michelin-reviewed seafood). Look for local women drying fish on beach racks.'],
      ['Day 4 (Tue Jul 21)', '03:45 PM', 'Óbidos Medieval Walled Town', '30-minute drive. Enclosed by 13th-century stone walls. Cobblestone pathways.', 'Walk the ancient perimeter walls (Caution: 20-30 ft high, no railings). Try Ginja de Óbidos (sour cherry liqueur) in an edible chocolate cup from a local vendor.'],
      ['Day 4 (Tue Jul 21)', '05:30 PM', 'Return Transfer to Lisbon', '1-hour drive back, arriving in Lisbon around 06:30 PM.', 'Relax on the drive back. Drop-off at Corinthia Hotel. The evening is free to rest before your cruise check-in tomorrow.'],
      ['Day 4 (Tue Jul 21)', '08:00 PM', 'Farewell Dinner at hotel (Erva or Soul Garden)', '0 km (On-site at Corinthia Lisbon).', 'Enjoy a relaxing final night dinner at the hotel. Get a good night\'s rest before checking out tomorrow and boarding the Viking Osfrid in Porto.'],
      
      // Douro River Cruise Portion
      ['Day 5 (Wed Jul 22)', '06:45 AM', 'Luggage Pick Up & Room Checkout', 'Luggage outside room by 6:45 AM. Checkout by 8:00 AM.', 'Place your bags with colored tags outside your hotel room. Hand in keys at front desk.'],
      ['Day 5 (Wed Jul 22)', '08:15 AM', 'Lisbon to Porto Transfer via Coimbra', 'Viking Motorcoach transfer (approx. 4-4.5 hours total travel time).', 'Board the air-conditioned motorcoach for the journey north. Luggage will be transferred directly to the ship for you.'],
      ['Day 5 (Wed Jul 22)', '11:30 AM', 'Coimbra Included Excursion & Lunch', 'Moderate walking on slopes. Coimbra University (UNESCO World Heritage Site).', 'Included Excursion. Tour the historic university, including the spectacular Joanina Library. Afterward, enjoy a traditional Portuguese lunch (included).'],
      ['Day 5 (Wed Jul 22)', '04:30 PM', 'Porto Embarkation (Vila Nova de Gaia)', 'Board the Viking Osfrid docked at Vila Nova de Gaia. Settle into your stateroom.', 'Welcome onboard! Settle into your stateroom, explore the ship, and relax in the Lounge.'],
      ['Day 5 (Wed Jul 22)', '05:00 PM', 'Drinks & Live Music in the Lounge', 'Casual get-together in the Lounge.', 'Meet fellow guests, enjoy drinks, and listen to live music by onboard musician Thiago.'],
      ['Day 5 (Wed Jul 22)', '06:30 PM', 'Welcome Toast', 'Lounge event.', 'Join Captain Bernardino and Hotel Manager Claus in the Lounge for a formal welcome toast.'],
      ['Day 5 (Wed Jul 22)', '06:45 PM', 'Welcome Briefing & Port Talk', 'Lounge event.', 'Attend the mandatory ship safety briefing with the management team, followed by Port Talk with Program Director Lidia to preview tomorrow\'s activities.'],
      ['Day 5 (Wed Jul 22)', '07:15 PM', 'First Onboard Dinner', 'Dinner in the Ship\'s Restaurant.', 'Executive Chef Mihai and Maitre d\' Andre welcome you for a delicious multi-course dinner.'],
      ['Day 5 (Wed Jul 22)', '09:15 PM', 'Lecture: Portugal Today & Music', 'Lounge event.', 'Onboard guest lecturer discusses the history and culture of modern Portugal, followed by an evening of music and dancing with Thiago.'],
      // Day 6 (Thu Jul 23)
      ['Day 6 (Thu Jul 23)', '06:00 AM', 'Café Breakfast Available', 'In front of the Restaurant.', 'Coffee and pastries are available at the coffee station.'],
      ['Day 6 (Thu Jul 23)', '06:30 AM', 'Cast Off: Depart Porto', 'Viking Osfrid leaves Vila Nova de Gaia for Pinhão.', 'Early morning departure. Head to the Lounge or Sun Deck to watch the ship depart Porto.'],
      ['Day 6 (Thu Jul 23)', '07:30 AM', 'Breakfast Buffet', 'Enjoy breakfast in the Restaurant.', 'Enjoy a buffet breakfast and a choice of dishes cooked to order in the Restaurant (runs until 09:30 AM).'],
      ['Day 6 (Thu Jul 23)', '08:30 AM', 'Crestuma-Lever Lock Passage', 'Crestuma-Lever Lock (Rise: 14.1 meters).', 'Passage through your first lock on the Douro River.'],
      ['Day 6 (Thu Jul 23)', '10:00 AM', 'Presentation: Portugal & the Douro River', 'Lounge presentation.', 'Join Program Director Lídia in the Lounge for an talk about Portugal and the Douro River.'],
      ['Day 6 (Thu Jul 23)', '11:00 AM', 'Live Demonstration: Cork', 'Lounge live demonstration.', 'Learn all about the production, harvesting, and uses of Portuguese cork with Paula.'],
      ['Day 6 (Thu Jul 23)', '11:40 AM', 'Carrapatelo Lock Passage', 'Carrapatelo Lock (Rise: 35 meters).', 'Pass through the deepest lock in Europe. A spectacular engineering feat.'],
      ['Day 6 (Thu Jul 23)', '12:30 PM', 'Lunch onboard', 'Lunch in the Restaurant.', 'Enjoy a freshly prepared lunch as the ship continues sailing.'],
      ['Day 6 (Thu Jul 23)', '02:00 PM', 'Arrive in Lamego (Excursion Drop-off)', 'Viking Osfrid makes a brief stop in Lamego.', 'Welcome to Lamego. Disembark here for the afternoon included shore excursion.'],
      ['Day 6 (Thu Jul 23)', '02:30 PM', 'Included Excursion: Mateus Palace & Gardens', 'Shore Excursion. Moderate walking. Bring audio receivers (runs until 05:45 PM).', 'Included Excursion. Visit the grand Mateus Palace (the elegant Baroque estate depicted on Mateus Rosé wine labels). Stroll the manicured hedge gardens, chapel, and interior rooms.'],
      ['Day 6 (Thu Jul 23)', '03:00 PM', 'Ship Cast Off: Lamego to Pinhão', 'Viking Osfrid departs Lamego.', 'While guests are on the excursion, the ship casts off and continues sailing upstream to Pinhão.'],
      ['Day 6 (Thu Jul 23)', '03:30 PM', 'Bagaúste Lock Passage', 'Scenic cruising (ship only). Bagaúste Lock (Rise: 29.5 meters).', 'The ship passes through Bagaúste Lock during its transit to Pinhão.'],
      ['Day 6 (Thu Jul 23)', '05:00 PM', 'Drinks & Live Music in the Lounge', 'Casual get-together in the Lounge (runs until 07:00 PM).', 'Rejoin the ship in Pinhão. Enjoy drinks and live music by onboard musician Thiago.'],
      ['Day 6 (Thu Jul 23)', '05:30 PM', 'Welcome to Pinhão', 'Viking Osfrid arrives in Pinhão.', 'The ship docks in Pinhão, the heart of the Port wine region.'],
      ['Day 6 (Thu Jul 23)', '06:45 PM', 'Port Talk', 'Lounge event.', 'Join Program Director Lídia in the Lounge to find out details about tomorrow\'s excursions and events.'],
      ['Day 6 (Thu Jul 23)', '07:00 PM', 'Dinner', 'Dinner in the Restaurant.', 'Join fellow guests for a delicious dinner in the Restaurant.'],
      ['Day 6 (Thu Jul 23)', '09:00 PM', 'Evening Entertainment', 'Lounge event.', 'Enjoy an evening of music and dancing with Thiago in the Lounge.'],
      // Day 7 (Fri Jul 24)
      ['Day 7 (Fri Jul 24)', '06:00 AM', 'Café Breakfast Available', 'In front of the Lounge.', 'Coffee and pastries are available at the coffee station.'],
      ['Day 7 (Fri Jul 24)', '06:30 AM', 'Cast Off: Pinhão to Pocinho', 'Viking Osfrid leaves Pinhão for Pocinho.', 'Enjoy a scenic morning sail down the Douro River.'],
      ['Day 7 (Fri Jul 24)', '07:30 AM', 'Breakfast Buffet', 'Enjoy breakfast in the Restaurant.', 'Buffet breakfast with made-to-order dishes available (runs until 09:30 AM).'],
      ['Day 7 (Fri Jul 24)', '08:30 AM', 'Valeira Lock Passage', 'Scenic cruising. Valeira Lock (Rise: 33 meters).', 'Pass through the impressive Valeira Lock.'],
      ['Day 7 (Fri Jul 24)', '10:00 AM', 'Live Demonstration: Pastel de Nata', 'Lounge event.', 'Meet Chef Misha in the Lounge and learn how to make the famous Portuguese custard tarts.'],
      ['Day 7 (Fri Jul 24)', '11:00 AM', 'Pocinho Lock Passage', 'Scenic cruising. Pocinho Lock (Rise: 20 meters).', 'Passage through Pocinho Lock.'],
      ['Day 7 (Fri Jul 24)', '11:40 AM', 'Welcome to Pocinho (Excursion Drop-off)', 'Viking Osfrid makes a brief stop in Pocinho.', 'Disembark for the afternoon optional excursions, or stay onboard for lunch.'],
      ['Day 7 (Fri Jul 24)', '12:00 PM', 'Ship Cast Off: Pocinho to Barca d\'Alva', 'Viking Osfrid departs Pocinho.', 'The ship continues its journey to Barca d\'Alva while guests are on tour.'],
      ['Day 7 (Fri Jul 24)', '12:00 PM', 'Optional Excursion: Marialva Castle & Lunch', 'Optional Excursion (runs until 05:15 PM).', 'Visit the historical ruins of Marialva Castle and enjoy a local lunch.'],
      ['Day 7 (Fri Jul 24)', '12:30 PM', 'Lunch onboard', 'Lunch in the Restaurant.', 'Freshly prepared lunch is served for guests staying onboard.'],
      ['Day 7 (Fri Jul 24)', '02:15 PM', 'Welcome to Barca d\'Alva', 'Viking Osfrid arrives in Barca d\'Alva.', 'The ship docks in Barca d\'Alva, near the Spanish border.'],
      ['Day 7 (Fri Jul 24)', '02:30 PM', 'Included Excursion: Castelo Rodrigo', 'Shore Excursion. Bring audio receivers (runs until 05:00 PM).', 'Included Excursion. Tour the historic, fortified hilltop village of Castelo Rodrigo near the Spanish border. Taste local almonds and honey.'],
      ['Day 7 (Fri Jul 24)', '05:00 PM', 'Drinks & Live Music in the Lounge', 'Casual get-together in the Lounge (runs until 06:45 PM).', 'Enjoy drinks and live music by onboard musician Thiago.'],
      ['Day 7 (Fri Jul 24)', '06:45 PM', 'Port Talk', 'Lounge event.', 'Join Program Director Lídia in the Lounge to find out details about tomorrow\'s excursions and events.'],
      ['Day 7 (Fri Jul 24)', '07:00 PM', 'Dinner: Taste of Portugal', 'Dinner in the Restaurant.', 'Enjoy a hearty, traditional Portuguese dinner accompanied by Portuguese music.'],
      ['Day 7 (Fri Jul 24)', '08:45 PM', 'Evening Entertainment: Flamenco Show', 'Lounge performance.', 'Enjoy a special live Flamenco performance by the Solearte troupe, followed by music and dancing with Thiago.'],

      // Day 8 (Sat Jul 25)
      ['Day 8 (Sat Jul 25)', '06:00 AM', 'Café Breakfast Available', 'In front of the Restaurant.', 'Coffee and pastries are available.'],
      ['Day 8 (Sat Jul 25)', '07:00 AM', 'Breakfast Buffet', 'Enjoy breakfast in the Restaurant.', 'Breakfast is served in the Restaurant (runs until 09:00 AM).'],
      ['Day 8 (Sat Jul 25)', '08:15 AM', 'Included Excursion: A Day in Salamanca', 'Shore Excursion. 9-hour duration (runs until 06:45 PM).', 'Included Excursion. Full day coach excursion to Salamanca, Spain. Visit the UNESCO-listed Salamanca University, Plaza Mayor, and the New Cathedral. Includes traditional lunch and Flamenco performance. Motorcoaches depart: A (8:15 AM), B (8:30 AM), C (8:45 AM).'],
      ['Day 8 (Sat Jul 25)', '12:00 PM', 'Lunch onboard', 'Lunch in the Restaurant.', 'Lunch is served for guests staying onboard.'],
      ['Day 8 (Sat Jul 25)', '01:00 PM', 'Cast Off: Barca d\'Alva to Pocinho', 'Viking Osfrid departs Barca d\'Alva.', 'The ship sails downstream back toward Pocinho.'],
      ['Day 8 (Sat Jul 25)', '03:00 PM', 'Welcome to Pocinho', 'Viking Osfrid arrives in Pocinho.', 'The ship docks in Pocinho.'],
      ['Day 8 (Sat Jul 25)', '05:00 PM', 'Drinks & Live Music in the Lounge', 'Casual get-together in the Lounge (runs until 06:45 PM).', 'Gather in the Lounge for drinks and live music with Thiago.'],
      ['Day 8 (Sat Jul 25)', '07:15 PM', 'Port Talk', 'Lounge event.', 'Join Program Director Lídia in the Lounge to find out details about tomorrow\'s excursions and events.'],
      ['Day 8 (Sat Jul 25)', '07:30 PM', 'Dinner', 'Dinner in the Restaurant.', 'Join fellow guests for dinner.'],
      ['Day 8 (Sat Jul 25)', '09:30 PM', 'Evening Entertainment: Disco Night', 'Lounge event.', 'Enjoy a fun Disco Night with Thiago and Program Director Lídia in the Lounge.'],

      // Day 9 (Sun Jul 26)
      ['Day 9 (Sun Jul 26)', '06:00 AM', 'Café Breakfast Available', 'In front of the Restaurant.', 'Coffee and pastries are available.'],
      ['Day 9 (Sun Jul 26)', '07:00 AM', 'Breakfast Buffet', 'Enjoy breakfast in the Restaurant.', 'Breakfast is served in the Restaurant (runs until 09:00 AM).'],
      ['Day 9 (Sun Jul 26)', '08:45 AM', 'Included Excursion: Favaios Bakery & Quinta Avessada', 'Shore Excursion (runs until 03:00 PM).', 'Included Excursion. Visit the historic hilltop village of Favaios to see a traditional wood-fired bakery, followed by lunch and Moscatel tasting at Quinta da Avessada.'],
      ['Day 9 (Sun Jul 26)', '08:45 AM', 'Cast Off: Pocinho to Folgosa', 'Viking Osfrid departs Pocinho.', 'The ship continues downstream while guests are on the excursion.'],
      ['Day 9 (Sun Jul 26)', '09:00 AM', 'Pocinho Lock Passage', 'Scenic cruising. Pocinho Lock (Rise: 20 meters).', 'Passing through Pocinho Lock.'],
      ['Day 9 (Sun Jul 26)', '11:50 AM', 'Valeira Lock Passage', 'Scenic cruising. Valeira Lock (Rise: 33 meters).', 'Passing through Valeira Lock.'],
      ['Day 9 (Sun Jul 26)', '12:00 PM', 'Lunch onboard', 'Lunch in the Restaurant.', 'Lunch is served for guests staying onboard.'],
      ['Day 9 (Sun Jul 26)', '02:30 PM', 'Welcome to Folgosa (Rejoin Ship)', 'Viking Osfrid makes a brief stop in Folgosa.', 'Guests returning from the Favaios excursion rejoin the ship.'],
      ['Day 9 (Sun Jul 26)', '03:10 PM', 'Ship Cast Off: Folgosa to Régua', 'Viking Osfrid departs Folgosa.', 'The ship sails toward Régua.'],
      ['Day 9 (Sun Jul 26)', '04:00 PM', 'Bagaúste Lock Passage', 'Scenic cruising. Bagaúste Lock (Rise: 29.5 meters).', 'Passing through Bagaúste Lock.'],
      ['Day 9 (Sun Jul 26)', '04:30 PM', 'Presentation: Discover the World of Viking', 'Lounge event.', 'Join Lídia in the Lounge to talk about different Viking itineraries and exclusive onboard discounts.'],
      ['Day 9 (Sun Jul 26)', '05:00 PM', 'Welcome to Régua', 'Viking Osfrid arrives in Régua.', 'The ship docks in Peso da Régua.'],
      ['Day 9 (Sun Jul 26)', '05:00 PM', 'Drinks & Live Music in the Lounge', 'Casual get-together in the Lounge (runs until 07:00 PM).', 'Enjoy drinks and live music with Thiago.'],
      ['Day 9 (Sun Jul 26)', '06:15 PM', 'Viking Explorer Society Cocktail Party', 'Lounge event.', 'Explorer Society cocktail party for returning Viking guests.'],
      ['Day 9 (Sun Jul 26)', '06:45 PM', 'Port Talk', 'Lounge event.', 'Join Program Director Lídia in the Lounge to find out details about tomorrow\'s excursions and events.'],
      ['Day 9 (Sun Jul 26)', '07:00 PM', 'Dinner', 'Dinner in the Restaurant.', 'Enjoy dinner in the Restaurant.'],
      ['Day 9 (Sun Jul 26)', '09:00 PM', 'Evening Entertainment: Trivia & Music', 'Lounge event.', 'Join Lídia in the Lounge for "Guess the answer: Portugal & the Douro Edition" trivia, followed by music with Thiago.'],

      // Day 10 (Mon Jul 27)
      ['Day 10 (Mon Jul 27)', '06:00 AM', 'Café Breakfast Available', 'In front of the Restaurant.', 'Coffee and pastries are available.'],
      ['Day 10 (Mon Jul 27)', '07:00 AM', 'Breakfast Buffet', 'Enjoy breakfast in the Restaurant.', 'Breakfast is served in the Restaurant (runs until 09:00 AM).'],
      ['Day 10 (Mon Jul 27)', '08:15 AM', 'Optional Excursion: Cistercians & Wines', 'Optional Excursion (runs until 01:00 PM).', 'Explore Cistercian architecture and enjoy a local wine tasting.'],
      ['Day 10 (Mon Jul 27)', '08:30 AM', 'Included Excursion: Charming Lamego', 'Shore Excursion. Choice of walking down 686 stairs (runs until 01:00 PM).', 'Included Excursion. Visit the Shrine of Our Lady of Remedies, see the tiled baroque landings, and explore the town of Lamego.'],
      ['Day 10 (Mon Jul 27)', '08:30 AM', 'Cast Off: Régua to Entre-os-Rios', 'Viking Osfrid departs Régua.', 'The ship departs Régua while guests are on the excursion.'],
      ['Day 10 (Mon Jul 27)', '11:15 AM', 'Carrapatelo Lock Passage', 'Scenic cruising. Carrapatelo Lock (Rise: 35 meters).', 'Passing through Carrapatelo Lock.'],
      ['Day 10 (Mon Jul 27)', '12:30 PM', 'Welcome to Entre-os-Rios (Rejoin Ship)', 'Viking Osfrid makes a brief stop in Entre-os-Rios.', 'Guests returning from the Lamego excursion rejoin the ship.'],
      ['Day 10 (Mon Jul 27)', '12:45 PM', 'Lunch onboard', 'Lunch in the Restaurant.', 'Lunch is served as the ship continues sailing.'],
      ['Day 10 (Mon Jul 27)', '01:00 PM', 'Ship Cast Off: Entre-os-Rios to Porto', 'Viking Osfrid departs Entre-os-Rios.', 'The ship heads back toward Porto.'],
      ['Day 10 (Mon Jul 27)', '02:55 PM', 'Crestuma Lock Passage', 'Scenic cruising. Crestuma Lock (Rise: 14.1 meters).', 'Passing through Crestuma Lock.'],
      ['Day 10 (Mon Jul 27)', '04:15 PM', 'Teatime in the Lounge', 'Lounge event.', 'Enjoy traditional tea, scones, pastries, and sandwiches in the Lounge.'],
      ['Day 10 (Mon Jul 27)', '05:00 PM', 'Welcome to Porto / Gaia', 'Viking Osfrid arrives in Porto.', 'The ship docks at Vila Nova de Gaia (Porto).'],
      ['Day 10 (Mon Jul 27)', '05:00 PM', 'Disembarkation Briefing', 'Lounge event.', 'Join Lídia in the Lounge for important details regarding your disembarkation.'],
      ['Day 10 (Mon Jul 27)', '05:00 PM', 'Drinks & Live Music in the Lounge', 'Casual get-together in the Lounge (runs until 06:45 PM).', 'Enjoy drinks and live music with Thiago.'],
      ['Day 10 (Mon Jul 27)', '06:00 PM', 'Vintage Port Wine Demonstration', 'Lounge event.', 'Learn the traditional art of opening vintage port bottles using fire and ice with Maitre d\' Andre and Bar Chef Susanto.'],
      ['Day 10 (Mon Jul 27)', '06:45 PM', 'Port Talk', 'Lounge event.', 'Join Lídia in the Lounge to preview tomorrow\'s activities.'],
      ['Day 10 (Mon Jul 27)', '07:00 PM', 'Dinner', 'Dinner in the Restaurant.', 'Enjoy dinner in the Restaurant.'],
      ['Day 10 (Mon Jul 27)', '09:00 PM', 'Evening Entertainment: Tuna Folk Show', 'Lounge performance.', 'Enjoy a lively traditional Tuna Folk Show performance in the Lounge, followed by music with Thiago.'],

      // Day 11 (Tue Jul 28)
      ['Day 11 (Tue Jul 28)', '06:00 AM', 'Café Breakfast Available', 'In front of the Restaurant.', 'Coffee and pastries are available.'],
      ['Day 11 (Tue Jul 28)', '07:00 AM', 'Breakfast Buffet', 'Enjoy breakfast in the Restaurant.', 'Breakfast is served in the Restaurant (runs until 09:00 AM).'],
      ['Day 11 (Tue Jul 28)', '08:30 AM', 'Included Excursion: Porto on Foot', 'Shore Excursion (runs until 12:15 PM).', 'Included Excursion. Guided walking tour of historic Porto (UNESCO World Heritage Site), including tiled São Bento Station and Cathedral. Sign up at Desk.'],
      ['Day 11 (Tue Jul 28)', '12:30 PM', 'Lunch onboard', 'Lunch in the Restaurant.', 'Lunch is served in the Restaurant.'],
      ['Day 11 (Tue Jul 28)', '01:45 PM', 'Optional Excursion: Quinta da Aveleda', 'Optional Excursion (runs until 05:45 PM).', 'Visit the beautiful Aveleda estate and gardens, followed by a wine tasting.'],
      ['Day 11 (Tue Jul 28)', '01:45 PM', 'Optional Excursion: Historic Guimarães', 'Optional Excursion (runs until 06:15 PM).', 'Visit the birthplace of Portugal and its medieval castle.'],
      ['Day 11 (Tue Jul 28)', '02:00 PM', 'Porto City Shuttle Service', 'Gaia dock to Porto City Center (runs until 05:00 PM).', 'Complimentary shuttle service provided for exploring Porto at your leisure.'],
      ['Day 11 (Tue Jul 28)', '03:20 PM', 'Optional Excursion: Port Wine Cellars', 'Optional Excursion (runs until 04:45 PM).', 'Guided tour and tasting at a historic port wine cellar in Vila Nova de Gaia.'],
      ['Day 11 (Tue Jul 28)', '05:30 PM', 'Drinks & Live Music in the Lounge', 'Casual get-together in the Lounge (runs until 06:30 PM).', 'Enjoy drinks and live music with Thiago.'],
      ['Day 11 (Tue Jul 28)', '06:30 PM', 'Captain\'s Cocktail Party & Farewell', 'Lounge event.', 'Join Captain Bernardino for a farewell toast, followed by final farewell remarks from Program Director Lidia at 06:45 PM.'],
      ['Day 11 (Tue Jul 28)', '07:00 PM', 'Captain\'s Farewell Dinner', 'Dinner in the Restaurant.', 'Celebrate the cruise with a special farewell dinner.'],
      ['Day 11 (Tue Jul 28)', '09:00 PM', 'Evening Entertainment', 'Lounge event.', 'Enjoy final evening music and dancing in the Lounge with Thiago.'],
      ['Day 12 (Wed Jul 29)', '08:00 AM', 'Porto Disembarkation & Departure', 'Viking transfer to Porto Airport (OPO) or hotel.', 'Breakfast onboard, checkout, and transfer for your return flight or post-cruise extension.']
    ];

    const bookingValues = [
      ['Category', 'Detail', 'Date/Time', 'Reference/Location', 'Status'],
      ['Hotel', 'The Corinthia Lisbon', 'July 18 – July 22, 2026', 'Avenida Columbano Bordalo Pinheiro 105', 'Included in pre-cruise package'],
      ['Tour', 'Sintra, Pena, Regaleira, Roca Coast & Cascais Tour (Vision Tours)', 'Monday, July 20, 2026 (08:30 AM)', 'Vision Tours Portugal ($35/person base)', 'To be booked (Recommend pre-purchasing tickets)'],
      ['Tour', 'Fátima, Batalha, Nazaré & Óbidos Small-Group Tour (GetYourGuide)', 'Tuesday, July 21, 2026 (08:30 AM)', 'GetYourGuide ($58/person base)', 'To be booked (Small-group tour max 8 participants)'],
      ['Cruise', 'Viking Osfrid (7 Nights)', 'July 22 – July 29, 2026', 'Booking Ref: 9706751', 'Portugal\'s River of Gold (Porto to Porto)'],
      ['Transfer', 'Lisbon to Porto Motorcoach & Coimbra Stop', 'Wednesday, July 22, 2026 (08:30 AM)', 'Viking Motorcoach Transfer', 'Included in cruise package']
    ];

    const packingValues = [
      ['Category', 'Item', 'Packed?'],
      ['Documents', 'Passports & photocopy backups', false],
      ['Documents', 'Viking Cruise Invoice & Tickets (Booking: 9706751)', false],
      ['Documents', 'Credit Cards & Cash (Euros for small tascas/tours)', false],
      ['Electronics', 'Universal Travel Adapter (Portugal uses Type C/F plugs)', false],
      ['Electronics', 'Mobile Phone, Camera & Chargers', false],
      ['Electronics', 'Power Bank (Portable Charger)', false],
      ['Electronics', 'eSIM or International Roaming activated', false],
      ['Clothing', 'High-Traction walking shoes (for slick cobblestones)', false],
      ['Clothing', 'Light summer clothes (Portugal in July is hot and sunny)', false],
      ['Clothing', 'Smart-casual attire (for shipboard dinners)', false],
      ['Clothing', 'Light jacket / windbreaker (for cool ocean/river breeze and locks)', false],
      ['Clothing', 'Sunglasses, sunscreen (broad spectrum) & sun hat', false],
      ['Medication', 'Personal daily medications', false],
      ['Medication', 'Motion sickness tablets / Sea-Bands (for cruise/trams)', false]
    ];

    console.log('Adding tabs and data...');

    // Rename default sheet to "📅 Daily Schedule" and add custom tab IDs
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: scheduleSheetId,
                title: '📅 Daily Schedule',
              },
              fields: 'title',
            },
          },
          {
            addSheet: {
              properties: {
                sheetId: bookingsSheetId,
                title: '🏨 Hotel & Cruise Bookings',
              },
            },
          },
          {
            addSheet: {
              properties: {
                sheetId: packingSheetId,
                title: '🎒 Packing List',
              },
            },
          },
        ],
      },
    });

    // Write Daily Schedule
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: '\'📅 Daily Schedule\'!A1',
      valueInputOption: 'USER_ENTERED',
      resource: { values: scheduleValues },
    });

    // Write Hotel & Cruise Bookings
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: '\'🏨 Hotel & Cruise Bookings\'!A1',
      valueInputOption: 'USER_ENTERED',
      resource: { values: bookingValues },
    });

    // Write Packing List
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: '\'🎒 Packing List\'!A1',
      valueInputOption: 'USER_ENTERED',
      resource: { values: packingValues },
    });

    // Apply Checkboxes to Column C (Column index 2) of Packing List Sheet
    console.log('Configuring checkbox validation...');
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            setDataValidation: {
              range: {
                sheetId: packingSheetId,
                startRowIndex: 1, // Skip header row
                endRowIndex: packingValues.length,
                startColumnIndex: 2, // Column C (0-indexed)
                endColumnIndex: 3
              },
              rule: {
                condition: {
                  type: 'BOOLEAN'
                },
                showCustomUi: true
              }
            }
          }
        ]
      }
    });

    console.log('Data populated and checkboxes configured successfully!');
    console.log(`Google Sheet URL: ${spreadsheetUrl}`);

    // Generate Google Doc
    let docUrl = null;
    try {
      docUrl = await createGoogleDoc(auth, scheduleValues, bookingValues, packingValues);
      console.log(`Google Doc URL: ${docUrl}`);
    } catch (docsError) {
      console.error('Error generating Google Doc details:', docsError);
      console.warn('\n⚠️  Warning: Failed to generate Google Doc. Google Docs API is disabled in your project.');
      console.warn('Please enable it by visiting:');
      console.warn('https://console.developers.google.com/apis/api/docs.googleapis.com/overview?project=684061168650\n');
    }

    // 3. Write local travel_guide.html and index.html (Netlify entry point)
    const htmlContent = generateHTMLReport(spreadsheetUrl, docUrl, scheduleValues, packingValues);
    const htmlPath = path.join(__dirname, 'travel_guide.html');
    await fs.writeFile(htmlPath, htmlContent);
    console.log(`HTML report generated: ${htmlPath}`);

    const indexPath = path.join(__dirname, 'index.html');
    await fs.writeFile(indexPath, htmlContent);
    console.log(`Index HTML generated: ${indexPath}`);

  } catch (err) {
    console.error('Error running script:', err);
  }
}

function generateHTMLReport(sheetUrl, docUrl, scheduleValues, packingValues) {
  // 1. Generate daily schedule HTML
  let scheduleHtml = '';
  let currentDay = '';
  let currentPhase = '';
  
  for (let i = 1; i < scheduleValues.length; i++) {
    const [day, time, location, logistics, notes] = scheduleValues[i];
    if (day !== currentDay) {
      if (currentDay !== '') {
        scheduleHtml += `        </div>\n`; // close previous day-section
      }
      currentDay = day;
      
      const dayParts = day.split(' ');
      let dayNum = dayParts[0] + ' ' + dayParts[1]; // "Day X"
      let dayIndex = parseInt(dayParts[1]);
      let phase = dayIndex <= 4 ? 'Lisbon Pre-Cruise Stay' : 'Viking Douro River Cruise';
      if (phase !== currentPhase) {
        currentPhase = phase;
        scheduleHtml += `        <div class="phase-header">
            <h2>${currentPhase}</h2>
        </div>\n`;
      }

      let dayTitle = day;
      if (day.includes('Day 1 ')) dayTitle = 'Saturday, July 18, 2026 – Arrival & Acclimation';
      else if (day.includes('Day 2 ')) dayTitle = 'Sunday, July 19, 2026 – Historic Heights & Fado';
      else if (day.includes('Day 3 ')) dayTitle = 'Monday, July 20, 2026 – Sintra, Pena Palace, Regaleira & Cascais Day-Trip';
      else if (day.includes('Day 4 ')) dayTitle = 'Tuesday, July 21, 2026 – Fátima, Batalha, Nazaré & Óbidos Day-Trip';
      else if (day.includes('Day 5 ')) dayTitle = 'Wednesday, July 22, 2026 – Coimbra Stop & Porto Embarkation';
      else if (day.includes('Day 6 ')) dayTitle = 'Thursday, July 23, 2026 – Porto City Tour & Bitetos Scenic Sailing';
      else if (day.includes('Day 7 ')) dayTitle = 'Friday, July 24, 2026 – Régua & Vila Real (Mateus Palace)';
      else if (day.includes('Day 8 ')) dayTitle = 'Saturday, July 25, 2026 – Pinhão Railway Station & Favaios Village';
      else if (day.includes('Day 9 ')) dayTitle = 'Sunday, July 26, 2026 – Salamanca (Spain) Full-Day Excursion';
      else if (day.includes('Day 10 ')) dayTitle = 'Monday, July 27, 2026 – Castelo Rodrigo Fortified Hilltop Village';
      else if (day.includes('Day 11 ')) dayTitle = 'Tuesday, July 28, 2026 – Lamego Pilgrimage & Porto Cellars';
      else if (day.includes('Day 12 ')) dayTitle = 'Wednesday, July 29, 2026 – Porto Disembarkation & Departure';

      scheduleHtml += `        <div class="day-section">
            <div class="day-header">
                <span class="day-num">${dayNum}</span>
                <span class="day-title">${dayTitle}</span>
            </div>\n`;
    }

    let icon = '🚗';
    if (logistics.toLowerCase().includes('walk') || logistics.toLowerCase().includes('incline')) {
      icon = '🚶';
    } else if (logistics.toLowerCase().includes('van') || logistics.toLowerCase().includes('coach') || logistics.toLowerCase().includes('vehicle') || logistics.toLowerCase().includes('motorcoach')) {
      icon = '🚌';
    } else if (logistics.toLowerCase().includes('metro') || logistics.toLowerCase().includes('train')) {
      icon = '🚇';
    } else if (logistics.toLowerCase().includes('restaurant') || logistics.toLowerCase().includes('dine') || logistics.toLowerCase().includes('lunch') || logistics.toLowerCase().includes('dinner')) {
      icon = '🍴';
    } else if (logistics.toLowerCase().includes('monastery') || logistics.toLowerCase().includes('palace') || logistics.toLowerCase().includes('monument') || logistics.toLowerCase().includes('sanctuary')) {
      icon = '🏰';
    } else if (logistics.toLowerCase().includes('sailing') || logistics.toLowerCase().includes('cruise') || logistics.toLowerCase().includes('lock') || logistics.toLowerCase().includes('ship') || logistics.toLowerCase().includes('embark')) {
      icon = '🚢';
    } else if (logistics.toLowerCase().includes('hotel') || logistics.toLowerCase().includes('corinthia')) {
      icon = '🏨';
    }

    scheduleHtml += `            <div class="event-card">
                <div class="event-header">
                    <span class="event-location">${location}</span>
                    <span class="event-time">${time}</span>
                </div>
                <p class="event-details">${notes}</p>
                <div class="event-logistics">${icon} Logistics & Walkability: ${logistics}</div>
            </div>\n`;
  }
  if (currentDay !== '') {
    scheduleHtml += `        </div>\n`;
  }

  // 2. Generate packing checklist HTML
  const packingGroups = {};
  for (let i = 1; i < packingValues.length; i++) {
    const [category, item] = packingValues[i];
    if (!packingGroups[category]) packingGroups[category] = [];
    packingGroups[category].push(item);
  }

  let packingHtml = '';
  const categoryIcons = {
    'documents': '📋',
    'electronics': '🔌',
    'clothing': '👟',
    'medication': '💊',
    'gear': '🎒',
    'toiletries': '🧴'
  };

  for (const [category, items] of Object.entries(packingGroups)) {
    const lowerCat = category.toLowerCase();
    const catIcon = categoryIcons[lowerCat] || '📦';
    const catTitle = category.charAt(0).toUpperCase() + category.slice(1);
    
    packingHtml += `                <div class="packing-category">
                    <h4>${catIcon} ${catTitle}</h4>\n`;
    for (const item of items) {
      packingHtml += `                    <div class="packing-item"><span class="checkbox"></span> ${item}</div>\n`;
    }
    packingHtml += `                </div>\n`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>12-Day Travel Guide | Lisbon & Viking Douro River Cruise</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800&family=Playfair+Display:ital,wght@0,600;0,800;1,600&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #8c763f; /* Viking Gold */
            --primary-dark: #6e5a2c;
            --accent: #2e4a62; /* Ocean Blue */
            --bg-light: #faf9f6;
            --card-bg: #ffffff;
            --text-dark: #1c1b18;
            --text-muted: #6e6b64;
            --border: #e3decb;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Outfit', sans-serif;
            background-color: var(--bg-light);
            color: var(--text-dark);
            line-height: 1.6;
            padding: 2.5rem;
        }

        .container {
            max-width: 900px;
            margin: 0 auto;
            background: var(--card-bg);
            padding: 3rem;
            border-radius: 20px;
            border: 1px solid var(--border);
            box-shadow: 0 10px 40px rgba(140, 118, 63, 0.05);
        }

        header {
            text-align: center;
            border-bottom: 2px solid var(--primary);
            padding-bottom: 2rem;
            margin-bottom: 2.5rem;
            position: relative;
        }

        .viking-logo {
            font-family: 'Playfair Display', serif;
            font-weight: 800;
            font-size: 1.2rem;
            letter-spacing: 4px;
            text-transform: uppercase;
            color: var(--primary);
            margin-bottom: 0.5rem;
        }

        h1 {
            font-family: 'Playfair Display', serif;
            font-size: 2.4rem;
            font-weight: 800;
            color: var(--accent);
            margin-bottom: 0.5rem;
        }

        header p {
            color: var(--text-muted);
            font-size: 1.05rem;
            letter-spacing: 1px;
        }

        .meta-info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.5rem;
            margin-bottom: 2.5rem;
            padding: 1.5rem;
            background: rgba(140, 118, 63, 0.03);
            border: 1px solid var(--border);
            border-radius: 12px;
        }

        .meta-item h3 {
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            color: var(--primary);
            margin-bottom: 0.4rem;
        }

        .meta-item p {
            font-size: 1rem;
            font-weight: 600;
            color: var(--text-dark);
        }

        .infographic-container {
            margin-bottom: 2.5rem;
            width: 100%;
            border-radius: 12px;
            overflow: hidden;
            border: 1px solid var(--border);
            box-shadow: 0 4px 12px rgba(140, 118, 63, 0.03);
        }

        .infographic-img {
            width: 100%;
            height: auto;
            display: block;
        }

        .alert-box {
            background: rgba(46, 74, 98, 0.04);
            border-left: 4px solid var(--accent);
            padding: 1.2rem;
            border-radius: 0 8px 8px 0;
            margin-bottom: 2.5rem;
            font-size: 0.95rem;
        }

        .alert-box h4 {
            color: var(--accent);
            font-weight: 700;
            margin-bottom: 0.3rem;
            display: flex;
            align-items: center;
            gap: 0.4rem;
        }

        .phase-header {
            margin: 3.5rem 0 2rem 0;
            text-align: center;
            border-bottom: 2px solid var(--border);
            padding-bottom: 0.5rem;
            position: relative;
        }

        .phase-header h2 {
            font-family: 'Playfair Display', serif;
            font-size: 1.4rem;
            color: var(--primary);
            display: inline-block;
            background: var(--card-bg);
            padding: 0 1.5rem;
            position: relative;
            bottom: -1.25rem;
            text-transform: uppercase;
            letter-spacing: 2px;
        }

        .day-section {
            margin-bottom: 3rem;
            page-break-after: always;
        }

        .day-header {
            display: flex;
            align-items: baseline;
            gap: 1rem;
            border-bottom: 1px solid var(--border);
            padding-bottom: 0.5rem;
            margin-bottom: 1.5rem;
        }

        .day-num {
            font-family: 'Playfair Display', serif;
            font-size: 1.8rem;
            font-weight: 800;
            color: var(--primary);
        }

        .day-title {
            font-size: 1.3rem;
            font-weight: 600;
            color: var(--accent);
        }

        .event-card {
            background: rgba(250, 249, 246, 0.5);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 1.25rem;
            transition: all 0.3s ease;
        }

        .event-card:hover {
            border-color: var(--primary);
            background: #ffffff;
            box-shadow: 0 5px 15px rgba(140, 118, 63, 0.05);
        }

        .event-header {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            margin-bottom: 0.75rem;
        }

        .event-time {
            font-weight: 700;
            font-size: 0.95rem;
            color: var(--primary);
            background: rgba(140, 118, 63, 0.08);
            padding: 0.2rem 0.6rem;
            border-radius: 6px;
        }

        .event-location {
            font-size: 1.1rem;
            font-weight: 700;
            color: var(--text-dark);
        }

        .event-details {
            margin-bottom: 0.5rem;
            color: var(--text-muted);
            font-size: 0.95rem;
        }

        .event-logistics {
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--accent);
            display: flex;
            align-items: center;
            gap: 0.3rem;
        }

        .packing-section {
            margin-top: 3rem;
            page-break-inside: avoid;
        }

        .packing-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.5rem;
            margin-top: 1.5rem;
        }

        .packing-category {
            background: rgba(140, 118, 63, 0.02);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 1.5rem;
        }

        .packing-category h4 {
            color: var(--primary);
            border-bottom: 1px solid var(--border);
            padding-bottom: 0.4rem;
            margin-bottom: 0.8rem;
            text-transform: uppercase;
            font-size: 0.85rem;
            letter-spacing: 1px;
        }

        .packing-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.9rem;
            margin-bottom: 0.4rem;
            color: var(--text-dark);
        }

        .checkbox {
            width: 14px;
            height: 14px;
            border: 1px solid var(--primary);
            border-radius: 3px;
            display: inline-block;
        }

        .btn-sheet-link {
            display: inline-block;
            background: var(--primary);
            color: white;
            padding: 0.8rem 1.8rem;
            border-radius: 10px;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.3s ease;
            text-align: center;
        }

        .btn-sheet-link:hover {
            background: var(--primary-dark);
            box-shadow: 0 4px 15px rgba(140, 118, 63, 0.3);
        }

        .button-group {
            display: flex;
            gap: 1.5rem;
            justify-content: center;
            margin-top: 2.5rem;
        }

        .btn-doc-link {
            display: inline-block;
            background: #4285F4; /* Google Docs Blue */
            color: white;
            padding: 0.8rem 1.8rem;
            border-radius: 10px;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.3s ease;
            text-align: center;
        }

        .btn-doc-link:hover {
            background: #357ae8;
            box-shadow: 0 4px 15px rgba(66, 133, 244, 0.3);
        }

        /* Print Specific Styling */
        @media print {
            body {
                background-color: #ffffff;
                color: #000000;
                padding: 0;
            }
            .container {
                border: none;
                box-shadow: none;
                padding: 0;
                max-width: 100%;
            }
            .btn-sheet-link, .btn-doc-link, .button-group {
                display: none !important;
            }
            .event-card {
                background: #ffffff !important;
                page-break-inside: avoid;
            }
            .meta-info-grid {
                background: none !important;
            }
            .phase-header {
                border-bottom: 2px solid #000 !important;
            }
            .phase-header h2 {
                background: #fff !important;
            }
            .day-section {
                page-break-after: always;
            }
            .day-section:last-of-type {
                page-break-after: avoid;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="viking-logo">Viking River Cruises</div>
            <h1>Portugal's River of Gold</h1>
            <p>12-Day Pre-Cruise & River Cruise Itinerary (July 18 – July 29, 2026)</p>
        </header>

        <div class="meta-info-grid">
            <div class="meta-item">
                <h3>Guests</h3>
                <p>Mr. Tsung Pai Chen & Mrs. Fanny H Chang</p>
            </div>
            <div class="meta-item">
                <h3>Hotel Stay</h3>
                <p>The Corinthia Lisbon (4 Nights)</p>
            </div>
            <div class="meta-item">
                <h3>Viking Cruise Booking</h3>
                <p>#9706751 (Viking Osfrid)</p>
            </div>
            <div class="meta-item">
                <h3>Cruise Route</h3>
                <p>Porto to Porto (July 22 – July 29, 2026)</p>
            </div>
        </div>

        <div class="alert-box">
            <h4>💡 Lisbon Walkability Pro-Tips</h4>
            <p>Lisbon is built on extremely steep hills. Walkways are paved in traditional <em>calçada portuguesa</em> (cobblestones) which are highly slick when worn down or damp. <strong>High-traction rubber soles are mandatory</strong>. Avoid unnecessary uphill climbs by utilizing vertical transit shortcuts (metro station escalators, public lifts, and vintage Tram 25).</p>
        </div>

        <!-- INFOGRAPHIC HERO -->
        <div class="infographic-container">
            <img src="assets/portugal_itinerary.png" alt="12-Day Portugal & Viking Cruise Itinerary Infographic" class="infographic-img">
        </div>

        <!-- DAILY SCHEDULE -->
        ${scheduleHtml}

        <!-- PACKING LIST -->
        <div class="packing-section">
            <div class="day-header">
                <span class="day-num">🎒</span>
                <span class="day-title">Essential Packing Checklist</span>
            </div>
            
            <div class="packing-grid">
                ${packingHtml}
            </div>
        </div>

        <div class="button-group no-print">
            <a href="${sheetUrl}" class="btn-sheet-link" target="_blank">🔗 Open Google Sheet Version</a>
            ${docUrl ? `<a href="${docUrl}" class="btn-doc-link" target="_blank">📄 Open Google Doc Version</a>` : ''}
        </div>
    </div>
</body>
</html>`;
}

run();

