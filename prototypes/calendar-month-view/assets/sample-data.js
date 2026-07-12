/* ════════════════════════════════════════════════════════════════════
   SAMPLE CALENDAR DATA — fictional but realistic Troop 79 events.
   Field shape intentionally mirrors the production `calendar_entries`
   row shape (see next-app/src/lib/calendar.ts / calendar-shared.ts):
     category    — one of the 11 CATEGORIES (see calendar-month.js)
     title       — string
     entry_date  — "YYYY-MM-DD", the entry's first/only day
     end_date    — "YYYY-MM-DD" or null; last day for multi-day entries
     start_time  — "HH:MM" 24h, or null for all-day entries
     end_time    — "HH:MM" 24h, or null
     location    — string or null
     description — string or null
     day_note    — short string or null (renders as a small pill, e.g. "RSVP REQUIRED")
   ════════════════════════════════════════════════════════════════════ */

(function () {
  const MEETING_LOCATION = 'Northwoods Presbyterian Church, 1572 E Capitol Dr';

  /** Every Thursday from `startStr` through `endStr`, inclusive, as YYYY-MM-DD strings. */
  function thursdaysBetween(startStr, endStr) {
    const out = [];
    const d = new Date(startStr + 'T00:00:00');
    const end = new Date(endStr + 'T00:00:00');
    // advance to the first Thursday on/after start
    while (d.getDay() !== 4) d.setDate(d.getDate() + 1);
    while (d <= end) {
      out.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 7);
    }
    return out;
  }

  // Regular weekly Troop Meeting on every Thursday, June–August 2026 —
  // except the dates overridden below (No Meeting / Court of Honor nights
  // replace the regular meeting rather than stacking a second entry on
  // top of it).
  const OVERRIDDEN_THURSDAYS = new Set(['2026-07-02', '2026-06-25', '2026-08-27']);
  const regularMeetings = thursdaysBetween('2026-06-01', '2026-08-31')
    .filter((d) => !OVERRIDDEN_THURSDAYS.has(d))
    .map((d, i) => ({
      id: `troop-meeting-${d}`,
      category: 'Troop Meeting',
      title: 'Troop Meeting',
      entry_date: d,
      end_date: null,
      start_time: '19:00',
      end_time: '20:30',
      location: MEETING_LOCATION,
      description:
        i % 3 === 0
          ? 'Patrol corners, a rank-requirement breakout, and a short skills demo. Full uniform (Class A).'
          : null,
      day_note: null
    }));

  const CALENDAR_EVENTS = [
    ...regularMeetings,

    // Overridden Thursdays
    {
      id: 'no-meeting-0702',
      category: 'No Meeting',
      title: 'No Meeting — Fourth of July Week',
      entry_date: '2026-07-02',
      end_date: null,
      start_time: null,
      end_time: null,
      location: null,
      description: 'No troop meeting this week — enjoy the holiday with your families. See you July 9th.',
      day_note: null
    },
    {
      id: 'coh-0625',
      category: 'Court of Honor',
      title: 'Summer Court of Honor',
      entry_date: '2026-06-25',
      end_date: null,
      start_time: '19:00',
      end_time: '20:30',
      location: MEETING_LOCATION,
      description: 'Rank advancements and merit badges earned since March, plus a slideshow from the spring campouts. Families welcome.',
      day_note: 'FAMILIES WELCOME'
    },
    {
      id: 'coh-0827',
      category: 'Court of Honor',
      title: 'End-of-Summer Court of Honor',
      entry_date: '2026-08-27',
      end_date: null,
      start_time: '19:00',
      end_time: '20:30',
      location: MEETING_LOCATION,
      description: 'Recognizing summer camp and High Adventure advancement. Families welcome.',
      day_note: 'FAMILIES WELCOME'
    },

    // Committee Meetings — first Tuesday of the month
    {
      id: 'committee-0602',
      category: 'Committee Meeting',
      title: 'Committee Meeting',
      entry_date: '2026-06-02',
      end_date: null,
      start_time: '19:00',
      end_time: '20:00',
      location: 'Northwoods, Room 2',
      description: null,
      day_note: null
    },
    {
      id: 'committee-0707',
      category: 'Committee Meeting',
      title: 'Committee Meeting',
      entry_date: '2026-07-07',
      end_date: null,
      start_time: '19:00',
      end_time: '20:00',
      location: 'Northwoods, Room 2',
      description: null,
      day_note: null
    },
    {
      id: 'committee-0804',
      category: 'Committee Meeting',
      title: 'Committee Meeting',
      entry_date: '2026-08-04',
      end_date: null,
      start_time: '19:00',
      end_time: '20:00',
      location: 'Northwoods, Room 2',
      description: null,
      day_note: null
    },
    {
      id: 'committee-planning-0822',
      category: 'Committee Meeting',
      title: 'Court of Honor Planning Huddle',
      entry_date: '2026-08-22',
      end_date: null,
      start_time: '14:00',
      end_time: '15:00',
      location: 'Northwoods, Room 2',
      description: 'Quick planning session for the End-of-Summer Court of Honor program.',
      day_note: null
    },

    // Multi-day: Campout (weekend, single week row)
    {
      id: 'campout-governor-dodge',
      category: 'Campout',
      title: 'Governor Dodge State Park Campout',
      entry_date: '2026-07-17',
      end_date: '2026-07-19',
      start_time: null,
      end_time: null,
      location: 'Governor Dodge State Park, Dodgeville, WI',
      description: 'Backpacking loop, a swim at the beach, and Saturday-night campfire cooking competition by patrol.',
      day_note: null
    },

    // Multi-day: Summer Camp, spans a week-row AND a month boundary (Jul → Aug)
    {
      id: 'summer-camp-long-lake',
      category: 'Summer Camp',
      title: 'Camp Long Lake Summer Camp',
      entry_date: '2026-07-26',
      end_date: '2026-08-01',
      start_time: null,
      end_time: null,
      location: 'Camp Long Lake, Presque Isle, WI',
      description: 'Week-long resident camp — merit badge sessions, waterfront, and the Friday night campfire show. Full gear list on the Bugle.',
      day_note: 'PACKING LIST DUE'
    },

    // Multi-day: High Adventure, week-long
    {
      id: 'high-adventure-boundary-waters',
      category: 'High Adventure',
      title: 'Boundary Waters Canoe Trip',
      entry_date: '2026-08-08',
      end_date: '2026-08-14',
      start_time: null,
      end_time: null,
      location: 'Boundary Waters Canoe Area Wilderness, MN',
      description: 'Six-day paddle-and-portage route for Scouts 13+ who completed the spring conditioning hikes. Permit-limited to 9 Scouts + 2 adults.',
      day_note: null
    },

    // Busy day: two single-day events same Saturday
    {
      id: 'service-highway-cleanup',
      category: 'Service Project',
      title: 'Adopt-a-Highway Cleanup',
      entry_date: '2026-06-13',
      end_date: null,
      start_time: '09:00',
      end_time: '12:00',
      location: 'Hwy 100 Adopt-a-Highway segment',
      description: 'Gloves and bags provided. Meet at the Hwy 100 park-and-ride.',
      day_note: null
    },
    {
      id: 'outing-lapham-peak',
      category: 'Outing',
      title: 'Day Hike — Lapham Peak',
      entry_date: '2026-06-13',
      end_date: null,
      start_time: '13:00',
      end_time: '16:00',
      location: 'Lapham Peak Unit, Kettle Moraine State Forest',
      description: 'Easy 4-mile loop, tower climb at the summit. Bring water and sunscreen.',
      day_note: null
    },

    // Second Outing
    {
      id: 'outing-kayaking',
      category: 'Outing',
      title: 'Kayaking — Pewaukee Lake',
      entry_date: '2026-08-15',
      end_date: null,
      start_time: '10:00',
      end_time: '14:00',
      location: 'Pewaukee Lake public launch',
      description: 'Kayaks and life jackets provided by the outfitter; sign-up required by Aug 8.',
      day_note: null
    },

    // Fundraiser
    {
      id: 'fundraiser-mulch',
      category: 'Fundraiser',
      title: 'Mulch Sale Delivery Day',
      entry_date: '2026-06-20',
      end_date: null,
      start_time: '08:00',
      end_time: '14:00',
      location: 'Northwoods parking lot (staging) + routes',
      description: 'All hands needed for loading and delivery — this is our biggest annual fundraiser.',
      day_note: null
    },
    {
      id: 'fundraiser-popcorn-kickoff',
      category: 'Fundraiser',
      title: 'Popcorn Sale Kickoff',
      entry_date: '2026-08-20',
      end_date: null,
      start_time: '18:30',
      end_time: '19:00',
      location: MEETING_LOCATION,
      description: 'Quick kickoff before the regular meeting — order forms and storefront sign-up sheet go out tonight.',
      day_note: null
    },

    // Overflow day — 3 same-day events (2 already exist on Aug 22 above: Committee + this Service Project + a third Fundraiser pickup)
    {
      id: 'service-food-pantry',
      category: 'Service Project',
      title: 'Food Pantry Sorting',
      entry_date: '2026-08-22',
      end_date: null,
      start_time: '10:00',
      end_time: '13:00',
      location: 'Hunger Task Force, Milwaukee',
      description: 'Sorting and shelving donated goods. Closed-toe shoes required.',
      day_note: null
    },
    {
      id: 'fundraiser-popcorn-pickup',
      category: 'Fundraiser',
      title: 'Late Popcorn Order Pickup',
      entry_date: '2026-08-22',
      end_date: null,
      start_time: '09:00',
      end_time: '10:00',
      location: 'Northwoods parking lot',
      description: null,
      day_note: null
    },

    // Ceremony
    {
      id: 'ceremony-crossover',
      category: 'Ceremony',
      title: 'Cub Scout Crossover Ceremony',
      entry_date: '2026-06-06',
      end_date: null,
      start_time: '15:00',
      end_time: '16:00',
      location: 'Northwoods, Fellowship Hall',
      description: 'Welcoming 4 new Scouts crossing over from Pack 379. Refreshments follow.',
      day_note: 'RSVP REQUESTED'
    }
  ];

  window.CALENDAR_EVENTS = CALENDAR_EVENTS;
})();
