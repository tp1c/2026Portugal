const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

async function loadSavedCredentialsIfExist() {
  try {
    const credsContent = await fs.readFile(CREDENTIALS_PATH);
    const credentials = JSON.parse(credsContent);
    const { client_secret, client_id } = credentials.installed || credentials.web;
    const redirectUri = 'http://localhost:3000';
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
    
    const tokenContent = await fs.readFile(TOKEN_PATH);
    const tokens = JSON.parse(tokenContent);
    oAuth2Client.setCredentials(tokens);
    return oAuth2Client;
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
    let spreadsheetUrl = 'https://docs.google.com/spreadsheets/d/1ZWIaHRRsVBOZmc2CDEjl471hF73Ba35GR7T3WNDNDTI/edit';
    let docUrl = 'https://docs.google.com/document/d/1-6k_fPyMxQgI4uAqyJ7oP82Ga2pK_qIaxXUER3MHXr4/edit';

  // Data definitions (without flight details)
  const scheduleValues = [
      ['Day', 'Time', 'Location', 'Logistics & Walkability', 'Local Vibe & Notes'],
      // Lisbon Pre-Cruise Stay
      ['Day 1 (Sat Jul 18)', '11:05 AM', 'Arrival in Lisbon & Transfer', 'Viking Transfer included. Corinthia Hotel (Avenida Columbano Bordalo Pinheiro 105).', 'Met at the airport by a Viking Representative who will accompany you to the Corinthia Hotel. Check-in, unpack, and relax.'],
      ['Day 1 (Sat Jul 18)', '2:00 PM', 'Pingo Doce Sete Rios Grocery Run', '5-10 min flat walk from the hotel.', 'Quick run for local Portuguese wines, fresh bakery items, and snacks. Avoid overpriced hotel shops—this is where the local neighborhood shops.'],
      ['Day 1 (Sat Jul 18)', '3:30 PM', 'Transit to Belém', 'Order an Uber directly from The Corinthia Lisbon to the Torre de Belém (15-20 min). Or take Metro Blue Line to Baixa-Chiado, switch to Green to Cais do Sodré, and catch train to Belém.', 'Your free time begins at 3:00 PM. Taking an Uber from the hotel to Belém is highly recommended; it is faster, more comfortable, and often more economical than public transit for two people.'],
      ['Day 1 (Sat Jul 18)', '4:00 PM', 'The Age of Discovery Waterfront', '100% Flat. Walk along a paved pedestrian path that skirts the edge of the Tagus River.', 'Admire the 16th-century Torre de Belém from the exterior boardwalks to avoid the grueling 90-minute wait for the interior stairs. Stroll down the path to the massive Monument to the Discoveries (Padrão dos Descobrimentos).'],
      ['Day 1 (Sat Jul 18)', '5:30 PM', 'Pastéis de Belém', 'Short flat walk from the waterfront to the main road.', 'Bypass the massive line outside on the sidewalk—that is only for takeout. Walk straight inside to the historic inner rooms to sit down and enjoy original warm custard tarts (pastéis de nata).'],
      ['Day 1 (Sat Jul 18)', '6:30 PM', 'Dinner at LX Factory (Alcântara)', '20-minute flat walk from Belém along the Tagus River, or a quick 5-minute Uber ride.', 'Avoid the overpriced restaurants in Belém. Head to LX Factory—an abandoned textile factory transformed into a trendy, creative village filled with local artists, shops, and highly-rated restaurants.'],
      ['Day 1 (Sat Jul 18)', '8:30 PM', 'Return to Hotel', 'Grab a quick Uber from LX Factory back to The Corinthia, or take an Uber to the city center for around €4 to catch the Metro back to Sete Rios.', 'Return to the Corinthia Lisbon hotel. Refresh and relax after your first day in Portugal.'],
      ['Day 2 (Sun Jul 19)', '08:45 AM - 11:45 AM', 'Bairro Alto City Walk', 'Take the Blue Line from Sete Rios to Baixa-Chiado and use the escalator hack to easily ascend to the Bairro Alto/Chiado district.', 'Walking tour of this historic, bohemian upper quarter. Sturdy walking shoes with high-traction soles are recommended for cobblestone paths.'],
      ['Day 2 (Sun Jul 19)', '11:45 AM', 'Pre-Lunch Port Tasting', 'Solar do Vinho do Porto (Bairro Alto). Walk-ins welcome. Pro-tip: Order directly from the bar for faster service.', 'Step into this classy, air-conditioned venue to sample from a massive library of over 150 varieties of ports (Ruby, Tawny, Vintage) before lunch. Located right across from the panoramic Miradouro de São Pedro de Alcântara.'],
      ['Day 2 (Sun Jul 19)', '01:00 PM', 'Authentic Baixa Lunch', 'Take the elevators or a gentle walk back down into the flat Baixa valley.', 'Avoid the touristy "eating lanes." Head to O Velho Eurico, a hidden gem serving authentic, reasonably priced Portuguese cuisine away from the crowds.'],
      ['Day 2 (Sun Jul 19)', '02:30 PM', 'The Classic Baixa Flat Walk', '100% Flat. A smooth, level grid system rebuilt after the 1755 earthquake.', 'Stroll down the grand pedestrian thoroughfare of Rua Augusta, pass under the triumphal arch, and take in the massive waterfront Praça do Comércio.'],
      ['Day 2 (Sun Jul 19)', '04:30 PM', 'Aperitif at A Ginjinha', 'Flat walk from Baixa to Largo de São Domingos.', 'Sip a quick glass of wild sour cherry liqueur (ginja) at Lisbon\'s oldest counter, operating since 1840.'],
      ['Day 2 (Sun Jul 19)', '05:30 PM', 'The "Hills-Bypassed" Alfama Walk', 'Take Bus #737 or an Uber from the downtown flats directly to the Miradouro das Portas do Sol viewpoint.', 'From there, wander exclusively down the labyrinthine cobblestone alleys to bypass steep uphill climbs.'],
      ['Day 2 (Sun Jul 19)', '07:30 PM', 'Dinner & Fado in Alfama', 'Alfama district. Steep walking and cobblestones.', 'Find a cozy traditional tavern nestled in the medieval quarter to enjoy dinner accompanied by the soulful sounds of live Fado music.'],
      ['Day 3 (Mon Jul 20)', '08:00 AM', 'Tour Departure: Sintra & Cascais Day-Trip', 'Praça dos Restauradores 24 (Mango Store). Arrive by 07:45 AM.', 'Board the tour vehicle for the Sintra, Pena, Regaleira, Roca Coast & Cascais Day-Trip (Vision Tours). Voucher: GYG83XF7RLY4. Duration: 8.5 hours. Entry tickets to Pena Palace Gardens and Quinta da Regaleira are included.'],
      ['Day 3 (Mon Jul 20)', '09:00 AM', 'Pena Palace (Sintra)', '1.5-hour visit. Gardens and exterior. Steep hills, stairs, and cobblestones.', 'Explore the whimsical and colorful fairytale Pena Palace. Your included ticket grants access to the palace gardens and spectacular exterior terraces, offering the best views of the palace and coast while bypassing the massive queues for the interior rooms.'],
      ['Day 3 (Mon Jul 20)', '11:00 AM', 'Quinta da Regaleira', '1.5-hour visit. Winding paths, narrow tunnels, and the 27-meter Initiation Well.', 'Explore the mystical, Masonic-inspired estate of Quinta da Regaleira, including the lush gardens, secret tunnels, and the famous well. Your entry ticket is included in the tour booking.'],
      ['Day 3 (Mon Jul 20)', '01:00 PM', 'Cabo da Roca & Roca Coast', 'Scenic drive and photo stop. Exposed cliffs, windy conditions.', 'Enjoy a scenic drive along the dramatic Atlantic coastline of Cabo da Roca, the westernmost point of continental Europe, with cliffs dropping 140 meters.'],
      ['Day 3 (Mon Jul 20)', '02:00 PM', 'Lunch & Stroll in Cascais Fishing Village', 'Stop for lunch and stroll in historic center. Flat coastal walking.', 'Seaside town with beautiful beaches. Tip: Skip the overpriced tourist traps on the main squares and look for a quiet, authentic tasca tucked away in backstreets for fresh seafood.'],
      ['Day 3 (Mon Jul 20)', '04:30 PM', 'Return Transfer & City Center Drop-off', 'Praça dos Restauradores 24 (ends where it started), or take Metro/taxi from hotel.', 'Board the tour van for the return transfer. Spend the late afternoon strolling through the beautiful plazas and watching the city come alive under evening lights.'],
      ['Day 3 (Mon Jul 20)', '07:30 PM', 'Dinner in Chiado (City Center)', 'Walk to dining venue. Return to Corinthia Hotel via Metro Blue Line (to Sete Rios) or Uber.', 'Dine at an acclaimed spot like Bairro do Avillez (seafood/tapas) or Sacramento (romantic vaulted palace cellars). Reservations are mandatory.'],
      ['Day 4 (Tue Jul 21)', '08:00 AM', 'Tour Departure: Fátima, Batalha, Nazaré & Óbidos', 'Corinthia Hotel Lobby. Meet 5 minutes before departure (by 07:55 AM).', 'Board the air-conditioned van for the GetYourGuide small-group tour (Discover Portugal With Us). Voucher: GYGG45RVL3GQ. Duration: 10 hours total. Provider will email/message the exact pickup time the evening prior around 07:00 PM.'],
      ['Day 4 (Tue Jul 21)', '09:15 AM', 'Sino Factory Stop (Fátima)', '1.25-hour drive from Lisbon. 20-minute stop.', 'A brief 20-minute visit to a traditional bell/statue factory (Sino Factory) to see local artisans at work before entering the holy sanctuary.'],
      ['Day 4 (Tue Jul 21)', '09:35 AM', 'Sanctuary of Our Lady of Fátima', '75-minute visit. Flat, massive open plaza.', 'Major Christian pilgrimage site. Enjoy a 75-minute guided tour and free time at the Sanctuary of Our Lady of Fátima, including the Chapel of Apparitions and the Basilica.'],
      ['Day 4 (Tue Jul 21)', '11:15 AM', 'Batalha Monastery Stop', '25-minute drive from Fátima. 20-minute guided stop.', 'A brief 20-minute guided visit/photo stop at this stunning 14th-century Gothic masterpiece (UNESCO World Heritage Site). (Note: This is a short stop rather than an in-depth tour).'],
      ['Day 4 (Tue Jul 21)', '12:00 PM', 'Nazaré Fishermen Village & Lunch', '25-minute drive from Batalha. 1.5 to 1.75 hours stay.', 'Visit the famous clifftop Sítio district and the seaside town. Includes a 30-minute guided tour/free time and a 1-hour optional lunch (extra fee, or dine at local spots like Taberna d\'Adelia).'],
      ['Day 4 (Tue Jul 21)', '02:00 PM', 'Óbidos Medieval Walled Town', '30-minute drive from Nazaré. 75-minute visit. Cobblestones.', 'Explore the historic walled city of Óbidos. Stroll the ancient pathways and try Ginja de Óbidos (sour cherry liqueur) in an edible chocolate cup from a local vendor.'],
      ['Day 4 (Tue Jul 21)', '03:45 PM', 'Return Transfer to Lisbon', '50-minute to 1-hour drive back, arriving at hotel around 04:45 PM - 05:30 PM.', 'Relax on the drive back. Drop-off at Corinthia Hotel. The rest of the afternoon is free to rest and pack before cruise check-out tomorrow.'],
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
      ['Day 6 (Thu Jul 23)', '02:45 PM', 'Included Excursion: Mateus Palace & Gardens', 'Shore Excursion. Moderate walking. Bring audio receivers (runs until 07:45 PM).', 'Included Excursion. Visit the grand Mateus Palace (the elegant Baroque estate depicted on Mateus Rosé wine labels). Stroll the manicured hedge gardens, chapel, and interior rooms.'],
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
      ['Day 7 (Fri Jul 24)', '12:30 PM', 'Optional Excursion: Marialva Castle & Lunch', 'Optional Excursion (runs until 05:00 PM).', 'Visit the historical ruins of Marialva Castle and enjoy a local lunch.'],
      ['Day 7 (Fri Jul 24)', '12:30 PM', 'Lunch onboard', 'Lunch in the Restaurant.', 'Freshly prepared lunch is served for guests staying onboard.'],
      ['Day 7 (Fri Jul 24)', '02:15 PM', 'Welcome to Barca d\'Alva', 'Viking Osfrid arrives in Barca d\'Alva.', 'The ship docks in Barca d\'Alva, near the Spanish border.'],
      ['Day 7 (Fri Jul 24)', '02:00 PM', 'Included Excursion: Castelo Rodrigo', 'Shore Excursion. Bring audio receivers (runs until 05:00 PM).', 'Included Excursion. Tour the historic, fortified hilltop village of Castelo Rodrigo near the Spanish border. Taste local almonds and honey.'],
      ['Day 7 (Fri Jul 24)', '05:00 PM', 'Drinks & Live Music in the Lounge', 'Casual get-together in the Lounge (runs until 06:45 PM).', 'Enjoy drinks and live music by onboard musician Thiago.'],
      ['Day 7 (Fri Jul 24)', '06:45 PM', 'Port Talk', 'Lounge event.', 'Join Program Director Lídia in the Lounge to find out details about tomorrow\'s excursions and events.'],
      ['Day 7 (Fri Jul 24)', '07:00 PM', 'Dinner: Taste of Portugal', 'Dinner in the Restaurant.', 'Enjoy a hearty, traditional Portuguese dinner accompanied by Portuguese music.'],
      ['Day 7 (Fri Jul 24)', '08:45 PM', 'Evening Entertainment: Flamenco Show', 'Lounge performance.', 'Enjoy a special live Flamenco performance by the Solearte troupe, followed by music and dancing with Thiago.'],

      // Day 8 (Sat Jul 25)
      ['Day 8 (Sat Jul 25)', '06:00 AM', 'Café Breakfast Available', 'In front of the Restaurant.', 'Coffee and pastries are available.'],
      ['Day 8 (Sat Jul 25)', '07:00 AM', 'Breakfast Buffet', 'Enjoy breakfast in the Restaurant.', 'Breakfast is served in the Restaurant (runs until 09:00 AM).'],
      ['Day 8 (Sat Jul 25)', '08:00 AM', 'Included Excursion: A Day in Salamanca', 'Shore Excursion. 9-hour duration (runs until 05:00 PM).', 'Included Excursion. Full day coach excursion to Salamanca, Spain. Visit the UNESCO-listed Salamanca University, Plaza Mayor, and the New Cathedral. Includes traditional lunch and Flamenco performance. Motorcoaches depart starting at 8:00 AM.'],
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
      ['Day 9 (Sun Jul 26)', '08:45 AM', 'Included Excursion: Favaios Bakery & Quinta Avessada', 'Shore Excursion (runs until 02:45 PM).', 'Included Excursion. Visit the historic hilltop village of Favaios to see a traditional wood-fired bakery, followed by lunch and Moscatel tasting at Quinta da Avessada.'],
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
      ['Day 10 (Mon Jul 27)', '08:15 AM', 'Optional Excursion: Cistercians & Wines', 'Optional Excursion (runs until 11:45 AM).', 'Explore Cistercian architecture and enjoy a local wine tasting.'],
      ['Day 10 (Mon Jul 27)', '09:00 AM', 'Included Excursion: Charming Lamego', 'Shore Excursion. Choice of walking down 686 stairs (runs until 12:00 PM).', 'Included Excursion. Visit the Shrine of Our Lady of Remedies, see the tiled baroque landings, and explore the town of Lamego.'],
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
      ['Day 11 (Tue Jul 28)', '09:30 AM', 'Transit to the Upper City & Coffee', 'Gaia dock to Igreja do Carmo.', 'Take a short Uber ride from the Gaia dock to the upper downtown area of Porto (near Igreja do Carmo). Start with specialty coffee at Fábrica or SO Coffee Roasters, and grab a warm pastel de nata from Manteigaria.'],
      ['Day 11 (Tue Jul 28)', '10:30 AM', 'Porto Heights Walk & Viewpoints', 'Porto Historic Center (downhill walking).', 'Walk past Livraria Lello to admire its exterior, then head to Miradouro da Vitória for stunning, crowd-free views. Stroll downhill through medieval alleys toward the river.'],
      ['Day 11 (Tue Jul 28)', '12:30 PM', 'Authentic Pork Sandwich Lunch', 'Conga or Casa Guedes.', 'Skip the overpriced riverside tourist menus and eat where the locals do. Head to Conga for their famous Porto-style bifana or Casa Guedes for roasted pork leg sandwiches.'],
      ['Day 11 (Tue Jul 28)', '02:00 PM', 'Ribeira & The Barcos Rabelos', 'Ribeira district.', 'Descend into the riverside Ribeira district to admire the traditional barcos rabelos—the historic wooden cargo boats that once transported wine from the Douro Valley.'],
      ['Day 11 (Tue Jul 28)', '02:30 PM', 'Dom Luís I Bridge Crossing', 'Ponte de Dom Luís I (lower deck).', 'Enjoy a flat, scenic 10-minute walk across the lower deck of the Ponte de Dom Luís I iron bridge, returning to the Vila Nova de Gaia waterfront.'],
      ['Day 11 (Tue Jul 28)', '03:45 PM', 'Sandeman Port Tasting (1790 Tour)', 'SANDEMAN WINE CELLAR (Largo Miguel Bombarda 47).', 'Booked via Livingtours (Voucher: #200034192). Arrive 10-15 minutes early. Enjoy a guided visit to the cellars and a tasting of premium Sandeman Port wines.'],
      ['Day 11 (Tue Jul 28)', '05:30 PM', 'Return to Ship & Relax', 'Viking Osfrid (Cais de Gaia).', 'Short walk back to the ship. Settle back onboard and relax in the Lounge before the evening\'s festivities.'],
      ['Day 11 (Tue Jul 28)', '06:30 PM', 'Captain\'s Cocktail Party & Farewell', 'Lounge event.', 'Join Captain Bernardino for a farewell toast, followed by final farewell remarks from Program Director Lidia at 06:45 PM.'],
      ['Day 11 (Tue Jul 28)', '07:00 PM', 'Captain\'s Farewell Dinner', 'Dinner in the Restaurant.', 'Celebrate the cruise with a special farewell dinner.'],
      ['Day 11 (Tue Jul 28)', '09:00 PM', 'Evening Entertainment', 'Lounge event.', 'Enjoy final evening music and dancing in the Lounge with Thiago.'],
      ['Day 12 (Wed Jul 29)', '08:00 AM', 'Porto Disembarkation & Departure', 'Viking transfer to Porto Airport (OPO) or hotel.', 'Breakfast onboard, checkout, and transfer for your return flight or post-cruise extension.']
    ];

    const bookingValues = [
      ['Category', 'Detail', 'Date/Time', 'Reference/Location', 'Status'],
      ['Hotel', 'The Corinthia Lisbon', 'July 18 – July 22, 2026', 'Avenida Columbano Bordalo Pinheiro 105', 'Included in pre-cruise package'],
      ['Tour', 'Sintra, Pena, Regaleira, Roca Coast & Cascais Tour (Vision Tours)', 'Monday, July 20, 2026 (08:00 AM)', 'Vision Tours Portugal (Meet: Praça dos Restauradores 24)', 'Booked (Voucher: GYG83XF7RLY4)'],
      ['Tour', 'Fátima, Batalha, Nazaré & Óbidos Small-Group Tour (GetYourGuide)', 'Tuesday, July 21, 2026 (08:00 AM)', 'Discover Portugal With Us (Corinthia Hotel Lobby)', 'Booked (Voucher: GYGG45RVL3GQ)'],
      ['Tour', 'Sandeman Port Wine Cellar - 1790 Tour', 'Tuesday, July 28, 2026 (03:45 PM)', 'Largo Miguel Bombarda 47, Vila Nova de Gaia', 'Booked (Voucher: 200034192)'],
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

    // Google Sheets and Docs API execution wrapped in try-catch

    try {
      const auth = await loadSavedCredentialsIfExist();
      if (!auth) {
        throw new Error('Token not found.');
      }

      const sheets = google.sheets({ version: 'v4', auth });
      console.log('Creating a new Google Sheet for the Lisbon Itinerary...');

      const spreadsheetResponse = await sheets.spreadsheets.create({
        resource: {
          properties: {
            title: 'Viking Portugal\'s River of Gold - Lisbon 4-Day Itinerary',
          },
        },
        fields: 'spreadsheetId,spreadsheetUrl',
      });

      const spreadsheetId = spreadsheetResponse.data.spreadsheetId;
      const createdUrl = spreadsheetResponse.data.spreadsheetUrl;
      if (createdUrl) {
        spreadsheetUrl = createdUrl;
      }
      console.log(`Spreadsheet created: ${spreadsheetId}`);

      const scheduleSheetId = 0;
      const bookingsSheetId = 10001;
      const packingSheetId = 10002;

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

      // Apply Checkboxes
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              setDataValidation: {
                range: {
                  sheetId: packingSheetId,
                  startRowIndex: 1,
                  endRowIndex: packingValues.length,
                  startColumnIndex: 2,
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

      try {
        const createdDocUrl = await createGoogleDoc(auth, scheduleValues, bookingValues, packingValues);
        if (createdDocUrl) {
          docUrl = createdDocUrl;
        }
        console.log(`Google Doc URL: ${docUrl}`);
      } catch (docsError) {
        console.error('Error generating Google Doc details:', docsError.message);
      }

    } catch (gapiError) {
      console.warn('\n⚠️ Warning: Failed to write to Google APIs:', gapiError.message || gapiError);
      if (gapiError.stack) console.warn(gapiError.stack);
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
      if (day.includes('Day 1 ')) dayTitle = 'Saturday, July 18, 2026 – The Waterfront & Industrial Art';
      else if (day.includes('Day 2 ')) dayTitle = 'Sunday, July 19, 2026 – Historic Heights, Flats, & Alleys';
      else if (day.includes('Day 3 ')) dayTitle = 'Monday, July 20, 2026 – Sintra, Pena Palace, Regaleira & Cascais Day-Trip';
      else if (day.includes('Day 4 ')) dayTitle = 'Tuesday, July 21, 2026 – Fátima, Batalha, Nazaré & Óbidos Day-Trip';
      else if (day.includes('Day 5 ')) dayTitle = 'Wednesday, July 22, 2026 – Coimbra Stop & Porto Embarkation';
      else if (day.includes('Day 6 ')) dayTitle = 'Thursday, July 23, 2026 – Régua & Vila Real (Mateus Palace & Gardens)';
      else if (day.includes('Day 7 ')) dayTitle = 'Friday, July 24, 2026 – Scenic Sailing & Castelo Rodrigo';
      else if (day.includes('Day 8 ')) dayTitle = 'Saturday, July 25, 2026 – Salamanca (Spain) Full-Day Excursion';
      else if (day.includes('Day 9 ')) dayTitle = 'Sunday, July 26, 2026 – Favaios Bakery & Quinta Avessada';
      else if (day.includes('Day 10 ')) dayTitle = 'Monday, July 27, 2026 – Charming Lamego & Porto Cruising';
      else if (day.includes('Day 11 ')) dayTitle = 'Tuesday, July 28, 2026 – Porto & Gaia: A Downhill Guide to Wine & Heritage';
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

