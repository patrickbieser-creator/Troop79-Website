-- Confirmation emails are markdown now (Patrick, 2026-08-25: "full markdown
-- style support … the same as is offered in news"). The seeded templates get
-- markdown bodies, and the [summary] block they place is itself editable —
-- section tokens ([going], [jobs], …) render as bullet lists under whatever
-- caption the template gives them. Only the four seeds are touched, and only
-- if nobody has edited them since (body unchanged from the seed).

update public.email_templates set body = E'Hi [name] — you''re signed up for **[event]** on [date].\n\nWe''ll be at [location]. [map]\n\n**Amount due:** [amount_due]. [payment]\n\nReply to this email if anything changes before [deadline].\n\n[summary]'
 where name = 'Event confirmation'
   and body = 'Hi [name] — you''re signed up for [event] on [date]. We''ll be at [location] ([map]). Amount due: [amount_due]. [payment] Reply to this email if anything changes before [deadline].';

update public.email_templates set body = E'Hi [name] — [scouts] going to **[event]** on [date] at [time], [location]. [map]\n\n[summary]'
 where name = 'Meeting RSVP'
   and body = E'Hi [name] — [scouts] going to [event] on [date] at [time], [location].\n\n[summary]';

update public.email_templates set body = E'**[household]** ([email], [phone]) — [changed]. [headcount].\n\n[changes]\n\n[summary]'
 where name = 'New signup'
   and body = E'[household] ([email], [phone]) — [changed]: [going]. [jobs] [rides] Amount due [amount_due]. [headcount].\n\n[changes]';

update public.email_templates set body = E'**[household]** signed up:\n\n[prices]\n\nPaid [paid], owes **[amount_due]**. [roster_link]'
 where name = 'Money watch'
   and body = '[household] signed up: [prices]. Paid [paid], owes [amount_due].';
