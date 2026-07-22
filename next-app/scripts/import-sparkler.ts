/**
 * Backfills the Sparkler archive into the Resource Library
 * (Plans/Resource-Library.md — content supplied by Patrick, 2026-07-21).
 *
 * One `post`-kind resource per WEEKLY ISSUE — the unit the Bugle actually
 * published — placed on the 'sparkler' topic shelf. created_at is set to the
 * real issue date so the shelf's newest-first ordering and date lines are
 * historically true. Jokes are verbatim as supplied (typos and the
 * occasional cross-week repeat included — that's the authentic archive; edit
 * any of it from /admin/library if wanted).
 *
 * Run:  npm run import-sparkler        (local dev)
 * Prod: set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to the
 *       hosted project (after the resource-library migration is applied) and
 *       run the same command.
 *
 * Safe to re-run: skips any issue whose title already exists on the shelf.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY env var is required (see scripts/seed-news.ts).');
  process.exit(1);
}

interface Issue {
  date: string; // YYYY-MM-DD
  title: string;
  jokes: string[];
}

const ISSUES: Issue[] = [
  {
    date: '2026-07-12',
    title: 'It Still Hertz',
    jokes: [
      `I just injured myself listening to radio frequencies. It still hertz.`,
      `I just saw some kids throwing Scrabble tiles at each other. It's all fun and games until someone loses an i.`,
      `My horse is only coming out of his stable at night. He's really becoming a night mare.`,
      `If you ever need to scream and let your feelings out, I recommend a cornfield. There's no judgment and it's all ears.`,
      `My girls got creative and put together a PowerPoint about why we should go to the water park. It had several slides.`
    ]
  },
  {
    date: '2026-06-13',
    title: 'Clean Now',
    jokes: [
      `I used to be addicted to soap, but I'm clean now.`,
      `Exaggerations went up by a million percent last year.`,
      `Nostalgia. It just isn't what is used to be.`,
      `How many sides does a circle have? Two: inside and outside.`,
      `Knock, knock. Who's there? Olive. Olive who? Olive right next door to you.`
    ]
  },
  {
    date: '2026-06-07',
    title: 'Really Falafel About It',
    jokes: [
      `If you ever need to scream and let all your feelings out, I highly recommend a cornfield. There's no judgment. They're all ears.`,
      `I took my friend to an orchard for her birthday. We stood there for 10 mins, but it was not the apple watch she wanted.`,
      `I just paid $350 for a limousine, but found out it didn't have a driver. All that money and nothing to chauffeur it.`,
      `I got an email talking about how to read maps backwards. It was spam.`,
      `I tried my best to cook some Middle Eastern food and failed miserably. I just really falafel about it.`,
      `Have you heard the joke about yoga? Nevermind its a bit of a stretch.`,
      `Why are frogs always so happy? They eat whatever bugs them.`,
      `Entropy. It's not what it used to be.`
    ]
  },
  {
    date: '2026-05-30',
    title: 'Knock Yourself Out',
    jokes: [
      `Did you know it takes five sheep to make one sweater? I didn't even know they could knit.`,
      `I got pulled over by the cops. When I rolled down the window officer asked me, "Do you know why I pulled you over?" I said, "Hold on a minute, I'm on the phone."`,
      `Did you know that milk is the fastest liquid on the planet? It's pasteurized before you even see it.`,
      `I asked my anesthesiologist if he'd let me administer my own anesthesia. He said, "Knock yourself out."`,
      `My neighbor knocked on my door at 2 a.m. Luckily, I was still awake practicing my drums.`
    ]
  },
  {
    date: '2026-05-01',
    title: 'Stable Wi-Fi',
    jokes: [
      `The internet at the farm was really sketchy, so I moved the modem to the barn. Now I have stable Wi-Fi.`,
      `You think gas and electric bills are expensive, have you seen chimneys? They're through the roof.`,
      `My friend and I were having an argument at Culvers when another friend overheard us, walked over, grabbed our fries, and left. We like the guy, but we just wish he'd stop taking sides.`,
      `Did you hear about the guy who collapsed trying to climb Mount Everest? Authorities just found Himalayan there.`,
      `I called work this morning and whispered, "Sorry boss, I can't come in today. I have a wee cough." He exclaimed, "You have a wee cough!?" I said, "Really?! Thanks boss, see you next week!"`
    ]
  },
  {
    date: '2026-04-25',
    title: 'No Point',
    jokes: [
      `What do you call someone who really really likes ceilings? A ceiling fan.`,
      `I think some bees might be allergic to pollen. You can tell if they develop hives.`,
      `Do you remember the joke I posted about my spine? It was about a weak back.`,
      `Knock knock. Who's there? Broken pencil. Broken pencil who? Never mind, there's no point.`,
      `Sundays can be a little sad, but the day before is a sadder day.`
    ]
  },
  {
    date: '2026-04-18',
    title: "They Don't Land Well",
    jokes: [
      `I've been doing a lot of research on airplane jokes, but they don't land well.`,
      `My doctor says I'm suffering from paranoia. He didn't actually say it, but I know he was thinking it.`,
      `When I get to work, I immediately go and hide because they say good employees are hard to find.`,
      `Do you want to hear a joke about procrastination? On second thought, I'll tell you later.`,
      `How do you become a woodworker? Whittle by whittle.`
    ]
  },
  {
    date: '2026-04-11',
    title: 'A Free Bee',
    jokes: [
      `I recently took a poll and I found that 100% of the people in the tent were angry.`,
      `Now that I've gotten older, everything is starting to click for me. My neck, my back, my knees.`,
      `I have spent time, effort, and money childproofing my house. But somehow the kids keep getting in.`,
      `I went to the doctor about a suspicious-looking mole, but he said they all looked that way, and I should have left it in the garden.`,
      `I went to the beekeeper to buy 12 bees, and when I got home, I saw that he had given me 13, so I called to tell him. He said it wasn't a mistake, it was a free bee.`
    ]
  },
  {
    date: '2026-03-15',
    title: 'You Have My Word',
    jokes: [
      `I was detained when I was younger for stealing batteries. It turned out ok. I was never charged.`,
      `To whoever stole my Microsoft Office, I will find you. You have my Word.`,
      `My daughter was doing her homework and asked me what I knew about Galileo. I said he was just a poor boy from a poor family.`,
      `I received a letter trying to sell me a heavy duty metal vest. I ignored it. I hate chainmail.`,
      `How do you console an English teacher? There, their, they're.`
    ]
  },
  {
    date: '2026-03-08',
    title: 'Still Just One Slice',
    jokes: [
      `What do you call fake potatoes? Imataters!`,
      `My mom put shredded carrots in our Jello, so don't tell me about your rough childhood.`,
      `I wonder how many dads named their sons Luke just so they can say "Luke, I am your father."`,
      `I always find the "easy-open tab" right after I finally manage to tear the package open with my teeth.`,
      `Technically, if you don't cut a cake, it's still just one slice.`
    ]
  },
  {
    date: '2026-03-01',
    title: 'It Dawned on Me',
    jokes: [
      `When's the worst time to have a heart attack? Probably during a game of charades.`,
      `I think it's shameful that some parents feed their kids frozen pizzas. They could at least put them in the oven.`,
      `Did you know the first French Fries were not cooked in France. They were cooked in grease.`,
      `Did you hear about the claustrophobic astronaut. He just needed some space.`,
      `I stayed up all night wondering where the sun had gone. And then it dawned on me.`,
      `My son thought he was being clever when he asked me if he was adopted. I told him "not yet."`
    ]
  },
  {
    date: '2026-02-14',
    title: 'Pie-rates of the Caribbean',
    jokes: [
      `Canadian Word of the Day: Fascinate. If you have a shirt with nine buttons, sometime it's stylish to only fascinate.`,
      `Pies in Jamacia sell for $6, while in the Virgin Islands they go for $5. In Cuba pies go for $3. Those are the Pie-rates of the Carribean.`,
      `Our dog just ate an entire bag of scrabble tiles so we rushed him to the vet.... No word yet.`,
      `With all the cold weather our flight got cancelled and our luggage got sad, so now we're dealing with emotional baggage.`,
      `Scientists just tested the world's strongest suction cup. I don't know how they pulled it off.`
    ]
  },
  {
    date: '2026-01-26',
    title: 'Two Unwritten Rules',
    jokes: [
      `I have two unwritten rules: 1.  2.`,
      `I always try to say "mucho" around my Spanish speaking friends. It means a lot to them.`,
      `If vegetarians eat veggies, what do humanitarians eat?`,
      `I think my email account was hacked. If you get any messages from me about canned meat don't open them. It's spam.`,
      `My five-year-old daughter emerged from the bathroom and asked me "where does poo comes from?" I paused, then briefly told her about food, digestion, and waste. She listened carefully, nodded, and then asked: "so then where does Tigger come from?"`
    ]
  },
  {
    date: '2026-01-17',
    title: 'The Spokes Person',
    jokes: [
      `I'm one week into my new job at the bicycle factory, and they already made me the spokes person.`,
      `Did you hear about the guy that evaporated? Yeah, he'll be mist.`,
      `I had a great childhood. Dad used to roll me down hills in tires. Yep, those were the Goodyears.`,
      `What's made of leather and sounds like a sneeze? A shoe.`,
      `The adjective for metal is metallic... but not for iron... Which is ironic.`
    ]
  },
  {
    date: '2026-01-10',
    title: 'A Door Jam',
    jokes: [
      `I just stepped on a Cornflake. Great. Now I'm a serial killer.`,
      `My friend Sarah left her bottle of Pepsi at a rest stop about 60 miles south of Tampa FL. That's where Sarah's soda is.`,
      `I got thrown out of my local park after arranging the squirrels by height. They didn't like me critter sizing.`,
      `My door was ajar, so I added Jelly. Now it's a door jam.`,
      `I don't like it when people act all intellectual and talk about Mozart when they've never even seen one of his paintings.`
    ]
  },
  {
    date: '2025-11-15',
    title: 'Called It a Day',
    jokes: [
      `Scientists get bored watching the Earth turn. So after 24 hours they called it a day.`,
      `I woke up laughing this morning. I think I slept funny.`,
      `A lot of people say they have trouble sleeping. Not me. I can do it with my eye's closed.`,
      `What's the best gift to give someone? A broken drum set. You can't beat it.`,
      `What's the difference between Black Eyed Peas and Chickpeas? Black Eyed Peas can sing us a song. Chickpeas can hummus one.`
    ]
  },
  {
    date: '2025-11-09',
    title: 'The Rest of Your Life',
    jokes: [
      `I have several jokes I've been working on in sign language. I can guarantee you haven't heard them.`,
      `Most people think that the T-Rex can't clap its hands because their arms are too short. But actually it's because they're dead.`,
      `If you're skydiving and your parachute jams, do not panic. You have the rest of your life to figure it out.`,
      `I thought the dryer was shrinking all of my clothes, but it turns out it was the refrigerator.`,
      `My doctor says that I'm suffering from paranoia. Well he didn't actually say it, but I know he was thinking it.`
    ]
  },
  {
    date: '2025-11-03',
    title: 'Onion Rings',
    jokes: [
      `My wife just confessed to me that she broke my favorite lamp. I don't think I'll ever be able to see her in the same light ever again.`,
      `Just when you think food can't call you on the phone. Bam. Onion rings.`,
      `A man was convicted of stealing a bag but was only sentenced to three minutes in jail. It was a brief case.`,
      `I don't mean to brag, but I just got hired as a fitness model. I'm going to be the before picture, but it still counts.`,
      `I feel like now days people are so judgmental. I can tell just by looking at them.`
    ]
  },
  {
    date: '2025-10-26',
    title: 'Aware Wolf',
    jokes: [
      `If you teach a wolf to meditate, it becomes aware wolf.`,
      `Do you know that garbage men don't get any training? They just gotta pick it up as they go along.`,
      `I always try to have a good time at concerts. But I draw the line at crowd surfing. I don't wanna get carried away.`,
      `I recently visited the world's tiniest wind turbine. Honestly, not a big fan.`,
      `I've been bored recently so I decided to take up fencing. But, my neighbors asked me to put it back.`
    ]
  },
  {
    date: '2025-10-19',
    title: 'Heads or Tales',
    jokes: [
      `I just adopted a dog from the local blacksmith. When he came home he made a bolt for the door.`,
      `Police have located a car containing a stolen bag of incomplete golf clubs. They're still looking for the driver.`,
      `My sister can't decide if she wants to be a hairdresser or an author. I guess she'll have to flip a coin... heads or tales.`,
      `The other day I spotted an albino Dalmatian. It was the least I could do for him.`,
      `I found this great place online to order sausage. I'll send you a link.`
    ]
  },
  {
    date: '2025-10-11',
    title: "Please Don't Buy It",
    jokes: [
      `I saw a man pushing a wagon uphill that was filled with four leaf clovers, rabbits feet, and horseshoes. I thought to myself, he's really pushing his luck.`,
      `Someone just called me and coughed and sneezed, and then hung up. I'm getting sick and tired of these cold calls.`,
      `If you date an FBI agent and then break up, are they your Fedex?`,
      `I threw a boomerang a couple years ago and now I live in constant fear.`,
      `I decided to write a book about reverse psychology. Please don't buy it.`
    ]
  },
  {
    date: '2025-10-04',
    title: 'The D Koi',
    jokes: [
      `Fun Fact: Koi fish always travel in schools of four. If they are attacked Koi fish A, B and C will scatter in different directions leaving the D Koi behind.`,
      `A bouncer told me I was going to have to leave. I said why? He said, I don't know who you are but this is my trampoline.`,
      `I was out walking today and got hit by a violin, French horn, and a clarinet. I think it was an orchestrated attack.`,
      `My dad was making dinner and asked me to pick a single tomato from the garden. I went outside, but couldn't tell which ones were single and which ones were in a relationship.`,
      `I'm sad so few things are built in the US these days. I bought a TV and it said "Built in Antenna" and to be perfectly honest I'm not sure where that is?`
    ]
  }
];

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let inserted = 0;
  let skipped = 0;

  for (const issue of ISSUES) {
    const title = `The Sparkler — ${issue.title}`;

    const { data: existing } = await supabase
      .from('library_resources')
      .select('id')
      .eq('kind', 'post')
      .eq('title', title)
      .maybeSingle();
    if (existing) {
      skipped++;
      continue;
    }

    const body = issue.jokes.map((j) => `- ${j}`).join('\n');
    const stamp = `${issue.date}T12:00:00Z`;
    const { data: resource, error } = await supabase
      .from('library_resources')
      .insert({
        title,
        kind: 'post',
        body_md: body,
        status: 'published',
        submitted_by_label: 'Patrick Bieser',
        reviewed_by: 'PB',
        reviewed_at: new Date().toISOString(),
        created_at: stamp,
        updated_at: stamp
      })
      .select('id')
      .single();
    if (error || !resource) {
      console.error(`FAILED inserting ${issue.date}: ${error?.message}`);
      process.exit(1);
    }

    const { error: placeErr } = await supabase.from('library_placements').insert({
      resource_id: resource.id,
      target_kind: 'topic',
      target_key: 'sparkler'
    });
    if (placeErr) {
      console.error(`FAILED placing ${issue.date}: ${placeErr.message}`);
      process.exit(1);
    }
    inserted++;
    console.log(`+ ${issue.date}  ${title} (${issue.jokes.length} jokes)`);
  }

  console.log(`\nDone: ${inserted} issues imported, ${skipped} already present.`);
}

main();
