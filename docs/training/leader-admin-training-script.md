# Troop 79 Website — Leader Admin Training Script

**Audience:** Adult leaders and committee members who will use the Leader Workspace
**Runtime:** ~40–45 minutes at a normal reading pace
**Format:** Spoken lines are plain text. Lines in `▸ [BRACKETS]` are stage directions — do not read them aloud.
**Suggested chapter breaks** are marked so you can cut this into shorter videos if you'd rather.

> **Recording note:** every section below is self-contained. If you want six short
> videos instead of one long one, cut at the `═══ CHAPTER` markers.

---

## 0 — Before you record

▸ [SETUP CHECKLIST — not spoken]
> - Sign in as a **leader**, not a scout, so the full nav is visible.
> - Have one upcoming event with a real signup, and one Sunday meeting on the calendar.
> - Have at least one pending profile change request and one pending library submission,
>   so the review queues aren't empty on camera.
> - Confirm you are on **production**, not the local dev database — the admin bar
>   shows a "DEV · LOCAL DATABASE" tag if you're not.
> - Blur or avoid showing the troop passwords on screen.

---

# ═══ CHAPTER 1 — Getting in ═══

## 1 — Open

▸ [SCREEN: public home page.]

This is the walkthrough for leaders.

Everything I'm about to show you sits behind the public site
you've already seen. Same website — there's just a second half
that families never see.

That second half is called the Leader Workspace,
and it does four jobs.

It records advancement.
It runs events — who's coming, who's driving, who owes money.
It publishes news, the calendar, and photos.
And it produces the file we upload to Scoutbook.

If you've been keeping any of this in a spreadsheet
or a group text, this replaces it.

---

## 2 — Two different logins

▸ [SCREEN: click "Member Login" in the top-right utility bar, land on /signin.]

Before anything else — there are two logins on this site,
and knowing which is which will save you a lot of confusion.

▸ [SCREEN: point at the email field.]

This one — Member Login — is the *family* login.
It's your personal identity. Email, six-digit code, no password.
It's what lets a parent edit their own household profile.

You have one of these too, as a parent.
It does not get you into the workspace.

▸ [SCREEN: point at and click "Leader or Scout? Sign in with the troop password."]

This link at the bottom is the other one.

▸ [SCREEN: land on /admin/login.]

This is the workspace login. It's a shared troop password,
plus your name.

---

## 3 — The login screen

▸ [SCREEN: hold on the login form.]

Two fields.

▸ [SCREEN: click into "Your name" and let the dropdown appear.]

Your name — and it autocompletes from the authorized adult list.
If your name isn't in that dropdown, you're not on the list yet.
That's a five-second fix; ask the Scoutmaster.

▸ [SCREEN: point at the password field. Do NOT type where the keystrokes are visible.]

And the troop password.

There are actually two passwords in circulation.

The **leader password** opens the full workspace —
everything I'm about to show you.

The **scout password** opens a much smaller version.
Scouts get News drafting, the Has/Needs tool,
the Media Manager, Photo Albums, and Utilities.
Nothing else. No roster, no ledger, no rosters of who's coming,
no demographics.

That's not a UI trick — the routes themselves refuse a scout session.

▸ [SCREEN: sign in. Land on the workspace.]

Your name is attached to everything you enter,
which is why we ask for it. When a sign-off shows up in the ledger
six months from now, we know who made it.

---

## 4 — The lay of the land

▸ [SCREEN: hold on the full workspace, top bar and left nav visible.]

Here's the workspace.

▸ [SCREEN: point at the top bar.]

Top bar: who you're signed in as, your role,
a link back to the public site, and Logout.

▸ [SCREEN: run the cursor down the left nav sections without clicking.]

Left side is the whole tool, grouped by what you're trying to do.

**Overview** — the Dashboard. Where you start.

**Entry** — Fast Entry and Event Rosters.
This is where you spend most of your time.
It's the stuff you do *during* and *right after* a meeting.

**Planning** — Meeting Plan, Roll Call, and the Has/Needs tool.
Stuff you do *before* a meeting.

**Records** — the Universal Ledger, Submit and Present,
merit badge progress, Audits, and the Roster.
Stuff you look up.

**News and Events** — News, Calendar, Resource Library,
Media Manager, Photo Albums.
Everything the families see.

**Output** — the Scoutbook export.

**Setup** — Lookups, Roster Import, Utilities.
Rarely touched. Powerful when it is.

▸ [SCREEN: point at "Court of Honor" with the "Soon" tag.]

Anything marked "Soon" isn't built yet.

Let's go through them in the order you'd actually use them.

---

# ═══ CHAPTER 2 — The daily work ═══

## 5 — The Dashboard

▸ [SCREEN: click Dashboard.]

This is the Dashboard, and it's built for one person in particular —
whoever's running advancement.

▸ [SCREEN: scroll the top counters.]

Up top: the numbers. All of them come out of the ledger,
so they're never a separate thing anyone has to maintain.

▸ [SCREEN: scroll to the attention items.]

The part that matters is here — things needing attention.

▸ [SCREEN: point at each attention category as you describe it.]

Scouts who look ready for their next rank —
that's anyone who's cleared about sixty percent of the requirements
for the rank above them. Not a promise. A nudge.

Awards earned but not yet submitted to Scoutbook.
Awards submitted but not yet handed to the scout.
Pending change requests from families.

▸ [SCREEN: scroll to the recent-activity feed.]

And at the bottom, the last ten things anybody entered.

If you check one screen a week, check this one.

---

## 6 — Fast Entry

▸ [SCREEN: click Fast Entry.]

Fast Entry is the most important screen in the building.

This is where sign-offs get recorded, and the whole design goal
was: do it at the meeting, on your phone, before you forget.

▸ [SCREEN: point at the two cards side by side.]

There are two ways in, and they're the same data
approached from opposite ends.

### Scout-first

▸ [SCREEN: click into the Scout-First card. Pick a scout.]

Scout-first is: one scout, many requirements.

You just sat down with a scout and went through four things
on their Tenderfoot card. Pick the scout —

▸ [SCREEN: use the requirement picker. Show the tabs.]

— then use the picker.

The picker is tabbed. Ranks on one side, merit badges on another,
and things like service hours, camping nights,
and leadership positions on another.

▸ [SCREEN: check several requirements.]

Check everything they finished. Set the date.
Put your name on it.

▸ [SCREEN: submit.]

Submit once. Four ledger entries. Done.

### Requirement-first

▸ [SCREEN: move to the Requirement-First card.]

Requirement-first is the other direction: one requirement, many scouts.

You just taught knots to eleven kids.
Nobody wants to open eleven scout records.

▸ [SCREEN: pick a requirement, then check off multiple scouts.]

Pick the requirement once. Check off every scout who got it.
Submit once.

That single change is the reason sign-offs actually
make it into the system on a Sunday night.

### Today's audit tape

▸ [SCREEN: scroll down to the audit tape.]

And underneath both, this — today's audit tape.

Every row entered today, live, as it happens.

▸ [SCREEN: point at a row.]

Two leaders working the same meeting can both watch this
and see immediately if they've double-entered something.

Made a mistake? Don't panic. Nothing here is permanent —
we'll get to fixing things when we hit the Ledger.

---

## 7 — Event Rosters

▸ [SCREEN: click Event Rosters.]

Event Rosters is the operational side of signups.

▸ [SCREEN: hold on the list.]

Important distinction, because there are two event screens
and people mix them up.

The **Calendar** screen, over in News and Events, is *setup* —
creating the event, building the signup form.

**Event Rosters** — this one — is *running* the event.
Only events that actually have a signup show up here.

▸ [SCREEN: point at the summary columns.]

The columns are the questions you're chasing
in the week before a campout.
How many are coming. How many slips are missing.
Who still owes money. Who hasn't answered at all.

▸ [SCREEN: click into a specific event roster.]

Click into one and you get the full roster.

▸ [SCREEN: scroll the roster table, pointing at columns.]

Every person, scout or adult.
Their answer. Their price tier. What they owe —
and that number is calculated the same way
the family's form calculated it, so the two can't disagree.

Guests they're bringing. Whether they're driving out,
driving back, or both, and how many seats.

Permission slip received — checkbox.
Payment received — checkbox.
Whatever they typed in the notes box.

▸ [SCREEN: check a slip-received box.]

You tick those as things come in. That's the whole workflow.

▸ [SCREEN: point at "Add person."]

Somebody signed up by texting you anyway?
Add them here yourself.

▸ [SCREEN: point at the email panel.]

And there's an email panel — you can message
the people on this roster without exporting anything
or building a list by hand.

▸ [SCREEN: point at the totals.]

Totals are troop-wide, not by patrol.
We shop as a troop and we combine patrols constantly,
so patrol subtotals were noise.

---

# ═══ CHAPTER 3 — Planning a meeting ═══

## 8 — Meeting Plan

▸ [SCREEN: click Meeting Plan.]

This one takes a minute to explain and then you'll want to use it every week.

The problem it solves: thirty scouts, all at different places,
and one hour on a Sunday. What do you actually teach?

▸ [SCREEN: point at the date picker, defaulted to next Sunday.]

Pick a meeting date. It defaults to next Sunday.

▸ [SCREEN: click Generate. Let the plan render.]

Hit generate, and it reads the ledger and works out
what each scout could realistically do next.

▸ [SCREEN: scroll through the generated sessions.]

Then it groups them into sessions — patrol-sized,
never more than eight scouts in one group —
and assigns a qualified adult to each one.

▸ [SCREEN: point at a session's teacher assignment.]

Qualified means we've recorded that they can teach that skill.
That list lives in Setup, under Lookups.

▸ [SCREEN: point at the tier groupings.]

It also sorts by experience — newer scouts,
experienced scouts, and older scouts — because
what you offer a first-year is not what you offer a Life scout.

▸ [SCREEN: point at the merit badge suggestions.]

Merit badges lean Eagle-required first, deliberately.

▸ [SCREEN: click Publish.]

Nothing is automatic. If this week is a themed merit badge night
or campout prep, just don't generate one — and the public page
says so instead of showing a stale plan.

When you publish, it takes a snapshot.

▸ [SCREEN: open a new tab to the public /meeting-plan page.]

And that snapshot is what families see here.
Scouts show as first name and last initial.

▸ [SCREEN: return to admin.]

Each week's sign-offs reshape the next week's plan.
So the more consistently Fast Entry gets used,
the better this gets.

---

## 9 — Roll Call and Agendas

▸ [SCREEN: click Roll Call & Agendas.]

Attendance.

▸ [SCREEN: hold on the list.]

And note what's in this list: it's not just Sunday meetings.

Every event with attendance is here.
Campouts. Service projects. Fundraisers. Day outings.

That matters because camping nights and service hours
are advancement requirements, and they used to get
reconstructed from memory days later.

▸ [SCREEN: point at the agenda column.]

Agendas are a meeting-only thing, so they show as a column
rather than as the point of the list.

▸ [SCREEN: point at a cancelled or "No Meeting" gap.]

Weeks where nothing happens are left out entirely.

▸ [SCREEN: click into one event's roll call.]

Click in and you get roll call.

▸ [SCREEN: mark a few people present.]

Tap present. Tap absent. That's it.

▸ [SCREEN: point at the quantity field on a campout.]

On a campout, there's a quantity — nights.
On a service project, hours.
It knows which one to ask for based on the category.

▸ [SCREEN: point at "Seed from signup."]

And if the event had a signup, there's a button
to seed the roll call from who said they were coming.
Start from the signup, then correct it against who actually showed.

Taking attendance here writes straight into the ledger.
You don't enter camping nights twice.

---

## 10 — The Has/Needs tool

▸ [SCREEN: click Has/Needs Tool.]

Small tool, big payoff, and scouts can use it too.

▸ [SCREEN: check one requirement in the tree.]

Check a requirement — anything from Scout through First Class.

▸ [SCREEN: show the two resulting lists.]

It splits the active troop into two lists.
Who has it. Who needs it.

▸ [SCREEN: check a second requirement, then toggle all/any.]

Check more than one and you get a toggle —
scouts who need *all* of these, or scouts who need *any* of them.

That's your class list. Print it, or just read off it.

Senior patrol leaders love this one.

---

# ═══ CHAPTER 4 — Records and accuracy ═══

## 11 — The Universal Ledger

▸ [SCREEN: click Universal Ledger.]

Here's the thing to understand about this whole system.

There is exactly one place advancement is stored,
and this is it.

▸ [SCREEN: scroll the ledger.]

Every sign-off, every rank, every merit badge,
every service hour, every camping night, every leadership term —
one table, one row each.

The dashboard counters, the public advancement tracker,
your scout's clipboard, the Scoutbook export —
they are all just different questions asked of this list.

▸ [SCREEN: use the search box.]

You can search it — by code, by label, by who entered it, by scout.

▸ [SCREEN: use the kind filter.]

Filter by type.

▸ [SCREEN: click a column header to sort.]

Sort any column.

▸ [SCREEN: point at the URL.]

And notice the address bar changes as you do that.
Every filter lives in the URL, which means you can bookmark a view
or paste it to another leader and they see exactly what you see.

▸ [SCREEN: edit a row.]

Wrong date? Wrong scout? Fix it here.

▸ [SCREEN: archive or delete a row, then toggle the hidden filter on.]

And when you remove something, it isn't really gone.
Flip this on and archived and deleted rows come back into view.

Nothing is destroyed. That's on purpose —
this is a permanent record of a child's advancement,
and "oops" needs to be recoverable.

---

## 12 — Submit and Present

▸ [SCREEN: click Submit & Present.]

This screen exists because an award has two lives
after it's earned, and both get forgotten.

▸ [SCREEN: point at the two checkbox columns.]

One — did we tell Scoutbook?
Two — did we actually hand it to the kid?

▸ [SCREEN: hold on the list.]

Every rank, merit badge, and special award earned,
newest first, with those two checkboxes.

They're independent. A badge can be recorded nationally
and still be sitting in a box in somebody's trunk.

▸ [SCREEN: use the outstanding filter.]

Filter to outstanding and you have your court of honor list.

▸ [SCREEN: point back at the underlying data.]

Same ledger rows underneath. This is just the useful view of them.

---

## 13 — Merit badge progress

▸ [SCREEN: click MB Progress.]

Every merit badge the troop offers,
with counts — earned, in progress, not started.

▸ [SCREEN: click into a badge.]

Click into one and you get the grid.

▸ [SCREEN: point at the grid — scouts down one side, requirements across.]

Scouts down the side. Requirements across the top.

▸ [SCREEN: click a cell to sign off.]

Click a cell to sign it off.

If you're a counselor running a badge with eight scouts,
this is your worksheet. It writes to the same ledger as everything else.

---

## 14 — Audits

▸ [SCREEN: click Audits.]

Audits is quality control, and I'd run it before every board of review.

▸ [SCREEN: scroll the list of checks.]

These are plain database checks. No guessing, no AI.
They recompute fresh every time you load the page —
nothing here is cached or stale.

▸ [SCREEN: point at each card as you name it.]

Board of review requirements — is anybody sitting for a board
who hasn't actually finished the prerequisites?

Activity thresholds — do the camping nights and service hours
add up to what the rank requires?

Time in grade — has enough time passed since their last rank?

Rank merit badges — do they have the required badges,
and the right Eagle-required ones?

Position of responsibility — have they served long enough?

Duplicate records — did two leaders sign off the same thing twice?

Attendance reconciliation — does roll call match what's in the ledger?

▸ [SCREEN: expand a finding.]

Each finding tells you the scout and what's wrong.

▸ [SCREEN: sign off a finding.]

And you can sign off on a finding when you've checked it
and it's fine — sometimes a flag is a paperwork artifact
rather than a real problem.

---

## 15 — The Roster

▸ [SCREEN: click Roster.]

The roster. Leader-only — this has birthdays,
schools, and addresses on it, and the scout login can't reach it.

▸ [SCREEN: click through the four tabs.]

Four tabs. Active scouts. Inactive scouts. Leaders. Adults.

▸ [SCREEN: hold on the tabs.]

Here's the rule that trips people up, so listen for ten seconds.

Membership is *derived*. You don't move people between these tabs by hand.

At eighteen, a scout is no longer a scout —
they leave the scout tabs automatically and appear
under Leaders or Adults depending on whether they hold a role.
That's aging out, and it's not the same thing as being inactive.

**Inactive** means a youth who left. Dropped out. Moved. Transferred.
That's a different thing and you set it deliberately.

And somebody moves between Leaders and Adults
by gaining or ending a role. Nothing else does it.
Their household and their family relationships stay put either way.

▸ [SCREEN: open a scout record.]

Open a person and you get everything —
contact info, household, relationships, BSA member ID,
current rank, swim class, the works.

▸ [SCREEN: scroll to the change request queue.]

And this is where family change requests land.

▸ [SCREEN: approve one.]

When a parent edits their profile on the public site,
it doesn't go live. It comes here. You look at it, you approve it.

Somebody should check this weekly. It's also on the Dashboard
so you don't have to remember.

▸ [SCREEN: point at the print button.]

There's a print view, for when you need paper.

---

# ═══ CHAPTER 5 — Publishing ═══

## 16 — News

▸ [SCREEN: click News.]

News is the front page of the public site.

▸ [SCREEN: point at the tabs and toolbar.]

Table of every post. Search it, filter by type,
filter by draft versus published,
and there's a separate Archived tab —
archived posts instead of mixed in with current ones.

▸ [SCREEN: click into an article, or create a new one.]

Open one and here's the editor.

▸ [SCREEN: show the split-pane markdown editor.]

It's markdown on the left, live preview on the right.
If you've never written markdown — you don't have to.
The toolbar buttons do headings, bold, lists, and links for you.

▸ [SCREEN: point at title, excerpt, hero image, type, tags.]

Title. A short excerpt — that's what shows on the card.
A hero image. The type. Tags.

▸ [SCREEN: demonstrate inserting a gallery or video token.]

And these tokens let you drop a photo gallery, a gallery link,
or a video into the middle of the story.

▸ [SCREEN: point at draft/publish.]

Save as draft as long as you like. Publish when it's ready.

▸ [SCREEN: note the scout access.]

Scouts can reach this screen. That's intentional —
a scout writing up a campout is exactly the kind of thing
we want. It's a drafting surface for them; a leader publishes.

---

## 17 — Calendar

▸ [SCREEN: click Calendar.]

The Calendar screen replaced three separate screens
that all meant the same thing: something happens on a date.

▸ [SCREEN: show the upcoming and past tabs.]

Upcoming and past, oldest first within each,
so it reads like a schedule instead of a log.

▸ [SCREEN: create a new entry.]

New entry: title, date, end date if it runs multiple days,
start and end times, location, category, and a description.

▸ [SCREEN: point at the category selector.]

The category does real work.
It sets the color on the public calendar,
it decides whether attendance is tracked and in what unit,
and it decides what tools you get on the entry itself.

▸ [SCREEN: use the clone button.]

Clone is your friend. Last year's fall campout,
cloned and re-dated, is thirty seconds instead of ten minutes.

▸ [SCREEN: point at the promotion controls.]

And this is promotion. Flip it on and the event
appears on the public home page and in the News and Events feed —
as itself. Nobody writes a duplicate article for an event.

▸ [SCREEN: click into an entry to open the workbench.]

Now click the entry itself. This is the workbench.

▸ [SCREEN: point at each panel as you go.]

**Details** — everything you just entered, editable.

**Story** — a longer write-up with images.
This is what makes an event page feel like a real page
instead of a database record.

**Agenda** — for meetings. What we're doing, in order,
who's running each block. It shows on the public event page.

**Roll Call** — link straight to attendance for this event.

**Signup** — and this is the big one.

---

## 18 — Building a signup

▸ [SCREEN: click into the Signup panel / builder.]

The signup builder is a checklist of blocks, not a template.

There is no "campout form" and no "fundraiser form."
Every event composes the same set of blocks;
the category just decides which ones start switched on.

▸ [SCREEN: walk down the builder, pointing at each block.]

**Basics** — deadline, who it's for (scouts, adults, or everyone),
capacity, and whether a waitlist kicks in past capacity.

**Prices** — as many tiers as you need.
"Scout, forty dollars." "Adult, twenty-five."
"Extra night, fifteen." Each tier can be per-event or per-day,
and can apply to scouts, adults, or both.

That's how the family's total gets calculated,
and it's the same math the roster uses.

▸ [SCREEN: show the slots block.]

**Jobs** — shifts and tasks.
"Driver, need four." "Saturday food shift, need three."
Each one gets a name, an optional description,
its own date and times if it's a shift,
who's eligible, and how many you need.

Families see how many are still open,
and they claim them right on the form.

▸ [SCREEN: show the questions block.]

**Questions** — anything you need to ask that isn't standard.
Text, number, or multiple choice.
T-shirt size. Dietary restrictions. Merit badge preference.

▸ [SCREEN: show the toggles.]

**Toggles** — permission slip required, health form part C required,
drivers needed, guests allowed.

▸ [SCREEN: show payment instructions and prompts.]

**Payment instructions** — free text. How to pay, who to pay.

And custom prompts, so the notes box and the guest box
ask the right question for this event.

▸ [SCREEN: open the public event page in a second tab.]

What an event *has* is what shows.
No block configured means no block rendered.
Nothing to hide, nothing to turn off.

▸ [SCREEN: point at open/closed status.]

And when the deadline passes, or you close it manually,
the form closes but the roster stays.

---

## 19 — Resource Library admin

▸ [SCREEN: click Resource Library.]

The Library is the collection of videos, guides, and links
attached to specific requirements and badges.

▸ [SCREEN: click through the tabs.]

Five tabs.

**Queue** — pending submissions.
And everything queues, including things leaders submit.
Nothing publishes straight to the site.

▸ [SCREEN: approve an item in the queue, showing the placement picker.]

Approving is where you decide *where* it goes —
which requirement, which badge, which topic shelf.
One resource can sit in several places.

**Published** — curation. Re-place things, pin the good stuff
to the top, archive what's gone stale.

**Topics** — the shelves for things that don't map
to a requirement. Gear. Camping skills.

▸ [SCREEN: open the Narratives tab.]

**Narratives** — this one's underused and it's the best part.

It's a free-form paragraph on any requirement or badge page.
Not a link — your words.
"Here's how we do this in Troop 79.
Here's what the counselor actually wants to see."

That's the institutional knowledge that usually
walks out the door when a leader steps down.

**Archived** — and everything archived can be restored.

---

## 20 — Media Manager

▸ [SCREEN: click Media Manager.]

Media Manager is the image library.

▸ [SCREEN: upload an image.]

Upload here, and it goes to our content delivery network —
which means it loads fast for families
and it isn't sitting in somebody's Google Drive.

▸ [SCREEN: point at the alt text field.]

Fill in the alt text. It's one sentence describing the picture.
It matters for anybody using a screen reader,
and it costs you five seconds.

▸ [SCREEN: show reusing an image in an article.]

Once it's here, it's available to every article,
every calendar entry, and every album cover.
Upload once, use anywhere.

Scouts can use this screen too.

---

## 21 — Photo Albums

▸ [SCREEN: click Photo Albums.]

Photo albums are just index cards pointing at Google Photos.

▸ [SCREEN: create an album entry.]

Title, date, category, and the public share link from Google.
Optionally pick a cover image from the media library.

▸ [SCREEN: open the public photos page in a second tab.]

The photos themselves stay on Google.
We're not copying thousands of images —
we're just giving families one organized place to find them.

Scouts can maintain this too.

---

# ═══ CHAPTER 6 — Output and setup ═══

## 22 — Scoutbook Export

▸ [SCREEN: click Scoutbook Export.]

This is where the work leaves our system and goes national.

▸ [SCREEN: set a date range.]

Pick a date range.

▸ [SCREEN: show the preview.]

You get a preview of every rank and merit badge award
recorded in that window.

▸ [SCREEN: download the file.]

Download, and you get the pipe-delimited file
that Scoutbook's bulk advancement upload accepts.
You upload that file to Scoutbook. That's the whole handoff.

▸ [SCREEN: click "Mark submitted."]

Then come back and mark them submitted —
which ticks the boxes over on the Submit and Present screen
so nothing gets uploaded twice.

▸ [SCREEN: hold for a beat.]

Rhythm that works: do this monthly, or after any big weekend.

---

## 23 — Lookups and Admin

▸ [SCREEN: click Lookups & Admin.]

Setup. You'll touch this a few times a year.

▸ [SCREEN: point at each card.]

**Merit badges** — the catalog, their requirement trees,
and who's registered as a counselor for each.

**Requirement codes** — the internal codes behind rank requirements.
Careful in here; these are what every ledger row points at.

**Households** — family groupings.

**Skills, and skill assignments** — this is the list
that tells the meeting plan generator which adults
can teach which skills. If your meeting plans keep assigning
the same three people, this is why. Fill it in.

**Tags** — the tags on news posts.

**Superusers** — who has elevated access.

▸ [SCREEN: hold for a beat.]

Scouts and adults are *not* managed here anymore.
They live on the Roster screen. This page only reads them
to fill in the counselor and teacher dropdowns.

---

## 24 — Roster Import

▸ [SCREEN: click Roster Import.]

Roster Import is for bringing in a roster file
from Scoutbook or the council.

▸ [SCREEN: show the staged rows.]

It stages everything first. Nothing writes to the real roster
just because you uploaded a file.

▸ [SCREEN: point at the merge candidates.]

It flags likely duplicates — same person, spelled differently,
or a parent who's already in the system under a different email.

▸ [SCREEN: approve a row.]

You review each one and approve it.
Every write is behind a click you made on purpose.

Use this once a year at recharter, and when a batch of new families joins.

---

## 25 — Utilities

▸ [SCREEN: click Utilities.]

Utilities is the odds-and-ends drawer.

▸ [SCREEN: point at the sync card.]

Right now it's mostly the media sync —
it reconciles our image records with what's actually
on the content delivery network.

Safe to run any time. If a picture isn't showing up
where you expect it, run this first.

---

# ═══ CHAPTER 7 — Rules of the road ═══

## 26 — Things to remember

▸ [SCREEN: return to the Dashboard.]

Six things and then I'll let you go.

**One. Enter it at the meeting.**
Fast Entry works on your phone.
A sign-off you meant to record on Tuesday is a sign-off that didn't happen.

**Two. Put your name on it.**
That's not bureaucracy — it's what lets us
answer a question about a sign-off two years from now.

**Three. Nothing is really deleted.**
Fix mistakes freely. Archived and deleted rows
are one checkbox away from coming back.

**Four. There's one ledger.**
If a number looks wrong on the public site,
the fix is in the ledger, not on the page showing the number.

**Five. Everything from families gets reviewed.**
Profile changes, library suggestions, proof submissions —
all of it queues. Someone has to actually look at the queues.
The Dashboard tells you when there's something waiting.

**Six. Know which login you're on.**
Scout password and leader password are not the same door.
If a screen you expected isn't in the nav,
check the top bar and see who you're signed in as.

▸ [SCREEN: hold on the dashboard.]

That's the workspace.

You will not use all of it. Nobody does.
Find the two or three screens that match your job
and get comfortable there.

For most of you, that's Fast Entry and Event Rosters.
For the advancement chair, it's Dashboard, Audits, and Scoutbook Export.
For whoever runs communications, it's News, Calendar, and Photo Albums.

▸ [SCREEN: point at the footer / contact email.]

If something's broken or something's missing, say so.
This got built for us, so it can change for us.

Thanks for volunteering. See you Sunday.

▸ [END]
