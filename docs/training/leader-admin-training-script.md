# Troop 79 Website — Leader Admin Training Script

**Audience:** Adult leaders and committee members who will use the Leader Workspace
**Runtime:** ~50–55 minutes at a normal reading pace
**Format:** Spoken lines are plain text. Lines in `▸ [BRACKETS]` are stage directions — do not read them aloud.
**Suggested chapter breaks** are marked so you can cut this into shorter videos if you'd rather.
**Revised:** 2026-08-26 — event signup now requires a parent's verified sign-in (the escape hatch:
add/edit a family's signup from the event roster, or send them a fresh sign-in link from the Roster's
adult row). Previously revised 2026-08-25 for v1.102 — one sign-in per person (no shared passwords),
Access & Permissions, the Calendar as the hub (Event Rosters, Event Signups and Roll Call & Agendas
are all folded into it), event logistics (rides, assignments, money, snapshot), Troop Finances, the
Advancement Report and Court of Honor, confirmation emails, and the Save / Back / help-badge standards.

> **Recording note:** every section below is self-contained. If you want eight short
> videos instead of one long one, cut at the `═══ CHAPTER` markers.

---

## 0 — Before you record

▸ [SETUP CHECKLIST — not spoken]
> - Sign in as **yourself** with the **Troop admin** preset on Access & Permissions, so every nav section is visible — including Finance, which is never implied by admin.
> - Have one upcoming campout with a real signup (prices, jobs, drivers, an assignment set, a fee) and one Sunday meeting with an agenda on the calendar.
> - Have at least one pending profile change request, one pending library submission, one submitted story, and one reimbursement request, so the queues aren't empty on camera.
> - Confirm you are on **production**, not the local dev database — the admin bar shows a "DEV · LOCAL DATABASE" tag if you're not.
> - Keep the troop password off screen. There is no leader password any more.
> - If you want to show a real confirmation email, Resend must be configured on the server (RESEND_API_KEY / EMAIL_FROM). Otherwise say "logged, not sent."

---

# ═══ CHAPTER 1 — Getting in ═══

## 1 — Open

▸ [SCREEN: public home page.]

This is the walkthrough for leaders.

Everything I'm about to show you sits behind the public site
you've already seen. Same website — there's just a second half
that families never see.

That second half is called the Leader Workspace,
and it does five jobs.

It records advancement.
It runs events — who's coming, who's driving, who's in which tent, who owes money.
It publishes news, the calendar, and photos.
It keeps the troop's books.
And it produces the file we upload to Scoutbook.

If you've been keeping any of this in a spreadsheet
or a group text, this replaces it.

---

## 2 — One sign-in, for everyone

▸ [SCREEN: click "Members" in the public nav, land on the Members sign-in page.]

Before anything else — there is one sign-in on this site, and it's yours.

There used to be a shared leader password and a shared scout password.
Both are gone.
You sign in as yourself, the same way a parent does,
and what you can see in the workspace depends on what's been granted to *you*.

▸ [SCREEN: click "Sign in." Show the troop password step — keystrokes hidden.]

Step one: the troop password from the Bugle.
That's not a login. It just unlocks the list of names.

▸ [SCREEN: type a few letters of your last name, pick yourself.]

Step two: find your name.

▸ [SCREEN: show the masked-email code screen. Enter the code.]

Step three: a six-digit code and a link go to the email we have for you.
Type the code, or tap the link.

▸ [SCREEN: land signed in. Point at the top utility bar.]

That's it. And because you're a person, not a password,
one sign-in gets you both your family's pages *and* the workspace.
No second login for leaders who are also parents.

▸ [SCREEN: on the Members page, point at the passkey section.]

Save a passkey on your phone if you like — Face ID, fingerprint —
and you skip the code next time. The emailed code is always the fallback.

▸ [SCREEN: type /admin in the address bar, or use a bookmark to the old /admin/login.]

Old bookmarks still work. The old admin login page
just forwards you to the real sign-in and then back to where you were going.

▸ [SCREEN: land on the workspace.]

Your name is attached to everything you enter.
When a sign-off shows up in the ledger six months from now, we know who made it.

---

## 3 — Access and Permissions

▸ [SCREEN: Setup → Access & Permissions.]

So who decides what you can see? This screen.

▸ [SCREEN: hold on the table — alphabetical by name.]

Every adult on the roster, and the capabilities they hold.

▸ [SCREEN: open one person, show the preset buttons.]

There are presets for the jobs we actually have:
Youth leader — that's the SPL or a patrol leader.
Adult leader. Membership or committee chair. Advancement chair.
Comms and newsletter lead. Librarian. Treasurer. Troop admin.

▸ [SCREEN: point at the individual capability checkboxes.]

Underneath the presets are the individual grants —
advancement, calendar, news, library, roster, meeting plan, finance.
A preset is just a bundle. You can hand-tune.

▸ [SCREEN: hold.]

Two rules.

The nav only shows you the screens you hold a grant for.
If a screen you expected isn't in your nav, this is why — ask a troop admin.

And Finance is its own thing. Being an admin does not make you a treasurer.
Money is granted on purpose, by name.

---

## 4 — The lay of the land

▸ [SCREEN: hold on the full workspace, top bar and left nav visible.]

Here's the workspace.

▸ [SCREEN: point at the top bar.]

Top bar: who you're signed in as, a link back to the public site, and Logout.

▸ [SCREEN: run the cursor down the left nav sections without clicking.]

Left side is the whole tool, grouped by what you're trying to do.

**Overview** — the Dashboard. Where you start.

**Entry** — Fast Entry. Where sign-offs get recorded.

**Planning** — Meeting Plan and the Has/Needs tool.
Stuff you do *before* a meeting.

**Records** — the Advancement Ledger, the Roster,
Submit and Present, and merit badge progress.
Stuff you look up.

**Reports and Exports** — Audits, the weekly Advancement Report,
Court of Honor, the Scoutbook export, and the Attendance Report.
Things you generate and hand off.

**News and Events** — News, the Calendar, the Resource Library,
Media Manager, Photo Albums.
Everything the families see. And the Calendar is where events get *run*, not just listed.

**Finance** — the Financial Ledger, Reimbursements, and the Activity Report.
Treasurer only.

**Setup** — Lookups, Roster Import, Access and Permissions, Utilities, and the Styleguides.
Rarely touched. Powerful when it is.

▸ [SCREEN: click into any list page, then point at the "← Back to …" link under the title.]

Three things you'll see on every screen, so I'll say them once.

Every page has one way back, right under the title.
Go deep — an event's money page, say — and it turns into breadcrumbs.
And when you come back to a list, it remembers your tab and your search.

▸ [SCREEN: click a "?" help badge somewhere.]

These little question marks are help. Click one, read it, click away.

▸ [SCREEN: open any edit form, point at Save changes / Discard changes.]

And every edit form works the same way.
The Save button is grey until you've actually changed something.
"Discard changes" puts it back the way it was saved.
If you try to leave with unsaved changes, it asks.

Let's go through the screens in the order you'd actually use them.

---

# ═══ CHAPTER 2 — The daily work ═══

## 5 — The Dashboard

▸ [SCREEN: click Dashboard.]

This is the Dashboard, and it's built for one person in particular —
whoever's running advancement.

▸ [SCREEN: scroll the top counters.]

Up top: the numbers. All of them come out of the ledger,
so they're never a separate thing anyone has to maintain.

If you hold the finance grant, Total Funds and Available Funds sit up here too.

▸ [SCREEN: scroll to "Needs Attention."]

The part that matters is here — things needing attention.

▸ [SCREEN: point at each attention category as you describe it.]

Awards earned but not yet submitted to Scoutbook.
Awards submitted but not yet handed to the scout.
Pending change requests from families.
Library submissions, proofs, and stories waiting for review.

▸ [SCREEN: scroll to "Likely Ready for Review."]

Then — scouts who look ready for their next rank.
That's anyone who's cleared most of the requirements for the rank above them.
Not a promise. A nudge. The suggested action is usually "schedule a board of review."

▸ [SCREEN: scroll to Recent Ledger Activity.]

Recent ledger activity — the last things anybody entered.

▸ [SCREEN: scroll to Recent Logins.]

Recent logins — who's signed in, from what, and whether it was their first time.
Useful the week after you send families the training video.

▸ [SCREEN: point at Site Analytics.]

And Site Analytics — traffic and engagement, from Google Analytics.
Aggregate only. No names.

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
Your name's already on it.

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

### Two rules the picker enforces

▸ [SCREEN: in the merit badge tab, check "Full merit badge earned" on a badge with no prior activity.]

Merit badges: a scout comes back from summer camp with a blue card.
Check "full badge earned" and it goes in as one fact —
you don't have to tick every requirement underneath.

But if we'd already started tracking that badge requirement by requirement,
it makes you finish the list. No half-tracked badges.

▸ [SCREEN: in the rank tab, point at the Board of Review row.]

Ranks are stricter. The board of review is the only way to award a rank,
and it will not let you record one while a requirement is still open.
There's never a scenario where a requirement is missing and a board of review is valid.

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

# ═══ CHAPTER 3 — The Calendar runs the events ═══

## 7 — The Calendar list

▸ [SCREEN: News & Events → Calendar.]

The Calendar is the hub. This one screen replaced
Events, Event Signups, Event Rosters, and Roll Call and Agendas.
They all meant the same thing: something happens on a date, and things hang off it.

▸ [SCREEN: show the Upcoming and Past tabs, the category filter.]

Upcoming and past, oldest first within each,
so it reads like a schedule instead of a log.

▸ [SCREEN: point across one row.]

One line per event. Date, title, category, who created it, where.

▸ [SCREEN: point at the letter pills, then click the "?" on the column header.]

Then the status pills — and these are the whole point.

**A** — Agenda. Green when published, yellow while it's a draft.
**S** — Signup. Green when open, yellow as a draft, grey once it's closed.
**R** — Roll call taken. Hover for the headcount.
And a red **O** only when the entry is *off* the calendar — not published.

Every pill is a link straight into that layer of the event.

▸ [SCREEN: point at the Going column.]

"Going" — how many people have said yes. Straight from the signups.

▸ [SCREEN: point at Promoted.]

"Promoted" — whether it's on the public home page and the News feed.
Flip it on and the event appears there as itself.
Nobody writes a duplicate article for an event.

▸ [SCREEN: open the Actions menu on a row.]

Actions. Clone is your friend — last year's fall campout,
cloned and re-dated, is thirty seconds instead of ten minutes.
Merge, for when two people created the same meeting.
And delete, which warns you about everything that hangs off the entry first.

▸ [SCREEN: click "+ Add Event."]

New entry: title, date, end date if it runs multiple days,
start and end times, location, category, and the description.

▸ [SCREEN: point at the category selector.]

The category does real work.
It sets the color on the public calendar,
it decides whether attendance is tracked and in what unit — nights, hours —
and it decides which signup blocks start switched on.

A week with no meeting isn't a category any more. It's a Troop Meeting titled "No Troop Meeting."

---

## 8 — The entry workbench

▸ [SCREEN: click an event title to open the workbench.]

Click the entry itself. This is the workbench.
Everything about one event, in four tabs.

▸ [SCREEN: point at the tabs: Entry · Agenda · Signup · Roll Call.]

**Entry** — the details and the story, in one form.
Numbered sections: the basics, the write-up with images, where it's promoted.
The story is what makes an event page feel like a real page
instead of a database record.

**Agenda** — for meetings. What we're doing, in order,
who's running each block. Draft it, publish it, and it shows on the public event page.

**Signup** — the big one. We'll spend the next few sections here.

**Roll Call** — attendance for this event. Section 13.

▸ [SCREEN: point at the address bar as you switch tabs.]

The tab is in the address. Bookmark an event's Signup tab and that's where you land.

---

## 9 — Building a signup

▸ [SCREEN: on the Signup tab of an event with no signup yet, click "Enable a signup."]

An event doesn't have a signup until you turn one on.

▸ [SCREEN: show the Builder with its tabs.]

The builder is a checklist of blocks, not a template.

There is no "campout form" and no "fundraiser form."
Every event composes the same set of blocks;
the category just decides which ones start switched on.

▸ [SCREEN: walk the Builder tabs, pointing at each block.]

**Settings** — deadline, who it's for (scouts, adults, or everyone),
capacity, and whether a waitlist kicks in past capacity.
Permission slip required. Health form Part C required.
Drivers needed. And the guest mode — none, just a count, or named guests.
Named is for anything with a headcount or a price per head.

**Price tiers** — as many as you need.
"Scout, forty dollars." "Adult, twenty-five." "Extra night, fifteen."
Each tier can be per-event or per-day,
and can apply to scouts, adults, or both.
That's how the family's total gets calculated,
and it's the same math the roster uses.

**Jobs** — shifts and tasks.
"Driver, need four." "Saturday food shift, need three."
Each one gets a name, a short code, an optional description,
its own date and times if it's a shift, who's eligible, and how many you need.
Families see how many are still open, and they claim them right on the form.

**Questions** — anything you need to ask that isn't standard.
Text, number, or multiple choice.
T-shirt size. Dietary restrictions. Merit badge preference.
Some questions can be leader-only — columns only you fill in,
like "health form in hand" or "registered with council."

**Assignments** — the groupings for this event.
Patrols, tents, crews, teams. There are presets by category, and you can add any set.
Patrols seed themselves from the roster. Families can pick a tent.

▸ [SCREEN: back on Settings, point at the Confirmation email block.]

And the confirmation email. When a family signs up, changes, or cancels,
they get a receipt — what they signed up for, who's coming, what they owe,
how to pay, the location.
It goes to every signed-up member with an email; if only scouts signed up, the parents are copied.

You can also get a leader notification — up to five addresses —
either its own message or a copy of the family's.
The wording comes from the email templates in Lookups, and you can edit it per event.

▸ [SCREEN: open the public event page in a second tab.]

What an event *has* is what shows.
No block configured means no block rendered.
Nothing to hide, nothing to turn off.

▸ [SCREEN: point at open/closed status.]

And when the deadline passes, or you close it manually,
the form closes but the roster stays.

---

## 10 — The event roster

▸ [SCREEN: on the Signup tab, switch to the Roster view.]

Now the operational side. Same tab, Roster view.

▸ [SCREEN: point at the Attending / Other responses tabs.]

Two tabs. **Attending** is people actually coming.
**Other responses** is everything else — declined, waitlisted, driver-only, removed.

▸ [SCREEN: scroll across the columns, pointing.]

One line per name. Scout or adult, and their class — youth, adult, junior leader —
as a little colored pill.

Their price tier. What they owe — calculated the same way
the family's form calculated it, so the two can't disagree.

Rides: whether they're driving, how many seats, and whether they need a ride there and back.

Their patrol, tent, crew — one column per set.

Their jobs. Their answers. Their notes.

And the columns only appear if the event uses that feature.
A service project with no fees has no money column.

▸ [SCREEN: point at the leader-only cells.]

Leader-only cells — "health form in hand," "registered with council" —
you tick those as things come in. That's the whole workflow.

▸ [SCREEN: click Edit on a row.]

Edit a row to change their jobs, their class, or their transportation.

▸ [SCREEN: point at "Add a person."]

Somebody signed up by texting you anyway?
Add them here yourself — a member, a known guest, or someone you removed earlier.

▸ [SCREEN: hold.]

One more thing, since this changed today.

Signing up now needs a parent to be signed in as *themselves* —
the troop password alone doesn't sign anybody up any more.
So when a family calls and says the site won't let them sign up, check two things.

Are they signed in as a parent, and not their scout?
A signed-in scout only sees "Ask a parent to sign in." That's by design.
And is their email on file? Check it on the Roster, or ask them to check /profile.

If either one's the problem, you have two fixes right here.
Add them yourself, same as any other signup —
or send them a fresh sign-in link, which we'll get to on the Roster screen.
Either one gets a stuck family unstuck in under a minute.

▸ [SCREEN: point at Remove.]

Remove is soft. It frees the seat and keeps everything attached —
payments, placements, job claims — in case they're back.
And it's not a ban; a family can sign up again.

▸ [SCREEN: point at the Confirmations panel.]

Confirmations — which households got their email, and when.
Resend, if somebody says they never saw it.

▸ [SCREEN: point at the email panel.]

And there's an email panel — message everyone on this roster
without exporting anything or building a list by hand.

▸ [SCREEN: point at the totals.]

Totals are troop-wide, not by patrol.
We shop as a troop and we combine patrols constantly.

---

## 11 — Rides and assignments

▸ [SCREEN: switch to the Rides & Assignments view.]

This is the car sheet.

▸ [SCREEN: point at the car cards and the "Needs a ride" pool.]

A card per driver, with their seats.
A pool of everyone who needs a ride.
Drag people into cars, or use "Move."

▸ [SCREEN: point at the there/back tiles.]

The tiles at the top are the sheet's old Need / Available / Short columns —
seats we have going there, seats we need, and the same coming back.

▸ [SCREEN: switch to a patrol or tent set.]

Patrols, tents, crews — same idea, one screen per set.
Patrols fill in from the roster automatically and place late sign-ups.
You fix the exceptions.

▸ [SCREEN: open the public event page.]

And once a scout is placed, their family sees it on the event page —
"riding with the Porters, there."

---

## 12 — Money and the snapshot

▸ [SCREEN: switch to the Money view.]

Money, for events with a fee.

▸ [SCREEN: point at owed / paid / balance.]

Owed, paid, balance, per person.
Record a payment — cash, check, or from the scout's account.
Refunds. Overpayments can go to the scout's account as a credit.

▸ [SCREEN: show the guard when paying from a scout account that would go negative.]

If you try to pay from a scout account that can't cover it,
it stops and shows you the balance — and offers the scholarship fund instead.

▸ [SCREEN: scroll to expenses and the P&L.]

Expenses — the troop paid, or a leader fronted it and wants reimbursing.
Income by method. A profit-and-loss for the event.

▸ [SCREEN: point at the deposit schedule and reminder email.]

And a deposit schedule with a "behind" badge,
and an editable reminder email for the families who are.

Every payment recorded here is a real row in the Financial Ledger.
The treasurer sees it without anybody re-entering anything.

▸ [SCREEN: switch to the Snapshot view.]

Snapshot is the whole event on paper.

▸ [SCREEN: switch the order — by patrol, A to Z, adults then scouts. Click Print.]

Roster by patrol, car manifests with blank lines for open seats,
contacts, money, schedule.
Pick the order, print it, put it in the binder that goes on the trip.

---

## 13 — Roll Call

▸ [SCREEN: click the Roll Call tab.]

Attendance.

▸ [SCREEN: back on the Calendar list, point at the R pills.]

Note what has a Roll Call: everything that tracks attendance.
Sunday meetings, but also PLC, committee meetings,
campouts, service projects, fundraisers, day outings.

That matters because camping nights and service hours
are advancement requirements, and they used to get
reconstructed from memory days later.

▸ [SCREEN: on the Roll Call tab, point at the group tabs.]

Scouts, Leaders, Adults, Inactive — with a present count on each.
Search across all of them.

▸ [SCREEN: mark a few people present.]

Tap present. Tap absent. It saves as you go.

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

▸ [SCREEN: Reports & Exports → Attendance Report.]

The Attendance Report — scouts on one tab, adults on the other —
is the year-at-a-glance version of all of this.

---

# ═══ CHAPTER 4 — Planning a meeting ═══

## 14 — Meeting Plan

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
experienced scouts, and older scouts.

▸ [SCREEN: point at the merit badge suggestions.]

Merit badges lean Eagle-required first, deliberately.

▸ [SCREEN: click Publish.]

Nothing is automatic. If this week is a themed merit badge night
or campout prep, just don't generate one.

When you publish, it takes a snapshot.

▸ [SCREEN: open a new tab to the public /meeting-plan page.]

And that snapshot is what families see here.
Scouts show as first name and last initial.

▸ [SCREEN: return to admin.]

Each week's sign-offs reshape the next week's plan.
So the more consistently Fast Entry gets used, the better this gets.

---

## 15 — The Has/Needs tool

▸ [SCREEN: click Has/Needs Tool.]

Small tool, big payoff, and the SPL can hold a grant for it.

▸ [SCREEN: check one requirement in the tree.]

Check a requirement — anything from Scout through First Class.

▸ [SCREEN: show the two resulting lists.]

It splits the active troop into two lists.
Who has it. Who needs it.

▸ [SCREEN: check a second requirement, then toggle all/any.]

Check more than one and you get a toggle —
scouts who need *all* of these, or scouts who need *any* of them.

That's your class list. Print it, or just read off it.

---

# ═══ CHAPTER 5 — Records and accuracy ═══

## 16 — The Advancement Ledger

▸ [SCREEN: click Advancement Ledger.]

Here's the thing to understand about this whole system.

There is exactly one place advancement is stored,
and this is it.

▸ [SCREEN: scroll the ledger.]

Every sign-off, every rank, every merit badge,
every service hour, every camping night, every leadership term —
one table, one row each.

The dashboard counters, the public advancement tracker,
your scout's clipboard, the weekly report, the Scoutbook export —
they are all just different questions asked of this list.

▸ [SCREEN: use the search box.]

You can search it — by code, by label, by who entered it, by scout.

▸ [SCREEN: use the kind filter, sort a column, point at the URL.]

Filter by type. Sort any column.
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

## 17 — Submit and Present

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

Filter to outstanding and you have your court of honor list —
though there's a proper Court of Honor report now, which we'll get to.

---

## 18 — Merit badge progress

▸ [SCREEN: click MB Progress.]

Every merit badge the troop offers,
with counts — earned, in progress, not started.

▸ [SCREEN: click into a badge.]

Click into one and you get the grid.
Scouts down the side. Requirements across the top.

▸ [SCREEN: click a cell to sign off.]

Click a cell to sign it off.

If you're a counselor running a badge with eight scouts,
this is your worksheet. It writes to the same ledger as everything else.

The families see the public version of this in the Library.

---

## 19 — The Roster

▸ [SCREEN: click Roster.]

The roster. This has birthdays, schools, and addresses on it,
which is why it takes its own grant.

▸ [SCREEN: click through the tabs.]

Five tabs. Active scouts. Inactive scouts. Leaders. Adults.
And Guests — the people families have brought to events
who aren't members.

▸ [SCREEN: type in the search box.]

Every tab has a name search.

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

▸ [SCREEN: click the Adults tab, open one adult's row, point at "Send sign-in link."]

One more button worth knowing, on every adult's row: "Send sign-in link."

Event signup needs a parent to sign in as themselves now,
so this is your fastest fix when a family's stuck.
Click it, and we email that adult a fresh one-time code and link —
exactly as if they'd started the sign-in themselves.

It only ever goes to the address already sitting on the roster —
there's no "type in any address" box, on purpose.
If a second parent isn't on file yet, add their email here first,
on that adult's Edit, then send the link.

▸ [SCREEN: open a scout record. Point at the numbered sections and the side rail.]

Open a person and you get everything —
identity, demographics, contact, things we should know,
parents and guardians, status.
Current rank is derived — you can't type it.

▸ [SCREEN: point at "Junior Leader (event sign-ups)."]

The Junior Leader flag is for event signups —
grades nine through twelve count automatically, and you can override it.

▸ [SCREEN: scroll to the change request queue. Approve one.]

And this is where family change requests land.
When a parent edits their household on the public site,
it doesn't go live. It comes here. You look at it, you approve it.

Somebody should check this weekly. It's also on the Dashboard.

▸ [SCREEN: open the Actions menu — "Assign patrols…", "Family Roster (print / PDF)."]

Two things in Actions.
Assign patrols — the whole troop on one screen, drag and done.
And the Family Roster — a real printed document, organized by household,
with a who-to-call page and a patrol page.
No medical information, no birthdates, no BSA IDs. It's safe to hand out.

▸ [SCREEN: click the Guests tab.]

Guests: merge one into a real person when they join,
or forget them after a year.

---

# ═══ CHAPTER 6 — Reports ═══

## 20 — Audits

▸ [SCREEN: click Audits.]

Audits is quality control, and I'd run it before every board of review.

▸ [SCREEN: scroll the list of checks.]

These are plain database checks. No guessing.
They recompute fresh every time you load the page.

▸ [SCREEN: point at each card as you name it.]

Board of review requirements — is anybody sitting for a board
who hasn't actually finished the prerequisites?

Activity and campout thresholds — do the camping nights and service hours
add up to what the rank requires?

Time in rank — has enough time passed since their last rank?

Star and Life merit badge counts — do they have the required badges,
and the right Eagle-required ones?

Position of responsibility — have they served long enough?

▸ [SCREEN: expand a finding, then resolve it.]

Each finding tells you the scout and what's wrong.
You can resolve a finding when you've checked it and it's fine —
sometimes a flag is a paperwork artifact rather than a real problem.

---

## 21 — The Advancement Report

▸ [SCREEN: click Advancement Report.]

The weekly advancement report. This is what goes in the Bugle.

▸ [SCREEN: pick the week, click Generate.]

Pick the period, generate, and it pulls everything recorded that week —
grouped by rank and requirement, then merit badges, then awards.

It's smart about noise. If a scout earned the rank,
it doesn't also list the twelve requirements underneath it.

▸ [SCREEN: edit the text.]

You can edit it before it goes out.

▸ [SCREEN: publish, then open the public /advancement/report page.]

Publish, and it's on the public Advancement page for families —
with an archive of every past week.

---

## 22 — Court of Honor

▸ [SCREEN: click Court of Honor.]

The Court of Honor report.

▸ [SCREEN: set the date range.]

Everything *earned* in a date range — ranks, badges, special awards —
by type, and by scout. CSV export for the printed program.

▸ [SCREEN: point at Publish, then at "Confirm presented."]

Two separate buttons, on purpose.
Publish makes the list.
"Confirm presented" is what you click *after* the ceremony —
and that's what ticks the "presented" boxes over on Submit and Present.
Courts of honor happen outdoors. They get rained out.
Nothing assumes the ceremony happened.

---

## 23 — Scoutbook Export

▸ [SCREEN: click Scoutbook Export.]

This is where the work leaves our system and goes national.

▸ [SCREEN: set a date range. Show the preview.]

Pick a date range. You get a preview of every rank and merit badge award
recorded in that window.

▸ [SCREEN: download the file.]

Download, and you get the file
that Scoutbook's bulk advancement upload accepts.
You upload that file to Scoutbook. That's the whole handoff.

▸ [SCREEN: click "Mark submitted."]

Then come back and mark them submitted —
which ticks the boxes on Submit and Present
so nothing gets uploaded twice.

Rhythm that works: do this monthly, or after any big weekend.

---

# ═══ CHAPTER 7 — Publishing ═══

## 24 — News

▸ [SCREEN: click News.]

News is the front page of the public site.

▸ [SCREEN: point at the tabs and toolbar.]

Table of every post. Search it, filter by category,
filter by draft versus published,
and there's a separate Archived tab.

▸ [SCREEN: point at the pending / submitted stories.]

Stories that families submit from the public site land here as pending.
Read it, tidy it, publish it. The scout's name stays on the byline.

▸ [SCREEN: click into an article, or create a new one.]

Open one and here's the editor.

▸ [SCREEN: show the numbered sections and the split-pane markdown editor.]

Numbered sections. Title, the category, the summary that shows on the card,
a hero image, then the body —
markdown on the left, live preview on the right.
If you've never written markdown — you don't have to.
The toolbar buttons do headings, bold, lists, and links for you.

▸ [SCREEN: demonstrate inserting a gallery or video token.]

These tokens let you drop a photo gallery, a gallery link,
or a video into the middle of the story.

▸ [SCREEN: point at the byline and the published date.]

You can credit a scout as the author, and you can backdate a post
if you're catching up on last month.

▸ [SCREEN: point at draft/publish.]

Save as draft as long as you like. Publish when it's ready.
Once it's published, its web address is frozen —
renaming the title won't break a link somebody already shared.

▸ [SCREEN: show the Front page order screen.]

And the front page order.
Featured stories and promoted events in one list —
drag them into the order you want. The top card is the hero.

---

## 25 — Resource Library admin

▸ [SCREEN: click Resource Library.]

The Library is the collection of videos, guides, and links
attached to specific requirements and badges.

▸ [SCREEN: click through the tabs.]

**Queue** — pending submissions from families.
Everything queues, including things leaders submit.
Nothing publishes straight to the site.

▸ [SCREEN: approve an item in the queue, showing the placement picker.]

Approving is where you decide *where* it goes —
which requirement, which badge, which topic shelf.
One resource can sit in several places.
And who can see it — everyone, or leaders only.

**Proof Queue** — when a scout clicks "I did this" on a requirement at home,
it lands here. Look at what they sent, sign it off, and it goes in the ledger.

**Published** — curation. Re-place things, pin the good stuff
to the top, archive what's gone stale.
It'll warn you about anything published but placed nowhere.

**Topics and Shelves** — the shelves for things that don't map
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

▸ [SCREEN: click "+ Add Resource."]

And "Add Resource" — a link, or upload a PDF straight in.

---

## 26 — Media Manager and Photo Albums

▸ [SCREEN: click Media Manager.]

Media Manager is the image library.

▸ [SCREEN: upload an image. Point at the "4.0 MB → 180 KB" line.]

Upload here, and it goes to our content delivery network —
which means it loads fast for families
and it isn't sitting in somebody's Google Drive.

It shrinks the picture on the way up — phone photos are huge —
and tells you what it did. There's a "keep original size" option if you need it.

▸ [SCREEN: point at the alt text field.]

Fill in the alt text. It's one sentence describing the picture.
It matters for anybody using a screen reader,
and it costs you five seconds.

Once it's here, it's available to every article,
every calendar entry, and every album cover.

▸ [SCREEN: click Photo Albums.]

Photo albums are just index cards pointing at Google Photos.

▸ [SCREEN: create an album entry.]

Title, date, category, and the public share link from Google.
Optionally pick a cover image from the media library.

▸ [SCREEN: open the public photos page in a second tab. Flip through the four views.]

The photos themselves stay on Google.
Families get four ways to browse the same albums —
prints, timeline, list, and the almanac.

---

# ═══ CHAPTER 8 — Finance ═══

## 27 — The Financial Ledger

▸ [SCREEN: Finance → Financial Ledger. If you don't hold the grant, say so and skip to section 30.]

Troop Finances. This section only appears if you hold the treasurer grant.
The treasurer's spreadsheet is retired; this is the book now.

▸ [SCREEN: point at the top cards.]

Total funds. Checking plus savings.
Scout and scholarship accounts.
And available funds — what's actually the troop's to spend.

▸ [SCREEN: scroll the ledger. Point at the Kind pills and the running total.]

One ledger for every dollar. Real accounts and the notional ones —
each scout's account, the scholarship fund — side by side.
Balances are always added up from the rows, never typed in.

▸ [SCREEN: use the filters — account, person, kind, date range, amount range.]

Filter by account, by person, by kind, by date, by amount.

▸ [SCREEN: open the Actions menu.]

Actions: record a transaction. Transfer between accounts.
Monthly reconciliation. Manage the kinds. Export CSV.

▸ [SCREEN: edit a row, then show Void.]

Edit is for a real transaction keyed in wrong.
Void is for a transaction that shouldn't exist.
They're different on purpose, and both leave a trail.

▸ [SCREEN: point at a row that came from an event.]

Event fees, refunds, and scout-account credits recorded on an event's Money tab
show up here on their own, linked to the event.
Nobody re-enters them.

---

## 28 — Reimbursements

▸ [SCREEN: click Reimbursements.]

Reimbursements is a queue.

▸ [SCREEN: open a pending request, view the receipt.]

A family — or a leader — submits a request with a receipt
from the Members area on the public site.
It lands here. Approve it, deny it, or mark it paid.

▸ [SCREEN: mark one paid.]

Marking it paid writes the payout into the ledger, linked to the request.
It can't be paid twice.

---

## 29 — Activity Report

▸ [SCREEN: click Activity Report.]

The Activity Report groups income and expense by event —
what the rummage sale actually made, what the campout actually cost —
for a date range, by account.

That's the committee meeting slide.

---

# ═══ CHAPTER 9 — Setup ═══

## 30 — Lookups and Admin

▸ [SCREEN: click Lookups & Admin.]

Setup. You'll touch this a few times a year.

▸ [SCREEN: point at each card.]

**Merit Badge Catalog** — the badges, their requirement trees,
and who's registered as a counselor for each.

**Internal Requirement Codes** — the codes behind rank requirements.
Careful in here; these are what every ledger row points at.

**Households** — family groupings.

**Skills** and **Leader Skills** — this is the list
that tells the meeting plan generator which adults
can teach which skills. If your meeting plans keep assigning
the same three people, this is why. Fill it in.

**Scout Instructors** — older scouts who teach.

**Leadership Positions** and **Service Projects** — the lookup lists behind those ledger entries.

**Events** and **Categories** — the calendar categories.
One list for events, news, and albums.
Categories are what the public "browse by category" runs on.

**Email templates** — the confirmation and notification emails.
Written in markdown, with a real-email preview.

**Event reminder email** — the payment reminder.

**Article Typography** — how article text renders.

**Search and AI visibility** — what search engines see: meeting place, public email, share image.

▸ [SCREEN: hold for a beat.]

Scouts and adults are *not* managed here.
They live on the Roster. Who can *do* what lives on Access and Permissions.

---

## 31 — Roster Import

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

## 32 — Utilities and Styleguides

▸ [SCREEN: click Utilities.]

Utilities is the odds-and-ends drawer.

Right now it's the media sync —
it reconciles our image records with what's actually
on the content delivery network.
Safe to run any time. If a picture isn't showing up
where you expect it, run this first.

▸ [SCREEN: click Styleguides.]

Styleguides is the design reference — every button, table, and form pattern
the site uses, on one page. You won't need it. It's there so the site
keeps looking like one site as it grows.

---

# ═══ CHAPTER 10 — Rules of the road ═══

## 33 — Things to remember

▸ [SCREEN: return to the Dashboard.]

Seven things and then I'll let you go.

**One. Enter it at the meeting.**
Fast Entry works on your phone.
A sign-off you meant to record on Tuesday is a sign-off that didn't happen.

**Two. You are the login.**
No shared passwords. What you can see is what's been granted to you.
If a screen is missing from your nav, ask a troop admin — don't borrow someone's session.

**Three. The Calendar runs the event.**
Signup, roster, rides, money, roll call — it all hangs off the calendar entry.
If you're looking for an event tool, open the event.

**Four. Nothing is really deleted.**
Fix mistakes freely. Archived and deleted rows
are one checkbox away from coming back.

**Five. There's one ledger for advancement, and one for money.**
If a number looks wrong on the public site,
the fix is in the ledger, not on the page showing the number.

**Six. Everything from families gets reviewed.**
Profile changes, library suggestions, proof submissions, stories, reimbursements —
all of it queues. Someone has to actually look at the queues.
The Dashboard tells you when there's something waiting.

**Seven. Grey Save means nothing changed.**
If the Save button won't light up, you haven't changed anything yet.
And Discard always takes you back to what was saved.

▸ [SCREEN: hold on the dashboard.]

That's the workspace.

You will not use all of it. Nobody does.
Find the two or three screens that match your job
and get comfortable there.

For most of you, that's Fast Entry and the Calendar.
For the advancement chair, it's Dashboard, Audits, the Advancement Report, and Scoutbook Export.
For whoever runs communications, it's News, Calendar, and Photo Albums.
For the treasurer, it's the Finance section and the Money tab on every event.

▸ [SCREEN: point at the footer / contact email.]

If something's broken or something's missing, say so.
This got built for us, so it can change for us.

Thanks for volunteering. See you Sunday.

▸ [END]
